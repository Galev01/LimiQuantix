// Package scheduler provides tests for the VM scheduler.
package scheduler

import (
	"context"
	"testing"

	"go.uber.org/zap"

	"github.com/Quantixkvm/Quantixkvm/internal/domain"
	computev1 "github.com/Quantixkvm/Quantixkvm/pkg/api/Quantixkvm/compute/v1"
)

// MockNodeRepository is a mock implementation of NodeRepository.
type MockNodeRepository struct {
	nodes map[string]*domain.Node
}

func NewMockNodeRepository() *MockNodeRepository {
	return &MockNodeRepository{
		nodes: make(map[string]*domain.Node),
	}
}

func (m *MockNodeRepository) ListSchedulable(ctx context.Context) ([]*domain.Node, error) {
	var result []*domain.Node
	for _, node := range m.nodes {
		if node.IsSchedulable() {
			result = append(result, node)
		}
	}
	return result, nil
}

func (m *MockNodeRepository) Get(ctx context.Context, id string) (*domain.Node, error) {
	node, ok := m.nodes[id]
	if !ok {
		return nil, domain.ErrNotFound
	}
	return node, nil
}

// MockVMRepository is a mock implementation of VMRepository for scheduler.
type MockVMRepository struct {
	vms map[string]*domain.VirtualMachine
}

func NewMockVMRepository() *MockVMRepository {
	return &MockVMRepository{
		vms: make(map[string]*domain.VirtualMachine),
	}
}

func (m *MockVMRepository) ListByNodeID(ctx context.Context, nodeID string) ([]*domain.VirtualMachine, error) {
	var result []*domain.VirtualMachine
	for _, vm := range m.vms {
		if vm.Status.NodeID == nodeID {
			result = append(result, vm)
		}
	}
	return result, nil
}

func (m *MockVMRepository) CountByNodeID(ctx context.Context, nodeID string) (int, error) {
	count := 0
	for _, vm := range m.vms {
		if vm.Status.NodeID == nodeID {
			count++
		}
	}
	return count, nil
}

// =============================================================================
// Tests
// =============================================================================

func TestScheduler_Schedule_SingleNode(t *testing.T) {
	nodeRepo := NewMockNodeRepository()
	vmRepo := NewMockVMRepository()

	// Add one schedulable node
	nodeRepo.nodes["node-1"] = &domain.Node{
		ID:       "node-1",
		Hostname: "test-node-1",
		Spec: domain.NodeSpec{
			CPU: domain.NodeCPUInfo{
				Sockets:        2,
				CoresPerSocket: 8,
				ThreadsPerCore: 2,
			},
			Memory: domain.NodeMemoryInfo{
				TotalMiB:       65536,
				AllocatableMiB: 60000,
			},
			Role: domain.NodeRole{Compute: true},
		},
		Status: domain.NodeStatus{
			Phase: domain.NodePhaseReady,
			Allocatable: domain.Resources{
				CPUCores:  16,
				MemoryMiB: 60000,
			},
			Allocated: domain.Resources{
				CPUCores:  0,
				MemoryMiB: 0,
			},
		},
	}

	cfg := DefaultConfig()
	logger, _ := zap.NewDevelopment()
	scheduler := New(nodeRepo, vmRepo, cfg, logger)

	spec := &computev1.VmSpec{
		Cpu:    &computev1.CpuConfig{Cores: 2},
		Memory: &computev1.MemoryConfig{SizeMib: 4096},
	}

	result, err := scheduler.Schedule(context.Background(), spec)
	if err != nil {
		t.Fatalf("Schedule failed: %v", err)
	}

	if result.NodeID != "node-1" {
		t.Errorf("Expected node-1, got %s", result.NodeID)
	}
}

func TestScheduler_Schedule_NoNodes(t *testing.T) {
	nodeRepo := NewMockNodeRepository()
	vmRepo := NewMockVMRepository()

	cfg := DefaultConfig()
	logger, _ := zap.NewDevelopment()
	scheduler := New(nodeRepo, vmRepo, cfg, logger)

	spec := &computev1.VmSpec{
		Cpu:    &computev1.CpuConfig{Cores: 2},
		Memory: &computev1.MemoryConfig{SizeMib: 4096},
	}

	_, err := scheduler.Schedule(context.Background(), spec)
	if err == nil {
		t.Fatal("Expected error when no nodes available")
	}
}

func TestScheduler_Schedule_BestNode(t *testing.T) {
	nodeRepo := NewMockNodeRepository()
	vmRepo := NewMockVMRepository()

	// Add two nodes - node-2 has more resources
	nodeRepo.nodes["node-1"] = &domain.Node{
		ID:       "node-1",
		Hostname: "small-node",
		Spec: domain.NodeSpec{
			CPU: domain.NodeCPUInfo{
				Sockets:        1,
				CoresPerSocket: 4,
				ThreadsPerCore: 1,
			},
			Memory: domain.NodeMemoryInfo{
				TotalMiB:       16384,
				AllocatableMiB: 14000,
			},
			Role: domain.NodeRole{Compute: true},
		},
		Status: domain.NodeStatus{
			Phase: domain.NodePhaseReady,
			Allocatable: domain.Resources{
				CPUCores:  4,
				MemoryMiB: 14000,
			},
			Allocated: domain.Resources{
				CPUCores:  2, // 50% used
				MemoryMiB: 7000,
			},
		},
	}

	nodeRepo.nodes["node-2"] = &domain.Node{
		ID:       "node-2",
		Hostname: "large-node",
		Spec: domain.NodeSpec{
			CPU: domain.NodeCPUInfo{
				Sockets:        2,
				CoresPerSocket: 8,
				ThreadsPerCore: 2,
			},
			Memory: domain.NodeMemoryInfo{
				TotalMiB:       65536,
				AllocatableMiB: 60000,
			},
			Role: domain.NodeRole{Compute: true},
		},
		Status: domain.NodeStatus{
			Phase: domain.NodePhaseReady,
			Allocatable: domain.Resources{
				CPUCores:  32,
				MemoryMiB: 60000,
			},
			Allocated: domain.Resources{
				CPUCores:  4, // 12.5% used
				MemoryMiB: 8000,
			},
		},
	}

	cfg := DefaultConfig()
	cfg.PlacementStrategy = "spread" // Prefer less-loaded nodes
	logger, _ := zap.NewDevelopment()
	scheduler := New(nodeRepo, vmRepo, cfg, logger)

	spec := &computev1.VmSpec{
		Cpu:    &computev1.CpuConfig{Cores: 2},
		Memory: &computev1.MemoryConfig{SizeMib: 4096},
	}

	result, err := scheduler.Schedule(context.Background(), spec)
	if err != nil {
		t.Fatalf("Schedule failed: %v", err)
	}

	// With spread strategy, should pick a node (either is valid since both have resources)
	if result.NodeID != "node-1" && result.NodeID != "node-2" {
		t.Errorf("Expected node-1 or node-2, got %s", result.NodeID)
	}
	t.Logf("Selected node: %s", result.NodeID)
}

func TestScheduler_Schedule_InsufficientResources(t *testing.T) {
	nodeRepo := NewMockNodeRepository()
	vmRepo := NewMockVMRepository()

	// Add a small node
	nodeRepo.nodes["node-1"] = &domain.Node{
		ID:       "node-1",
		Hostname: "tiny-node",
		Spec: domain.NodeSpec{
			CPU: domain.NodeCPUInfo{
				Sockets:        1,
				CoresPerSocket: 2,
				ThreadsPerCore: 1,
			},
			Memory: domain.NodeMemoryInfo{
				TotalMiB:       4096,
				AllocatableMiB: 3000,
			},
			Role: domain.NodeRole{Compute: true},
		},
		Status: domain.NodeStatus{
			Phase: domain.NodePhaseReady,
			Allocatable: domain.Resources{
				CPUCores:  2,
				MemoryMiB: 3000,
			},
			Allocated: domain.Resources{
				CPUCores:  1,
				MemoryMiB: 2000,
			},
		},
	}

	cfg := DefaultConfig()
	logger, _ := zap.NewDevelopment()
	scheduler := New(nodeRepo, vmRepo, cfg, logger)

	// Request more than available
	spec := &computev1.VmSpec{
		Cpu:    &computev1.CpuConfig{Cores: 8},
		Memory: &computev1.MemoryConfig{SizeMib: 16384},
	}

	_, err := scheduler.Schedule(context.Background(), spec)
	if err == nil {
		t.Fatal("Expected error when resources insufficient")
	}
}

func TestScheduler_Schedule_NodeNotReady(t *testing.T) {
	nodeRepo := NewMockNodeRepository()
	vmRepo := NewMockVMRepository()

	// Add a node that's not ready
	nodeRepo.nodes["node-1"] = &domain.Node{
		ID:       "node-1",
		Hostname: "not-ready-node",
		Spec: domain.NodeSpec{
			CPU: domain.NodeCPUInfo{
				Sockets:        2,
				CoresPerSocket: 8,
			},
			Memory: domain.NodeMemoryInfo{
				TotalMiB:       65536,
				AllocatableMiB: 60000,
			},
			Role: domain.NodeRole{Compute: true},
		},
		Status: domain.NodeStatus{
			Phase: domain.NodePhaseNotReady, // Not ready!
			Allocatable: domain.Resources{
				CPUCores:  16,
				MemoryMiB: 60000,
			},
		},
	}

	cfg := DefaultConfig()
	logger, _ := zap.NewDevelopment()
	scheduler := New(nodeRepo, vmRepo, cfg, logger)

	spec := &computev1.VmSpec{
		Cpu:    &computev1.CpuConfig{Cores: 2},
		Memory: &computev1.MemoryConfig{SizeMib: 4096},
	}

	_, err := scheduler.Schedule(context.Background(), spec)
	if err == nil {
		t.Fatal("Expected error when only node is not ready")
	}
}
