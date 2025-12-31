# 000011 - Hosts List Page Documentation

**Created**: 2026-01-01  
**Route**: `/hosts`  
**Status**: Implemented

---

## Overview

The Hosts List page displays all physical hypervisor nodes in the cluster with their status, resource allocation, and VM counts. It supports both grid (card) and table view modes.

---

## Features

### 1. Page Header
- **Title**: "Hosts"
- **Subtitle**: "Physical hypervisor nodes in your cluster"
- **Actions**:
  - Add Host button (primary)

### 2. Status Tabs
Filter hosts by status:
```
[All (4)] [Ready (4)] [Not Ready (0)] [Maintenance (0)]
```

### 3. Search and View Toggle
- **Search**: Filter by hostname or IP
- **View Toggle**: Grid/Table view switch buttons
- **Refresh**: Manual refresh button

### 4. View Modes

#### Grid View (Default)
Cards arranged in responsive grid (1-4 columns based on viewport).

Each card shows:
- Host icon + hostname
- Status badge (Ready/Not Ready/Maintenance/Draining)
- Management IP
- CPU progress bar with allocation stats
- Memory progress bar with allocation stats
- Footer: VM count, rack, zone labels

#### Table View
Columns:
| Column | Description |
|--------|-------------|
| Hostname | Name + rack label |
| Status | Phase badge with icon |
| IP Address | Management IP (monospace) |
| CPU | Progress bar + core allocation |
| Memory | Progress bar + bytes allocated |
| VMs | VM count |

### 5. Host Card Component

```
┌─────────────────────────────────────────┐
│ 🖥️ hv-rack1-01                   READY │
│ 192.168.1.11                            │
├─────────────────────────────────────────┤
│ CPU  ████████░░░░  32%  16/64 cores     │
│ MEM  ██████████░░  45%  230/512 GB      │
├─────────────────────────────────────────┤
│ VMs: 2  │  rack: rack-1  │  zone: us-1a │
└─────────────────────────────────────────┘
```

### 6. Status Indicators

| Phase | Color | Icon |
|-------|-------|------|
| READY | Green | CheckCircle |
| NOT_READY | Red | AlertCircle |
| MAINTENANCE | Yellow | Wrench |
| DRAINING | Blue | Settings |

### 7. Empty State
When no hosts match filters:
- Server icon
- "No Hosts Found" title
- Add Host button

---

## Component Location

```
frontend/src/pages/HostList.tsx
```

---

## Props & State

```typescript
// Local State
const [searchQuery, setSearchQuery] = useState('');
const [activeTab, setActiveTab] = useState<FilterTab>('all');
const [viewMode, setViewMode] = useState<ViewMode>('grid');

// Derived
const filteredHosts = mockNodes.filter(/* search + tab filter */);
const hostCounts = { all, ready, not_ready, maintenance };
```

---

## Helper Components

### HostCard
Props:
- `node: Node` - Host data
- `index: number` - For animation delay
- `onClick: () => void` - Navigation handler

Features:
- Animated entrance (staggered)
- Hover state with shadow elevation
- Color-coded resource bars
- Click navigates to host detail

---

## Styling

- Grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`
- Cards: `bg-bg-surface rounded-xl border shadow-floating`
- Progress bars: Color changes at 60% (yellow) and 80% (red)
- Active status tab: `bg-bg-elevated shadow-elevated`

---

## Animations

- **Page header**: Fade in from top
- **Host cards**: Staggered fade in with y offset
- **Table rows**: Staggered fade in with x offset
- **View toggle**: Smooth transition between modes

---

## Dependencies

- `react-router-dom`: Navigation
- `framer-motion`: Animations
- `lucide-react`: Icons
- `@/components/ui/Button`: Action buttons
- `@/components/ui/Badge`: Status badges
- `@/data/mock-data`: Node data

---

## Related Pages

- Host Detail: `/hosts/:id` - Linked from card/row click (future)
- Dashboard: `/` - Summary view

---

## Future Enhancements

1. Host detail page implementation
2. Add host wizard
3. Enter maintenance mode action
4. Drain VMs action
5. Resource pool assignment
6. Host health metrics
7. Hardware inventory view
8. Network topology view

