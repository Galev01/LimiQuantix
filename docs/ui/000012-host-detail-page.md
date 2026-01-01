# 000012 - Host Detail Page Documentation

**Created**: 2026-01-01  
**Route**: `/hosts/:id`  
**Status**: Implemented

---

## Overview

The Host Detail page provides comprehensive information about a physical hypervisor node, including hardware specifications, running VMs, storage configuration, network interfaces, and system health monitoring.

---

## Features

### 1. Breadcrumb Navigation
```
Hosts / hv-rack1-01.limiquantix.local
```
- Clickable to return to hosts list
- Back arrow button for quick navigation

### 2. Host Header
- **Host Icon**: Server icon in rounded container
- **Hostname**: Large title (e.g., `hv-rack1-01.limiquantix.local`)
- **Status Badge**: Ready (green), Not Ready (red), Maintenance (yellow), Draining (blue)
- **Management IP**: Monospace font

### 3. Action Buttons
- **Migrate VMs**: Move VMs to other hosts
- **Maintenance**: Enter maintenance mode
- **Reboot**: Restart host
- **Settings**: Configuration (gear icon)

### 4. Tab Navigation

| Tab | Description |
|-----|-------------|
| Summary | General info, hardware summary, labels, resource gauges |
| Virtual Machines | List of VMs running on this host |
| Hardware | Detailed CPU, memory, storage, network info |
| Storage | Ceph OSD status, local volumes |
| Network | OVS bridges, bond interfaces |
| Monitoring | Performance charts (placeholder) |
| Events | Activity log |

---

## Tab Details

### Summary Tab

**Left Column (2/3 width):**

1. **General Information Card**
   - Hostname, Management IP
   - Rack, Zone
   - Status, VMs Running count

2. **Hardware Summary Card** (4-column grid)
   - CPU: Model, cores/threads
   - Memory: Total, allocatable
   - Storage: Capacity, disk count
   - Network: Speed, NIC count

3. **Labels Card**
   - Key-value label badges
   - Add Label button

**Right Column (1/3 width):**

1. **CPU Allocation Card**
   - ProgressRing (31% allocated)
   - Core count text

2. **Memory Allocation Card**
   - ProgressRing with usage
   - Allocated/total bytes

3. **System Health Card**
   - CPU Temperature
   - Fan Speed
   - Power Draw
   - Uptime

### Virtual Machines Tab

- Table of VMs on this host
- Columns: Name, Status, CPU, Memory, IP Address, Actions
- Create VM button
- Click to navigate to VM detail
- Migrate button per VM

### Hardware Tab

4 information cards in 2x2 grid:

1. **Processor**: Model, cores, threads, sockets, architecture, virtualization
2. **Memory**: Total, allocatable, type, channels, DIMMs, ECC
3. **Local Storage**: List of NVMe drives with model and size
4. **Network Interfaces**: NICs with IP, speed, and type

### Storage Tab

- **Ceph OSD Status**: List of OSDs with up/down status
- **Local Volumes**: Boot volume, local cache info

### Network Tab

- **OVS Bridges**: br-int, br-ex with status
- **Bond Interfaces**: bond0, bond1 with mode and members

### Monitoring Tab

- Time range selector (1h, 6h, 24h, 7d)
- 4 chart placeholders:
  - CPU Utilization
  - Memory Usage
  - Network I/O
  - Disk I/O

### Events Tab

Event log with:
- Time, Type badge, Message, Severity coloring

---

## Component Location

```
frontend/src/pages/HostDetail.tsx
```

---

## Props & State

```typescript
// From URL
const { id } = useParams<{ id: string }>();

// Navigate
const navigate = useNavigate();

// Node data lookup
const node = mockNodes.find((n) => n.id === id);

// Derived values
const cpuPercent = Math.round((allocated / total) * 100);
const memPercent = Math.round((allocated / total) * 100);
```

---

## Helper Components

1. **InfoRow**: Label-value display
2. **HardwareCard**: Icon + label + value + subvalue
3. **StatRow**: System health metric with status color

---

## Error Handling

If host not found:
- Server icon
- "Host Not Found" message
- "Back to Hosts" button

---

## Styling

- Cards: `bg-bg-surface rounded-xl border border-border shadow-floating`
- Status badges: Color-coded by phase
- Progress rings: Dynamic colors (green/yellow/red)
- Monospace font for IPs, device names

---

## Dependencies

- `react-router-dom`: URL params, navigation
- `framer-motion`: Animations
- `lucide-react`: Icons (20+ icons)
- `@/components/ui/Tabs`: Tab navigation
- `@/components/ui/Button`: Action buttons
- `@/components/ui/Badge`: Status badges
- `@/components/dashboard/ProgressRing`: Resource gauges
- `@/data/mock-data`: Node and VM data

---

## Related Pages

- Hosts List: `/hosts` - Parent page
- VM Detail: `/vms/:id` - VM links in VMs tab

---

## Future Enhancements

1. Live metrics charts (Recharts/Victory)
2. BMC/IPMI integration
3. Hardware health monitoring
4. Power management controls
5. Firmware update interface
6. Storage tiering configuration
7. Network topology view

