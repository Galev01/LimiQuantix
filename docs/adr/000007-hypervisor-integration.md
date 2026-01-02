# ADR-000007: Hypervisor Integration Strategy

**Status:** Accepted  
**Date:** 2026-01-02  
**Authors:** LimiQuantix Team  
**Reviewers:** Architecture Team  

---

## Context

LimiQuantix requires a hypervisor layer to execute virtual machines. This is the critical foundation that transforms the platform from a management UI into an actual virtualization solution.

The project vision ("VMware Killer") demands:
- **Windows VM support** - Enterprise table stakes
- **Live migration** - Expected by VMware users (vMotion equivalent)
- **GPU passthrough** - Increasingly required for AI/ML workloads
- **Fast boot times** - Modern user expectations
- **Security** - Minimal attack surface
- **Ease of clustering** - "5-minute HA setup" goal

We evaluated four primary hypervisor options:
1. **QEMU + libvirt** - Industry standard
2. **Cloud Hypervisor** - Modern Rust VMM
3. **Firecracker** - AWS's microVM solution
4. **crosvm** - Google's Chrome OS VMM

---

## Decision

**We will use QEMU + libvirt as the primary hypervisor backend**, with an abstraction layer that allows adding Cloud Hypervisor support in the future for performance-sensitive Linux workloads.

---

## Options Analysis

### Option 1: QEMU + libvirt

**What it is:** The industry standard virtualization stack. QEMU provides device emulation, libvirt provides management.

| Aspect | Assessment |
|--------|------------|
| **Windows Support** | ✅ Full support (WHQL drivers available) |
| **Live Migration** | ✅ Battle-tested, works well |
| **GPU Passthrough** | ✅ VFIO, vGPU (NVIDIA GRID, AMD MxGPU) |
| **Boot Time** | ⚠️ 1-3 seconds typical |
| **Memory Overhead** | ⚠️ 30-50MB per VM |
| **Security Surface** | ⚠️ Large C codebase (2M+ lines) |
| **Maturity** | ✅ 15+ years in production |
| **Ecosystem** | ✅ Massive (OpenStack, Proxmox, oVirt, Red Hat) |
| **Documentation** | ✅ Extensive |
| **Nested Virtualization** | ✅ Full support |
| **Snapshots** | ✅ Full support (internal + external) |
| **USB Passthrough** | ✅ Full support |

**Effort Estimate:** 5 weeks to full integration

### Option 2: Cloud Hypervisor

**What it is:** Modern, minimal VMM written in Rust by Intel. Used by Azure, Alibaba Cloud.

| Aspect | Assessment |
|--------|------------|
| **Windows Support** | ❌ Not supported (Linux guests only) |
| **Live Migration** | ❌ In development, not production-ready |
| **GPU Passthrough** | ⚠️ Limited PCI passthrough, no vGPU |
| **Boot Time** | ✅ ~125ms (excellent) |
| **Memory Overhead** | ✅ ~5MB per VM |
| **Security Surface** | ✅ Rust, minimal attack surface |
| **Maturity** | ⚠️ Newer project (since 2019) |
| **Ecosystem** | ⚠️ Growing but smaller |
| **Documentation** | ⚠️ Less comprehensive |
| **Nested Virtualization** | ❌ Not supported |
| **Snapshots** | ⚠️ Basic support |
| **USB Passthrough** | ❌ Not supported |

**Effort Estimate:** 3 weeks (but missing critical features)

### Option 3: Firecracker

**What it is:** AWS's microVM hypervisor for Lambda and Fargate.

| Aspect | Assessment |
|--------|------------|
| **Windows Support** | ❌ Linux only |
| **Live Migration** | ❌ Not supported |
| **GPU Passthrough** | ❌ Not supported |
| **Boot Time** | ✅ <125ms |
| **Memory Overhead** | ✅ <5MB |
| **Security Surface** | ✅ Rust, jailer isolation |
| **Use Case** | Serverless/ephemeral only |

**Verdict:** Not suitable for traditional VM workloads

### Option 4: crosvm

**What it is:** Google's Chrome OS VMM for Crostini.

| Aspect | Assessment |
|--------|------------|
| **Windows Support** | ⚠️ Experimental |
| **Live Migration** | ❌ Not supported |
| **GPU Passthrough** | ✅ virgl virtualized GPU |
| **Focus** | Desktop virtualization |

**Verdict:** Too Chrome OS-focused for our use case

---

## Feature Comparison Matrix

| Feature | QEMU/libvirt | Cloud Hypervisor | Firecracker | Required? |
|---------|--------------|------------------|-------------|-----------|
| Windows VMs | ✅ | ❌ | ❌ | **P0** |
| Live Migration | ✅ | ❌ | ❌ | **P0** |
| GPU Passthrough | ✅ | ⚠️ | ❌ | **P1** |
| VNC/SPICE Console | ✅ | ✅ | ❌ | **P0** |
| Snapshots | ✅ | ⚠️ | ❌ | **P1** |
| USB Passthrough | ✅ | ❌ | ❌ | **P2** |
| Nested Virtualization | ✅ | ❌ | ❌ | **P2** |
| <200ms Boot | ❌ | ✅ | ✅ | Nice-to-have |
| <10MB Overhead | ❌ | ✅ | ✅ | Nice-to-have |
| Rust Codebase | ❌ | ✅ | ✅ | Nice-to-have |

**Conclusion:** QEMU/libvirt is the only option that meets all P0 requirements.

---

## Architecture Decision

### Hybrid Architecture

We will implement a **hypervisor abstraction layer** that:
1. **Defaults to QEMU/libvirt** for full enterprise feature support
2. **Allows Cloud Hypervisor** as an opt-in backend for Linux-only workloads
3. **Exposes a unified API** to the control plane

```
┌─────────────────────────────────────────────────────────────┐
│                 LimiQuantix Control Plane                   │
│                      (Go + gRPC)                            │
└─────────────────────────────┬───────────────────────────────┘
                              │ gRPC
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Node Daemon (Rust)                       │
│               Unified Hypervisor Abstraction                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐       ┌─────────────────────┐      │
│  │   LibvirtBackend    │       │ CloudHypervisorBack │      │
│  │  (QEMU/KVM via      │       │    (REST API)       │      │
│  │    libvirt-rs)      │       │                     │      │
│  └──────────┬──────────┘       └──────────┬──────────┘      │
│             │                             │                 │
└─────────────┼─────────────────────────────┼─────────────────┘
              │                             │
              ▼                             ▼
┌─────────────────────────┐   ┌─────────────────────────────┐
│      libvirt daemon     │   │    cloud-hypervisor         │
│         (libvirtd)      │   │       process               │
└─────────────────────────┘   └─────────────────────────────┘
              │                             │
              ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                        Linux KVM                            │
└─────────────────────────────────────────────────────────────┘
```

### Node Daemon Design

The Node Daemon will be a Rust binary that:

1. **Runs on each hypervisor node** as a systemd service
2. **Communicates with control plane** via gRPC (or Connect-RPC)
3. **Manages local VMs** through the hypervisor abstraction layer
4. **Reports telemetry** (node health, VM status, resource usage)
5. **Executes VM operations** (create, start, stop, migrate, snapshot)

### Hypervisor Trait

```rust
/// Abstraction over different hypervisor backends
#[async_trait]
pub trait Hypervisor: Send + Sync {
    /// Get hypervisor capabilities
    async fn capabilities(&self) -> Result<HypervisorCapabilities>;
    
    /// Create a new VM (does not start it)
    async fn create_vm(&self, config: VmConfig) -> Result<VmHandle>;
    
    /// Start a VM
    async fn start_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Stop a VM (graceful shutdown)
    async fn stop_vm(&self, vm_id: &str, timeout: Duration) -> Result<()>;
    
    /// Force stop a VM (power off)
    async fn force_stop_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Reboot a VM
    async fn reboot_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Pause a VM
    async fn pause_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Resume a paused VM
    async fn resume_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Delete a VM (must be stopped)
    async fn delete_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Get VM status
    async fn get_vm_status(&self, vm_id: &str) -> Result<VmStatus>;
    
    /// List all VMs
    async fn list_vms(&self) -> Result<Vec<VmInfo>>;
    
    /// Create a snapshot
    async fn create_snapshot(&self, vm_id: &str, name: &str) -> Result<SnapshotHandle>;
    
    /// Revert to a snapshot
    async fn revert_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()>;
    
    /// Delete a snapshot
    async fn delete_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()>;
    
    /// Get console connection info
    async fn get_console(&self, vm_id: &str) -> Result<ConsoleInfo>;
    
    /// Attach a disk to a running VM
    async fn attach_disk(&self, vm_id: &str, disk: DiskConfig) -> Result<()>;
    
    /// Detach a disk from a running VM
    async fn detach_disk(&self, vm_id: &str, disk_id: &str) -> Result<()>;
    
    /// Migrate a VM to another host (for libvirt backend)
    async fn migrate_vm(&self, vm_id: &str, target_uri: &str) -> Result<()>;
}
```

---

## Consequences

### Positive

1. **Enterprise Feature Completeness**
   - Windows VMs work out of the box
   - Live migration available immediately
   - GPU passthrough for AI/ML workloads
   - Mature snapshot support

2. **Faster Time to Market**
   - Leverage 15+ years of libvirt development
   - Extensive documentation and community support
   - Well-known failure modes and solutions

3. **Production Confidence**
   - Used by OpenStack, Proxmox, oVirt, Red Hat
   - Millions of VMs in production worldwide

4. **Future Flexibility**
   - Abstraction layer allows adding Cloud Hypervisor later
   - Can offer "performance mode" for Linux-only workloads
   - No lock-in to single hypervisor

### Negative

1. **Performance Overhead**
   - 30-50MB per VM vs. 5MB for Cloud Hypervisor
   - 1-3s boot time vs. 125ms
   - Higher CPU overhead for device emulation

2. **Larger Attack Surface**
   - QEMU is 2M+ lines of C code
   - Historical CVEs (though well-maintained)
   - More complex security isolation required

3. **Dependency on C Libraries**
   - libvirt-rs bindings add complexity
   - Cross-compilation more challenging
   - Potential for FFI-related bugs

### Mitigations

| Risk | Mitigation |
|------|------------|
| Security surface | Use sVirt/SELinux, seccomp filters, cgroups isolation |
| Performance | Add Cloud Hypervisor option for Linux workloads |
| Complexity | Strong abstraction layer, comprehensive testing |
| Dependency management | Pin versions, automated CVE monitoring |

---

## Implementation Plan

### Phase 1: Foundation (Weeks 1-2)

1. **Setup Rust project structure**
   - Create `limiquantix-node` crate
   - Add dependencies (tonic, libvirt-rs, tokio)
   - Define Hypervisor trait

2. **Implement libvirt backend skeleton**
   - Connection management
   - Basic VM lifecycle (create, start, stop)

### Phase 2: Core Operations (Weeks 3-4)

1. **Complete VM lifecycle**
   - Full CRUD operations
   - Power management (pause, resume, reboot)
   - Console access (VNC proxy)

2. **Storage integration**
   - QCOW2 local storage
   - Ceph RBD preparation

### Phase 3: Advanced Features (Weeks 5-6)

1. **Snapshots**
   - Create/revert/delete
   - Integration with storage backends

2. **Live Migration**
   - Pre-copy migration
   - Storage migration

3. **GPU/PCI Passthrough**
   - VFIO configuration
   - Device attachment

### Phase 4: Production Hardening (Weeks 7-8)

1. **Monitoring & Telemetry**
   - Resource usage collection
   - Event streaming

2. **Security**
   - sVirt/SELinux integration
   - Seccomp profiles

3. **Testing**
   - Integration tests
   - Chaos engineering

---

## Alternatives Considered

### Alternative 1: Cloud Hypervisor Only

**Rejected because:**
- No Windows support (enterprise requirement)
- No live migration (VMware parity requirement)
- Limited GPU passthrough

### Alternative 2: Firecracker

**Rejected because:**
- Designed for ephemeral/serverless, not traditional VMs
- No persistent storage model
- No console access

### Alternative 3: Build Custom VMM

**Rejected because:**
- Requires 100+ kernel engineers
- 5+ years of development
- Massive security validation effort
- No business justification when proven solutions exist

---

## References

- [libvirt documentation](https://libvirt.org/docs.html)
- [Cloud Hypervisor GitHub](https://github.com/cloud-hypervisor/cloud-hypervisor)
- [QEMU documentation](https://www.qemu.org/docs/master/)
- [Firecracker design](https://firecracker-microvm.github.io/)
- [libvirt-rs crate](https://crates.io/crates/virt)

---

## Decision Record

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-02 | Use QEMU/libvirt as primary | Enterprise features, maturity |
| 2026-01-02 | Create abstraction layer | Future flexibility |
| 2026-01-02 | Plan Cloud Hypervisor addition | Performance option for Linux |

---

**Approved By:** Architecture Team  
**Implementation Owner:** Systems Engineering Team

