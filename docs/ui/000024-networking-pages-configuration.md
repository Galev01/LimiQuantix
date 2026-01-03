# 000024 - Networking Pages & Configuration UI

**Purpose:** Documentation for advanced networking pages (Load Balancers, VPN Services, BGP Speakers) and configuration tabs added to VM/Host detail pages.

**Status:** ✅ Complete

**Last Updated:** January 4, 2026

---

## Overview

This document covers the frontend implementation of enterprise networking features for the LimiQuantix dashboard, including:

1. **Virtual Networks Page** - Enhanced with create/edit modals
2. **Load Balancers Page** - L4 load balancing management
3. **VPN Services Page** - WireGuard bastion and site-to-site VPN management
4. **BGP Speakers Page** - BGP ToR integration for bare-metal environments
5. **VM Detail Configuration Tab** - Advanced VM settings display
6. **Host Detail Configuration Tab** - Node-level networking and daemon configuration

---

## Part 1: Networking Pages

### 1.1 Virtual Networks Page (`/networks`)

**File:** `frontend/src/pages/VirtualNetworks.tsx`

**Features:**
- Summary cards (Total, VXLAN, VLAN, Active, Ports)
- Searchable/filterable network list
- Network detail panel with CIDR, gateway, DHCP info
- Port list showing connected VMs
- **Create Network Modal** - Form for new network creation
- **Edit Network Modal** - Modify existing network parameters

**Create Network Modal Fields:**

| Field | Type | Description |
|-------|------|-------------|
| Name | Text | Network display name |
| Description | Text | Optional description |
| Type | Dropdown | `vxlan`, `vlan`, `flat` |
| CIDR | Text | Network range (e.g., `10.0.1.0/24`) |
| Gateway | Text | Gateway IP address |
| VLAN ID | Number | Required for VLAN type |
| Enable DHCP | Toggle | Enable OVN DHCP |
| Enable Router | Toggle | Enable external gateway |

### 1.2 Load Balancers Page (`/networks/load-balancers`)

**File:** `frontend/src/pages/LoadBalancers.tsx`

**Features:**
- Summary cards (Total, Active, Healthy Members, Total Connections)
- LB card list with VIP, algorithm, listeners, member health
- Detail panel with stats, member table, health configuration
- **Create Load Balancer Modal**

**Create Load Balancer Modal Fields:**

| Field | Type | Description |
|-------|------|-------------|
| Name | Text | LB display name |
| Description | Text | Optional description |
| VIP Address | Text | Virtual IP (e.g., `10.0.0.100`) |
| Listener Port | Number | Frontend port (e.g., `80`) |
| Protocol | Dropdown | `TCP` or `UDP` |
| Algorithm | Dropdown | `round_robin`, `least_connections`, `source_ip` |
| Network | Dropdown | Associated virtual network |

**LB Card Display:**
- VIP address and protocol badge
- Algorithm indicator
- Member count with health ratio
- Active connection count
- Listener ports list

### 1.3 VPN Services Page (`/networks/vpn`)

**File:** `frontend/src/pages/VPNServices.tsx`

**Features:**
- Summary cards (Total, Active, Connections, Inactive)
- VPN card list with type, endpoint, connections, transfer stats
- Detail panel with public key, client connections, allowed networks
- **Create VPN Modal**

**Create VPN Modal Fields:**

| Field | Type | Description |
|-------|------|-------------|
| Name | Text | VPN service name |
| Description | Text | Optional description |
| Type | Dropdown | `wireguard` (WireGuard Bastion) or `ipsec` (Site-to-Site) |
| Listen Port | Number | WireGuard port (default: `51820`) |
| Network | Dropdown | Overlay network to connect |
| Allowed Networks | Text | Comma-separated CIDRs for client access |

**VPN Types:**

| Type | Description | Use Case |
|------|-------------|----------|
| WireGuard Bastion | Point-to-site VPN for remote access | Developer laptops, remote workers |
| IPsec Site-to-Site | Tunnel between networks | Branch offices, multi-site |

### 1.4 BGP Speakers Page (`/networks/bgp`)

**File:** `frontend/src/pages/BGPSpeakers.tsx`

**Features:**
- Summary cards (Speakers, Established Peers, Advertised Routes, Total Prefixes)
- Speaker card list with ASN, router ID, node, peer status
- Detail panel with peer table, advertisements, auto-advertisement config
- **Create BGP Speaker Modal**

**Create BGP Speaker Modal Fields:**

| Field | Type | Description |
|-------|------|-------------|
| Name | Text | Speaker display name |
| Description | Text | Optional description |
| Local ASN | Number | Autonomous System Number (e.g., `65001`) |
| Router ID | Text | BGP router ID (IPv4 format) |
| Node | Dropdown | Host node to run BGP daemon |
| Auto-advertise Overlay Networks | Toggle | Automatically advertise all overlay CIDRs |
| Auto-advertise Load Balancer VIPs | Toggle | Automatically advertise LB VIPs |

**Peer States:**

| State | Color | Description |
|-------|-------|-------------|
| ESTABLISHED | Green | Session active, exchanging routes |
| CONNECT | Yellow | Attempting to connect |
| IDLE | Gray | Not connected |
| OPENSENT | Yellow | Connection handshake in progress |

---

## Part 2: Configuration Tabs

### 2.1 VM Detail Configuration Tab

**File:** `frontend/src/pages/VMDetail.tsx`

**Location:** New "Configuration" tab in VM detail view

**Configuration Sections:**

| Section | Fields Displayed |
|---------|------------------|
| **Boot Options** | Firmware (BIOS/UEFI), Boot Order, Boot Device |
| **CPU Configuration** | Model, Cores, Threads, Sockets, Pinning, Features |
| **Memory Configuration** | Size, Ballooning, Huge Pages |
| **Display & Console** | Type (VNC/SPICE), Listen Address, Password status |
| **Guest Agent** | Type (virtio-serial), Status, Polling interval |
| **Provisioning (Cloud-Init)** | User Data status, Network Config status |
| **High Availability** | Auto-restart, Priority |
| **Advanced Options** | Machine Type, USB Tablet, RNG Device, Watchdog, Serial Console |

**Edit Actions:**
- Each section has an "Edit" button linking to respective modals
- CPU/Memory modals already exist in the codebase
- Console section has "Connect" button for VNC access

### 2.2 Host Detail Configuration Tab

**File:** `frontend/src/pages/HostDetail.tsx`

**Location:** New "Configuration" tab in Host detail view

**Configuration Sections:**

| Section | Fields Displayed | Actions |
|---------|------------------|---------|
| **OVN Controller** | Status, OVN Central address, Chassis ID | Reconfigure OVN |
| **Open vSwitch** | Version, System ID, Bridge list | View OVS DB |
| **WireGuard VPN** | Status, Listen port, Active tunnels | Enable WireGuard |
| **FRRouting (BGP)** | Status, Local ASN, Peers | Enable BGP |
| **Libvirt** | Status, Version, URI | Configure Migration |
| **Node Daemon** | Version, gRPC port, Certificate | Rotate Certificates |
| **Storage Backend** | Type (Ceph), Pool, Status | Configure Storage |
| **Scheduling & DRS** | Schedulable status, Taints | Add Taint, Cordon Node |

**Status Indicators:**
- Green badge: Connected/Running/Enabled
- Gray badge: Disabled/Not Configured
- Icons for each subsystem (Network, Server, Shield, etc.)

---

## Part 3: Bug Fixes

### 3.1 Config Lookup Defensive Fallbacks

**Issue:** `TypeError: Cannot read properties of undefined (reading 'icon')` when API returns status/type values not defined in frontend config objects.

**Files Fixed:**
- `VirtualNetworks.tsx` (lines 331-334, 494-495)
- `VPNServices.tsx` (lines 333-336, 407-408, 486-487)
- `BGPSpeakers.tsx` (lines 325-326, 386, 471)
- `LoadBalancers.tsx` (lines 337-339)
- `HostDetail.tsx` (line 152)

**Solution Pattern:**
```typescript
// Before (crashes if status not in config)
const status = statusConfig[item.status];
const StatusIcon = status.icon;

// After (graceful fallback)
const status = statusConfig[item.status] || { color: 'default', icon: AlertTriangle };
const StatusIcon = status.icon;
```

**Fallback Values Used:**

| Config Type | Fallback |
|-------------|----------|
| `typeConfig` | `{ color: 'blue', icon: Cable, label: type || 'Unknown' }` |
| `statusConfig` | `{ color: 'default', icon: AlertTriangle }` |
| `algorithmConfig` | `{ label: algorithm || 'Unknown', color: 'blue' }` |
| `peerStateConfig` | `{ color: 'default', label: state || 'Unknown' }` |
| `connectionStatusConfig` | `{ color: 'default', icon: XCircle }` |
| `phaseConfig` | `{ label: phase || 'Unknown', variant: 'default', icon: AlertCircle }` |

---

## Part 4: File Summary

### New Files Created

| File | Purpose |
|------|---------|
| `frontend/src/pages/LoadBalancers.tsx` | L4 Load Balancer management page |
| `frontend/src/pages/VPNServices.tsx` | VPN Services (WireGuard/IPsec) page |
| `frontend/src/pages/BGPSpeakers.tsx` | BGP Speakers management page |

### Files Modified

| File | Changes |
|------|---------|
| `frontend/src/pages/VirtualNetworks.tsx` | Added Create/Edit modals, defensive fallbacks |
| `frontend/src/pages/VMDetail.tsx` | Added Configuration tab with grouped settings |
| `frontend/src/pages/HostDetail.tsx` | Added Configuration tab for node services |
| `frontend/src/App.tsx` | Added routes for new networking pages |
| `frontend/src/components/layout/Sidebar.tsx` | Added navigation items for new pages |

---

## Part 5: UI Component Patterns

### ConfigRow Component

Used in both VM and Host detail configuration tabs:

```typescript
function ConfigRow({
  label,
  value,
  badge,
  badgeVariant,
}: {
  label: string;
  value: React.ReactNode;
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'warning' | 'destructive';
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-text-muted">{label}</span>
      <div className="flex items-center gap-2">
        {badge && <Badge variant={badgeVariant || 'default'}>{badge}</Badge>}
        <span className="text-sm text-text-primary">{value}</span>
      </div>
    </div>
  );
}
```

### Modal Pattern

All create/edit modals follow this structure:

```typescript
<AnimatePresence>
  {isModalOpen && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={() => setIsModalOpen(false)}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-bg-surface border border-border rounded-xl p-6 w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal content */}
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
```

---

## Part 6: Navigation Structure

### Sidebar Networking Section

```
Networking (section header)
├── Virtual Networks  → /networks
├── Security Groups   → /security
├── Load Balancers    → /networks/load-balancers
├── VPN Services      → /networks/vpn
└── BGP Speakers      → /networks/bgp
```

### Route Configuration

```typescript
// App.tsx routes
<Route path="/networks/load-balancers" element={<LoadBalancers />} />
<Route path="/networks/vpn" element={<VPNServices />} />
<Route path="/networks/bgp" element={<BGPSpeakers />} />
```

---

## References

- [Advanced Networking Features](../Networking/000052-advanced-networking-features.md) - Backend implementation
- [OVN Central Setup Guide](../Networking/000050-ovn-central-setup-guide.md) - OVN configuration
- [VM Detail Page Spec](./000010-vm-detail-page.md) - Original VM detail design
- [Host Detail Page Spec](./000012-host-detail-page.md) - Original host detail design
