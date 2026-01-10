// Package memory provides in-memory repository implementations for development.
package memory

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/services/storage"
)

// StoragePoolRepository is an in-memory implementation of storage.PoolRepository.
type StoragePoolRepository struct {
	store sync.Map // map[string]*domain.StoragePool
}

// NewStoragePoolRepository creates a new in-memory storage pool repository.
func NewStoragePoolRepository() *StoragePoolRepository {
	return &StoragePoolRepository{}
}

// Create adds a new storage pool to the store.
func (r *StoragePoolRepository) Create(ctx context.Context, pool *domain.StoragePool) (*domain.StoragePool, error) {
	if pool.ID == "" {
		pool.ID = uuid.NewString()
	}

	// Check name uniqueness within project
	var exists bool
	r.store.Range(func(key, value interface{}) bool {
		existing := value.(*domain.StoragePool)
		if existing.ProjectID == pool.ProjectID && existing.Name == pool.Name {
			exists = true
			return false
		}
		return true
	})
	if exists {
		return nil, domain.ErrAlreadyExists
	}

	now := time.Now()
	pool.CreatedAt = now
	pool.UpdatedAt = now
	r.store.Store(pool.ID, pool)
	return pool, nil
}

// Get retrieves a storage pool by ID.
func (r *StoragePoolRepository) Get(ctx context.Context, id string) (*domain.StoragePool, error) {
	if val, ok := r.store.Load(id); ok {
		return val.(*domain.StoragePool), nil
	}
	return nil, domain.ErrNotFound
}

// GetByName retrieves a storage pool by name within a project.
func (r *StoragePoolRepository) GetByName(ctx context.Context, projectID, name string) (*domain.StoragePool, error) {
	var found *domain.StoragePool
	r.store.Range(func(key, value interface{}) bool {
		pool := value.(*domain.StoragePool)
		if pool.ProjectID == projectID && pool.Name == name {
			found = pool
			return false
		}
		return true
	})
	if found != nil {
		return found, nil
	}
	return nil, domain.ErrNotFound
}

// List retrieves storage pools based on filter criteria.
func (r *StoragePoolRepository) List(ctx context.Context, filter storage.PoolFilter, limit int, offset int) ([]*domain.StoragePool, int, error) {
	var result []*domain.StoragePool
	var total int

	r.store.Range(func(key, value interface{}) bool {
		pool := value.(*domain.StoragePool)

		// Apply filters
		if filter.ProjectID != "" && pool.ProjectID != filter.ProjectID {
			return true
		}
		if filter.BackendType != "" && pool.Spec.Backend.Type != filter.BackendType {
			return true
		}
		if len(filter.Labels) > 0 {
			for k, v := range filter.Labels {
				if pool.Labels[k] != v {
					return true
				}
			}
		}

		total++
		result = append(result, pool)
		return true
	})

	// Apply pagination
	if offset >= len(result) {
		return []*domain.StoragePool{}, total, nil
	}
	end := offset + limit
	if end > len(result) {
		end = len(result)
	}

	return result[offset:end], total, nil
}

// Update modifies an existing storage pool.
func (r *StoragePoolRepository) Update(ctx context.Context, pool *domain.StoragePool) (*domain.StoragePool, error) {
	if _, ok := r.store.Load(pool.ID); !ok {
		return nil, domain.ErrNotFound
	}
	pool.UpdatedAt = time.Now()
	r.store.Store(pool.ID, pool)
	return pool, nil
}

// Delete removes a storage pool by ID.
func (r *StoragePoolRepository) Delete(ctx context.Context, id string) error {
	if _, ok := r.store.Load(id); !ok {
		return domain.ErrNotFound
	}
	r.store.Delete(id)
	return nil
}

// UpdateStatus updates the status of a storage pool.
func (r *StoragePoolRepository) UpdateStatus(ctx context.Context, id string, status domain.StoragePoolStatus) error {
	if val, ok := r.store.Load(id); ok {
		pool := val.(*domain.StoragePool)
		pool.Status = status
		pool.UpdatedAt = time.Now()
		r.store.Store(id, pool)
		return nil
	}
	return domain.ErrNotFound
}

// ListAssignedToNode retrieves all storage pools assigned to a specific node.
func (r *StoragePoolRepository) ListAssignedToNode(ctx context.Context, nodeID string) ([]*domain.StoragePool, error) {
	var result []*domain.StoragePool

	r.store.Range(func(key, value interface{}) bool {
		pool := value.(*domain.StoragePool)
		if pool.IsAssignedToNode(nodeID) {
			result = append(result, pool)
		}
		return true
	})

	return result, nil
}