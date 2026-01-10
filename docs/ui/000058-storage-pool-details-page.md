# Storage Pool Details Page

**Document ID:** 000058  
**Date:** January 11, 2026  
**Scope:** Frontend UI - Storage Pool Detail View

## Overview

The Storage Pool Details page (`/storage/pools/:id`) provides a comprehensive view of a single storage pool, allowing administrators to:

1. View pool status, capacity, and health information
2. Browse files within the pool
3. Manage which hosts have access to the pool
4. View configuration settings

## Page Structure

### URL Pattern
```
/storage/pools/{pool_id}
```

### Navigation
- From Storage Pools list → Click on any pool card
- Breadcrumb: Storage → Pools → {Pool Name}

## Components

### Header Section

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back    [Pool Icon]  Pool Name                               │
│                         NFS • Ready ✓                           │
│                                          [Refresh] [Delete]     │
└─────────────────────────────────────────────────────────────────┘
```

**Elements:**
- Back button → Returns to `/storage/pools`
- Pool type icon (NFS, Ceph, Local, iSCSI)
- Pool name (h1)
- Type badge + Status badge
- Action buttons (Refresh, Reconnect if error, Delete)

### Error Banner (Conditional)

Displayed when `pool.status.phase === 'ERROR'` or `pool.status.errorMessage` exists:

```
┌─────────────────────────────────────────────────────────────────┐
│  ⊗ Error                                                        │
│  No connected nodes available to initialize pool...            │
└─────────────────────────────────────────────────────────────────┘
```

### Stats Cards Row

Four cards showing key metrics:

| Card | Description |
|------|-------------|
| **Total Capacity** | Total storage space (e.g., "1.5 TB") |
| **Used** | Used space with percentage |
| **Available** | Free space (green text) |
| **Volumes** | Count of volumes in pool |

### Usage Bar

Visual progress bar showing storage utilization:
- Green: < 75%
- Yellow: 75-90%
- Red: > 90%

### Tab Navigation

Three tabs:

| Tab | Content |
|-----|---------|
| **Files** | File browser for pool contents |
| **Nodes** | Host assignment management |
| **Settings** | Pool configuration details |

## Tabs Detail

### Files Tab

Interactive file browser with:

1. **Breadcrumb navigation** - Shows current path (Root / folder1 / folder2)
2. **File list** - Sorted: directories first, then files alphabetically
3. **File metadata** - Size, modification date, type icon

**File Types Recognized:**
- `directory` → Folder icon (clickable)
- `qcow2`, `vmdk`, `vhd`, `raw`, `img` → Disk image icon
- `iso` → Archive icon
- `ova`, `ovf` → Archive/template icon
- Other → Generic file icon

**Actions:**
- Click directory → Navigate into
- Click ".." → Navigate up
- Refresh button → Reload current directory

### Nodes Tab

Manage which hypervisor nodes have access to this pool:

```
┌─────────────────────────────────────────────────────────────────┐
│  Assigned Nodes                         2 of 5 nodes assigned  │
├─────────────────────────────────────────────────────────────────┤
│  [●] node-01.dc1.example.com                                    │
│      192.168.1.10                                   [Unassign]  │
├─────────────────────────────────────────────────────────────────┤
│  [○] node-02.dc1.example.com                                    │
│      192.168.1.11                                    [Assign]   │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Green icon for assigned nodes
- Gray icon for unassigned nodes
- One-click assign/unassign buttons
- Real-time updates via React Query invalidation

**Important Note:**
> VMs can only be created on nodes that have access to the storage pool they will use.

### Settings Tab

Read-only view of pool configuration:

| Field | Example |
|-------|---------|
| Pool ID | `pool-abc123` |
| Project ID | `default` |
| Type | NFS with icon |
| Created | 2026-01-11 10:30:00 |
| Description | Production NFS storage |
| Labels | `env: production`, `tier: fast` |

## Data Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   usePool   │────▶│   Backend   │────▶│  PostgreSQL │
│   Hook      │     │   Service   │     │  / In-mem   │
└─────────────┘     └─────────────┘     └─────────────┘
       │
       │  (for file listing)
       ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ usePoolFiles│────▶│   Backend   │────▶│ Node Daemon │
│   Hook      │     │ via gRPC    │     │  (Rust)     │
└─────────────┘     └─────────────┘     └─────────────┘
```

## React Hooks Used

```typescript
// Pool data
const { data: pool } = useStoragePool(id);

// File listing
const { data: files } = usePoolFiles(id, currentPath);

// All nodes for assignment UI
const { data: allNodes } = useNodes();

// Mutations
const assignToNode = useAssignPoolToNode();
const unassignFromNode = useUnassignPoolFromNode();
const reconnectPool = useReconnectStoragePool();
const deletePool = useDeleteStoragePool();
```

## Error States

| State | UI Behavior |
|-------|-------------|
| Pool not found | "Storage pool not found" message + Back button |
| Loading | Spinner centered |
| Files empty | "This folder is empty" message |
| No nodes | "No nodes available" message |
| API error | Error banner with message |

## Styling

Follows the Quantix design system:
- `bg-bg-surface` for cards
- `border-border` for separators
- `shadow-floating` for card elevation
- Motion animations for tab transitions
- Consistent color palette for status indicators

## Related Components

- `StoragePools.tsx` - Parent list page
- `CreatePoolDialog.tsx` - Pool creation wizard
- `useStorage.ts` - React Query hooks

## Future Enhancements

- [ ] File upload directly to pool
- [ ] File download
- [ ] File deletion (with confirmation)
- [ ] Create new folder
- [ ] Move/copy files
- [ ] Storage metrics/charts
