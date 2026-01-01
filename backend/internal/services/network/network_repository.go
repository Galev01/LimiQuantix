// Package network provides the VirtualNetworkService and SecurityGroupService implementations.
package network

import (
	"context"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// NetworkRepository defines the interface for virtual network data operations.
type NetworkRepository interface {
	// Create adds a new virtual network.
	Create(ctx context.Context, network *domain.VirtualNetwork) (*domain.VirtualNetwork, error)

	// Get retrieves a virtual network by ID.
	Get(ctx context.Context, id string) (*domain.VirtualNetwork, error)

	// GetByName retrieves a virtual network by name within a project.
	GetByName(ctx context.Context, projectID, name string) (*domain.VirtualNetwork, error)

	// List retrieves virtual networks based on filter criteria.
	List(ctx context.Context, filter NetworkFilter, limit int, offset int) ([]*domain.VirtualNetwork, int, error)

	// Update modifies an existing virtual network.
	Update(ctx context.Context, network *domain.VirtualNetwork) (*domain.VirtualNetwork, error)

	// Delete removes a virtual network by ID.
	Delete(ctx context.Context, id string) error

	// UpdateStatus updates the status of a virtual network.
	UpdateStatus(ctx context.Context, id string, status domain.VirtualNetworkStatus) error
}

// NetworkFilter defines parameters for filtering virtual networks.
type NetworkFilter struct {
	ProjectID   string
	NetworkType domain.NetworkType
	Labels      map[string]string
}

// SecurityGroupRepository defines the interface for security group data operations.
type SecurityGroupRepository interface {
	// Create adds a new security group.
	Create(ctx context.Context, sg *domain.SecurityGroup) (*domain.SecurityGroup, error)

	// Get retrieves a security group by ID.
	Get(ctx context.Context, id string) (*domain.SecurityGroup, error)

	// GetByName retrieves a security group by name within a project.
	GetByName(ctx context.Context, projectID, name string) (*domain.SecurityGroup, error)

	// List retrieves security groups based on filter criteria.
	List(ctx context.Context, projectID string, limit int, offset int) ([]*domain.SecurityGroup, int, error)

	// Update modifies an existing security group.
	Update(ctx context.Context, sg *domain.SecurityGroup) (*domain.SecurityGroup, error)

	// Delete removes a security group by ID.
	Delete(ctx context.Context, id string) error
}
