# 000016 - Clusters Page Documentation

**Component**: Cluster List & Cluster Detail Pages  
**Route**: `/clusters` (list), `/clusters/:id` (detail)  
**Status**: ✅ Complete  

---

## Overview

The Clusters pages provide comprehensive cluster management capabilities, allowing administrators to view, monitor, and configure compute clusters. The design follows VMware vCenter patterns with modern styling and intuitive navigation.

---

## Cluster List Page (`/clusters`)

### Features

1. **Header Section**
   - Page title "Clusters" with description
   - Refresh button for manual data refresh
   - "New Cluster" primary action button

2. **Summary Cards**
   - Total Clusters count
   - Total Hosts count (aggregate across all clusters)
   - Total VMs count (aggregate across all clusters)
   - Total Memory capacity

3. **Cluster Cards Grid**
   - 2-column responsive grid layout
   - Each card displays:
     - Cluster name (clickable link to detail)
     - Description text
     - Health status badge (Healthy, Degraded, Error)
     - Feature badges (HA Enabled, DRS Enabled)
     - Host count and status
     - VM count with running/stopped breakdown
     - Health percentage with CPU load
     - Resource usage bars (CPU, Memory, Storage)
     - Actions dropdown menu

### Cluster Card Details

```
┌─────────────────────────────────────────────────────┐
│ [Icon] Production Cluster      [Healthy]      [⋮]  │
│        Main production workloads - mission critical│
│                                                     │
│ [◯ HA Enabled] [⚡ DRS Enabled]                    │
│                                                     │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐                │
│ │ Hosts   │ │ VMs     │ │ Health  │                │
│ │ 8/8     │ │ 45      │ │ 55%     │                │
│ │ All OK  │ │ 42 run  │ │CPU load │                │
│ └─────────┘ └─────────┘ └─────────┘                │
│                                                     │
│ CPU     ▓▓▓▓▓▓▓▓░░░░░░░░░░░░   55%                │
│ Memory  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░   60%                │
│ Storage ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░   60%                │
└─────────────────────────────────────────────────────┘
```

### Health Status Colors

| Status | Badge Color | Progress Bar Color |
|--------|-------------|-------------------|
| Healthy | Green | Default blue |
| Degraded | Yellow | Yellow warning |
| Error | Red | Red danger |

---

## Cluster Detail Page (`/clusters/:id`)

### Header

- Back navigation arrow (returns to cluster list)
- Cluster icon
- Cluster name and description
- Health status badge
- Feature badges:
  - High Availability Enabled (green)
  - DRS: Fully Automated (blue)
  - Admission Control policy (yellow warning)
- Configure button
- Actions dropdown menu

### Summary Cards

| Card | Content |
|------|---------|
| Hosts | Count (X/Y), status text |
| Virtual Machines | Total count, running/stopped |
| CPU Usage | Percentage, GHz used/total, progress bar |
| Memory Usage | Percentage, TB used/total, progress bar |

### Tabs

1. **Summary** (default)
   - General Information (ID, Created, Created By, Region, Datacenter)
   - Resource Allocation (CPU/Memory bars with percentages)
   - Quick Stats (Total Hosts, Running VMs, Avg CPU Load, Uptime)

2. **Hosts (8)**
   - List of all hosts in the cluster
   - Host name, status, CPU/Memory metrics
   - Actions per host

3. **Virtual Machines (45)**
   - All VMs running on cluster hosts
   - Filterable and searchable
   - Quick actions per VM

4. **Resource Pools**
   - Hierarchical resource pool structure
   - CPU/Memory allocations
   - Child pools and limits

5. **Settings**
   - HA Configuration
   - DRS Configuration
   - vMotion settings
   - EVC Mode

6. **Events**
   - Cluster event timeline
   - Filterable by severity
   - Event details and timestamps

---

## Mock Data Structure

```typescript
interface Cluster {
  id: string;
  name: string;
  description: string;
  status: 'healthy' | 'degraded' | 'error';
  haEnabled: boolean;
  drsEnabled: boolean;
  drsMode?: 'fullyAutomated' | 'partiallyAutomated' | 'manual';
  hosts: {
    total: number;
    online: number;
  };
  vms: {
    total: number;
    running: number;
    stopped: number;
  };
  resources: {
    cpu: {
      usedGHz: number;
      totalGHz: number;
      percent: number;
    };
    memory: {
      usedTB: number;
      totalTB: number;
      percent: number;
    };
    storage: {
      usedTB: number;
      totalTB: number;
      percent: number;
    };
  };
  metadata: {
    created: string;
    createdBy: string;
    region: string;
    datacenter: string;
  };
  admissionControl?: {
    enabled: boolean;
    policy: string;
    failoverHosts: number;
  };
  uptime?: string;
}
```

---

## File Location

- **List Page**: `frontend/src/pages/ClusterList.tsx`
- **Detail Page**: `frontend/src/pages/ClusterDetail.tsx`

---

## Component Dependencies

- `lucide-react` icons (Network, Server, Cpu, MemoryStick, HardDrive, etc.)
- `react-router-dom` for navigation (`Link`, `useParams`, `useNavigate`)
- `framer-motion` for animations
- Shared UI components (`Button`, `Badge`, `Tabs`)

---

## Styling

- Uses Tailwind CSS utility classes
- Follows UI depth guidelines with proper layering
- Card backgrounds use `bg-bg-surface`
- Progress bars with appropriate colors based on usage thresholds
- Consistent spacing and typography

---

## Future Enhancements

1. Real-time metrics via gRPC streaming
2. Cluster creation wizard
3. DRS recommendation engine integration
4. HA event monitoring
5. Resource pool management
6. EVC configuration UI

