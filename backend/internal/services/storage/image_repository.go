// Package storage implements storage-related services.
package storage

import (
	"context"
	"sort"
	"strings"
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
	// ListByFolder returns images in a specific folder (and optionally subfolders).
	ListByFolder(ctx context.Context, folderPath string, includeSubfolders bool) ([]*domain.Image, error)
	// ListFolders returns all unique folder paths.
	ListFolders(ctx context.Context) ([]string, error)
	// Upsert creates or updates an image based on nodeID + path combination.
	// Used for syncing images from nodes.
	Upsert(ctx context.Context, image *domain.Image) (*domain.Image, error)
}

// ImageFilter defines filter criteria for listing images.
type ImageFilter struct {
	ProjectID    string
	OSFamily     domain.OSFamily
	Visibility   domain.ImageVisibility
	NodeID       string
	Phase        domain.ImagePhase
	FolderPath   string // Filter by folder path
	Format       domain.ImageFormat // Filter by format (ISO, QCOW2, etc.)
	SearchQuery  string // Search in name/description
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
		if filter.FolderPath != "" {
			imgFolder := domain.NormalizeFolderPath(img.Status.FolderPath)
			filterFolder := domain.NormalizeFolderPath(filter.FolderPath)
			if imgFolder != filterFolder {
				continue
			}
		}
		if filter.Format != "" && img.Spec.Format != filter.Format {
			continue
		}
		if filter.SearchQuery != "" {
			query := strings.ToLower(filter.SearchQuery)
			nameMatch := strings.Contains(strings.ToLower(img.Name), query)
			descMatch := strings.Contains(strings.ToLower(img.Description), query)
			if !nameMatch && !descMatch {
				continue
			}
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

// ListByFolder returns images in a specific folder (and optionally subfolders).
func (r *MemoryImageRepository) ListByFolder(ctx context.Context, folderPath string, includeSubfolders bool) ([]*domain.Image, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	folderPath = domain.NormalizeFolderPath(folderPath)
	var result []*domain.Image

	for _, img := range r.images {
		imgFolder := domain.NormalizeFolderPath(img.Status.FolderPath)

		if includeSubfolders {
			// Match folder and all subfolders
			if imgFolder == folderPath || strings.HasPrefix(imgFolder, folderPath+"/") {
				result = append(result, img)
			}
		} else {
			// Exact folder match only
			if imgFolder == folderPath {
				result = append(result, img)
			}
		}
	}
	return result, nil
}

// ListFolders returns all unique folder paths sorted alphabetically.
func (r *MemoryImageRepository) ListFolders(ctx context.Context) ([]string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	folderSet := make(map[string]struct{})
	folderSet["/"] = struct{}{} // Always include root

	for _, img := range r.images {
		folder := domain.NormalizeFolderPath(img.Status.FolderPath)
		folderSet[folder] = struct{}{}

		// Also add parent folders
		parts := strings.Split(folder, "/")
		for i := 1; i < len(parts); i++ {
			parent := strings.Join(parts[:i], "/")
			if parent == "" {
				parent = "/"
			}
			folderSet[parent] = struct{}{}
		}
	}

	// Convert to slice and sort
	result := make([]string, 0, len(folderSet))
	for folder := range folderSet {
		result = append(result, folder)
	}
	sort.Strings(result)
	return result, nil
}

// Upsert creates or updates an image based on nodeID + path combination.
// This is used for syncing images from nodes - if an image with the same
// nodeID and path already exists, it updates it; otherwise creates a new one.
func (r *MemoryImageRepository) Upsert(ctx context.Context, image *domain.Image) (*domain.Image, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Check if image with same nodeID + path exists
	for _, existing := range r.images {
		if existing.Status.NodeID == image.Status.NodeID && 
		   existing.Status.Path == image.Status.Path {
			// Update existing image
			image.ID = existing.ID // Keep original ID
			image.CreatedAt = existing.CreatedAt // Keep original creation time
			r.images[image.ID] = image
			return image, nil
		}
	}

	// Create new image
	r.images[image.ID] = image
	return image, nil
}
