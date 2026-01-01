# 000015 - VM Creation Wizard Documentation

**Created**: 2026-01-01  
**Component**: `/frontend/src/components/vm/VMCreationWizard.tsx`  
**Status**: Implemented

---

## Overview

The VM Creation Wizard is a comprehensive multi-step modal for creating new virtual machines. It guides users through 9 steps to configure all aspects of a VM before creation.

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
- **Install LimiQuantix Agent**: Toggle (recommended: on)
- **Customization Specification**: Select preset or create new
  - Linux Default
  - Windows Default
  - Ubuntu Server Hardened
  - Create New...
- **Guest Hostname**: Override default
- **Timezone**: Dropdown with common timezones

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

### Step 6: Boot Media (ISO)
- **ISO Selection**: Radio list of available ISOs
  - Ubuntu, Rocky Linux, Windows Server, etc.
  - Size indicator
- Option to skip (configure later)
- "Upload New ISO" link

### Step 7: Storage
- **Storage Pool Selection**: Cards with usage indicators
- **Virtual Disks**:
  - Add/remove disks
  - Size (GiB) input
  - Provisioning type (thin/thick)
  - Total disk space calculator

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

## Mock Data

The wizard uses mock data for:
- **Clusters**: Production, Development, GPU
- **Folders**: Root, Production, Development, Testing, etc.
- **Networks**: Management, Production VLAN 100, Development VLAN 200, Storage
- **ISOs**: Ubuntu, Rocky Linux, Windows Server, Debian
- **Custom Specs**: Linux/Windows defaults
- **Storage Pools**: From `mockStoragePools`

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

## Future Enhancements

1. Form validation with error messages
2. Integration with gRPC backend
3. Template-based quick creation
4. Clone from existing VM option
5. Import from OVF/OVA
6. Advanced CPU features (NUMA, CPU model)
7. GPU passthrough configuration
8. TPM and secure boot options
9. Custom provisioning scripts
10. Real-time cluster resource availability

