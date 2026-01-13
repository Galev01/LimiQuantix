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
| **vSphere Web Client** | React Dashboard | ✅ 99% |
| **vCenter Server** | Go Control Plane | ✅ 92% |
| **ESXi Host Agent** | Rust Node Daemon | ✅ 90% |
| **VMware Tools** | Rust Guest Agent | ✅ 85% |
| **vSAN / VMFS** | Ceph / LINSTOR | ✅ 80% |
| **NSX-T / vDS** | OVN / OVS (QuantumNet) | ⏳ 85% |
| **ESXi OS** | limiquantix OS | ❌ 0% |
| **vMotion** | Live Migration | ⏳ 50% |
| **HA / DRS** | HA Manager / DRS Engine | ✅ Done |

---

## 3. Current Implementation Status

### ✅ Phase 1: Control Plane Foundation (COMPLETE)

| Component | Status | Description |
|-----------|--------|-------------|
| Frontend (React) | ✅ 99% | 16 pages, Image Library, ISO upload, password/SSH auth, VM actions |
| Backend (Go) | ✅ 92% | All services, scheduler, HA, DRS, storage backends |
| Proto/API | ✅ 100% | Compute, Storage, Network + Cloud-Init + Guest Agent |
| Node Daemon (Rust) | ✅ 90% | gRPC, cloud-init ISO, backing files, real VM creation |
| Guest Agent (Rust) | ✅ 85% | Linux/Windows, telemetry, script execution, file browser |
| Hypervisor Abstraction | ✅ 100% | Mock + Libvirt + Cloud Image backends |
| Storage Backends | ✅ 80% | Local, NFS, Ceph RBD, iSCSI with LVM thin provisioning |
| Frontend ↔ Backend | ✅ 100% | API integration complete, cloud-init support |
| Backend ↔ Node Daemon | ✅ 98% | Full VM lifecycle, cloud-init provisioning |

### ✅ Phase 2: Real Hypervisor (MOSTLY COMPLETE)

| Component | Status | Notes |
|-----------|--------|-------|
| Linux test environment | ✅ Done | Ubuntu laptop with KVM/libvirt |
| Node Daemon on Linux | ✅ Done | Builds and runs with --features libvirt |
| Node Registration | ✅ Done | Real hardware info sent to control plane |
| Libvirt Backend | ✅ Done | VM creation, domain XML, lifecycle |
| Cloud-Init ISO | ✅ Done | NoCloud datasource with genisoimage |
| Cloud Image Support | ✅ Done | QCOW2 backing file overlays |
| VM Creation (real) | ✅ Done | Full stack: UI → Backend → Node Daemon → Libvirt |
| SSH Key Injection | ✅ Done | Via cloud-init user-data |
| Console Access | ✅ 100% | Web Console (noVNC) + qvmc Native Client |
| Snapshots | ⏳ API ready | Test with libvirt |

### ✅ Phase 3: Guest Agent (COMPLETE)

| Component | Status | Description |
|-----------|--------|-------------|
| Guest Agent Binary | ✅ Done | Rust binary for Linux/Windows |
| Virtio-serial Transport | ✅ Done | Communication channel (no network) |
| Telemetry | ✅ Done | Real memory/disk/CPU usage from inside guest |
| Command Execution | ✅ Done | Run scripts inside VM with user context |
| File Operations | ✅ Done | File browser, upload/download |
| Graceful Shutdown | ✅ Done | Coordinate with host |
| Filesystem Quiescing | ✅ Done | fsfreeze (Linux) / VSS (Windows) |
| Network Configuration | ✅ Done | Netplan, NetworkManager, netsh |
| Cloud-Init Integration | ✅ Done | Auto-install agent during VM creation |

### ✅ Phase 4: Storage Backend (MOSTLY COMPLETE)

| Component | Status | Description |
|-----------|--------|-------------|
| Local Backend | ✅ Done | qemu-img for local directories |
| NFS Backend | ✅ Done | mount + qemu-img for NFS shares |
| Ceph RBD Backend | ✅ Done | rbd CLI for Ceph distributed storage |
| iSCSI Backend | ✅ Done | iscsiadm + LVM thin provisioning |
| Volume Provisioning | ✅ Done | Create/delete/resize volumes |
| Snapshot Storage | ✅ Done | Snapshot disk images |
| Clone (CoW) | ✅ Done | Copy-on-write cloning |
| Frontend Storage UI | ✅ Done | Storage pools + volumes pages |

### ❌ Phase 5: Remaining Work

| Component | Effort | Priority |
|-----------|--------|----------|
| **QuantumNet (OVN/OVS)** | 4-6 weeks | **P0** - In Progress |
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

### Phase 2: Real Hypervisor ✅ MOSTLY COMPLETE
*Duration: 2-3 weeks (Done)*

| Task | Status | Description |
|------|--------|-------------|
| Linux test environment | ✅ Done | Ubuntu laptop with KVM/libvirt |
| Libvirt backend | ✅ Done | VM creation, domain XML, lifecycle |
| Cloud-Init support | ✅ Done | NoCloud ISO generation, auto-provisioning |
| Cloud image support | ✅ Done | QCOW2 backing file overlays |
| Disk image creation | ✅ Done | qemu-img for QCOW2 creation |
| SSH key injection | ✅ Done | Via cloud-init user-data |
| Frontend cloud-init UI | ✅ Done | Image selector, SSH keys, custom config |
| Console proxy | ⏳ 50% | VNC info available, WebSocket proxy pending |
| Snapshot testing | ⏳ API ready | Test with libvirt |

### Phase 3: Guest Agent ✅ COMPLETE
*Duration: 4-6 weeks (Done)*

| Task | Status | Description |
|------|--------|-------------|
| Virtio-serial transport | ✅ Done | Communication channel (no network) |
| Agent binary | ✅ Done | Rust binary for Linux/Windows guests |
| Telemetry | ✅ Done | Real memory/disk usage from inside guest |
| Command execution | ✅ Done | Run scripts inside VM with user context |
| File operations | ✅ Done | File browser, upload/download files |
| Graceful shutdown | ✅ Done | Coordinate with host |
| Filesystem quiescing | ✅ Done | fsfreeze (Linux) / VSS (Windows) |
| Cloud-init integration | ✅ Done | Auto-install agent during VM creation |
| Windows support | ✅ Done | MSI installer, VSS, netsh |
| Frontend integration | ✅ Done | Agent status, script execution, file browser |

### Phase 4: Storage Backend ✅ MOSTLY COMPLETE
*Duration: 4-6 weeks (Done)*

| Task | Status | Description |
|------|--------|-------------|
| Local backend | ✅ Done | qemu-img for local directories |
| NFS backend | ✅ Done | mount + qemu-img for NFS shares |
| Ceph RBD client | ✅ Done | rbd CLI for distributed block storage |
| iSCSI backend | ✅ Done | iscsiadm + LVM thin provisioning |
| Volume provisioning | ✅ Done | Create/delete/resize volumes |
| Snapshot storage | ✅ Done | Snapshot disk images |
| Clone (CoW) | ✅ Done | Copy-on-write cloning |
| Frontend storage UI | ✅ Done | Storage pools + volumes pages |

### Phase 5: Network Backend (QuantumNet) 🚧 IN PROGRESS
*Duration: 4-6 weeks*

**Architecture:** OVN (Open Virtual Network) + OVS (Open vSwitch) - The "vDS" for the Modern Era

| Task | Status | Description |
|------|--------|-------------|
| **OVN Northbound Client (Go)** | ✅ Done | Connect to OVN NB DB via libovsdb (mock + real ready) |
| **Network Service** | ✅ Done | CreateNetwork, CreatePort, VLAN/Overlay support |
| **OVS Port Manager (Rust)** | ✅ Done | Connect VM TAP interfaces to br-int |
| **Libvirt OVS Integration** | ✅ Done | Generate OVS virtualport XML for VMs |
| **Node Daemon RPC Handlers** | ✅ Done | Network port config/status/delete/list |
| **Security Groups (ACLs)** | ✅ Done | Distributed firewall via OVN ACLs |
| **DHCP/DNS** | ✅ Done | Built-in OVN DHCP + CoreDNS Magic DNS |
| **Floating IPs** | ✅ Done | 1:1 NAT via OVN logical routers |
| **OVN Setup Documentation** | ✅ Done | Central + node setup guide |
| **Load Balancing** | ✅ Done | L4 load balancing via OVN LB |
| **WireGuard Bastion** | ✅ Done | Direct overlay access from laptops |
| **BGP ToR Integration** | ✅ Done | Enterprise bare-metal integration |
| **Integration Testing** | 📋 | Test with real OVS/OVN deployment |

#### Network Types

| Type | VMware Equivalent | Implementation |
|------|-------------------|----------------|
| **VLAN/Flat** | Port Groups | OVN Logical Switch + VLAN tag + localnet port |
| **Overlay/VPC** | NSX Segments | OVN Logical Switch + Geneve encapsulation |
| **External** | Uplink Port Group | Provider network with SNAT |
| **Isolated** | Private Network | No router attachment |

#### Day 2 Features (Strategic Improvements)

| Feature | VMware Way | limiquantix Way (Better) |
|---------|------------|--------------------------|
| **Microsegmentation** | IP-based firewall rules | Tag-based: "Allow Web-Servers → DB-Servers" |
| **Floating IPs** | Manual NAT rules | One-click public IP assignment |
| **VPN Access** | NSX Edge (complex) | Built-in WireGuard Bastion |
| **ToR Integration** | Manual VLAN config | BGP auto-advertisement |
| **Magic DNS** | External DNS | `<vm-name>.internal` auto-resolves |

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

### Phase 8: Platform Hardening 📋 PLANNED
*Duration: 4-6 weeks*

Code foundation exists (prepared for future features):

| Task | Status | Description |
|------|--------|-------------|
| **TLS/ACME Certificates** | 🔧 Code Ready | Let's Encrypt integration for HTTPS |
| **Enhanced Event Logging** | 🔧 Code Ready | Helper methods for VM/Network/Storage events |
| **Admin Authentication (TUI)** | 🔧 Code Ready | Login screen for console access |
| **Settings Expansion** | 🔧 Code Ready | Storage defaults, network defaults, VNC settings |
| **Disk Format Conversion** | 🔧 Code Ready | VMDK to QCOW2 job tracking |
| **Alternative Cluster Join** | 🔧 Code Ready | Token-based cluster registration flow |
| **OVS Port Management** | 🔧 Code Ready | SDN port config/status/delete/list |

**Legend:** 🔧 = Code structure exists, needs wiring/testing

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
| Platform Overhead | < 1% | N/A (testing on Ubuntu laptop) |
| API Response Time | < 100ms | ✅ ~1ms |
| Dashboard FPS | 60fps | ✅ 60fps |
| Node Registration | < 1 second | ✅ ~100ms |
| Heartbeat Interval | 30 seconds | ✅ Working |
| VM Boot Time | < 30 seconds | ⏳ Ready to test |
| Cloud-Init Provisioning | < 2 minutes | ⏳ Ready to test |
| Live Migration Time | < 10 seconds | N/A |

---

## 10. Next Milestone

**Goal:** ~~Boot a REAL VM via the full stack~~ ✅ ACHIEVED!

**Completed:**
- ✅ Set up Linux hypervisor host with KVM/libvirt (Ubuntu laptop)
- ✅ Deploy Node Daemon with `--features libvirt`
- ✅ Node registers and appears in Dashboard with real hardware info
- ✅ VM creation via Dashboard → Backend → Node Daemon → Libvirt
- ✅ Implemented Node Daemon CreateVM with libvirt domain XML
- ✅ Cloud-init ISO generation (NoCloud datasource)
- ✅ Cloud image support (QCOW2 backing file overlays)
- ✅ SSH key injection via cloud-init
- ✅ Frontend cloud-init UI (image selector, SSH keys, custom config)

**Next Goal:** QuantumNet - Distributed Networking (OVN/OVS integration)

**Completed (January 3, 2026):**
1. ✅ Web Console (noVNC) - Browser-based VNC access
2. ✅ WebSocket VNC Proxy - Control Plane proxies browser → VNC
3. ✅ qvmc Tauri app with full VNC protocol + deep linking
4. ✅ Guest Agent - Full Linux/Windows support with telemetry, scripts, file browser
5. ✅ Storage Backends - Local, NFS, Ceph RBD, iSCSI with LVM thin provisioning
6. ✅ VM Actions Dropdown - Edit settings, resources, run scripts, clone, delete
7. ✅ Cloud-init agent auto-install - Agent installed during VM creation
8. ✅ Image Library - Manage cloud images and ISOs with upload dialog
9. ✅ ISO Upload - Upload ISOs via URL or file with progress tracking
10. ✅ Password/SSH Access - Improved access config with password + SSH keys + validation
11. ✅ OVN Northbound Client (Go) - libovsdb integration with mock
12. ✅ NetworkService with OVN backend - CreateNetwork/CreatePort
13. ✅ Rust OVS Port Manager - VM TAP → br-int binding
14. ✅ Libvirt OVS XML - VirtualPort integration
15. ✅ Node Daemon Network RPC Handlers - ConfigureNetworkPort/GetOVSStatus
16. ✅ Security Groups (OVN ACLs) - SecurityGroupService with ACL translation
17. ✅ DHCP Configuration - OVN built-in DHCP with documentation
18. ✅ CoreDNS Integration - Magic DNS documentation
19. ✅ Floating IPs Service - NAT implementation with OVN
20. ✅ OVN Central Setup Guide - Complete deployment documentation

**Frontend VM Detail Improvements:**
- ✅ VM Actions Dropdown Menu (Edit Settings, Edit Resources, Run Script, Browse Files, Clone, Delete)
- ✅ Edit Settings Modal (name, description, labels)
- ✅ Edit Resources Modal (CPU cores, memory with presets)
- ✅ Quantix Agent tab with status, script execution, file browser

**QuantumNet Documentation:**
- ✅ `docs/adr/000009-quantumnet-architecture.md` - Architecture design
- ✅ `docs/000050-ovn-central-setup-guide.md` - OVN deployment guide
- ✅ `docs/000051-dhcp-dns-configuration.md` - DHCP and DNS setup

**Immediate Next Steps:**
1. 📋 Integration testing with real OVS/OVN deployment
2. 📋 L4 Load Balancer via OVN LB
3. 📋 WireGuard Bastion for direct overlay access
4. 📋 BGP ToR Integration for enterprise

**Estimated Time:** Remaining QuantumNet features ~2-3 weeks

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
| Real VM Implementation | `docs/000038-real-vm-implementation.md` | Libvirt VM creation |
| Cloud-Init Provisioning | `docs/000039-cloud-init-provisioning.md` | Cloud-init + cloud images |

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




## SCIM Operations - google workspaces/Okta/LDAP