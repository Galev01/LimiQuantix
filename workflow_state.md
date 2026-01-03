# LimiQuantix Workflow State

## Current Status: Image Library & VM Access Configuration ✅

**Last Updated:** January 3, 2026

---

## What's New (This Session)

### ✅ Image Library & ISO Upload

Implemented a complete ISO/Image management system:

| Component | File | Description |
|-----------|------|-------------|
| **ImageLibrary** | `pages/ImageLibrary.tsx` | Page to manage cloud images and ISOs |
| **ISOUploadDialog** | `components/storage/ISOUploadDialog.tsx` | Multi-step wizard for ISO upload |
| **useISOs** | `hooks/useImages.ts` | Hook to fetch ISOs with catalog fallback |
| **ISO_CATALOG** | `hooks/useImages.ts` | Built-in ISO entries for fallback |
| **useCreateImage** | `hooks/useImages.ts` | Hook to create image records |

#### Features

1. **Image Library Page** (`/storage/images`)
   - Tabs for Cloud Images and ISOs
   - Search and filter by status
   - Download images from catalog
   - Delete images

2. **ISO Upload Dialog**
   - Upload from URL (downloads to storage)
   - Upload from file (drag-and-drop)
   - OS family/distribution/version selection
   - Storage pool selection
   - Progress tracking

3. **VMCreationWizard Integration**
   - ISO selection uses API data with catalog fallback
   - Warning when using built-in catalog
   - Link to Image Library for uploading new ISOs

---

### ✅ VM Access Configuration (Password + SSH Keys)

Enhanced the VM Creation Wizard with proper authentication setup:

| Feature | Description |
|---------|-------------|
| **Password Section** | Password + confirm with validation |
| **PasswordInput** | Component with show/hide toggle |
| **SSH Key Validation** | Format, length, duplicate detection |
| **Access Summary** | Shows configured methods |
| **Step Validation** | Requires password OR SSH key for cloud images |

#### Cloud-Init Password Fix

Fixed password authentication in cloud-init using the correct approach:

```yaml
# Enable SSH password authentication
ssh_pwauth: true

# Set password using chpasswd module
chpasswd:
  expire: false
  list:
    - ubuntu:mypassword
```

This uses the `chpasswd` module which sets passwords after user creation, instead of the deprecated `passwd` field.

#### SSH Key Improvements

- Validates SSH key format (ssh-rsa, ssh-ed25519, etc.)
- Checks key length (must be > 100 chars)
- Detects duplicate keys
- Shows key type and comment in list
- Clear error messages for invalid keys

---

### 🔄 QuantumNet - OVN/OVS Integration (Started)

Implementing the networking subsystem to replace VMware vDS/NSX-T with OVN (Open Virtual Network) + OVS (Open vSwitch).

| Component | Status | Description |
|-----------|--------|-------------|
| **ADR-009** | ✅ Done | QuantumNet architecture design document |
| **Go OVN Client** | ✅ Done | `internal/network/ovn/client.go` with libovsdb-like API |
| **OVN Models** | ✅ Done | LogicalSwitch, LogicalSwitchPort, ACL, NAT, etc. |
| **NetworkService** | ✅ Done | Updated with OVN backend integration |
| **Node Daemon Proto** | ✅ Done | Added network port RPCs to node_daemon.proto |
| **Rust OVS Port Manager** | ✅ Done | `network/ovs.rs` for VM TAP→br-int binding |
| **Libvirt OVS XML** | ✅ Done | Updated xml.rs to generate OVS virtualport interface |

#### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Control Plane (Go)                                 │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────┐│
│  │ NetworkService  │────▶│ OVN Northbound  │────▶│   OVN NB Database       ││
│  │  - Create VNet  │     │    Client       │     │   (tcp://ovn:6641)      ││
│  │  - Create Port  │     │   (libovsdb)    │     │   - Logical Switches    ││
│  │  - Security     │     │                 │     │   - Logical Routers     ││
│  └─────────────────┘     └─────────────────┘     └─────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                    │                                           
                                    ▼ (OVN translates to OpenFlow)               
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Hypervisor Node                                     │
│  ┌────────────────────────┐  ┌────────────────────────┐                     │
│  │  OVN Controller        │  │  Node Daemon (Rust)    │                     │
│  │  - Sync from SB DB     │  │  - OVS Port Manager    │                     │
│  │  - Program OVS flows   │  │  - Bind VM TAP→br-int  │                     │
│  └────────────────────────┘  └────────────────────────┘                     │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │  Open vSwitch (br-int)                                                   ││
│  │    VM1 (TAP) ──────────────────────────────── VM2 (TAP)                 ││
│  │         (Geneve Tunnel to other nodes)                                   ││
│  └──────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Files Created/Modified

| File | Changes |
|------|---------|
| `docs/adr/000009-quantumnet-architecture.md` | **NEW** - Network architecture ADR |
| `backend/internal/network/ovn/client.go` | **NEW** - OVN Northbound client |
| `backend/internal/network/ovn/models.go` | **NEW** - OVN database models |
| `backend/internal/services/network/network_service.go` | Updated with OVN integration |
| `proto/limiquantix/node/v1/node_daemon.proto` | Added network port RPCs |
| `agent/limiquantix-hypervisor/src/network/mod.rs` | **NEW** - Network module |
| `agent/limiquantix-hypervisor/src/network/ovs.rs` | **NEW** - OVS port manager |
| `agent/limiquantix-hypervisor/src/network/types.rs` | **NEW** - Network types |
| `agent/limiquantix-hypervisor/src/lib.rs` | Export network module |
| `agent/limiquantix-hypervisor/src/types.rs` | Added OVN fields to NicConfig |
| `agent/limiquantix-hypervisor/src/xml.rs` | OVS virtualport XML generation |
| `project_plan.md` | Updated with QuantumNet status |
| `project-status-analysis.md` | Updated with networking progress |

#### Network Types Supported

| Type | VMware Equivalent | Implementation |
|------|-------------------|----------------|
| **Overlay** | NSX Segments | OVN Logical Switch + Geneve |
| **VLAN** | Port Groups | OVN Logical Switch + localnet port |
| **External** | Uplink Port Group | Provider network with SNAT |
| **Isolated** | Private Network | No router attachment |

#### Libvirt Interface XML (OVS/OVN)

When a NIC has `ovn_port_name` set, libvirt XML is generated as:

```xml
<interface type='bridge'>
  <source bridge='br-int'/>
  <virtualport type='openvswitch'>
    <parameters interfaceid='lsp-port-123'/>
  </virtualport>
  <mac address='fa:16:3e:aa:bb:cc'/>
  <model type='virtio'/>
</interface>
```

The `interfaceid` maps to the OVN logical switch port, enabling OVN controller to apply correct flows.

---

## Next Steps

### Immediate (This Week)
- [ ] Regenerate proto code (`make proto`)
- [ ] Implement Node Daemon network RPC handlers
- [ ] Add OVN central setup documentation
- [ ] Integration testing with OVS/OVN

### Coming Soon
- [ ] Security group → OVN ACL translation
- [ ] DHCP via OVN built-in
- [ ] Floating IPs (NAT)
- [ ] Magic DNS (CoreDNS + OVN state)

### Future
- [ ] WireGuard Bastion for direct overlay access
- [ ] BGP ToR integration for enterprise

---

## Previous Sessions

### ✅ Cloud-Init User/Password UX Improvement (Jan 3, 2026)
- Password field with confirmation
- SSH password auth enabled
- Fixed chpasswd module usage
- **CRITICAL FIX**: Frontend was sending `spec.cloudInit` but proto expects `spec.provisioning.cloudInit`
  - Updated `api-client.ts` to use correct nested structure
  - Updated `VMCreationWizard.tsx` to send `spec.provisioning.cloudInit`
  - Added debug logging to node daemon and cloudinit.rs
  - Created `scripts/debug-cloudinit.sh` for ISO inspection

### ✅ ISO Upload & Image Library (Jan 3, 2026)
- ISOUploadDialog component
- ImageLibrary page
- OS detection and catalog fallback

### ✅ Quantix Agent Integration (Jan 3, 2026)
- Cloud-init auto-install script
- Feature checkbox in VM wizard
- Review step enhancements

### ✅ VM Actions Dropdown (Jan 3, 2026)
- DropdownMenu component
- Edit Settings/Resources modals
- Run Script, Clone, Delete actions

### ✅ Storage Backend Complete (Jan 3, 2026)
- Local, NFS, Ceph RBD, iSCSI backends
- LVM thin provisioning
- Frontend storage UI

---

## Commands Reference

```bash
# Backend
cd backend && go run ./cmd/controlplane --dev

# Frontend
cd frontend && npm run dev

# Node Daemon (on Ubuntu with OVS)
cd agent && cargo run --release --bin limiquantix-node --features libvirt

# Proto regeneration
cd proto && buf generate

# Check hypervisor crate
cd agent && cargo check -p limiquantix-hypervisor

# OVN/OVS commands (on hypervisor node)
ovs-vsctl show
ovn-nbctl show
ovn-sbctl show
```

---

## Documentation

| Doc | Purpose |
|-----|---------|
| `docs/adr/000009-quantumnet-architecture.md` | **NEW** - Network Architecture |
| `docs/000048-network-backend-ovn-ovs.md` | OVN/OVS Integration Guide |
| `docs/adr/000004-network-model-design.md` | Network Model ADR |
| `docs/000046-storage-backend-implementation.md` | Storage Backend |
| `docs/000045-guest-agent-integration-complete.md` | Guest Agent |
| `docs/000042-console-access-implementation.md` | Web Console + QVMRC |
