// Package memory provides in-memory repository implementations for development and testing.
// These repositories store data in memory and are not persistent across restarts.
package memory

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/Quantixkvm/Quantixkvm/internal/domain"
	"github.com/Quantixkvm/Quantixkvm/internal/services/vm"
)

// Ensure VMRepository implements vm.Repository
var _ vm.Repository = (*VMRepository)(nil)

// VMRepository is an in-memory implementation of the VM repository.
// It's useful for development and testing without requiring a database.
type VMRepository struct {
	mu   sync.RWMutex
	data map[string]*domain.VirtualMachine
}

// NewVMRepository creates a new in-memory VM repository.
func NewVMRepository() *VMRepository {
	return &VMRepository{
		data: make(map[string]*domain.VirtualMachine),
	}
}

// Create stores a new virtual machine.
func (r *VMRepository) Create(ctx context.Context, vm *domain.VirtualMachine) (*domain.VirtualMachine, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Generate ID if not set
	if vm.ID == "" {
		vm.ID = uuid.New().String()
	}

	// Check for duplicate name within project
	for _, existing := range r.data {
		if existing.ProjectID == vm.ProjectID && existing.Name == vm.Name {
			return nil, domain.ErrAlreadyExists
		}
	}

	// Set timestamps
	now := time.Now()
	if vm.CreatedAt.IsZero() {
		vm.CreatedAt = now
	}
	vm.UpdatedAt = now

	// Clone to avoid external mutations
	stored := cloneVM(vm)
	r.data[stored.ID] = stored

	return cloneVM(stored), nil
}

// Get retrieves a virtual machine by ID.
func (r *VMRepository) Get(ctx context.Context, id string) (*domain.VirtualMachine, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	vm, ok := r.data[id]
	if !ok {
		return nil, domain.ErrNotFound
	}

	return cloneVM(vm), nil
}

// List returns a paginated list of virtual machines matching the filter.
func (r *VMRepository) List(ctx context.Context, filter vm.VMFilter, limit int, cursor string) ([]*domain.VirtualMachine, int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*domain.VirtualMachine
	pastCursor := cursor == ""

	// Collect matching VMs
	for _, vmData := range r.data {
		// Cursor-based pagination
		if !pastCursor {
			if vmData.ID == cursor {
				pastCursor = true
			}
			continue
		}

		// Apply filters
		if !matchesFilter(vmData, filter) {
			continue
		}

		result = append(result, cloneVM(vmData))
	}

	// Sort by created_at DESC (most recent first)
	sortVMsByCreatedAt(result)

	// Count total matching
	total := int64(0)
	for _, vmData := range r.data {
		if matchesFilter(vmData, filter) {
			total++
		}
	}

	// Apply limit
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}

	return result, total, nil
}

// Update updates an existing virtual machine.
func (r *VMRepository) Update(ctx context.Context, vm *domain.VirtualMachine) (*domain.VirtualMachine, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.data[vm.ID]; !ok {
		return nil, domain.ErrNotFound
	}

	vm.UpdatedAt = time.Now()
	stored := cloneVM(vm)
	r.data[vm.ID] = stored

	return cloneVM(stored), nil
}

// UpdateStatus updates only the status fields of a VM.
func (r *VMRepository) UpdateStatus(ctx context.Context, id string, status domain.VMStatus) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	vm, ok := r.data[id]
	if !ok {
		return domain.ErrNotFound
	}

	vm.Status = status
	vm.UpdatedAt = time.Now()

	return nil
}

// Delete removes a virtual machine by ID.
func (r *VMRepository) Delete(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.data[id]; !ok {
		return domain.ErrNotFound
	}

	delete(r.data, id)
	return nil
}

// ListByNode returns all VMs running on a specific node.
func (r *VMRepository) ListByNode(ctx context.Context, nodeID string) ([]*domain.VirtualMachine, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*domain.VirtualMachine
	for _, vm := range r.data {
		if vm.Status.NodeID == nodeID {
			result = append(result, cloneVM(vm))
		}
	}

	return result, nil
}

// ListByNodeID is an alias for ListByNode (for scheduler interface compatibility).
func (r *VMRepository) ListByNodeID(ctx context.Context, nodeID string) ([]*domain.VirtualMachine, error) {
	return r.ListByNode(ctx, nodeID)
}

// CountByNodeID returns the number of VMs on a specific node.
func (r *VMRepository) CountByNodeID(ctx context.Context, nodeID string) (int, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	count := 0
	for _, vm := range r.data {
		if vm.Status.NodeID == nodeID {
			count++
		}
	}

	return count, nil
}

// CountByProject returns the number of VMs in a project.
func (r *VMRepository) CountByProject(ctx context.Context, projectID string) (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var count int64
	for _, vm := range r.data {
		if vm.ProjectID == projectID {
			count++
		}
	}

	return count, nil
}

// ============================================================================
// Helper Functions
// ============================================================================

// matchesFilter checks if a VM matches the given filter criteria.
func matchesFilter(vmData *domain.VirtualMachine, filter vm.VMFilter) bool {
	// Project filter
	if filter.ProjectID != "" && vmData.ProjectID != filter.ProjectID {
		return false
	}

	// Node filter
	if filter.NodeID != "" && vmData.Status.NodeID != filter.NodeID {
		return false
	}

	// State filter
	if len(filter.States) > 0 {
		matched := false
		for _, state := range filter.States {
			if vmData.Status.State == state {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}

	// Name contains filter
	if filter.NameContains != "" && !strings.Contains(strings.ToLower(vmData.Name), strings.ToLower(filter.NameContains)) {
		return false
	}

	// Labels filter
	for key, value := range filter.Labels {
		if vmData.Labels[key] != value {
			return false
		}
	}

	return true
}

// cloneVM creates a deep copy of a VirtualMachine to prevent external mutations.
func cloneVM(vm *domain.VirtualMachine) *domain.VirtualMachine {
	if vm == nil {
		return nil
	}

	clone := *vm

	// Clone labels
	if vm.Labels != nil {
		clone.Labels = make(map[string]string, len(vm.Labels))
		for k, v := range vm.Labels {
			clone.Labels[k] = v
		}
	}

	// Clone slices
	clone.Spec.Disks = append([]domain.DiskDevice(nil), vm.Spec.Disks...)
	clone.Spec.NICs = append([]domain.NetworkDevice(nil), vm.Spec.NICs...)
	clone.Spec.Cdroms = append([]domain.CDROMDevice(nil), vm.Spec.Cdroms...)
	clone.Status.IPAddresses = append([]string(nil), vm.Status.IPAddresses...)

	// Clone pointers
	if vm.Spec.Display != nil {
		d := *vm.Spec.Display
		clone.Spec.Display = &d
	}
	if vm.Spec.Boot != nil {
		b := *vm.Spec.Boot
		clone.Spec.Boot = &b
	}
	if vm.Spec.Placement != nil {
		p := *vm.Spec.Placement
		clone.Spec.Placement = &p
	}
	if vm.Status.GuestAgent != nil {
		g := *vm.Status.GuestAgent
		clone.Status.GuestAgent = &g
	}
	if vm.Status.Console != nil {
		c := *vm.Status.Console
		clone.Status.Console = &c
	}

	return &clone
}

// sortVMsByCreatedAt sorts VMs by creation time, most recent first.
func sortVMsByCreatedAt(vms []*domain.VirtualMachine) {
	// Simple bubble sort for small data sets (in-memory is for dev/test)
	for i := 0; i < len(vms); i++ {
		for j := i + 1; j < len(vms); j++ {
			if vms[j].CreatedAt.After(vms[i].CreatedAt) {
				vms[i], vms[j] = vms[j], vms[i]
			}
		}
	}
}

// ============================================================================
// Seed Data for Development
// ============================================================================

// SeedDemoData adds sample VMs for development and demo purposes.
func (r *VMRepository) SeedDemoData() {
	now := time.Now()
	defaultProject := "00000000-0000-0000-0000-000000000001"

	demoVMs := []*domain.VirtualMachine{
		{
			ID:              "11111111-1111-1111-1111-111111111111",
			Name:            "web-server-01",
			ProjectID:       defaultProject,
			Description:     "Primary web server running Nginx",
			Labels:          map[string]string{"env": "production", "tier": "frontend"},
			HardwareVersion: "v1",
			Spec: domain.VMSpec{
				CPU:    domain.CPUConfig{Cores: 4, Sockets: 1, Threads: 1},
				Memory: domain.MemoryConfig{SizeMiB: 8192},
				Disks: []domain.DiskDevice{
					{Name: "disk-0", SizeGiB: 100, Bus: "virtio"},
				},
				NICs: []domain.NetworkDevice{
					{Name: "eth0", NetworkID: "net-prod"},
				},
			},
			Status: domain.VMStatus{
				State:       domain.VMStateRunning,
				NodeID:      "node-01",
				IPAddresses: []string{"192.168.1.10"},
				Resources: domain.ResourceUsage{
					CPUPercent:    45.5,
					MemoryUsedMiB: 4096,
				},
			},
			CreatedAt: now.Add(-72 * time.Hour),
			UpdatedAt: now.Add(-1 * time.Hour),
			CreatedBy: "admin",
		},
		{
			ID:              "22222222-2222-2222-2222-222222222222",
			Name:            "db-server-01",
			ProjectID:       defaultProject,
			Description:     "PostgreSQL database server",
			Labels:          map[string]string{"env": "production", "tier": "database"},
			HardwareVersion: "v1",
			Spec: domain.VMSpec{
				CPU:    domain.CPUConfig{Cores: 8, Sockets: 1, Threads: 1},
				Memory: domain.MemoryConfig{SizeMiB: 32768},
				Disks: []domain.DiskDevice{
					{Name: "disk-0", SizeGiB: 50, Bus: "virtio"},
					{Name: "disk-1", SizeGiB: 500, Bus: "virtio"},
				},
				NICs: []domain.NetworkDevice{
					{Name: "eth0", NetworkID: "net-prod"},
				},
			},
			Status: domain.VMStatus{
				State:       domain.VMStateRunning,
				NodeID:      "node-02",
				IPAddresses: []string{"192.168.1.20"},
				Resources: domain.ResourceUsage{
					CPUPercent:    72.3,
					MemoryUsedMiB: 28000,
				},
			},
			CreatedAt: now.Add(-168 * time.Hour), // 1 week ago
			UpdatedAt: now.Add(-30 * time.Minute),
			CreatedBy: "admin",
		},
		{
			ID:              "33333333-3333-3333-3333-333333333333",
			Name:            "dev-workstation",
			ProjectID:       defaultProject,
			Description:     "Development workstation for testing",
			Labels:          map[string]string{"env": "development"},
			HardwareVersion: "v1",
			Spec: domain.VMSpec{
				CPU:    domain.CPUConfig{Cores: 2, Sockets: 1, Threads: 1},
				Memory: domain.MemoryConfig{SizeMiB: 4096},
				Disks: []domain.DiskDevice{
					{Name: "disk-0", SizeGiB: 50, Bus: "virtio"},
				},
				NICs: []domain.NetworkDevice{
					{Name: "eth0", NetworkID: "net-dev"},
				},
			},
			Status: domain.VMStatus{
				State:   domain.VMStateStopped,
				Message: "VM stopped by user",
			},
			CreatedAt: now.Add(-24 * time.Hour),
			UpdatedAt: now.Add(-2 * time.Hour),
			CreatedBy: "developer",
		},
		{
			ID:              "44444444-4444-4444-4444-444444444444",
			Name:            "cache-server",
			ProjectID:       defaultProject,
			Description:     "Redis cache server",
			Labels:          map[string]string{"env": "production", "tier": "cache"},
			HardwareVersion: "v1",
			Spec: domain.VMSpec{
				CPU:    domain.CPUConfig{Cores: 2, Sockets: 1, Threads: 1},
				Memory: domain.MemoryConfig{SizeMiB: 16384},
				Disks: []domain.DiskDevice{
					{Name: "disk-0", SizeGiB: 20, Bus: "virtio"},
				},
				NICs: []domain.NetworkDevice{
					{Name: "eth0", NetworkID: "net-prod"},
				},
			},
			Status: domain.VMStatus{
				State:       domain.VMStateRunning,
				NodeID:      "node-01",
				IPAddresses: []string{"192.168.1.30"},
				Resources: domain.ResourceUsage{
					CPUPercent:    12.5,
					MemoryUsedMiB: 14000,
				},
			},
			CreatedAt: now.Add(-48 * time.Hour),
			UpdatedAt: now.Add(-4 * time.Hour),
			CreatedBy: "admin",
		},
	}

	for _, vm := range demoVMs {
		r.data[vm.ID] = vm
	}
}
