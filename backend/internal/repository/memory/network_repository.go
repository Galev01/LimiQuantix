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

// =============================================================================
// LOAD BALANCER REPOSITORY
// =============================================================================

// LoadBalancerRepository is an in-memory implementation of network.LoadBalancerRepository.
type LoadBalancerRepository struct {
	store sync.Map // map[string]*domain.LoadBalancer
}

// NewLoadBalancerRepository creates a new in-memory load balancer repository.
func NewLoadBalancerRepository() *LoadBalancerRepository {
	return &LoadBalancerRepository{}
}

// Create adds a new load balancer to the store.
func (r *LoadBalancerRepository) Create(ctx context.Context, lb *domain.LoadBalancer) (*domain.LoadBalancer, error) {
	if lb.ID == "" {
		lb.ID = uuid.NewString()
	}

	// Check name uniqueness within project
	var exists bool
	r.store.Range(func(key, value interface{}) bool {
		existing := value.(*domain.LoadBalancer)
		if existing.ProjectID == lb.ProjectID && existing.Name == lb.Name {
			exists = true
			return false
		}
		return true
	})
	if exists {
		return nil, domain.ErrAlreadyExists
	}

	now := time.Now()
	lb.CreatedAt = now
	lb.UpdatedAt = now
	r.store.Store(lb.ID, lb)
	return lb, nil
}

// Get retrieves a load balancer by ID.
func (r *LoadBalancerRepository) Get(ctx context.Context, id string) (*domain.LoadBalancer, error) {
	if val, ok := r.store.Load(id); ok {
		return val.(*domain.LoadBalancer), nil
	}
	return nil, domain.ErrNotFound
}

// List retrieves load balancers based on filter criteria.
func (r *LoadBalancerRepository) List(ctx context.Context, filter network.LBFilter, limit int, offset int) ([]*domain.LoadBalancer, int, error) {
	var result []*domain.LoadBalancer
	var total int

	r.store.Range(func(key, value interface{}) bool {
		lb := value.(*domain.LoadBalancer)

		// Apply filters
		if filter.ProjectID != "" && lb.ProjectID != filter.ProjectID {
			return true
		}
		if filter.NetworkID != "" && lb.NetworkID != filter.NetworkID {
			return true
		}

		total++
		result = append(result, lb)
		return true
	})

	// Apply pagination
	if offset >= len(result) {
		return []*domain.LoadBalancer{}, total, nil
	}
	end := offset + limit
	if limit <= 0 {
		end = len(result)
	} else if end > len(result) {
		end = len(result)
	}

	return result[offset:end], total, nil
}

// Update modifies an existing load balancer.
func (r *LoadBalancerRepository) Update(ctx context.Context, lb *domain.LoadBalancer) (*domain.LoadBalancer, error) {
	if _, ok := r.store.Load(lb.ID); !ok {
		return nil, domain.ErrNotFound
	}
	lb.UpdatedAt = time.Now()
	r.store.Store(lb.ID, lb)
	return lb, nil
}

// Delete removes a load balancer by ID.
func (r *LoadBalancerRepository) Delete(ctx context.Context, id string) error {
	if _, ok := r.store.Load(id); !ok {
		return domain.ErrNotFound
	}
	r.store.Delete(id)
	return nil
}

// ListByNetwork retrieves load balancers attached to a specific network.
func (r *LoadBalancerRepository) ListByNetwork(ctx context.Context, networkID string) ([]*domain.LoadBalancer, error) {
	var result []*domain.LoadBalancer

	r.store.Range(func(key, value interface{}) bool {
		lb := value.(*domain.LoadBalancer)
		if lb.NetworkID == networkID {
			result = append(result, lb)
		}
		return true
	})

	return result, nil
}

// =============================================================================
// VPN REPOSITORY
// =============================================================================

// VpnRepository is an in-memory implementation of network.VpnRepository.
type VpnRepository struct {
	store sync.Map // map[string]*domain.VpnService
}

// NewVpnRepository creates a new in-memory VPN repository.
func NewVpnRepository() *VpnRepository {
	return &VpnRepository{}
}

// Create adds a new VPN service to the store.
func (r *VpnRepository) Create(ctx context.Context, vpn *domain.VpnService) (*domain.VpnService, error) {
	if vpn.ID == "" {
		vpn.ID = uuid.NewString()
	}

	// Check name uniqueness within project
	var exists bool
	r.store.Range(func(key, value interface{}) bool {
		existing := value.(*domain.VpnService)
		if existing.ProjectID == vpn.ProjectID && existing.Name == vpn.Name {
			exists = true
			return false
		}
		return true
	})
	if exists {
		return nil, domain.ErrAlreadyExists
	}

	now := time.Now()
	vpn.CreatedAt = now
	vpn.UpdatedAt = now
	r.store.Store(vpn.ID, vpn)
	return vpn, nil
}

// Get retrieves a VPN service by ID.
func (r *VpnRepository) Get(ctx context.Context, id string) (*domain.VpnService, error) {
	if val, ok := r.store.Load(id); ok {
		return val.(*domain.VpnService), nil
	}
	return nil, domain.ErrNotFound
}

// List retrieves VPN services based on filter criteria.
func (r *VpnRepository) List(ctx context.Context, projectID string, limit int, offset int) ([]*domain.VpnService, int, error) {
	var result []*domain.VpnService
	var total int

	r.store.Range(func(key, value interface{}) bool {
		vpn := value.(*domain.VpnService)

		// Apply filter
		if projectID != "" && vpn.ProjectID != projectID {
			return true
		}

		total++
		result = append(result, vpn)
		return true
	})

	// Apply pagination
	if offset >= len(result) {
		return []*domain.VpnService{}, total, nil
	}
	end := offset + limit
	if limit <= 0 {
		end = len(result)
	} else if end > len(result) {
		end = len(result)
	}

	return result[offset:end], total, nil
}

// Update modifies an existing VPN service.
func (r *VpnRepository) Update(ctx context.Context, vpn *domain.VpnService) (*domain.VpnService, error) {
	if _, ok := r.store.Load(vpn.ID); !ok {
		return nil, domain.ErrNotFound
	}
	vpn.UpdatedAt = time.Now()
	r.store.Store(vpn.ID, vpn)
	return vpn, nil
}

// Delete removes a VPN service by ID.
func (r *VpnRepository) Delete(ctx context.Context, id string) error {
	if _, ok := r.store.Load(id); !ok {
		return domain.ErrNotFound
	}
	r.store.Delete(id)
	return nil
}
