# 000097 - OVN DNS ("Magic DNS") Service

**Purpose:** Document the OVN-based internal DNS resolution for VMs, enabling name-based access without external DNS servers.

**Status:** ✅ Implemented

---

## Executive Summary

"Magic DNS" provides automatic DNS resolution for VMs within Quantix-KVM networks:

- **Internal Resolution**: VMs resolve each other by name (e.g., `ping web-server`)
- **No External Dependency**: Uses OVN's built-in DNS responder
- **Automatic Registration**: VM names auto-registered when created
- **External Forwarding**: Non-local queries forwarded to upstream DNS

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Virtual Network                                    │
│                                                                           │
│  ┌────────────────┐        ┌────────────────┐        ┌────────────────┐  │
│  │   web-server   │        │   db-server    │        │   app-server   │  │
│  │   10.0.0.10    │        │   10.0.0.11    │        │   10.0.0.12    │  │
│  └───────┬────────┘        └───────┬────────┘        └───────┬────────┘  │
│          │                         │                         │           │
│          │ DNS Query:              │                         │           │
│          │ "db-server"             │                         │           │
│          ▼                         │                         │           │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │                     OVN Logical Switch                             │   │
│  │                                                                    │   │
│  │   ┌────────────────────────────────────────────────────────────┐  │   │
│  │   │  OVN DNS Responder (built into OVS)                        │  │   │
│  │   │                                                            │  │   │
│  │   │  DNS Records:                                              │  │   │
│  │   │    web-server.internal → 10.0.0.10                        │  │   │
│  │   │    db-server.internal  → 10.0.0.11  ◄── Resolved locally  │  │   │
│  │   │    app-server.internal → 10.0.0.12                        │  │   │
│  │   └────────────────────────────────────────────────────────────┘  │   │
│  │                                                                    │   │
│  │   External query: "google.com" → Forwarded to upstream DNS        │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                            │                                              │
└────────────────────────────┼──────────────────────────────────────────────┘
                             │
                             ▼ Forward non-local queries
                    ┌────────────────┐
                    │  Upstream DNS  │
                    │  8.8.8.8       │
                    │  8.8.4.4       │
                    └────────────────┘
```

---

## How It Works

### OVN DNS Entries

OVN stores DNS records in the Northbound database, associated with logical switches:

```bash
# View DNS entries
ovn-nbctl list DNS

# Output:
_uuid    : 12345678-1234-1234-1234-123456789abc
external_ids: {switch=network-1}
records  : {"web-server.internal"="10.0.0.10", "db-server.internal"="10.0.0.11"}
```

### DNS Response Flow

1. VM sends DNS query (A record for "db-server.internal")
2. Query reaches OVS via DHCP-configured DNS server (local logical switch IP)
3. OVN controller intercepts DNS query
4. If record exists in `DNS` table → return local answer
5. If not → forward to upstream DNS

---

## Implementation

### OVN DNS Service

```go
// backend/internal/services/network/ovn_dns.go

type OVNDNSService struct {
    logger *zap.Logger
}

type DNSRecord struct {
    Hostname  string  // Short name (e.g., "web-server")
    FQDN      string  // Full name (e.g., "web-server.internal")
    IPAddress string  // IPv4 address
    SwitchID  string  // Associated logical switch
    TTL       int     // Time-to-live (seconds)
}
```

### Create DNS Zone

```go
func (s *OVNDNSService) CreateDNSZone(ctx context.Context, switchID string) error {
    // Create empty DNS entry for switch
    cmd := exec.CommandContext(ctx, "ovn-nbctl", "create", "DNS",
        fmt.Sprintf("external_ids:switch=%s", switchID),
        "records={}",
    )
    
    output, err := cmd.Output()
    if err != nil {
        return fmt.Errorf("failed to create DNS zone: %w", err)
    }
    
    // Associate DNS with switch
    dnsUUID := strings.TrimSpace(string(output))
    cmd = exec.CommandContext(ctx, "ovn-nbctl", "add",
        "Logical_Switch", switchID, "dns_records", dnsUUID)
    
    return cmd.Run()
}
```

### Add DNS Record

```go
func (s *OVNDNSService) AddDNSRecord(ctx context.Context, record DNSRecord) error {
    // Find DNS entry for switch
    dnsUUID, err := s.findDNSEntry(ctx, record.SwitchID)
    if err != nil {
        // Create DNS zone if doesn't exist
        s.CreateDNSZone(ctx, record.SwitchID)
        dnsUUID, _ = s.findDNSEntry(ctx, record.SwitchID)
    }
    
    // Get existing records
    records := s.getDNSRecords(ctx, dnsUUID)
    
    // Add new record
    records[record.FQDN] = record.IPAddress
    if record.Hostname != "" && record.Hostname != record.FQDN {
        records[record.Hostname] = record.IPAddress
    }
    
    // Update DNS entry
    recordsStr := s.formatRecords(records)
    cmd := exec.CommandContext(ctx, "ovn-nbctl", "set", "DNS", dnsUUID,
        fmt.Sprintf("records=%s", recordsStr))
    
    return cmd.Run()
}
```

### Remove DNS Record

```go
func (s *OVNDNSService) RemoveDNSRecord(ctx context.Context, switchID, hostname string) error {
    dnsUUID, err := s.findDNSEntry(ctx, switchID)
    if err != nil {
        return nil // Already doesn't exist
    }
    
    // Get and modify records
    records := s.getDNSRecords(ctx, dnsUUID)
    delete(records, hostname)
    
    // Update DNS entry
    recordsStr := s.formatRecords(records)
    cmd := exec.CommandContext(ctx, "ovn-nbctl", "set", "DNS", dnsUUID,
        fmt.Sprintf("records=%s", recordsStr))
    
    return cmd.Run()
}
```

### Configure Upstream Forwarders

```go
func (s *OVNDNSService) ConfigureForwarders(ctx context.Context, switchID string, servers []string) error {
    // Get DHCP options for the switch
    dhcpOptUUID := s.getDHCPOptions(ctx, switchID)
    
    // Set dns_server option
    dnsServers := strings.Join(servers, ",")
    cmd := exec.CommandContext(ctx, "ovn-nbctl", "set", "DHCP_Options", dhcpOptUUID,
        fmt.Sprintf("options:dns_server=%s", dnsServers))
    
    return cmd.Run()
}
```

---

## VM Integration

### Automatic DNS Registration

When a VM is created:

```go
func (vmService *VMService) CreateVM(ctx context.Context, spec VMSpec) (*VM, error) {
    // ... create VM ...
    
    // Register DNS record
    record := network.DNSRecord{
        Hostname:  spec.Name,
        FQDN:      fmt.Sprintf("%s.internal", spec.Name),
        IPAddress: vm.IP,
        SwitchID:  spec.NetworkID,
    }
    
    dnsService.AddDNSRecord(ctx, record)
    
    return vm, nil
}
```

When a VM is deleted:

```go
func (vmService *VMService) DeleteVM(ctx context.Context, vmID string) error {
    vm := vmService.Get(ctx, vmID)
    
    // Remove DNS record
    dnsService.RemoveDNSRecord(ctx, vm.NetworkID, vm.Name)
    
    // ... delete VM ...
    return nil
}
```

### DHCP Configuration

VMs receive DNS server via DHCP:

```bash
# DHCP options for network-1
ovn-nbctl list DHCP_Options

# Output:
_uuid    : abcd1234-...
cidr     : 10.0.0.0/24
options  : {
    lease_time="3600",
    router="10.0.0.1",
    server_id="10.0.0.1",
    server_mac="fa:16:3e:00:00:01",
    dns_server="10.0.0.1"  ◄── Points to logical switch
}
```

---

## OVN Commands

### Create DNS Entry

```bash
# Create DNS entry for switch
ovn-nbctl create DNS external_ids:switch=network-1 records='{}'

# Associate with switch
ovn-nbctl add Logical_Switch network-1 dns_records <dns-uuid>
```

### Add DNS Record

```bash
# Add single record
ovn-nbctl set DNS <dns-uuid> records:web-server.internal="10.0.0.10"

# Add multiple records
ovn-nbctl set DNS <dns-uuid> records='{"web-server.internal"="10.0.0.10","db-server.internal"="10.0.0.11"}'
```

### Remove DNS Record

```bash
# Remove specific record
ovn-nbctl remove DNS <dns-uuid> records web-server.internal
```

### List DNS Records

```bash
# Show all DNS entries
ovn-nbctl list DNS

# Show records for specific DNS entry
ovn-nbctl get DNS <dns-uuid> records
```

---

## DHCP DNS Forwarder Configuration

### Set External DNS Servers

```bash
# Configure DHCP to tell VMs about external DNS
ovn-nbctl set DHCP_Options <dhcp-uuid> options:dns_server="8.8.8.8,8.8.4.4"
```

### Use Internal DNS + External Forwarding

For VMs to resolve both internal and external names:

1. Point VMs to logical switch IP (via DHCP)
2. OVN DNS handles internal lookups
3. External queries forwarded automatically

---

## DNS Domain Configuration

### Custom Internal Domain

```go
const InternalDomain = ".internal"

func (s *OVNDNSService) AddRecord(hostname, ip, switchID string) error {
    // Register both short name and FQDN
    records := map[string]string{
        hostname:                           ip,
        hostname + InternalDomain:          ip,
    }
    // ...
}
```

### Per-Network Domains

```go
func (s *OVNDNSService) AddRecordWithDomain(hostname, ip, switchID, domain string) error {
    fqdn := fmt.Sprintf("%s.%s.internal", hostname, domain)
    // ...
}
```

---

## Usage Examples

### From Inside a VM

```bash
# Resolve another VM by name
ping web-server
# or
ping web-server.internal

# nslookup
nslookup db-server
# Server:     10.0.0.1
# Address:    10.0.0.1#53
#
# Name:       db-server.internal
# Address:    10.0.0.11

# External resolution (forwarded)
nslookup google.com
# Server:     10.0.0.1  (but forwarded to 8.8.8.8)
# Address:    142.250.x.x
```

### API Usage

```bash
# Add DNS record
curl -X POST http://localhost:8080/api/v1/networks/net-1/dns \
  -H "Content-Type: application/json" \
  -d '{
    "hostname": "web-server",
    "ip_address": "10.0.0.10"
  }'

# List DNS records
curl http://localhost:8080/api/v1/networks/net-1/dns

# Response:
{
  "records": [
    {"hostname": "web-server", "fqdn": "web-server.internal", "ip": "10.0.0.10"},
    {"hostname": "db-server", "fqdn": "db-server.internal", "ip": "10.0.0.11"}
  ]
}
```

---

## Troubleshooting

### DNS Not Resolving Inside VM

1. Check DHCP assigned DNS:
```bash
# Inside VM
cat /etc/resolv.conf
# Should show: nameserver 10.0.0.1 (or switch IP)
```

2. Verify OVN DNS entry exists:
```bash
ovn-nbctl list DNS
```

3. Check DNS records:
```bash
ovn-nbctl get DNS <uuid> records
```

### External DNS Not Working

1. Verify forwarder configuration:
```bash
ovn-nbctl get DHCP_Options <uuid> options
# Should show dns_server option
```

2. Check connectivity to external DNS:
```bash
# Inside VM
ping 8.8.8.8
```

### Stale DNS Records

After VM deletion, record may remain:

```bash
# Manually remove
ovn-nbctl remove DNS <dns-uuid> records "old-vm.internal"
```

---

## Best Practices

### 1. Use Consistent Naming

```
vm-name.internal         ✓ Good
my-vm.internal           ✓ Good
VM_NAME.internal         ✗ Avoid (underscores)
my.vm.name.internal      ✗ Avoid (dots in hostname)
```

### 2. Reserve Special Names

Don't use these as VM names:
- `gateway`
- `router`
- `dns`
- `dhcp`

### 3. TTL Settings

For dynamic environments, use low TTL:
```go
record.TTL = 60 // 60 seconds
```

For static environments, use higher TTL:
```go
record.TTL = 3600 // 1 hour
```

---

## Files

| File | Description |
|------|-------------|
| `backend/internal/services/network/ovn_dns.go` | DNS service implementation |
| `backend/internal/services/vm/service.go` | VM integration |

---

## See Also

- [000048-network-backend-ovn-ovs.md](000048-network-backend-ovn-ovs.md) - OVN architecture
- [000051-dhcp-dns-configuration.md](000051-dhcp-dns-configuration.md) - DHCP/DNS basics
