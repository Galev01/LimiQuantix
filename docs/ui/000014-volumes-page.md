# 000014 - Volumes Page Documentation

**Created**: 2026-01-01  
**Route**: `/storage/volumes`  
**Status**: Implemented

---

## Overview

The Volumes page displays all storage volumes across pools with their status, size, attached VMs, and provisioning type. Supports volume lifecycle management including attach, detach, expand, and clone operations.

---

## Features

### 1. Page Header
- **Title**: "Volumes"
- **Subtitle**: "{count} volumes · {total size} total"
- **Actions**:
  - Refresh button (secondary)
  - Create Volume button (primary)

### 2. Status Tabs
```
[All (6)] [In Use (4)] [Available (1)] [Creating (1)]
```

### 3. Search and Filters
- **Search**: Filter by volume name, pool name, or attached VM name
- **Filters**: Additional filter button (expandable)

### 4. Volume Table

| Column | Description |
|--------|-------------|
| Name | Volume name + ID (monospace) |
| Status | Badge (Available, In Use, Creating, Error) |
| Size | Formatted bytes |
| Pool | Storage pool name |
| Attached To | VM link (clickable) or dash |
| Type | Provisioning (thin/thick) |
| Actions | Context-sensitive buttons |

### 5. Row Actions

Actions vary by volume status:

| Status | Available Actions |
|--------|-------------------|
| AVAILABLE | Attach, Expand, Clone, More |
| IN_USE | Detach, Expand, Clone, More |
| CREATING | Expand, Clone, More |
| ERROR | More |

Action icons:
- Attach: Link icon
- Detach: Unlink icon
- Expand: Expand icon
- Clone: Copy icon
- More: MoreHorizontal icon

---

## Volume Status Configuration

| Status | Label | Variant | Icon |
|--------|-------|---------|------|
| AVAILABLE | Available | success | CheckCircle |
| IN_USE | In Use | info | Link |
| CREATING | Creating | warning | Clock |
| ERROR | Error | error | AlertCircle |

---

## Provisioning Types

| Type | Badge Color | Description |
|------|-------------|-------------|
| thin | Blue (info) | Thin provisioned |
| thick | Yellow (warning) | Thick provisioned |

---

## Component Location

```
frontend/src/pages/Volumes.tsx
```

---

## Props & State

```typescript
// Local State
const [searchQuery, setSearchQuery] = useState('');
const [activeTab, setActiveTab] = useState<FilterTab>('all');

// Derived
const filteredVolumes = mockVolumes.filter(/* search + tab filter */);
const volumeCounts = { all, in_use, available, creating };
const totalSize = volumes.reduce((sum, v) => sum + v.sizeBytes, 0);
```

---

## Mock Data Structure

```typescript
interface Volume {
  id: string;
  name: string;
  sizeBytes: number;
  poolId: string;
  poolName: string;
  status: VolumeStatus;
  attachedVmId?: string;
  attachedVmName?: string;
  provisioning: 'thin' | 'thick';
  createdAt: string;
}
```

---

## Styling

- Table container: `bg-bg-surface rounded-xl border shadow-floating`
- Table header: `bg-bg-elevated/50`
- Row hover: `hover:bg-bg-hover`
- Actions: Opacity transition on hover
- Volume icon: Transitions to accent color on hover

---

## Animations

- **Table rows**: Staggered fade in with x offset (0.03s delay per row)
- **Actions**: Opacity fade on row hover

---

## Interactions

- **Row click**: Future: Navigate to volume detail
- **VM link click**: Navigate to attached VM detail
- **Action buttons**: Prevent row click propagation

---

## Empty State

When no volumes match filters:
- HardDrive icon
- "No Volumes Found" title
- Contextual message
- Create Volume button

---

## Dependencies

- `react-router-dom`: Navigation
- `framer-motion`: Animations
- `lucide-react`: Icons
- `@/components/ui/Button`: Action buttons
- `@/components/ui/Badge`: Status badges

---

## Related Pages

- Storage Pools: `/storage/pools` - Pool management
- VM Detail: `/vms/:id` - Disk attachment

---

## Future Enhancements

1. Volume detail page
2. Create volume wizard
3. Volume resize modal
4. Snapshot management
5. Clone wizard
6. QoS configuration
7. Encryption settings
8. Bulk operations

