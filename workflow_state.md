# limiquantix Workflow State

## Current Status: Cloud-Init Frontend Integration Complete ✅

**Last Updated:** January 2, 2026 (Late Night Session)

---

## What's New (This Session)

### ✅ Backend: Cloud-Init Provisioning

Implemented full cloud-init support for automated VM provisioning:

1. **CloudInitConfig** struct with user-data, meta-data, network-config
2. **CloudInitGenerator** creates NoCloud ISO using `genisoimage`
3. **Auto-attaches** cloud-init ISO to VM as CD-ROM device
4. Proto updated with `CloudInitConfig` message

### ✅ Backend: Cloud Image Support

Added backing file support for copy-on-write cloud images:

1. **DiskSpec.backing_file** field in proto
2. **DiskConfig.backing_file** field in Rust types
3. **StorageManager** creates overlay disks with `qemu-img create -b`
4. Automatic resizing of overlay if larger than backing

### ✅ Frontend: VM Creation Wizard Cloud-Init UI

Added full cloud-init configuration to the VM wizard:

1. **Three provisioning methods:**
   - Cloud Image (Recommended) - Automated setup with cloud-init
   - ISO Image - Manual OS installation
   - None - Configure later

2. **Cloud Image Selection:**
   - Ubuntu 22.04/24.04 Cloud
   - Debian 12 Cloud
   - Rocky Linux 9 Cloud
   - AlmaLinux 9 Cloud

3. **Cloud-Init Configuration:**
   - Default username field
   - SSH public key management (add/remove)
   - Advanced: Custom user-data editor

4. **Updated Review Step:**
   - Shows provisioning method
   - Displays cloud image name
   - Shows SSH key count
   - Indicates custom config if provided

---

## Files Changed (This Session)

### Backend (Rust)

| File | Change |
|------|--------|
| `agent/limiquantix-proto/proto/node_daemon.proto` | Added CloudInitConfig, backing_file |
| `agent/limiquantix-hypervisor/src/cloudinit.rs` | **NEW** - Cloud-init ISO generation |
| `agent/limiquantix-hypervisor/src/storage.rs` | Backing file support |
| `agent/limiquantix-hypervisor/src/types.rs` | Added backing_file field |
| `agent/limiquantix-hypervisor/src/lib.rs` | Export cloudinit module |
| `agent/limiquantix-hypervisor/Cargo.toml` | Added tempfile dependency |
| `agent/limiquantix-node/src/service.rs` | Cloud-init integration |

### Frontend (React)

| File | Change |
|------|--------|
| `frontend/src/components/vm/VMCreationWizard.tsx` | Cloud image selector, SSH key input, cloud-init config |
| `frontend/src/lib/api-client.ts` | Added cloudInit and backingFile to ApiVM |

### Documentation

| File | Change |
|------|--------|
| `docs/000039-cloud-init-provisioning.md` | **NEW** - Full documentation |

---

## Testing Instructions

### 1. Start Frontend

```bash
cd frontend
npm run dev
```

### 2. Create VM with Cloud-Init

1. Open VM Creation Wizard
2. Fill in basic info (name, etc.)
3. Select placement (host)
4. On **Boot Media** step:
   - Select "Cloud Image"
   - Choose "Ubuntu 22.04 LTS Cloud"
   - Enter username (e.g., "admin")
   - Paste your SSH public key
5. Complete remaining steps
6. Review and create

### 3. On Ubuntu Laptop

```bash
# Ensure cloud image is downloaded
wget -O /var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2 \
  https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img

# Run Node Daemon
cd ~/LimiQuantix/agent
cargo build --release --bin limiquantix-node --features libvirt
./target/release/limiquantix-node \
  --libvirt-uri qemu:///system \
  --listen 0.0.0.0:9090 \
  --control-plane http://<WINDOWS_IP>:8080 \
  --register
```

### 4. Verify VM Creation

```bash
# Check VM is defined in libvirt
virsh list --all

# Check disk overlay was created
ls -la /var/lib/limiquantix/images/<vm-id>/

# Check cloud-init ISO was created
ls -la /var/lib/limiquantix/images/<vm-id>/cloud-init.iso

# Start VM and SSH
virsh start <vm-id>
ssh admin@<VM_IP>
```

---

## UI Preview

### Boot Media Step (New)

```
┌─────────────────────────────────────────────────────────────┐
│                       Boot Media                             │
│         Choose how to provision your VM                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│   │    ☁️        │  │    💿        │  │    💾        │         │
│   │ Cloud Image │  │ ISO Image   │  │   None      │         │
│   │ Automated   │  │ Manual      │  │ Later       │         │
│   │ ✅ Recommended │  │            │  │             │         │
│   └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
│   Cloud Image:                                               │
│   ○ Ubuntu 22.04 LTS Cloud                670 MB            │
│   ● Ubuntu 24.04 LTS Cloud                720 MB            │
│   ○ Debian 12 Cloud                       350 MB            │
│   ○ Rocky Linux 9 Cloud                   1.1 GB            │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ 🖥️  Cloud-Init Configuration          [Auto-setup]  │   │
│   │                                                      │   │
│   │ Default User: [admin________________]                │   │
│   │                                                      │   │
│   │ SSH Public Keys:                                     │   │
│   │ ┌──────────────────────────────────────────────┐    │   │
│   │ │ 🔑 ssh-rsa AAAAB3NzaC1yc2E...       [🗑️]     │    │   │
│   │ └──────────────────────────────────────────────┘    │   │
│   │ [textarea for new key...                   ] [+]    │   │
│   │ ⚠️ Add at least one SSH key for secure access       │   │
│   │                                                      │   │
│   │ ▶ Advanced: Custom cloud-config                     │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Known Limitations

1. **Cloud images are static** - Currently hardcoded in frontend. Need API to list available cloud images.
2. **No image upload UI** - Must manually place cloud images on hypervisor.
3. **ISO paths are placeholders** - Need real ISO storage API.

---

## Next Steps

| Task | Priority | Effort |
|------|----------|--------|
| VNC WebSocket proxy | P0 | 2-3 days |
| Cloud image library API | P1 | 1 week |
| Guest Agent (basic) | P0 | 3-4 weeks |
| Windows Sysprep support | P2 | 1 week |

---

## Quick Reference

### Cloud Image Paths (Expected on Hypervisor)

```
/var/lib/limiquantix/cloud-images/
├── ubuntu-22.04.qcow2
├── ubuntu-24.04.qcow2
├── debian-12.qcow2
├── rocky-9.qcow2
└── almalinux-9.qcow2
```

### Download Commands

```bash
# Ubuntu 22.04
wget -O /var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2 \
  https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img

# Ubuntu 24.04
wget -O /var/lib/limiquantix/cloud-images/ubuntu-24.04.qcow2 \
  https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img

# Debian 12
wget -O /var/lib/limiquantix/cloud-images/debian-12.qcow2 \
  https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2

# Rocky Linux 9
wget -O /var/lib/limiquantix/cloud-images/rocky-9.qcow2 \
  https://dl.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud.latest.x86_64.qcow2
```
