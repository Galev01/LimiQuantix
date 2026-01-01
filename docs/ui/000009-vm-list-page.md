# 000009 - VM List Page Documentation

**Created**: 2026-01-01  
**Route**: `/vms`  
**Status**: Implemented

---

## Overview

The VM List page provides a comprehensive view of all virtual machines in the cluster with filtering, searching, and bulk action capabilities.

---

## Features

### 1. Page Header
- **Title**: "Virtual Machines"
- **Subtitle**: "Manage your virtual machine inventory"
- **Actions**:
  - Export button (secondary)
  - New VM button (primary)

### 2. Status Tabs
Filter VMs by power state:
```
[All (6)] [Running (4)] [Stopped (1)] [Other (1)]
```

Each tab shows the count of VMs in that state. The active tab is highlighted with elevated styling.

### 3. Search and Filters
- **Search**: Real-time filtering by VM name, IP address, or OS
- **Filters**: Additional filter button (expandable)
- **Refresh**: Manual refresh button

### 4. Bulk Selection
When one or more VMs are selected:
- Shows selected count: "X VM(s) selected"
- Bulk action buttons appear:
  - Start (for stopped VMs)
  - Stop (for running VMs)
  - Delete (danger action)

### 5. VM Table

| Column | Description | Sortable |
|--------|-------------|----------|
| Checkbox | Selection for bulk actions | No |
| Name | VM name + OS type | Yes |
| Status | Power state badge | Yes |
| Host | Node hostname | Yes |
| CPU | Usage % with progress bar | Yes |
| Memory | Used bytes | Yes |
| IP Address | Primary IP (monospace) | Yes |
| Actions | Start/Stop + More menu | No |

### 6. Row Interactions
- **Hover**: Background changes, action buttons appear
- **Click**: Navigates to VM detail page (`/vms/:id`)
- **Checkbox click**: Selects VM without navigating

### 7. Empty State
When no VMs match filters:
- Icon (MonitorCog)
- Title: "No Virtual Machines"
- Contextual message
- Create VM button (if not searching)

---

## Component Location

```
frontend/src/pages/VMList.tsx
```

---

## Props & State

```typescript
// Local State
const [searchQuery, setSearchQuery] = useState('');
const [activeTab, setActiveTab] = useState<FilterTab>('all');
const [selectedVMs, setSelectedVMs] = useState<Set<string>>(new Set());

// Derived
const filteredVMs = mockVMs.filter(/* search + tab filter */);
const vmCounts = { all, running, stopped, other };
```

---

## Styling

- Uses `bg-bg-surface` for table container
- `shadow-floating` for card elevation
- `bg-bg-elevated/50` for table header
- Hover state: `hover:bg-bg-hover`
- Selected state: `bg-accent/5`
- Bulk action bar: `bg-accent/10` with `border-accent/30`

---

## Animations

- **Page header**: Fade in from top (`y: -10`)
- **Table rows**: Staggered fade in with slight x offset
- **Bulk action bar**: Height/opacity animation on appear

---

## Dependencies

- `react-router-dom`: Navigation
- `framer-motion`: Animations
- `lucide-react`: Icons
- `@/components/vm/VMStatusBadge`: Status badges
- `@/components/ui/Button`: Action buttons
- `@/data/mock-data`: VM data

---

## Related Pages

- VM Detail: `/vms/:id` - Linked from row click
- Dashboard: `/` - Summary view of VMs

---

## Future Enhancements

1. Server-side pagination
2. Column visibility toggle
3. Advanced filter panel
4. Saved filter presets
5. Keyboard navigation
6. Context menu on right-click

