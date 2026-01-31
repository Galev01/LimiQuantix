// Package vm provides the virtual machine service for the control plane.
// This service implements the VMServiceHandler interface generated from the proto definitions.
package vm

import (
	"context"
	"errors"
	"fmt"
	"strings"
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

// SnapshotRepository defines the interface for snapshot persistence.
type SnapshotRepository interface {
	Create(ctx context.Context, snap *domain.Snapshot, vmSpec *domain.VMSpec) error
	Get(ctx context.Context, id string) (*domain.Snapshot, error)
	ListByVM(ctx context.Context, vmID string) ([]*domain.Snapshot, error)
	Delete(ctx context.Context, id string) error
	DeleteByVM(ctx context.Context, vmID string) error
	SyncFromHypervisor(ctx context.Context, vmID string, hypervisorSnapshots []*domain.Snapshot) error
}

// Service implements the VMService Connect-RPC handler.
// It orchestrates VM lifecycle operations, validation, and persistence.
type Service struct {
	computev1connect.UnimplementedVMServiceHandler

	repo         Repository
	nodeRepo     node.Repository
	snapshotRepo SnapshotRepository
	daemonPool   *node.DaemonPool
	scheduler    *scheduler.Scheduler
	logger       *zap.Logger
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

// SetSnapshotRepository sets the snapshot repository for database persistence.
func (s *Service) SetSnapshotRepository(repo SnapshotRepository) {
	s.snapshotRepo = repo
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

	// 2. Use default project if not specified or if "default" placeholder
	projectID := req.Msg.ProjectId
	if projectID == "" || projectID == "default" {
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

	// 6. Create VM on the Node Daemon (if target node is specified)
	// When a node is explicitly requested, the VM MUST be successfully created on that node
	// or the operation fails (atomic operation - rollback DB entry on daemon failure)
	if s.daemonPool != nil && targetNode != nil && targetNodeID != "" {
		// Strip CIDR notation if present (e.g., "192.168.0.53/32" -> "192.168.0.53")
		daemonAddr := targetNode.ManagementIP
		if idx := strings.Index(daemonAddr, "/"); idx != -1 {
			daemonAddr = daemonAddr[:idx]
		}
		// Ensure port is included
		if !strings.Contains(daemonAddr, ":") {
			daemonAddr = daemonAddr + ":9090"
		}

		client, err := s.daemonPool.Connect(targetNodeID, daemonAddr)
		if err != nil {
			// Failed to connect to the node daemon - rollback DB entry
			logger.Error("Failed to connect to node daemon, rolling back VM creation",
				zap.String("vm_id", created.ID),
				zap.String("node_id", targetNodeID),
				zap.String("daemon_addr", daemonAddr),
				zap.Error(err),
			)
			// Rollback: Delete the VM from the database
			if delErr := s.repo.Delete(ctx, created.ID); delErr != nil {
				logger.Error("Failed to rollback VM from database",
					zap.String("vm_id", created.ID),
					zap.Error(delErr),
				)
			}
			return nil, connect.NewError(connect.CodeUnavailable,
				fmt.Errorf("failed to connect to node '%s' at %s: %w", targetNode.Hostname, daemonAddr, err))
		}

		// Debug: Log what we received from the frontend
		for i, disk := range req.Msg.Spec.GetDisks() {
			logger.Info("DEBUG: Disk spec from frontend",
				zap.Int("disk_index", i),
				zap.String("disk_id", disk.GetId()),
				zap.Uint64("size_gib", disk.GetSizeGib()),
				zap.String("backing_file", disk.GetBackingFile()),
				zap.String("volume_id", disk.GetVolumeId()),
			)
		}

		// Build Node Daemon request
		daemonReq := convertToNodeDaemonCreateRequest(created, req.Msg.Spec)

		_, err = client.CreateVM(ctx, daemonReq)
		if err != nil {
			// Failed to create VM on the node daemon - rollback DB entry
			logger.Error("Failed to create VM on node daemon, rolling back",
				zap.String("vm_id", created.ID),
				zap.String("node_id", targetNodeID),
				zap.Error(err),
			)
			// Rollback: Delete the VM from the database
			if delErr := s.repo.Delete(ctx, created.ID); delErr != nil {
				logger.Error("Failed to rollback VM from database",
					zap.String("vm_id", created.ID),
					zap.Error(delErr),
				)
			}
			return nil, connect.NewError(connect.CodeInternal,
				fmt.Errorf("failed to provision VM on node '%s': %w", targetNode.Hostname, err))
		}

		logger.Info("VM created on node daemon",
			zap.String("vm_id", created.ID),
			zap.String("node_id", targetNodeID),
			zap.String("hostname", targetNode.Hostname),
		)
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

	// Enrich running VM with live metrics from node daemon
	if vm.IsRunning() && vm.Status.NodeID != "" {
		s.enrichVMWithLiveMetrics(ctx, vm, logger)
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

	// Enrich running VMs with live metrics from node daemons
	s.enrichVMsWithLiveMetrics(ctx, vms, logger)

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
// Supports two modes:
// - remove_from_inventory_only=true: Only removes from vDC database, keeps VM on hypervisor
// - remove_from_inventory_only=false (default): Full deletion including hypervisor and optionally volumes
func (s *Service) DeleteVM(
	ctx context.Context,
	req *connect.Request[computev1.DeleteVMRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeleteVM"),
		zap.String("vm_id", req.Msg.Id),
		zap.Bool("remove_from_inventory_only", req.Msg.RemoveFromInventoryOnly),
		zap.Bool("delete_volumes", req.Msg.DeleteVolumes),
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

	// Delete from Node Daemon if assigned to a node AND not "remove from inventory only"
	// When RemoveFromInventoryOnly=true, we skip node daemon deletion entirely
	if vm.Status.NodeID != "" && !req.Msg.RemoveFromInventoryOnly {
		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Warn("Failed to connect to node daemon for deletion",
				zap.String("vm_id", vm.ID),
				zap.String("node_id", vm.Status.NodeID),
				zap.Error(err),
			)
			// Continue with control plane deletion
		} else {
			// TODO: Pass delete_volumes flag to node daemon when supported
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
					zap.Bool("delete_volumes", req.Msg.DeleteVolumes),
				)
			}
		}
	} else if req.Msg.RemoveFromInventoryOnly {
		logger.Info("Removing VM from inventory only (keeping on hypervisor)",
			zap.String("vm_id", vm.ID),
			zap.String("node_id", vm.Status.NodeID),
		)
	}

	// Delete from repository
	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.Id))
		}
		logger.Error("Failed to delete VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if req.Msg.RemoveFromInventoryOnly {
		logger.Info("VM removed from inventory (kept on hypervisor)")
	} else {
		logger.Info("VM deleted successfully")
	}

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

	// #region agent log
	logger.Info("DEBUG H1: VM state before CanStart check",
		zap.String("vm_id", vm.ID),
		zap.String("current_state", string(vm.Status.State)),
		zap.String("node_id", vm.Status.NodeID),
		zap.Bool("can_start", vm.CanStart()),
	)
	// #endregion

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
	if vm.Status.NodeID != "" {
		// #region agent log
		logger.Info("DEBUG H2/H4: Attempting to get node daemon client",
			zap.String("node_id", vm.Status.NodeID),
			zap.Bool("daemon_pool_exists", s.daemonPool != nil),
		)
		// #endregion

		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			// #region agent log
			logger.Error("DEBUG H2: Node daemon client lookup failed",
				zap.String("node_id", vm.Status.NodeID),
				zap.Error(err),
			)
			// #endregion
			logger.Warn("Failed to connect to node daemon for start",
				zap.String("node_id", vm.Status.NodeID),
				zap.Error(err),
			)
			// Revert status
			vm.Status.State = domain.VMStateStopped
			vm.Status.Message = fmt.Sprintf("Failed to connect to node: %s", err)
			_ = s.repo.UpdateStatus(ctx, vm.ID, vm.Status)
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node daemon: %w", err))
		}

		// #region agent log
		logger.Info("DEBUG H2: Node daemon client obtained successfully",
			zap.String("node_id", vm.Status.NodeID),
		)
		// #endregion

		err = client.StartVM(ctx, vm.ID)
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
	} else {
		// #region agent log
		logger.Warn("DEBUG H4: VM has no NodeID assigned, cannot start on node daemon")
		// #endregion
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
	if vm.Status.NodeID != "" {
		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Warn("Failed to connect to node daemon for stop",
				zap.String("node_id", vm.Status.NodeID),
				zap.Error(err),
			)
			// Revert status
			vm.Status.State = domain.VMStateRunning
			vm.Status.Message = fmt.Sprintf("Failed to connect to node: %s", err)
			_ = s.repo.UpdateStatus(ctx, vm.ID, vm.Status)
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node daemon: %w", err))
		}

		var stopErr error
		if req.Msg.Force {
			stopErr = client.ForceStopVM(ctx, vm.ID)
		} else {
			stopErr = client.StopVM(ctx, vm.ID, 30) // 30 second timeout
		}
		if stopErr != nil {
			// Check if the error is because the VM doesn't exist on the node (stale state)
			// This can happen if the VM was manually deleted or crashed
			errStr := stopErr.Error()
			isNotFound := strings.Contains(errStr, "nodomain") ||
				strings.Contains(errStr, "Domain not found") ||
				strings.Contains(errStr, "VM not found")

			if isNotFound {
				logger.Warn("VM not found on node daemon, marking as stopped in control plane",
					zap.String("vm_id", vm.ID),
					zap.String("node_id", vm.Status.NodeID),
					zap.Error(stopErr),
				)
				// Continue - we'll mark it as stopped since it doesn't exist on the node
			} else {
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
		} else {
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
	if vm.Status.NodeID != "" {
		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Warn("Failed to connect to node daemon for reboot",
				zap.String("node_id", vm.Status.NodeID),
				zap.Error(err),
			)
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node daemon: %w", err))
		}

		err = client.RebootVM(ctx, vm.ID)
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
	if vm.Status.NodeID != "" {
		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Warn("Failed to connect to node daemon for pause",
				zap.String("node_id", vm.Status.NodeID),
				zap.Error(err),
			)
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node daemon: %w", err))
		}

		err = client.PauseVM(ctx, vm.ID)
		if err != nil {
			logger.Error("Failed to pause VM on node daemon", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to pause VM on node: %w", err))
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
	if vm.Status.NodeID != "" {
		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Warn("Failed to connect to node daemon for resume",
				zap.String("node_id", vm.Status.NodeID),
				zap.Error(err),
			)
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node daemon: %w", err))
		}

		err = client.ResumeVM(ctx, vm.ID)
		if err != nil {
			logger.Error("Failed to resume VM on node daemon", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to resume VM on node: %w", err))
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
// State Recovery Operations
// ============================================================================

// ResetVMState resets a VM stuck in a transitional state (STOPPING, STARTING, etc.)
// by querying the actual state from the hypervisor and updating the control plane.
// If the hypervisor is unreachable, it can force the state to STOPPED.
//
// This is an administrative operation for recovering from stuck states.
func (s *Service) ResetVMState(ctx context.Context, vmID string, forceToStopped bool) (*domain.VirtualMachine, error) {
	logger := s.logger.With(
		zap.String("method", "ResetVMState"),
		zap.String("vm_id", vmID),
		zap.Bool("force_to_stopped", forceToStopped),
	)

	logger.Info("Resetting VM state")

	if vmID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}

	// Get existing VM
	vm, err := s.repo.Get(ctx, vmID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", vmID))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	previousState := vm.Status.State
	logger.Info("Current VM state",
		zap.String("current_state", string(previousState)),
		zap.String("node_id", vm.Status.NodeID),
	)

	// If VM is assigned to a node, try to get the actual state from the hypervisor
	if vm.Status.NodeID != "" && !forceToStopped {
		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Warn("Failed to connect to node daemon, cannot query actual state",
				zap.String("node_id", vm.Status.NodeID),
				zap.Error(err),
			)
			// If we can't reach the node and force is not set, return error with guidance
			return nil, connect.NewError(connect.CodeUnavailable,
				fmt.Errorf("cannot reach node '%s' to query VM state; use force_to_stopped=true to force state to STOPPED", vm.Status.NodeID))
		}

		// Query the actual VM status from the hypervisor
		status, err := client.GetVMStatus(ctx, vmID)
		if err != nil {
			// Check if VM doesn't exist on the node
			errStr := err.Error()
			isNotFound := strings.Contains(errStr, "nodomain") ||
				strings.Contains(errStr, "Domain not found") ||
				strings.Contains(errStr, "VM not found") ||
				strings.Contains(errStr, "not found")

			if isNotFound {
				logger.Info("VM not found on hypervisor, setting state to STOPPED")
				vm.Status.State = domain.VMStateStopped
				vm.Status.Message = "VM not found on hypervisor, state reset to STOPPED"
			} else {
				logger.Error("Failed to query VM status from hypervisor", zap.Error(err))
				return nil, connect.NewError(connect.CodeInternal,
					fmt.Errorf("failed to query VM status from hypervisor: %w", err))
			}
		} else {
			// Map the hypervisor state to our domain state
			newState := mapNodePowerStateToDomain(status.State)
			logger.Info("Got actual state from hypervisor",
				zap.String("hypervisor_state", status.State.String()),
				zap.String("mapped_state", string(newState)),
			)
			vm.Status.State = newState
			vm.Status.Message = fmt.Sprintf("State reset from hypervisor (was %s)", previousState)

			// Extract guest agent info if available
			if status.GuestAgent != nil && status.GuestAgent.Connected {
				vm.Status.GuestAgent = &domain.GuestAgent{
					Installed:     true,
					Version:       status.GuestAgent.Version,
					Hostname:      status.GuestAgent.Hostname,
					OS:            status.GuestAgent.OsName,
					OSVersion:     status.GuestAgent.OsVersion,
					KernelVersion: status.GuestAgent.KernelVersion,
					IPAddresses:   status.GuestAgent.IpAddresses,
				}
				// Extract uptime from guest resource usage if available
				if status.GuestAgent.ResourceUsage != nil {
					vm.Status.GuestAgent.UptimeSeconds = status.GuestAgent.ResourceUsage.UptimeSeconds
				}
				// Update IP addresses from guest agent
				if len(status.GuestAgent.IpAddresses) > 0 {
					vm.Status.IPAddresses = status.GuestAgent.IpAddresses
				}
				logger.Debug("Updated guest agent info from hypervisor",
					zap.String("hostname", status.GuestAgent.Hostname),
					zap.String("os", status.GuestAgent.OsName),
					zap.Strings("ips", status.GuestAgent.IpAddresses),
				)
			}
		}
	} else {
		// Force to stopped (either explicitly requested or no node assigned)
		logger.Info("Forcing VM state to STOPPED",
			zap.Bool("force_requested", forceToStopped),
			zap.Bool("has_node", vm.Status.NodeID != ""),
		)
		vm.Status.State = domain.VMStateStopped
		vm.Status.Message = fmt.Sprintf("State forcefully reset to STOPPED (was %s)", previousState)
	}

	vm.UpdatedAt = time.Now()

	// Update the status in the database
	if err := s.repo.UpdateStatus(ctx, vm.ID, vm.Status); err != nil {
		logger.Error("Failed to update VM status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Fetch the updated VM
	updated, err := s.repo.Get(ctx, vmID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("VM state reset successfully",
		zap.String("previous_state", string(previousState)),
		zap.String("new_state", string(updated.Status.State)),
	)

	return updated, nil
}

// mapNodePowerStateToDomain maps a power state enum from the node daemon to a domain VMState.
func mapNodePowerStateToDomain(state nodev1.PowerState) domain.VMState {
	switch state {
	case nodev1.PowerState_POWER_STATE_RUNNING:
		return domain.VMStateRunning
	case nodev1.PowerState_POWER_STATE_STOPPED:
		return domain.VMStateStopped
	case nodev1.PowerState_POWER_STATE_PAUSED:
		return domain.VMStatePaused
	case nodev1.PowerState_POWER_STATE_SUSPENDED:
		return domain.VMStateSuspended
	case nodev1.PowerState_POWER_STATE_CRASHED:
		return domain.VMStateError
	default:
		// For unknown states, default to stopped as a safe fallback
		return domain.VMStateStopped
	}
}

// ============================================================================
// Console Operations
// ============================================================================

// GetConsole returns connection info for VNC/SPICE console.
func (s *Service) GetConsole(
	ctx context.Context,
	req *connect.Request[computev1.GetConsoleRequest],
) (*connect.Response[computev1.ConsoleInfo], error) {
	logger := s.logger.With(
		zap.String("method", "GetConsole"),
		zap.String("vm_id", req.Msg.VmId),
	)

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// VM must be running to access console
	if !vm.IsRunning() {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("VM must be running to access console, current state: '%s'", vm.Status.State))
	}

	// Get console info from node daemon
	if vm.Status.NodeID == "" {
		// Return default console info if no node assigned
		logger.Warn("VM has no node assigned, returning default console info")
		return connect.NewResponse(&computev1.ConsoleInfo{
			ConsoleType: computev1.ConsoleInfo_CONSOLE_TYPE_VNC,
			Host:        "127.0.0.1",
			Port:        5900,
		}), nil
	}

	client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
	if err != nil {
		logger.Warn("Failed to get node daemon client, falling back to mock console info",
			zap.String("node_id", vm.Status.NodeID),
			zap.Error(err))
		// Fallback for dev mode - return mock console info based on VM's console config
		vncPort := uint32(5900)
		if vm.Spec.Display != nil && vm.Spec.Display.Port > 0 {
			vncPort = uint32(vm.Spec.Display.Port)
		}
		return connect.NewResponse(&computev1.ConsoleInfo{
			ConsoleType: computev1.ConsoleInfo_CONSOLE_TYPE_VNC,
			Host:        "127.0.0.1",
			Port:        vncPort,
		}), nil
	}

	// Call node daemon to get console info
	consoleInfo, err := client.GetConsole(ctx, vm.ID)
	if err != nil {
		logger.Warn("Failed to get console info from node daemon, falling back to mock",
			zap.String("vm_id", vm.ID),
			zap.String("node_id", vm.Status.NodeID),
			zap.Error(err),
		)
		// Fallback for when node daemon RPC fails
		vncPort := uint32(5900)
		if vm.Spec.Display != nil && vm.Spec.Display.Port > 0 {
			vncPort = uint32(vm.Spec.Display.Port)
		}
		return connect.NewResponse(&computev1.ConsoleInfo{
			ConsoleType: computev1.ConsoleInfo_CONSOLE_TYPE_VNC,
			Host:        "127.0.0.1",
			Port:        vncPort,
		}), nil
	}

	// Convert console type
	consoleType := computev1.ConsoleInfo_CONSOLE_TYPE_VNC
	if consoleInfo.Type == "spice" {
		consoleType = computev1.ConsoleInfo_CONSOLE_TYPE_SPICE
	}

	logger.Info("Console info retrieved",
		zap.String("host", consoleInfo.Host),
		zap.Uint32("port", consoleInfo.Port),
	)

	return connect.NewResponse(&computev1.ConsoleInfo{
		ConsoleType: consoleType,
		Host:        consoleInfo.Host,
		Port:        consoleInfo.Port,
		Password:    consoleInfo.Password,
	}), nil
}

// ============================================================================
// Clone Operations
// ============================================================================

// CloneVM creates a copy of a virtual machine.
// Supports two clone types:
// - LINKED: Fast clone using QCOW2 backing file (copy-on-write), depends on source disk
// - FULL: Complete independent copy of all disk data, takes longer but fully independent
func (s *Service) CloneVM(
	ctx context.Context,
	req *connect.Request[computev1.CloneVMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "CloneVM"),
		zap.String("source_vm_id", req.Msg.SourceVmId),
		zap.String("new_name", req.Msg.Name),
		zap.String("clone_type", req.Msg.CloneType.String()),
	)

	logger.Info("Cloning VM")

	// Validate request
	if req.Msg.SourceVmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("source VM ID is required"))
	}
	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("new VM name is required"))
	}

	// Get source VM
	sourceVM, err := s.repo.Get(ctx, req.Msg.SourceVmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("source VM '%s' not found", req.Msg.SourceVmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Source VM must be stopped for cloning (unless we implement live cloning later)
	if sourceVM.IsRunning() {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("source VM must be stopped for cloning, current state: '%s'", sourceVM.Status.State))
	}

	// Determine target project
	projectID := req.Msg.ProjectId
	if projectID == "" {
		projectID = sourceVM.ProjectID
	}

	// Clone type determination
	isLinkedClone := req.Msg.CloneType == computev1.TemplateConfig_LINKED

	// Build new VM spec from source
	now := time.Now()
	newVM := &domain.VirtualMachine{
		Name:            req.Msg.Name,
		ProjectID:       projectID,
		Description:     fmt.Sprintf("Clone of %s", sourceVM.Name),
		Labels:          copyLabels(sourceVM.Labels),
		HardwareVersion: sourceVM.HardwareVersion,
		Spec:            cloneVMSpec(sourceVM.Spec, isLinkedClone),
		Status: domain.VMStatus{
			State:   domain.VMStateStopped,
			Message: "VM cloned successfully",
			NodeID:  sourceVM.Status.NodeID, // Clone to same node as source
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	// Add clone metadata to labels
	if newVM.Labels == nil {
		newVM.Labels = make(map[string]string)
	}
	newVM.Labels["cloned-from"] = sourceVM.ID
	newVM.Labels["clone-type"] = req.Msg.CloneType.String()

	// Note: Provisioning config (cloud-init) can be applied during VM update or first boot
	// For now, clones inherit the same base configuration as the source

	// Create VM in database
	created, err := s.repo.Create(ctx, newVM)
	if err != nil {
		if errors.Is(err, domain.ErrAlreadyExists) {
			return nil, connect.NewError(connect.CodeAlreadyExists,
				fmt.Errorf("VM with name '%s' already exists in project", req.Msg.Name))
		}
		logger.Error("Failed to create cloned VM in database", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Create clone on node daemon if source was on a node
	if sourceVM.Status.NodeID != "" && s.daemonPool != nil {
		client, err := s.getNodeDaemonClient(ctx, sourceVM.Status.NodeID)
		if err != nil {
			logger.Error("Failed to connect to node daemon for clone",
				zap.String("node_id", sourceVM.Status.NodeID),
				zap.Error(err))
			// Rollback database entry
			if delErr := s.repo.Delete(ctx, created.ID); delErr != nil {
				logger.Error("Failed to rollback cloned VM from database", zap.Error(delErr))
			}
			return nil, connect.NewError(connect.CodeUnavailable,
				fmt.Errorf("failed to connect to node daemon: %w", err))
		}

		// Build daemon create request for the clone
		daemonReq := buildCloneVMRequest(sourceVM, created, isLinkedClone)

		_, err = client.CreateVM(ctx, daemonReq)
		if err != nil {
			logger.Error("Failed to create cloned VM on node daemon",
				zap.String("vm_id", created.ID),
				zap.String("node_id", sourceVM.Status.NodeID),
				zap.Error(err))
			// Rollback database entry
			if delErr := s.repo.Delete(ctx, created.ID); delErr != nil {
				logger.Error("Failed to rollback cloned VM from database", zap.Error(delErr))
			}
			return nil, connect.NewError(connect.CodeInternal,
				fmt.Errorf("failed to create cloned VM on node: %w", err))
		}

		logger.Info("Cloned VM created on node daemon",
			zap.String("vm_id", created.ID),
			zap.String("node_id", sourceVM.Status.NodeID),
			zap.Bool("linked_clone", isLinkedClone),
		)
	}

	// Optionally start the VM after cloning
	if req.Msg.StartOnCreate && created.Status.NodeID != "" {
		logger.Info("Starting cloned VM after creation")
		// Call StartVM internally
		startReq := connect.NewRequest(&computev1.StartVMRequest{Id: created.ID})
		_, startErr := s.StartVM(ctx, startReq)
		if startErr != nil {
			logger.Warn("Failed to start cloned VM after creation",
				zap.String("vm_id", created.ID),
				zap.Error(startErr))
			// Don't fail the whole operation, just log the warning
		}
	}

	logger.Info("VM cloned successfully",
		zap.String("source_vm_id", sourceVM.ID),
		zap.String("new_vm_id", created.ID),
		zap.Bool("linked_clone", isLinkedClone),
	)

	return connect.NewResponse(ToProto(created)), nil
}

// copyLabels creates a copy of the labels map
func copyLabels(labels map[string]string) map[string]string {
	if labels == nil {
		return nil
	}
	result := make(map[string]string, len(labels))
	for k, v := range labels {
		result[k] = v
	}
	return result
}

// cloneVMSpec creates a copy of the VM spec for cloning
func cloneVMSpec(spec domain.VMSpec, isLinkedClone bool) domain.VMSpec {
	newSpec := domain.VMSpec{
		CPU:    spec.CPU,
		Memory: spec.Memory,
		Disks:  make([]domain.DiskDevice, len(spec.Disks)),
		NICs:   make([]domain.NetworkDevice, len(spec.NICs)),
	}

	// Copy disks (the actual cloning happens on the node daemon)
	for i, disk := range spec.Disks {
		newDisk := disk
		// Generate new volume ID for the clone - node daemon will create the cloned disk
		newDisk.VolumeID = ""
		newSpec.Disks[i] = newDisk
	}

	// Copy NICs (but generate new MAC addresses)
	for i, nic := range spec.NICs {
		newNIC := nic
		newNIC.MACAddress = "" // Will be auto-generated by hypervisor
		newSpec.NICs[i] = newNIC
	}

	// Copy other config
	newSpec.Display = spec.Display
	newSpec.Boot = spec.Boot

	return newSpec
}

// buildCloneVMRequest builds a CreateVMOnNodeRequest for the node daemon when cloning
func buildCloneVMRequest(sourceVM, newVM *domain.VirtualMachine, isLinkedClone bool) *nodev1.CreateVMOnNodeRequest {
	req := &nodev1.CreateVMOnNodeRequest{
		VmId:   newVM.ID,
		Name:   newVM.Name,
		Labels: newVM.Labels,
		Spec: &nodev1.VMSpec{
			CpuCores:   uint32(newVM.Spec.CPU.Cores),
			CpuSockets: uint32(newVM.Spec.CPU.Sockets),
			MemoryMib:  uint64(newVM.Spec.Memory.SizeMiB),
		},
	}

	// Build disks with clone configuration
	for i, sourceDisk := range sourceVM.Spec.Disks {
		diskSpec := &nodev1.DiskSpec{
			Id:      fmt.Sprintf("disk%d", i),
			SizeGib: uint64(sourceDisk.SizeGiB),
			Bus:     nodev1.DiskBus_DISK_BUS_VIRTIO,
			Format:  nodev1.DiskFormat_DISK_FORMAT_QCOW2,
		}

		if isLinkedClone {
			// Linked clone: use backing file (QCOW2 overlay)
			// The source disk becomes the backing file for the new disk
			diskSpec.BackingFile = sourceDisk.VolumeID // Source disk path
		} else {
			// Full clone: node daemon will copy the disk
			// Set backing file to source, and let daemon do a full copy
			diskSpec.BackingFile = sourceDisk.VolumeID
		}

		req.Spec.Disks = append(req.Spec.Disks, diskSpec)
	}

	// Build NICs (MAC addresses will be auto-generated)
	for _, nic := range newVM.Spec.NICs {
		req.Spec.Nics = append(req.Spec.Nics, &nodev1.NicSpec{
			Network: nic.NetworkID,
			Model:   nodev1.NicModel_NIC_MODEL_VIRTIO,
			// MACAddress left empty - will be auto-generated
		})
	}

	// Copy display config if present
	if newVM.Spec.Display != nil {
		req.Spec.Console = &nodev1.ConsoleSpec{
			VncEnabled: newVM.Spec.Display.Type == "VNC",
		}
	}

	return req
}

// ============================================================================
// Live Metrics Enrichment
// ============================================================================

// enrichVMsWithLiveMetrics fetches live metrics from node daemons for running VMs.
// This is called during ListVMs to provide real-time resource usage data.
func (s *Service) enrichVMsWithLiveMetrics(ctx context.Context, vms []*domain.VirtualMachine, logger *zap.Logger) {
	if s.daemonPool == nil {
		return
	}

	// Group VMs by node for efficient batching
	vmsByNode := make(map[string][]*domain.VirtualMachine)
	for _, vm := range vms {
		if vm.IsRunning() && vm.Status.NodeID != "" {
			vmsByNode[vm.Status.NodeID] = append(vmsByNode[vm.Status.NodeID], vm)
		}
	}

	// Fetch metrics from each node
	for nodeID, nodeVMs := range vmsByNode {
		client, err := s.getNodeDaemonClient(ctx, nodeID)
		if err != nil {
			logger.Debug("Failed to connect to node daemon for metrics",
				zap.String("node_id", nodeID),
				zap.Error(err),
			)
			continue
		}

		// Fetch metrics for each VM on this node
		for _, vm := range nodeVMs {
			s.fetchAndApplyVMMetrics(ctx, client, vm, logger)
		}
	}
}

// enrichVMWithLiveMetrics fetches live metrics from the node daemon for a single VM.
// This is called during GetVM to provide real-time resource usage data.
func (s *Service) enrichVMWithLiveMetrics(ctx context.Context, vm *domain.VirtualMachine, logger *zap.Logger) {
	if s.daemonPool == nil || vm.Status.NodeID == "" {
		return
	}

	client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
	if err != nil {
		logger.Debug("Failed to connect to node daemon for metrics",
			zap.String("vm_id", vm.ID),
			zap.String("node_id", vm.Status.NodeID),
			zap.Error(err),
		)
		return
	}

	s.fetchAndApplyVMMetrics(ctx, client, vm, logger)
}

// fetchAndApplyVMMetrics fetches VM status from node daemon and applies it to the VM.
func (s *Service) fetchAndApplyVMMetrics(ctx context.Context, client *node.DaemonClient, vm *domain.VirtualMachine, logger *zap.Logger) {
	status, err := client.GetVMStatus(ctx, vm.ID)
	if err != nil {
		// Log but don't fail - we still have DB data
		logger.Debug("Failed to fetch VM metrics from node",
			zap.String("vm_id", vm.ID),
			zap.Error(err),
		)
		return
	}

	// Apply resource usage metrics
	if status.ResourceUsage != nil {
		vm.Status.Resources = domain.ResourceUsage{
			CPUPercent:    status.ResourceUsage.CpuUsagePercent,
			MemoryUsedMiB: int64(status.ResourceUsage.MemoryUsedBytes / (1024 * 1024)),
			DiskReadBps:   int64(status.ResourceUsage.DiskReadBytes),
			DiskWriteBps:  int64(status.ResourceUsage.DiskWriteBytes),
			NetworkRxBps:  int64(status.ResourceUsage.NetworkRxBytes),
			NetworkTxBps:  int64(status.ResourceUsage.NetworkTxBytes),
		}
	}

	// Apply guest agent info if available
	if status.GuestAgent != nil && status.GuestAgent.Connected {
		vm.Status.GuestAgent = &domain.GuestAgent{
			Installed:     true,
			Version:       status.GuestAgent.Version,
			Hostname:      status.GuestAgent.Hostname,
			OS:            status.GuestAgent.OsName,
			OSVersion:     status.GuestAgent.OsVersion,
			KernelVersion: status.GuestAgent.KernelVersion,
			IPAddresses:   status.GuestAgent.IpAddresses,
		}

		// Extract uptime from guest resource usage if available
		if status.GuestAgent.ResourceUsage != nil {
			vm.Status.GuestAgent.UptimeSeconds = status.GuestAgent.ResourceUsage.UptimeSeconds
		}

		// Update IP addresses from guest agent
		if len(status.GuestAgent.IpAddresses) > 0 {
			vm.Status.IPAddresses = status.GuestAgent.IpAddresses
		}
	}

	logger.Debug("Applied live metrics to VM",
		zap.String("vm_id", vm.ID),
		zap.Float64("cpu_percent", vm.Status.Resources.CPUPercent),
		zap.Int64("memory_used_mib", vm.Status.Resources.MemoryUsedMiB),
	)
}

// ============================================================================
// Helper Functions
// ============================================================================

// getNodeDaemonClient gets or creates a connection to the node daemon for a given node.
// It first tries to get an existing client, then attempts to connect if not found.
func (s *Service) getNodeDaemonClient(ctx context.Context, nodeID string) (*node.DaemonClient, error) {
	// #region agent log
	s.logger.Info("DEBUG H5: getNodeDaemonClient called",
		zap.String("node_id", nodeID),
		zap.Bool("daemon_pool_nil", s.daemonPool == nil),
	)
	// #endregion

	if s.daemonPool == nil {
		return nil, fmt.Errorf("daemon pool not available")
	}

	// Try to get existing client first
	client := s.daemonPool.Get(nodeID)
	// #region agent log
	s.logger.Info("DEBUG H5: DaemonPool.Get result",
		zap.String("node_id", nodeID),
		zap.Bool("client_found", client != nil),
		zap.Strings("connected_nodes", s.daemonPool.ConnectedNodes()),
	)
	// #endregion
	if client != nil {
		return client, nil
	}

	// Need to connect - get node info for the address
	nodeInfo, err := s.nodeRepo.Get(ctx, nodeID)
	if err != nil {
		// #region agent log
		s.logger.Error("DEBUG H5: Failed to get node info for daemon connection",
			zap.String("node_id", nodeID),
			zap.Error(err),
		)
		// #endregion
		return nil, fmt.Errorf("failed to get node info: %w", err)
	}

	// Strip CIDR notation if present (e.g., "192.168.0.53/32" -> "192.168.0.53")
	daemonAddr := nodeInfo.ManagementIP
	if idx := strings.Index(daemonAddr, "/"); idx != -1 {
		daemonAddr = daemonAddr[:idx]
	}
	// Ensure port is included
	if !strings.Contains(daemonAddr, ":") {
		daemonAddr = daemonAddr + ":9090"
	}

	// #region agent log
	s.logger.Info("DEBUG H5: Attempting to connect to node daemon",
		zap.String("node_id", nodeID),
		zap.String("management_ip", nodeInfo.ManagementIP),
		zap.String("daemon_addr", daemonAddr),
	)
	// #endregion

	// Connect to the node daemon
	client, err = s.daemonPool.Connect(nodeID, daemonAddr)
	if err != nil {
		// #region agent log
		s.logger.Error("DEBUG H5: Failed to connect to node daemon",
			zap.String("node_id", nodeID),
			zap.String("management_ip", nodeInfo.ManagementIP),
			zap.Error(err),
		)
		// #endregion
		return nil, fmt.Errorf("failed to connect to node daemon at %s: %w", daemonAddr, err)
	}

	return client, nil
}

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
			CpuMode:           spec.GetCpu().GetModel(), // Pass CPU mode (host-model, host-passthrough)
			MemoryMib:         spec.GetMemory().GetSizeMib(),
			MemoryHugepages:   hugepagesEnabled,
		},
	}

	// Convert disks - include backing file for cloud images
	for i, disk := range spec.GetDisks() {
		diskSpec := &nodev1.DiskSpec{
			Id:          disk.GetId(),
			Path:        disk.GetVolumeId(), // Use volume_id as path
			SizeGib:     disk.GetSizeGib(),
			Bus:         nodev1.DiskBus(disk.GetBus()),
			Format:      nodev1.DiskFormat_DISK_FORMAT_QCOW2, // Default to qcow2
			Readonly:    disk.GetReadonly(),
			Bootable:    disk.GetBootIndex() > 0, // bootable if boot_index > 0
			BackingFile: disk.GetBackingFile(),   // Cloud image path for copy-on-write
			PoolId:      disk.GetStoragePoolId(), // Storage pool to create disk in
		}

		// DEBUG: Log what we're sending to the node daemon
		zap.L().Info("DEBUG: Sending disk to node daemon",
			zap.Int("disk_index", i),
			zap.String("disk_id", diskSpec.Id),
			zap.String("pool_id", diskSpec.PoolId),
			zap.Uint64("size_gib", diskSpec.SizeGib),
			zap.String("backing_file", diskSpec.BackingFile),
			zap.String("path", diskSpec.Path),
		)

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

	// Convert CD-ROMs
	for _, cdrom := range spec.GetCdroms() {
		req.Spec.Cdroms = append(req.Spec.Cdroms, &nodev1.CdromSpec{
			Id:       cdrom.GetId(),
			IsoPath:  cdrom.GetIsoPath(),
			Bootable: cdrom.GetBootIndex() > 0,
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

	// Convert Guest OS profile - determines hardware configuration (timers, CPU mode, video)
	// This maps the proto GuestOSFamily enum to the Node Daemon string format
	if spec.GetGuestOs() != nil {
		guestOSFamily := spec.GetGuestOs().GetFamily()
		var guestOSStr string
		switch guestOSFamily {
		case computev1.GuestOSFamily_GUEST_OS_FAMILY_RHEL:
			guestOSStr = "rhel"
		case computev1.GuestOSFamily_GUEST_OS_FAMILY_DEBIAN:
			guestOSStr = "debian"
		case computev1.GuestOSFamily_GUEST_OS_FAMILY_FEDORA:
			guestOSStr = "fedora"
		case computev1.GuestOSFamily_GUEST_OS_FAMILY_SUSE:
			guestOSStr = "suse"
		case computev1.GuestOSFamily_GUEST_OS_FAMILY_ARCH:
			guestOSStr = "arch"
		case computev1.GuestOSFamily_GUEST_OS_FAMILY_WINDOWS_SERVER:
			guestOSStr = "windows_server"
		case computev1.GuestOSFamily_GUEST_OS_FAMILY_WINDOWS_DESKTOP:
			guestOSStr = "windows_desktop"
		case computev1.GuestOSFamily_GUEST_OS_FAMILY_WINDOWS_LEGACY:
			guestOSStr = "windows_legacy"
		case computev1.GuestOSFamily_GUEST_OS_FAMILY_FREEBSD:
			guestOSStr = "freebsd"
		case computev1.GuestOSFamily_GUEST_OS_FAMILY_GENERIC_LINUX:
			guestOSStr = "generic_linux"
		default:
			guestOSStr = "" // Let node daemon use default
		}
		if guestOSStr != "" {
			req.Spec.GuestOs = guestOSStr
			zap.L().Info("Setting Guest OS profile",
				zap.String("vm_id", vm.ID),
				zap.String("guest_os", guestOSStr),
			)
		}
	}

	return req
}

// ============================================================================
// Snapshot Operations
// ============================================================================

// CreateSnapshot creates a point-in-time snapshot of a VM.
func (s *Service) CreateSnapshot(
	ctx context.Context,
	req *connect.Request[computev1.CreateSnapshotRequest],
) (*connect.Response[computev1.Snapshot], error) {
	logger := s.logger.With(
		zap.String("method", "CreateSnapshot"),
		zap.String("vm_id", req.Msg.VmId),
		zap.String("name", req.Msg.Name),
	)

	logger.Info("Creating snapshot")

	// Validate request
	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}
	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("snapshot name is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Create snapshot on Node Daemon
	if vm.Status.NodeID == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("VM is not assigned to a node"))
	}

	client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
	if err != nil {
		logger.Error("Failed to connect to node daemon", zap.Error(err))
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node: %w", err))
	}

	// diskOnly is the inverse of includeMemory
	// When includeMemory=false (default), we use disk-only snapshots which work with any CPU config
	// When includeMemory=true, we use external snapshots with --live flag (VMware-like)
	diskOnly := !req.Msg.IncludeMemory

	logger.Info("Creating snapshot on node daemon",
		zap.Bool("include_memory", req.Msg.IncludeMemory),
		zap.Bool("disk_only", diskOnly),
		zap.Bool("quiesce", req.Msg.Quiesce),
	)

	resp, err := client.CreateSnapshot(ctx, req.Msg.VmId, req.Msg.Name, req.Msg.Description, req.Msg.Quiesce, diskOnly)
	if err != nil {
		logger.Error("Failed to create snapshot on node daemon", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create snapshot: %w", err))
	}

	// Build response
	snapshot := &domain.Snapshot{
		ID:             resp.SnapshotId,
		VMID:           req.Msg.VmId,
		Name:           resp.Name,
		Description:    resp.Description,
		ParentID:       resp.ParentId,
		MemoryIncluded: req.Msg.IncludeMemory,
		Quiesced:       req.Msg.Quiesce,
		SizeBytes:      0, // Size is calculated by the hypervisor
		CreatedAt:      time.Now(),
	}

	// Persist snapshot to database for consistency
	if s.snapshotRepo != nil {
		if err := s.snapshotRepo.Create(ctx, snapshot, &vm.Spec); err != nil {
			logger.Warn("Failed to persist snapshot to database (snapshot exists on hypervisor)",
				zap.String("snapshot_id", snapshot.ID),
				zap.Error(err),
			)
			// Don't fail the request - snapshot was created on hypervisor
		} else {
			logger.Debug("Snapshot persisted to database", zap.String("snapshot_id", snapshot.ID))
		}
	}

	// Record event
	s.recordVMEvent(ctx, vm.ID, "snapshot", "info", fmt.Sprintf("Snapshot '%s' created", snapshot.Name), "")

	logger.Info("Snapshot created successfully",
		zap.String("snapshot_id", snapshot.ID),
	)

	return connect.NewResponse(SnapshotToProto(snapshot)), nil
}

// ListSnapshots returns all snapshots for a VM.
func (s *Service) ListSnapshots(
	ctx context.Context,
	req *connect.Request[computev1.ListSnapshotsRequest],
) (*connect.Response[computev1.ListSnapshotsResponse], error) {
	logger := s.logger.With(
		zap.String("method", "ListSnapshots"),
		zap.String("vm_id", req.Msg.VmId),
	)

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// If VM has no node, return empty list
	if vm.Status.NodeID == "" {
		logger.Debug("VM has no node assigned, returning empty snapshot list")
		return connect.NewResponse(&computev1.ListSnapshotsResponse{
			Snapshots: []*computev1.Snapshot{},
		}), nil
	}

	// Get snapshots from Node Daemon
	client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
	if err != nil {
		logger.Warn("Failed to connect to node daemon, returning empty list", zap.Error(err))
		return connect.NewResponse(&computev1.ListSnapshotsResponse{
			Snapshots: []*computev1.Snapshot{},
		}), nil
	}

	resp, err := client.ListSnapshots(ctx, req.Msg.VmId)
	if err != nil {
		logger.Warn("Failed to list snapshots from node daemon", zap.Error(err))
		return connect.NewResponse(&computev1.ListSnapshotsResponse{
			Snapshots: []*computev1.Snapshot{},
		}), nil
	}

	// Convert to domain snapshots and proto
	var domainSnapshots []*domain.Snapshot
	var snapshots []*computev1.Snapshot
	for _, snap := range resp.Snapshots {
		domainSnap := &domain.Snapshot{
			ID:             snap.SnapshotId,
			VMID:           req.Msg.VmId,
			Name:           snap.Name,
			Description:    snap.Description,
			ParentID:       snap.ParentId,
			MemoryIncluded: false, // TODO: Add to node daemon proto
			Quiesced:       false,
			SizeBytes:      0, // Size calculated by hypervisor
		}
		if snap.CreatedAt != nil {
			domainSnap.CreatedAt = snap.CreatedAt.AsTime()
		}
		domainSnapshots = append(domainSnapshots, domainSnap)
		snapshots = append(snapshots, SnapshotToProto(domainSnap))
	}

	// Sync snapshots to database for consistency
	if s.snapshotRepo != nil {
		if err := s.snapshotRepo.SyncFromHypervisor(ctx, req.Msg.VmId, domainSnapshots); err != nil {
			logger.Warn("Failed to sync snapshots to database", zap.Error(err))
			// Don't fail - we still have the list from hypervisor
		}
	}

	logger.Debug("Listed snapshots", zap.Int("count", len(snapshots)))

	return connect.NewResponse(&computev1.ListSnapshotsResponse{
		Snapshots: snapshots,
	}), nil
}

// RevertToSnapshot reverts a VM to a previous snapshot state.
func (s *Service) RevertToSnapshot(
	ctx context.Context,
	req *connect.Request[computev1.RevertToSnapshotRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "RevertToSnapshot"),
		zap.String("vm_id", req.Msg.VmId),
		zap.String("snapshot_id", req.Msg.SnapshotId),
	)

	logger.Info("Reverting to snapshot")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}
	if req.Msg.SnapshotId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("snapshot ID is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Check if VM is in a valid state for revert
	// For disk-only snapshots, VM must be stopped
	// For memory snapshots, VM can be in any state (it will be restored)
	if vm.IsRunning() {
		// For now, require VM to be stopped for safety
		// TODO: Check if snapshot includes memory and allow if so
		logger.Warn("VM is running, revert may fail for disk-only snapshots")
	}

	if vm.Status.NodeID == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("VM is not assigned to a node"))
	}

	// Revert on Node Daemon
	client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
	if err != nil {
		logger.Error("Failed to connect to node daemon", zap.Error(err))
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node: %w", err))
	}

	err = client.RevertSnapshot(ctx, req.Msg.VmId, req.Msg.SnapshotId)
	if err != nil {
		logger.Error("Failed to revert snapshot on node daemon", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to revert snapshot: %w", err))
	}

	// Update VM status
	vm.Status.Message = fmt.Sprintf("Reverted to snapshot %s", req.Msg.SnapshotId)
	vm.UpdatedAt = time.Now()
	_ = s.repo.UpdateStatus(ctx, vm.ID, vm.Status)

	// Optionally start VM after revert
	if req.Msg.StartAfterRevert && !vm.IsRunning() {
		logger.Info("Starting VM after snapshot revert")
		// Use StartVM logic
		if startErr := client.StartVM(ctx, vm.ID); startErr != nil {
			logger.Warn("Failed to start VM after revert", zap.Error(startErr))
		} else {
			vm.Status.State = domain.VMStateRunning
			vm.Status.Message = "VM started after snapshot revert"
			_ = s.repo.UpdateStatus(ctx, vm.ID, vm.Status)
		}
	}

	// Fetch updated VM
	updated, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Snapshot reverted successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// DeleteSnapshot removes a snapshot from a VM.
func (s *Service) DeleteSnapshot(
	ctx context.Context,
	req *connect.Request[computev1.DeleteSnapshotRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeleteSnapshot"),
		zap.String("vm_id", req.Msg.VmId),
		zap.String("snapshot_id", req.Msg.SnapshotId),
	)

	logger.Info("Deleting snapshot")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}
	if req.Msg.SnapshotId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("snapshot ID is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if vm.Status.NodeID == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("VM is not assigned to a node"))
	}

	// Delete on Node Daemon
	client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
	if err != nil {
		logger.Error("Failed to connect to node daemon", zap.Error(err))
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node: %w", err))
	}

	err = client.DeleteSnapshot(ctx, req.Msg.VmId, req.Msg.SnapshotId)
	if err != nil {
		logger.Error("Failed to delete snapshot on node daemon", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to delete snapshot: %w", err))
	}

	// Delete from database
	if s.snapshotRepo != nil {
		if err := s.snapshotRepo.Delete(ctx, req.Msg.SnapshotId); err != nil {
			logger.Warn("Failed to delete snapshot from database (deleted from hypervisor)",
				zap.String("snapshot_id", req.Msg.SnapshotId),
				zap.Error(err),
			)
			// Don't fail - snapshot was deleted from hypervisor
		}
	}

	// Record event
	s.recordVMEvent(ctx, vm.ID, "snapshot", "info", "Snapshot deleted", "")

	logger.Info("Snapshot deleted successfully")

	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ============================================================================
// Hot-Plug Operations (Disk/NIC)
// ============================================================================

// AttachDisk attaches a new disk to a VM.
func (s *Service) AttachDisk(
	ctx context.Context,
	req *connect.Request[computev1.AttachDiskRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "AttachDisk"),
		zap.String("vm_id", req.Msg.VmId),
	)

	logger.Info("Attaching disk to VM")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}
	if req.Msg.Disk == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("disk specification is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert proto disk to domain disk
	diskName := generateDiskID()
	newDisk := domain.DiskDevice{
		Name:    diskName,
		SizeGiB: int64(req.Msg.Disk.SizeGib),
		Bus:     strings.ToLower(req.Msg.Disk.Bus.String()),
		Cache:   "writeback",
	}

	// Add to VM spec
	vm.Spec.Disks = append(vm.Spec.Disks, newDisk)

	// If VM is running, hot-plug the disk
	if vm.Status.State == domain.VMStateRunning && vm.Status.NodeID != "" {
		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Error("Failed to connect to node daemon", zap.Error(err))
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node: %w", err))
		}

		// Map bus type to proto enum
		busType := nodev1.DiskBus_DISK_BUS_VIRTIO
		switch strings.ToUpper(newDisk.Bus) {
		case "SCSI":
			busType = nodev1.DiskBus_DISK_BUS_SCSI
		case "SATA":
			busType = nodev1.DiskBus_DISK_BUS_SATA
		case "IDE":
			busType = nodev1.DiskBus_DISK_BUS_IDE
		}

		err = client.AttachDisk(ctx, req.Msg.VmId, &nodev1.DiskSpec{
			Id:      diskName,
			SizeGib: uint64(newDisk.SizeGiB),
			Bus:     busType,
		})
		if err != nil {
			logger.Error("Failed to hot-plug disk", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to attach disk: %w", err))
		}
	}

	// Update VM in database
	updated, err := s.repo.Update(ctx, vm)
	if err != nil {
		logger.Error("Failed to update VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Record event
	s.recordVMEvent(ctx, vm.ID, "disk", "info", fmt.Sprintf("Disk %s (%d GiB) attached", diskName, newDisk.SizeGiB), "")

	logger.Info("Disk attached successfully", zap.String("disk_name", diskName))

	return connect.NewResponse(ToProto(updated)), nil
}

// DetachDisk removes a disk from a VM.
func (s *Service) DetachDisk(
	ctx context.Context,
	req *connect.Request[computev1.DetachDiskRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "DetachDisk"),
		zap.String("vm_id", req.Msg.VmId),
		zap.String("disk_id", req.Msg.DiskId),
	)

	logger.Info("Detaching disk from VM")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}
	if req.Msg.DiskId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("disk ID is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Find and remove the disk
	found := false
	var removedDisk domain.DiskDevice
	newDisks := make([]domain.DiskDevice, 0, len(vm.Spec.Disks))
	for i, disk := range vm.Spec.Disks {
		if disk.Name == req.Msg.DiskId {
			// Cannot detach boot disk
			if i == 0 {
				return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("cannot detach boot disk"))
			}
			found = true
			removedDisk = disk
		} else {
			newDisks = append(newDisks, disk)
		}
	}

	if !found {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("disk '%s' not found", req.Msg.DiskId))
	}

	vm.Spec.Disks = newDisks

	// If VM is running, hot-unplug the disk
	if vm.Status.State == domain.VMStateRunning && vm.Status.NodeID != "" {
		if !req.Msg.Force {
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("VM is running; use force=true to hot-unplug"))
		}

		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Error("Failed to connect to node daemon", zap.Error(err))
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node: %w", err))
		}

		err = client.DetachDisk(ctx, req.Msg.VmId, req.Msg.DiskId)
		if err != nil {
			logger.Error("Failed to hot-unplug disk", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to detach disk: %w", err))
		}
	}

	// Update VM in database
	updated, err := s.repo.Update(ctx, vm)
	if err != nil {
		logger.Error("Failed to update VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Record event
	s.recordVMEvent(ctx, vm.ID, "disk", "info", fmt.Sprintf("Disk %s (%d GiB) detached", removedDisk.Name, removedDisk.SizeGiB), "")

	logger.Info("Disk detached successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// ResizeDisk expands a disk attached to a VM.
func (s *Service) ResizeDisk(
	ctx context.Context,
	req *connect.Request[computev1.ResizeDiskRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "ResizeDisk"),
		zap.String("vm_id", req.Msg.VmId),
		zap.String("disk_id", req.Msg.DiskId),
		zap.Uint64("new_size_gib", req.Msg.NewSizeGib),
	)

	logger.Info("Resizing disk")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}
	if req.Msg.DiskId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("disk ID is required"))
	}
	if req.Msg.NewSizeGib == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("new size is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Find the disk
	found := false
	var oldSize int64
	for i, disk := range vm.Spec.Disks {
		if disk.Name == req.Msg.DiskId {
			if int64(req.Msg.NewSizeGib) <= disk.SizeGiB {
				return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("new size must be larger than current size"))
			}
			oldSize = disk.SizeGiB
			vm.Spec.Disks[i].SizeGiB = int64(req.Msg.NewSizeGib)
			found = true
			break
		}
	}

	if !found {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("disk '%s' not found", req.Msg.DiskId))
	}

	// Resize on node daemon if VM has a volume ID
	if vm.Status.NodeID != "" {
		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Error("Failed to connect to node daemon", zap.Error(err))
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node: %w", err))
		}

		// Resize the volume (convert GiB to bytes)
		err = client.ResizeVolume(ctx, "default", req.Msg.DiskId, req.Msg.NewSizeGib*1024*1024*1024)
		if err != nil {
			logger.Error("Failed to resize volume on node", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to resize volume: %w", err))
		}
	}

	// Update VM in database
	updated, err := s.repo.Update(ctx, vm)
	if err != nil {
		logger.Error("Failed to update VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Record event
	s.recordVMEvent(ctx, vm.ID, "config", "info", fmt.Sprintf("Disk %s resized from %d GiB to %d GiB", req.Msg.DiskId, oldSize, req.Msg.NewSizeGib), "")

	logger.Info("Disk resized successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// AttachNIC attaches a new network interface to a VM.
func (s *Service) AttachNIC(
	ctx context.Context,
	req *connect.Request[computev1.AttachNICRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "AttachNIC"),
		zap.String("vm_id", req.Msg.VmId),
	)

	logger.Info("Attaching NIC to VM")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}
	if req.Msg.Nic == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("NIC specification is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert proto NIC to domain NIC
	nicName := generateNICID()
	macAddr := req.Msg.Nic.MacAddress
	if macAddr == "" {
		macAddr = generateMACAddress()
	}

	newNIC := domain.NetworkDevice{
		Name:       nicName,
		NetworkID:  req.Msg.Nic.NetworkId,
		MACAddress: macAddr,
	}

	// Add to VM spec
	vm.Spec.NICs = append(vm.Spec.NICs, newNIC)

	// If VM is running, hot-plug the NIC
	if vm.Status.State == domain.VMStateRunning && vm.Status.NodeID != "" {
		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Error("Failed to connect to node daemon", zap.Error(err))
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node: %w", err))
		}

		// Map model to proto enum
		nicModel := nodev1.NicModel_NIC_MODEL_VIRTIO
		switch req.Msg.Nic.Model.String() {
		case "E1000", "NIC_MODEL_E1000":
			nicModel = nodev1.NicModel_NIC_MODEL_E1000
		case "RTL8139", "NIC_MODEL_RTL8139":
			nicModel = nodev1.NicModel_NIC_MODEL_RTL8139
		}

		err = client.AttachNIC(ctx, req.Msg.VmId, &nodev1.NicSpec{
			Id:         nicName,
			Network:    newNIC.NetworkID,
			MacAddress: macAddr,
			Model:      nicModel,
		})
		if err != nil {
			logger.Error("Failed to hot-plug NIC", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to attach NIC: %w", err))
		}
	}

	// Update VM in database
	updated, err := s.repo.Update(ctx, vm)
	if err != nil {
		logger.Error("Failed to update VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Record event
	s.recordVMEvent(ctx, vm.ID, "network", "info", fmt.Sprintf("NIC %s attached to network %s", nicName, newNIC.NetworkID), "")

	logger.Info("NIC attached successfully", zap.String("nic_name", nicName))

	return connect.NewResponse(ToProto(updated)), nil
}

// DetachNIC removes a network interface from a VM.
func (s *Service) DetachNIC(
	ctx context.Context,
	req *connect.Request[computev1.DetachNICRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "DetachNIC"),
		zap.String("vm_id", req.Msg.VmId),
		zap.String("nic_id", req.Msg.NicId),
	)

	logger.Info("Detaching NIC from VM")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}
	if req.Msg.NicId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("NIC ID is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Find and remove the NIC
	found := false
	var removedNIC domain.NetworkDevice
	newNICs := make([]domain.NetworkDevice, 0, len(vm.Spec.NICs))
	for i, nic := range vm.Spec.NICs {
		if nic.Name == req.Msg.NicId {
			// Cannot detach primary NIC
			if i == 0 {
				return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("cannot detach primary NIC"))
			}
			found = true
			removedNIC = nic
		} else {
			newNICs = append(newNICs, nic)
		}
	}

	if !found {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("NIC '%s' not found", req.Msg.NicId))
	}

	vm.Spec.NICs = newNICs

	// If VM is running, hot-unplug the NIC
	if vm.Status.State == domain.VMStateRunning && vm.Status.NodeID != "" {
		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Error("Failed to connect to node daemon", zap.Error(err))
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node: %w", err))
		}

		err = client.DetachNIC(ctx, req.Msg.VmId, req.Msg.NicId)
		if err != nil {
			logger.Error("Failed to hot-unplug NIC", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to detach NIC: %w", err))
		}
	}

	// Update VM in database
	updated, err := s.repo.Update(ctx, vm)
	if err != nil {
		logger.Error("Failed to update VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Record event
	s.recordVMEvent(ctx, vm.ID, "network", "info", fmt.Sprintf("NIC %s detached from network %s", removedNIC.Name, removedNIC.NetworkID), "")

	logger.Info("NIC detached successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// ============================================================================
// CD-ROM Operations
// ============================================================================

// AttachCDROM adds a CD-ROM device to a VM.
func (s *Service) AttachCDROM(
	ctx context.Context,
	req *connect.Request[computev1.AttachCDROMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "AttachCDROM"),
		zap.String("vm_id", req.Msg.VmId),
	)

	logger.Info("Attaching CD-ROM to VM")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Create new CD-ROM device
	cdromName := generateCDROMID()
	newCDROM := domain.CDROMDevice{
		Name:      cdromName,
		ISO:       req.Msg.IsoPath,
		Connected: req.Msg.IsoPath != "",
	}

	// Add to VM spec
	vm.Spec.Cdroms = append(vm.Spec.Cdroms, newCDROM)

	// Update VM in database
	updated, err := s.repo.Update(ctx, vm)
	if err != nil {
		logger.Error("Failed to update VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Record event
	eventMsg := fmt.Sprintf("CD-ROM device %s added", cdromName)
	if req.Msg.IsoPath != "" {
		eventMsg = fmt.Sprintf("CD-ROM device %s added with ISO %s", cdromName, req.Msg.IsoPath)
	}
	s.recordVMEvent(ctx, vm.ID, "config", "info", eventMsg, "")

	logger.Info("CD-ROM attached successfully", zap.String("cdrom_name", cdromName))

	return connect.NewResponse(ToProto(updated)), nil
}

// DetachCDROM removes a CD-ROM device from a VM.
func (s *Service) DetachCDROM(
	ctx context.Context,
	req *connect.Request[computev1.DetachCDROMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "DetachCDROM"),
		zap.String("vm_id", req.Msg.VmId),
		zap.String("cdrom_id", req.Msg.CdromId),
	)

	logger.Info("Detaching CD-ROM from VM")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}
	if req.Msg.CdromId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("CD-ROM ID is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Find and remove the CD-ROM
	found := false
	newCDROMs := make([]domain.CDROMDevice, 0, len(vm.Spec.Cdroms))
	for _, cdrom := range vm.Spec.Cdroms {
		if cdrom.Name == req.Msg.CdromId {
			found = true
		} else {
			newCDROMs = append(newCDROMs, cdrom)
		}
	}

	if !found {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("CD-ROM '%s' not found", req.Msg.CdromId))
	}

	vm.Spec.Cdroms = newCDROMs

	// Update VM in database
	updated, err := s.repo.Update(ctx, vm)
	if err != nil {
		logger.Error("Failed to update VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Record event
	s.recordVMEvent(ctx, vm.ID, "config", "info", fmt.Sprintf("CD-ROM device %s removed", req.Msg.CdromId), "")

	logger.Info("CD-ROM detached successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// MountISO mounts an ISO file to an existing CD-ROM device.
func (s *Service) MountISO(
	ctx context.Context,
	req *connect.Request[computev1.MountISORequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "MountISO"),
		zap.String("vm_id", req.Msg.VmId),
		zap.String("cdrom_id", req.Msg.CdromId),
		zap.String("iso_path", req.Msg.IsoPath),
	)

	logger.Info("Mounting ISO to CD-ROM")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}
	if req.Msg.CdromId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("CD-ROM ID is required"))
	}
	if req.Msg.IsoPath == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("ISO path is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Find the CD-ROM and update it
	found := false
	cdromIndex := -1
	for i, cdrom := range vm.Spec.Cdroms {
		if cdrom.Name == req.Msg.CdromId {
			vm.Spec.Cdroms[i].ISO = req.Msg.IsoPath
			vm.Spec.Cdroms[i].Connected = true
			found = true
			cdromIndex = i
			break
		}
	}

	if !found {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("CD-ROM '%s' not found", req.Msg.CdromId))
	}

	// If VM is running, change the media on the hypervisor
	if vm.Status.State == domain.VMStateRunning && vm.Status.NodeID != "" {
		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Error("Failed to connect to node daemon", zap.Error(err))
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node: %w", err))
		}

		// Calculate the device name: CD-ROM devices come after disks on SATA bus
		// Device naming: sda, sdb, sdc... where CD-ROMs start after the last disk
		// e.g., 1 disk = sda for disk, sdb for first CD-ROM
		diskCount := len(vm.Spec.Disks)
		device := fmt.Sprintf("sd%c", 'a'+diskCount+cdromIndex)
		logger.Info("Calculated CD-ROM device name", zap.String("device", device), zap.Int("disk_count", diskCount), zap.Int("cdrom_index", cdromIndex))

		err = client.ChangeMedia(ctx, req.Msg.VmId, device, req.Msg.IsoPath)
		if err != nil {
			logger.Error("Failed to mount ISO on hypervisor", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to mount ISO: %w", err))
		}
	}

	// Update VM in database
	updated, err := s.repo.Update(ctx, vm)
	if err != nil {
		logger.Error("Failed to update VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Record event
	s.recordVMEvent(ctx, vm.ID, "config", "info", fmt.Sprintf("ISO %s mounted to CD-ROM %s", req.Msg.IsoPath, req.Msg.CdromId), "")

	logger.Info("ISO mounted successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// EjectISO ejects the ISO from a CD-ROM device.
func (s *Service) EjectISO(
	ctx context.Context,
	req *connect.Request[computev1.EjectISORequest],
) (*connect.Response[computev1.VirtualMachine], error) {
	logger := s.logger.With(
		zap.String("method", "EjectISO"),
		zap.String("vm_id", req.Msg.VmId),
		zap.String("cdrom_id", req.Msg.CdromId),
	)

	logger.Info("Ejecting ISO from CD-ROM")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}
	if req.Msg.CdromId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("CD-ROM ID is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Find the CD-ROM and eject it
	found := false
	cdromIndex := -1
	var oldISO string
	for i, cdrom := range vm.Spec.Cdroms {
		if cdrom.Name == req.Msg.CdromId {
			oldISO = cdrom.ISO
			vm.Spec.Cdroms[i].ISO = ""
			vm.Spec.Cdroms[i].Connected = false
			found = true
			cdromIndex = i
			break
		}
	}

	if !found {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("CD-ROM '%s' not found", req.Msg.CdromId))
	}

	// If VM is running, eject the media on the hypervisor
	if vm.Status.State == domain.VMStateRunning && vm.Status.NodeID != "" {
		client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
		if err != nil {
			logger.Error("Failed to connect to node daemon", zap.Error(err))
			return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to connect to node: %w", err))
		}

		// Calculate the device name: CD-ROM devices come after disks on SATA bus
		diskCount := len(vm.Spec.Disks)
		device := fmt.Sprintf("sd%c", 'a'+diskCount+cdromIndex)
		logger.Info("Calculated CD-ROM device name for eject", zap.String("device", device), zap.Int("disk_count", diskCount), zap.Int("cdrom_index", cdromIndex))

		err = client.ChangeMedia(ctx, req.Msg.VmId, device, "") // Empty path = eject
		if err != nil {
			logger.Error("Failed to eject ISO on hypervisor", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to eject ISO: %w", err))
		}
	}

	// Update VM in database
	updated, err := s.repo.Update(ctx, vm)
	if err != nil {
		logger.Error("Failed to update VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Record event
	eventMsg := fmt.Sprintf("ISO ejected from CD-ROM %s", req.Msg.CdromId)
	if oldISO != "" {
		eventMsg = fmt.Sprintf("ISO %s ejected from CD-ROM %s", oldISO, req.Msg.CdromId)
	}
	s.recordVMEvent(ctx, vm.ID, "config", "info", eventMsg, "")

	logger.Info("ISO ejected successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// ============================================================================
// Events
// ============================================================================

// ListVMEvents returns events for a VM.
func (s *Service) ListVMEvents(
	ctx context.Context,
	req *connect.Request[computev1.ListVMEventsRequest],
) (*connect.Response[computev1.ListVMEventsResponse], error) {
	logger := s.logger.With(
		zap.String("method", "ListVMEvents"),
		zap.String("vm_id", req.Msg.VmId),
	)

	logger.Info("Listing VM events")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}

	// Get events from repository
	limit := int(req.Msg.Limit)
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	events, err := s.repo.ListEvents(ctx, req.Msg.VmId, req.Msg.Type, req.Msg.Severity, limit, req.Msg.Since)
	if err != nil {
		logger.Error("Failed to list events", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert to proto
	protoEvents := make([]*computev1.VMEvent, len(events))
	for i, event := range events {
		protoEvents[i] = &computev1.VMEvent{
			Id:        event.ID,
			VmId:      event.VMID,
			Type:      event.Type,
			Message:   event.Message,
			User:      event.User,
			Severity:  event.Severity,
			CreatedAt: event.CreatedAt.Format(time.RFC3339),
			Metadata:  event.Metadata,
		}
	}

	return connect.NewResponse(&computev1.ListVMEventsResponse{
		Events: protoEvents,
	}), nil
}

// recordVMEvent is a helper to record VM events in the database.
func (s *Service) recordVMEvent(ctx context.Context, vmID, eventType, severity, message, user string) {
	if s.repo == nil {
		return
	}

	event := &domain.VMEvent{
		ID:        fmt.Sprintf("evt-%d", time.Now().UnixNano()),
		VMID:      vmID,
		Type:      eventType,
		Severity:  severity,
		Message:   message,
		User:      user,
		CreatedAt: time.Now(),
		Metadata:  make(map[string]string),
	}

	if err := s.repo.CreateEvent(ctx, event); err != nil {
		s.logger.Warn("Failed to record VM event", zap.Error(err), zap.String("vm_id", vmID))
	}
}

// ============================================================================
// Guest Agent Operations
// ============================================================================

// PingAgent checks if the guest agent is available and responding.
func (s *Service) PingAgent(
	ctx context.Context,
	req *connect.Request[computev1.PingAgentRequest],
) (*connect.Response[computev1.PingAgentResponse], error) {
	logger := s.logger.With(
		zap.String("method", "PingAgent"),
		zap.String("vm_id", req.Msg.VmId),
	)

	logger.Info("Pinging guest agent")

	if req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("VM ID is required"))
	}

	// Get the VM
	vm, err := s.repo.Get(ctx, req.Msg.VmId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", req.Msg.VmId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// VM must be running
	if vm.Status.State != domain.VMStateRunning {
		return connect.NewResponse(&computev1.PingAgentResponse{
			Connected: false,
			Error:     "VM is not running",
		}), nil
	}

	if vm.Status.NodeID == "" {
		return connect.NewResponse(&computev1.PingAgentResponse{
			Connected: false,
			Error:     "VM is not assigned to a node",
		}), nil
	}

	// Get node daemon client
	client, err := s.getNodeDaemonClient(ctx, vm.Status.NodeID)
	if err != nil {
		logger.Error("Failed to connect to node daemon", zap.Error(err))
		return connect.NewResponse(&computev1.PingAgentResponse{
			Connected: false,
			Error:     "Failed to connect to host",
		}), nil
	}

	// Ping the agent through the node daemon
	agentInfo, err := client.PingGuestAgent(ctx, req.Msg.VmId)
	if err != nil {
		logger.Warn("Guest agent ping failed", zap.Error(err))
		return connect.NewResponse(&computev1.PingAgentResponse{
			Connected: false,
			Error:     fmt.Sprintf("Agent not responding: %v", err),
		}), nil
	}

	return connect.NewResponse(&computev1.PingAgentResponse{
		Connected:     true,
		Version:       agentInfo.Version,
		UptimeSeconds: agentInfo.UptimeSeconds,
	}), nil
}

// Helper functions

func generateDiskID() string {
	return fmt.Sprintf("disk-%d", time.Now().UnixNano())
}

func generateNICID() string {
	return fmt.Sprintf("nic-%d", time.Now().UnixNano())
}

func generateCDROMID() string {
	return fmt.Sprintf("cdrom-%d", time.Now().UnixNano())
}

func generateMACAddress() string {
	// QEMU/KVM OUI: 52:54:00
	return fmt.Sprintf("52:54:00:%02x:%02x:%02x",
		time.Now().UnixNano()%256,
		(time.Now().UnixNano()/256)%256,
		(time.Now().UnixNano()/65536)%256,
	)
}
