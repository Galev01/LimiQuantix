# 000017 - Virtual Networks Page Documentation

**Component**: Virtual Networks List Page  
**Route**: `/networks`  
**Status**: ✅ Complete  

---

## Overview

The Virtual Networks page provides comprehensive network management capabilities for the limiquantix SDN infrastructure. It displays all QuantrixSwitch virtual networks with their configurations, connected VMs, and network statistics.

---

## Features

### Header Section

- Page title "Virtual Networks" with description
- Refresh button for manual data refresh
- "New Network" primary action button

### Summary Cards

| Card | Icon | Description |
|------|------|-------------|
| Total Networks | Network | Count of all virtual networks |
| Connected VMs | Monitor | Total VMs connected across all networks |
| Active Ports | Cable | Total active network ports |

### Filter Controls

1. **Search Bar**
   - Placeholder: "Search networks by name or CIDR..."
   - Real-time filtering

2. **Type Filter Buttons**
   - All Types (default, highlighted)
   - VLAN
   - OVERLAY
   - EXTERNAL

### Networks Table

| Column | Description |
|--------|-------------|
| Network | Name with icon, description text |
| Type | Network type with VLAN ID (e.g., "VLAN (100)") |
| CIDR | IP address range in CIDR notation (accent colored) |
| Gateway | Default gateway IP address |
| DHCP | Status badge (Enabled/Disabled) |
| VMs | Count of connected virtual machines |
| Actions | Edit and delete action buttons |

---

## Network Types

| Type | Color | Description |
|------|-------|-------------|
| VLAN | Blue | Traditional VLAN-tagged networks |
| OVERLAY | Purple | OVN/Geneve overlay networks |
| EXTERNAL | Green | External/provider networks |

---

## Visual Design

### Table Row Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ [🔗] Production VLAN 100        VLAN (100)  10.100.0.0/16  ...   │
│      Main production network...                                  │
└──────────────────────────────────────────────────────────────────┘
```

### DHCP Status Badges

- **Enabled**: Green badge with checkmark styling
- **Disabled**: Gray/muted badge

### Type Badges

```typescript
const typeColors = {
  VLAN: 'bg-blue-500/20 text-blue-400',
  OVERLAY: 'bg-purple-500/20 text-purple-400',
  EXTERNAL: 'bg-green-500/20 text-green-400',
};
```

---

## Mock Data Structure

```typescript
interface VirtualNetwork {
  id: string;
  name: string;
  description: string;
  type: 'VLAN' | 'OVERLAY' | 'EXTERNAL';
  vlanId?: number;
  cidr: string;
  gateway: string;
  dhcpEnabled: boolean;
  connectedVMs: number;
  status: 'active' | 'inactive' | 'error';
  mtu?: number;
  dns?: string[];
  routes?: NetworkRoute[];
}

interface NetworkRoute {
  destination: string;
  nextHop: string;
  metric: number;
}
```

---

## Sample Mock Networks

```typescript
const mockNetworks = [
  {
    id: 'net-prod-100',
    name: 'Production VLAN 100',
    description: 'Main production network for web servers',
    type: 'VLAN',
    vlanId: 100,
    cidr: '10.100.0.0/16',
    gateway: '10.100.0.1',
    dhcpEnabled: true,
    connectedVMs: 28,
  },
  {
    id: 'net-dev-200',
    name: 'Development VLAN 200',
    description: 'Development and testing environment',
    type: 'VLAN',
    vlanId: 200,
    cidr: '10.200.0.0/16',
    gateway: '10.200.0.1',
    dhcpEnabled: true,
    connectedVMs: 15,
  },
  {
    id: 'net-storage',
    name: 'Storage Network',
    description: 'Dedicated network for storage traffic',
    type: 'VLAN',
    vlanId: 300,
    cidr: '10.30.0.0/24',
    gateway: '10.30.0.1',
    dhcpEnabled: false,
    connectedVMs: 12,
  },
  // ... more networks
];
```

---

## File Location

- **Page Component**: `frontend/src/pages/VirtualNetworks.tsx`

---

## Component Dependencies

- `lucide-react` icons (Network, Cable, Monitor, RefreshCw, Plus, Edit2, Trash2, Search)
- `react-router-dom` for navigation
- `framer-motion` for animations
- Shared UI components (`Button`, `Badge`)

---

## Styling

- Table uses alternating row backgrounds on hover
- CIDR column uses accent color for visibility
- Type badges use distinct colors for quick identification
- Actions column uses icon buttons with tooltips

---

## Interactions

1. **Search**: Filters networks by name or CIDR in real-time
2. **Type Filter**: Shows only networks of selected type
3. **Row Hover**: Highlights row and shows action icons
4. **Edit Action**: Opens network edit modal (future)
5. **Delete Action**: Confirms and deletes network (future)
6. **New Network**: Opens network creation wizard (future)

---

## Future Enhancements

1. Network detail page with port listing
2. Network topology visualization
3. Traffic statistics and monitoring
4. IP address management (IPAM) integration
5. Network creation wizard
6. QoS policy configuration
7. Port security settings
8. OVN/OVS rule viewing

