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

// =============================================================================
// BGP REPOSITORY
// =============================================================================

// BGPRepository is an in-memory implementation of network.BGPRepository.
type BGPRepository struct {
	speakers       sync.Map // map[string]*domain.BGPSpeaker
	peers          sync.Map // map[string]*domain.BGPPeer
	advertisements sync.Map // map[string]*domain.BGPAdvertisement
}

// NewBGPRepository creates a new in-memory BGP repository.
func NewBGPRepository() *BGPRepository {
	return &BGPRepository{}
}

// CreateSpeaker adds a new BGP speaker.
func (r *BGPRepository) CreateSpeaker(ctx context.Context, speaker *domain.BGPSpeaker) (*domain.BGPSpeaker, error) {
	if speaker.ID == "" {
		speaker.ID = uuid.NewString()
	}
	now := time.Now()
	speaker.CreatedAt = now
	speaker.UpdatedAt = now
	r.speakers.Store(speaker.ID, speaker)
	return speaker, nil
}

// GetSpeaker retrieves a BGP speaker by ID.
func (r *BGPRepository) GetSpeaker(ctx context.Context, id string) (*domain.BGPSpeaker, error) {
	if val, ok := r.speakers.Load(id); ok {
		return val.(*domain.BGPSpeaker), nil
	}
	return nil, domain.ErrNotFound
}

// ListSpeakers retrieves BGP speakers based on filter criteria.
func (r *BGPRepository) ListSpeakers(ctx context.Context, projectID string, limit int, offset int) ([]*domain.BGPSpeaker, int, error) {
	var result []*domain.BGPSpeaker
	var total int

	r.speakers.Range(func(key, value interface{}) bool {
		speaker := value.(*domain.BGPSpeaker)

		if projectID != "" && speaker.ProjectID != projectID {
			return true
		}

		total++
		result = append(result, speaker)
		return true
	})

	// Apply pagination
	if offset >= len(result) {
		return []*domain.BGPSpeaker{}, total, nil
	}
	end := offset + limit
	if limit <= 0 {
		end = len(result)
	} else if end > len(result) {
		end = len(result)
	}

	return result[offset:end], total, nil
}

// UpdateSpeaker modifies an existing BGP speaker.
func (r *BGPRepository) UpdateSpeaker(ctx context.Context, speaker *domain.BGPSpeaker) (*domain.BGPSpeaker, error) {
	if _, ok := r.speakers.Load(speaker.ID); !ok {
		return nil, domain.ErrNotFound
	}
	speaker.UpdatedAt = time.Now()
	r.speakers.Store(speaker.ID, speaker)
	return speaker, nil
}

// DeleteSpeaker removes a BGP speaker by ID.
func (r *BGPRepository) DeleteSpeaker(ctx context.Context, id string) error {
	if _, ok := r.speakers.Load(id); !ok {
		return domain.ErrNotFound
	}
	r.speakers.Delete(id)
	return nil
}

// CreatePeer adds a new BGP peer.
func (r *BGPRepository) CreatePeer(ctx context.Context, peer *domain.BGPPeer) (*domain.BGPPeer, error) {
	if peer.ID == "" {
		peer.ID = uuid.NewString()
	}
	peer.CreatedAt = time.Now()
	r.peers.Store(peer.ID, peer)
	return peer, nil
}

// GetPeer retrieves a BGP peer by ID.
func (r *BGPRepository) GetPeer(ctx context.Context, id string) (*domain.BGPPeer, error) {
	if val, ok := r.peers.Load(id); ok {
		return val.(*domain.BGPPeer), nil
	}
	return nil, domain.ErrNotFound
}

// ListPeers retrieves BGP peers for a speaker.
func (r *BGPRepository) ListPeers(ctx context.Context, speakerID string) ([]*domain.BGPPeer, error) {
	var result []*domain.BGPPeer

	r.peers.Range(func(key, value interface{}) bool {
		peer := value.(*domain.BGPPeer)
		if peer.SpeakerID == speakerID {
			result = append(result, peer)
		}
		return true
	})

	return result, nil
}

// UpdatePeer modifies an existing BGP peer.
func (r *BGPRepository) UpdatePeer(ctx context.Context, peer *domain.BGPPeer) (*domain.BGPPeer, error) {
	if _, ok := r.peers.Load(peer.ID); !ok {
		return nil, domain.ErrNotFound
	}
	r.peers.Store(peer.ID, peer)
	return peer, nil
}

// DeletePeer removes a BGP peer by ID.
func (r *BGPRepository) DeletePeer(ctx context.Context, id string) error {
	if _, ok := r.peers.Load(id); !ok {
		return domain.ErrNotFound
	}
	r.peers.Delete(id)
	return nil
}

// CreateAdvertisement adds a new BGP advertisement.
func (r *BGPRepository) CreateAdvertisement(ctx context.Context, adv *domain.BGPAdvertisement) (*domain.BGPAdvertisement, error) {
	if adv.ID == "" {
		adv.ID = uuid.NewString()
	}
	adv.CreatedAt = time.Now()
	r.advertisements.Store(adv.ID, adv)
	return adv, nil
}

// ListAdvertisements retrieves BGP advertisements for a speaker.
func (r *BGPRepository) ListAdvertisements(ctx context.Context, speakerID string) ([]*domain.BGPAdvertisement, error) {
	var result []*domain.BGPAdvertisement

	r.advertisements.Range(func(key, value interface{}) bool {
		adv := value.(*domain.BGPAdvertisement)
		if adv.SpeakerID == speakerID {
			result = append(result, adv)
		}
		return true
	})

	return result, nil
}

// DeleteAdvertisement removes a BGP advertisement by ID.
func (r *BGPRepository) DeleteAdvertisement(ctx context.Context, id string) error {
	if _, ok := r.advertisements.Load(id); !ok {
		return domain.ErrNotFound
	}
	r.advertisements.Delete(id)
	return nil
}
