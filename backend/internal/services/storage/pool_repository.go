// Package storage provides the StoragePoolService and VolumeService implementations.
package storage

import (
	"context"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// PoolRepository defines the interface for storage pool data operations.
type PoolRepository interface {
	// Create adds a new storage pool.
	Create(ctx context.Context, pool *domain.StoragePool) (*domain.StoragePool, error)

	// Get retrieves a storage pool by ID.
	Get(ctx context.Context, id string) (*domain.StoragePool, error)

	// GetByName retrieves a storage pool by name within a project.
	GetByName(ctx context.Context, projectID, name string) (*domain.StoragePool, error)

	// List retrieves storage pools based on filter criteria.
	List(ctx context.Context, filter PoolFilter, limit int, offset int) ([]*domain.StoragePool, int, error)

	// ListAssignedToNode retrieves all storage pools assigned to a specific node.
	ListAssignedToNode(ctx context.Context, nodeID string) ([]*domain.StoragePool, error)

	// Update modifies an existing storage pool.
	Update(ctx context.Context, pool *domain.StoragePool) (*domain.StoragePool, error)

	// Delete removes a storage pool by ID.
	Delete(ctx context.Context, id string) error

	// UpdateStatus updates the status of a storage pool.
	UpdateStatus(ctx context.Context, id string, status domain.StoragePoolStatus) error
}

// PoolFilter defines parameters for filtering storage pools.
type PoolFilter struct {
	ProjectID   string
	BackendType domain.BackendType
	Labels      map[string]string
}
