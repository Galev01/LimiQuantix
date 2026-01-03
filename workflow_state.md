# LimiQuantix Workflow State

## Current Status: Cloud-Init User/Password UX Improvement ✅

**Last Updated:** January 3, 2026

---

## What's New (This Session)

### 🔄 Cloud-Init Username & Password Configuration

**Problem:** Users couldn't access their VMs after cloud-init provisioning because:
1. Cloud images require SSH key authentication by default
2. No password was set, making console access impossible
3. SSH keys weren't being injected properly

**Solution:** Enhanced the VM Creation Wizard with:

| Feature | Description |
|---------|-------------|
| **Password Field** | User can set a password for console/SSH access |
| **Password Confirmation** | Prevents typos with confirmation field |
| **SSH Password Auth** | Enables SSH password authentication (`ssh_pwauth: true`) |
| **Password Hash** | Uses SHA-512 hash for security |
| **SSH Key Validation** | Validates SSH key format before adding |
| **Visual Feedback** | Shows authentication summary in review step |

#### Cloud-Init User-Data Generation

**FIXED:** Changed from `plain_text_passwd` (invalid) to `chpasswd.list` module (correct).

The generated cloud-config now includes:

```yaml
#cloud-config
hostname: <vm-name>
fqdn: <vm-name>.local
manage_etc_hosts: true

users:
  - name: ubuntu  # or specified username
    groups: [sudo, adm]
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    ssh_authorized_keys:
      - ssh-rsa AAAA...

# Enable SSH password authentication
ssh_pwauth: true

# Set password using chpasswd module (the correct way!)
chpasswd:
  expire: false
  list:
    - ubuntu:mypassword

package_update: true
packages:
  - qemu-guest-agent
```

#### Files Changed

| File | Changes |
|------|---------|
| `frontend/src/components/vm/VMCreationWizard.tsx` | Added password fields, SSH key validation, access summary |

#### UI Improvements

1. **Password Input Component** - Toggle visibility, proper masking
2. **Password Confirmation** - Prevents typos, shows validation status
3. **SSH Key Validation** - Checks format before adding, shows error messages
4. **Access Summary Card** - Shows configured access methods with connection instructions
5. **Step Validation** - Prevents proceeding without any access configured
6. **Review Step** - Shows password status, access methods summary

---

## Previous: ISO Upload & Image Library ✅

### ✅ ISO Upload & Image Library

Implemented a complete ISO upload and management system:

| Component | File | Description |
|-----------|------|-------------|
| **ISOUploadDialog** | `components/storage/ISOUploadDialog.tsx` | Multi-step dialog for uploading ISOs via URL or file |
| **ImageLibrary** | `pages/ImageLibrary.tsx` | Page to manage cloud images and ISOs |
| **useISOs** | `hooks/useImages.ts` | Hook to fetch ISOs from API with fallback |
| **ISO_CATALOG** | `hooks/useImages.ts` | Built-in ISO catalog for fallback |

#### Features

1. **Upload from URL** - Download ISO from any public URL
2. **Upload from File** - Drag-and-drop or browse for local ISO files
3. **OS Detection** - Select OS family, distribution, and version
4. **Storage Pool Selection** - Choose target storage pool
5. **Progress Tracking** - Monitor download progress
6. **Image Library Page** - View and manage all images
   - Tab-based navigation (Cloud Images / ISOs)
   - Search and filter by status
   - Download from catalog
   - Delete images

#### VMCreationWizard Integration

- ISO selection now uses API data with catalog fallback
- Shows warning when using built-in catalog
- Link to Image Library for uploading new ISOs
- Review step shows selected ISO name

---

### ✅ Quantix Agent Integration in VM Creation Wizard

Enhanced the VM Creation Wizard to properly install the Quantix Agent via cloud-init:

| Change | Description |
|--------|-------------|
| **Renamed Agent** | "limiquantix Agent" → "Quantix Agent" across UI |
| **Enhanced Checkbox** | Shows feature list when enabled (metrics, IP reporting, script execution, etc.) |
| **Cloud-Init Script** | Auto-generates installation script for Debian/Ubuntu, RHEL/Fedora, and generic Linux |
| **Review Step** | Shows "Quantix Agent: Will be installed via cloud-init" |

#### Cloud-Init Agent Installation

When "Install Quantix Agent" is checked, the cloud-init user-data includes:

1. **Package Detection** - Detects apt-get vs dnf/yum
2. **Debian/Ubuntu** - Downloads and installs `.deb` package
3. **RHEL/Fedora** - Downloads and installs `.rpm` package  
4. **Fallback** - Direct binary + systemd service for other distros
5. **Pre-freeze/Post-thaw Directories** - Creates hook directories for snapshot quiescing

#### Features Displayed When Enabled

- ✅ Live metrics & telemetry
- ✅ IP address reporting
- ✅ Remote script execution
- ✅ File browser access
- ✅ Snapshot quiescing (fsfreeze)
- ✅ Graceful shutdown/reboot

---

### ✅ VM Actions Dropdown Menu

Added a dropdown menu to the VM Detail page with additional actions:

| Component | File | Description |
|-----------|------|-------------|
| **DropdownMenu** | `components/ui/DropdownMenu.tsx` | Reusable dropdown component |
| **EditSettingsModal** | `components/vm/EditSettingsModal.tsx` | Edit VM name, description, labels |
| **EditResourcesModal** | `components/vm/EditResourcesModal.tsx` | Edit CPU cores and memory |
| **VMDetail** | `pages/VMDetail.tsx` | Integrated all components |

#### Dropdown Menu Items

1. **Edit Settings** - Opens modal to change name, description, labels
2. **Edit Resources** - Opens modal to change CPU cores and memory
3. **Run Script** - Execute scripts via Quantix Agent (moved from top bar)
4. **Browse Files** - File browser via Quantix Agent
5. **Clone VM** - Clone the VM (placeholder)
6. **Force Stop** - Force stop a running VM
7. **Delete VM** - Delete the VM with confirmation

#### Features

- Click outside or ESC to close dropdown
- Dividers to group related actions
- Danger variant for destructive actions (red text)
- Disabled state for actions requiring running VM
- Animated entry with scale and fade

---

## Previous: Storage Backend Complete ✅

### ✅ iSCSI Backend Complete

Implemented full iSCSI storage backend with LVM thin provisioning:

**New File:** `agent/limiquantix-hypervisor/src/storage/iscsi.rs`

| Feature | Implementation |
|---------|---------------|
| Target Discovery | `iscsiadm -m discovery -t st -p <portal>` |
| Login/Logout | `iscsiadm -m node -T <iqn> -l/-u` |
| CHAP Auth | Configure via `iscsiadm -o update` |
| LVM Init | `pvcreate`, `vgcreate`, thin pool creation |
| Thin Volumes | `lvcreate -T` for space-efficient provisioning |
| Snapshots | LVM snapshot (`lvcreate -s`) |

### ✅ Frontend Storage UI Complete

**Storage Pools Page** (`frontend/src/pages/StoragePools.tsx`):
- Pool list with status badges
- Summary cards (total pools, capacity, usage)
- Filter by status
- Create Pool dialog (multi-step wizard)

**Volumes Page** (`frontend/src/pages/Volumes.tsx`):
- Volume table with actions
- Inline resize
- Attach/detach operations
- Create Volume dialog

**New Components:**
- `components/storage/CreatePoolDialog.tsx` - Pool creation wizard
- `components/storage/CreateVolumeDialog.tsx` - Volume creation wizard

**New Hooks** (`hooks/useStorage.ts`):
- `useStoragePools`, `useStoragePool`, `usePoolMetrics`
- `useCreateStoragePool`, `useDeleteStoragePool`
- `useVolumes`, `useVolume`
- `useCreateVolume`, `useDeleteVolume`, `useResizeVolume`
- `useAttachVolume`, `useDetachVolume`

---

## Previous Session

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
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐             │
│  ▼              ▼              ▼              ▼              │             │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐             │             │
│  │ Local  │  │  NFS   │  │  Ceph  │  │ iSCSI  │             │             │
│  │Backend │  │Backend │  │Backend │  │Backend │             │             │
│  │qemu-img│  │mount+  │  │rbd CLI │  │iscsiadm│             │             │
│  │        │  │qemu-img│  │        │  │+ LVM   │             │             │
│  └────────┘  └────────┘  └────────┘  └────────┘             │             │
│       │           │           │           │                  │             │
│       ▼           ▼           ▼           ▼                  │             │
│   file://     file://     rbd://    /dev/vg/lv              │             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Files Changed This Session

| File | Changes |
|------|---------|
| `agent/limiquantix-hypervisor/src/storage/iscsi.rs` | **NEW** - IscsiBackend implementation |
| `agent/limiquantix-hypervisor/src/storage/mod.rs` | Added iSCSI import and registration |
| `agent/limiquantix-hypervisor/src/lib.rs` | Export IscsiBackend |
| `frontend/src/pages/StoragePools.tsx` | Updated with API integration |
| `frontend/src/pages/Volumes.tsx` | Updated with API integration |
| `frontend/src/hooks/useStorage.ts` | **NEW** - Storage API hooks |
| `frontend/src/components/storage/CreatePoolDialog.tsx` | **NEW** - Pool creation wizard |
| `frontend/src/components/storage/CreateVolumeDialog.tsx` | **NEW** - Volume creation wizard |
| `frontend/src/components/storage/index.ts` | **NEW** - Component exports |
| `docs/000046-storage-backend-implementation.md` | Updated with iSCSI & Frontend sections |

---

## Next Steps

### Priority 1: Node Daemon Storage Handler
- [ ] Implement gRPC handlers in Rust node daemon
- [ ] Wire StorageManager to gRPC service

### Priority 2: Testing
- [ ] Ceph single-node container tests
- [ ] Integration tests with real NFS server
- [ ] iSCSI targetcli tests

### Priority 3: VM Disk Management
- [ ] Add disks tab to VM details page
- [ ] Hot-attach/detach volumes
- [ ] Boot order configuration

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
