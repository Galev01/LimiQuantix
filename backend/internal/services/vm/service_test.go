// Package vm provides tests for the VM service.
package vm

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
)

// MockVMRepository is a mock implementation of the Repository interface.
type MockVMRepository struct {
	vms      map[string]*domain.VirtualMachine
	createFn func(ctx context.Context, vm *domain.VirtualMachine) (*domain.VirtualMachine, error)
	getFn    func(ctx context.Context, id string) (*domain.VirtualMachine, error)
}

func NewMockVMRepository() *MockVMRepository {
	return &MockVMRepository{
		vms: make(map[string]*domain.VirtualMachine),
	}
}

func (m *MockVMRepository) Create(ctx context.Context, vm *domain.VirtualMachine) (*domain.VirtualMachine, error) {
	if m.createFn != nil {
		return m.createFn(ctx, vm)
	}
	// Generate ID if not set (like the real repo does)
	if vm.ID == "" {
		vm.ID = uuid.New().String()
	}
	m.vms[vm.ID] = vm
	return vm, nil
}

func (m *MockVMRepository) Get(ctx context.Context, id string) (*domain.VirtualMachine, error) {
	if m.getFn != nil {
		return m.getFn(ctx, id)
	}
	vm, ok := m.vms[id]
	if !ok {
		return nil, domain.ErrNotFound
	}
	return vm, nil
}

func (m *MockVMRepository) List(ctx context.Context, filter VMFilter, limit int, cursor string) ([]*domain.VirtualMachine, int64, error) {
	var result []*domain.VirtualMachine
	for _, vm := range m.vms {
		result = append(result, vm)
	}
	return result, int64(len(result)), nil
}

func (m *MockVMRepository) Update(ctx context.Context, vm *domain.VirtualMachine) (*domain.VirtualMachine, error) {
	m.vms[vm.ID] = vm
	return vm, nil
}

func (m *MockVMRepository) Delete(ctx context.Context, id string) error {
	delete(m.vms, id)
	return nil
}

func (m *MockVMRepository) UpdateStatus(ctx context.Context, id string, status domain.VMStatus) error {
	if vm, ok := m.vms[id]; ok {
		vm.Status = status
	}
	return nil
}

func (m *MockVMRepository) ListByNode(ctx context.Context, nodeID string) ([]*domain.VirtualMachine, error) {
	var result []*domain.VirtualMachine
	for _, vm := range m.vms {
		if vm.Status.NodeID == nodeID {
			result = append(result, vm)
		}
	}
	return result, nil
}

func (m *MockVMRepository) CountByProject(ctx context.Context, projectID string) (int64, error) {
	count := int64(0)
	for _, vm := range m.vms {
		if vm.ProjectID == projectID {
			count++
		}
	}
	return count, nil
}

func (m *MockVMRepository) SeedDemoData() {}

func (m *MockVMRepository) CreateEvent(ctx context.Context, event *domain.VMEvent) error {
	return nil
}

func (m *MockVMRepository) ListEvents(ctx context.Context, vmID, eventType, severity string, limit int, since string) ([]*domain.VMEvent, error) {
	return nil, nil
}

// =============================================================================
// Unit Tests
// =============================================================================

func TestVMService_CreateVM_Success(t *testing.T) {
	repo := NewMockVMRepository()
	service := NewService(repo, zap.NewNop())

	req := connect.NewRequest(&computev1.CreateVMRequest{
		Name:      "test-vm",
		ProjectId: "project-1",
		Spec: &computev1.VmSpec{
			Cpu: &computev1.CpuConfig{
				Cores:          2,
				Sockets:        1,
				ThreadsPerCore: 1,
			},
			Memory: &computev1.MemoryConfig{
				SizeMib: 4096,
			},
		},
	})

	resp, err := service.CreateVM(context.Background(), req)
	if err != nil {
		t.Fatalf("CreateVM failed: %v", err)
	}

	if resp.Msg.Name != "test-vm" {
		t.Errorf("Expected name 'test-vm', got '%s'", resp.Msg.Name)
	}

	if resp.Msg.Id == "" {
		t.Error("Expected VM to have an ID")
	}

	if resp.Msg.Spec.Cpu.Cores != 2 {
		t.Errorf("Expected 2 CPU cores, got %d", resp.Msg.Spec.Cpu.Cores)
	}
}

func TestVMService_GetVM_Exists(t *testing.T) {
	repo := NewMockVMRepository()
	service := NewService(repo, zap.NewNop())

	// Create a VM first
	vm := &domain.VirtualMachine{
		ID:        "vm-123",
		Name:      "existing-vm",
		ProjectID: "project-1",
		Spec: domain.VMSpec{
			CPU:    domain.CPUConfig{Cores: 2},
			Memory: domain.MemoryConfig{SizeMiB: 4096},
		},
		Status: domain.VMStatus{
			State: domain.VMStateStopped,
		},
	}
	repo.vms[vm.ID] = vm

	req := connect.NewRequest(&computev1.GetVMRequest{Id: "vm-123"})
	resp, err := service.GetVM(context.Background(), req)
	if err != nil {
		t.Fatalf("GetVM failed: %v", err)
	}

	if resp.Msg.Name != "existing-vm" {
		t.Errorf("Expected name 'existing-vm', got '%s'", resp.Msg.Name)
	}
}

func TestVMService_GetVM_NotFound(t *testing.T) {
	repo := NewMockVMRepository()
	service := NewService(repo, zap.NewNop())

	req := connect.NewRequest(&computev1.GetVMRequest{Id: "nonexistent"})
	_, err := service.GetVM(context.Background(), req)

	if err == nil {
		t.Fatal("Expected error for nonexistent VM")
	}

	// Check that it's a NotFound error
	if connectErr, ok := err.(*connect.Error); ok {
		if connectErr.Code() != connect.CodeNotFound {
			t.Errorf("Expected NotFound error, got %v", connectErr.Code())
		}
	}
}

func TestVMService_ListVMs_Empty(t *testing.T) {
	repo := NewMockVMRepository()
	service := NewService(repo, zap.NewNop())

	req := connect.NewRequest(&computev1.ListVMsRequest{PageSize: 10})
	resp, err := service.ListVMs(context.Background(), req)
	if err != nil {
		t.Fatalf("ListVMs failed: %v", err)
	}

	if len(resp.Msg.Vms) != 0 {
		t.Errorf("Expected empty list, got %d VMs", len(resp.Msg.Vms))
	}
}

func TestVMService_StartVM_Stopped(t *testing.T) {
	repo := NewMockVMRepository()
	service := NewService(repo, zap.NewNop())

	// Create a stopped VM
	vm := &domain.VirtualMachine{
		ID:        "vm-123",
		Name:      "stopped-vm",
		ProjectID: "project-1",
		Status: domain.VMStatus{
			State: domain.VMStateStopped,
		},
	}
	repo.vms[vm.ID] = vm

	req := connect.NewRequest(&computev1.StartVMRequest{Id: "vm-123"})
	resp, err := service.StartVM(context.Background(), req)
	if err != nil {
		t.Fatalf("StartVM failed: %v", err)
	}

	// Check state changed to RUNNING
	state := resp.Msg.Status.State
	if state != computev1.VmStatus_RUNNING {
		t.Errorf("Expected RUNNING state, got %v", state)
	}
}

func TestVMService_StopVM_Running(t *testing.T) {
	repo := NewMockVMRepository()
	service := NewService(repo, zap.NewNop())

	// Create a running VM
	vm := &domain.VirtualMachine{
		ID:        "vm-123",
		Name:      "running-vm",
		ProjectID: "project-1",
		Status: domain.VMStatus{
			State: domain.VMStateRunning,
		},
	}
	repo.vms[vm.ID] = vm

	req := connect.NewRequest(&computev1.StopVMRequest{Id: "vm-123"})
	resp, err := service.StopVM(context.Background(), req)
	if err != nil {
		t.Fatalf("StopVM failed: %v", err)
	}

	// Check state changed to STOPPED
	state := resp.Msg.Status.State
	if state != computev1.VmStatus_STOPPED {
		t.Errorf("Expected STOPPED state, got %v", state)
	}
}

func TestVMService_DeleteVM_Success(t *testing.T) {
	repo := NewMockVMRepository()
	service := NewService(repo, zap.NewNop())

	// Create a VM first
	vm := &domain.VirtualMachine{
		ID:        "vm-123",
		Name:      "to-delete",
		ProjectID: "project-1",
		Status: domain.VMStatus{
			State: domain.VMStateStopped,
		},
	}
	repo.vms[vm.ID] = vm

	req := connect.NewRequest(&computev1.DeleteVMRequest{Id: "vm-123"})
	_, err := service.DeleteVM(context.Background(), req)
	if err != nil {
		t.Fatalf("DeleteVM failed: %v", err)
	}

	// Verify VM is deleted
	if _, exists := repo.vms["vm-123"]; exists {
		t.Error("VM should have been deleted")
	}
}
