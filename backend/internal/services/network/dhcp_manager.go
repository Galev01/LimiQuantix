// Package network provides DHCP management integrated with OVN.
// This implements native OVN DHCP configuration without external DHCP servers.
package network

import (
	"context"
	"fmt"
	"net"
	"strings"
	"sync"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/network/ovn/nbdb"
)

// =============================================================================
// DHCP MANAGER
// =============================================================================

// DHCPManager manages OVN-native DHCP configuration for virtual networks.
// It creates and manages DHCP_Options entries in the OVN Northbound database.
type DHCPManager struct {
	logger *zap.Logger
	mu     sync.RWMutex

	// DHCP options cache by network ID
	dhcpOptionsCache map[string]*dhcpConfig

	// Default DHCP settings
	defaultLeaseTime     int    // Default: 3600 seconds (1 hour)
	defaultDNSServers    []string
	defaultDomainName    string
	defaultNTPServers    []string
}

// dhcpConfig holds the DHCP configuration for a network.
type dhcpConfig struct {
	NetworkID     string
	UUID          string // OVN DHCP_Options UUID
	CIDR          string
	RouterIP      string
	DNSServers    []string
	LeaseTime     int
	DomainName    string
	NTPServers    []string
	MTU           int
	HostnamePrefix string
}

// DHCPManagerConfig holds configuration for the DHCP manager.
type DHCPManagerConfig struct {
	DefaultLeaseTime     int
	DefaultDNSServers    []string
	DefaultDomainName    string
	DefaultNTPServers    []string
}

// DefaultDHCPConfig returns sensible default DHCP configuration.
func DefaultDHCPConfig() DHCPManagerConfig {
	return DHCPManagerConfig{
		DefaultLeaseTime:     3600, // 1 hour
		DefaultDNSServers:    []string{"8.8.8.8", "8.8.4.4"},
		DefaultDomainName:    "quantix.local",
		DefaultNTPServers:    []string{"0.pool.ntp.org", "1.pool.ntp.org"},
	}
}

// NewDHCPManager creates a new DHCP manager.
func NewDHCPManager(config DHCPManagerConfig, logger *zap.Logger) *DHCPManager {
	if config.DefaultLeaseTime == 0 {
		config.DefaultLeaseTime = 3600
	}
	if len(config.DefaultDNSServers) == 0 {
		config.DefaultDNSServers = []string{"8.8.8.8", "8.8.4.4"}
	}
	if config.DefaultDomainName == "" {
		config.DefaultDomainName = "quantix.local"
	}

	return &DHCPManager{
		logger:             logger.Named("dhcp-manager"),
		dhcpOptionsCache:   make(map[string]*dhcpConfig),
		defaultLeaseTime:   config.DefaultLeaseTime,
		defaultDNSServers:  config.DefaultDNSServers,
		defaultDomainName:  config.DefaultDomainName,
		defaultNTPServers:  config.DefaultNTPServers,
	}
}

// =============================================================================
// DHCP OPTIONS MANAGEMENT
// =============================================================================

// ConfigureNetworkDHCP creates or updates DHCP configuration for a network.
func (m *DHCPManager) ConfigureNetworkDHCP(ctx context.Context, network *domain.VirtualNetwork) (*nbdb.DHCPOptions, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.logger.Info("Configuring DHCP for network",
		zap.String("network_id", network.ID),
		zap.String("name", network.Name),
	)

	// Check if network has IP configuration
	if network.Spec.IPConfig == nil || network.Spec.IPConfig.IPv4Subnet == "" {
		return nil, fmt.Errorf("network %s has no IPv4 subnet configured", network.ID)
	}

	// Parse CIDR and calculate defaults
	cidr := network.Spec.IPConfig.IPv4Subnet
	_, ipNet, err := net.ParseCIDR(cidr)
	if err != nil {
		return nil, fmt.Errorf("invalid CIDR %s: %w", cidr, err)
	}

	// Calculate router IP (gateway) if not specified
	routerIP := network.Spec.IPConfig.GatewayV4
	if routerIP == "" {
		routerIP = m.calculateDefaultGateway(ipNet)
	}

	// Get DNS servers from network or use defaults
	dnsServers := m.defaultDNSServers
	if network.Spec.IPConfig.DNSServers != nil && len(network.Spec.IPConfig.DNSServers) > 0 {
		dnsServers = network.Spec.IPConfig.DNSServers
	}

	// Get domain name
	domainName := m.defaultDomainName
	if network.Spec.IPConfig.DNSSuffix != "" {
		domainName = network.Spec.IPConfig.DNSSuffix
	}

	// Calculate lease time
	leaseTime := m.defaultLeaseTime
	if network.Spec.DHCPConfig != nil && network.Spec.DHCPConfig.LeaseTime > 0 {
		leaseTime = network.Spec.DHCPConfig.LeaseTime
	}

	// Get MTU
	mtu := 1500
	if network.Spec.MTU > 0 {
		mtu = network.Spec.MTU
	}

	// Create DHCP options for OVN
	dhcpOpts := &nbdb.DHCPOptions{
		CIDR: cidr,
		Options: map[string]string{
			nbdb.DHCPOptionServerID:   routerIP,
			nbdb.DHCPOptionServerMAC:  m.generateServerMAC(network.ID),
			nbdb.DHCPOptionRouter:     routerIP,
			nbdb.DHCPOptionDNSServer:  strings.Join(dnsServers, ","),
			nbdb.DHCPOptionLeaseTime:  fmt.Sprintf("%d", leaseTime),
			nbdb.DHCPOptionMTU:        fmt.Sprintf("%d", mtu),
			nbdb.DHCPOptionDomainName: domainName,
		},
		ExternalIDs: map[string]string{
			"limiquantix-network-id": network.ID,
			"limiquantix-name":       network.Name,
		},
	}

	// Add NTP servers if configured
	ntpServers := m.defaultNTPServers
	if network.Spec.DHCPConfig != nil && len(network.Spec.DHCPConfig.NTPServers) > 0 {
		ntpServers = network.Spec.DHCPConfig.NTPServers
	}
	if len(ntpServers) > 0 {
		dhcpOpts.Options["ntp_server"] = strings.Join(ntpServers, ",")
	}

	// Add static routes if configured
	if network.Spec.DHCPConfig != nil && len(network.Spec.DHCPConfig.StaticRoutes) > 0 {
		routes := m.formatStaticRoutes(network.Spec.DHCPConfig.StaticRoutes)
		if routes != "" {
			dhcpOpts.Options["classless_static_route"] = routes
		}
	}

	// Store in cache
	m.dhcpOptionsCache[network.ID] = &dhcpConfig{
		NetworkID:  network.ID,
		CIDR:       cidr,
		RouterIP:   routerIP,
		DNSServers: dnsServers,
		LeaseTime:  leaseTime,
		DomainName: domainName,
		NTPServers: ntpServers,
		MTU:        mtu,
	}

	m.logger.Info("DHCP configured for network",
		zap.String("network_id", network.ID),
		zap.String("cidr", cidr),
		zap.String("router", routerIP),
		zap.Strings("dns", dnsServers),
	)

	return dhcpOpts, nil
}

// RemoveNetworkDHCP removes DHCP configuration for a network.
func (m *DHCPManager) RemoveNetworkDHCP(ctx context.Context, networkID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.logger.Info("Removing DHCP for network", zap.String("network_id", networkID))

	delete(m.dhcpOptionsCache, networkID)
	return nil
}

// GetNetworkDHCP returns the DHCP configuration for a network.
func (m *DHCPManager) GetNetworkDHCP(networkID string) *dhcpConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.dhcpOptionsCache[networkID]
}

// =============================================================================
// PORT DHCP BINDING
// =============================================================================

// ConfigurePortDHCP creates DHCP binding for a specific port.
// This allows per-port customization like fixed IPs and hostnames.
func (m *DHCPManager) ConfigurePortDHCP(ctx context.Context, port *domain.Port, network *domain.VirtualNetwork) (*nbdb.DHCPOptions, error) {
	m.logger.Info("Configuring DHCP for port",
		zap.String("port_id", port.ID),
		zap.String("network_id", port.Spec.NetworkID),
	)

	// Get base network DHCP config
	baseConfig := m.GetNetworkDHCP(port.Spec.NetworkID)
	if baseConfig == nil {
		// Create default config
		var err error
		_, err = m.ConfigureNetworkDHCP(ctx, network)
		if err != nil {
			return nil, fmt.Errorf("failed to create base DHCP config: %w", err)
		}
		baseConfig = m.GetNetworkDHCP(port.Spec.NetworkID)
	}

	// Create port-specific DHCP options
	// This is typically used for reservations
	dhcpOpts := &nbdb.DHCPOptions{
		CIDR: baseConfig.CIDR,
		Options: map[string]string{
			nbdb.DHCPOptionServerID:   baseConfig.RouterIP,
			nbdb.DHCPOptionServerMAC:  m.generateServerMAC(port.Spec.NetworkID),
			nbdb.DHCPOptionRouter:     baseConfig.RouterIP,
			nbdb.DHCPOptionDNSServer:  strings.Join(baseConfig.DNSServers, ","),
			nbdb.DHCPOptionLeaseTime:  fmt.Sprintf("%d", baseConfig.LeaseTime),
			nbdb.DHCPOptionMTU:        fmt.Sprintf("%d", baseConfig.MTU),
			nbdb.DHCPOptionDomainName: baseConfig.DomainName,
		},
		ExternalIDs: map[string]string{
			"limiquantix-port-id":    port.ID,
			"limiquantix-network-id": port.Spec.NetworkID,
		},
	}

	// Add hostname if available
	if port.Spec.Hostname != "" {
		dhcpOpts.Options[nbdb.DHCPOptionHostname] = port.Spec.Hostname
	}

	return dhcpOpts, nil
}

// =============================================================================
// DHCPv6 SUPPORT
// =============================================================================

// ConfigureNetworkDHCPv6 creates or updates DHCPv6 configuration for a network.
func (m *DHCPManager) ConfigureNetworkDHCPv6(ctx context.Context, network *domain.VirtualNetwork) (*nbdb.DHCPOptions, error) {
	if network.Spec.IPConfig == nil || network.Spec.IPConfig.IPv6Subnet == "" {
		return nil, nil // No IPv6 configured
	}

	m.logger.Info("Configuring DHCPv6 for network",
		zap.String("network_id", network.ID),
		zap.String("ipv6_subnet", network.Spec.IPConfig.IPv6Subnet),
	)

	dhcpOpts := &nbdb.DHCPOptions{
		CIDR: network.Spec.IPConfig.IPv6Subnet,
		Options: map[string]string{
			"server_id": m.generateServerMAC(network.ID),
		},
		ExternalIDs: map[string]string{
			"limiquantix-network-id": network.ID,
			"limiquantix-ipv6":       "true",
		},
	}

	// Add DNS servers for IPv6
	if len(network.Spec.IPConfig.DNSServers) > 0 {
		// Filter for IPv6 DNS servers
		ipv6DNS := []string{}
		for _, dns := range network.Spec.IPConfig.DNSServers {
			ip := net.ParseIP(dns)
			if ip != nil && ip.To4() == nil {
				ipv6DNS = append(ipv6DNS, dns)
			}
		}
		if len(ipv6DNS) > 0 {
			dhcpOpts.Options["dns_server"] = strings.Join(ipv6DNS, ",")
		}
	}

	return dhcpOpts, nil
}

// =============================================================================
// HELPERS
// =============================================================================

// calculateDefaultGateway calculates the default gateway IP for a subnet.
// By convention, we use the first usable IP in the subnet.
func (m *DHCPManager) calculateDefaultGateway(ipNet *net.IPNet) string {
	ip := ipNet.IP.Mask(ipNet.Mask)
	// Calculate first usable IP (network + 1)
	for i := len(ip) - 1; i >= 0; i-- {
		ip[i]++
		if ip[i] > 0 {
			break
		}
	}
	return ip.String()
}

// generateServerMAC generates a consistent MAC address for the DHCP server.
// This uses a locally administered MAC based on the network ID.
func (m *DHCPManager) generateServerMAC(networkID string) string {
	// Generate a consistent MAC based on network ID hash
	hash := 0
	for _, c := range networkID {
		hash = (hash*31 + int(c)) % (1 << 24)
	}

	// Use locally administered address (02:xx:xx:xx:xx:xx)
	return fmt.Sprintf("02:%02x:%02x:%02x:%02x:%02x",
		(hash>>16)&0xFF,
		(hash>>8)&0xFF,
		hash&0xFF,
		0x00,
		0x01,
	)
}

// formatStaticRoutes formats static routes for DHCP option 121.
func (m *DHCPManager) formatStaticRoutes(routes []domain.DHCPStaticRoute) string {
	var parts []string
	for _, route := range routes {
		// Format: destination/prefix,gateway
		parts = append(parts, fmt.Sprintf("%s,%s", route.Destination, route.Gateway))
	}
	return strings.Join(parts, ";")
}

// =============================================================================
// DHCP POOL MANAGEMENT
// =============================================================================

// DHCPPool represents a DHCP address pool within a subnet.
type DHCPPool struct {
	StartIP  net.IP
	EndIP    net.IP
	Excludes []net.IP
}

// CalculateDHCPPool calculates the DHCP pool for a network.
func (m *DHCPManager) CalculateDHCPPool(network *domain.VirtualNetwork) (*DHCPPool, error) {
	if network.Spec.IPConfig == nil {
		return nil, fmt.Errorf("network has no IP configuration")
	}

	_, ipNet, err := net.ParseCIDR(network.Spec.IPConfig.IPv4Subnet)
	if err != nil {
		return nil, err
	}

	pool := &DHCPPool{
		Excludes: []net.IP{},
	}

	// If DHCP config has allocation pools, use them
	if network.Spec.DHCPConfig != nil && network.Spec.DHCPConfig.AllocationPool != nil {
		pool.StartIP = net.ParseIP(network.Spec.DHCPConfig.AllocationPool.Start)
		pool.EndIP = net.ParseIP(network.Spec.DHCPConfig.AllocationPool.End)
	} else {
		// Default: use addresses from .10 to .250 in the subnet
		pool.StartIP = m.calculatePoolStart(ipNet)
		pool.EndIP = m.calculatePoolEnd(ipNet)
	}

	// Add gateway to excludes
	if network.Spec.IPConfig.GatewayV4 != "" {
		pool.Excludes = append(pool.Excludes, net.ParseIP(network.Spec.IPConfig.GatewayV4))
	}

	return pool, nil
}

func (m *DHCPManager) calculatePoolStart(ipNet *net.IPNet) net.IP {
	ip := make(net.IP, len(ipNet.IP))
	copy(ip, ipNet.IP.Mask(ipNet.Mask))
	// Start at .10 for class C equivalent
	ip[len(ip)-1] = 10
	return ip
}

func (m *DHCPManager) calculatePoolEnd(ipNet *net.IPNet) net.IP {
	ip := make(net.IP, len(ipNet.IP))
	copy(ip, ipNet.IP.Mask(ipNet.Mask))
	// End at .250 for class C equivalent
	ip[len(ip)-1] = 250
	return ip
}

// =============================================================================
// DHCP RESERVATION
// =============================================================================

// DHCPReservation represents a DHCP address reservation.
type DHCPReservation struct {
	MACAddress string
	IPAddress  string
	Hostname   string
}

// CreateReservation creates a DHCP reservation for a port.
func (m *DHCPManager) CreateReservation(port *domain.Port) *DHCPReservation {
	if len(port.Spec.FixedIPs) == 0 {
		return nil
	}

	return &DHCPReservation{
		MACAddress: port.Spec.MACAddress,
		IPAddress:  port.Spec.FixedIPs[0].IPAddress,
		Hostname:   port.Spec.Hostname,
	}
}
