# 000010 - VM Detail Page Documentation

**Created**: 2026-01-01  
**Route**: `/vms/:id`  
**Status**: Implemented

---

## Overview

The VM Detail page provides comprehensive information about a single virtual machine, including hardware configuration, resource usage, network settings, and management capabilities through a tabbed interface.

---

## Features

### 1. Breadcrumb Navigation
```
Virtual Machines / prod-web-01
```
- Clickable breadcrumb to return to VM list
- Back arrow button for quick navigation

### 2. VM Header
- **VM Name**: Large title with status badge
- **Description**: Subtitle text
- **Action Buttons**:
  - Start/Stop (contextual based on state)
  - Restart
  - Console
  - Snapshot
  - More (dropdown)

### 3. Tab Navigation

| Tab | Description |
|-----|-------------|
| Summary | General info, hardware, labels, resource gauges |
| Console | VNC/SPICE console viewer embed |
| Snapshots | Snapshot tree and management |
| Disks | Attached storage devices |
| Network | Network interfaces configuration |
| Monitoring | Performance charts over time |
| Events | Activity log |

---

## Tab Details

### Summary Tab

**Left Column (2/3 width):**

1. **General Information Card**
   - Name, Description, Project
   - Created date, Host, Guest OS
   - Hostname, Agent Version, Uptime
   - IP Addresses (monospace)

2. **Hardware Summary Card**
   - CPU: vCPUs, sockets
   - Memory: Size, usage %
   - Storage: Total GB, disk count
   - Network: NIC count, primary IP

3. **Labels Card**
   - Key-value label badges
   - Add Label button

**Right Column (1/3 width):**

1. **CPU Usage Card**
   - ProgressRing visualization
   - Color coded (green/yellow/red)
   - vCPU allocation text

2. **Memory Usage Card**
   - ProgressRing visualization
   - Used/Allocated bytes

3. **Quick Stats Card**
   - Disk IOPS
   - Network RX/TX
   - Uptime

### Console Tab

- Header bar with controls:
  - Send Ctrl+Alt+Del
  - Fullscreen
  - Connection status indicator
- Console viewport (16:9 aspect ratio)
- Placeholder for VNC/SPICE integration

### Snapshots Tab

- Create Snapshot button
- Snapshot tree/list (placeholder)
- Empty state when no snapshots

### Disks Tab

Table columns:
- Device (vda, vdb, etc.)
- Size (GB)
- Bus Type (VirtIO, SCSI)
- Pool
- Actions (Resize, Detach)

Add Disk button in header.

### Network Tab

Table columns:
- Device (eth0, eth1, etc.)
- Network
- MAC Address (monospace)
- IP Address (monospace)
- Actions (Edit, Remove)

Add NIC button in header.

### Monitoring Tab

- Time range selector (1h, 6h, 24h, 7d)
- 4 chart placeholders:
  - CPU Usage
  - Memory Usage
  - Disk I/O
  - Network I/O

### Events Tab

Event log table:
- Time
- Type (badge)
- Message
- User

---

## Component Location

```
frontend/src/pages/VMDetail.tsx
```

---

## Props & State

```typescript
// From URL
const { id } = useParams<{ id: string }>();

// Navigate
const navigate = useNavigate();

// VM data lookup
const vm = mockVMs.find((v) => v.id === id);
```

---

## Helper Components

Defined inline within the file:

1. **InfoRow**: Label-value pair display
2. **HardwareCard**: Icon + label + value + subvalue card
3. **StatRow**: Icon + label + value inline row

---

## Error Handling

If VM not found:
- Shows "VM Not Found" message
- "Back to VMs" button

---

## Styling

- Tab system using custom Tabs component
- Cards use `bg-bg-surface`, `rounded-xl`, `border border-border`
- Progress rings with dynamic colors
- Tables with hover states

---

## Animations

- Breadcrumb/header: Fade in from top
- Tab content: Fade in with y offset
- Tab indicator: Animated movement between tabs

---

## Dependencies

- `react-router-dom`: URL params, navigation
- `framer-motion`: Animations
- `lucide-react`: Icons (20+ icons used)
- `@/components/ui/Tabs`: Tab navigation
- `@/components/ui/Button`: Action buttons
- `@/components/ui/Badge`: Labels display
- `@/components/vm/VMStatusBadge`: Status indicator
- `@/components/dashboard/ProgressRing`: Resource gauges
- `@/data/mock-data`: VM data

---

## Related Pages

- VM List: `/vms` - Parent page
- Host Detail: `/hosts/:id` - Host info link (future)

---

## Future Enhancements

1. Real console integration (noVNC/SPICE-HTML5)
2. Snapshot tree visualization
3. Live metrics charts (Recharts/Victory)
4. Disk resize modal
5. NIC edit modal
6. Configuration edit forms
7. Real-time event streaming

