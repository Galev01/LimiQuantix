# ADR-009: QuantumNet - Distributed Network Architecture

**Status:** Accepted  
**Date:** 2025-01-03  
**Authors:** limiquantix Team

## Context

limiquantix aims to replace VMware vSphere's Distributed Switch (vDS) and NSX-T with a modern, simpler alternative. The requirements are:

1. **Distributed Architecture** - A network created via the API must instantly exist on all nodes
2. **Multi-tenancy** - Complete network isolation per project
3. **Two Network Types** - VLAN/Flat (like Port Groups) and Overlay/VPC (like NSX Segments)
4. **Enterprise Features** - Security groups, floating IPs, load balancing, VPN
5. **Modern UX** - Magic DNS, tag-based microsegmentation, WireGuard bastion

## Decision

We implement **QuantumNet** using **OVN (Open Virtual Network)** with **OVS (Open vSwitch)** as the distributed SDN backend.

### Why OVN?

| Requirement | OVN Capability |
|-------------|----------------|
| Distributed | OVN separates Logical State (NB DB) from Physical State (SB DB) |
| VLAN Support | Localnet ports with VLAN tags |
| Overlay | Geneve encapsulation (better than VXLAN) |
| Security Groups | Native ACLs compiled to OVS flows |
| DHCP | Built-in DHCP server per logical switch |
| NAT/Floating IPs | Logical router with SNAT/DNAT |
| Load Balancing | Native L4 load balancing |

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Control Plane (Go)                                 │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────┐│
│  │ NetworkService  │────▶│ OVN Northbound  │────▶│   OVN NB Database       ││
│  │  - Create VNet  │     │    Client       │     │   (tcp://ovn:6641)      ││
│  │  - Create Port  │     │   (libovsdb)    │     │   - Logical Switches    ││
│  │  - Security     │     │                 │     │   - Logical Routers     ││
│  │  - Floating IP  │     │                 │     │   - ACLs, NAT, LB       ││
│  └─────────────────┘     └─────────────────┘     └─────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                    │                                           
                                    ▼ (OVN translates to OpenFlow)               
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OVN Southbound DB                                  │
│                    (Physical bindings, Chassis, Flows)                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │                                           
                    ┌───────────────┴───────────────┐                          
                    ▼                               ▼                          
┌──────────────────────────────┐  ┌──────────────────────────────┐             
│      Hypervisor Node 1       │  │      Hypervisor Node 2       │             
│  ┌────────────────────────┐  │  │  ┌────────────────────────┐  │             
│  │  OVN Controller        │  │  │  │  OVN Controller        │  │             
│  │  - Sync from SB DB     │  │  │  │  - Sync from SB DB     │  │             
│  │  - Program OVS flows   │  │  │  │  - Program OVS flows   │  │             
│  └────────────────────────┘  │  │  └────────────────────────┘  │             
│  ┌────────────────────────┐  │  │  ┌────────────────────────┐  │             
│  │  Open vSwitch (OVS)    │  │  │  │  Open vSwitch (OVS)    │  │             
│  │  ┌──────────────────┐  │  │  │  ┌──────────────────────┐  │             
│  │  │  br-int (integ)  │  │  │  │  │  br-int (integ)      │  │             
│  │  │   VM1 ──────────────────────────── VM2              │  │             
│  │  │   (Geneve Tunnel)   │  │  │  │   (Geneve Tunnel)    │  │             
│  │  └──────────────────┘  │  │  │  └──────────────────────┘  │             
│  └────────────────────────┘  │  │  └────────────────────────┘  │             
│  ┌────────────────────────┐  │  │  ┌────────────────────────┐  │             
│  │  Node Daemon (Rust)    │  │  │  │  Node Daemon (Rust)    │  │             
│  │  - OVS Port Manager    │  │  │  │  - OVS Port Manager    │  │             
│  │  - Bind VM TAP→br-int  │  │  │  │  - Bind VM TAP→br-int  │  │             
│  └────────────────────────┘  │  │  └────────────────────────┘  │             
└──────────────────────────────┘  └──────────────────────────────┘             
```

### Packet Flow: VM A (Node 1) → VM B (Node 2) over Geneve

```
1. VM A sends packet to its vNIC (TAP device)
2. TAP is connected to br-int (OVS integration bridge)
3. OVS matches flow rules from OVN controller
4. Packet encapsulated in Geneve (UDP 6081) with VNI
5. Geneve packet sent to Node 2 via underlay network
6. Node 2 br-int receives Geneve packet
7. OVS decapsulates, matches destination port
8. Packet delivered to VM B's TAP device
```

## Network Types

### 1. Overlay (Default) - Like NSX Segments

```protobuf
message VirtualNetworkSpec {
  NetworkType type = 1;  // OVERLAY
  IpAddressManagement ip_config = 2;  // 10.0.1.0/24
}
```

**Implementation:**
- Create OVN Logical Switch
- Configure DHCP options (OVN built-in)
- Geneve encapsulation handles multi-node

**Pros:** Complete isolation, overlapping IP ranges per tenant
**Cons:** ~50 bytes overhead per packet

### 2. VLAN - Like VMware Port Groups

```protobuf
message VirtualNetworkSpec {
  NetworkType type = 1;  // VLAN
  VlanConfig vlan = 3;   // vlan_id: 100, physical_network: "physnet1"
}
```

**Implementation:**
- Create OVN Logical Switch with VLAN tag
- Create localnet port connecting to physical network
- Traffic exits on physical VLAN

**Pros:** No encapsulation overhead, direct L2 access
**Cons:** Requires physical network VLAN trunking

## Security Groups (Distributed Firewall)

Security groups are translated to OVN ACLs:

```go
// Rule: Allow SSH from 10.0.0.0/8
rule := SecurityGroupRule{
  Direction: INGRESS,
  Protocol: "tcp",
  PortMin: 22, PortMax: 22,
  RemoteIPPrefix: "10.0.0.0/8",
}

// Becomes OVN ACL:
acl := &ACL{
  Direction: "to-lport",
  Priority:  1000,
  Match:     "inport == @sg-xxx && tcp.dst == 22 && ip4.src == 10.0.0.0/8",
  Action:    "allow-related",
}
```

### Identity-Based Microsegmentation (Zero Trust)

**VMware Way (fragile):** IP-based rules (IPs change, VMs move)

**limiquantix Way (better):** Tag-based rules

```yaml
# Allow Web-Servers to talk to DB-Servers
rule:
  source_tag: "role=web-server"
  destination_tag: "role=db-server"
  port: 5432
```

**Implementation:**
1. Each VM has labels in metadata
2. Control plane maintains OVN Address Sets per tag
3. When VM labels change, address set is updated
4. ACLs reference address sets, not IPs

## Component Responsibilities

### Go Control Plane

| Component | Responsibility |
|-----------|----------------|
| `NetworkService` | gRPC API for networks, ports, security groups |
| `OVNClient` | libovsdb client to OVN Northbound DB |
| `PortAllocator` | MAC address and IP allocation |
| `SecurityGroupService` | Translate SG rules to OVN ACLs |

### Rust Node Daemon

| Component | Responsibility |
|-----------|----------------|
| `OvsPortManager` | Create/bind ports on br-int |
| `LibvirtIntegration` | Generate OVS virtualport XML |
| `NetworkHealthCheck` | Verify OVS/OVN controller status |

## Day 2 Features

### Magic DNS

VMs can reach each other via `<vm-name>.internal`:

```
vm-web-01.internal → 10.0.1.5 (resolved by CoreDNS)
```

**Implementation:**
- CoreDNS plugin reads OVN port state
- Updates DNS records when ports are created/deleted
- Injected via DHCP (dns_server option)

### Floating IPs

```
VM private: 10.0.1.5
Floating IP: 203.0.113.10

# OVN NAT rule (automatic):
lr-nat-add router1 dnat_and_snat 203.0.113.10 10.0.1.5
```

### WireGuard Bastion

Users can generate a WireGuard config to access overlay networks:

```
# From UI: "Download VPN Config"
[Interface]
PrivateKey = ...
Address = 10.0.200.1/32

[Peer]
PublicKey = <bastion-public-key>
Endpoint = vpn.limiquantix.example.com:51820
AllowedIPs = 10.0.0.0/8
```

### BGP ToR Integration

For enterprise bare-metal, advertise overlay IPs to ToR switch:

```
# FRRouting config on gateway node
router bgp 65000
  neighbor 10.0.0.1 remote-as 65001
  address-family ipv4 unicast
    redistribute connected
```

## libvirt Integration

VM network interface XML for OVS:

```xml
<interface type='bridge'>
  <source bridge='br-int'/>
  <virtualport type='openvswitch'>
    <parameters interfaceid='lsp-{port-uuid}'/>
  </virtualport>
  <target dev='vnet0'/>
  <model type='virtio'/>
</interface>
```

The `interfaceid` maps to the OVN logical switch port, allowing OVN controller to apply the correct flows.

## Node Requirements

```bash
# Each hypervisor node needs:
apt install ovn-host openvswitch-switch

# Configure OVS to connect to OVN
ovs-vsctl set Open_vSwitch . \
    external_ids:ovn-remote="tcp://<ovn-central>:6642" \
    external_ids:ovn-encap-type=geneve \
    external_ids:ovn-encap-ip=$(hostname -I | awk '{print $1}') \
    external_ids:system-id=$(hostname)

# Start OVN controller
systemctl enable --now ovn-controller
```

## Consequences

### Positive

- **Distributed:** No central network bottleneck
- **Scalable:** OVN scales to thousands of ports
- **Feature-rich:** L4 LB, VPN, NAT, DHCP built-in
- **Industry Standard:** Used by OpenStack, Red Hat, OVN Kubernetes
- **No Custom Code:** We configure OVN, not write SDN from scratch

### Negative

- **OVN Complexity:** Requires understanding OVN/OVS architecture
- **Overlay Overhead:** Geneve adds ~50 bytes per packet
- **No L7 LB:** Application-layer load balancing needs external solution

### Risks

1. **OVN Bugs:** Complex distributed system (mitigate: use stable versions)
2. **MTU Issues:** Overlay requires MTU planning (mitigate: auto-configure)
3. **Performance:** OVS userspace can bottleneck (mitigate: DPDK, SR-IOV)

## Implementation Plan

### Week 1-2: Foundation
- [ ] OVN Northbound Client (Go + libovsdb)
- [ ] NetworkService CRUD operations
- [ ] OVS Port Manager (Rust)
- [ ] libvirt OVS XML generation

### Week 3-4: Security & DHCP
- [ ] Security Group → ACL translation
- [ ] OVN DHCP configuration
- [ ] Port security (anti-spoofing)

### Week 5-6: Advanced Features
- [ ] Floating IPs (NAT)
- [ ] Magic DNS (CoreDNS plugin)
- [ ] Load Balancing
- [ ] WireGuard Bastion

## References

- [OVN Architecture](https://docs.ovn.org/en/latest/ref/ovn-architecture.7.html)
- [libovsdb](https://github.com/ovn-org/libovsdb)
- [OVN Load Balancing](https://docs.ovn.org/en/latest/tutorials/ovn-openstack.html)
- [VMware NSX-T Reference](https://docs.vmware.com/en/VMware-NSX-T-Data-Center/)
