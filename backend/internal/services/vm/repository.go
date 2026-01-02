// Package vm provides the virtual machine service for the control plane.
package vm

import (
	"context"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// Repository defines the data access interface for virtual machines.
// This interface allows swapping between different storage backends
// (PostgreSQL, in-memory, etc.) without changing the service logic.
type Repository interface {
	// Create stores a new virtual machine and returns the created entity.
	Create(ctx context.Context, vm *domain.VirtualMachine) (*domain.VirtualMachine, error)

	// Get retrieves a virtual machine by ID.
	Get(ctx context.Context, id string) (*domain.VirtualMachine, error)

	// List returns a paginated list of virtual machines matching the filter.
	List(ctx context.Context, filter VMFilter, limit int, cursor string) ([]*domain.VirtualMachine, int64, error)

	// Update updates an existing virtual machine.
	Update(ctx context.Context, vm *domain.VirtualMachine) (*domain.VirtualMachine, error)

	// UpdateStatus updates only the status fields of a VM (power state, node, IPs).
	UpdateStatus(ctx context.Context, id string, status domain.VMStatus) error

	// Delete removes a virtual machine by ID.
	Delete(ctx context.Context, id string) error

	// ListByNode returns all VMs running on a specific node.
	ListByNode(ctx context.Context, nodeID string) ([]*domain.VirtualMachine, error)

	// CountByProject returns the number of VMs in a project.
	CountByProject(ctx context.Context, projectID string) (int64, error)
}

// VMFilter defines filtering options for listing VMs.
type VMFilter struct {
	// ProjectID filters by project.
	ProjectID string

	// NodeID filters by host node.
	NodeID string

	// States filters by power states.
	States []domain.VMState

	// Labels filters by label key-value pairs.
	Labels map[string]string

	// NameContains filters by name substring.
	NameContains string
}
