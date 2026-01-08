// Package memory provides in-memory repository implementations for development and testing.
// These repositories store data in memory and are not persistent across restarts.
package memory

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/services/vm"
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

