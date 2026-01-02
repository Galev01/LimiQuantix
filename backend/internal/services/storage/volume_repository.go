// Package storage provides the VolumeService implementation.
package storage

import (
	"context"

	"github.com/Quantixkvm/Quantixkvm/internal/domain"
)

// VolumeRepository defines the interface for volume data operations.
type VolumeRepository interface {
	// Create adds a new volume.
	Create(ctx context.Context, volume *domain.Volume) (*domain.Volume, error)

	// Get retrieves a volume by ID.
	Get(ctx context.Context, id string) (*domain.Volume, error)

	// GetByName retrieves a volume by name within a project.
	GetByName(ctx context.Context, projectID, name string) (*domain.Volume, error)

	// List retrieves volumes based on filter criteria.
	List(ctx context.Context, filter VolumeFilter, limit int, offset int) ([]*domain.Volume, int, error)

	// Update modifies an existing volume.
	Update(ctx context.Context, volume *domain.Volume) (*domain.Volume, error)

	// Delete removes a volume by ID.
	Delete(ctx context.Context, id string) error

	// UpdateStatus updates the status of a volume.
	UpdateStatus(ctx context.Context, id string, status domain.VolumeStatus) error

	// ListByPoolID retrieves all volumes in a specific pool.
	ListByPoolID(ctx context.Context, poolID string) ([]*domain.Volume, error)

	// ListByVMID retrieves all volumes attached to a specific VM.
	ListByVMID(ctx context.Context, vmID string) ([]*domain.Volume, error)
}

// VolumeFilter defines parameters for filtering volumes.
type VolumeFilter struct {
	ProjectID    string
	PoolID       string
	AttachedVMID string
	Phase        domain.VolumePhase
	Labels       map[string]string
}
