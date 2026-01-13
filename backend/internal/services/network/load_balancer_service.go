// Package network provides Load Balancer management using OVN's native LB.
// This implements L4 load balancing with TCP/UDP support.
package network

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/network/ovn/nbdb"
)

// =============================================================================
// LOAD BALANCER SERVICE
// =============================================================================

// LoadBalancerService manages OVN load balancers for Quantix-vDC.
// It provides L4 (TCP/UDP) load balancing capabilities.
type LoadBalancerService struct {
	logger *zap.Logger
	mu     sync.RWMutex

	// In-memory state
	loadBalancers map[string]*LoadBalancerState // lbID -> state
	listeners     map[string]*ListenerState     // listenerID -> state
	pools         map[string]*PoolState         // poolID -> state
	members       map[string]*MemberState       // memberID -> state

	// Configuration
	config LoadBalancerConfig
}

// LoadBalancerConfig holds service configuration.
type LoadBalancerConfig struct {
	// DefaultAlgorithm is the default load balancing algorithm
	DefaultAlgorithm string // "round-robin", "ip-hash"

	// HealthCheckInterval is the default health check interval
	HealthCheckInterval time.Duration

	// HealthCheckTimeout is the default health check timeout
	HealthCheckTimeout time.Duration

	// HealthCheckRetries is the number of retries before marking member unhealthy
	HealthCheckRetries int
}

// DefaultLoadBalancerConfig returns sensible defaults.
func DefaultLoadBalancerConfig() LoadBalancerConfig {
	return LoadBalancerConfig{
		DefaultAlgorithm:    "round-robin",
		HealthCheckInterval: 10 * time.Second,
		HealthCheckTimeout:  5 * time.Second,
		HealthCheckRetries:  3,
	}
}

// LoadBalancerState holds the state of a load balancer.
type LoadBalancerState struct {
	LB           *domain.LoadBalancer
	OVNUUID      string
	ListenerIDs  []string
	PoolIDs      []string
	NetworkID    string
	VIP          string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// ListenerState holds the state of a listener.
type ListenerState struct {
	Listener     *domain.LoadBalancerListener
	LoadBalancerID string
	DefaultPoolID  string
}

// PoolState holds the state of a pool.
type PoolState struct {
	Pool           *domain.LoadBalancerPool
	LoadBalancerID string
	MemberIDs      []string
	HealthCheckID  string
}

// MemberState holds the state of a pool member.
type MemberState struct {
	Member   *domain.LoadBalancerMember
	PoolID   string
	Status   string
	LastCheck time.Time
}

// NewLoadBalancerService creates a new load balancer service.
func NewLoadBalancerService(config LoadBalancerConfig, logger *zap.Logger) *LoadBalancerService {
	return &LoadBalancerService{
		logger:        logger.Named("lb-service"),
		config:        config,
		loadBalancers: make(map[string]*LoadBalancerState),
		listeners:     make(map[string]*ListenerState),
		pools:         make(map[string]*PoolState),
		members:       make(map[string]*MemberState),
	}
}

// =============================================================================
// LOAD BALANCER OPERATIONS
// =============================================================================

// CreateLoadBalancer creates a new load balancer.
func (s *LoadBalancerService) CreateLoadBalancer(ctx context.Context, lb *domain.LoadBalancer) (*nbdb.LoadBalancer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Creating load balancer",
		zap.String("id", lb.ID),
		zap.String("name", lb.Name),
	)

	// Create OVN load balancer
	ovnLB := &nbdb.LoadBalancer{
		Name:     fmt.Sprintf("lb-%s", lb.ID),
		VIPs:     make(map[string]string),
		Protocol: nil,
		Options: map[string]string{
			"affinity_timeout":   "0",
			"reject":             "true",
			"hairpin_snat_ip":    "",
		},
		ExternalIDs: map[string]string{
			"limiquantix-lb-id":      lb.ID,
			"limiquantix-project-id": lb.ProjectID,
			"limiquantix-name":       lb.Name,
		},
	}

	// Set protocol if specified
	if lb.Spec.Protocol != "" {
		proto := strings.ToLower(lb.Spec.Protocol)
		ovnLB.Protocol = &proto
	}

	// Configure selection fields based on algorithm
	switch lb.Spec.Algorithm {
	case "source-ip", "ip-hash":
		ovnLB.SelectionFields = []string{"ip_src", "ip_dst"}
	default:
		// round-robin is default (no selection fields)
	}

	// In real implementation:
	// err := ovnClient.CreateLoadBalancer(ctx, ovnLB)

	ovnLB.UUID = generateUUID()

	// Store state
	s.loadBalancers[lb.ID] = &LoadBalancerState{
		LB:        lb,
		OVNUUID:   ovnLB.UUID,
		NetworkID: lb.Spec.NetworkID,
		VIP:       lb.Spec.VIP,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	s.logger.Info("Created load balancer",
		zap.String("id", lb.ID),
		zap.String("ovn_uuid", ovnLB.UUID),
	)

	return ovnLB, nil
}

// DeleteLoadBalancer deletes a load balancer.
func (s *LoadBalancerService) DeleteLoadBalancer(ctx context.Context, lbID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Deleting load balancer", zap.String("id", lbID))

	state, ok := s.loadBalancers[lbID]
	if !ok {
		return fmt.Errorf("load balancer not found: %s", lbID)
	}

	// Delete all listeners
	for _, listenerID := range state.ListenerIDs {
		delete(s.listeners, listenerID)
	}

	// Delete all pools and members
	for _, poolID := range state.PoolIDs {
		if poolState, ok := s.pools[poolID]; ok {
			for _, memberID := range poolState.MemberIDs {
				delete(s.members, memberID)
			}
			delete(s.pools, poolID)
		}
	}

	// Delete from OVN
	// In real implementation:
	// err := ovnClient.DeleteLoadBalancer(ctx, state.OVNUUID)

	delete(s.loadBalancers, lbID)

	s.logger.Info("Deleted load balancer", zap.String("id", lbID))
	return nil
}

// =============================================================================
// LISTENER OPERATIONS
// =============================================================================

// AddListener adds a listener to a load balancer.
func (s *LoadBalancerService) AddListener(ctx context.Context, lbID string, listener *domain.LoadBalancerListener) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Adding listener",
		zap.String("lb_id", lbID),
		zap.Int("port", listener.Port),
		zap.String("protocol", listener.Protocol),
	)

	state, ok := s.loadBalancers[lbID]
	if !ok {
		return fmt.Errorf("load balancer not found: %s", lbID)
	}

	// Update OVN VIPs
	// VIP format: "vip:port" -> "backend1:port,backend2:port"
	vipKey := fmt.Sprintf("%s:%d", state.VIP, listener.Port)

	// For now, just record the listener
	// Backends will be added when members are added to the pool

	// Store listener state
	s.listeners[listener.ID] = &ListenerState{
		Listener:       listener,
		LoadBalancerID: lbID,
		DefaultPoolID:  listener.DefaultPoolID,
	}

	state.ListenerIDs = append(state.ListenerIDs, listener.ID)
	state.UpdatedAt = time.Now()

	s.logger.Info("Added listener",
		zap.String("listener_id", listener.ID),
		zap.String("vip_key", vipKey),
	)

	return nil
}

// RemoveListener removes a listener from a load balancer.
func (s *LoadBalancerService) RemoveListener(ctx context.Context, lbID, listenerID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Removing listener",
		zap.String("lb_id", lbID),
		zap.String("listener_id", listenerID),
	)

	state, ok := s.loadBalancers[lbID]
	if !ok {
		return fmt.Errorf("load balancer not found: %s", lbID)
	}

	// Remove from state
	newListeners := []string{}
	for _, id := range state.ListenerIDs {
		if id != listenerID {
			newListeners = append(newListeners, id)
		}
	}
	state.ListenerIDs = newListeners

	delete(s.listeners, listenerID)

	// Update OVN (remove VIP)
	// In real implementation, update the OVN load balancer

	return nil
}

// =============================================================================
// POOL OPERATIONS
// =============================================================================

// CreatePool creates a pool for a load balancer.
func (s *LoadBalancerService) CreatePool(ctx context.Context, lbID string, pool *domain.LoadBalancerPool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Creating pool",
		zap.String("lb_id", lbID),
		zap.String("pool_id", pool.ID),
		zap.String("algorithm", pool.Algorithm),
	)

	state, ok := s.loadBalancers[lbID]
	if !ok {
		return fmt.Errorf("load balancer not found: %s", lbID)
	}

	// Store pool state
	s.pools[pool.ID] = &PoolState{
		Pool:           pool,
		LoadBalancerID: lbID,
		MemberIDs:      []string{},
	}

	state.PoolIDs = append(state.PoolIDs, pool.ID)
	state.UpdatedAt = time.Now()

	return nil
}

// DeletePool deletes a pool.
func (s *LoadBalancerService) DeletePool(ctx context.Context, poolID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Deleting pool", zap.String("pool_id", poolID))

	poolState, ok := s.pools[poolID]
	if !ok {
		return fmt.Errorf("pool not found: %s", poolID)
	}

	// Delete all members
	for _, memberID := range poolState.MemberIDs {
		delete(s.members, memberID)
	}

	// Remove from load balancer state
	if lbState, ok := s.loadBalancers[poolState.LoadBalancerID]; ok {
		newPools := []string{}
		for _, id := range lbState.PoolIDs {
			if id != poolID {
				newPools = append(newPools, id)
			}
		}
		lbState.PoolIDs = newPools
	}

	delete(s.pools, poolID)

	return nil
}

// =============================================================================
// MEMBER OPERATIONS
// =============================================================================

// AddMember adds a member to a pool.
func (s *LoadBalancerService) AddMember(ctx context.Context, poolID string, member *domain.LoadBalancerMember) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Adding member to pool",
		zap.String("pool_id", poolID),
		zap.String("member_id", member.ID),
		zap.String("address", member.Address),
		zap.Int("port", member.Port),
	)

	poolState, ok := s.pools[poolID]
	if !ok {
		return fmt.Errorf("pool not found: %s", poolID)
	}

	// Store member state
	s.members[member.ID] = &MemberState{
		Member:   member,
		PoolID:   poolID,
		Status:   "ONLINE",
		LastCheck: time.Now(),
	}

	poolState.MemberIDs = append(poolState.MemberIDs, member.ID)

	// Update OVN load balancer VIPs
	err := s.updateOVNVIPs(poolState.LoadBalancerID)
	if err != nil {
		s.logger.Error("Failed to update OVN VIPs", zap.Error(err))
	}

	return nil
}

// RemoveMember removes a member from a pool.
func (s *LoadBalancerService) RemoveMember(ctx context.Context, poolID, memberID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Removing member from pool",
		zap.String("pool_id", poolID),
		zap.String("member_id", memberID),
	)

	poolState, ok := s.pools[poolID]
	if !ok {
		return fmt.Errorf("pool not found: %s", poolID)
	}

	// Remove member
	newMembers := []string{}
	for _, id := range poolState.MemberIDs {
		if id != memberID {
			newMembers = append(newMembers, id)
		}
	}
	poolState.MemberIDs = newMembers

	delete(s.members, memberID)

	// Update OVN load balancer VIPs
	err := s.updateOVNVIPs(poolState.LoadBalancerID)
	if err != nil {
		s.logger.Error("Failed to update OVN VIPs", zap.Error(err))
	}

	return nil
}

// SetMemberWeight sets the weight of a member (for weighted algorithms).
func (s *LoadBalancerService) SetMemberWeight(ctx context.Context, memberID string, weight int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	memberState, ok := s.members[memberID]
	if !ok {
		return fmt.Errorf("member not found: %s", memberID)
	}

	memberState.Member.Weight = weight

	// Update OVN
	poolState := s.pools[memberState.PoolID]
	if poolState != nil {
		return s.updateOVNVIPs(poolState.LoadBalancerID)
	}

	return nil
}

// SetMemberStatus sets the admin status of a member.
func (s *LoadBalancerService) SetMemberStatus(ctx context.Context, memberID string, enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	memberState, ok := s.members[memberID]
	if !ok {
		return fmt.Errorf("member not found: %s", memberID)
	}

	if enabled {
		memberState.Status = "ONLINE"
	} else {
		memberState.Status = "DISABLED"
	}

	// Update OVN
	poolState := s.pools[memberState.PoolID]
	if poolState != nil {
		return s.updateOVNVIPs(poolState.LoadBalancerID)
	}

	return nil
}

// =============================================================================
// HEALTH CHECK
// =============================================================================

// ConfigureHealthCheck configures health checking for a pool.
func (s *LoadBalancerService) ConfigureHealthCheck(ctx context.Context, poolID string, config *HealthCheckConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Configuring health check",
		zap.String("pool_id", poolID),
		zap.String("type", config.Type),
	)

	poolState, ok := s.pools[poolID]
	if !ok {
		return fmt.Errorf("pool not found: %s", poolID)
	}

	// Create OVN health check
	ovnHC := &nbdb.LoadBalancerHealthCheck{
		VIP: fmt.Sprintf("%s:%d", s.getLoadBalancerVIP(poolState.LoadBalancerID), s.getListenerPort(poolState.LoadBalancerID)),
		Options: map[string]string{
			"interval":   fmt.Sprintf("%d", int(config.Interval.Seconds())),
			"timeout":    fmt.Sprintf("%d", int(config.Timeout.Seconds())),
			"failure_count": fmt.Sprintf("%d", config.FailureCount),
			"success_count": fmt.Sprintf("%d", config.SuccessCount),
		},
		ExternalIDs: map[string]string{
			"limiquantix-pool-id": poolID,
		},
	}

	// In real implementation:
	// err := ovnClient.CreateLoadBalancerHealthCheck(ctx, ovnHC)

	ovnHC.UUID = generateUUID()
	poolState.HealthCheckID = ovnHC.UUID

	return nil
}

// HealthCheckConfig holds health check configuration.
type HealthCheckConfig struct {
	Type         string        // "TCP", "HTTP", "HTTPS"
	Interval     time.Duration
	Timeout      time.Duration
	FailureCount int
	SuccessCount int
	HTTPPath     string // For HTTP/HTTPS checks
	HTTPMethod   string
}

// =============================================================================
// OVN VIP MANAGEMENT
// =============================================================================

// updateOVNVIPs updates the OVN load balancer VIPs based on current state.
func (s *LoadBalancerService) updateOVNVIPs(lbID string) error {
	lbState, ok := s.loadBalancers[lbID]
	if !ok {
		return fmt.Errorf("load balancer not found: %s", lbID)
	}

	// Build VIP map
	vips := make(map[string]string)

	for _, listenerID := range lbState.ListenerIDs {
		listener, ok := s.listeners[listenerID]
		if !ok {
			continue
		}

		// Get pool for this listener
		poolID := listener.DefaultPoolID
		if poolID == "" {
			continue
		}

		poolState, ok := s.pools[poolID]
		if !ok {
			continue
		}

		// Build backends string
		backends := []string{}
		for _, memberID := range poolState.MemberIDs {
			memberState, ok := s.members[memberID]
			if !ok {
				continue
			}

			// Skip disabled members
			if memberState.Status == "DISABLED" {
				continue
			}

			backend := fmt.Sprintf("%s:%d", memberState.Member.Address, memberState.Member.Port)

			// Add weight if specified
			if memberState.Member.Weight > 0 && poolState.Pool.Algorithm == "weighted-round-robin" {
				// OVN doesn't directly support weights, but we can replicate backends
				for i := 0; i < memberState.Member.Weight; i++ {
					backends = append(backends, backend)
				}
			} else {
				backends = append(backends, backend)
			}
		}

		if len(backends) > 0 {
			vipKey := fmt.Sprintf("%s:%d", lbState.VIP, listener.Listener.Port)
			vips[vipKey] = strings.Join(backends, ",")
		}
	}

	s.logger.Debug("Updated OVN VIPs",
		zap.String("lb_id", lbID),
		zap.Any("vips", vips),
	)

	// In real implementation:
	// ovnLB := &nbdb.LoadBalancer{UUID: lbState.OVNUUID, VIPs: vips}
	// err := ovnClient.UpdateLoadBalancer(ctx, ovnLB)

	return nil
}

// =============================================================================
// QUERIES
// =============================================================================

// GetLoadBalancer returns load balancer state.
func (s *LoadBalancerService) GetLoadBalancer(lbID string) *LoadBalancerState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.loadBalancers[lbID]
}

// ListLoadBalancers returns all load balancers.
func (s *LoadBalancerService) ListLoadBalancers(projectID string) []*LoadBalancerState {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*LoadBalancerState
	for _, state := range s.loadBalancers {
		if projectID == "" || state.LB.ProjectID == projectID {
			result = append(result, state)
		}
	}
	return result
}

// GetPoolMembers returns members of a pool.
func (s *LoadBalancerService) GetPoolMembers(poolID string) []*MemberState {
	s.mu.RLock()
	defer s.mu.RUnlock()

	poolState, ok := s.pools[poolID]
	if !ok {
		return nil
	}

	var result []*MemberState
	for _, memberID := range poolState.MemberIDs {
		if member, ok := s.members[memberID]; ok {
			result = append(result, member)
		}
	}
	return result
}

// GetLoadBalancerStats returns statistics for a load balancer.
func (s *LoadBalancerService) GetLoadBalancerStats(lbID string) *LoadBalancerStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	state, ok := s.loadBalancers[lbID]
	if !ok {
		return nil
	}

	totalMembers := 0
	activeMembers := 0

	for _, poolID := range state.PoolIDs {
		if poolState, ok := s.pools[poolID]; ok {
			for _, memberID := range poolState.MemberIDs {
				totalMembers++
				if member, ok := s.members[memberID]; ok {
					if member.Status == "ONLINE" {
						activeMembers++
					}
				}
			}
		}
	}

	return &LoadBalancerStats{
		LoadBalancerID: lbID,
		ListenerCount:  len(state.ListenerIDs),
		PoolCount:      len(state.PoolIDs),
		TotalMembers:   totalMembers,
		ActiveMembers:  activeMembers,
	}
}

// LoadBalancerStats holds load balancer statistics.
type LoadBalancerStats struct {
	LoadBalancerID string
	ListenerCount  int
	PoolCount      int
	TotalMembers   int
	ActiveMembers  int
}

// =============================================================================
// HELPERS
// =============================================================================

func (s *LoadBalancerService) getLoadBalancerVIP(lbID string) string {
	if state, ok := s.loadBalancers[lbID]; ok {
		return state.VIP
	}
	return ""
}

func (s *LoadBalancerService) getListenerPort(lbID string) int {
	if state, ok := s.loadBalancers[lbID]; ok {
		if len(state.ListenerIDs) > 0 {
			if listener, ok := s.listeners[state.ListenerIDs[0]]; ok {
				return listener.Listener.Port
			}
		}
	}
	return 0
}
