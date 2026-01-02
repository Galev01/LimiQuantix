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

// VolumeRepository is an in-memory implementation of storage.VolumeRepository.
type VolumeRepository struct {
	store sync.Map // map[string]*domain.Volume
}

// NewVolumeRepository creates a new in-memory volume repository.
func NewVolumeRepository() *VolumeRepository {
	repo := &VolumeRepository{}
	repo.seedData()
	return repo
}

func (r *VolumeRepository) seedData() {
	vol1 := &domain.Volume{
		ID:        uuid.NewString(),
		Name:      "webserver-root",
		ProjectID: "default",
		PoolID:    "pool-1", // Reference to a pool
		Labels:    map[string]string{"app": "webserver", "env": "prod"},
		Spec: domain.VolumeSpec{
			SizeBytes:    50 * 1024 * 1024 * 1024, // 50 GiB
			Provisioning: domain.ProvisioningThin,
			AccessMode:   domain.AccessModeReadWriteOnce,
		},
		Status: domain.VolumeStatus{
			Phase:           domain.VolumePhaseInUse,
			AttachedVMID:    "vm-1",
			DevicePath:      "/dev/vda",
			ActualSizeBytes: 50 * 1024 * 1024 * 1024,
			Usage: domain.VolumeUsage{
				UsedBytes: 20 * 1024 * 1024 * 1024, // 20 GiB used
			},
		},
		CreatedAt: time.Now().Add(-7 * 24 * time.Hour),
		UpdatedAt: time.Now().Add(-1 * time.Hour),
	}
	r.store.Store(vol1.ID, vol1)

	vol2 := &domain.Volume{
		ID:        uuid.NewString(),
		Name:      "database-data",
		ProjectID: "default",
		PoolID:    "pool-1",
		Labels:    map[string]string{"app": "postgres", "env": "prod"},
		Spec: domain.VolumeSpec{
			SizeBytes:    200 * 1024 * 1024 * 1024, // 200 GiB
			Provisioning: domain.ProvisioningThin,
			AccessMode:   domain.AccessModeReadWriteOnce,
		},
		Status: domain.VolumeStatus{
			Phase:           domain.VolumePhaseInUse,
			AttachedVMID:    "vm-2",
			DevicePath:      "/dev/vdb",
			ActualSizeBytes: 200 * 1024 * 1024 * 1024,
			Usage: domain.VolumeUsage{
				UsedBytes: 150 * 1024 * 1024 * 1024, // 150 GiB used
			},
		},
		CreatedAt: time.Now().Add(-14 * 24 * time.Hour),
		UpdatedAt: time.Now().Add(-30 * time.Minute),
	}
	r.store.Store(vol2.ID, vol2)

	vol3 := &domain.Volume{
		ID:        uuid.NewString(),
		Name:      "backup-volume",
		ProjectID: "default",
		PoolID:    "pool-2",
		Labels:    map[string]string{"purpose": "backup"},
		Spec: domain.VolumeSpec{
			SizeBytes:    500 * 1024 * 1024 * 1024, // 500 GiB
			Provisioning: domain.ProvisioningThin,
			AccessMode:   domain.AccessModeReadWriteOnce,
		},
		Status: domain.VolumeStatus{
			Phase:           domain.VolumePhaseReady,
			ActualSizeBytes: 500 * 1024 * 1024 * 1024,
		},
		CreatedAt: time.Now().Add(-3 * 24 * time.Hour),
		UpdatedAt: time.Now().Add(-2 * time.Hour),
	}
	r.store.Store(vol3.ID, vol3)
}

// Create adds a new volume to the store.
func (r *VolumeRepository) Create(ctx context.Context, vol *domain.Volume) (*domain.Volume, error) {
	if vol.ID == "" {
		vol.ID = uuid.NewString()
	}

	// Check name uniqueness within project
	var exists bool
	r.store.Range(func(key, value interface{}) bool {
		existing := value.(*domain.Volume)
		if existing.ProjectID == vol.ProjectID && existing.Name == vol.Name {
			exists = true
			return false
		}
		return true
	})
	if exists {
		return nil, domain.ErrAlreadyExists
	}

	now := time.Now()
	vol.CreatedAt = now
	vol.UpdatedAt = now
	r.store.Store(vol.ID, vol)
	return vol, nil
}

// Get retrieves a volume by ID.
func (r *VolumeRepository) Get(ctx context.Context, id string) (*domain.Volume, error) {
	if val, ok := r.store.Load(id); ok {
		return val.(*domain.Volume), nil
	}
	return nil, domain.ErrNotFound
}

// GetByName retrieves a volume by name within a project.
func (r *VolumeRepository) GetByName(ctx context.Context, projectID, name string) (*domain.Volume, error) {
	var found *domain.Volume
	r.store.Range(func(key, value interface{}) bool {
		vol := value.(*domain.Volume)
		if vol.ProjectID == projectID && vol.Name == name {
			found = vol
			return false
		}
		return true
	})
	if found != nil {
		return found, nil
	}
	return nil, domain.ErrNotFound
}

// List retrieves volumes based on filter criteria.
func (r *VolumeRepository) List(ctx context.Context, filter storage.VolumeFilter, limit int, offset int) ([]*domain.Volume, int, error) {
	var result []*domain.Volume
	var total int

	r.store.Range(func(key, value interface{}) bool {
		vol := value.(*domain.Volume)

		// Apply filters
		if filter.ProjectID != "" && vol.ProjectID != filter.ProjectID {
			return true
		}
		if filter.PoolID != "" && vol.PoolID != filter.PoolID {
			return true
		}
		if filter.AttachedVMID != "" && vol.Status.AttachedVMID != filter.AttachedVMID {
			return true
		}
		if filter.Phase != "" && vol.Status.Phase != filter.Phase {
			return true
		}
		if len(filter.Labels) > 0 {
			for k, v := range filter.Labels {
				if vol.Labels[k] != v {
					return true
				}
			}
		}

		total++
		result = append(result, vol)
		return true
	})

	// Apply pagination
	if offset >= len(result) {
		return []*domain.Volume{}, total, nil
	}
	end := offset + limit
	if end > len(result) {
		end = len(result)
	}

	return result[offset:end], total, nil
}

// Update modifies an existing volume.
func (r *VolumeRepository) Update(ctx context.Context, vol *domain.Volume) (*domain.Volume, error) {
	if _, ok := r.store.Load(vol.ID); !ok {
		return nil, domain.ErrNotFound
	}
	vol.UpdatedAt = time.Now()
	r.store.Store(vol.ID, vol)
	return vol, nil
}

// Delete removes a volume by ID.
func (r *VolumeRepository) Delete(ctx context.Context, id string) error {
	if _, ok := r.store.Load(id); !ok {
		return domain.ErrNotFound
	}
	r.store.Delete(id)
	return nil
}

// UpdateStatus updates the status of a volume.
func (r *VolumeRepository) UpdateStatus(ctx context.Context, id string, status domain.VolumeStatus) error {
	if val, ok := r.store.Load(id); ok {
		vol := val.(*domain.Volume)
		vol.Status = status
		vol.UpdatedAt = time.Now()
		r.store.Store(id, vol)
		return nil
	}
	return domain.ErrNotFound
}

// ListByPoolID retrieves all volumes in a specific pool.
func (r *VolumeRepository) ListByPoolID(ctx context.Context, poolID string) ([]*domain.Volume, error) {
	var result []*domain.Volume
	r.store.Range(func(key, value interface{}) bool {
		vol := value.(*domain.Volume)
		if vol.PoolID == poolID {
			result = append(result, vol)
		}
		return true
	})
	return result, nil
}

// ListByVMID retrieves all volumes attached to a specific VM.
func (r *VolumeRepository) ListByVMID(ctx context.Context, vmID string) ([]*domain.Volume, error) {
	var result []*domain.Volume
	r.store.Range(func(key, value interface{}) bool {
		vol := value.(*domain.Volume)
		if vol.Status.AttachedVMID == vmID {
			result = append(result, vol)
		}
		return true
	})
	return result, nil
}
