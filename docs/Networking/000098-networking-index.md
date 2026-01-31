# 000098 - Quantix-KVM Networking Documentation Index

**Purpose:** Central index for all networking documentation in Quantix-KVM.

**Last Updated:** January 31, 2026

---

## Quick Reference

| Feature | Document | Status |
|---------|----------|--------|
| Core OVN/OVS Integration | [000048](000048-network-backend-ovn-ovs.md) | ✅ Production |
| OVN Central Setup | [000050](000050-ovn-central-setup-guide.md) | ✅ Production |
| DHCP/DNS Configuration | [000051](000051-dhcp-dns-configuration.md) | ✅ Production |
| Advanced Features Overview | [000052](000052-advanced-networking-features.md) | ✅ Production |
| QuantumNet Implementation | [000070](000070-quantumnet-implementation-plan.md) | ✅ Complete |
| Native L4 Load Balancing | [000092](000092-load-balancer-service.md) | ✅ Production |
| WireGuard VPN Bastion | [000093](000093-wireguard-vpn-bastion.md) | ✅ Production |
| BGP ToR Integration | [000094](000094-bgp-tor-integration.md) | ✅ Production |
| Packet Trace Debugging | [000095](000095-packet-trace-debugging.md) | ✅ Production |
| Live Migration Networking | [000096](000096-live-migration-networking.md) | ✅ Production |
| OVN DNS (Magic DNS) | [000097](000097-ovn-dns-magic-dns.md) | ✅ Production |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          QUANTIX-KVM NETWORKING                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        Management Layer                                  │ │
│  │                                                                          │ │
│  │   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐               │ │
│  │   │ QvDC Dashboard│   │ QHCI Host UI│   │ QVMC Console │               │ │
│  │   │   (React)    │   │   (React)   │   │   (Tauri)    │               │ │
│  │   └──────┬───────┘   └──────┬───────┘   └──────────────┘               │ │
│  │          │                  │                                           │ │
│  │          │  Connect-RPC    │  REST API                                 │ │
│  │          ▼                  ▼                                           │ │
│  │   ┌────────────────────────────────────────────────────────────────┐   │ │
│  │   │                   Go Control Plane                              │   │ │
│  │   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │   │ │
│  │   │  │ Network  │ │ LoadBal  │ │   VPN    │ │   BGP    │          │   │ │
│  │   │  │ Service  │ │ Service  │ │ Service  │ │ Service  │          │   │ │
│  │   │  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │   │ │
│  │   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │   │ │
│  │   │  │  Packet  │ │Migration │ │ OVN DNS  │ │Topology  │          │   │ │
│  │   │  │  Trace   │ │PortBind │ │  Magic   │ │  Graph   │          │   │ │
│  │   │  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │   │ │
│  │   └────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                          │
│                                    │ gRPC                                     │
│  ┌─────────────────────────────────▼───────────────────────────────────────┐ │
│  │                         Data Plane (Per Host)                            │ │
│  │                                                                          │ │
│  │   ┌────────────────────────────────────────────────────────────────┐   │ │
│  │   │                   Rust Node Daemon                              │   │ │
│  │   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │   │ │
│  │   │  │WireGuard │ │FRRouting │ │ Health   │ │ OVS/OVN  │          │   │ │
│  │   │  │ Manager  │ │ Manager  │ │  Check   │ │  Client  │          │   │ │
│  │   │  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │   │ │
│  │   └────────────────────────────────────────────────────────────────┘   │ │
│  │                                    │                                    │ │
│  │                                    ▼                                    │ │
│  │   ┌────────────────────────────────────────────────────────────────┐   │ │
│  │   │                      OVS/OVN Stack                              │   │ │
│  │   │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │   │ │
│  │   │  │   br-int    │ │   br-ex     │ │ OVN-Controller             │   │ │
│  │   │  │ (Internal)  │ │ (External)  │ │              │              │   │ │
│  │   │  └─────────────┘ └─────────────┘ └─────────────┘              │   │ │
│  │   └────────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Document Categories

### Foundation (Start Here)

| # | Document | Description |
|---|----------|-------------|
| 048 | [OVN/OVS Backend](000048-network-backend-ovn-ovs.md) | Core architecture, data model, control flow |
| 050 | [OVN Central Setup](000050-ovn-central-setup-guide.md) | Deploying OVN central services |
| 051 | [DHCP/DNS Config](000051-dhcp-dns-configuration.md) | Network services basics |

### Advanced Features

| # | Document | Description |
|---|----------|-------------|
| 052 | [Advanced Features](000052-advanced-networking-features.md) | Security groups, NAT, floating IPs |
| 092 | [Load Balancing](000092-load-balancer-service.md) | Native L4 load balancer |
| 093 | [WireGuard VPN](000093-wireguard-vpn-bastion.md) | Secure remote access |
| 094 | [BGP ToR](000094-bgp-tor-integration.md) | Physical network integration |
| 097 | [Magic DNS](000097-ovn-dns-magic-dns.md) | Internal name resolution |

### Operations & Debugging

| # | Document | Description |
|---|----------|-------------|
| 095 | [Packet Trace](000095-packet-trace-debugging.md) | Debug network flows with ovn-trace |
| 096 | [Live Migration](000096-live-migration-networking.md) | Port binding during migration |

### Planning

| # | Document | Description |
|---|----------|-------------|
| 070 | [QuantumNet Plan](000070-quantumnet-implementation-plan.md) | Implementation roadmap |

---

## Feature Matrix

### By UI Support

| Feature | QvDC | QHCI |
|---------|------|------|
| Network Topology | ✅ React Flow | ✅ OVS Status Card |
| Load Balancers | ✅ Full CRUD | ❌ View Only |
| VPN Services | ✅ Full CRUD | ❌ View Only |
| BGP Speakers | ✅ Full CRUD | ✅ Local FRR Status |
| Packet Trace | ✅ Modal | ✅ Modal |
| DNS Records | ✅ Full CRUD | ❌ View Only |

### By Backend Component

| Feature | Go Service | Rust Agent |
|---------|------------|------------|
| Virtual Networks | NetworkService | OVS Client |
| Security Groups | NetworkService | - |
| Load Balancers | LoadBalancerService | Health Checks |
| VPN Services | VpnServiceHandler | WireGuardManager |
| BGP | BGPServiceHandler | FrrManager |
| DNS | OVNDNSService | - |
| Packet Trace | PacketTraceService | - |
| Migration | MigrationPortBindingService | Migration Handler |

---

## OVN Commands Cheat Sheet

### Networks (Logical Switches)

```bash
# List switches
ovn-nbctl ls-list

# Show switch ports
ovn-nbctl lsp-list <switch>

# Show ACLs on switch
ovn-nbctl acl-list <switch>
```

### Routers

```bash
# List routers
ovn-nbctl lr-list

# Show routes
ovn-nbctl lr-route-list <router>

# Show NAT rules
ovn-nbctl lr-nat-list <router>
```

### Load Balancers

```bash
# List load balancers
ovn-nbctl lb-list

# Show specific LB
ovn-nbctl lb-list <lb-name>
```

### DNS

```bash
# List DNS entries
ovn-nbctl list DNS

# Show records
ovn-nbctl get DNS <uuid> records
```

### Debugging

```bash
# Trace packet
ovn-trace <switch> '<flow-spec>'

# Show port binding
ovn-sbctl find Port_Binding logical_port=<port>

# Show chassis
ovn-sbctl list Chassis
```

---

## Common Workflows

### Create Network with All Features

1. Create logical switch (network)
2. Create DHCP options
3. Create DNS zone
4. Attach to router
5. Configure security groups
6. (Optional) Add load balancer
7. (Optional) Set up VPN access

### Debug Connectivity Issue

1. Identify source and destination VMs
2. Get port names from OVN
3. Run packet trace
4. Check ACLs if dropped
5. Verify routing if no path

### Set Up Remote Access

1. Create VPN service on router
2. Add client connections
3. Generate QR codes
4. Configure floating IP
5. (Optional) Enable HA

---

## File Locations

### Backend (Go)

```
backend/internal/services/network/
├── loadbalancer_service.go    # Load balancer management
├── vpn_handler.go             # VPN Connect-RPC handler
├── vpn_service.go             # VPN business logic + HA
├── bgp_handler.go             # BGP Connect-RPC handler
├── bgp_service.go             # BGP business logic
├── packet_trace.go            # ovn-trace wrapper
├── migration.go               # Port binding migration
└── ovn_dns.go                 # Magic DNS
```

### Agent (Rust)

```
agent/limiquantix-node/src/
├── wireguard.rs               # WireGuard manager
├── frr.rs                     # FRRouting manager
├── health_check.rs            # LB health checks
├── migration.rs               # Migration handler
└── ovs/                       # OVS client
```

### Frontend (React)

```
frontend/src/
├── hooks/
│   ├── useLoadBalancers.ts    # LB React Query hooks
│   ├── useVPN.ts              # VPN React Query hooks
│   └── useBGP.ts              # BGP React Query hooks
├── pages/
│   ├── LoadBalancers.tsx      # LB management
│   ├── VPNServices.tsx        # VPN management
│   ├── BGPSpeakers.tsx        # BGP management
│   └── NetworkTopology.tsx    # Visual topology
└── lib/
    └── api-client.ts          # API client

quantix-host-ui/src/
├── components/network/
│   ├── OVSStatusCard.tsx      # OVS status display
│   └── PacketTraceModal.tsx   # Trace UI
└── pages/
    └── Network.tsx            # Network page
```

---

## Related Documentation

- [Quantix-vDC VM Creation](../Quantix-vDC/vm_creation/) - VM lifecycle
- [Guest Agent](../quantix-agent/) - In-VM agent
- [Makefile Build System](../dev/000057-makefile-build-system.md) - Building components

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-31 | Added QuantumNet advanced features (LB, VPN, BGP, DNS, Trace, Migration) |
| 2026-01-15 | Initial OVN/OVS integration |
