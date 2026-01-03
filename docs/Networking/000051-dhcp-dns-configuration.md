# 000051 - DHCP and DNS Configuration Guide

**Purpose:** Configure OVN's built-in DHCP and integrate CoreDNS for DNS resolution in QuantumNet.

**Status:** ✅ Complete

---

## Overview

QuantumNet provides automatic IP assignment and name resolution through:
- **OVN DHCP**: Native DHCP implementation in OVN (no external DHCP server needed)
- **CoreDNS**: Lightweight DNS server reading from OVN state for "Magic DNS"

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Control Plane                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  LimiQuantix API Server                                              │   │
│  │    │                                                                 │   │
│  │    ▼                                                                 │   │
│  │  NetworkService ──────►  OVN Northbound DB                           │   │
│  │    - CreateNetwork()      - DHCP Options                             │   │
│  │    - CreatePort()         - Port addresses                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                          ┌─────────┴─────────┐                              │
│                          ▼                   ▼                              │
│                    OVN DHCP              CoreDNS                            │
│                    (built-in)          (reads OVN state)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
             ┌─────────────┐                 ┌─────────────┐
             │   VM 1      │                 │   VM 2      │
             │             │                 │             │
             │ DHCP Client │                 │ DHCP Client │
             │ DNS Resolver│                 │ DNS Resolver│
             └─────────────┘                 └─────────────┘
```

---

## Part 1: OVN Built-in DHCP

OVN provides native DHCP through logical flows - no external DHCP server required.

### 1.1 How OVN DHCP Works

1. **DHCP Options Object**: Created for each subnet with lease parameters
2. **Port Association**: Each port references the DHCP options for its subnet
3. **OVN Controller**: Intercepts DHCP packets and responds locally on each node
4. **No Broadcast**: DHCP is handled at the OVS level, no network flooding

### 1.2 DHCP Options Configuration

When creating a network via API, DHCP is configured automatically:

```bash
# API request with DHCP enabled
curl -X POST http://localhost:8080/limiquantix.network.v1.VirtualNetworkService/CreateNetwork \
  -H "Content-Type: application/json" \
  -d '{
    "name": "internal-network",
    "project_id": "default",
    "spec": {
      "type": "OVERLAY",
      "ip_config": {
        "ipv4_subnet": "10.0.1.0/24",
        "ipv4_gateway": "10.0.1.1",
        "dhcp": {
          "enabled": true,
          "lease_time_sec": 86400,
          "dns_servers": ["10.0.0.2", "8.8.8.8"],
          "domain_name": "internal.limiquantix.local"
        }
      }
    }
  }'
```

### 1.3 OVN DHCP Options Reference

| Option | Description | Default |
|--------|-------------|---------|
| `lease_time` | Lease duration in seconds | 86400 (24h) |
| `router` | Default gateway IP | Subnet gateway |
| `server_id` | DHCP server identifier | Gateway IP |
| `server_mac` | DHCP server MAC | Random |
| `dns_server` | DNS servers | 8.8.8.8 |
| `domain_name` | DNS search domain | - |
| `mtu` | Network MTU | 1450 (Geneve) |
| `ntp_server` | NTP server address | - |
| `classless_static_route` | Static routes | - |

### 1.4 Manual DHCP Configuration

For advanced configurations, use ovn-nbctl:

```bash
# Create DHCP options
ovn-nbctl dhcp-options-create 10.0.1.0/24

# Set options
UUID=$(ovn-nbctl --bare --columns=_uuid find dhcp_options cidr=10.0.1.0/24)
ovn-nbctl dhcp-options-set-options $UUID \
  lease_time=86400 \
  router=10.0.1.1 \
  server_id=10.0.1.1 \
  server_mac=fa:16:3e:00:00:01 \
  dns_server="{10.0.0.2, 8.8.8.8}" \
  domain_name="\"limiquantix.local\"" \
  mtu=1450

# Associate with port
ovn-nbctl lsp-set-dhcpv4-options lsp-port-123 $UUID
```

### 1.5 IPv6 DHCP

OVN also supports DHCPv6:

```bash
# Create DHCPv6 options
ovn-nbctl dhcp-options-create "2001:db8::/64"

UUID=$(ovn-nbctl --bare --columns=_uuid find dhcp_options cidr="2001:db8::/64")
ovn-nbctl dhcp-options-set-options $UUID \
  server_id="00:00:00:00:00:01" \
  dns_server="{2001:4860:4860::8888}"

# Associate with port
ovn-nbctl lsp-set-dhcpv6-options lsp-port-123 $UUID
```

---

## Part 2: CoreDNS Integration ("Magic DNS")

CoreDNS provides internal DNS resolution by reading OVN state.

### 2.1 How Magic DNS Works

1. **VM creates port** → LimiQuantix assigns hostname + IP
2. **OVN stores** hostname in port external_ids
3. **CoreDNS watches** OVN Northbound DB for changes
4. **DNS queries** resolved to port IP addresses

Example flow:
```
VM "web-server" (10.0.1.50) wants to reach "db-server"
    │
    ▼
DNS query: db-server.limiquantix.local
    │
    ▼
CoreDNS → OVN NB DB → find port with hostname="db-server"
    │
    ▼
Response: 10.0.1.51
```

### 2.2 Install CoreDNS

```bash
# Download CoreDNS
wget https://github.com/coredns/coredns/releases/download/v1.11.1/coredns_1.11.1_linux_amd64.tgz
tar xvf coredns_1.11.1_linux_amd64.tgz
mv coredns /usr/local/bin/
```

### 2.3 CoreDNS Configuration

Create `/etc/coredns/Corefile`:

```
# LimiQuantix internal zone
limiquantix.local:53 {
    # Read from OVN Northbound database
    ovn {
        db tcp://127.0.0.1:6641
        # Optional: SSL
        # db ssl://127.0.0.1:6641
        # ca /etc/ovn/ca.pem
        # cert /etc/ovn/client.pem
        # key /etc/ovn/client-key.pem
        
        # Refresh interval
        ttl 60
        
        # Domain suffix for hostnames
        domain limiquantix.local
    }

    # Enable DNS caching
    cache 60

    # Log queries
    log

    # Handle errors
    errors
}

# Project-specific zones
*.project.limiquantix.local:53 {
    ovn {
        db tcp://127.0.0.1:6641
        ttl 30
    }
    cache 30
    log
}

# Forward external queries
.:53 {
    forward . 8.8.8.8 8.8.4.4
    cache 3600
    log
}
```

### 2.4 OVN CoreDNS Plugin

The OVN plugin for CoreDNS needs to be built or installed. Create the plugin:

**File: `/etc/coredns/plugin/ovn/ovn.go`** (simplified example)

```go
package ovn

import (
    "context"
    "fmt"
    "strings"
    "sync"

    "github.com/coredns/coredns/plugin"
    "github.com/miekg/dns"
    "github.com/ovn-org/libovsdb/client"
)

type OVN struct {
    Next   plugin.Handler
    DB     string
    Domain string
    TTL    uint32

    client *client.Client
    cache  map[string]string // hostname -> IP
    mu     sync.RWMutex
}

func (o *OVN) ServeDNS(ctx context.Context, w dns.ResponseWriter, r *dns.Msg) (int, error) {
    qname := strings.ToLower(r.Question[0].Name)
    
    // Check if it's our domain
    if !strings.HasSuffix(qname, o.Domain+".") {
        return plugin.NextOrFailure(o.Name(), o.Next, ctx, w, r)
    }
    
    // Extract hostname
    hostname := strings.TrimSuffix(qname, "."+o.Domain+".")
    
    // Look up in OVN
    ip := o.lookupHostname(hostname)
    if ip == "" {
        return dns.RcodeNameError, nil
    }
    
    // Build response
    resp := new(dns.Msg)
    resp.SetReply(r)
    resp.Answer = append(resp.Answer, &dns.A{
        Hdr: dns.RR_Header{
            Name:   qname,
            Rrtype: dns.TypeA,
            Class:  dns.ClassINET,
            Ttl:    o.TTL,
        },
        A: net.ParseIP(ip),
    })
    
    w.WriteMsg(resp)
    return dns.RcodeSuccess, nil
}

func (o *OVN) lookupHostname(hostname string) string {
    o.mu.RLock()
    defer o.mu.RUnlock()
    return o.cache[hostname]
}

// Watch OVN for changes and update cache
func (o *OVN) watchOVN(ctx context.Context) {
    // Implementation watches OVN NB for port changes
    // Updates cache with hostname -> IP mappings from port external_ids
}
```

### 2.5 Alternative: Etcd-based DNS

If using etcd for cluster state, you can use the built-in etcd plugin:

```
limiquantix.local:53 {
    etcd {
        path /limiquantix/dns
        endpoint http://127.0.0.1:2379
    }
    cache 60
    log
}
```

Control plane populates etcd with DNS records:

```go
// When creating a port
key := fmt.Sprintf("/limiquantix/dns/%s/%s", projectID, hostname)
value := `{"host": "10.0.1.50"}`
etcdClient.Put(ctx, key, value)
```

### 2.6 Run CoreDNS

```bash
# Create systemd service
cat > /etc/systemd/system/coredns.service << EOF
[Unit]
Description=CoreDNS DNS server
Documentation=https://coredns.io
After=network.target

[Service]
ExecStart=/usr/local/bin/coredns -conf /etc/coredns/Corefile
Restart=on-failure
User=coredns
Group=coredns
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

# Create user
useradd -r -s /sbin/nologin coredns

# Start service
systemctl daemon-reload
systemctl enable --now coredns

# Test
dig @localhost web-server.limiquantix.local
```

### 2.7 Configure VMs to Use CoreDNS

Set the DNS server in DHCP options:

```go
// In NetworkService.CreateNetwork()
dhcpOpts := ovn.DHCPOptionsConfig{
    CIDR:       "10.0.1.0/24",
    Router:     "10.0.1.1",
    LeaseTime:  86400,
    DNSServers: []string{"10.0.0.2"}, // CoreDNS IP
    DomainName: "limiquantix.local",
}
```

---

## Part 3: LimiQuantix Integration

### 3.1 Network Service DHCP Configuration

**File: `backend/internal/services/network/network_service.go`**

```go
func (s *NetworkService) configureDHCP(ctx context.Context, network *domain.VirtualNetwork) error {
    if network.Spec.IPConfig.DHCP == nil || !network.Spec.IPConfig.DHCP.Enabled {
        return nil
    }

    dhcp := network.Spec.IPConfig.DHCP
    opts := ovn.DHCPOptionsConfig{
        CIDR:       network.Spec.IPConfig.IPv4Subnet,
        Router:     network.Spec.IPConfig.IPv4Gateway,
        ServerID:   network.Spec.IPConfig.IPv4Gateway,
        ServerMAC:  s.generateDHCPServerMAC(),
        LeaseTime:  int(dhcp.LeaseTimeSec),
        DNSServers: dhcp.DNSServers,
        DomainName: dhcp.DomainName,
    }

    if network.Spec.MTU > 0 {
        opts.MTU = network.Spec.MTU
    } else {
        opts.MTU = 1450 // Default for Geneve overlay
    }

    uuid, err := s.ovnClient.CreateDHCPOptions(ctx, opts)
    if err != nil {
        return fmt.Errorf("failed to create DHCP options: %w", err)
    }

    // Store UUID for port association
    network.Status.DHCPOptionsID = uuid
    return nil
}
```

### 3.2 Port Service DNS Registration

**File: `backend/internal/services/network/port_service.go`**

```go
func (s *PortService) createPortWithDNS(ctx context.Context, port *domain.Port) error {
    // Create OVN port with hostname in external_ids
    ovnPort, err := s.ovnClient.CreateLogicalSwitchPort(ctx, port)
    if err != nil {
        return err
    }

    // Register DNS entry if hostname is set
    if port.Spec.Hostname != "" {
        dnsName := fmt.Sprintf("%s.%s.limiquantix.local", 
            port.Spec.Hostname,
            port.ProjectID,
        )
        
        // If using etcd-based DNS
        if s.etcdClient != nil {
            key := fmt.Sprintf("/limiquantix/dns/%s/%s", 
                port.ProjectID, 
                port.Spec.Hostname,
            )
            value := fmt.Sprintf(`{"host": "%s"}`, port.Spec.FixedIPs[0].IPAddress)
            s.etcdClient.Put(ctx, key, value)
        }

        s.logger.Info("DNS registered",
            zap.String("hostname", dnsName),
            zap.String("ip", port.Spec.FixedIPs[0].IPAddress),
        )
    }

    return nil
}
```

### 3.3 Configuration Options

**File: `backend/config.yaml`**

```yaml
network:
  ovn:
    enabled: true
    northbound_address: "tcp://10.0.0.1:6641"

  dhcp:
    default_lease_time: 86400
    default_dns_servers:
      - "10.0.0.2"  # CoreDNS
      - "8.8.8.8"   # Fallback
    default_domain: "limiquantix.local"
    default_mtu: 1450

  dns:
    enabled: true
    provider: "coredns"  # or "etcd"
    coredns_address: "10.0.0.2:53"
    domain: "limiquantix.local"
```

---

## Part 4: Troubleshooting

### 4.1 DHCP Issues

**VM not getting IP:**
```bash
# Check DHCP options exist
ovn-nbctl dhcp-options-list

# Verify port has DHCP options assigned
ovn-nbctl lsp-get-dhcpv4-options lsp-port-123

# Check OVN controller logs
journalctl -u ovn-controller -f

# Trace DHCP packet
ovn-trace <datapath> 'inport == "lsp-xxx" && eth.type == 0x0800 && ip.proto == 17 && udp.dst == 67'
```

**Wrong options received:**
```bash
# Inside VM
sudo dhclient -v -d eth0

# Check received options
cat /var/lib/dhcp/dhclient.leases
```

### 4.2 DNS Issues

**Name not resolving:**
```bash
# Test CoreDNS directly
dig @10.0.0.2 myvm.limiquantix.local

# Check CoreDNS logs
journalctl -u coredns -f

# Verify hostname in OVN
ovn-nbctl --columns=external_ids lsp-list <switch> | grep hostname
```

**Slow resolution:**
```bash
# Check if caching is working
dig @10.0.0.2 myvm.limiquantix.local  # First query
dig @10.0.0.2 myvm.limiquantix.local  # Should be faster

# Increase cache TTL in Corefile
cache 300
```

### 4.3 Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No DHCP response | DHCP options not linked to port | `lsp-set-dhcpv4-options` |
| Wrong gateway | Router option misconfigured | Check `ovn-nbctl dhcp-options-get-options` |
| DNS timeout | CoreDNS not running | `systemctl status coredns` |
| Name not found | Hostname not in OVN | Check port external_ids |
| MTU issues | Wrong MTU in DHCP | Set `mtu` option |

---

## Part 5: Best Practices

### 5.1 DHCP

1. **Use short lease times for development** (300s) to quickly test changes
2. **Use long lease times for production** (86400s+) to reduce DHCP traffic
3. **Always set MTU** to avoid fragmentation (1450 for Geneve)
4. **Include multiple DNS servers** for redundancy

### 5.2 DNS

1. **Use hierarchical naming**: `<hostname>.<project>.limiquantix.local`
2. **Set reasonable TTLs**: 60s for internal, 3600s for external forwards
3. **Log queries** in development, reduce logging in production
4. **Monitor CoreDNS metrics** with Prometheus exporter

### 5.3 Security

1. **DHCP**: OVN's native DHCP is secure by design (no rogue DHCP)
2. **DNS**: Use DNS over TLS for external queries if needed
3. **Split horizon**: Use different DNS views for internal/external

---

## Quick Reference

### DHCP Commands

| Command | Purpose |
|---------|---------|
| `ovn-nbctl dhcp-options-list` | List all DHCP options |
| `ovn-nbctl dhcp-options-get-options <uuid>` | Show DHCP options |
| `ovn-nbctl dhcp-options-set-options <uuid> key=val` | Set DHCP options |
| `ovn-nbctl lsp-set-dhcpv4-options <port> <uuid>` | Assign to port |
| `ovn-nbctl lsp-get-dhcpv4-options <port>` | Get port's DHCP |

### DNS Commands

| Command | Purpose |
|---------|---------|
| `dig @<dns> <name>` | Query DNS server |
| `dig +short @<dns> <name>` | Query with short output |
| `dig +trace @<dns> <name>` | Trace resolution path |
| `host <name> <dns>` | Simple lookup |
| `nslookup <name> <dns>` | Interactive lookup |

---

## References

- [OVN DHCP Options](https://docs.ovn.org/en/latest/ref/ovn-nb.5.html#dhcp-options-table)
- [CoreDNS Documentation](https://coredns.io/manual/toc/)
- [CoreDNS Plugins](https://coredns.io/plugins/)
