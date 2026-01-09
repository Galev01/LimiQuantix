// Package memory provides in-memory implementations of repository interfaces.
package memory

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/limiquantix/limiquantix/internal/domain"
)

// ClusterRepository is an in-memory implementation of domain.ClusterRepository.
type ClusterRepository struct {
	mu       sync.RWMutex
	clusters map[string]*domain.Cluster
}

// NewClusterRepository creates a new in-memory cluster repository.
func NewClusterRepository() *ClusterRepository {
	return &ClusterRepository{
		clusters: make(map[string]*domain.Cluster),
	}
}

// Create creates a new cluster.
func (r *ClusterRepository) Create(cluster *domain.Cluster) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Generate ID if not provided
	if cluster.ID == "" {
		cluster.ID = uuid.New().String()
	}

	// Check for duplicate name
	for _, c := range r.clusters {
		if c.Name == cluster.Name {
			return fmt.Errorf("cluster with name %q already exists", cluster.Name)
		}
	}

	// Set timestamps
	now := time.Now()
	cluster.CreatedAt = now
	cluster.UpdatedAt = now

	// Set default status
	if cluster.Status == "" {
		cluster.Status = domain.ClusterStatusHealthy
	}

	// Store a copy
	stored := *cluster
	r.clusters[cluster.ID] = &stored

	return nil
}

// Get retrieves a cluster by ID.
func (r *ClusterRepository) Get(id string) (*domain.Cluster, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	cluster, ok := r.clusters[id]
	if !ok {
		return nil, fmt.Errorf("cluster not found: %s", id)
	}

	// Return a copy
	result := *cluster
	return &result, nil
}

// GetByName retrieves a cluster by name.
func (r *ClusterRepository) GetByName(name string) (*domain.Cluster, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, cluster := range r.clusters {
		if cluster.Name == name {
			result := *cluster
			return &result, nil
		}
	}

	return nil, fmt.Errorf("cluster not found with name: %s", name)
}

// List returns all clusters, optionally filtered by project.
func (r *ClusterRepository) List(projectID string) ([]*domain.Cluster, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]*domain.Cluster, 0, len(r.clusters))
	for _, cluster := range r.clusters {
		if projectID == "" || cluster.ProjectID == projectID {
			c := *cluster
			result = append(result, &c)
		}
	}

	return result, nil
}

// Update updates an existing cluster.
func (r *ClusterRepository) Update(cluster *domain.Cluster) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	existing, ok := r.clusters[cluster.ID]
	if !ok {
		return fmt.Errorf("cluster not found: %s", cluster.ID)
	}

	// Check for duplicate name (excluding self)
	for _, c := range r.clusters {
		if c.Name == cluster.Name && c.ID != cluster.ID {
			return fmt.Errorf("cluster with name %q already exists", cluster.Name)
		}
	}

	// Preserve created timestamp
	cluster.CreatedAt = existing.CreatedAt
	cluster.UpdatedAt = time.Now()

	// Store a copy
	stored := *cluster
	r.clusters[cluster.ID] = &stored

	return nil
}

// Delete removes a cluster by ID.
func (r *ClusterRepository) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.clusters[id]; !ok {
		return fmt.Errorf("cluster not found: %s", id)
	}

	delete(r.clusters, id)
	return nil
}
