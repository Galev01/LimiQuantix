# ADR-004: Network Model Design

**Status:** Accepted  
**Date:** 2025-01-01  
**Authors:** limiquantix Team

## Context

limiquantix requires software-defined networking (SDN) that:
- Enables multi-tenancy with network isolation
- Provides distributed networking across nodes
- Supports enterprise features (load balancing, VPN, floating IPs)
- Integrates with physical network infrastructure

## Decision

We have designed a comprehensive network model based on **OVN (Open Virtual Network)** with additional enterprise features.

### Key Components

1. **VirtualNetwork** - Isolated L2 network (like a VLAN)
2. **Port** - Connection point for VMs
3. **SecurityGroup** - Firewall rules
4. **FloatingIp** - Public IP assignment
5. **LoadBalancer** - Traffic distribution
6. **VpnService** - Site-to-site VPN

### Key Design Principles

#### 1. OVN as the Foundation

OVN provides:
- Distributed L2/L3 networking
- Native overlay networking (Geneve encapsulation)
- Distributed firewall (ACLs)
- Load balancing
- NAT and routing

```protobuf
message VirtualNetworkSpec {
  enum NetworkType {
    OVERLAY = 0;   // OVN Geneve (default)
    VLAN = 1;      // VLAN-tagged
    EXTERNAL = 2;  // Provider network
    ISOLATED = 3;  // No external access
  }
  NetworkType type = 1;
}
```

#### 2. IP Address Management

Built-in DHCP and IP allocation:

```protobuf
message IpAddressManagement {
  string ipv4_subnet = 1;      // "10.0.1.0/24"
  string ipv4_gateway = 2;
  DhcpConfig dhcp = 5;
  repeated IpRange allocation_pools = 6;
  repeated string reserved_ips = 7;
}
```

#### 3. Security Groups (Distributed Firewall)

Stateful firewall rules applied per-port:

```protobuf
message SecurityGroupRule {
  Direction direction = 2;  // INGRESS or EGRESS
  string protocol = 3;      // "tcp", "udp", "icmp"
  uint32 port_min = 4;
  uint32 port_max = 5;
  string remote_ip_prefix = 8;  // CIDR
  Action action = 10;       // ALLOW, DROP, REJECT
}
```

Rules are applied at the hypervisor level via OVS flow rules, not at a central firewall.

#### 4. SR-IOV Support

Hardware-accelerated networking for low-latency workloads:

```protobuf
message BindingProfile {
  enum BindingType {
    NORMAL = 0;      // Standard OVS port
    DIRECT = 1;      // SR-IOV VF passthrough
    MACVTAP = 2;     // MACVTAP device
    VHOST_USER = 3;  // DPDK vhost-user
  }
  BindingType type = 1;
  string pci_slot = 2;  // SR-IOV VF PCI address
}
```

### Feature Coverage

| Feature | VMware Equivalent | limiquantix Implementation |
|---------|------------------|---------------------------|
| vDS | Distributed vSwitch | OVN Logical Switch |
| NSX-T Segments | NSX Segments | `VirtualNetwork` |
| DFW | Distributed Firewall | `SecurityGroup` (OVN ACLs) |
| NSX Load Balancer | NSX-T LB | `LoadBalancer` (OVN LB) |
| NSX VPN | IPsec VPN | `VpnService` |
| Floating IPs | NAT Rules | `FloatingIp` |
| Micro-segmentation | NSX Micro-seg | Security Groups per-port |
| SR-IOV | DirectPath I/O | `BindingProfile.DIRECT` |

### Network Architecture

```
                    ┌─────────────────────────────────────┐
                    │          External Network           │
                    │         (Provider/Physical)          │
                    └─────────────────┬───────────────────┘
                                      │
                    ┌─────────────────▼───────────────────┐
                    │          OVN Router                  │
                    │   (SNAT, Floating IP, VPN, LB)       │
                    └─────────────────┬───────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
┌─────────▼─────────┐       ┌─────────▼─────────┐       ┌─────────▼─────────┐
│  Virtual Network  │       │  Virtual Network  │       │  Virtual Network  │
│   (Tenant A)      │       │   (Tenant B)      │       │   (Shared)        │
│   10.0.1.0/24     │       │   10.0.2.0/24     │       │   10.0.100.0/24   │
└─────────┬─────────┘       └─────────┬─────────┘       └─────────┬─────────┘
          │                           │                           │
    ┌─────┴─────┐               ┌─────┴─────┐               ┌─────┴─────┐
    │    VM     │               │    VM     │               │    VM     │
    │  (Port)   │               │  (Port)   │               │  (Port)   │
    └───────────┘               └───────────┘               └───────────┘
```

## Consequences

### Positive

- **Multi-tenancy**: Complete network isolation per project
- **Distributed**: No central network bottleneck
- **Scalable**: OVN scales to thousands of ports
- **Feature-rich**: L4 LB, VPN, NAT included
- **Hardware offload**: SR-IOV for high-performance

### Negative

- **OVN complexity**: Requires understanding OVN architecture
- **Overlay overhead**: Geneve adds ~50 bytes per packet
- **Limited L7**: No application-layer load balancing (need external)

### Risks

1. **OVN bugs**: Complex distributed system
2. **MTU issues**: Overlay requires careful MTU planning

## Implementation Notes

### OVN Integration

```go
// Creating a network in OVN
func CreateNetwork(spec *VirtualNetworkSpec) error {
    // Create OVN Logical Switch
    ls := ovn.LogicalSwitch{
        Name: fmt.Sprintf("ls-%s", networkID),
    }
    
    // Add subnet
    ls.OtherConfig["subnet"] = spec.IpConfig.Ipv4Subnet
    
    // Create DHCP options if enabled
    if spec.IpConfig.Dhcp.Enabled {
        dhcpOptions := ovn.DHCPOptions{
            Cidr: spec.IpConfig.Ipv4Subnet,
            Options: map[string]string{
                "router": spec.IpConfig.Ipv4Gateway,
                "dns_server": strings.Join(spec.IpConfig.Dhcp.DnsServers, ","),
            },
        }
        ovnClient.CreateDHCPOptions(dhcpOptions)
    }
    
    return ovnClient.CreateLogicalSwitch(ls)
}
```

### Security Group Flow

```
Port → Security Group Rules → OVN ACLs → OVS Flow Rules
```

## References

- [OVN Architecture](https://docs.ovn.org/en/latest/ref/ovn-architecture.7.html)
- [VMware NSX-T Reference Design](https://docs.vmware.com/en/VMware-NSX-T-Data-Center/)
- [OpenStack Neutron OVN Driver](https://docs.openstack.org/neutron/latest/admin/ovn/)

