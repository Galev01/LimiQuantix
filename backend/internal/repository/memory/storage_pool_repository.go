// Package memory provides in-memory repository implementations for development.
package memory

import (
	"context"
	"sync"
	"time"

	"github.com/Quantixkvm/Quantixkvm/internal/domain"
	"github.com/Quantixkvm/Quantixkvm/internal/services/storage"
	"github.com/google/uuid"
)

// StoragePoolRepository is an in-memory implementation of storage.PoolRepository.
type StoragePoolRepository struct {
	store sync.Map // map[string]*domain.StoragePool
}

// NewStoragePoolRepository creates a new in-memory storage pool repository.
func NewStoragePoolRepository() *StoragePoolRepository {
	repo := &StoragePoolRepository{}
	repo.seedData()
	return repo
}

func (r *StoragePoolRepository) seedData() {
	pool1 := &domain.StoragePool{
		ID:          uuid.NewString(),
		Name:        "fast-nvme",
		ProjectID:   "default",
		Description: "High-performance NVMe storage pool",
		Labels:      map[string]string{"tier": "performance", "type": "nvme"},
		Spec: domain.StoragePoolSpec{
			Backend: domain.StorageBackend{
				Type: domain.BackendTypeLocalLVM,
				LocalLVM: &domain.LVMConfig{
					VolumeGroup: "nvme-vg",
					ThinPool:    "thin-pool",
					NodeID:      "node-1",
				},
			},
			Defaults: domain.VolumeDefaults{
				Provisioning: "thin",
				Filesystem:   "ext4",
			},
		},
		Status: domain.StoragePoolStatus{
			Phase: domain.StoragePoolPhaseReady,
			Capacity: domain.StorageCapacity{
				TotalBytes:       1024 * 1024 * 1024 * 1024, // 1 TiB
				UsedBytes:        256 * 1024 * 1024 * 1024,  // 256 GiB
				AvailableBytes:   768 * 1024 * 1024 * 1024,  // 768 GiB
				ProvisionedBytes: 512 * 1024 * 1024 * 1024,  // 512 GiB (thin provisioned)
			},
			VolumeCount: 5,
			Health: domain.StorageHealth{
				Status: "healthy",
			},
		},
		CreatedAt: time.Now().Add(-30 * 24 * time.Hour),
		UpdatedAt: time.Now().Add(-1 * time.Hour),
	}
	r.store.Store(pool1.ID, pool1)

	pool2 := &domain.StoragePool{
		ID:          uuid.NewString(),
		Name:        "archive-hdd",
		ProjectID:   "default",
		Description: "Cost-effective HDD storage for archives",
		Labels:      map[string]string{"tier": "archive", "type": "hdd"},
		Spec: domain.StoragePoolSpec{
			Backend: domain.StorageBackend{
				Type: domain.BackendTypeLocalDir,
				LocalDir: &domain.DirConfig{
					Path:   "/mnt/archive",
					NodeID: "node-2",
				},
			},
			Defaults: domain.VolumeDefaults{
				Provisioning: "thin",
				Filesystem:   "xfs",
			},
		},
		Status: domain.StoragePoolStatus{
			Phase: domain.StoragePoolPhaseReady,
			Capacity: domain.StorageCapacity{
				TotalBytes:     10 * 1024 * 1024 * 1024 * 1024, // 10 TiB
				UsedBytes:      2 * 1024 * 1024 * 1024 * 1024,  // 2 TiB
				AvailableBytes: 8 * 1024 * 1024 * 1024 * 1024,  // 8 TiB
			},
			VolumeCount: 20,
			Health: domain.StorageHealth{
				Status: "healthy",
			},
		},
		CreatedAt: time.Now().Add(-60 * 24 * time.Hour),
		UpdatedAt: time.Now().Add(-2 * time.Hour),
	}
	r.store.Store(pool2.ID, pool2)
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
