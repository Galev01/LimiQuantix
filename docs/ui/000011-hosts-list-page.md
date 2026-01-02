# 000011 - Hosts List Page Documentation

**Created**: 2026-01-01  
**Updated**: 2026-01-01  
**Route**: `/hosts`  
**Status**: Implemented

---

## Overview

The Hosts List page displays all physical hypervisor nodes in the cluster in a comprehensive table view with real-time resource usage, status indicators, and a native right-click context menu for quick actions.

---

## Features

### 1. Page Header
- **Title**: "Hosts"
- **Subtitle**: "Physical hypervisor nodes in your cluster"
- **Actions**:
  - Refresh button (secondary)
  - Add Host button (primary)

### 2. Status Tabs
Filter hosts by status:
```
[All (4)] [Ready (4)] [Not Ready (0)] [Maintenance (0)]
```

### 3. Search
- **Search**: Filter by hostname, IP address, rack, or zone
- Placeholder: "Search by hostname, IP, rack, zone..."

### 4. Table Columns

| Column | Description | Content |
|--------|-------------|---------|
| Hostname | Host FQDN + CPU model | `hv-rack1-01.limiquantix.local` + `AMD EPYC 7742` |
| Status | Phase badge with icon | Ready / Not Ready / Maintenance / Draining |
| IP Address | Management IP (monospace) | `192.168.1.11` |
| CPU Usage | Allocated/Total cores + % + progress bar | `20 / 64 cores` `31%` |
| Memory Usage | Allocated/Total GB + % + progress bar | `168 GB / 512 GB` `33%` |
| VMs | Count badge | `2` |
| Location | Rack + Zone | `Rack: rack-1` `Zone: us-east-1a` |

### 5. Right-Click Context Menu

Right-clicking on any host row opens a native-style context menu:

```
┌──────────────────────────────┐
│ hv-rack1-01.limiquantix.local│
│ 192.168.1.11                 │
├──────────────────────────────┤
│ 🖥️ Open Console              │
│ 📊 View Metrics              │
├──────────────────────────────┤
│ ↔️ Migrate VMs               │
│ 🔧 Enter Maintenance         │
│ ⏸️ Drain Host                │
├──────────────────────────────┤
│ ✏️ Edit Labels               │
│ ⚙️ Configure                 │
├──────────────────────────────┤
│ 🔄 Reboot        (warning)   │
│ 🗑️ Remove        (danger)    │
└──────────────────────────────┘
```

**Context Menu Actions:**
| Action | Description | Style |
|--------|-------------|-------|
| Open Console | SSH/BMC console | default |
| View Metrics | Jump to monitoring | default |
| Migrate VMs | Move all VMs to other hosts | default |
| Enter Maintenance | Put host in maintenance mode | default |
| Drain Host | Gracefully migrate VMs and disable | default |
| Edit Labels | Modify host labels | default |
| Configure | Host settings | default |
| Reboot | Restart host | warning |
| Remove from Cluster | Decommission host | danger |

### 6. Status Indicators

| Phase | Color | Icon | Badge Style |
|-------|-------|------|-------------|
| READY | Green | CheckCircle | `bg-success/10 text-success` |
| NOT_READY | Red | AlertCircle | `bg-error/10 text-error` |
| MAINTENANCE | Yellow | Wrench | `bg-warning/10 text-warning` |
| DRAINING | Blue | Settings | `bg-info/10 text-info` |

### 7. Resource Progress Bars

Progress bars are color-coded by utilization:
- **Green** (< 60%): Healthy
- **Yellow** (60-80%): Warning
- **Red** (> 80%): Critical

Bars animate on page load with staggered timing.

### 8. Empty State
When no hosts match filters:
- Server icon
- "No Hosts Found" title
- Contextual message
- Add Host button (if not searching)

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
const [contextMenu, setContextMenu] = useState<ContextMenuState>({
  visible: false,
  x: 0,
  y: 0,
  node: null,
});

// Derived
const filteredHosts = mockNodes.filter(/* search + tab filter */);
const hostCounts = { all, ready, not_ready, maintenance };
```

---

## Helper Components

### ContextMenuItem
Internal component for rendering menu items:
```typescript
function ContextMenuItem({
  icon: React.ReactNode,
  label: string,
  onClick: () => void,
  variant?: 'default' | 'warning' | 'danger'
})
```

---

## Styling

- Table container: `bg-bg-surface rounded-xl border shadow-floating`
- Table header: `bg-bg-elevated/50`
- Row hover: `hover:bg-bg-hover`
- Progress bars: `h-2 bg-bg-base rounded-full`
- VM count badge: `w-8 h-8 rounded-lg bg-accent/10 text-accent`
- Context menu: `bg-bg-surface border rounded-lg shadow-xl`

---

## Animations

- **Page header**: Fade in from top (`y: -10`)
- **Table rows**: Staggered fade in (`x: -10`, delay: `index * 0.03`)
- **Progress bars**: Animated width on mount
- **Context menu**: Scale + opacity transition

---

## Event Handling

- **Row click**: Navigate to host detail (`/hosts/:id`)
- **Right-click**: Open context menu at cursor position
- **Click outside menu**: Close context menu
- **Escape key**: Close context menu

---

## Dependencies

- `react-router-dom`: Navigation
- `framer-motion`: Animations
- `lucide-react`: Icons (15+ icons)
- `@/components/ui/Button`: Action buttons
- `@/data/mock-data`: Node data

---

## Related Pages

- Host Detail: `/hosts/:id` - Linked from row click (Phase 2)
- Dashboard: `/` - Summary view

---

## Future Enhancements

1. Host detail page with hardware inventory
2. Add host wizard
3. Real maintenance mode implementation
4. Live VM migration
5. BMC/IPMI integration
6. Network topology visualization
7. Bulk selection and actions
8. Column sorting and visibility toggle

