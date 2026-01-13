// Package network provides Floating IP management for external network access.
// This implements NAT-based floating IPs using OVN's NAT capabilities.
package network

import (
	"context"
	"fmt"
	"net"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/network/ovn/nbdb"
)

// =============================================================================
// FLOATING IP SERVICE
// =============================================================================

// FloatingIPService manages floating IPs for providing external access to VMs.
// It integrates with OVN to create DNAT/SNAT rules on the external router.
type FloatingIPService struct {
	logger *zap.Logger
	mu     sync.RWMutex

	// Configuration
	config FloatingIPConfig

	// In-memory state
	allocations      map[string]*FloatingIPAllocation // floatingIP -> allocation
	portAssociations map[string]string                // portID -> floatingIP
	vmAssociations   map[string][]string              // vmID -> []floatingIPs

	// External network configuration
	externalPools []*ExternalIPPool
}

// FloatingIPConfig holds service configuration.
type FloatingIPConfig struct {
	// ExternalRouterName is the name of the OVN router connected to external network
	ExternalRouterName string

	// ExternalNetworkID is the ID of the external network
	ExternalNetworkID string

	// DefaultFloatingIPPool is the default pool for allocating floating IPs
	DefaultFloatingIPPool string

	// EnableNAT64 enables NAT64 for IPv6 to IPv4 translation
	EnableNAT64 bool
}

// FloatingIPAllocation tracks a floating IP allocation.
type FloatingIPAllocation struct {
	FloatingIP    string
	ProjectID     string
	PortID        string
	FixedIP       string
	RouterID      string
	Status        string
	NATRuleUUID   string
	AllocatedAt   time.Time
	AssociatedAt  *time.Time
}

// ExternalIPPool represents a pool of external IP addresses for floating IPs.
type ExternalIPPool struct {
	ID          string
	Name        string
	CIDR        string
	Gateway     string
	StartIP     net.IP
	EndIP       net.IP
	AllocatedIPs map[string]bool // IP -> allocated
	NetworkID   string
}

// NewFloatingIPService creates a new floating IP service.
func NewFloatingIPService(config FloatingIPConfig, logger *zap.Logger) *FloatingIPService {
	return &FloatingIPService{
		logger:           logger.Named("floating-ip"),
		config:           config,
		allocations:      make(map[string]*FloatingIPAllocation),
		portAssociations: make(map[string]string),
		vmAssociations:   make(map[string][]string),
		externalPools:    make([]*ExternalIPPool, 0),
	}
}

// =============================================================================
// FLOATING IP CRUD
// =============================================================================

// AllocateFloatingIP allocates a new floating IP from a pool.
func (s *FloatingIPService) AllocateFloatingIP(ctx context.Context, req *AllocateFloatingIPRequest) (*domain.FloatingIP, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Allocating floating IP",
		zap.String("project_id", req.ProjectID),
		zap.String("pool_id", req.PoolID),
	)

	// Find the pool
	pool := s.getPool(req.PoolID)
	if pool == nil && req.PoolID != "" {
		return nil, fmt.Errorf("floating IP pool not found: %s", req.PoolID)
	}
	if pool == nil {
		pool = s.getDefaultPool()
		if pool == nil {
			return nil, fmt.Errorf("no floating IP pools configured")
		}
	}

	// Allocate IP from pool
	floatingIP, err := s.allocateFromPool(pool, req.RequestedIP)
	if err != nil {
		return nil, fmt.Errorf("failed to allocate floating IP: %w", err)
	}

	// Create allocation record
	allocation := &FloatingIPAllocation{
		FloatingIP:  floatingIP,
		ProjectID:   req.ProjectID,
		RouterID:    s.config.ExternalRouterName,
		Status:      "AVAILABLE",
		AllocatedAt: time.Now(),
	}
	s.allocations[floatingIP] = allocation

	s.logger.Info("Allocated floating IP",
		zap.String("floating_ip", floatingIP),
		zap.String("project_id", req.ProjectID),
	)

	return &domain.FloatingIP{
		ID:              generateUUID(),
		FloatingIP:      floatingIP,
		ProjectID:       req.ProjectID,
		FloatingNetwork: pool.NetworkID,
		Status: domain.FloatingIPStatus{
			Status: domain.FloatingIPStatusAvailable,
		},
	}, nil
}

// AllocateFloatingIPRequest is the request for allocating a floating IP.
type AllocateFloatingIPRequest struct {
	ProjectID   string
	PoolID      string
	RequestedIP string // Optional: specific IP to allocate
	Description string
}

// ReleaseFloatingIP releases a floating IP back to the pool.
func (s *FloatingIPService) ReleaseFloatingIP(ctx context.Context, floatingIP string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Releasing floating IP", zap.String("floating_ip", floatingIP))

	allocation, ok := s.allocations[floatingIP]
	if !ok {
		return fmt.Errorf("floating IP not found: %s", floatingIP)
	}

	// Check if associated
	if allocation.PortID != "" {
		return fmt.Errorf("floating IP %s is still associated with port %s", floatingIP, allocation.PortID)
	}

	// Return to pool
	s.releaseToPool(floatingIP)

	// Remove allocation
	delete(s.allocations, floatingIP)

	s.logger.Info("Released floating IP", zap.String("floating_ip", floatingIP))
	return nil
}

// =============================================================================
// ASSOCIATION OPERATIONS
// =============================================================================

// AssociateFloatingIP associates a floating IP with a port.
func (s *FloatingIPService) AssociateFloatingIP(ctx context.Context, req *AssociateFloatingIPRequest) (*nbdb.NAT, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Associating floating IP",
		zap.String("floating_ip", req.FloatingIP),
		zap.String("port_id", req.PortID),
		zap.String("fixed_ip", req.FixedIP),
	)

	// Validate floating IP
	allocation, ok := s.allocations[req.FloatingIP]
	if !ok {
		return nil, fmt.Errorf("floating IP not found: %s", req.FloatingIP)
	}

	if allocation.PortID != "" {
		return nil, fmt.Errorf("floating IP %s is already associated with port %s", req.FloatingIP, allocation.PortID)
	}

	// Check port isn't already associated
	if existingFIP, ok := s.portAssociations[req.PortID]; ok {
		return nil, fmt.Errorf("port %s is already associated with floating IP %s", req.PortID, existingFIP)
	}

	// Create OVN NAT rule
	nat := &nbdb.NAT{
		Type:        nbdb.NATTypeDNATAndSNAT,
		ExternalIP:  req.FloatingIP,
		LogicalIP:   req.FixedIP,
		LogicalPort: &req.PortID,
		ExternalIDs: map[string]string{
			"limiquantix-floating-ip": req.FloatingIP,
			"limiquantix-port-id":     req.PortID,
			"limiquantix-project-id":  allocation.ProjectID,
		},
	}

	// In real implementation, this would call OVN client:
	// err := ovnClient.CreateNAT(ctx, s.config.ExternalRouterName, nat)

	nat.UUID = generateUUID()

	// Update allocation
	now := time.Now()
	allocation.PortID = req.PortID
	allocation.FixedIP = req.FixedIP
	allocation.Status = "ACTIVE"
	allocation.NATRuleUUID = nat.UUID
	allocation.AssociatedAt = &now

	// Update associations
	s.portAssociations[req.PortID] = req.FloatingIP
	if req.VMID != "" {
		s.vmAssociations[req.VMID] = append(s.vmAssociations[req.VMID], req.FloatingIP)
	}

	s.logger.Info("Associated floating IP",
		zap.String("floating_ip", req.FloatingIP),
		zap.String("port_id", req.PortID),
		zap.String("nat_uuid", nat.UUID),
	)

	return nat, nil
}

// AssociateFloatingIPRequest is the request for associating a floating IP.
type AssociateFloatingIPRequest struct {
	FloatingIP string
	PortID     string
	FixedIP    string
	VMID       string
}

// DisassociateFloatingIP removes a floating IP association from a port.
func (s *FloatingIPService) DisassociateFloatingIP(ctx context.Context, floatingIP string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Disassociating floating IP", zap.String("floating_ip", floatingIP))

	allocation, ok := s.allocations[floatingIP]
	if !ok {
		return fmt.Errorf("floating IP not found: %s", floatingIP)
	}

	if allocation.PortID == "" {
		return fmt.Errorf("floating IP %s is not associated with any port", floatingIP)
	}

	// Delete OVN NAT rule
	// In real implementation:
	// err := ovnClient.DeleteNAT(ctx, allocation.NATRuleUUID)

	// Update associations
	delete(s.portAssociations, allocation.PortID)

	// Remove from VM associations
	for vmID, fips := range s.vmAssociations {
		newFips := []string{}
		for _, fip := range fips {
			if fip != floatingIP {
				newFips = append(newFips, fip)
			}
		}
		if len(newFips) > 0 {
			s.vmAssociations[vmID] = newFips
		} else {
			delete(s.vmAssociations, vmID)
		}
	}

	// Update allocation
	allocation.PortID = ""
	allocation.FixedIP = ""
	allocation.Status = "AVAILABLE"
	allocation.NATRuleUUID = ""
	allocation.AssociatedAt = nil

	s.logger.Info("Disassociated floating IP", zap.String("floating_ip", floatingIP))
	return nil
}

// =============================================================================
// PORT MIGRATION SUPPORT
// =============================================================================

// MigrateFloatingIP migrates floating IP from one port to another.
// This is used during VM migration to maintain external connectivity.
func (s *FloatingIPService) MigrateFloatingIP(ctx context.Context, floatingIP, fromPortID, toPortID, newFixedIP string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Migrating floating IP",
		zap.String("floating_ip", floatingIP),
		zap.String("from_port", fromPortID),
		zap.String("to_port", toPortID),
	)

	allocation, ok := s.allocations[floatingIP]
	if !ok {
		return fmt.Errorf("floating IP not found: %s", floatingIP)
	}

	if allocation.PortID != fromPortID {
		return fmt.Errorf("floating IP %s is not associated with port %s", floatingIP, fromPortID)
	}

	// Update OVN NAT rule to point to new port
	// In real implementation, this would update the NAT rule atomically
	// err := ovnClient.UpdateNAT(ctx, allocation.NATRuleUUID, &nbdb.NAT{
	//     LogicalIP:   newFixedIP,
	//     LogicalPort: &toPortID,
	// })

	// Update associations
	delete(s.portAssociations, fromPortID)
	s.portAssociations[toPortID] = floatingIP

	allocation.PortID = toPortID
	allocation.FixedIP = newFixedIP

	s.logger.Info("Migrated floating IP",
		zap.String("floating_ip", floatingIP),
		zap.String("to_port", toPortID),
	)

	return nil
}

// =============================================================================
// QUERIES
// =============================================================================

// GetFloatingIP returns a floating IP allocation.
func (s *FloatingIPService) GetFloatingIP(floatingIP string) *FloatingIPAllocation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.allocations[floatingIP]
}

// GetFloatingIPByPort returns the floating IP associated with a port.
func (s *FloatingIPService) GetFloatingIPByPort(portID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.portAssociations[portID]
}

// GetFloatingIPsByVM returns all floating IPs associated with a VM.
func (s *FloatingIPService) GetFloatingIPsByVM(vmID string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.vmAssociations[vmID]
}

// ListFloatingIPs returns all floating IPs for a project.
func (s *FloatingIPService) ListFloatingIPs(projectID string) []*FloatingIPAllocation {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*FloatingIPAllocation
	for _, allocation := range s.allocations {
		if projectID == "" || allocation.ProjectID == projectID {
			result = append(result, allocation)
		}
	}
	return result
}

// =============================================================================
// POOL MANAGEMENT
// =============================================================================

// AddPool adds an external IP pool.
func (s *FloatingIPService) AddPool(pool *ExternalIPPool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Adding floating IP pool",
		zap.String("name", pool.Name),
		zap.String("cidr", pool.CIDR),
	)

	if pool.AllocatedIPs == nil {
		pool.AllocatedIPs = make(map[string]bool)
	}

	s.externalPools = append(s.externalPools, pool)
	return nil
}

// RemovePool removes an external IP pool.
func (s *FloatingIPService) RemovePool(poolID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, pool := range s.externalPools {
		if pool.ID == poolID {
			// Check if any IPs are still allocated
			for ip := range pool.AllocatedIPs {
				if _, ok := s.allocations[ip]; ok {
					return fmt.Errorf("cannot remove pool: floating IP %s is still allocated", ip)
				}
			}
			s.externalPools = append(s.externalPools[:i], s.externalPools[i+1:]...)
			return nil
		}
	}

	return fmt.Errorf("pool not found: %s", poolID)
}

// GetPoolStats returns statistics for a pool.
func (s *FloatingIPService) GetPoolStats(poolID string) *PoolStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	pool := s.getPool(poolID)
	if pool == nil {
		return nil
	}

	totalIPs := s.countPoolIPs(pool)
	allocatedIPs := len(pool.AllocatedIPs)

	return &PoolStats{
		PoolID:       pool.ID,
		TotalIPs:     totalIPs,
		AllocatedIPs: allocatedIPs,
		AvailableIPs: totalIPs - allocatedIPs,
	}
}

// PoolStats holds pool statistics.
type PoolStats struct {
	PoolID       string
	TotalIPs     int
	AllocatedIPs int
	AvailableIPs int
}

// =============================================================================
// HELPERS
// =============================================================================

func (s *FloatingIPService) getPool(poolID string) *ExternalIPPool {
	for _, pool := range s.externalPools {
		if pool.ID == poolID || pool.Name == poolID {
			return pool
		}
	}
	return nil
}

func (s *FloatingIPService) getDefaultPool() *ExternalIPPool {
	if len(s.externalPools) > 0 {
		return s.externalPools[0]
	}
	return nil
}

func (s *FloatingIPService) allocateFromPool(pool *ExternalIPPool, requestedIP string) (string, error) {
	if requestedIP != "" {
		// Specific IP requested
		ip := net.ParseIP(requestedIP)
		if ip == nil {
			return "", fmt.Errorf("invalid IP address: %s", requestedIP)
		}
		if pool.AllocatedIPs[requestedIP] {
			return "", fmt.Errorf("IP address %s is already allocated", requestedIP)
		}
		pool.AllocatedIPs[requestedIP] = true
		return requestedIP, nil
	}

	// Find next available IP
	ip := make(net.IP, len(pool.StartIP))
	copy(ip, pool.StartIP)

	for s.ipLessOrEqual(ip, pool.EndIP) {
		ipStr := ip.String()
		if !pool.AllocatedIPs[ipStr] {
			pool.AllocatedIPs[ipStr] = true
			return ipStr, nil
		}
		s.incrementIP(ip)
	}

	return "", fmt.Errorf("no available IP addresses in pool %s", pool.Name)
}

func (s *FloatingIPService) releaseToPool(ip string) {
	for _, pool := range s.externalPools {
		if pool.AllocatedIPs[ip] {
			delete(pool.AllocatedIPs, ip)
			return
		}
	}
}

func (s *FloatingIPService) countPoolIPs(pool *ExternalIPPool) int {
	if pool.StartIP == nil || pool.EndIP == nil {
		return 0
	}

	start := ipToInt(pool.StartIP)
	end := ipToInt(pool.EndIP)
	return int(end - start + 1)
}

func (s *FloatingIPService) ipLessOrEqual(a, b net.IP) bool {
	return ipToInt(a) <= ipToInt(b)
}

func (s *FloatingIPService) incrementIP(ip net.IP) {
	for i := len(ip) - 1; i >= 0; i-- {
		ip[i]++
		if ip[i] > 0 {
			break
		}
	}
}

func ipToInt(ip net.IP) uint32 {
	ip = ip.To4()
	if ip == nil {
		return 0
	}
	return uint32(ip[0])<<24 | uint32(ip[1])<<16 | uint32(ip[2])<<8 | uint32(ip[3])
}
