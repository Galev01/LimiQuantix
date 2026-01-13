// Package network provides DNS management for Quantix-vDC Magic DNS.
// This implements automatic DNS record management for VMs and services,
// similar to Tailscale's MagicDNS feature.
package network

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/network/ovn/nbdb"
)

// =============================================================================
// DNS SERVICE
// =============================================================================

// DNSService manages DNS records for VMs and services in Quantix-vDC.
// It provides "Magic DNS" functionality where VMs are automatically resolvable
// by their names within the virtual network.
type DNSService struct {
	logger *zap.Logger
	mu     sync.RWMutex

	// Configuration
	config DNSConfig

	// In-memory DNS records by network
	networkRecords map[string]*DNSRecordSet

	// Reverse DNS records
	reverseRecords map[string]string // IP -> hostname

	// Last sync time for CoreDNS
	lastSyncTime time.Time
}

// DNSConfig holds DNS service configuration.
type DNSConfig struct {
	// BaseDomain is the top-level domain for all records (e.g., "quantix.local")
	BaseDomain string

	// EnableCoreDNS enables integration with external CoreDNS
	EnableCoreDNS bool

	// CoreDNSAddress is the address of CoreDNS etcd backend
	CoreDNSAddress string

	// EnableOVNDNS enables OVN-native DNS (requires OVN 21.06+)
	EnableOVNDNS bool

	// TTL is the default TTL for DNS records
	TTL int

	// RefreshInterval is how often to sync with external DNS
	RefreshInterval time.Duration
}

// DefaultDNSConfig returns sensible default configuration.
func DefaultDNSConfig() DNSConfig {
	return DNSConfig{
		BaseDomain:      "quantix.local",
		EnableOVNDNS:    true,
		EnableCoreDNS:   false,
		TTL:             300, // 5 minutes
		RefreshInterval: 30 * time.Second,
	}
}

// DNSRecordSet holds DNS records for a network.
type DNSRecordSet struct {
	NetworkID   string
	NetworkName string
	Records     map[string]*DNSRecord // hostname -> record
	OVNUUID     string                // OVN DNS record UUID
	UpdatedAt   time.Time
}

// DNSRecord represents a single DNS record.
type DNSRecord struct {
	Hostname  string
	Type      DNSRecordType
	Value     string // IP address for A/AAAA, target for CNAME
	TTL       int
	Priority  int    // For MX records
	CreatedBy string // "vm", "service", "user"
	VMID      string // Associated VM ID
	PortID    string // Associated port ID
}

// DNSRecordType is the type of DNS record.
type DNSRecordType string

const (
	DNSRecordTypeA     DNSRecordType = "A"
	DNSRecordTypeAAAA  DNSRecordType = "AAAA"
	DNSRecordTypeCNAME DNSRecordType = "CNAME"
	DNSRecordTypePTR   DNSRecordType = "PTR"
	DNSRecordTypeSRV   DNSRecordType = "SRV"
	DNSRecordTypeTXT   DNSRecordType = "TXT"
)

// NewDNSService creates a new DNS service.
func NewDNSService(config DNSConfig, logger *zap.Logger) *DNSService {
	return &DNSService{
		logger:         logger.Named("dns-service"),
		config:         config,
		networkRecords: make(map[string]*DNSRecordSet),
		reverseRecords: make(map[string]string),
	}
}

// =============================================================================
// RECORD MANAGEMENT
// =============================================================================

// RegisterVM registers a VM's DNS records.
// This creates A/AAAA records for all the VM's IP addresses.
func (s *DNSService) RegisterVM(ctx context.Context, vm *domain.VirtualMachine, ports []*domain.Port) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Registering DNS for VM",
		zap.String("vm_id", vm.ID),
		zap.String("vm_name", vm.Name),
		zap.Int("port_count", len(ports)),
	)

	hostname := s.sanitizeHostname(vm.Name)

	for _, port := range ports {
		recordSet := s.getOrCreateRecordSet(port.Spec.NetworkID, "")

		// Register each IP address
		for _, fixedIP := range port.Spec.FixedIPs {
			recordType := DNSRecordTypeA
			ip := fixedIP.IPAddress
			if strings.Contains(ip, ":") {
				recordType = DNSRecordTypeAAAA
			}

			// Create DNS record
			fqdn := s.buildFQDN(hostname, recordSet.NetworkName)
			recordSet.Records[fqdn] = &DNSRecord{
				Hostname:  fqdn,
				Type:      recordType,
				Value:     ip,
				TTL:       s.config.TTL,
				CreatedBy: "vm",
				VMID:      vm.ID,
				PortID:    port.ID,
			}

			// Create reverse DNS
			s.reverseRecords[ip] = fqdn

			s.logger.Debug("Created DNS record",
				zap.String("hostname", fqdn),
				zap.String("type", string(recordType)),
				zap.String("ip", ip),
			)
		}

		recordSet.UpdatedAt = time.Now()
	}

	return nil
}

// UnregisterVM removes all DNS records for a VM.
func (s *DNSService) UnregisterVM(ctx context.Context, vmID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Unregistering DNS for VM", zap.String("vm_id", vmID))

	// Find and remove all records for this VM
	for _, recordSet := range s.networkRecords {
		toDelete := []string{}
		for hostname, record := range recordSet.Records {
			if record.VMID == vmID {
				toDelete = append(toDelete, hostname)
				// Remove reverse record
				delete(s.reverseRecords, record.Value)
			}
		}
		for _, hostname := range toDelete {
			delete(recordSet.Records, hostname)
		}
		recordSet.UpdatedAt = time.Now()
	}

	return nil
}

// UpdateVMIP updates DNS records when a VM's IP changes.
func (s *DNSService) UpdateVMIP(ctx context.Context, vmID, portID, oldIP, newIP string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Updating VM IP in DNS",
		zap.String("vm_id", vmID),
		zap.String("old_ip", oldIP),
		zap.String("new_ip", newIP),
	)

	// Find the record for this port and update it
	for _, recordSet := range s.networkRecords {
		for _, record := range recordSet.Records {
			if record.VMID == vmID && record.PortID == portID && record.Value == oldIP {
				// Update record
				delete(s.reverseRecords, oldIP)
				record.Value = newIP
				s.reverseRecords[newIP] = record.Hostname
				recordSet.UpdatedAt = time.Now()
				break
			}
		}
	}

	return nil
}

// =============================================================================
// SERVICE DISCOVERY
// =============================================================================

// RegisterService registers a service's DNS record.
// This is useful for load balancers, VIPs, and other services.
func (s *DNSService) RegisterService(ctx context.Context, serviceName, networkID, ipAddress string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.logger.Info("Registering service DNS",
		zap.String("service", serviceName),
		zap.String("network_id", networkID),
		zap.String("ip", ipAddress),
	)

	recordSet := s.getOrCreateRecordSet(networkID, "")
	hostname := s.sanitizeHostname(serviceName)
	fqdn := s.buildFQDN(hostname, recordSet.NetworkName)

	recordType := DNSRecordTypeA
	if strings.Contains(ipAddress, ":") {
		recordType = DNSRecordTypeAAAA
	}

	recordSet.Records[fqdn] = &DNSRecord{
		Hostname:  fqdn,
		Type:      recordType,
		Value:     ipAddress,
		TTL:       s.config.TTL,
		CreatedBy: "service",
	}

	s.reverseRecords[ipAddress] = fqdn
	recordSet.UpdatedAt = time.Now()

	return nil
}

// RegisterSRV registers an SRV record for service discovery.
func (s *DNSService) RegisterSRV(ctx context.Context, serviceName, protocol, networkID, target string, port, priority, weight int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	recordSet := s.getOrCreateRecordSet(networkID, "")

	// SRV record format: _service._protocol.domain
	srvName := fmt.Sprintf("_%s._%s.%s", serviceName, protocol, s.config.BaseDomain)

	recordSet.Records[srvName] = &DNSRecord{
		Hostname:  srvName,
		Type:      DNSRecordTypeSRV,
		Value:     fmt.Sprintf("%d %d %d %s", priority, weight, port, target),
		TTL:       s.config.TTL,
		CreatedBy: "service",
		Priority:  priority,
	}

	return nil
}

// =============================================================================
// OVN DNS INTEGRATION
// =============================================================================

// BuildOVNDNSRecord builds an OVN DNS record from the current state.
func (s *DNSService) BuildOVNDNSRecord(networkID string) *nbdb.DNS {
	s.mu.RLock()
	defer s.mu.RUnlock()

	recordSet, ok := s.networkRecords[networkID]
	if !ok || len(recordSet.Records) == 0 {
		return nil
	}

	dns := &nbdb.DNS{
		Records: make(map[string]string),
		ExternalIDs: map[string]string{
			"limiquantix-network-id": networkID,
		},
	}

	for _, record := range recordSet.Records {
		// OVN DNS only supports simple hostname -> IP mapping
		if record.Type == DNSRecordTypeA || record.Type == DNSRecordTypeAAAA {
			dns.Records[record.Hostname] = record.Value
		}
	}

	return dns
}

// SyncToOVN syncs all DNS records to OVN.
func (s *DNSService) SyncToOVN(ctx context.Context) error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	s.logger.Info("Syncing DNS records to OVN",
		zap.Int("network_count", len(s.networkRecords)),
	)

	for networkID := range s.networkRecords {
		dns := s.BuildOVNDNSRecord(networkID)
		if dns == nil {
			continue
		}

		s.logger.Debug("Syncing DNS for network",
			zap.String("network_id", networkID),
			zap.Int("record_count", len(dns.Records)),
		)

		// In real implementation, this would call the OVN client
		// ovnClient.CreateOrUpdateDNS(ctx, dns)
	}

	s.lastSyncTime = time.Now()
	return nil
}

// =============================================================================
// COREDNS INTEGRATION
// =============================================================================

// CoreDNSRecord represents a record in CoreDNS format (for etcd backend).
type CoreDNSRecord struct {
	Host     string `json:"host,omitempty"`
	Port     int    `json:"port,omitempty"`
	Priority int    `json:"priority,omitempty"`
	Weight   int    `json:"weight,omitempty"`
	Text     string `json:"text,omitempty"`
	TTL      int    `json:"ttl,omitempty"`
}

// SyncToCoreDNS syncs DNS records to CoreDNS via etcd.
func (s *DNSService) SyncToCoreDNS(ctx context.Context) error {
	if !s.config.EnableCoreDNS {
		return nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	s.logger.Info("Syncing DNS records to CoreDNS")

	// In real implementation, this would write to etcd
	// in the format expected by CoreDNS file or etcd plugin
	//
	// Example etcd path: /skydns/local/quantix/web-server
	// Value: {"host": "10.0.0.5", "ttl": 300}

	for networkID, recordSet := range s.networkRecords {
		for _, record := range recordSet.Records {
			etcdPath := s.buildCoreDNSPath(record.Hostname)

			s.logger.Debug("Would write to CoreDNS etcd",
				zap.String("path", etcdPath),
				zap.String("network_id", networkID),
				zap.String("hostname", record.Hostname),
				zap.String("value", record.Value),
			)

			// etcdClient.Put(ctx, etcdPath, jsonEncode(CoreDNSRecord{
			//     Host: record.Value,
			//     TTL:  record.TTL,
			// }))
		}
	}

	return nil
}

func (s *DNSService) buildCoreDNSPath(hostname string) string {
	// CoreDNS etcd format: reverse domain parts
	// example.quantix.local -> /skydns/local/quantix/example
	parts := strings.Split(hostname, ".")
	reversed := make([]string, len(parts))
	for i, part := range parts {
		reversed[len(parts)-1-i] = part
	}
	return "/skydns/" + strings.Join(reversed, "/")
}

// =============================================================================
// QUERIES
// =============================================================================

// Resolve resolves a hostname to IP addresses.
func (s *DNSService) Resolve(hostname string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var ips []string

	for _, recordSet := range s.networkRecords {
		if record, ok := recordSet.Records[hostname]; ok {
			if record.Type == DNSRecordTypeA || record.Type == DNSRecordTypeAAAA {
				ips = append(ips, record.Value)
			}
		}
	}

	return ips
}

// ReverseLookup performs a reverse DNS lookup.
func (s *DNSService) ReverseLookup(ip string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.reverseRecords[ip]
}

// ListRecords lists all DNS records for a network.
func (s *DNSService) ListRecords(networkID string) []*DNSRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()

	recordSet, ok := s.networkRecords[networkID]
	if !ok {
		return nil
	}

	records := make([]*DNSRecord, 0, len(recordSet.Records))
	for _, record := range recordSet.Records {
		records = append(records, record)
	}
	return records
}

// GetStats returns DNS service statistics.
func (s *DNSService) GetStats() DNSStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	totalRecords := 0
	for _, recordSet := range s.networkRecords {
		totalRecords += len(recordSet.Records)
	}

	return DNSStats{
		NetworkCount:   len(s.networkRecords),
		TotalRecords:   totalRecords,
		ReverseRecords: len(s.reverseRecords),
		LastSyncTime:   s.lastSyncTime,
	}
}

// DNSStats holds DNS service statistics.
type DNSStats struct {
	NetworkCount   int
	TotalRecords   int
	ReverseRecords int
	LastSyncTime   time.Time
}

// =============================================================================
// HELPERS
// =============================================================================

func (s *DNSService) getOrCreateRecordSet(networkID, networkName string) *DNSRecordSet {
	if recordSet, ok := s.networkRecords[networkID]; ok {
		return recordSet
	}

	recordSet := &DNSRecordSet{
		NetworkID:   networkID,
		NetworkName: networkName,
		Records:     make(map[string]*DNSRecord),
	}
	s.networkRecords[networkID] = recordSet
	return recordSet
}

// sanitizeHostname converts a VM name to a valid DNS hostname.
func (s *DNSService) sanitizeHostname(name string) string {
	// Replace invalid characters with hyphens
	reg := regexp.MustCompile(`[^a-zA-Z0-9-]`)
	hostname := reg.ReplaceAllString(name, "-")

	// Remove leading/trailing hyphens
	hostname = strings.Trim(hostname, "-")

	// Ensure it starts with a letter
	if len(hostname) > 0 && !isLetter(hostname[0]) {
		hostname = "vm-" + hostname
	}

	// Truncate to 63 characters (DNS label limit)
	if len(hostname) > 63 {
		hostname = hostname[:63]
	}

	return strings.ToLower(hostname)
}

func (s *DNSService) buildFQDN(hostname, networkName string) string {
	if networkName != "" {
		return fmt.Sprintf("%s.%s.%s", hostname, networkName, s.config.BaseDomain)
	}
	return fmt.Sprintf("%s.%s", hostname, s.config.BaseDomain)
}

func isLetter(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}
