# QuantumNet SDN Implementation Plan

**Document ID:** 000070  
**Date:** January 13, 2026  
**Scope:** Complete SDN implementation across Backend, Node Daemon, and Frontend  
**Depends On:** ADR-009 (QuantumNet Architecture)

## Executive Summary

This document provides a detailed, phased implementation plan for QuantumNet - the software-defined networking subsystem for Quantix-vDC. Each phase builds upon the previous, with clear deliverables and success criteria.

---

## Current State Analysis

### What Exists ✅

| Component | Location | Status |
|-----------|----------|--------|
| Domain Models | `backend/internal/domain/network.go` | Complete - VirtualNetwork, Port, SecurityGroup, FloatingIP, LoadBalancer, VPN, BGP |
| OVN Client (Mock) | `backend/internal/network/ovn/client.go` | Exists but uses mock state, not real libovsdb |
| OVN Models | `backend/internal/network/ovn/models.go` | LogicalSwitch, Port, Router, ACL types defined |
| Network Service | `backend/internal/services/network/network_service.go` | Basic CRUD, integrates with mock OVN |
| Security Group Service | `backend/internal/services/network/security_group_service.go` | Basic CRUD |
| Floating IP Service | `backend/internal/services/network/floating_ip_service.go` | Basic CRUD |
| Load Balancer Service | `backend/internal/services/network/load_balancer_service.go` | Basic CRUD |
| VPN Service | `backend/internal/services/network/vpn_service.go` | Basic CRUD |
| BGP Service | `backend/internal/services/network/bgp_service.go` | Basic CRUD |
| OVS Port Manager | `agent/limiquantix-hypervisor/src/network/ovs.rs` | Basic binding, libvirt XML generation |
| Proto Definitions | `proto/limiquantix/network/v1/network.proto` | Complete service definitions |
| Frontend Pages | `frontend/src/pages/VirtualNetworks.tsx`, `SecurityGroups.tsx` | Basic list/create UI |

### What's Missing ❌

| Component | Priority | Effort |
|-----------|----------|--------|
| Real libovsdb client connection | P0 | Medium |
| IPAM service with PostgreSQL persistence | P0 | High |
| Security Group → OVN ACL translation | P0 | Medium |
| Node Daemon chassis sync | P1 | Medium |
| Network topology visualization | P1 | Medium |
| Real-time port status streaming | P2 | Medium |
| CoreDNS integration for Magic DNS | P2 | Medium |
| Migration port handoff | P3 | High |

---

## Phase 1: IPAM Foundation (IP Address Management)

### Goal
Implement a robust IP address allocation system with PostgreSQL persistence, supporting both DHCP and static allocation.

### 1.1 Database Migration for IPAM

**File:** `backend/migrations/000008_ipam.up.sql`

```sql
-- IP allocations table
CREATE TABLE ip_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id UUID NOT NULL REFERENCES virtual_networks(id) ON DELETE CASCADE,
    port_id UUID REFERENCES network_ports(id) ON DELETE SET NULL,
    ip_address INET NOT NULL,
    mac_address MACADDR,
    hostname VARCHAR(255),
    allocation_type VARCHAR(20) DEFAULT 'dynamic', -- dynamic, static, reserved, gateway
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(network_id, ip_address)
);

-- Subnet pools table
CREATE TABLE subnet_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id UUID NOT NULL UNIQUE REFERENCES virtual_networks(id) ON DELETE CASCADE,
    cidr CIDR NOT NULL,
    gateway INET NOT NULL,
    alloc_start INET NOT NULL,
    alloc_end INET NOT NULL,
    total_ips INTEGER NOT NULL,
    allocated_ips INTEGER DEFAULT 0,
    dhcp_options_uuid VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ip_allocations_network ON ip_allocations(network_id);
CREATE INDEX idx_ip_allocations_port ON ip_allocations(port_id);
CREATE INDEX idx_ip_allocations_address ON ip_allocations(ip_address);
```

**Rollback File:** `backend/migrations/000008_ipam.down.sql`

```sql
DROP TABLE IF EXISTS ip_allocations;
DROP TABLE IF EXISTS subnet_pools;
```

### 1.2 IPAM Service Implementation

**File:** `backend/internal/services/network/ipam_service.go`

**Key Features:**
- Thread-safe IP allocation using per-network locks
- Bitmap-based tracking for efficient IP availability checks
- PostgreSQL as source of truth with in-memory cache
- Support for static, dynamic, and reserved allocations
- Automatic gateway and broadcast address reservation
- MAC address generation for new ports

**Interface:**
```go
type IPAMService interface {
    // Pool management
    CreatePool(ctx context.Context, networkID string, spec IPPoolSpec) (*SubnetPool, error)
    DeletePool(ctx context.Context, networkID string) error
    GetPool(ctx context.Context, networkID string) (*SubnetPool, error)
    
    // IP allocation
    AllocateIP(ctx context.Context, networkID, portID, mac string) (*IPAllocation, error)
    AllocateSpecificIP(ctx context.Context, networkID, portID, ip, mac string) (*IPAllocation, error)
    ReleaseIP(ctx context.Context, networkID, portID string) error
    
    // Queries
    GetAllocation(ctx context.Context, networkID, ip string) (*IPAllocation, error)
    ListAllocations(ctx context.Context, networkID string) ([]*IPAllocation, error)
    
    // MAC generation
    GenerateMAC() string
}
```

### 1.3 Port Service Integration

**File:** `backend/internal/services/network/port_service.go`

Update the port creation flow to:
1. Call IPAM service to allocate IP
2. Generate MAC if not provided
3. Create OVN logical switch port
4. Sync DHCP binding to OVN

---

## Phase 2: Real OVN Integration

### Goal
Replace mock OVN client with real libovsdb connection for production-grade SDN.

### 2.1 libovsdb Client Implementation

**File:** `backend/internal/network/ovn/libovsdb_client.go`

**Features:**
- Connection pooling with automatic reconnection
- Transaction batching for atomic operations
- Monitoring for OVN database changes
- Graceful fallback when OVN is unavailable

**Dependencies to add:**
```go
// go.mod
require github.com/ovn-org/libovsdb v0.6.0
```

**Implementation Steps:**
1. Define OVN schema model using libovsdb code generation
2. Create connection manager with retry logic
3. Implement each operation using libovsdb transactions
4. Add health check endpoint

### 2.2 OVN Schema Models

**File:** `backend/internal/network/ovn/schema/`

Generate Go types from OVN Northbound schema:
```bash
# Generate libovsdb models
libovsdbmodelgen -p nbdb -o internal/network/ovn/nbdb ovn-nb.ovsschema
```

### 2.3 Security Group → ACL Translation

**File:** `backend/internal/network/ovn/acl_translator.go`

**Translation Rules:**

| Security Group Field | OVN ACL Field |
|---------------------|---------------|
| `direction=INGRESS` | `direction=to-lport` |
| `direction=EGRESS` | `direction=from-lport` |
| `protocol=tcp` | `match: tcp` |
| `port_min=80` | `match: tcp.dst == 80` |
| `remote_ip_prefix=10.0.0.0/8` | `match: ip4.src == 10.0.0.0/8` |
| `action=ALLOW` | `action=allow-related` (stateful) |
| `action=DROP` | `action=drop` |

**Priority Scheme:**
| Priority | Purpose |
|----------|---------|
| 32767 | Allow established/related (stateful) |
| 2000-2999 | Admin override rules |
| 1000-1999 | User security group rules |
| 100 | Default egress allow |
| 0 | Default deny (implicit) |

---

## Phase 3: Node Daemon Networking

### Goal
Implement OVN chassis registration and VM port binding on hypervisor nodes.

### 3.1 Chassis Manager

**File:** `agent/limiquantix-node/src/chassis.rs`

**Responsibilities:**
- Register node as OVN chassis on startup
- Configure encapsulation (Geneve) settings
- Set up bridge mappings for external networks
- Health check OVN controller connectivity

**Key Functions:**
```rust
impl ChassisManager {
    pub fn initialize(&self) -> Result<()>;
    pub fn add_bridge_mapping(&mut self, physical_network: &str, bridge: &str) -> Result<()>;
    pub fn health_check(&self) -> Result<ChassisHealth>;
}
```

### 3.2 Enhanced OVS Port Manager

**File:** `agent/limiquantix-hypervisor/src/network/ovs.rs`

**New Features:**
- Port status verification after VM start
- TAP interface detection by MAC address
- QoS configuration (ingress/egress rate limiting)
- Port statistics collection (rx/tx bytes/packets)

### 3.3 VM Network Integration

**File:** `agent/limiquantix-hypervisor/src/vm/network.rs`

**Flow:**
1. VM Create: Generate port XML with OVN interface-id
2. VM Start: Verify OVN port binding within timeout
3. VM Stop: Report port status as DOWN
4. VM Delete: Cleanup OVS interface metadata

---

## Phase 4: Frontend Network Topology

### Goal
Create an interactive network topology visualization using ReactFlow.

### 4.1 Network Topology Component

**File:** `frontend/src/components/network/NetworkTopology.tsx`

**Features:**
- Hierarchical layout (external → routers → networks → VMs)
- Custom node types with status indicators
- Edge animations for active connections
- MiniMap for large topologies
- Click to select and view details

**Dependencies:**
```json
{
  "reactflow": "^11.10.0"
}
```

### 4.2 Custom Node Components

**Files:**
- `frontend/src/components/network/nodes/ExternalNetworkNode.tsx`
- `frontend/src/components/network/nodes/RouterNode.tsx`
- `frontend/src/components/network/nodes/SwitchNode.tsx`
- `frontend/src/components/network/nodes/VMNode.tsx`
- `frontend/src/components/network/nodes/LoadBalancerNode.tsx`

### 4.3 Network Topology Page

**File:** `frontend/src/pages/NetworkTopology.tsx`

**Layout:**
```
┌────────────┬─────────────────────────────────────┐
│ Filters    │  [Topology Canvas]                  │
│ - Project  │                                     │
│ - Type     │                                     │
│ - Search   │                                     │
├────────────┤                                     │
│ Details    │                                     │
│ (Selected) │                                     │
│ - Subnet   │                                     │
│ - Ports    │                                     │
│ - VMs      │                                     │
└────────────┴─────────────────────────────────────┘
```

---

## Phase 5: Security Group Editor

### Goal
Create an intuitive security group rule editor with quick-add presets.

### 5.1 Security Group Editor Component

**File:** `frontend/src/components/network/SecurityGroupEditor.tsx`

**Quick-Add Presets:**
| Preset | Ports |
|--------|-------|
| Allow Web (HTTP/HTTPS) | 80, 443 |
| Allow SSH | 22 |
| Allow RDP | 3389 |
| Allow Database | 3306, 5432, 27017 |
| Allow ICMP/Ping | ICMP all |
| Allow Internal | 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 |

### 5.2 Rule Row Component

**File:** `frontend/src/components/network/SecurityRuleRow.tsx`

**Features:**
- Inline editing for quick changes
- Direction badge (ingress/egress)
- Protocol/port display
- Source/destination CIDR
- Drag-and-drop reordering

---

## Phase 6: Real-time Port Status

### Goal
Implement streaming updates for network port status using Connect-RPC server streaming.

### 6.1 Backend Streaming Endpoint

**File:** `backend/internal/services/network/port_streaming.go`

**Implementation:**
- Server-sent events via Connect-RPC streaming
- Subscribe to port status changes
- Debounce rapid updates
- Automatic cleanup on disconnect

### 6.2 Frontend Hook

**File:** `frontend/src/hooks/useNetworkStreaming.ts`

**Features:**
- `usePortStatusStream(networkId)` - Real-time port status
- `useNetworkEvents(projectId)` - Network creation/deletion events
- Auto-reconnect on connection loss

---

## Phase 7: DHCP & DNS Integration

### Goal
Configure OVN native DHCP and implement Magic DNS with CoreDNS.

### 7.1 OVN DHCP Manager

**File:** `backend/internal/network/dhcp/ovn_dhcp.go`

**Features:**
- Create DHCP options per network
- Inject DNS servers, NTP, domain name
- Support for DHCP static bindings

### 7.2 CoreDNS Plugin

**File:** `backend/internal/network/dns/coredns_plugin.go`

**Magic DNS Format:**
```
<vm-name>.internal → <vm-ip>
<vm-name>.<project-name>.internal → <vm-ip>
```

### 7.3 DNS Sync Service

**File:** `backend/internal/network/dns/sync_service.go`

**Triggers:**
- VM created → Add DNS record
- VM deleted → Remove DNS record
- Port IP changed → Update DNS record

---

## Phase 8: Advanced Features

### 8.1 Floating IP Implementation

**File:** `backend/internal/services/network/floating_ip_ops.go`

**Operations:**
- Allocate from external network pool
- Associate with VM port (creates DNAT+SNAT in OVN)
- Disassociate (removes NAT rules)
- Release back to pool

### 8.2 Load Balancer Implementation

**File:** `backend/internal/services/network/load_balancer_ops.go`

**Features:**
- Create OVN load balancer with VIP
- Add/remove backend members
- Health checks (via OVN northd)
- Statistics collection

### 8.3 Live Migration Port Handling

**File:** `agent/limiquantix-node/src/migration.rs`

**Sequence:**
1. Source node: Notify control plane of migration start
2. Control plane: Pre-configure port on destination
3. Migration completes: Update OVN port binding to new chassis
4. Source node: Cleanup old port metadata

---

## Implementation Order & Dependencies

```
Phase 1: IPAM Foundation
    │
    ├── Phase 2: Real OVN Integration
    │       │
    │       └── Phase 3: Node Daemon Networking
    │               │
    │               └── Phase 8.3: Live Migration
    │
    ├── Phase 5: Security Group Editor
    │       │
    │       └── Phase 2: ACL Translation
    │
    ├── Phase 4: Network Topology UI
    │       │
    │       └── Phase 6: Real-time Port Status
    │
    └── Phase 7: DHCP & DNS
            │
            └── Phase 8.1-8.2: Floating IP & Load Balancer
```

---

## File Deliverables Summary

### Backend (Go)

| File | Phase | Description |
|------|-------|-------------|
| `migrations/000008_ipam.up.sql` | 1 | IPAM database schema |
| `internal/services/network/ipam_service.go` | 1 | IP address management |
| `internal/services/network/ipam_repository.go` | 1 | IPAM PostgreSQL repository |
| `internal/network/ovn/libovsdb_client.go` | 2 | Real OVN connection |
| `internal/network/ovn/acl_translator.go` | 2 | Security group → ACL |
| `internal/network/dhcp/ovn_dhcp.go` | 7 | DHCP configuration |
| `internal/network/dns/sync_service.go` | 7 | DNS record sync |
| `internal/services/network/port_streaming.go` | 6 | Real-time port updates |

### Node Daemon (Rust)

| File | Phase | Description |
|------|-------|-------------|
| `limiquantix-node/src/chassis.rs` | 3 | OVN chassis management |
| `limiquantix-hypervisor/src/network/ovs.rs` | 3 | Enhanced OVS port manager |
| `limiquantix-node/src/migration.rs` | 8 | Migration port handling |

### Frontend (React)

| File | Phase | Description |
|------|-------|-------------|
| `components/network/NetworkTopology.tsx` | 4 | Topology visualization |
| `components/network/nodes/*.tsx` | 4 | Custom ReactFlow nodes |
| `pages/NetworkTopology.tsx` | 4 | Topology page |
| `components/network/SecurityGroupEditor.tsx` | 5 | Rule editor |
| `components/network/SecurityRuleRow.tsx` | 5 | Rule row component |
| `hooks/useNetworkStreaming.ts` | 6 | Real-time hooks |

---

## Success Criteria

### Phase 1 Complete When:
- [ ] IP allocation/release works correctly
- [ ] Gateway and broadcast IPs are reserved
- [ ] Pool statistics are accurate
- [ ] Unit tests pass

### Phase 2 Complete When:
- [ ] OVN connection established in dev environment
- [ ] Network creation creates OVN logical switch
- [ ] Port creation creates OVN logical switch port
- [ ] Security group creates OVN ACLs

### Phase 3 Complete When:
- [ ] Node registers as OVN chassis
- [ ] VM start binds port to OVN
- [ ] Port status reported correctly
- [ ] VM stop marks port as DOWN

### Phase 4 Complete When:
- [ ] Topology displays networks, routers, VMs
- [ ] Click on node shows details
- [ ] Real-time updates work
- [ ] Performance good with 100+ nodes

### Phase 5 Complete When:
- [ ] Quick-add presets work
- [ ] Custom rule creation works
- [ ] Rule editing works
- [ ] Rules sync to OVN ACLs

---

## Testing Strategy

### Unit Tests
- IPAM allocation edge cases (exhaustion, duplicates)
- ACL translation correctness
- MAC address generation uniqueness

### Integration Tests
- Network → OVN logical switch lifecycle
- Port → OVN port binding lifecycle
- Security group → ACL sync

### E2E Tests
- Create network → create VM → verify connectivity
- Apply security group → verify traffic blocked/allowed
- Floating IP → verify external access

---

## References

- [ADR-009: QuantumNet Architecture](../adr/000009-quantumnet-architecture.md)
- [OVN Architecture](https://docs.ovn.org/en/latest/ref/ovn-architecture.7.html)
- [libovsdb Documentation](https://github.com/ovn-org/libovsdb)
- [ReactFlow Documentation](https://reactflow.dev/)
