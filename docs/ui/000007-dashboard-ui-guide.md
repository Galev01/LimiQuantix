# 000007 - Dashboard UI Architecture & Design Guide

**Created**: 2026-01-01  
**Scope**: Frontend Dashboard Implementation  
**Status**: Implemented

---

## Overview

The LimiQuantix Dashboard is a React-based virtualization management interface inspired by VMware vCenter 8, built with modern web technologies and following the UI-Expert styling guidelines for visual depth and hierarchy.

---

## Technology Stack

| Technology | Purpose | Version |
|------------|---------|---------|
| React | UI Framework | 19.x |
| Vite | Build Tool | 7.x |
| TypeScript | Type Safety | 5.x |
| Tailwind CSS | Styling | 4.x |
| Zustand | Global State | Latest |
| TanStack Query | Server State | Latest |
| Framer Motion | Animations | Latest |
| Lucide React | Icons | Latest |

---

## Design Philosophy

### 1. VMware vCenter 8 Inspiration

The UI draws inspiration from VMware vCenter 8 while establishing its own identity:

- **Sidebar Navigation**: Collapsible tree-based navigation similar to vCenter's inventory view
- **Dashboard Overview**: Summary cards showing cluster-wide metrics
- **List Views**: Detailed tables with inline actions and status indicators
- **Dark Theme**: Professional dark color scheme for datacenter environments

### 2. UI-Expert Guidelines Compliance

Following the layered color system for visual depth:

```
Layer 0 (Base):     #0f1117  - Page background
Layer 1 (Surface):  #161922  - Cards, containers
Layer 2 (Elevated): #1e222d  - Active states, buttons
Layer 3 (Hover):    #262b38  - Hover states
Layer 4 (Active):   #2d3344  - Selected items
```

### 3. Shadow Techniques

Three shadow types are used based on element purpose:

- **Floating Shadow**: Standard cards and buttons
- **Elevated Shadow**: Selected items, active tabs
- **Recessed Shadow**: Input fields, disabled states

---

## Component Architecture

### Layout Components

```
frontend/src/components/layout/
├── Layout.tsx      # Root layout wrapper
├── Sidebar.tsx     # Collapsible navigation sidebar
└── Header.tsx      # Top header bar
```

#### Sidebar (`Sidebar.tsx`)

**Purpose**: Primary navigation with hierarchical tree structure

**Features**:
- LimiQuantix branding with logo
- Collapsible/expandable sidebar (260px → 64px)
- Hierarchical navigation tree
- Badge counts for inventory items
- Animated transitions with Framer Motion

**Navigation Structure**:
```
├── Dashboard
├── Inventory
│   ├── Virtual Machines [6]
│   ├── Hosts [4]
│   └── Clusters
├── Storage
│   ├── Storage Pools
│   └── Volumes
├── Networking
│   ├── Virtual Networks
│   └── Security Groups
└── Settings
```

#### Header (`Header.tsx`)

**Purpose**: Top navigation bar with global actions

**Features**:
- Page title with breadcrumb
- Global search (⌘K shortcut)
- Refresh button
- "New VM" primary action
- Notifications bell (with unread indicator)
- User profile avatar

---

### Dashboard Components

```
frontend/src/components/dashboard/
├── MetricCard.tsx      # Summary metric cards
├── ProgressRing.tsx    # Circular progress indicator
├── ResourceCard.tsx    # Resource usage with ring
└── NodeCard.tsx        # Host/node status cards
```

#### MetricCard (`MetricCard.tsx`)

**Purpose**: Display summary metrics with icons

**Props**:
```typescript
interface MetricCardProps {
  title: string;           // "Virtual Machines"
  value: string | number;  // 6
  subtitle?: string;       // "4 running, 1 stopped"
  icon: ReactNode;         // <MonitorCog />
  trend?: { value: number; label: string };
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
  delay?: number;          // Animation delay
}
```

**Color Mapping**:
- Blue: Virtual Machines, general info
- Green: Hosts, success states
- Purple: CPU, compute resources
- Yellow/Orange: Memory, warnings
- Red: Errors, critical states

#### ProgressRing (`ProgressRing.tsx`)

**Purpose**: Circular progress indicator for resource usage

**Features**:
- SVG-based ring animation
- Dynamic color based on threshold (>90% red, >70% yellow)
- Animated entrance with Framer Motion

#### ResourceCard (`ResourceCard.tsx`)

**Purpose**: Resource usage display with progress ring

**Features**:
- Progress ring visualization
- Used/Total/Available breakdown
- Byte formatting utilities

#### NodeCard (`NodeCard.tsx`)

**Purpose**: Display host/node status

**Features**:
- Node hostname and IP
- Status indicator (READY, NOT_READY, MAINTENANCE, DRAINING)
- CPU and Memory progress bars
- VM count

---

### VM Components

```
frontend/src/components/vm/
├── VMStatusBadge.tsx   # Power state badges
└── VMTable.tsx         # VM list table
```

#### VMStatusBadge (`VMStatusBadge.tsx`)

**Purpose**: Visual power state indicator

**States**:
| State | Color | Icon |
|-------|-------|------|
| RUNNING | Green | Play |
| STOPPED | Gray | Square |
| PAUSED | Yellow | Pause |
| SUSPENDED | Blue | Moon |
| MIGRATING | Blue | ArrowRightLeft |
| CRASHED | Red | AlertTriangle |

#### VMTable (`VMTable.tsx`)

**Purpose**: VM list with status and actions

**Columns**:
1. Name (with OS icon and type)
2. Status (badge)
3. Host
4. CPU (usage bar)
5. Memory (used/allocated)
6. IP Address
7. Uptime
8. Actions (Start/Stop/Restart/More)

---

## Theme System

### CSS Custom Properties

Defined in `frontend/src/index.css` using Tailwind v4's `@theme` directive:

```css
@theme {
  /* Background Layers */
  --color-bg-base: #0f1117;
  --color-bg-surface: #161922;
  --color-bg-elevated: #1e222d;
  --color-bg-hover: #262b38;
  --color-bg-active: #2d3344;
  
  /* Text Colors */
  --color-text-primary: #f1f5f9;
  --color-text-secondary: #94a3b8;
  --color-text-muted: #64748b;
  
  /* Brand Colors */
  --color-accent: #3b82f6;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  
  /* Shadows */
  --shadow-floating: 0 -1px 2px rgba(255,255,255,0.03), 0 4px 16px rgba(0,0,0,0.25);
  --shadow-elevated: inset 0 1px 1px rgba(255,255,255,0.05), 0 4px 12px rgba(0,0,0,0.2);
}
```

### Typography

- **Font Family**: Inter (Google Fonts)
- **Monospace**: JetBrains Mono (for IPs, IDs)
- **Weights**: 400 (regular), 500 (medium), 600 (semibold), 700 (bold)

---

## State Management

### Zustand Store (`app-store.ts`)

```typescript
interface AppState {
  sidebarCollapsed: boolean;
  selectedVmId: string | null;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  selectVm: (id: string | null) => void;
}
```

### TanStack Query

Used for server state management (to be connected to gRPC backend):

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      refetchOnWindowFocus: false,
    },
  },
});
```

---

## Mock Data Structure

Located in `frontend/src/data/mock-data.ts`:

### VirtualMachine

```typescript
interface VirtualMachine {
  id: string;
  name: string;
  projectId: string;
  spec: {
    cpu: { cores: number; sockets: number; model: string };
    memory: { sizeMib: number };
    disks: Array<{ id: string; sizeGib: number; bus: string }>;
    nics: Array<{ id: string; networkId: string; macAddress: string }>;
  };
  status: {
    state: PowerState;
    nodeId: string;
    ipAddresses: string[];
    resourceUsage: ResourceUsage;
    guestInfo: GuestInfo;
  };
}
```

### Node

```typescript
interface Node {
  id: string;
  hostname: string;
  managementIp: string;
  spec: { cpu: CpuInfo; memory: MemoryInfo };
  status: { phase: NodePhase; vmIds: string[]; resources: ResourceAllocation };
}
```

---

## Responsive Design

### Breakpoints

```css
@media (max-width: 1279px) {
  /* 2-column grid for metric cards */
}

@media (max-width: 767px) {
  /* Single column layout */
}
```

### Flex Layout

Metric cards use flex with `min-w-[200px]` for natural responsive behavior:

```tsx
<div className="flex flex-wrap gap-4">
  <div className="flex-1 min-w-[200px]">
    <MetricCard ... />
  </div>
</div>
```

---

## Animation System

### Framer Motion Patterns

**Staggered Entrance**:
```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.4, delay: index * 0.1 }}
>
```

**Sidebar Collapse**:
```tsx
<motion.aside
  animate={{ width: collapsed ? 64 : 260 }}
  transition={{ duration: 0.2, ease: 'easeInOut' }}
>
```

**Expand/Collapse Navigation**:
```tsx
<AnimatePresence>
  {expanded && (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
    />
  )}
</AnimatePresence>
```

---

## File Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Layout.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── Header.tsx
│   │   ├── dashboard/
│   │   │   ├── MetricCard.tsx
│   │   │   ├── ProgressRing.tsx
│   │   │   ├── ResourceCard.tsx
│   │   │   └── NodeCard.tsx
│   │   └── vm/
│   │       ├── VMStatusBadge.tsx
│   │       └── VMTable.tsx
│   ├── pages/
│   │   └── Dashboard.tsx
│   ├── stores/
│   │   └── app-store.ts
│   ├── data/
│   │   └── mock-data.ts
│   ├── lib/
│   │   └── utils.ts
│   ├── index.css
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── vite.config.ts
└── tsconfig.app.json
```

---

## Running the Dashboard

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

---

## Next Steps

1. Implement page routing (React Router)
2. Build VM detail view with tabs
3. Build Host/Node detail view
4. Build Storage management pages
5. Build Network management pages
6. Connect to gRPC backend with Connect-ES
7. Implement real-time updates with streaming

---

## References

- [UI-Expert Guidelines](../.cursor/rules/ui-expert.mdc)
- [Proto Infrastructure](../.cursor/rules/proto-infrastructure.mdc)
- [VMware vCenter 8 UI](https://docs.vmware.com/en/VMware-vSphere/8.0/vsphere-vcenter-configuration/GUID-7ECBE50A-9C80-468F-8F63-6C63BBDC3B6E.html)

