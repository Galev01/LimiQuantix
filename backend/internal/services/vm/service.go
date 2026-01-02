// Package vm provides the virtual machine service for the control plane.
// This service implements the VMServiceHandler interface generated from the proto definitions.
package vm

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/scheduler"
	"github.com/limiquantix/limiquantix/internal/services/node"
	computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
	"github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1/computev1connect"
	nodev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/node/v1"
)

// Ensure Service implements VMServiceHandler
var _ computev1connect.VMServiceHandler = (*Service)(nil)

// Service implements the VMService Connect-RPC handler.
// It orchestrates VM lifecycle operations, validation, and persistence.
type Service struct {
	computev1connect.UnimplementedVMServiceHandler

	repo       Repository
	nodeRepo   node.Repository
	daemonPool *node.DaemonPool
	scheduler  *scheduler.Scheduler
	logger     *zap.Logger
}

// NewService creates a new VM service.
func NewService(repo Repository, logger *zap.Logger) *Service {
	return &Service{
		repo:   repo,
		logger: logger.Named("vm-service"),
	}
}

// NewServiceWithDaemon creates a new VM service with Node Daemon integration.
func NewServiceWithDaemon(
	repo Repository,
	nodeRepo node.Repository,
	daemonPool *node.DaemonPool,
	sched *scheduler.Scheduler,
	logger *zap.Logger,
) *Service {
	return &Service{
		repo:       repo,
		nodeRepo:   nodeRepo,
		daemonPool: daemonPool,
		scheduler:  sched,
		logger:     logger.Named("vm-service"),
	}
}

// ============================================================================
// CRUD Operations
// ============================================================================

// CreateVM creates a new virtual machine.
// The VM will be in STOPPED state after creation unless start_on_create is true.
func (s *Service) CreateVM(
	ctx context.Context,
	req *connect.Request[computev1.CreateVMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "CreateVM"),
		zap.String("vm_name", req.Msg.Name),
		zap.String("project_id", req.Msg.ProjectId),
	)

	logger.Info("Creating VM")

	// 1. Validate request
	if err := validateCreateRequest(req.Msg); err != nil {
		logger.Warn("Validation failed", zap.Error(err))
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// 2. Use default project if not specified
	projectID := req.Msg.ProjectId
	if projectID == "" {
		projectID = "00000000-0000-0000-0000-000000000001" // Default project
	}

	// 3. Determine target node (explicit placement or scheduler)
	var targetNodeID string
	var targetNode *domain.Node
	
	// Check if explicit node placement was requested
	if req.Msg.NodeId != "" {
		targetNodeID = req.Msg.NodeId
		logger.Info("Using explicit node placement", zap.String("node_id", targetNodeID))
		// Verify the node exists
		if s.nodeRepo != nil {
			node, err := s.nodeRepo.Get(ctx, targetNodeID)
			if err != nil {
				logger.Warn("Specified node not found, will try scheduler",
					zap.String("node_id", targetNodeID),
					zap.Error(err),
				)
				targetNodeID = "" // Reset to allow scheduler fallback
			} else {
				targetNode = node
				logger.Info("VM will be placed on specified node",
					zap.String("node_id", targetNodeID),
					zap.String("hostname", node.Hostname),
				)
			}
		}
	}
	
	// If no explicit placement or node not found, use scheduler
	if targetNodeID == "" && s.scheduler != nil {
		result, err := s.scheduler.Schedule(ctx, req.Msg.Spec)
		if err != nil {
			logger.Warn("Failed to schedule VM", zap.Error(err))
			// Continue without scheduling - VM will be created without a node
		} else {
			targetNodeID = result.NodeID
			logger.Info("VM scheduled to node",
				zap.String("node_id", targetNodeID),
				zap.String("hostname", result.Hostname),
				zap.Float64("score", result.Score),
			)
			// Get node details
			if s.nodeRepo != nil {
				targetNode, _ = s.nodeRepo.Get(ctx, targetNodeID)
			}
		}
	}

	// 4. Build domain model
	now := time.Now()
	vm := &domain.VirtualMachine{
		Name:            req.Msg.Name,
		ProjectID:       projectID,
		Description:     req.Msg.Description,
		Labels:          req.Msg.Labels,
		HardwareVersion: "v1",
		Spec:            convertSpecFromProto(req.Msg.Spec),
		Status: domain.VMStatus{
			State:   domain.VMStateStopped,
			Message: "VM created successfully",
			NodeID:  targetNodeID,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	// 5. Persist to repository
	created, err := s.repo.Create(ctx, vm)
	if err != nil {
		if errors.Is(err, domain.ErrAlreadyExists) {
			logger.Warn("VM already exists", zap.Error(err))
			return nil, connect.NewError(connect.CodeAlreadyExists, fmt.Errorf("VM with name '%s' already exists in project", req.Msg.Name))
		}
		logger.Error("Failed to create VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create VM: %w", err))
	}

	// 6. Create VM on the Node Daemon (if available)
	if s.daemonPool != nil && targetNode != nil {
		// ManagementIP already includes port (e.g., "192.168.0.53:9090")
		daemonAddr := targetNode.ManagementIP
		client, err := s.daemonPool.Connect(targetNodeID, daemonAddr)
		if err != nil {
			logger.Warn("Failed to connect to node daemon, VM created in control plane only",
				zap.String("node_id", targetNodeID),
				zap.Error(err),
			)
		} else {
			// Build Node Daemon request
			daemonReq := convertToNodeDaemonCreateRequest(created, req.Msg.Spec)

			_, err := client.CreateVM(ctx, daemonReq)
			if err != nil {
				logger.Warn("Failed to create VM on node daemon, VM exists in control plane",
					zap.String("vm_id", created.ID),
					zap.String("node_id", targetNodeID),
					zap.Error(err),
				)
				// Update status to reflect the issue
				created.Status.Message = "VM created but failed to provision on node"
				_ = s.repo.UpdateStatus(ctx, created.ID, created.Status)
			} else {
				logger.Info("VM created on node daemon",
					zap.String("vm_id", created.ID),
					zap.String("node_id", targetNodeID),
				)
			}
		}
	}

	logger.Info("VM created successfully",
		zap.String("vm_id", created.ID),
		zap.String("node_id", targetNodeID),
	)

	return connect.NewResponse(ToProto(created)), nil
}

// GetVM retrieves a virtual machine by ID.
func (s *Service) GetVM(
	ctx context.Context,
	req *connect.Request[computev1.GetVMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "GetVM"),
		zap.String("vm_id", req.Msg.Id),
	)

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}

	vm, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			logger.Debug("VM not found")
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.Id))
		}
		logger.Error("Failed to get VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(ToProto(vm)), nil
}

// ListVMs returns a paginated list of virtual machines.
func (s *Service) ListVMs(
	ctx context.Context,
	req *connect.Request[computev1.ListVMsRequest],
) (*connect.Response[computev1.ListVMsResponse], error) {
	logger := s.logger.With(
		zap.String("method", "ListVMs"),
		zap.String("project_id", req.Msg.ProjectId),
	)

	// Build filter from request
	filter := VMFilter{
		ProjectID: req.Msg.ProjectId,
		NodeID:    req.Msg.NodeId,
		States:    convertPowerStatesToDomain(req.Msg.States),
		Labels:    req.Msg.Labels,
	}

	// Default page size
	pageSize := int(req.Msg.PageSize)
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 1000 {
		pageSize = 1000
	}

	// Query repository
	vms, total, err := s.repo.List(ctx, filter, pageSize, req.Msg.PageToken)
	if err != nil {
		logger.Error("Failed to list VMs", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Build response
	resp := &computev1.ListVMsResponse{
		TotalCount: int32(total),
	}

	for _, vm := range vms {
		resp.Vms = append(resp.Vms, ToProto(vm))
	}

	// Set next page token if there are more results
	if len(vms) == pageSize && len(vms) > 0 {
		resp.NextPageToken = vms[len(vms)-1].ID
	}

	logger.Debug("Listed VMs",
		zap.Int("count", len(vms)),
		zap.Int64("total", total),
	)

	return connect.NewResponse(resp), nil
}

// UpdateVM updates a virtual machine's specification.
func (s *Service) UpdateVM(
	ctx context.Context,
	req *connect.Request[computev1.UpdateVMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "UpdateVM"),
		zap.String("vm_id", req.Msg.Id),
	)

	logger.Info("Updating VM")

	// 1. Validate request
	if err := validateUpdateRequest(req.Msg); err != nil {
		logger.Warn("Validation failed", zap.Error(err))
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// 2. Get existing VM
	vm, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// 3. Check if VM must be stopped for certain changes
	requiresStop := false
	if req.Msg.Spec != nil {
		if req.Msg.Spec.Cpu != nil && vm.IsRunning() {
			requiresStop = true
		}
		if req.Msg.Spec.Memory != nil && vm.IsRunning() {
			requiresStop = true
		}
	}
	if requiresStop {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("VM must be stopped to change CPU or memory configuration"))
	}

	// 4. Apply updates
	if req.Msg.Description != "" {
		vm.Description = req.Msg.Description
	}
	if len(req.Msg.Labels) > 0 {
		vm.Labels = req.Msg.Labels
	}
	if req.Msg.Spec != nil {
		vm.Spec = convertSpecFromProto(req.Msg.Spec)
	}
	vm.UpdatedAt = time.Now()

	// 5. Persist update
	updated, err := s.repo.Update(ctx, vm)
	if err != nil {
		logger.Error("Failed to update VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("VM updated successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// DeleteVM permanently deletes a virtual machine.
func (s *Service) DeleteVM(
	ctx context.Context,
	req *connect.Request[computev1.DeleteVMRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeleteVM"),
		zap.String("vm_id", req.Msg.Id),
	)

	logger.Info("Deleting VM")

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}

	// Get existing VM to check state
	vm, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Check if VM is running (unless force is set)
	if vm.IsRunning() && !req.Msg.Force {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("VM is running; stop it first or use force=true"))
	}

	// Delete from Node Daemon if assigned to a node
	if s.daemonPool != nil && vm.Status.NodeID != "" {
		client := s.daemonPool.Get(vm.Status.NodeID)
		if client != nil {
			err := client.DeleteVM(ctx, vm.ID)
			if err != nil {
				logger.Warn("Failed to delete VM from node daemon",
					zap.String("vm_id", vm.ID),
					zap.String("node_id", vm.Status.NodeID),
					zap.Error(err),
				)
				// Continue with control plane deletion
			} else {
				logger.Info("VM deleted from node daemon",
					zap.String("vm_id", vm.ID),
					zap.String("node_id", vm.Status.NodeID),
				)
			}
		}
	}

	// Delete from repository
	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.Id))
		}
		logger.Error("Failed to delete VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("VM deleted successfully")

	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ============================================================================
// Power Operations
// ============================================================================

// StartVM powers on a virtual machine.
func (s *Service) StartVM(
	ctx context.Context,
	req *connect.Request[computev1.StartVMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "StartVM"),
		zap.String("vm_id", req.Msg.Id),
	)

	logger.Info("Starting VM")

	if err := validateStartRequest(req.Msg); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// Get existing VM
	vm, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Check if VM can be started
	if !vm.CanStart() {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("VM cannot be started from state '%s'", vm.Status.State))
	}

	// Update status to starting
	vm.Status.State = domain.VMStateStarting
	vm.Status.Message = "VM is starting"
	vm.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, vm.ID, vm.Status); err != nil {
		logger.Error("Failed to update VM status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Start VM on Node Daemon
	if s.daemonPool != nil && vm.Status.NodeID != "" {
		client := s.daemonPool.Get(vm.Status.NodeID)
		if client != nil {
			err := client.StartVM(ctx, vm.ID)
			if err != nil {
				logger.Error("Failed to start VM on node daemon",
					zap.String("vm_id", vm.ID),
					zap.String("node_id", vm.Status.NodeID),
					zap.Error(err),
				)
				// Revert status
				vm.Status.State = domain.VMStateStopped
				vm.Status.Message = fmt.Sprintf("Failed to start: %s", err)
				_ = s.repo.UpdateStatus(ctx, vm.ID, vm.Status)
				return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to start VM on node: %w", err))
			}
			logger.Info("VM started on node daemon")
		}
	}

	// Update to running state
	vm.Status.State = domain.VMStateRunning
	vm.Status.Message = "VM is running"

	if err := s.repo.UpdateStatus(ctx, vm.ID, vm.Status); err != nil {
		logger.Error("Failed to update VM status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Fetch the updated VM
	updated, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("VM started successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// StopVM powers off a virtual machine.
func (s *Service) StopVM(
	ctx context.Context,
	req *connect.Request[computev1.StopVMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "StopVM"),
		zap.String("vm_id", req.Msg.Id),
		zap.Bool("force", req.Msg.Force),
	)

	logger.Info("Stopping VM")

	if err := validateStopRequest(req.Msg); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// Get existing VM
	vm, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Check if VM can be stopped
	if !vm.CanStop() {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("VM cannot be stopped from state '%s'", vm.Status.State))
	}

	// Update status to stopping
	vm.Status.State = domain.VMStateStopping
	if req.Msg.Force {
		vm.Status.Message = "VM is being force-stopped"
	} else {
		vm.Status.Message = "VM is shutting down gracefully"
	}
	vm.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, vm.ID, vm.Status); err != nil {
		logger.Error("Failed to update VM status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Stop VM on Node Daemon
	if s.daemonPool != nil && vm.Status.NodeID != "" {
		client := s.daemonPool.Get(vm.Status.NodeID)
		if client != nil {
			var stopErr error
			if req.Msg.Force {
				stopErr = client.ForceStopVM(ctx, vm.ID)
			} else {
				stopErr = client.StopVM(ctx, vm.ID, 30) // 30 second timeout
			}
			if stopErr != nil {
				logger.Error("Failed to stop VM on node daemon",
					zap.String("vm_id", vm.ID),
					zap.String("node_id", vm.Status.NodeID),
					zap.Error(stopErr),
				)
				// Revert status
				vm.Status.State = domain.VMStateRunning
				vm.Status.Message = fmt.Sprintf("Failed to stop: %s", stopErr)
				_ = s.repo.UpdateStatus(ctx, vm.ID, vm.Status)
				return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to stop VM on node: %w", stopErr))
			}
			logger.Info("VM stopped on node daemon")
		}
	}

	// Update to stopped state
	vm.Status.State = domain.VMStateStopped
	vm.Status.Message = "VM is stopped"

	if err := s.repo.UpdateStatus(ctx, vm.ID, vm.Status); err != nil {
		logger.Error("Failed to update VM status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Fetch the updated VM
	updated, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("VM stopped successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// RebootVM restarts a virtual machine.
func (s *Service) RebootVM(
	ctx context.Context,
	req *connect.Request[computev1.RebootVMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "RebootVM"),
		zap.String("vm_id", req.Msg.Id),
	)

	logger.Info("Rebooting VM")

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}

	// Get existing VM
	vm, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// VM must be running to reboot
	if !vm.IsRunning() {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("VM must be running to reboot, current state: '%s'", vm.Status.State))
	}

	// Reboot on Node Daemon
	if s.daemonPool != nil && vm.Status.NodeID != "" {
		client := s.daemonPool.Get(vm.Status.NodeID)
		if client != nil {
			err := client.RebootVM(ctx, vm.ID)
			if err != nil {
				logger.Error("Failed to reboot VM on node daemon",
					zap.String("vm_id", vm.ID),
					zap.String("node_id", vm.Status.NodeID),
					zap.Error(err),
				)
				return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to reboot VM on node: %w", err))
			}
			logger.Info("VM reboot initiated on node daemon")
		}
	}

	vm.Status.Message = "VM is rebooting"
	vm.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, vm.ID, vm.Status); err != nil {
		logger.Error("Failed to update VM status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Fetch the updated VM
	updated, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("VM reboot initiated")

	return connect.NewResponse(ToProto(updated)), nil
}

// PauseVM suspends VM execution (freezes in place).
func (s *Service) PauseVM(
	ctx context.Context,
	req *connect.Request[computev1.PauseVMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "PauseVM"),
		zap.String("vm_id", req.Msg.Id),
	)

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}

	vm, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if !vm.IsRunning() {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("VM must be running to pause"))
	}

	// Pause on Node Daemon
	if s.daemonPool != nil && vm.Status.NodeID != "" {
		client := s.daemonPool.Get(vm.Status.NodeID)
		if client != nil {
			err := client.PauseVM(ctx, vm.ID)
			if err != nil {
				logger.Error("Failed to pause VM on node daemon", zap.Error(err))
				return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to pause VM on node: %w", err))
			}
		}
	}

	vm.Status.State = domain.VMStatePaused
	vm.Status.Message = "VM is paused"
	vm.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, vm.ID, vm.Status); err != nil {
		logger.Error("Failed to update VM status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	updated, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("VM paused successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// ResumeVM resumes a paused virtual machine.
func (s *Service) ResumeVM(
	ctx context.Context,
	req *connect.Request[computev1.ResumeVMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "ResumeVM"),
		zap.String("vm_id", req.Msg.Id),
	)

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}

	vm, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if vm.Status.State != domain.VMStatePaused {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("VM must be paused to resume"))
	}

	// Resume on Node Daemon
	if s.daemonPool != nil && vm.Status.NodeID != "" {
		client := s.daemonPool.Get(vm.Status.NodeID)
		if client != nil {
			err := client.ResumeVM(ctx, vm.ID)
			if err != nil {
				logger.Error("Failed to resume VM on node daemon", zap.Error(err))
				return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to resume VM on node: %w", err))
			}
		}
	}

	vm.Status.State = domain.VMStateRunning
	vm.Status.Message = "VM is running"
	vm.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, vm.ID, vm.Status); err != nil {
		logger.Error("Failed to update VM status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	updated, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("VM resumed successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// SuspendVM saves VM state to disk and stops (hibernate).
func (s *Service) SuspendVM(
	ctx context.Context,
	req *connect.Request[computev1.SuspendVMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "SuspendVM"),
		zap.String("vm_id", req.Msg.Id),
	)

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}

	vm, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if !vm.IsRunning() {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("VM must be running to suspend"))
	}

	vm.Status.State = domain.VMStateSuspended
	vm.Status.Message = "VM is suspended"
	vm.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, vm.ID, vm.Status); err != nil {
		logger.Error("Failed to update VM status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	updated, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("VM suspended successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// ============================================================================
// Helper Functions
// ============================================================================

// convertToNodeDaemonCreateRequest converts a VM to a Node Daemon create request.
func convertToNodeDaemonCreateRequest(vm *domain.VirtualMachine, spec *computev1.VmSpec) *nodev1.CreateVMOnNodeRequest {
	// Determine if hugepages is enabled
	hugepagesEnabled := false
	if spec.GetMemory().GetHugePages() != nil {
		hugepagesEnabled = spec.GetMemory().GetHugePages().GetEnabled()
	}

	req := &nodev1.CreateVMOnNodeRequest{
		VmId:   vm.ID,
		Name:   vm.Name,
		Labels: vm.Labels,
		Spec: &nodev1.VMSpec{
			CpuCores:          spec.GetCpu().GetCores(),
			CpuSockets:        spec.GetCpu().GetSockets(),
			CpuThreadsPerCore: spec.GetCpu().GetThreadsPerCore(),
			MemoryMib:         spec.GetMemory().GetSizeMib(),
			MemoryHugepages:   hugepagesEnabled,
		},
	}

	// Convert disks - include backing file for cloud images
	for _, disk := range spec.GetDisks() {
		diskSpec := &nodev1.DiskSpec{
			Id:          disk.GetId(),
			Path:        disk.GetVolumeId(), // Use volume_id as path
			SizeGib:     disk.GetSizeGib(),
			Bus:         nodev1.DiskBus(disk.GetBus()),
			Format:      nodev1.DiskFormat_DISK_FORMAT_QCOW2, // Default to qcow2
			Readonly:    disk.GetReadonly(),
			Bootable:    disk.GetBootIndex() > 0, // bootable if boot_index > 0
			BackingFile: disk.GetBackingFile(),   // Cloud image path for copy-on-write
		}

		req.Spec.Disks = append(req.Spec.Disks, diskSpec)
	}

	// Convert NICs
	for _, nic := range spec.GetNics() {
		req.Spec.Nics = append(req.Spec.Nics, &nodev1.NicSpec{
			Id:         nic.GetId(),
			MacAddress: nic.GetMacAddress(),
			Network:    nic.GetNetworkId(), // Use network_id
			Model:      nodev1.NicModel(nic.GetModel()),
		})
	}

	// Convert console
	if spec.GetDisplay() != nil {
		isVnc := spec.GetDisplay().GetType() == computev1.DisplayConfig_VNC
		req.Spec.Console = &nodev1.ConsoleSpec{
			VncEnabled: isVnc,
		}
	}

	// Convert cloud-init configuration
	if spec.GetProvisioning() != nil {
		cloudInit := spec.GetProvisioning().GetCloudInit()
		if cloudInit != nil && (cloudInit.GetUserData() != "" || cloudInit.GetMetaData() != "") {
			req.Spec.CloudInit = &nodev1.CloudInitConfig{
				UserData:      cloudInit.GetUserData(),
				MetaData:      cloudInit.GetMetaData(),
				NetworkConfig: cloudInit.GetNetworkConfig(),
				VendorData:    cloudInit.GetVendorData(),
			}
		}
	}

	return req
}
