# limiquantix Virtualization Platform
## "The VMware Killer"

**Vision:** Build a complete, modern replacement for VMware vSphere that includes the hypervisor host OS, control plane, guest agent, storage, and networking.

---

## 1. Executive Summary

limiquantix is a **distributed, cloud-native virtualization platform** designed to replace VMware vSphere. The system prioritizes:

- **Simplicity**: 5-minute cluster setup (vs. days for VMware)
- **Performance**: <1% platform overhead
- **Modern UX**: Consumer-grade dashboard (Vercel/Linear aesthetics)
- **API-First**: Every feature is an API call first

This fills the market gap created by Broadcom's VMware acquisition, targeting enterprises seeking:
- Lower cost than Nutanix
- Less complexity than OpenStack
- More features than Proxmox

---

## 2. Platform Components

### Complete VMware Replacement Map

| VMware Component | limiquantix Equivalent | Status |
|------------------|------------------------|--------|
| **vSphere Web Client** | React Dashboard | ✅ 95% |
| **vCenter Server** | Go Control Plane | ✅ 85% |
| **ESXi Host Agent** | Rust Node Daemon | ✅ 80% |
| **VMware Tools** | Rust Guest Agent | ❌ 0% |
| **vSAN / VMFS** | Ceph / LINSTOR | ❌ 0% |
| **NSX-T / vDS** | OVN / OVS | ❌ 0% |
| **ESXi OS** | limiquantix OS | ❌ 0% |
| **vMotion** | Live Migration | ⏳ 50% |
| **HA / DRS** | HA Manager / DRS Engine | ✅ Done |

---

## 3. Current Implementation Status

### ✅ Phase 1: Control Plane Foundation (COMPLETE)

| Component | Status | Description |
|-----------|--------|-------------|
| Frontend (React) | ✅ 95% | 15 pages, full CRUD, real-time metrics |
| Backend (Go) | ✅ 85% | All services, scheduler, HA, DRS |
| Proto/API | ✅ 100% | Compute, Storage, Network domains |
| Node Daemon (Rust) | ✅ 80% | gRPC server, registration, heartbeat |
| Hypervisor Abstraction | ✅ 100% | Mock + Libvirt backends |
| Frontend ↔ Backend | ✅ 100% | API integration complete |
| Backend ↔ Node Daemon | ✅ 90% | VMService wired, heartbeat working |

### ⏳ Phase 2: Real Hypervisor (IN PROGRESS)

| Component | Status | Next Step |
|-----------|--------|-----------|
| Libvirt Backend | ⏳ Structure | Test on Linux host |
| VM Creation (real) | ⏳ Code ready | Test with qemu-img |
| Console Access | ⏳ API ready | Test VNC/SPICE proxy |
| Snapshots | ⏳ API ready | Test with libvirt |

### ❌ Phase 3-5: Remaining Work

| Component | Effort | Priority |
|-----------|--------|----------|
| Guest Agent | 4-6 weeks | P0 |
| Storage Backend | 4-6 weeks | P0 |
| Network Backend | 4-6 weeks | P0 |
| limiquantix OS | 8-12 weeks | P1 |

---

## 4. Technical Architecture

### 4.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              User Access Layer                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    limiquantix Dashboard (React)                        │ │
│  │                       http://localhost:5174                             │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                              HTTP / Connect-RPC
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Control Plane (Go)                                 │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  VMService   │  │ NodeService  │  │  Scheduler   │  │  HA Manager  │    │
│  │              │  │              │  │  (spread/    │  │  (failover)  │    │
│  │  CRUD +      │  │  Register +  │  │   pack)      │  │              │    │
│  │  Lifecycle   │  │  Heartbeat   │  │              │  │              │    │
│  └──────┬───────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│         │                                                                    │
│  ┌──────┴─────────────────────────────────────────────────────────────────┐ │
│  │                     DaemonPool (Node Daemon Clients)                    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   etcd       │  │  PostgreSQL  │  │    Redis     │  │   Metrics    │    │
│  │  (cluster)   │  │   (state)    │  │   (cache)    │  │  (Prometheus)│    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                               gRPC (port 9090)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Node Daemon (Rust)                                   │
│                       One per hypervisor host                                │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                       NodeDaemonService (gRPC)                          │ │
│  │  CreateVM │ StartVM │ StopVM │ Snapshots │ Migration │ Metrics         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                      │                                       │
│  ┌────────────────────────┐  ┌───────┴───────┐  ┌────────────────────────┐ │
│  │   Telemetry Collector  │  │   Hypervisor  │  │  Registration Client   │ │
│  │   CPU/Memory/Disk/Net  │  │  Abstraction  │  │  Register + Heartbeat  │ │
│  └────────────────────────┘  └───────┬───────┘  └────────────────────────┘ │
│                                      │                                       │
│                    ┌─────────────────┼─────────────────┐                    │
│                    ▼                 ▼                 ▼                    │
│            ┌─────────────┐   ┌─────────────┐   ┌─────────────┐             │
│            │    Mock     │   │   Libvirt   │   │   Cloud     │             │
│            │   Backend   │   │   Backend   │   │ Hypervisor  │             │
│            │    ✅ Done   │   │  ⏳ Ready   │   │   ❌ Future  │             │
│            └─────────────┘   └──────┬──────┘   └─────────────┘             │
│                                     │                                        │
└─────────────────────────────────────┼────────────────────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Linux Kernel (KVM)                                │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         QEMU / KVM Hypervisor                         │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │     VM 1     │  │     VM 2     │  │     VM 3     │  │     VM N     │    │
│  │  ┌────────┐  │  │  ┌────────┐  │  │  ┌────────┐  │  │  ┌────────┐  │    │
│  │  │ Guest  │  │  │  │ Guest  │  │  │  │ Guest  │  │  │  │ Guest  │  │    │
│  │  │ Agent  │  │  │  │ Agent  │  │  │  │ Agent  │  │  │  │ Agent  │  │    │
│  │  │ (Rust) │  │  │  │ (Rust) │  │  │  │ (Rust) │  │  │  │ (Rust) │  │    │
│  │  └────────┘  │  │  └────────┘  │  │  └────────┘  │  │  └────────┘  │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        Ceph / LINSTOR Storage                         │   │
│  │                              (Shared)                                 │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                          OVN / OVS Networking                         │   │
│  │                              (SDN)                                    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Data Flow

**VM Creation Flow:**
```
1. User clicks "Create VM" in Dashboard
2. Frontend sends CreateVMRequest via Connect-RPC
3. VMService validates and persists VM
4. Scheduler selects best node (spread/pack strategy)
5. VMService calls Node Daemon via gRPC
6. Node Daemon creates VM via libvirt
7. VM boots, Guest Agent installs
8. Status updates flow back to Dashboard
```

**Node Registration Flow:**
```
1. Node Daemon starts on hypervisor host
2. Collects telemetry (CPU, memory, disks, network)
3. Detects management IP
4. Registers with Control Plane (POST /RegisterNode)
5. Receives server-assigned node ID
6. Starts heartbeat loop (every 30s)
7. Appears in Dashboard as "READY"
```

---

## 5. Implementation Roadmap

### Phase 1: Foundation ✅ COMPLETE
*Duration: 4 weeks (Done)*

- ✅ React Dashboard (15 pages)
- ✅ Go Control Plane (all services)
- ✅ Proto/API definitions
- ✅ Node Daemon (gRPC server)
- ✅ Mock hypervisor
- ✅ Node registration + heartbeat
- ✅ VMService → Node Daemon wiring

### Phase 2: Real Hypervisor ⏳ IN PROGRESS
*Duration: 2-3 weeks*

| Task | Status | Description |
|------|--------|-------------|
| Linux test environment | 📋 | Set up Linux VM/bare metal with KVM/libvirt |
| Libvirt backend testing | 📋 | Test VM lifecycle with real VMs |
| Disk image creation | 📋 | Integrate qemu-img for QCOW2 creation |
| Console proxy | 📋 | VNC/SPICE WebSocket proxy |
| Snapshot testing | 📋 | Test libvirt snapshots |

### Phase 3: Guest Agent 📋 PLANNED
*Duration: 4-6 weeks*

| Task | Description |
|------|-------------|
| Virtio-serial transport | Communication channel (no network) |
| Agent binary | Rust binary for Linux/Windows guests |
| Telemetry | Real memory/disk usage from inside guest |
| Command execution | Run commands inside VM |
| File operations | Upload/download files |
| Password reset | Reset admin password |
| Graceful shutdown | Coordinate with host |

### Phase 4: Storage Backend 📋 PLANNED
*Duration: 4-6 weeks*

| Task | Description |
|------|-------------|
| LVM integration | Local storage (simpler start) |
| qemu-img wrapper | Disk image creation/conversion |
| Ceph RBD client | Distributed block storage |
| Volume provisioning | Create/delete/resize volumes |
| Snapshot storage | Snapshot disk images |
| Migration support | Shared storage for vMotion |

### Phase 5: Network Backend 📋 PLANNED
*Duration: 4-6 weeks*

| Task | Description |
|------|-------------|
| Linux bridge | Simple networking (start here) |
| OVS integration | Open vSwitch for advanced features |
| OVN integration | Distributed networking |
| Security groups | Firewall rule enforcement |
| DHCP server | IP assignment for VMs |
| VPN/NAT | External connectivity |

### Phase 6: Host OS 📋 PLANNED
*Duration: 8-12 weeks*

| Task | Description |
|------|-------------|
| Base image | Minimal Linux (Alpine/buildroot) |
| Auto-configuration | DHCP, hostname, management network |
| Node Daemon integration | Auto-start, auto-register |
| ISO builder | Generate installable ISO |
| PXE boot | Network boot for bare metal |
| TPM/Secure Boot | Security features |

### Phase 7: Enterprise Features 📋 PLANNED
*Duration: 6-8 weeks*

| Task | Description |
|------|-------------|
| Live migration | vMotion equivalent (structure ready) |
| HA testing | Automatic failover |
| DRS testing | Resource balancing |
| Backup engine | VADP equivalent |
| Templates | VM templates and cloning |
| Resource pools | Nested resource allocation |

---

## 6. Priority Matrix

### P0: Critical Path (Must Have)
| Component | Effort | Blocks |
|-----------|--------|--------|
| Real hypervisor testing | 1-2 weeks | Everything |
| Storage (at least LVM) | 2-3 weeks | VM creation |
| Networking (at least bridge) | 2-3 weeks | VM connectivity |
| Guest Agent (basic) | 3-4 weeks | Real VM usage |

### P1: Important (Should Have)
| Component | Effort |
|-----------|--------|
| Live migration | 2 weeks |
| Ceph integration | 3-4 weeks |
| OVN integration | 3-4 weeks |
| Host OS | 8-12 weeks |

### P2: Nice to Have
| Component | Effort |
|-----------|--------|
| Cloud Hypervisor | 4 weeks |
| Backup engine | 4 weeks |
| Multi-tenancy | 3 weeks |

---

## 7. Quick Start

### Run the Full Stack

```bash
# Terminal 1: Control Plane (Go)
cd backend
go run ./cmd/controlplane --dev

# Terminal 2: Node Daemon (Rust)
cd agent
cargo run --bin limiquantix-node -- \
  --dev \
  --listen 127.0.0.1:9090 \
  --control-plane http://127.0.0.1:8080 \
  --register

# Terminal 3: Frontend (React)
cd frontend
npm run dev

# Access Dashboard: http://localhost:5174
```

### Verify Integration

```bash
# Check registered nodes
curl -s -X POST http://127.0.0.1:8080/limiquantix.compute.v1.NodeService/ListNodes \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.nodes[] | {hostname, id, phase: .status.phase}'

# Check health
curl http://127.0.0.1:8080/health
```

---

## 8. Team & Resources

### Recommended Team (Phase 2+)

| Role | Count | Focus |
|------|-------|-------|
| **Lead Architect** | 1 | Architecture, API design |
| **Systems Engineers (Rust)** | 2 | Hypervisor, Guest Agent, Storage |
| **Backend Engineers (Go)** | 2 | Control Plane, Clustering |
| **Frontend Engineer** | 1 | Dashboard, UX |
| **DevOps Engineer** | 1 | CI/CD, Testing, Host OS |

### Infrastructure Needed

| Resource | Purpose |
|----------|---------|
| Linux server with KVM | Real hypervisor testing |
| Ceph cluster (3+ nodes) | Storage testing |
| Network lab | OVN/OVS testing |
| CI runners (bare metal) | Integration tests |

---

## 9. Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Time to HA Cluster | < 10 minutes | N/A (no cluster yet) |
| Platform Overhead | < 1% | N/A (mock only) |
| API Response Time | < 100ms | ✅ ~1ms |
| Dashboard FPS | 60fps | ✅ 60fps |
| VM Boot Time | < 30 seconds | N/A |
| Live Migration Time | < 10 seconds | N/A |

---

## 10. Next Milestone

**Goal:** Boot a REAL VM via the full stack

**Steps:**
1. Set up Linux hypervisor host with KVM/libvirt
2. Deploy Node Daemon with `--features libvirt`
3. Test VM creation via Dashboard
4. Verify VNC console access
5. Test start/stop/reboot operations

**Estimated Time:** 1-2 weeks

---

## 11. Documentation

| Document | Path | Description |
|----------|------|-------------|
| VM Model Design | `docs/adr/000001-vm-model-design.md` | VM domain model |
| Node Model Design | `docs/adr/000002-node-model-design.md` | Node domain model |
| Storage Model Design | `docs/adr/000003-storage-model-design.md` | Storage domain |
| Network Model Design | `docs/adr/000004-network-model-design.md` | Network domain |
| gRPC Services | `docs/adr/000005-grpc-services-design.md` | API design |
| Build System | `docs/adr/000006-proto-and-build-system-guide.md` | Proto generation |
| Hypervisor Integration | `docs/adr/000007-hypervisor-integration.md` | Backend decision |
| Node Daemon Plan | `docs/000031-node-daemon-implementation-plan.md` | 6-week roadmap |
| VMService Integration | `docs/000032-vmservice-node-daemon-integration.md` | Service wiring |
| Registration Flow | `docs/000033-node-registration-flow.md` | Node registration |

---

## 12. Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete |
| ⏳ | In Progress |
| 📋 | Planned |
| ❌ | Not Started / Blocked |
| P0 | Critical priority |
| P1 | High priority |
| P2 | Medium priority |
