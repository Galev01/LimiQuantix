# 000013 - Storage Pools Page Documentation

**Created**: 2026-01-01  
**Route**: `/storage/pools`  
**Status**: Implemented

---

## Overview

The Storage Pools page displays all storage pools in the cluster with capacity metrics, usage statistics, and status indicators. Supports Ceph RBD, Local LVM, and NFS pool types.

---

## Features

### 1. Page Header
- **Title**: "Storage Pools"
- **Subtitle**: "Manage your storage infrastructure"
- **Actions**:
  - Refresh button (secondary)
  - Create Pool button (primary)

### 2. Summary Cards (4-column grid)

| Card | Icon | Color | Content |
|------|------|-------|---------|
| Total Pools | Database | Blue (accent) | Pool count |
| Total Capacity | HardDrive | Green (success) | Aggregate capacity |
| Used Capacity | BarChart3 | Yellow (warning) | Used bytes + % of total |
| Available | Server | Blue (info) | Remaining capacity |

### 3. Status Tabs
```
[All (2)] [Ready (2)] [Degraded (0)] [Error (0)]
```

### 4. Search
- Filter pools by name
- Placeholder: "Search pools..."

### 5. Pool Cards (Grid Layout)

Each card displays:
- **Header**: Pool icon, name, type label (Ceph RBD / Local LVM / NFS)
- **Status Badge**: Ready (green), Degraded (yellow), Error (red)
- **Usage Bar**: Animated progress with color coding
- **Stats**: Total, Used, Available in 3-column layout
- **Hover**: More options button appears

Card layout:
```
┌─────────────────────────────────────────┐
│ 💾 ceph-ssd-pool          ✓ Ready  •••  │
│    Ceph RBD                             │
├─────────────────────────────────────────┤
│ Usage                             40%   │
│ ████████████░░░░░░░░░░░░░░░░░░░░        │
├─────────────────────────────────────────┤
│ Total      │ Used       │ Available     │
│ 97.66 TB   │ 39.06 TB   │ 58.59 TB      │
└─────────────────────────────────────────┘
```

---

## Pool Types

| Type | Label | Description |
|------|-------|-------------|
| CEPH_RBD | Ceph RBD | Distributed block storage |
| LOCAL_LVM | Local LVM | Local LVM volumes |
| NFS | NFS | Network file system |

---

## Status Configuration

| Phase | Label | Variant | Icon |
|-------|-------|---------|------|
| READY | Ready | success | CheckCircle |
| DEGRADED | Degraded | warning | AlertTriangle |
| ERROR | Error | error | XCircle |

---

## Component Location

```
frontend/src/pages/StoragePools.tsx
```

---

## Props & State

```typescript
// Local State
const [searchQuery, setSearchQuery] = useState('');
const [activeTab, setActiveTab] = useState<FilterTab>('all');

// Derived
const filteredPools = mockStoragePools.filter(/* search + tab filter */);
const poolCounts = { all, ready, degraded, error };
const totalCapacity = pools.reduce((sum, p) => sum + p.capacity.totalBytes, 0);
const usedCapacity = pools.reduce((sum, p) => sum + p.capacity.usedBytes, 0);
```

---

## Helper Components

### PoolCard
Props:
- `pool: StoragePool` - Pool data
- `index: number` - For animation delay

Features:
- Animated entrance (staggered y offset)
- Hover state with shadow elevation
- Animated usage bar
- Color-coded usage percentage

---

## Styling

- Summary cards: `bg-bg-surface rounded-xl border shadow-floating`
- Pool cards: Same styling with hover effect
- Usage bar: `h-2 bg-bg-base rounded-full`
- Progress: Animated width, color by usage level
- Grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`

---

## Animations

- **Summary cards**: Staggered fade in with y offset (0.1s delay between cards)
- **Pool cards**: Staggered entrance (0.3s base + 0.05s per card)
- **Usage bars**: Width animation on mount

---

## Empty State

When no pools match filters:
- Database icon
- "No Storage Pools Found" title
- Contextual message
- Create Pool button

---

## Dependencies

- `react-router-dom`: Navigation
- `framer-motion`: Animations
- `lucide-react`: Icons
- `@/components/ui/Button`: Action buttons
- `@/components/ui/Badge`: Status badges
- `@/data/mock-data`: Storage pool data

---

## Related Pages

- Volumes: `/storage/volumes` - Volumes in pools
- VM Detail: `/vms/:id` - Disk configuration

---

## Future Enhancements

1. Pool detail page
2. Create pool wizard
3. Pool resize/expand
4. IOPS/throughput metrics
5. Snapshot policies
6. Replication configuration
7. Tiered storage management

