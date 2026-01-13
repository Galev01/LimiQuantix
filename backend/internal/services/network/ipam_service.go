// Package network implements the IPAM (IP Address Management) service.
// This service handles IP allocation, MAC generation, and pool management
// for QuantumNet virtual networks.
package network

import (
	"context"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/network/ovn"
)

// =============================================================================
// IPAM SERVICE
// =============================================================================

// IPAMService manages IP address allocation for virtual networks.
type IPAMService struct {
	repo      *IPAMRepository
	ovnClient *ovn.NorthboundClient
	logger    *zap.Logger

	// Per-network locks for thread-safe allocation
	poolLocks   map[string]*sync.Mutex
	poolLocksMu sync.Mutex

	// In-memory cache for hot pools
	poolCache   map[string]*cachedPool
	poolCacheMu sync.RWMutex
}

// cachedPool holds cached pool data with allocation bitmap.
type cachedPool struct {
	pool      *SubnetPool
	allocated map[string]bool // IP -> allocated
	lastSync  time.Time
}

// NewIPAMService creates a new IPAM service.
func NewIPAMService(repo *IPAMRepository, logger *zap.Logger) *IPAMService {
	return &IPAMService{
		repo:      repo,
		logger:    logger.Named("ipam"),
		poolLocks: make(map[string]*sync.Mutex),
		poolCache: make(map[string]*cachedPool),
	}
}

// NewIPAMServiceWithOVN creates a new IPAM service with OVN integration.
func NewIPAMServiceWithOVN(repo *IPAMRepository, ovnClient *ovn.NorthboundClient, logger *zap.Logger) *IPAMService {
	svc := NewIPAMService(repo, logger)
	svc.ovnClient = ovnClient
	return svc
}

// =============================================================================
// POOL MANAGEMENT
// =============================================================================

// CreatePoolSpec defines the specification for creating a subnet pool.
type CreatePoolSpec struct {
	NetworkID    string
	CIDR         string
	Gateway      string
	DHCPEnabled  bool
	DNSServers   []string
	NTPServers   []string
	DomainName   string
	LeaseTimeSec int
}

// CreatePool creates a new subnet pool for a network.
func (s *IPAMService) CreatePool(ctx context.Context, spec CreatePoolSpec) (*SubnetPool, error) {
	logger := s.logger.With(
		zap.String("network_id", spec.NetworkID),
		zap.String("cidr", spec.CIDR),
	)
	logger.Info("Creating subnet pool")

	// Validate CIDR
	_, ipNet, err := net.ParseCIDR(spec.CIDR)
	if err != nil {
		return nil, fmt.Errorf("invalid CIDR: %w", err)
	}

	// Validate gateway is within subnet
	gwIP := net.ParseIP(spec.Gateway)
	if gwIP == nil {
		return nil, fmt.Errorf("invalid gateway IP: %s", spec.Gateway)
	}
	if !ipNet.Contains(gwIP) {
		return nil, fmt.Errorf("gateway %s is not within subnet %s", spec.Gateway, spec.CIDR)
	}

	// Calculate allocation range
	allocStart, allocEnd, err := CalculateAllocationRange(spec.CIDR, spec.Gateway)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate allocation range: %w", err)
	}

	// Calculate total IPs
	totalIPs, err := CalculatePoolSize(spec.CIDR)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate pool size: %w", err)
	}

	// Set defaults
	leaseTime := spec.LeaseTimeSec
	if leaseTime == 0 {
		leaseTime = 86400 // 24 hours
	}

	pool := &SubnetPool{
		ID:           uuid.New().String(),
		NetworkID:    spec.NetworkID,
		CIDR:         spec.CIDR,
		Gateway:      spec.Gateway,
		AllocStart:   allocStart,
		AllocEnd:     allocEnd,
		TotalIPs:     totalIPs,
		AllocatedIPs: 0,
		DHCPEnabled:  spec.DHCPEnabled,
		DNSServers:   spec.DNSServers,
		NTPServers:   spec.NTPServers,
		LeaseTimeSec: leaseTime,
	}

	if spec.DomainName != "" {
		pool.DomainName = &spec.DomainName
	}

	// Create in database
	if err := s.repo.CreatePool(ctx, pool); err != nil {
		return nil, err
	}

	// Reserve gateway IP
	if err := s.reserveGateway(ctx, pool); err != nil {
		logger.Warn("Failed to reserve gateway IP", zap.Error(err))
	}

	// Reserve broadcast IP
	if err := s.reserveBroadcast(ctx, pool); err != nil {
		logger.Warn("Failed to reserve broadcast IP", zap.Error(err))
	}

	logger.Info("Created subnet pool",
		zap.String("pool_id", pool.ID),
		zap.Int("total_ips", pool.TotalIPs),
		zap.String("alloc_start", pool.AllocStart),
		zap.String("alloc_end", pool.AllocEnd),
	)

	return pool, nil
}

// GetPool retrieves a subnet pool by network ID.
func (s *IPAMService) GetPool(ctx context.Context, networkID string) (*SubnetPool, error) {
	return s.repo.GetPoolByNetworkID(ctx, networkID)
}

// DeletePool deletes a subnet pool.
func (s *IPAMService) DeletePool(ctx context.Context, networkID string) error {
	s.logger.Info("Deleting subnet pool", zap.String("network_id", networkID))

	// Remove from cache
	s.poolCacheMu.Lock()
	delete(s.poolCache, networkID)
	s.poolCacheMu.Unlock()

	// Remove lock
	s.poolLocksMu.Lock()
	delete(s.poolLocks, networkID)
	s.poolLocksMu.Unlock()

	return s.repo.DeletePool(ctx, networkID)
}

// reserveGateway reserves the gateway IP address.
func (s *IPAMService) reserveGateway(ctx context.Context, pool *SubnetPool) error {
	alloc := &IPAllocation{
		ID:             uuid.New().String(),
		NetworkID:      pool.NetworkID,
		PoolID:         pool.ID,
		IPAddress:      pool.Gateway,
		AllocationType: AllocationTypeGateway,
	}
	desc := "Gateway IP"
	alloc.Description = &desc

	return s.repo.AllocateIP(ctx, alloc)
}

// reserveBroadcast reserves the broadcast IP address.
func (s *IPAMService) reserveBroadcast(ctx context.Context, pool *SubnetPool) error {
	// Calculate broadcast address
	_, ipNet, _ := net.ParseCIDR(pool.CIDR)
	broadcastIP := make(net.IP, len(ipNet.IP))
	for i := range ipNet.IP {
		broadcastIP[i] = ipNet.IP[i] | ^ipNet.Mask[i]
	}

	alloc := &IPAllocation{
		ID:             uuid.New().String(),
		NetworkID:      pool.NetworkID,
		PoolID:         pool.ID,
		IPAddress:      broadcastIP.String(),
		AllocationType: AllocationTypeBroadcast,
	}
	desc := "Broadcast IP"
	alloc.Description = &desc

	return s.repo.AllocateIP(ctx, alloc)
}

// =============================================================================
// IP ALLOCATION
// =============================================================================

// AllocateIPResult contains the result of an IP allocation.
type AllocateIPResult struct {
	IPAddress  string
	MACAddress string
	PoolID     string
}

// AllocateIP allocates the next available IP address for a port.
func (s *IPAMService) AllocateIP(ctx context.Context, networkID, portID string) (*AllocateIPResult, error) {
	logger := s.logger.With(
		zap.String("network_id", networkID),
		zap.String("port_id", portID),
	)
	logger.Info("Allocating IP address")

	// Get pool lock for this network
	lock := s.getPoolLock(networkID)
	lock.Lock()
	defer lock.Unlock()

	// Get pool
	pool, err := s.repo.GetPoolByNetworkID(ctx, networkID)
	if err != nil {
		return nil, fmt.Errorf("failed to get pool: %w", err)
	}
	if pool == nil {
		return nil, fmt.Errorf("no subnet pool for network %s", networkID)
	}

	// Check if port already has an allocation
	existing, err := s.repo.GetAllocationByPort(ctx, portID)
	if err != nil {
		return nil, fmt.Errorf("failed to check existing allocations: %w", err)
	}
	if len(existing) > 0 {
		// Return existing allocation
		return &AllocateIPResult{
			IPAddress:  existing[0].IPAddress,
			MACAddress: ptrToString(existing[0].MACAddress),
			PoolID:     pool.ID,
		}, nil
	}

	// Find next available IP
	ipAddress, err := s.repo.FindNextAvailableIP(ctx, pool.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to find available IP: %w", err)
	}

	// Generate MAC address
	macAddress, err := s.repo.GenerateMAC(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to generate MAC: %w", err)
	}

	// Create allocation
	alloc := &IPAllocation{
		ID:             uuid.New().String(),
		NetworkID:      networkID,
		PoolID:         pool.ID,
		PortID:         &portID,
		IPAddress:      ipAddress,
		MACAddress:     &macAddress,
		AllocationType: AllocationTypeDynamic,
	}

	if err := s.repo.AllocateIP(ctx, alloc); err != nil {
		return nil, fmt.Errorf("failed to allocate IP: %w", err)
	}

	// Register MAC
	macReg := &MACRegistry{
		ID:         uuid.New().String(),
		MACAddress: macAddress,
		PortID:     &portID,
	}
	if err := s.repo.RegisterMAC(ctx, macReg); err != nil {
		logger.Warn("Failed to register MAC", zap.Error(err))
	}

	// Sync to OVN DHCP if enabled
	if s.ovnClient != nil && pool.DHCPEnabled {
		go s.syncDHCPBinding(networkID, macAddress, ipAddress)
	}

	logger.Info("Allocated IP address",
		zap.String("ip_address", ipAddress),
		zap.String("mac_address", macAddress),
	)

	return &AllocateIPResult{
		IPAddress:  ipAddress,
		MACAddress: macAddress,
		PoolID:     pool.ID,
	}, nil
}

// AllocateSpecificIP allocates a specific IP address for a port.
func (s *IPAMService) AllocateSpecificIP(ctx context.Context, networkID, portID, ipAddress string) (*AllocateIPResult, error) {
	logger := s.logger.With(
		zap.String("network_id", networkID),
		zap.String("port_id", portID),
		zap.String("ip_address", ipAddress),
	)
	logger.Info("Allocating specific IP address")

	// Get pool lock for this network
	lock := s.getPoolLock(networkID)
	lock.Lock()
	defer lock.Unlock()

	// Get pool
	pool, err := s.repo.GetPoolByNetworkID(ctx, networkID)
	if err != nil {
		return nil, fmt.Errorf("failed to get pool: %w", err)
	}
	if pool == nil {
		return nil, fmt.Errorf("no subnet pool for network %s", networkID)
	}

	// Validate IP is within subnet
	_, ipNet, _ := net.ParseCIDR(pool.CIDR)
	ip := net.ParseIP(ipAddress)
	if ip == nil || !ipNet.Contains(ip) {
		return nil, fmt.Errorf("IP %s is not within subnet %s", ipAddress, pool.CIDR)
	}

	// Check if IP is available
	available, err := s.repo.IsIPAvailable(ctx, networkID, ipAddress)
	if err != nil {
		return nil, fmt.Errorf("failed to check IP availability: %w", err)
	}
	if !available {
		return nil, fmt.Errorf("IP %s is already allocated", ipAddress)
	}

	// Generate MAC address
	macAddress, err := s.repo.GenerateMAC(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to generate MAC: %w", err)
	}

	// Create allocation
	alloc := &IPAllocation{
		ID:             uuid.New().String(),
		NetworkID:      networkID,
		PoolID:         pool.ID,
		PortID:         &portID,
		IPAddress:      ipAddress,
		MACAddress:     &macAddress,
		AllocationType: AllocationTypeStatic,
	}

	if err := s.repo.AllocateIP(ctx, alloc); err != nil {
		return nil, fmt.Errorf("failed to allocate IP: %w", err)
	}

	// Register MAC
	macReg := &MACRegistry{
		ID:         uuid.New().String(),
		MACAddress: macAddress,
		PortID:     &portID,
	}
	if err := s.repo.RegisterMAC(ctx, macReg); err != nil {
		logger.Warn("Failed to register MAC", zap.Error(err))
	}

	logger.Info("Allocated specific IP address",
		zap.String("ip_address", ipAddress),
		zap.String("mac_address", macAddress),
	)

	return &AllocateIPResult{
		IPAddress:  ipAddress,
		MACAddress: macAddress,
		PoolID:     pool.ID,
	}, nil
}

// AllocateWithMAC allocates an IP with a specific MAC address.
func (s *IPAMService) AllocateWithMAC(ctx context.Context, networkID, portID, macAddress string) (*AllocateIPResult, error) {
	logger := s.logger.With(
		zap.String("network_id", networkID),
		zap.String("port_id", portID),
		zap.String("mac_address", macAddress),
	)
	logger.Info("Allocating IP with specific MAC")

	// Get pool lock
	lock := s.getPoolLock(networkID)
	lock.Lock()
	defer lock.Unlock()

	// Get pool
	pool, err := s.repo.GetPoolByNetworkID(ctx, networkID)
	if err != nil {
		return nil, fmt.Errorf("failed to get pool: %w", err)
	}
	if pool == nil {
		return nil, fmt.Errorf("no subnet pool for network %s", networkID)
	}

	// Check for static binding
	binding, err := s.repo.GetStaticBindingByMAC(ctx, networkID, macAddress)
	if err != nil {
		return nil, fmt.Errorf("failed to check static binding: %w", err)
	}

	var ipAddress string
	allocType := AllocationTypeDynamic

	if binding != nil {
		// Use static binding IP
		ipAddress = binding.IPAddress
		allocType = AllocationTypeStatic
		logger.Info("Using static DHCP binding",
			zap.String("ip_address", ipAddress),
		)
	} else {
		// Find next available IP
		ipAddress, err = s.repo.FindNextAvailableIP(ctx, pool.ID)
		if err != nil {
			return nil, fmt.Errorf("failed to find available IP: %w", err)
		}
	}

	// Create allocation
	alloc := &IPAllocation{
		ID:             uuid.New().String(),
		NetworkID:      networkID,
		PoolID:         pool.ID,
		PortID:         &portID,
		IPAddress:      ipAddress,
		MACAddress:     &macAddress,
		AllocationType: allocType,
	}

	if err := s.repo.AllocateIP(ctx, alloc); err != nil {
		return nil, fmt.Errorf("failed to allocate IP: %w", err)
	}

	// Register MAC
	macReg := &MACRegistry{
		ID:         uuid.New().String(),
		MACAddress: macAddress,
		PortID:     &portID,
	}
	if err := s.repo.RegisterMAC(ctx, macReg); err != nil {
		logger.Warn("Failed to register MAC", zap.Error(err))
	}

	return &AllocateIPResult{
		IPAddress:  ipAddress,
		MACAddress: macAddress,
		PoolID:     pool.ID,
	}, nil
}

// ReleaseIP releases an IP allocation for a port.
func (s *IPAMService) ReleaseIP(ctx context.Context, networkID, portID string) error {
	logger := s.logger.With(
		zap.String("network_id", networkID),
		zap.String("port_id", portID),
	)
	logger.Info("Releasing IP allocation")

	// Get allocations for this port
	allocations, err := s.repo.GetAllocationByPort(ctx, portID)
	if err != nil {
		return fmt.Errorf("failed to get allocations: %w", err)
	}

	for _, alloc := range allocations {
		// Release IP
		if err := s.repo.ReleaseIP(ctx, alloc.NetworkID, alloc.IPAddress); err != nil {
			logger.Warn("Failed to release IP",
				zap.String("ip_address", alloc.IPAddress),
				zap.Error(err),
			)
		}

		// Unregister MAC
		if alloc.MACAddress != nil {
			if err := s.repo.UnregisterMAC(ctx, *alloc.MACAddress); err != nil {
				logger.Warn("Failed to unregister MAC",
					zap.String("mac_address", *alloc.MACAddress),
					zap.Error(err),
				)
			}
		}
	}

	return nil
}

// =============================================================================
// QUERIES
// =============================================================================

// GetAllocation retrieves an IP allocation by network and IP.
func (s *IPAMService) GetAllocation(ctx context.Context, networkID, ipAddress string) (*IPAllocation, error) {
	return s.repo.GetAllocation(ctx, networkID, ipAddress)
}

// ListAllocations lists all IP allocations for a network.
func (s *IPAMService) ListAllocations(ctx context.Context, networkID string) ([]*IPAllocation, error) {
	return s.repo.ListAllocations(ctx, networkID)
}

// GetPoolStatistics returns pool usage statistics.
func (s *IPAMService) GetPoolStatistics(ctx context.Context, networkID string) (*domain.IPAllocationStatus, error) {
	pool, err := s.repo.GetPoolByNetworkID(ctx, networkID)
	if err != nil {
		return nil, err
	}
	if pool == nil {
		return nil, fmt.Errorf("pool not found")
	}

	return &domain.IPAllocationStatus{
		IPv4Total:     uint32(pool.TotalIPs),
		IPv4Allocated: uint32(pool.AllocatedIPs),
		IPv4Available: uint32(pool.TotalIPs - pool.AllocatedIPs),
	}, nil
}

// =============================================================================
// MAC ADDRESS GENERATION
// =============================================================================

// GenerateMAC generates a new unique MAC address.
func (s *IPAMService) GenerateMAC(ctx context.Context) (string, error) {
	return s.repo.GenerateMAC(ctx)
}

// =============================================================================
// STATIC BINDINGS
// =============================================================================

// CreateStaticBindingSpec defines the specification for a static DHCP binding.
type CreateStaticBindingSpec struct {
	NetworkID   string
	MACAddress  string
	IPAddress   string
	Hostname    string
	Description string
}

// CreateStaticBinding creates a static DHCP binding.
func (s *IPAMService) CreateStaticBinding(ctx context.Context, spec CreateStaticBindingSpec) (*DHCPStaticBinding, error) {
	logger := s.logger.With(
		zap.String("network_id", spec.NetworkID),
		zap.String("mac_address", spec.MACAddress),
		zap.String("ip_address", spec.IPAddress),
	)
	logger.Info("Creating static DHCP binding")

	// Get pool
	pool, err := s.repo.GetPoolByNetworkID(ctx, spec.NetworkID)
	if err != nil {
		return nil, fmt.Errorf("failed to get pool: %w", err)
	}
	if pool == nil {
		return nil, fmt.Errorf("no subnet pool for network %s", spec.NetworkID)
	}

	// Validate IP is within subnet
	_, ipNet, _ := net.ParseCIDR(pool.CIDR)
	ip := net.ParseIP(spec.IPAddress)
	if ip == nil || !ipNet.Contains(ip) {
		return nil, fmt.Errorf("IP %s is not within subnet %s", spec.IPAddress, pool.CIDR)
	}

	binding := &DHCPStaticBinding{
		ID:         uuid.New().String(),
		NetworkID:  spec.NetworkID,
		PoolID:     pool.ID,
		MACAddress: spec.MACAddress,
		IPAddress:  spec.IPAddress,
		Enabled:    true,
	}

	if spec.Hostname != "" {
		binding.Hostname = &spec.Hostname
	}
	if spec.Description != "" {
		binding.Description = &spec.Description
	}

	if err := s.repo.CreateStaticBinding(ctx, binding); err != nil {
		return nil, err
	}

	logger.Info("Created static DHCP binding",
		zap.String("binding_id", binding.ID),
	)

	return binding, nil
}

// ListStaticBindings lists all static bindings for a network.
func (s *IPAMService) ListStaticBindings(ctx context.Context, networkID string) ([]*DHCPStaticBinding, error) {
	return s.repo.ListStaticBindings(ctx, networkID)
}

// DeleteStaticBinding deletes a static binding.
func (s *IPAMService) DeleteStaticBinding(ctx context.Context, bindingID string) error {
	return s.repo.DeleteStaticBinding(ctx, bindingID)
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

// getPoolLock returns a lock for the given network ID.
func (s *IPAMService) getPoolLock(networkID string) *sync.Mutex {
	s.poolLocksMu.Lock()
	defer s.poolLocksMu.Unlock()

	lock, ok := s.poolLocks[networkID]
	if !ok {
		lock = &sync.Mutex{}
		s.poolLocks[networkID] = lock
	}
	return lock
}

// syncDHCPBinding syncs a DHCP binding to OVN (async).
func (s *IPAMService) syncDHCPBinding(networkID, macAddress, ipAddress string) {
	// This would update OVN DHCP options with the binding
	// For now, just log it
	s.logger.Debug("Syncing DHCP binding to OVN",
		zap.String("network_id", networkID),
		zap.String("mac_address", macAddress),
		zap.String("ip_address", ipAddress),
	)
}

func ptrToString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
