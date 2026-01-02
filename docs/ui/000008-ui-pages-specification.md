# 000008 - UI Pages Specification

**Created**: 2026-01-01  
**Scope**: Frontend Page Requirements and Features  
**Status**: Planning

---

## Overview

This document specifies all pages in the limiquantix dashboard, their features, components, and interactions. Each page follows the vCenter-inspired design patterns established in the Dashboard.

---

## Page Index

| Page | Route | Priority | Status |
|------|-------|----------|--------|
| Dashboard | `/` | P0 | ✅ Implemented |
| Virtual Machines List | `/vms` | P0 | 📋 Planned |
| VM Detail | `/vms/:id` | P0 | 📋 Planned |
| Hosts List | `/hosts` | P0 | 📋 Planned |
| Host Detail | `/hosts/:id` | P1 | 📋 Planned |
| Clusters List | `/clusters` | P1 | 📋 Planned |
| Cluster Detail | `/clusters/:id` | P1 | 📋 Planned |
| Storage Pools | `/storage/pools` | P1 | 📋 Planned |
| Volumes | `/storage/volumes` | P1 | 📋 Planned |
| Virtual Networks | `/networks` | P2 | 📋 Planned |
| Security Groups | `/security` | P2 | 📋 Planned |
| Settings | `/settings` | P2 | 📋 Planned |

---

## 1. Virtual Machines

### 1.1 VM List Page (`/vms`)

**Purpose**: Browse, search, filter, and manage all virtual machines

#### Header Section
- **Title**: "Virtual Machines"
- **Subtitle**: "Manage your virtual machine inventory"
- **Actions**:
  - 🔍 Search bar (filter by name, IP, labels)
  - ➕ "New VM" button (opens creation wizard)
  - 🔄 Refresh button
  - ⚙️ Column settings dropdown

#### Filters & Tabs
```
[All (6)] [Running (4)] [Stopped (1)] [Other (1)]
```

#### Filter Bar
- Power State: `[All States ▼]`
- Host: `[All Hosts ▼]`
- Project: `[All Projects ▼]`
- Labels: `[Add Filter +]`

#### VM Table

| Column | Width | Sortable | Description |
|--------|-------|----------|-------------|
| ☐ | 40px | No | Checkbox for bulk selection |
| Name | 200px | Yes | VM name + OS icon |
| Status | 100px | Yes | Power state badge |
| Host | 150px | Yes | Node hostname |
| CPU | 80px | Yes | Usage % with bar |
| Memory | 100px | Yes | Used / Allocated |
| Storage | 100px | Yes | Total disk size |
| IP Address | 140px | Yes | Primary IP (monospace) |
| Uptime | 80px | Yes | Formatted duration |
| Actions | 120px | No | Quick action buttons |

#### Row Actions (on hover)
- ▶️ Start / ⏹️ Stop
- 🔄 Restart
- ⏸️ Pause / ▶️ Resume
- 📸 Snapshot
- 🖥️ Console
- ⋯ More (dropdown)

#### Bulk Actions (when rows selected)
- Start Selected
- Stop Selected
- Delete Selected
- Add Labels
- Migrate

#### Empty State
```
┌─────────────────────────────────────┐
│         🖥️                          │
│    No Virtual Machines              │
│                                     │
│  Create your first VM to get        │
│  started with limiquantix           │
│                                     │
│        [+ Create VM]                │
└─────────────────────────────────────┘
```

---

### 1.2 VM Detail Page (`/vms/:id`)

**Purpose**: View and manage a single virtual machine

#### Header Section
- **Breadcrumb**: Dashboard > Virtual Machines > `vm-name`
- **Title**: VM name with edit icon
- **Status Badge**: Running/Stopped/etc.
- **Actions**:
  - ▶️ Start / ⏹️ Stop / 🔄 Restart
  - 🖥️ Open Console
  - 📸 Create Snapshot
  - ⋯ More Actions

#### Tab Navigation
```
[Summary] [Console] [Snapshots] [Disks] [Network] [Monitoring] [Events] [Configure]
```

#### Tab: Summary

**Overview Card**
```
┌─────────────────────────────────────────────────────────────┐
│ General Information                                    [Edit]│
├─────────────────────────────────────────────────────────────┤
│ Name:          prod-web-01                                  │
│ Description:   Production web server                        │
│ Project:       default                                      │
│ Created:       Jan 15, 2024 10:30 AM                       │
│ Host:          hv-rack1-01.limiquantix.local               │
│ Guest OS:      Ubuntu 22.04 LTS                            │
│ VMware Tools:  Running (v1.0.0)                            │
└─────────────────────────────────────────────────────────────┘
```

**Hardware Summary**
```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ CPU          │  │ Memory       │  │ Storage      │  │ Network      │
│ 4 vCPUs      │  │ 8 GB         │  │ 100 GB       │  │ 1 NIC        │
│ 45% usage    │  │ 75% usage    │  │ 2 disks      │  │ 10.0.1.10    │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

**Real-time Metrics (Charts)**
- CPU Usage (last 1h)
- Memory Usage (last 1h)
- Disk I/O (read/write IOPS)
- Network I/O (rx/tx bytes)

**Guest Information**
- Hostname, IP addresses, DNS
- Agent status and version
- Uptime

#### Tab: Console

**Features**:
- VNC/SPICE web console embed
- Fullscreen toggle
- Send Ctrl+Alt+Del button
- Screenshot button
- Console connection status

```
┌─────────────────────────────────────────────────────────────┐
│ [Fullscreen] [Send Ctrl+Alt+Del] [Screenshot]    Connected ●│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    ┌─────────────────┐                      │
│                    │                 │                      │
│                    │   VM Console    │                      │
│                    │                 │                      │
│                    └─────────────────┘                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Tab: Snapshots

**Features**:
- Snapshot tree visualization
- Create snapshot button
- Revert to snapshot
- Delete snapshot
- Snapshot details (name, description, date, size)

**Snapshot Tree**
```
● Current State
│
├─○ snapshot-3 "Before upgrade" (Jan 20, 2024)
│   └─○ snapshot-2 "Checkpoint" (Jan 18, 2024)
│
└─○ snapshot-1 "Initial setup" (Jan 15, 2024)
```

#### Tab: Disks

**Features**:
- List of attached disks
- Add new disk
- Resize disk
- Detach disk
- Disk performance stats

**Disk Table**
| Device | Size | Bus | Cache | Pool | Actions |
|--------|------|-----|-------|------|---------|
| vda | 100 GB | VirtIO | writeback | ceph-ssd | [Resize] [Detach] |
| vdb | 500 GB | VirtIO | none | ceph-ssd | [Resize] [Detach] |

#### Tab: Network

**Features**:
- List of network interfaces
- Add NIC
- Edit NIC settings
- Remove NIC
- Network statistics

**NIC Table**
| Device | Network | MAC Address | IP Address | Security Groups | Actions |
|--------|---------|-------------|------------|-----------------|---------|
| eth0 | net-prod | 52:54:00:12:34:56 | 10.0.1.10 | sg-default | [Edit] [Remove] |

#### Tab: Monitoring

**Features**:
- Time range selector (1h, 6h, 24h, 7d, 30d)
- CPU usage chart
- Memory usage chart
- Disk I/O chart
- Network I/O chart
- Export to CSV

#### Tab: Events

**Features**:
- Event log with filtering
- Event types: Power, Config, Snapshot, Migration, Error
- Time-based filtering
- Search events

**Event Log**
| Time | Type | Message | User |
|------|------|---------|------|
| 10:30 AM | Power | VM started | admin |
| 10:25 AM | Config | Memory increased to 8GB | admin |
| 10:00 AM | Snapshot | Snapshot created: "Before upgrade" | system |

#### Tab: Configure

**Sections**:
1. **General**: Name, description, labels
2. **CPU**: Cores, sockets, threads, NUMA, CPU features
3. **Memory**: Size, ballooning, huge pages
4. **Boot**: Boot order, firmware (BIOS/UEFI)
5. **HA Policy**: Auto-restart, priority
6. **Migration**: Enable/disable, bandwidth limits
7. **Advanced**: Watchdog, RNG, TPM, serial ports

---

## 2. Hosts

### 2.1 Hosts List Page (`/hosts`)

**Purpose**: View and manage physical hypervisor hosts

#### Header Section
- **Title**: "Hosts"
- **Subtitle**: "Physical hypervisor nodes in your cluster"
- **Actions**:
  - 🔍 Search
  - ➕ "Add Host" button
  - 🔄 Refresh

#### Filters
- Status: `[All] [Ready] [Not Ready] [Maintenance]`
- Cluster: `[All Clusters ▼]`
- Labels: `[Add Filter +]`

#### Host Cards View (Default)

Grid of host cards showing:
```
┌─────────────────────────────────────────┐
│ 🖥️ hv-rack1-01                   READY │
│ 192.168.1.11                            │
├─────────────────────────────────────────┤
│ CPU ████████░░░░░░░░░░  32%  64 cores   │
│ MEM ██████████░░░░░░░░  45%  512 GB     │
├─────────────────────────────────────────┤
│ VMs: 2  │  rack: rack-1  │  zone: us-1a │
└─────────────────────────────────────────┘
```

#### Host Table View (Toggle)

| Column | Description |
|--------|-------------|
| Hostname | Node hostname |
| Status | Ready/Not Ready/Maintenance |
| IP | Management IP |
| CPU | Model + usage |
| Memory | Used / Total |
| VMs | VM count |
| Labels | Key-value pairs |
| Actions | Enable/Disable/Drain/Maintain |

---

### 2.2 Host Detail Page (`/hosts/:id`)

**Purpose**: View host details, resources, and manage VMs

#### Header Section
- **Breadcrumb**: Dashboard > Hosts > `hostname`
- **Title**: Hostname with status badge
- **Actions**:
  - Enable/Disable scheduling
  - Enter Maintenance Mode
  - Drain VMs
  - Reboot

#### Tab Navigation
```
[Summary] [Virtual Machines] [Hardware] [Storage] [Network] [Monitoring] [Events]
```

#### Tab: Summary

**Hardware Overview**
- CPU: Model, cores, threads, NUMA nodes
- Memory: Total, allocatable, used
- Storage: Local disks, capacity
- Network: NICs, speeds

**Resource Allocation**
```
┌─────────────────────────────────────────────────────────────┐
│ Resource Allocation                                         │
├─────────────────────────────────────────────────────────────┤
│ CPU:    ██████████████░░░░░░░░░░░░░░░░░░  32/64 cores (50%) │
│ Memory: ████████████████████░░░░░░░░░░░░  256/512 GB (50%)  │
│ VMs:    5 running                                           │
└─────────────────────────────────────────────────────────────┘
```

#### Tab: Virtual Machines

List of VMs running on this host with:
- VM table (same as VM list)
- "Migrate All" action
- "Evacuate" action (for maintenance)

#### Tab: Hardware

Detailed hardware information:
- CPU topology visualization
- Memory DIMMs
- PCI devices (GPUs, NICs, storage controllers)
- USB devices

#### Tab: Storage

Local storage devices:
- NVMe drives
- SATA/SAS drives
- RAID controllers
- Storage pools using local storage

#### Tab: Network

Network interfaces:
- Physical NICs
- Bonds/Teams
- VLANs
- SR-IOV virtual functions
- Network traffic stats

---

## 3. Clusters

### 3.1 Clusters List Page (`/clusters`)

**Purpose**: Manage logical groupings of hosts

#### Cluster Cards

```
┌─────────────────────────────────────────┐
│ 🏢 production-cluster                   │
│ 4 hosts  │  24 VMs  │  HEALTHY          │
├─────────────────────────────────────────┤
│ CPU ████████████░░░░░░░░  45%           │
│ MEM ██████████████░░░░░░  65%           │
├─────────────────────────────────────────┤
│ HA: Enabled  │  DRS: Enabled            │
└─────────────────────────────────────────┘
```

#### Features
- Create new cluster
- Edit cluster settings
- Delete cluster
- Add/remove hosts from cluster

---

### 3.2 Cluster Detail Page (`/clusters/:id`)

**Purpose**: Manage cluster resources and settings

#### Tab Navigation
```
[Summary] [Hosts] [Virtual Machines] [HA Settings] [DRS Settings] [Resource Pools]
```

#### Tab: Summary

- Cluster-wide resource usage
- Host health status
- HA status
- DRS recommendations

#### Tab: HA Settings

**High Availability Configuration**:
- Enable/Disable HA
- Admission control policy
- Host failure response
- VM monitoring sensitivity
- Heartbeat datastores

#### Tab: DRS Settings

**Distributed Resource Scheduler**:
- Enable/Disable DRS
- Automation level (Manual, Partially, Fully Automated)
- Migration threshold
- DRS recommendations list
- Affinity/Anti-affinity rules

---

## 4. Storage

### 4.1 Storage Pools Page (`/storage/pools`)

**Purpose**: Manage storage backends (Ceph, LVM, NFS)

#### Pool Cards

```
┌─────────────────────────────────────────┐
│ 💾 ceph-ssd-pool              CEPH_RBD │
│ Status: READY                           │
├─────────────────────────────────────────┤
│ Used:   40 TB / 100 TB (40%)           │
│ ████████████████░░░░░░░░░░░░░░░░░░░░░░ │
├─────────────────────────────────────────┤
│ Volumes: 24  │  Snapshots: 12          │
└─────────────────────────────────────────┘
```

#### Pool Types
- **CEPH_RBD**: Ceph block storage
- **LOCAL_LVM**: Local LVM volumes
- **NFS**: Network file shares
- **ISCSI**: iSCSI targets

#### Actions
- Create pool
- Edit pool settings
- View pool metrics
- Delete pool (with warnings)

---

### 4.2 Volumes Page (`/storage/volumes`)

**Purpose**: Manage virtual disks

#### Volume Table

| Column | Description |
|--------|-------------|
| Name | Volume name |
| Pool | Storage pool |
| Size | Capacity (GB/TB) |
| Provisioning | Thin/Thick |
| Attached To | VM name or "Unattached" |
| Snapshots | Snapshot count |
| Actions | Attach, Resize, Clone, Delete |

#### Features
- Create new volume
- Attach to VM
- Detach from VM
- Resize volume
- Clone volume
- Create snapshot

#### Volume Detail

- Volume info (name, size, pool, provisioning)
- Attached VM
- Snapshots list
- Performance metrics (IOPS, throughput)

---

## 5. Networking

### 5.1 Virtual Networks Page (`/networks`)

**Purpose**: Manage SDN virtual networks

#### Network Cards

```
┌─────────────────────────────────────────┐
│ 🌐 net-production             OVERLAY   │
│ CIDR: 10.0.1.0/24                       │
├─────────────────────────────────────────┤
│ Gateway: 10.0.1.1                       │
│ DHCP: Enabled (10.0.1.100-200)         │
├─────────────────────────────────────────┤
│ Ports: 12  │  VMs: 8                    │
└─────────────────────────────────────────┘
```

#### Network Types
- **FLAT**: Untagged external network
- **VLAN**: 802.1Q tagged network
- **OVERLAY_OVN**: OVN overlay network

#### Features
- Create network
- Edit network settings
- View topology
- Delete network

#### Network Detail

**Tabs**: `[Summary] [Ports] [Subnets] [DHCP] [Router] [Topology]`

- Port list with MAC/IP assignments
- Subnet configuration
- DHCP settings
- Router integration
- Visual topology diagram

---

### 5.2 Security Groups Page (`/security`)

**Purpose**: Manage firewall rules

#### Security Group Cards

```
┌─────────────────────────────────────────┐
│ 🛡️ sg-web-servers                       │
│ Rules: 5 ingress, 2 egress              │
├─────────────────────────────────────────┤
│ Applied to: 4 VMs                       │
└─────────────────────────────────────────┘
```

#### Features
- Create security group
- Add/remove rules
- Apply to VMs/Ports
- Delete security group

#### Security Group Detail

**Rule Table**

| Direction | Protocol | Port Range | Source/Dest | Action |
|-----------|----------|------------|-------------|--------|
| Ingress | TCP | 80 | 0.0.0.0/0 | Allow |
| Ingress | TCP | 443 | 0.0.0.0/0 | Allow |
| Ingress | TCP | 22 | 10.0.0.0/8 | Allow |
| Egress | Any | Any | 0.0.0.0/0 | Allow |

**Rule Editor**
- Direction: Ingress/Egress
- Protocol: TCP/UDP/ICMP/Any
- Port range: Single/Range/Any
- Source/Dest: CIDR/Security Group/Any
- Action: Allow/Deny

---

## 6. Settings

### 6.1 Settings Page (`/settings`)

#### Sections

1. **General**
   - Cluster name
   - Time zone
   - Default project

2. **Authentication**
   - LDAP/AD integration
   - Local users
   - API tokens

3. **Notifications**
   - Email settings
   - Webhook integrations
   - Alert rules

4. **Backup**
   - Backup schedule
   - Backup destinations
   - Restore options

5. **Updates**
   - System version
   - Available updates
   - Update history

6. **Licenses**
   - License info
   - Feature status
   - Add/Remove licenses

---

## Shared UI Patterns

### Modal Dialogs

**Confirmation Dialog**
```
┌─────────────────────────────────────────┐
│ ⚠️ Stop Virtual Machine?                │
├─────────────────────────────────────────┤
│ Are you sure you want to stop           │
│ "prod-web-01"? Any unsaved data         │
│ may be lost.                            │
│                                         │
│            [Cancel]  [Stop VM]          │
└─────────────────────────────────────────┘
```

**Creation Wizard**
```
Step 1: General ──── Step 2: Hardware ──── Step 3: Network ──── Step 4: Review
   ●                      ○                     ○                    ○
```

### Toast Notifications

- **Success**: Green, auto-dismiss 5s
- **Error**: Red, requires dismissal
- **Warning**: Yellow, auto-dismiss 10s
- **Info**: Blue, auto-dismiss 5s

### Loading States

- Skeleton loaders for tables
- Spinner for actions
- Progress bar for long operations

### Error States

- Inline errors for forms
- Error pages (404, 500)
- Connection lost banner

---

## Routing Structure

```typescript
const routes = [
  { path: '/', element: <Dashboard /> },
  { path: '/vms', element: <VMList /> },
  { path: '/vms/:id', element: <VMDetail /> },
  { path: '/hosts', element: <HostList /> },
  { path: '/hosts/:id', element: <HostDetail /> },
  { path: '/clusters', element: <ClusterList /> },
  { path: '/clusters/:id', element: <ClusterDetail /> },
  { path: '/storage/pools', element: <StoragePoolList /> },
  { path: '/storage/pools/:id', element: <StoragePoolDetail /> },
  { path: '/storage/volumes', element: <VolumeList /> },
  { path: '/storage/volumes/:id', element: <VolumeDetail /> },
  { path: '/networks', element: <NetworkList /> },
  { path: '/networks/:id', element: <NetworkDetail /> },
  { path: '/security', element: <SecurityGroupList /> },
  { path: '/security/:id', element: <SecurityGroupDetail /> },
  { path: '/settings', element: <Settings /> },
];
```

---

## Implementation Priority

### Phase 1 (MVP)
1. ✅ Dashboard
2. VM List page
3. VM Detail page (Summary + Console tabs)
4. Hosts List page

### Phase 2
5. Host Detail page
6. Storage Pools page
7. Volumes page
8. VM creation wizard

### Phase 3
9. Clusters pages
10. Networks pages
11. Security Groups pages
12. Settings page

### Phase 4
13. Monitoring integration
14. Real-time updates (gRPC streaming)
15. Advanced features (DRS, HA)

---

## Component Library Needed

| Component | Priority | Description |
|-----------|----------|-------------|
| DataTable | P0 | Sortable, filterable table |
| Modal | P0 | Dialog/overlay |
| Tabs | P0 | Tab navigation |
| Form inputs | P0 | Text, select, checkbox, etc. |
| Button | P0 | Primary, secondary, danger |
| Badge | P0 | Status badges |
| Card | P0 | Content cards |
| Toast | P0 | Notifications |
| Dropdown | P0 | Action menus |
| Tooltip | P1 | Hover hints |
| Chart | P1 | Line, bar, pie charts |
| Tree | P1 | Hierarchical tree view |
| Wizard | P1 | Multi-step forms |
| DatePicker | P2 | Date/time selection |
| Editor | P2 | Code/text editor |

---

## References

- [Dashboard UI Guide](./000007-dashboard-ui-guide.md)
- [Proto Definitions](./adr/000001-vm-model-design.md)
- [UI-Expert Guidelines](../.cursor/rules/ui-expert.mdc)

