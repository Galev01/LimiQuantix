// Package storage implements storage-related services.
package storage

import (
	"context"
	"sync"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// ImageRepository defines the interface for image persistence.
type ImageRepository interface {
	Create(ctx context.Context, image *domain.Image) (*domain.Image, error)
	Get(ctx context.Context, id string) (*domain.Image, error)
	List(ctx context.Context, filter ImageFilter) ([]*domain.Image, error)
	Update(ctx context.Context, image *domain.Image) (*domain.Image, error)
	Delete(ctx context.Context, id string) error
	GetByPath(ctx context.Context, nodeID, path string) (*domain.Image, error)
	// FindByCatalogIDs returns images that were downloaded from the given catalog IDs.
	// Returns a map of catalogID -> Image for found images.
	FindByCatalogIDs(ctx context.Context, catalogIDs []string) (map[string]*domain.Image, error)
}

// ImageFilter defines filter criteria for listing images.
type ImageFilter struct {
	ProjectID  string
	OSFamily   domain.OSFamily
	Visibility domain.ImageVisibility
	NodeID     string
	Phase      domain.ImagePhase
}

// MemoryImageRepository is an in-memory implementation of ImageRepository.
type MemoryImageRepository struct {
	mu     sync.RWMutex
	images map[string]*domain.Image
}

// NewMemoryImageRepository creates a new in-memory image repository.
func NewMemoryImageRepository() *MemoryImageRepository {
	return &MemoryImageRepository{
		images: make(map[string]*domain.Image),
	}
}

// Create creates a new image.
func (r *MemoryImageRepository) Create(ctx context.Context, image *domain.Image) (*domain.Image, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.images[image.ID]; exists {
		return nil, domain.ErrAlreadyExists
	}

	r.images[image.ID] = image
	return image, nil
}

// Get retrieves an image by ID.
func (r *MemoryImageRepository) Get(ctx context.Context, id string) (*domain.Image, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	image, exists := r.images[id]
	if !exists {
		return nil, domain.ErrNotFound
	}
	return image, nil
}

// List returns images matching the filter.
func (r *MemoryImageRepository) List(ctx context.Context, filter ImageFilter) ([]*domain.Image, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*domain.Image
	for _, img := range r.images {
		// Apply filters
		if filter.ProjectID != "" && img.ProjectID != filter.ProjectID && img.ProjectID != "" {
			continue
		}
		if filter.OSFamily != "" && img.Spec.OS.Family != filter.OSFamily {
			continue
		}
		if filter.Visibility != "" && img.Spec.Visibility != filter.Visibility {
			continue
		}
		if filter.NodeID != "" && img.Status.NodeID != filter.NodeID {
			continue
		}
		if filter.Phase != "" && img.Status.Phase != filter.Phase {
			continue
		}
		result = append(result, img)
	}
	return result, nil
}

// Update updates an existing image.
func (r *MemoryImageRepository) Update(ctx context.Context, image *domain.Image) (*domain.Image, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.images[image.ID]; !exists {
		return nil, domain.ErrNotFound
	}

	r.images[image.ID] = image
	return image, nil
}

// Delete removes an image.
func (r *MemoryImageRepository) Delete(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.images[id]; !exists {
		return domain.ErrNotFound
	}

	delete(r.images, id)
	return nil
}

// GetByPath finds an image by its path on a specific node.
func (r *MemoryImageRepository) GetByPath(ctx context.Context, nodeID, path string) (*domain.Image, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, img := range r.images {
		if img.Status.NodeID == nodeID && img.Status.Path == path {
			return img, nil
		}
	}
	return nil, domain.ErrNotFound
}

// FindByCatalogIDs returns images that were downloaded from the given catalog IDs.
func (r *MemoryImageRepository) FindByCatalogIDs(ctx context.Context, catalogIDs []string) (map[string]*domain.Image, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// Build a set for O(1) lookup
	catalogSet := make(map[string]struct{}, len(catalogIDs))
	for _, id := range catalogIDs {
		catalogSet[id] = struct{}{}
	}

	result := make(map[string]*domain.Image)
	for _, img := range r.images {
		if img.Spec.CatalogID != "" {
			if _, exists := catalogSet[img.Spec.CatalogID]; exists {
				result[img.Spec.CatalogID] = img
			}
		}
	}
	return result, nil
}
