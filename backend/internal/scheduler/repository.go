// Package scheduler defines repository interfaces for the scheduler.
package scheduler

import (
	"context"

	"github.com/Quantixkvm/Quantixkvm/internal/domain"
)

// NodeRepository defines the interface for node data access needed by the scheduler.
type NodeRepository interface {
	// ListSchedulable returns all nodes that are ready and schedulable.
	ListSchedulable(ctx context.Context) ([]*domain.Node, error)

	// Get retrieves a node by ID.
	Get(ctx context.Context, id string) (*domain.Node, error)
}

// VMRepository defines the interface for VM data access needed by the scheduler.
type VMRepository interface {
	// ListByNodeID returns all VMs running on a specific node.
	ListByNodeID(ctx context.Context, nodeID string) ([]*domain.VirtualMachine, error)

	// CountByNodeID returns the number of VMs running on a specific node.
	CountByNodeID(ctx context.Context, nodeID string) (int, error)
}
