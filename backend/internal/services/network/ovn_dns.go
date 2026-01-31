// Package network provides OVN DNS responder configuration.
// This implements "Magic DNS" - internal VM name resolution using OVN's
// built-in DNS responder, with external query forwarding.
package network

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// =============================================================================
// OVN DNS SERVICE
// =============================================================================

// OVNDNSService manages OVN's built-in DNS responder for internal VM resolution.
type OVNDNSService struct {
	logger *zap.Logger
}

// NewOVNDNSService creates a new OVN DNS service.
func NewOVNDNSService(logger *zap.Logger) *OVNDNSService {
	return &OVNDNSService{
		logger: logger.Named("ovn-dns"),
	}
}

// DNSConfig holds DNS configuration for a network.
type DNSConfig struct {
	// Network/subnet UUID
	NetworkID string
	// DNS domain suffix (e.g., "vm.quantix.local")
	Domain string
	// Internal DNS records (name -> IP)
	Records map[string]string
	// External DNS servers for forwarding
	ExternalDNS []string
	// TTL for DNS records (seconds)
	TTL int
}

// DNSRecord represents a single DNS record.
type DNSRecord struct {
	ID        string
	Name      string // hostname (without domain suffix)
	FQDN      string // fully qualified domain name
	IPAddress string
	Type      string // A, AAAA, CNAME
	TTL       int
	NetworkID string
	VMID      string // associated VM (if any)
	CreatedAt time.Time
}

// =============================================================================
// DNS ZONE MANAGEMENT
// =============================================================================

// CreateDNSZone creates a DNS zone in OVN for a network.
func (s *OVNDNSService) CreateDNSZone(ctx context.Context, config DNSConfig) error {
	s.logger.Info("Creating OVN DNS zone",
		zap.String("network_id", config.NetworkID),
		zap.String("domain", config.Domain),
	)

	// Create DNS record in OVN NB database
	// OVN uses DNS table entries associated with logical switches
	dnsUUID := uuid.NewString()

	// Build records string (format: "hostname=ip hostname2=ip2")
	var recordPairs []string
	for name, ip := range config.Records {
		recordPairs = append(recordPairs, fmt.Sprintf("%s=%s", name, ip))
	}
	recordsStr := strings.Join(recordPairs, " ")

	// Create DNS entry
	cmd := exec.CommandContext(ctx, "ovn-nbctl",
		"--", "create", "DNS",
		fmt.Sprintf("records=%q", recordsStr),
		fmt.Sprintf("external_ids:domain=%s", config.Domain),
		fmt.Sprintf("external_ids:network_id=%s", config.NetworkID),
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		s.logger.Error("Failed to create DNS zone",
			zap.Error(err),
			zap.String("output", string(output)),
		)
		return fmt.Errorf("failed to create DNS zone: %w", err)
	}

	// The output is the UUID of the created DNS entry
	dnsUUID = strings.TrimSpace(string(output))
	s.logger.Info("DNS zone created", zap.String("uuid", dnsUUID))

	// Associate DNS with the logical switch (subnet)
	// Find the logical switch for this network
	lsCmd := exec.CommandContext(ctx, "ovn-nbctl",
		"--bare", "--columns=_uuid", "find", "Logical_Switch",
		fmt.Sprintf("external_ids:network_id=%s", config.NetworkID),
	)

	lsOutput, err := lsCmd.Output()
	if err != nil {
		s.logger.Warn("Could not find logical switch for network",
			zap.Error(err),
			zap.String("network_id", config.NetworkID),
		)
	} else {
		lsUUID := strings.TrimSpace(string(lsOutput))
		if lsUUID != "" {
			// Add DNS to logical switch
			addCmd := exec.CommandContext(ctx, "ovn-nbctl",
				"add", "Logical_Switch", lsUUID, "dns_records", dnsUUID,
			)
			if addOutput, addErr := addCmd.CombinedOutput(); addErr != nil {
				s.logger.Warn("Failed to add DNS to logical switch",
					zap.Error(addErr),
					zap.String("output", string(addOutput)),
				)
			}
		}
	}

	return nil
}

// AddDNSRecord adds a DNS record for a VM.
func (s *OVNDNSService) AddDNSRecord(ctx context.Context, record DNSRecord) error {
	s.logger.Info("Adding DNS record",
		zap.String("name", record.Name),
		zap.String("ip", record.IPAddress),
		zap.String("network_id", record.NetworkID),
	)

	// Find DNS entry for this network
	dnsUUID, err := s.findDNSEntry(ctx, record.NetworkID)
	if err != nil {
		return err
	}

	if dnsUUID == "" {
		// Create new DNS entry
		cmd := exec.CommandContext(ctx, "ovn-nbctl",
			"create", "DNS",
			fmt.Sprintf("records=%s=%s", record.Name, record.IPAddress),
			fmt.Sprintf("external_ids:network_id=%s", record.NetworkID),
		)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("failed to create DNS entry: %w (output: %s)", err, string(output))
		}
		dnsUUID = strings.TrimSpace(string(output))
	} else {
		// Add record to existing entry
		// First get current records
		currentRecords, err := s.getDNSRecords(ctx, dnsUUID)
		if err != nil {
			return err
		}

		// Add new record
		currentRecords[record.Name] = record.IPAddress

		// Update records
		var recordPairs []string
		for name, ip := range currentRecords {
			recordPairs = append(recordPairs, fmt.Sprintf("%s=%s", name, ip))
		}
		recordsStr := strings.Join(recordPairs, " ")

		cmd := exec.CommandContext(ctx, "ovn-nbctl",
			"set", "DNS", dnsUUID,
			fmt.Sprintf("records=%q", recordsStr),
		)
		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("failed to update DNS records: %w (output: %s)", err, string(output))
		}
	}

	s.logger.Info("DNS record added",
		zap.String("name", record.Name),
		zap.String("ip", record.IPAddress),
	)

	return nil
}

// RemoveDNSRecord removes a DNS record.
func (s *OVNDNSService) RemoveDNSRecord(ctx context.Context, networkID, hostname string) error {
	s.logger.Info("Removing DNS record",
		zap.String("hostname", hostname),
		zap.String("network_id", networkID),
	)

	dnsUUID, err := s.findDNSEntry(ctx, networkID)
	if err != nil {
		return err
	}

	if dnsUUID == "" {
		return nil // No DNS entry to remove from
	}

	// Get current records
	currentRecords, err := s.getDNSRecords(ctx, dnsUUID)
	if err != nil {
		return err
	}

	// Remove the hostname
	delete(currentRecords, hostname)

	// Update records
	if len(currentRecords) == 0 {
		// Delete the entire DNS entry if no records left
		cmd := exec.CommandContext(ctx, "ovn-nbctl",
			"destroy", "DNS", dnsUUID,
		)
		_, _ = cmd.CombinedOutput()
	} else {
		var recordPairs []string
		for name, ip := range currentRecords {
			recordPairs = append(recordPairs, fmt.Sprintf("%s=%s", name, ip))
		}
		recordsStr := strings.Join(recordPairs, " ")

		cmd := exec.CommandContext(ctx, "ovn-nbctl",
			"set", "DNS", dnsUUID,
			fmt.Sprintf("records=%q", recordsStr),
		)
		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("failed to update DNS records: %w (output: %s)", err, string(output))
		}
	}

	s.logger.Info("DNS record removed", zap.String("hostname", hostname))
	return nil
}

// ConfigureForwarders configures external DNS forwarders.
// External queries will be forwarded to these servers.
func (s *OVNDNSService) ConfigureForwarders(ctx context.Context, networkID string, forwarders []string) error {
	s.logger.Info("Configuring DNS forwarders",
		zap.String("network_id", networkID),
		zap.Strings("forwarders", forwarders),
	)

	// OVN doesn't have built-in DNS forwarding for external queries
	// This needs to be handled by configuring DHCP to provide both
	// the OVN DNS server and external forwarders

	// Find the DHCP options for this network
	dhcpCmd := exec.CommandContext(ctx, "ovn-nbctl",
		"--bare", "--columns=_uuid", "find", "DHCP_Options",
		fmt.Sprintf("external_ids:network_id=%s", networkID),
	)

	output, err := dhcpCmd.Output()
	if err != nil {
		return fmt.Errorf("failed to find DHCP options: %w", err)
	}

	dhcpUUID := strings.TrimSpace(string(output))
	if dhcpUUID == "" {
		s.logger.Warn("No DHCP options found for network", zap.String("network_id", networkID))
		return nil
	}

	// Set DNS servers in DHCP options
	// Format: {dns_server="{ip1, ip2}"} in options column
	dnsServers := strings.Join(forwarders, ", ")

	setCmd := exec.CommandContext(ctx, "ovn-nbctl",
		"set", "DHCP_Options", dhcpUUID,
		fmt.Sprintf("options:dns_server=\"{%s}\"", dnsServers),
	)

	if setOutput, err := setCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to set DNS forwarders: %w (output: %s)", err, string(setOutput))
	}

	s.logger.Info("DNS forwarders configured", zap.Strings("forwarders", forwarders))
	return nil
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// findDNSEntry finds the DNS entry UUID for a network.
func (s *OVNDNSService) findDNSEntry(ctx context.Context, networkID string) (string, error) {
	cmd := exec.CommandContext(ctx, "ovn-nbctl",
		"--bare", "--columns=_uuid", "find", "DNS",
		fmt.Sprintf("external_ids:network_id=%s", networkID),
	)

	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to find DNS entry: %w", err)
	}

	return strings.TrimSpace(string(output)), nil
}

// getDNSRecords gets current DNS records for a DNS entry.
func (s *OVNDNSService) getDNSRecords(ctx context.Context, dnsUUID string) (map[string]string, error) {
	cmd := exec.CommandContext(ctx, "ovn-nbctl",
		"--bare", "--columns=records", "get", "DNS", dnsUUID,
	)

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get DNS records: %w", err)
	}

	records := make(map[string]string)
	recordsStr := strings.TrimSpace(string(output))

	// Parse records (format: "name1=ip1 name2=ip2")
	if recordsStr != "" {
		pairs := strings.Split(recordsStr, " ")
		for _, pair := range pairs {
			parts := strings.SplitN(pair, "=", 2)
			if len(parts) == 2 {
				records[parts[0]] = parts[1]
			}
		}
	}

	return records, nil
}

// ListDNSRecords lists all DNS records for a network.
func (s *OVNDNSService) ListDNSRecords(ctx context.Context, networkID string) ([]DNSRecord, error) {
	dnsUUID, err := s.findDNSEntry(ctx, networkID)
	if err != nil {
		return nil, err
	}

	if dnsUUID == "" {
		return []DNSRecord{}, nil
	}

	records, err := s.getDNSRecords(ctx, dnsUUID)
	if err != nil {
		return nil, err
	}

	var result []DNSRecord
	for name, ip := range records {
		result = append(result, DNSRecord{
			Name:      name,
			IPAddress: ip,
			NetworkID: networkID,
			Type:      "A",
		})
	}

	return result, nil
}
