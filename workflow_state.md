# LimiQuantix Workflow State

## Current Status: Guest Agent Windows & Enterprise Features ✅

**Last Updated:** January 3, 2026

---

## What's New (This Session)

### ✅ Guest Agent Windows Support & Enterprise Features

Extended the Guest Agent with full Windows support and enterprise UI features:

| Feature | Platform | Status |
|---------|----------|--------|
| **VSS Quiescing** | Windows | ✅ Complete |
| **MSI Installer** | Windows | ✅ Complete |
| **NetworkManager Support** | Linux (RHEL/CentOS) | ✅ Complete |
| **Windows netsh Config** | Windows | ✅ Complete |
| **Agent Version Display** | Frontend | ✅ Complete |
| **Agent Update Button** | Frontend | ✅ Complete |
| **File Browser UI** | Frontend | ✅ Complete |

#### 1. Windows VSS Quiescing

**File:** `handlers/quiesce.rs`

- Uses `diskshadow` to create volatile shadow copies
- Triggers VSS writers (SQL Server, Exchange, etc.)
- Auto-thaw via `vssadmin delete shadows`

#### 2. Windows MSI Installer

**Files:**
- `packaging/windows/wix/main.wxs` - WiX v4 configuration
- `packaging/windows/wix/config.yaml.template` - Default config
- `packaging/windows/build-msi.ps1` - Build script

Features:
- Installs to `C:\Program Files\LimiQuantix\Agent\`
- Registers as Windows Service
- Auto-start on boot

#### 3. Enhanced Network Configuration

**File:** `handlers/lifecycle.rs`

- Auto-detects Netplan vs NetworkManager
- Supports Windows via netsh commands
- Writes keyfile format for NetworkManager

#### 4. Agent Version Display & Update

**File:** `components/vm/GuestAgentStatus.tsx`

- Shows current version with badge
- Yellow warning when update available
- "Update Agent" button triggers:
  1. Download new binary
  2. Transfer via file write RPC
  3. Execute upgrade script
  4. Restart agent service

#### 5. File Browser UI

**File:** `components/vm/FileBrowser.tsx` (NEW)

Full-featured file browser:
- Quick access sidebar (/, /home, /etc, C:\, etc.)
- Directory navigation with path bar
- File preview for text files
- Download and delete operations
- Platform-aware paths

---

### Previous: QVMRC Deep Link Connection Fixed

Fixed the issue where clicking "Open with QVMRC" from the web UI would open the program but not populate it with the connection data:

**Changes Made:**

1. **`main.rs`** - Improved deep link handling:
   - Added `deep-link-received` event emission to frontend
   - Proper focus and unminimize window when receiving deep link

2. **`App.tsx`** - Added event listener for deep links:
   - Listens for `deep-link-received` Tauri event
   - Saves connection to config using `add_and_connect`
   - Starts VNC connection automatically
   - Forces refresh of connection list

3. **`config.rs`** - Improved upsert logic:
   - `upsert_connection` now checks by `vm_id` to avoid duplicate entries
   - Same VM from different deep links updates existing connection

4. **`main.rs`** - `add_and_connect` now reuses existing connection ID:
   - Finds existing connection by `vm_id`
   - Updates timestamp instead of creating new entry

**Result:** Clicking "Open with QVMRC" now:
- Opens QVMRC (or focuses existing window)
- Saves the VM connection to the saved connections list
- Immediately attempts to connect via VNC

---

### ✅ Ceph RBD Backend - Complete

Implemented full Ceph RBD storage backend for distributed hyper-converged storage:

#### 1. CephBackend Implementation (Rust)

**New File:** `agent/limiquantix-hypervisor/src/storage/ceph.rs`

| Feature | Implementation |
|---------|---------------|
| Volume Creation | `rbd create --size <MB> <pool>/<image>` |
| Volume Deletion | `rbd rm` with snapshot cleanup |
| Volume Resize | `rbd resize --size <MB>` |
| Clone (CoW) | `rbd snap create` → `rbd snap protect` → `rbd clone` |
| Snapshots | `rbd snap create <pool>/<image>@<snap>` |
| Pool Capacity | `rbd du` + `ceph df` parsing |
| Libvirt Secret | Auto-creates if not exists via `virsh secret-define` |

**Libvirt Disk XML Generation:**

```xml
<disk type='network' device='disk'>
  <driver name='qemu' type='raw' cache='writeback' discard='unmap'/>
  <source protocol='rbd' name='libvirt-pool/vm-100-disk-0'>
    <host name='10.0.0.1' port='6789'/>
    <host name='10.0.0.2' port='6789'/>
  </source>
  <auth username='libvirt'>
    <secret type='ceph' uuid='550e8400-e29b-41d4-a716-446655440000'/>
  </auth>
  <target dev='vdX' bus='virtio'/>
</disk>
```

#### 2. Node Daemon Storage gRPC

Added storage RPCs to `proto/limiquantix/node/v1/node_daemon.proto`:

**Pool Operations:**
- `InitStoragePool` - Initialize/mount pool
- `DestroyStoragePool` - Cleanup pool
- `GetStoragePoolInfo` - Get capacity/status
- `ListStoragePools` - List all pools

**Volume Operations:**
- `CreateVolume` - Create with optional source (clone/image/snapshot)
- `DeleteVolume` - Remove volume
- `ResizeVolume` - Expand volume
- `CloneVolume` - Copy-on-write clone
- `GetVolumeAttachInfo` - Get libvirt disk XML
- `CreateVolumeSnapshot` - Point-in-time snapshot

**Message Types:**
- `StoragePoolType` enum (LOCAL_DIR, NFS, CEPH_RBD, etc.)
- `StoragePoolConfig` with backend-specific configs
- `VolumeSourceType` enum (EMPTY, CLONE, IMAGE, SNAPSHOT)

#### 3. Control Plane Integration (Go)

**Updated `daemon_client.go`:**
- Added all storage pool and volume methods
- Proper logging with zap
- Error handling

**Updated `pool_service.go`:**
- Integrated with `DaemonPool` for node communication
- Pool initialization on connected nodes
- Converts domain models to node daemon requests

**Domain Model Updates:**
- Added `ISCSIConfig` struct
- Added `SecretUUID` to CephConfig
- Added `MountPoint` to NFSConfig
- Changed `StorageBackend` to pointer for nil checks

---

## Updated Storage Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CONTROL PLANE (Go)                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │              PoolService / VolumeService                             │    │
│  │  - Manages storage pools in etcd                                     │    │
│  │  - Routes operations to node daemons                                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ gRPC (InitStoragePool, CreateVolume, etc.)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          NODE DAEMON (Rust)                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      StorageManager                                  │    │
│  │  - Routes to appropriate backend based on pool type                 │    │
│  │  - Caches pool information                                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│       ┌────────────────────────────┼────────────────────────────┐           │
│       ▼                            ▼                            ▼           │
│  ┌──────────┐              ┌──────────┐                  ┌──────────┐       │
│  │  Local   │              │   NFS    │                  │   Ceph   │       │
│  │ Backend  │              │ Backend  │                  │ Backend  │       │
│  │ qemu-img │              │ mount+   │                  │ rbd CLI  │       │
│  │          │              │ qemu-img │                  │ librbd   │       │
│  └──────────┘              └──────────┘                  └──────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Files Changed This Session

| File | Changes |
|------|---------|
| `agent/limiquantix-hypervisor/src/storage/ceph.rs` | **NEW** - CephBackend implementation |
| `agent/limiquantix-hypervisor/src/storage/mod.rs` | Added Ceph import and registration |
| `agent/limiquantix-hypervisor/src/lib.rs` | Export CephBackend |
| `proto/limiquantix/node/v1/node_daemon.proto` | Storage pool & volume RPCs |
| `agent/limiquantix-proto/proto/node_daemon.proto` | Storage pool & volume RPCs (agent copy) |
| `backend/internal/services/node/daemon_client.go` | Storage methods |
| `backend/internal/services/storage/pool_service.go` | Node daemon integration |
| `backend/internal/domain/storage.go` | ISCSIConfig, SecretUUID, MountPoint |
| `backend/internal/repository/memory/storage_pool_repository.go` | Fixed pointer types |
| `backend/internal/services/storage/pool_converter.go` | Fixed Backend pointer |
| `frontend/src/hooks/useImages.ts` | Fixed connect import |

---

## Next Steps

### Priority 1: iSCSI Backend
- [ ] Implement IscsiBackend in Rust
- [ ] Add `iscsiadm` discovery/login integration
- [ ] Add LVM volume group management

### Priority 2: Node Daemon Storage Handler
- [ ] Implement gRPC handlers in Rust node daemon
- [ ] Wire StorageManager to gRPC service

### Priority 3: Frontend Storage UI
- [ ] Storage pools list page
- [ ] Create storage pool form (NFS, Ceph, Local)
- [ ] Volume management in VM details

### Priority 4: Testing
- [ ] Ceph single-node container tests
- [ ] Integration tests with real NFS server
- [ ] iSCSI targetcli tests

---

## Previous Sessions

### ✅ Guest Agent Enterprise Features
- Filesystem quiescing (fsfreeze)
- User context execution (setuid/setgid)
- Time synchronization (chrony, ntpd)

### ✅ Storage Backend Foundation
- Modular StorageBackend trait
- LocalBackend (qemu-img)
- NfsBackend (mount + qemu-img)

### ✅ QVMRC Native Client
- Full RFB VNC protocol
- Deep link support
- Windows installers

---

## Commands Reference

```bash
# Backend
cd backend && go run ./cmd/controlplane --dev

# Frontend
cd frontend && npm run dev

# Node Daemon (on Ubuntu)
cd agent && cargo run --release --bin limiquantix-node --features libvirt

# Proto regeneration
cd proto && buf generate

# Check hypervisor crate
cd agent && cargo check -p limiquantix-hypervisor

# Test Ceph connectivity (on node)
rbd ls --pool libvirt-pool --mon-host 10.0.0.1:6789 --id libvirt
```

---

## Documentation

| Doc | Purpose |
|-----|---------|
| `docs/000046-storage-backend-implementation.md` | Storage Backend Implementation Plan |
| `docs/000045-guest-agent-integration-complete.md` | Guest Agent Features |
| `docs/000044-guest-agent-architecture.md` | Guest Agent Architecture |
| `docs/000042-console-access-implementation.md` | Web Console + QVMRC |
| `docs/adr/000003-storage-model-design.md` | Storage Model ADR |
