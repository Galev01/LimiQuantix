// Package node provides the node service for the control plane.
package node

import (
	"context"

	"github.com/Quantixkvm/Quantixkvm/internal/domain"
)

// Repository defines the data access interface for nodes.
type Repository interface {
	// Create stores a new node and returns the created entity.
	Create(ctx context.Context, node *domain.Node) (*domain.Node, error)

	// Get retrieves a node by ID.
	Get(ctx context.Context, id string) (*domain.Node, error)

	// GetByHostname retrieves a node by hostname.
	GetByHostname(ctx context.Context, hostname string) (*domain.Node, error)

	// List returns all nodes matching the filter.
	List(ctx context.Context, filter NodeFilter) ([]*domain.Node, error)

	// ListSchedulable returns nodes that can accept new VMs.
	ListSchedulable(ctx context.Context) ([]*domain.Node, error)

	// Update updates an existing node.
	Update(ctx context.Context, node *domain.Node) (*domain.Node, error)

	// UpdateStatus updates only the status fields of a node.
	UpdateStatus(ctx context.Context, id string, status domain.NodeStatus) error

	// UpdateHeartbeat updates the last heartbeat time and resources.
	UpdateHeartbeat(ctx context.Context, id string, resources domain.Resources) error

	// Delete removes a node by ID.
	Delete(ctx context.Context, id string) error

	// ListByCluster returns all nodes in a cluster.
	ListByCluster(ctx context.Context, clusterID string) ([]*domain.Node, error)
}

// NodeFilter defines filtering options for listing nodes.
type NodeFilter struct {
	// ClusterID filters by cluster.
	ClusterID string

	// Phases filters by node phases.
	Phases []domain.NodePhase

	// Labels filters by label key-value pairs.
	Labels map[string]string

	// ComputeOnly filters for nodes with compute role.
	ComputeOnly bool
}
