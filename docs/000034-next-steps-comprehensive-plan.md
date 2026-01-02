# 000034 - Next Steps: Comprehensive Implementation Plan

**Document ID:** 000034  
**Category:** Roadmap / Planning  
**Status:** Active  
**Created:** January 2, 2026  

---

## Executive Summary

This document outlines the complete path from current state to a fully functional VMware vSphere replacement. The goal is to create a production-ready virtualization platform that includes:

1. **Hypervisor Host** - Custom OS running Node Daemon
2. **Control Plane** - Cluster management (vCenter equivalent)
3. **Guest Agent** - VM integration (VMware Tools equivalent)
4. **Storage** - Distributed block storage (vSAN equivalent)
5. **Networking** - Software-defined networking (NSX equivalent)

---

## Current State (January 2, 2026)

### What's Complete ✅

| Component | Status | Notes |
|-----------|--------|-------|
| Frontend Dashboard | 95% | 15 pages, full UI |
| Control Plane (Go) | 85% | All services, wired to Node Daemon |
| Node Daemon (Rust) | 80% | gRPC server, registration, heartbeat |
| Mock Hypervisor | 100% | Full simulation for development |
| Libvirt Backend | 50% | Structure ready, needs testing |
| API Definitions | 100% | All domains defined |
| Documentation | 90% | ADRs, guides, specs |

### What Works End-to-End

```
Frontend → Control Plane → Scheduler → Node Daemon (mock)
     ↑                                      ↓
     └──────────── Status Updates ──────────┘
```

- ✅ VM creation (scheduled to node, created in mock)
- ✅ VM lifecycle (start, stop, reboot, delete)
- ✅ Node registration (auto on startup)
- ✅ Heartbeat (CPU/memory every 30s)
- ✅ Scheduler (spread/pack strategies)

---

## Phase 2: Real Hypervisor Testing (2-3 weeks)

### Goal
Boot a REAL VM through the entire stack using libvirt/KVM.

### Prerequisites

1. **Linux Host with KVM**
   ```bash
   # Check KVM support
   egrep -c '(vmx|svm)' /proc/cpuinfo  # Should be > 0
   
   # Install libvirt
   sudo apt install qemu-kvm libvirt-daemon-system libvirt-dev
   
   # Verify
   virsh list --all
   ```

2. **Rust with libvirt feature**
   ```bash
   # Build with libvirt
   cd agent
   cargo build --bin limiquantix-node --features libvirt
   ```

### Tasks

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Set up Linux test host | P0 | 1 day | VM or bare metal with KVM |
| Test libvirt backend | P0 | 2-3 days | Run Node Daemon with `--features libvirt` |
| Integrate qemu-img | P0 | 2 days | Create QCOW2 disk images |
| Domain XML validation | P0 | 1 day | Ensure generated XML works |
| VNC console proxy | P1 | 2 days | WebSocket proxy for console |
| Snapshot testing | P1 | 1 day | Test create/revert/delete |

### Deliverables

- [ ] VM boots on real KVM hypervisor
- [ ] Console accessible via VNC
- [ ] Snapshots work via libvirt
- [ ] Start/stop/reboot functional

---

## Phase 3: Storage Backend (4-6 weeks)

### Goal
Enable VMs to have persistent storage that survives host failures and supports live migration.

### Architecture Options

| Option | Complexity | Features | Recommendation |
|--------|------------|----------|----------------|
| **Local LVM** | Low | Simple, fast | Start here |
| **NFS** | Medium | Shared storage | Good for small clusters |
| **Ceph RBD** | High | Distributed, HA | Production target |
| **LINSTOR** | Medium | DRBD-based | Alternative to Ceph |

### Implementation Order

#### Phase 3A: Local Storage (1-2 weeks)

```rust
// storage/local.rs
pub struct LocalStorageBackend {
    base_path: PathBuf,  // /var/lib/limiquantix/images
}

impl StorageBackend for LocalStorageBackend {
    async fn create_disk(&self, name: &str, size_gb: u64, format: DiskFormat) -> Result<Disk>;
    async fn delete_disk(&self, id: &str) -> Result<()>;
    async fn resize_disk(&self, id: &str, new_size_gb: u64) -> Result<()>;
    async fn snapshot_disk(&self, id: &str, snapshot_name: &str) -> Result<Snapshot>;
}
```

Tasks:
- [ ] Create `limiquantix-storage` crate
- [ ] Implement local QCOW2 storage
- [ ] Integrate qemu-img for operations
- [ ] Wire to Node Daemon

#### Phase 3B: Shared Storage (2-3 weeks)

```rust
// storage/ceph.rs
pub struct CephStorageBackend {
    cluster: rados::Cluster,
    pool: String,
}
```

Tasks:
- [ ] Add Ceph RBD dependency
- [ ] Implement Ceph storage backend
- [ ] Volume provisioning
- [ ] Snapshot management
- [ ] Test with live migration

### Storage API (Already Defined)

```protobuf
service VolumeService {
  rpc CreateVolume(CreateVolumeRequest) returns (Volume);
  rpc DeleteVolume(DeleteVolumeRequest) returns (google.protobuf.Empty);
  rpc ResizeVolume(ResizeVolumeRequest) returns (Volume);
  rpc AttachVolume(AttachVolumeRequest) returns (Volume);
  rpc DetachVolume(DetachVolumeRequest) returns (Volume);
}
```

---

## Phase 4: Network Backend (4-6 weeks)

### Goal
Enable VMs to communicate with each other and the outside world through software-defined networking.

### Architecture Options

| Option | Complexity | Features | Recommendation |
|--------|------------|----------|----------------|
| **Linux Bridge** | Low | Simple | Start here |
| **OVS** | Medium | Advanced features | Next step |
| **OVN** | High | Distributed, L3 | Production target |

### Implementation Order

#### Phase 4A: Linux Bridge (1-2 weeks)

```rust
// network/bridge.rs
pub struct BridgeNetworkBackend {
    bridge_name: String,  // e.g., "virbr0"
}

impl NetworkBackend for BridgeNetworkBackend {
    async fn create_network(&self, name: &str, cidr: &str) -> Result<Network>;
    async fn attach_vm(&self, vm_id: &str, network_id: &str) -> Result<Port>;
    async fn detach_vm(&self, vm_id: &str, port_id: &str) -> Result<()>;
}
```

Tasks:
- [ ] Create `limiquantix-network` crate
- [ ] Implement Linux bridge backend
- [ ] DHCP integration (dnsmasq)
- [ ] NAT for external access
- [ ] Wire to Node Daemon

#### Phase 4B: OVN/OVS (3-4 weeks)

Tasks:
- [ ] Add OVN/OVS dependencies
- [ ] Implement OVN backend
- [ ] Distributed networking
- [ ] Security group enforcement
- [ ] Load balancer integration

### Network API (Already Defined)

```protobuf
service VirtualNetworkService {
  rpc CreateVirtualNetwork(CreateVirtualNetworkRequest) returns (VirtualNetwork);
  rpc DeleteVirtualNetwork(DeleteVirtualNetworkRequest) returns (google.protobuf.Empty);
}

service SecurityGroupService {
  rpc CreateSecurityGroup(CreateSecurityGroupRequest) returns (SecurityGroup);
  rpc AddRule(AddRuleRequest) returns (SecurityGroup);
}
```

---

## Phase 5: Guest Agent (4-6 weeks)

### Goal
Provide deep integration between the host and guest VM (like VMware Tools).

### Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                          Guest VM                             │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    Guest Agent (Rust)                    │ │
│  │                                                          │ │
│  │  ┌───────────────────┐  ┌───────────────────────────┐   │ │
│  │  │   Telemetry       │  │   Command Executor        │   │ │
│  │  │   - CPU usage     │  │   - Run scripts          │   │ │
│  │  │   - Memory usage  │  │   - Set hostname         │   │ │
│  │  │   - Disk usage    │  │   - Reset password       │   │ │
│  │  │   - Network       │  │   - Install packages     │   │ │
│  │  └───────────────────┘  └───────────────────────────┘   │ │
│  │                                                          │ │
│  │  ┌───────────────────┐  ┌───────────────────────────┐   │ │
│  │  │   File Transfer   │  │   Graceful Shutdown       │   │ │
│  │  │   - Upload        │  │   - ACPI coordination    │   │ │
│  │  │   - Download      │  │   - FS quiesce           │   │ │
│  │  └───────────────────┘  └───────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                              │                               │
│                      virtio-serial                           │
│                              │                               │
└──────────────────────────────┼───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                       Node Daemon                             │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                  GuestAgentClient                        │ │
│  │                                                          │ │
│  │  - Connect to guest via virtio-serial                   │ │
│  │  - Send commands, receive responses                     │ │
│  │  - Collect telemetry                                    │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Implementation Order

#### Phase 5A: Agent Framework (2 weeks)

```rust
// agent/limiquantix-guest/src/main.rs
#[tokio::main]
async fn main() {
    // Open virtio-serial port
    let port = VirtioSerial::open("/dev/virtio-ports/org.limiquantix.agent")?;
    
    // Start protocol handler
    let protocol = AgentProtocol::new(port);
    
    // Register handlers
    protocol.register(TelemetryHandler::new());
    protocol.register(CommandHandler::new());
    protocol.register(FileHandler::new());
    
    // Run forever
    protocol.run().await;
}
```

Tasks:
- [ ] Create `limiquantix-guest` crate
- [ ] Implement virtio-serial transport
- [ ] Define agent protocol (protobuf)
- [ ] Basic ping/pong communication

#### Phase 5B: Core Features (2-3 weeks)

Tasks:
- [ ] Telemetry collection
- [ ] Command execution
- [ ] Password reset
- [ ] Graceful shutdown coordination
- [ ] File upload/download

#### Phase 5C: Platform Support (1-2 weeks)

Tasks:
- [ ] Linux support
- [ ] Windows support (future)
- [ ] FreeBSD support (future)

### Guest Agent Protocol

```protobuf
message GuestAgentRequest {
  oneof request {
    PingRequest ping = 1;
    TelemetryRequest telemetry = 2;
    ExecuteCommandRequest execute = 3;
    PasswordResetRequest password_reset = 4;
    FileUploadRequest file_upload = 5;
  }
}

message GuestAgentResponse {
  oneof response {
    PingResponse ping = 1;
    TelemetryResponse telemetry = 2;
    ExecuteCommandResponse execute = 3;
    PasswordResetResponse password_reset = 4;
    FileUploadResponse file_upload = 5;
  }
}
```

---

## Phase 6: Host OS (8-12 weeks)

### Goal
Create a minimal, purpose-built OS for hypervisor hosts (like ESXi).

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LimiQuantix OS                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                   Node Daemon (Rust)                    │ │
│  │                  systemd managed                        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │            Minimal Linux (Alpine/Buildroot)             │ │
│  │                                                         │ │
│  │  - Linux Kernel with KVM                               │ │
│  │  - libvirt + QEMU                                      │ │
│  │  - Networking (OVS/OVN)                               │ │
│  │  - Storage (Ceph RBD)                                 │ │
│  │  - Read-only root filesystem                          │ │
│  │  - RAM-based /tmp and /var                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                     Hardware                            │ │
│  │  - x86_64 with VT-x/AMD-V                             │ │
│  │  - 64GB+ RAM recommended                              │ │
│  │  - NVMe for VM storage                                │ │
│  │  - 10GbE+ networking                                  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Order

#### Phase 6A: Base Image (3-4 weeks)

Tasks:
- [ ] Choose base (Alpine vs Buildroot)
- [ ] Kernel configuration (KVM, virtio)
- [ ] Package selection (minimal)
- [ ] Node Daemon integration
- [ ] Auto-start on boot

#### Phase 6B: Installation (2-3 weeks)

Tasks:
- [ ] ISO generation
- [ ] Installer script
- [ ] Disk partitioning
- [ ] Network configuration
- [ ] First-boot setup

#### Phase 6C: PXE Boot (2-3 weeks)

Tasks:
- [ ] Network boot support
- [ ] iPXE configuration
- [ ] Automated provisioning
- [ ] DHCP integration

---

## Phase 7: Enterprise Features (6-8 weeks)

### Live Migration (vMotion)

```
Source Host                          Destination Host
┌─────────────┐                     ┌─────────────┐
│  Running VM │ ──── Memory ─────▶  │  New VM     │
│             │ ──── State  ─────▶  │             │
│             │ ──── Disk   ─────▶  │             │
└─────────────┘      (shared)       └─────────────┘
     │                                    │
     └───────── Cutover (<1 sec) ─────────┘
```

Tasks:
- [ ] Pre-copy migration (memory pages)
- [ ] Disk migration (shared storage)
- [ ] Network cutover
- [ ] Post-migration verification

### High Availability

```
┌─────────────────────────────────────────────────────────────┐
│                    HA Manager (Control Plane)                │
│                                                              │
│  1. Detect host failure (missed heartbeats)                 │
│  2. Identify affected VMs                                   │
│  3. Select new host (scheduler)                            │
│  4. Restart VMs on new host                                │
│  5. Notify administrators                                  │
└─────────────────────────────────────────────────────────────┘
```

Tasks:
- [ ] Failure detection (heartbeat timeout)
- [ ] VM restart orchestration
- [ ] Storage fence (prevent split-brain)
- [ ] Alert integration

### DRS (Distributed Resource Scheduler)

Tasks:
- [ ] Resource imbalance detection
- [ ] Migration recommendations
- [ ] Automatic balancing (optional)
- [ ] Maintenance mode support

---

## Timeline Summary

| Phase | Duration | Start | End |
|-------|----------|-------|-----|
| Phase 2: Real Hypervisor | 2-3 weeks | Week 1 | Week 3 |
| Phase 3: Storage | 4-6 weeks | Week 2 | Week 8 |
| Phase 4: Networking | 4-6 weeks | Week 4 | Week 10 |
| Phase 5: Guest Agent | 4-6 weeks | Week 6 | Week 12 |
| Phase 6: Host OS | 8-12 weeks | Week 10 | Week 22 |
| Phase 7: Enterprise | 6-8 weeks | Week 16 | Week 24 |

**Total Estimated Time:** 6-8 months to full production readiness

---

## Immediate Next Steps (This Week)

1. **Set up Linux test environment**
   - Ubuntu 22.04 or Fedora with KVM
   - Install libvirt, qemu-kvm
   - Test with `virsh`

2. **Deploy Node Daemon with libvirt**
   ```bash
   cargo run --bin limiquantix-node --features libvirt -- \
     --libvirt-uri qemu:///system \
     --listen 0.0.0.0:9090 \
     --control-plane http://control-plane:8080 \
     --register
   ```

3. **Test VM creation**
   - Create test QCOW2 image
   - Create VM via API
   - Verify in `virsh list`

4. **Test console access**
   - Get VNC port from API
   - Connect with VNC client
   - Verify interaction

---

## Success Criteria

| Milestone | Criteria |
|-----------|----------|
| Phase 2 Complete | Real VM boots via full stack |
| Phase 3 Complete | VM has persistent disk storage |
| Phase 4 Complete | VM has network connectivity |
| Phase 5 Complete | Guest agent reports real metrics |
| Phase 6 Complete | Bare-metal hosts boot LimiQuantix OS |
| Phase 7 Complete | Live migration works between hosts |

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Libvirt complexity | High | Start with simple VMs, add features incrementally |
| Ceph learning curve | High | Start with LVM, migrate to Ceph later |
| OVN complexity | High | Start with Linux bridge, migrate to OVN later |
| Guest agent security | Medium | Minimal privileges, signed binaries |
| Host OS stability | High | Extensive testing, rollback support |

---

## Related Documents

- [000007 - Hypervisor Integration ADR](adr/000007-hypervisor-integration.md)
- [000031 - Node Daemon Implementation Plan](000031-node-daemon-implementation-plan.md)
- [000032 - VMService Node Daemon Integration](000032-vmservice-node-daemon-integration.md)
- [000033 - Node Registration Flow](000033-node-registration-flow.md)

