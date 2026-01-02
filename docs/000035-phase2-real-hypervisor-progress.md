# 000035 - Phase 2: Real Hypervisor Progress

**Document ID:** 000035  
**Category:** Implementation Progress  
**Status:** In Progress  
**Created:** January 2, 2026  

---

## Overview

Phase 2 focuses on moving from mock hypervisor to real KVM/libvirt-based VM management.

---

## Completed Tasks ✅

### 1. Storage Manager Module

**File:** `agent/Quantixkvm-hypervisor/src/storage.rs`

Created a complete disk image management module using `qemu-img`:

```rust
pub struct StorageManager {
    base_path: PathBuf,
    qemu_img_path: String,
}

impl StorageManager {
    // Create a new disk image
    pub fn create_disk(&self, vm_id: &str, disk: &mut DiskConfig) -> Result<PathBuf>;
    
    // Create image from backing file (for templates)
    pub fn create_from_backing(&self, path: &Path, backing: &Path, format: DiskFormat) -> Result<()>;
    
    // Resize existing disk
    pub fn resize_disk(&self, path: &Path, new_size_gib: u64) -> Result<()>;
    
    // Get disk information
    pub fn get_disk_info(&self, path: &Path) -> Result<DiskInfo>;
    
    // Convert disk format
    pub fn convert_disk(&self, src: &Path, dst: &Path, format: DiskFormat) -> Result<()>;
    
    // Delete disk
    pub fn delete_disk(&self, path: &Path) -> Result<()>;
    
    // Delete all VM disks
    pub fn delete_vm_disks(&self, vm_id: &str) -> Result<()>;
    
    // Check qemu-img availability
    pub fn check_qemu_img(&self) -> Result<String>;
}
```

**Features:**
- Automatic disk image creation using qemu-img
- Copy-on-write image support (for templates)
- Disk resize operations
- Disk format conversion (QCOW2, RAW, VMDK)
- Disk info retrieval (virtual size, actual size, backing file)
- VM directory management

### 2. Node Daemon Service Integration

**File:** `agent/Quantixkvm-node/src/service.rs`

Updated the gRPC service to automatically create disk images when VMs are created:

```rust
// If no disk path provided, create a new disk image
if disk.path.is_empty() && disk.size_gib > 0 {
    info!(
        vm_id = %req.vm_id,
        disk_id = %disk.id,
        size_gib = disk.size_gib,
        "Creating disk image for VM"
    );
    
    self.storage.create_disk(&req.vm_id, &mut disk_config)
        .map_err(|e| Status::internal(format!("Failed to create disk image: {}", e)))?;
}
```

**Flow:**
1. Client calls `CreateVM` with disk configuration (size, format, bus)
2. If `disk.path` is empty, StorageManager creates the image
3. Image is created at `/var/lib/Quantixkvm/images/{vm_id}/{disk_id}.qcow2`
4. `disk_config.path` is updated with the actual path
5. VM is created with the disk attached

### 3. Libvirt Backend Error Handling

**File:** `agent/Quantixkvm-hypervisor/src/libvirt/backend.rs`

Fixed error handling to use simple error variants instead of structured ones:

```rust
// Before (structured)
HypervisorError::VmNotFound { vm_id, reason }

// After (simple)
HypervisorError::VmNotFound(format!("{}: {}", vm_id, reason))
```

### 4. Error Types Simplified

**File:** `agent/Quantixkvm-hypervisor/src/error.rs`

Simplified error types for consistency:

```rust
#[derive(Error, Debug)]
pub enum HypervisorError {
    #[error("Failed to connect to hypervisor: {0}")]
    ConnectionFailed(String),
    
    #[error("VM not found: {0}")]
    VmNotFound(String),
    
    #[error("Failed to create VM: {0}")]
    CreateFailed(String),
    
    // ... etc
}
```

---

## Directory Structure

```
/var/lib/Quantixkvm/images/
├── {vm_id_1}/
│   ├── {disk_id_1}.qcow2
│   └── {disk_id_2}.qcow2
├── {vm_id_2}/
│   └── {disk_id_1}.qcow2
└── templates/
    ├── ubuntu-22.04.qcow2
    └── windows-2022.qcow2
```

---

## How to Test

### On macOS (Mock Mode)
```bash
cd agent
cargo run --bin Quantixkvm-node -- --dev --listen 127.0.0.1:9090
```

### On Linux with Libvirt
```bash
# Prerequisites
sudo apt install qemu-kvm libvirt-daemon-system libvirt-dev

# Build with libvirt feature
cargo build --bin Quantixkvm-node --features libvirt

# Run
./target/debug/Quantixkvm-node \
  --libvirt-uri qemu:///system \
  --listen 0.0.0.0:9090 \
  --control-plane http://control-plane:8080 \
  --register
```

### Test Disk Creation
```bash
# Create a VM with a disk
curl -X POST http://localhost:8080/Quantixkvm.compute.v1.VMService/CreateVM \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-vm",
    "spec": {
      "cpu": {"cores": 2},
      "memory": {"sizeMib": 2048},
      "disks": [
        {"sizeGib": 20, "bus": "VIRTIO", "format": "QCOW2"}
      ]
    }
  }'

# Verify disk created
ls -la /var/lib/Quantixkvm/images/{vm_id}/
```

---

## Remaining Work

### Phase 2 Pending
- [ ] Test on Linux with real KVM/libvirt
- [ ] VNC console proxy (WebSocket → VNC)
- [ ] Snapshot testing with libvirt

### Phase 3 (Storage)
- [ ] Ceph RBD integration
- [ ] LVM backend
- [ ] Volume CRUD operations

### Phase 4 (Network)
- [ ] Linux bridge backend
- [ ] OVN/OVS integration
- [ ] DHCP server

---

## Files Modified

| File | Changes |
|------|---------|
| `agent/Quantixkvm-hypervisor/src/storage.rs` | NEW - Disk image management |
| `agent/Quantixkvm-hypervisor/src/lib.rs` | Export storage module |
| `agent/Quantixkvm-hypervisor/src/error.rs` | Simplified error types |
| `agent/Quantixkvm-hypervisor/src/libvirt/backend.rs` | Fixed error handling |
| `agent/Quantixkvm-node/src/service.rs` | Integrate StorageManager |

---

## Dependencies

The storage module requires `qemu-img` to be installed on the system:

```bash
# Ubuntu/Debian
sudo apt install qemu-utils

# Fedora/RHEL
sudo dnf install qemu-img

# macOS (for testing)
brew install qemu
```

