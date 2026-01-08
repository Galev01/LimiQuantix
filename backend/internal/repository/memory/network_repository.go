// Package memory provides in-memory repository implementations for development.
package memory

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/services/network"
)

// NetworkRepository is an in-memory implementation of network.NetworkRepository.
type NetworkRepository struct {
	store sync.Map // map[string]*domain.VirtualNetwork
}

// NewNetworkRepository creates a new in-memory network repository.
func NewNetworkRepository() *NetworkRepository {
	return &NetworkRepository{}
}

// Create adds a new virtual network to the store.
func (r *NetworkRepository) Create(ctx context.Context, net *domain.VirtualNetwork) (*domain.VirtualNetwork, error) {
	if net.ID == "" {
		net.ID = uuid.NewString()
	}

	// Check name uniqueness within project
	var exists bool
	r.store.Range(func(key, value interface{}) bool {
		existing := value.(*domain.VirtualNetwork)
		if existing.ProjectID == net.ProjectID && existing.Name == net.Name {
			exists = true
			return false
		}
		return true
	})
	if exists {
		return nil, domain.ErrAlreadyExists
	}

	now := time.Now()
	net.CreatedAt = now
	net.UpdatedAt = now
	r.store.Store(net.ID, net)
	return net, nil
}

// Get retrieves a virtual network by ID.
func (r *NetworkRepository) Get(ctx context.Context, id string) (*domain.VirtualNetwork, error) {
	if val, ok := r.store.Load(id); ok {
		return val.(*domain.VirtualNetwork), nil
	}
	return nil, domain.ErrNotFound
}

// GetByName retrieves a virtual network by name within a project.
func (r *NetworkRepository) GetByName(ctx context.Context, projectID, name string) (*domain.VirtualNetwork, error) {
	var found *domain.VirtualNetwork
	r.store.Range(func(key, value interface{}) bool {
		net := value.(*domain.VirtualNetwork)
		if net.ProjectID == projectID && net.Name == name {
			found = net
			return false
		}
		return true
	})
	if found != nil {
		return found, nil
	}
	return nil, domain.ErrNotFound
}

// List retrieves virtual networks based on filter criteria.
func (r *NetworkRepository) List(ctx context.Context, filter network.NetworkFilter, limit int, offset int) ([]*domain.VirtualNetwork, int, error) {
	var result []*domain.VirtualNetwork
	var total int

	r.store.Range(func(key, value interface{}) bool {
		net := value.(*domain.VirtualNetwork)

		// Apply filters
		if filter.ProjectID != "" && net.ProjectID != filter.ProjectID {
			return true
		}
		if filter.NetworkType != "" && net.Spec.Type != filter.NetworkType {
			return true
		}
		if len(filter.Labels) > 0 {
			for k, v := range filter.Labels {
				if net.Labels[k] != v {
					return true
				}
			}
		}

		total++
		result = append(result, net)
		return true
	})

	// Apply pagination
	if offset >= len(result) {
		return []*domain.VirtualNetwork{}, total, nil
	}
	end := offset + limit
	if end > len(result) {
		end = len(result)
	}

	return result[offset:end], total, nil
}

// Update modifies an existing virtual network.
func (r *NetworkRepository) Update(ctx context.Context, net *domain.VirtualNetwork) (*domain.VirtualNetwork, error) {
	if _, ok := r.store.Load(net.ID); !ok {
		return nil, domain.ErrNotFound
	}
	net.UpdatedAt = time.Now()
	r.store.Store(net.ID, net)
	return net, nil
}

// Delete removes a virtual network by ID.
func (r *NetworkRepository) Delete(ctx context.Context, id string) error {
	if _, ok := r.store.Load(id); !ok {
		return domain.ErrNotFound
	}
	r.store.Delete(id)
	return nil
}

// UpdateStatus updates the status of a virtual network.
func (r *NetworkRepository) UpdateStatus(ctx context.Context, id string, status domain.VirtualNetworkStatus) error {
	if val, ok := r.store.Load(id); ok {
		net := val.(*domain.VirtualNetwork)
		net.Status = status
		net.UpdatedAt = time.Now()
		r.store.Store(id, net)
		return nil
	}
	return domain.ErrNotFound
}
