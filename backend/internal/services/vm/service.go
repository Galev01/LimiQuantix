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
	computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
	"github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1/computev1connect"
)

// Ensure Service implements VMServiceHandler
var _ computev1connect.VMServiceHandler = (*Service)(nil)

// Service implements the VMService Connect-RPC handler.
// It orchestrates VM lifecycle operations, validation, and persistence.
type Service struct {
	computev1connect.UnimplementedVMServiceHandler

	repo   Repository
	logger *zap.Logger
}

// NewService creates a new VM service.
func NewService(repo Repository, logger *zap.Logger) *Service {
	return &Service{
		repo:   repo,
		logger: logger.Named("vm-service"),
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

	// 3. Build domain model
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
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	// 4. Persist to repository
	created, err := s.repo.Create(ctx, vm)
	if err != nil {
		if errors.Is(err, domain.ErrAlreadyExists) {
			logger.Warn("VM already exists", zap.Error(err))
			return nil, connect.NewError(connect.CodeAlreadyExists, fmt.Errorf("VM with name '%s' already exists in project", req.Msg.Name))
		}
		logger.Error("Failed to create VM", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create VM: %w", err))
	}

	logger.Info("VM created successfully",
		zap.String("vm_id", created.ID),
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

	// In a real implementation, we would send a command to the hypervisor agent here.
	// For now, we'll simulate the VM starting.
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

	// Simulate the VM stopping
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

	// Simulate reboot (in real impl, send command to agent)
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
