# Real VM Implementation via Libvirt

**Document ID:** 000038  
**Date:** January 2, 2026  
**Status:** Implementation Complete, Pending Testing  
**Purpose:** Document the implementation of real VM creation via libvirt

---

## Overview

This document describes the implementation that allows the LimiQuantix platform to create, manage, and control real virtual machines through libvirt/KVM.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                              │
│                    VM Creation Wizard                                │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP/Connect-RPC
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Control Plane (Go)                               │
│  ┌─────────────────┐    ┌────────────────┐    ┌────────────────┐   │
│  │   VMService     │───▶│   Scheduler    │───▶│  DaemonClient  │   │
│  │ (CRUD + Power)  │    │ (Node Select)  │    │   (gRPC)       │   │
│  └─────────────────┘    └────────────────┘    └────────┬───────┘   │
└────────────────────────────────────────────────────────┼───────────┘
                                                         │ gRPC
                                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Node Daemon (Rust)                               │
│  ┌─────────────────┐    ┌────────────────┐    ┌────────────────┐   │
│  │ NodeDaemonSvc   │───▶│ StorageManager │───▶│  LibvirtBackend│   │
│  │ (gRPC Server)   │    │ (qemu-img)     │    │  (virt crate)  │   │
│  └─────────────────┘    └────────────────┘    └────────┬───────┘   │
└────────────────────────────────────────────────────────┼───────────┘
                                                         │ libvirt API
                                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        libvirt/QEMU/KVM                              │
│                    Domain definitions (XML)                          │
│                    Disk images (QCOW2)                               │
│                    Virtual networks (virbr0)                         │
└─────────────────────────────────────────────────────────────────────┘
```

## Components Modified

### 1. Proto Definition Sync

**File:** `agent/limiquantix-proto/proto/node_daemon.proto`

The Node Daemon proto was updated to match the backend's `CreateVMOnNodeRequest`:

```protobuf
message CreateVMOnNodeRequest {
  string vm_id = 1;
  string name = 2;
  VMSpec spec = 3;
  map<string, string> labels = 4;
}

message VMSpec {
  uint32 cpu_cores = 1;
  uint32 cpu_sockets = 2;
  uint32 cpu_threads_per_core = 3;
  uint64 memory_mib = 4;
  bool memory_hugepages = 5;
  Firmware firmware = 6;
  repeated BootDevice boot_order = 7;
  repeated DiskSpec disks = 8;
  repeated NicSpec nics = 9;
  repeated CdromSpec cdroms = 10;
  ConsoleSpec console = 11;
}
```

### 2. Service Implementation

**File:** `agent/limiquantix-node/src/service.rs`

The `create_vm` handler now:
1. Parses the nested `VMSpec` from the gRPC request
2. Converts proto types to hypervisor types
3. Creates disk images via `StorageManager` (uses `qemu-img create`)
4. Builds a `VmConfig` with all VM parameters
5. Calls `self.hypervisor.create_vm(config)` to define the VM in libvirt

### 3. Libvirt Backend

**File:** `agent/limiquantix-hypervisor/src/libvirt/backend.rs`

The `create_vm` implementation:
1. Builds libvirt domain XML using `DomainXmlBuilder`
2. Calls `Domain::define_xml()` to persist the VM definition
3. Returns the VM UUID

### 4. XML Generation

**File:** `agent/limiquantix-hypervisor/src/xml.rs`

Generates complete libvirt domain XML including:
- CPU topology (sockets, cores, threads)
- Memory configuration
- Boot order (disk, cdrom, network)
- BIOS or UEFI firmware
- Disk devices (virtio/scsi/sata/ide)
- Network interfaces (bridge/network)
- VNC/SPICE console
- Guest agent channel

### 5. Storage Manager

**File:** `agent/limiquantix-hypervisor/src/storage.rs`

Creates disk images using `qemu-img`:
```bash
qemu-img create -f qcow2 /var/lib/limiquantix/images/{vm_id}/{disk_id}.qcow2 {size}G
```

## VM Lifecycle Flow

### Create VM

1. **Frontend** sends `CreateVMRequest` to Control Plane
2. **Control Plane** validates, schedules to a node, persists to database
3. **Control Plane** calls `CreateVM` on Node Daemon via gRPC
4. **Node Daemon** creates disk images with `qemu-img`
5. **Node Daemon** generates libvirt domain XML
6. **Node Daemon** calls `virsh define` via libvirt API
7. VM appears in `virsh list --all` as "shut off"

### Start VM

1. **Frontend** sends `StartVMRequest` to Control Plane
2. **Control Plane** calls `StartVM` on Node Daemon
3. **Node Daemon** calls `domain.create()` via libvirt API
4. VM boots and appears as "running"

### Stop VM

1. **Frontend** sends `StopVMRequest` to Control Plane
2. **Control Plane** calls `StopVM` on Node Daemon
3. **Node Daemon** calls `domain.shutdown()` (ACPI) with timeout
4. If timeout, falls back to `domain.destroy()` (force)

### Delete VM

1. **Frontend** sends `DeleteVMRequest` to Control Plane
2. **Control Plane** calls `DeleteVM` on Node Daemon
3. **Node Daemon** verifies VM is stopped
4. **Node Daemon** calls `domain.undefine()` via libvirt API
5. **Node Daemon** deletes disk images from storage

## Testing Instructions

### Prerequisites on Linux Host

```bash
# Install KVM and libvirt
sudo apt update
sudo apt install -y qemu-kvm libvirt-daemon-system virtinst bridge-utils

# Add user to libvirt group
sudo usermod -aG libvirt $USER
newgrp libvirt

# Verify virtualization
virt-host-validate

# Start default network
sudo virsh net-start default
sudo virsh net-autostart default
```

### Build and Run Node Daemon

```bash
cd agent
cargo build --release --bin limiquantix-node --features libvirt

# Create storage directory
sudo mkdir -p /var/lib/limiquantix/images
sudo chown $USER:$USER /var/lib/limiquantix/images

# Run Node Daemon
./target/release/limiquantix-node \
  --libvirt-uri qemu:///system \
  --listen 0.0.0.0:9090 \
  --control-plane http://<CONTROL_PLANE_IP>:8080 \
  --register
```

### Create VM via Dashboard

1. Open Dashboard at `http://localhost:5174`
2. Navigate to **Hosts** and verify your node appears
3. Click **Create VM** button
4. Fill in VM details:
   - Name: `test-vm`
   - CPU: 2 cores
   - Memory: 2048 MiB
   - Disk: 10 GiB
   - Network: Default (virbr0)
5. Click **Create**

### Verify VM Creation

```bash
# Check VM is defined
virsh list --all

# Check disk image was created
ls -la /var/lib/limiquantix/images/

# Start the VM
virsh start <vm-uuid>

# Get VNC console port
virsh domdisplay <vm-uuid>
```

## Known Limitations

1. **No ISO mounting yet** - VMs boot to an empty disk
2. **No cloud-init** - Cannot provision VMs automatically
3. **Console proxy not implemented** - VNC requires direct access
4. **Snapshots via virsh** - Using command-line fallback due to virt crate limitations

## Next Steps

1. **Test on real Linux hypervisor**
2. **Add ISO mounting** for OS installation
3. **Implement cloud-init** for automated provisioning
4. **Add VNC WebSocket proxy** for browser console access
5. **Implement proper heartbeat** for status updates

## Files Changed

| File | Change |
|------|--------|
| `agent/limiquantix-proto/proto/node_daemon.proto` | Synced with backend proto |
| `agent/limiquantix-node/src/service.rs` | Updated `create_vm` handler |
| `docs/000038-real-vm-implementation.md` | This documentation |

## References

- [Libvirt Domain XML Format](https://libvirt.org/formatdomain.html)
- [QEMU Disk Images](https://qemu.readthedocs.io/en/latest/system/images.html)
- [virt-rs crate](https://crates.io/crates/virt)
