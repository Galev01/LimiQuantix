# 000015 - VM Creation Wizard Documentation

**Created**: 2026-01-01  
**Updated**: 2026-01-25  
**Component**: `/frontend/src/components/vm/VMCreationWizard.tsx`  
**Status**: Implemented with Real API Integration

---

## Overview

The VM Creation Wizard is a comprehensive multi-step modal for creating new virtual machines. It guides users through 9 steps to configure all aspects of a VM before creation.

**Key Feature:** The wizard fetches real data from the backend API for:
- **Nodes/Hosts:** Fetched via `useNodes()` hook from NodeService API
- **Networks:** Fetched via `useNetworks()` hook from VirtualNetworkService API
- **VM Creation:** Submitted via `useCreateVM()` mutation to VMService API

---

## Access Points

The wizard can be opened from:
1. **Header**: Click "New VM" button
2. **Sidebar**: Right-click on "Virtual Machines" → "Create Virtual Machine"
3. **VM List Page**: "New VM" button (future)

---

## Wizard Steps

### Step 1: Basic Information
- **VM Name** (required): User-friendly name
- **Description**: Optional purpose text
- **Owner**: Email/username of responsible person
- **Creation Schedule**: Immediate or scheduled (date + time picker)

### Step 2: Placement
- **Cluster Selection**: Choose target cluster
- **Host Placement**:
  - Automatic (recommended) - scheduler picks optimal host
  - Manual - user selects specific host with CPU/RAM usage indicators

### Step 3: Folder
- **Folder Selection**: Hierarchical folder picker
- Shows folder path (e.g., `/Production/Web Servers`)
- Option to create new folder

### Step 4: Customization
- **Install limiquantix Agent**: Toggle (recommended: on)
- **Customization Specification**: Select preset or create new
  - Linux Default
  - Windows Default
  - Ubuntu Server Hardened
  - Create New...
- **Guest Hostname**: Override default
- **Timezone**: Dropdown with common timezones
  - **Host Timezone**: Sync time from hypervisor via QEMU guest agent (new)
  - 50+ timezone options organized by region

### Step 5: Hardware
- **CPU Configuration**:
  - Cores per socket (slider 1-32)
  - Sockets (1, 2, 4)
  - Total vCPU display
- **Memory**:
  - Quick select buttons (2, 4, 8, 16 GB)
  - Custom MiB input
- **Network Adapters**:
  - Add/remove NICs
  - Network selection (QuantrixSwitch-based)
  - Connected toggle per NIC

### Step 6: Boot Media
- **Boot Media Type Selection**:
  - **Cloud Image**: Pre-configured OS images with cloud-init support
  - **ISO**: Traditional installation media
  - **OVA Template**: Import from OVA/OVF
  - **None**: Empty disk
- **Cloud Image Features** (when selected):
  - Image catalog with download status
  - Automatic cloud-init configuration
  - Access configuration (password and/or SSH keys)
  - Default user selection based on image OS
- **ISO Selection**: Radio list of available ISOs
  - Ubuntu, Rocky Linux, Windows Server, etc.
  - Size indicator
- Option to skip (configure later)
- "Upload New ISO" link

### Step 7: Storage
- **Storage Pool Selection**: Cards with usage indicators
  - Shows pool type (NFS, Ceph, Local, iSCSI)
  - Capacity and usage visualization
- **Virtual Disks**:
  - Add/remove disks
  - Size (GiB) input
  - Provisioning type (thin/thick)
  - Source type: New disk or existing volume
  - Total disk space calculator
- **Disk Naming**: Disks use UUIDs for proper file naming on storage
- **VM Folder Structure**: `{VM_NAME}_{UUID_SHORT}/` for human-readable organization

### Step 8: Additional Info (Optional)
- **Department**: Free text
- **Cost Center**: Free text
- **Tags**: Add/remove tag chips
- **Notes**: Multi-line text area

### Step 9: Review
- Summary of all configuration
- Organized sections:
  - Basic Information
  - Placement
  - Hardware
  - Storage
  - Boot & Customization
  - Additional Info (if provided)
- "Create VM" final action button

---

## Features

### Visual Progress Indicator
- 9-step progress bar with icons
- Completed steps show checkmark (green)
- Current step highlighted (blue)
- Clickable to navigate back

### Step Validation
| Step | Required Fields |
|------|-----------------|
| Basic Info | VM Name |
| Placement | Cluster + (Auto or Host) |
| Folder | Any folder selected |
| Customization | None (optional) |
| Hardware | CPU > 0, Memory ≥ 512 MiB |
| Boot Media | None (optional) |
| Storage | Pool + at least 1 disk |
| Additional | None (optional) |

### Animations
- Modal: Scale + fade in
- Step transitions: Slide left/right
- Progress bar: Line fill animation

### Keyboard Support
- Escape: Close wizard
- Focus management: Auto-focus first field

---

## State Management

```typescript
interface VMCreationData {
  // Basic
  name: string;
  description: string;
  owner: string;
  scheduleType: 'immediate' | 'scheduled';
  scheduledDate?: string;
  scheduledTime?: string;

  // Placement
  clusterId: string;
  hostId: string;
  autoPlacement: boolean;

  // Folder
  folderId: string;

  // Customization
  installAgent: boolean;
  customSpec: string;
  timezone: string;
  hostname: string;

  // Hardware
  cpuCores: number;
  cpuSockets: number;
  memoryMib: number;
  nics: NetworkInterface[];

  // Boot
  isoId: string;

  // Storage
  storagePoolId: string;
  disks: DiskConfig[];

  // Additional
  department: string;
  costCenter: string;
  notes: string;
  tags: string[];
}
```

---

## Styling

- Modal: `max-w-5xl max-h-[90vh]`
- Background: Blurred backdrop (`bg-black/60 backdrop-blur-sm`)
- Container: `bg-bg-surface rounded-2xl shadow-2xl`
- Form inputs: Custom `.form-input`, `.form-select`, `.form-checkbox`, `.form-radio` classes

---

## Form CSS Classes

Added to `index.css`:

```css
.form-input { /* Text input styling */ }
.form-select { /* Dropdown with custom arrow */ }
.form-checkbox { /* Checkbox with checkmark */ }
.form-radio { /* Radio with dot indicator */ }
input[type="range"] { /* Custom range slider */ }
```

---

## Integration

### Store (Zustand)

```typescript
// app-store.ts
vmWizardOpen: boolean;
openVmWizard: () => void;
closeVmWizard: () => void;
```

### Layout Integration

```tsx
// Layout.tsx
<VMCreationWizard
  isOpen={vmWizardOpen}
  onClose={closeVmWizard}
  onSubmit={handleVMSubmit}
/>
```

### Sidebar Context Menu

Right-click on "Virtual Machines" opens context menu with "Create Virtual Machine" option.

---

## Data Sources

### Real API Data (Live from Backend)

| Data Type | API Hook | Backend Service | Fallback |
|-----------|----------|-----------------|----------|
| **Nodes/Hosts** | `useNodes()` | `NodeService.ListNodes` | Shows "No hosts available" message |
| **Networks** | `useNetworks()` | `VirtualNetworkService.ListVirtualNetworks` | Default network placeholder |
| **VM Creation** | `useCreateVM()` | `VMService.CreateVM` | Error displayed in wizard |

### Static Data (No Backend API Yet)

| Data Type | Source | Notes |
|-----------|--------|-------|
| **Folders** | `staticFolders` | Hardcoded until folder service implemented |
| **ISOs** | `staticISOs` | Hardcoded until ISO library service implemented |
| **Custom Specs** | `staticCustomSpecs` | Hardcoded guest customization templates |
| **Storage Pools** | `mockStoragePools` | Uses mock data until StoragePoolService implemented |

### Clusters

Clusters are dynamically generated from available nodes. Currently all nodes are grouped into a "Default Cluster". Future enhancement: group nodes by labels.

---

## API Integration

### Loading States

The wizard shows loading indicators when fetching:
- A spinner with "Loading hosts..." on the Placement step
- Disabled network dropdown with "Loading networks..." on the Hardware step

### Error Handling

- **No hosts available:** Warning message with instructions to register a node daemon
- **API errors:** Error banner with retry button
- **VM creation failure:** Error message shown in footer

### Refresh Capability

Users can refresh the hosts list if the API call failed or if a new node was just registered.

---

## Dependencies

- `react`: State management
- `framer-motion`: Animations
- `lucide-react`: Icons (20+)
- `@/stores/app-store`: Global state
- `@/components/ui/Button`: Action buttons
- `@/components/ui/Badge`: Status indicators
- `@/data/mock-data`: Storage pool data

---

## Recent Fixes (2026-01-25)

### Cluster VM Count Fix
- Fixed cluster statistics to correctly count VMs from the VM repository
- Previously relied on `node.Status.VMIDs` which was not populated
- Now uses VM repository query as source of truth

### Timezone Configuration
- Added timezone to cloud-init user-data generation
- New "Host Timezone" option syncs time from hypervisor via QEMU guest agent
- Timezone is now properly applied to VMs during provisioning

### Cloud-Init Password/SSH Keys Fix
- Fixed cloud-init data flow from frontend to node daemon
- Node daemon now uses cloud-init config from control plane instead of generating defaults
- Password and SSH keys are now properly passed through the entire chain

### NFS Disk Path Structure
- Changed disk IDs from "Hard disk 1" to proper UUIDs
- VM folders now use `{VM_NAME}_{UUID_SHORT}` format for human-readable organization
- Disk files are named with UUIDs: `/mount_path/vms/{VM_NAME}_{UUID_SHORT}/{disk_uuid}.qcow2`

---

## Future Enhancements

1. ~~Integration with gRPC backend~~ ✅ **Implemented**
2. ~~Real-time cluster resource availability~~ ✅ **Implemented** (nodes show CPU/RAM usage)
3. ~~Cloud-init provisioning~~ ✅ **Implemented** (password, SSH keys, timezone)
4. ~~Timezone configuration~~ ✅ **Implemented** (including host sync option)
5. Form validation with inline error messages
6. Template-based quick creation
7. Clone from existing VM option
8. Import from OVF/OVA
9. Advanced CPU features (NUMA, CPU model)
10. GPU passthrough configuration
11. TPM and secure boot options
12. Custom provisioning scripts
13. ISO library service integration
14. Storage pool service integration
15. Folder/organization service integration

