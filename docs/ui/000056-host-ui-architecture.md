# 000056 - Quantix Host UI Architecture

**Description:** Documentation for the standalone Quantix-OS Host Management UI - an ESXi Host Client-like interface for direct hypervisor management.

## Overview

The `quantix-host-ui` is a lightweight React application designed to run directly on a Quantix-OS hypervisor node. It provides:

- **Standalone Mode**: Direct management of a single hypervisor host
- **ESXi-like Experience**: Familiar UI patterns from VMware ESXi Host Client
- **QVMRC Integration**: Deep link launching of the native console application
- **Real-time Updates**: WebSocket-based live status updates

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Browser                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              quantix-host-ui (React SPA)                  │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐ │  │
│  │  │Dashboard│ │ VMs     │ │ Storage │ │ Hardware/Config │ │  │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────────┬────────┘ │  │
│  │       └───────────┴──────────┴────────────────┘          │  │
│  │                        ↓                                  │  │
│  │              TanStack Query + Zustand                     │  │
│  │                        ↓                                  │  │
│  │              API Client (fetch + WebSocket)               │  │
│  └──────────────────────┬───────────────────────────────────┘  │
│                         ↓                                       │
└─────────────────────────┬───────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Quantix-OS Host                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Node Daemon (Rust)                          │  │
│  │  ┌─────────────────┐  ┌─────────────────────────────┐   │  │
│  │  │ REST/WS Gateway │←→│     gRPC Service            │   │  │
│  │  │   (Port 8443)   │  │                             │   │  │
│  │  └────────┬────────┘  └──────────────┬──────────────┘   │  │
│  │           │                          │                   │  │
│  │           ↓                          ↓                   │  │
│  │  ┌────────────────┐      ┌─────────────────────────┐    │  │
│  │  │ Static Files   │      │    Hypervisor Layer     │    │  │
│  │  │ (UI Build)     │      │  (libvirt/QEMU/KVM)     │    │  │
│  │  └────────────────┘      └─────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | React 19 | UI Components |
| Build Tool | Vite | Development & bundling |
| Type Safety | TypeScript | Static typing |
| State (Global) | Zustand | Theme, sidebar, preferences |
| State (Server) | TanStack Query | API caching, mutations |
| Styling | Tailwind CSS v4 | Design system |
| Icons | Lucide React | Consistent iconography |
| Charts | Recharts | Performance monitoring |
| Animations | Framer Motion | Smooth transitions |
| Toasts | Sonner | Notifications |

## Project Structure

```
quantix-host-ui/
├── src/
│   ├── main.tsx                # Entry point
│   ├── App.tsx                 # Router & providers
│   ├── index.css               # Tailwind + theme tokens
│   │
│   ├── api/                    # API Client Layer
│   │   ├── client.ts           # HTTP/WS client
│   │   ├── types.ts            # TypeScript interfaces
│   │   ├── host.ts             # Host/hardware endpoints
│   │   ├── vm.ts               # VM operations
│   │   └── storage.ts          # Storage pools/volumes
│   │
│   ├── hooks/                  # React Query Hooks
│   │   ├── useHost.ts          # Host info, health, hardware
│   │   ├── useVMs.ts           # VM list, power ops, snapshots
│   │   └── useStorage.ts       # Pools, volumes, images
│   │
│   ├── stores/                 # Zustand Stores
│   │   └── useAppStore.ts      # App state (sidebar, theme)
│   │
│   ├── pages/                  # Page Components
│   │   ├── Dashboard.tsx       # Host overview
│   │   └── VirtualMachines.tsx # VM list
│   │
│   ├── components/
│   │   ├── layout/             # Shell components
│   │   │   ├── Layout.tsx      # Main layout wrapper
│   │   │   ├── Sidebar.tsx     # Navigation sidebar
│   │   │   └── Header.tsx      # Page headers
│   │   │
│   │   └── ui/                 # Base UI components
│   │       ├── Button.tsx
│   │       ├── Badge.tsx
│   │       ├── Card.tsx
│   │       └── ProgressRing.tsx
│   │
│   └── lib/                    # Utilities
│       ├── utils.ts            # cn(), formatBytes(), etc.
│       ├── qvmrc.ts            # QVMRC deep link launcher
│       └── toast.ts            # Toast helpers
│
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tsconfig.app.json
```

## Pages

### Dashboard
- Host identification (hostname, IP, version)
- Resource rings (CPU, Memory, Storage usage)
- Quick stats (VMs, cores, memory, uptime)
- Recent VMs list with status
- System information panel
- Storage pools overview

### Virtual Machines
- Sortable/filterable VM table
- Power state badges with color coding
- One-click power operations (start, stop, reboot, pause)
- Console button (launches QVMRC)
- VM details link

### Planned Pages
- **VM Detail**: Tabs for summary, console, settings, snapshots, events
- **Storage Pools**: Pool management, capacity monitoring
- **Volumes**: Volume creation, resizing, attachment
- **Networking**: Virtual networks, physical NICs, OVS bridges
- **Hardware**: CPU, memory, storage devices, GPUs, sensors
- **Performance**: Real-time charts with Recharts
- **Events**: Filtered event log
- **Configuration**: Host settings, services, certificates

## API Endpoints

The UI communicates with the node daemon's REST gateway:

```
GET  /api/v1/host              # Host info
GET  /api/v1/host/health       # Health check
GET  /api/v1/host/hardware     # Hardware inventory

GET  /api/v1/vms               # List VMs
POST /api/v1/vms               # Create VM
GET  /api/v1/vms/:id           # Get VM
POST /api/v1/vms/:id/start     # Start VM
POST /api/v1/vms/:id/stop      # Stop VM
GET  /api/v1/vms/:id/console   # Console info

GET  /api/v1/storage/pools     # Storage pools
GET  /api/v1/storage/images    # ISO library

WS   /api/v1/ws                # Real-time updates
```

## QVMRC Integration

The UI can launch QVMRC (native console app) via deep links:

```typescript
import { launchQVMRC } from '@/lib/qvmrc';

launchQVMRC({
  hostUrl: 'https://192.168.1.100:8443',
  vmId: 'vm-abc123',
  vmName: 'Ubuntu Server',
});
// Opens: qvmrc://connect?url=https://...&vm=vm-abc123&name=Ubuntu%20Server
```

## Design System

Inherits the Quantix design system from the main frontend:

### Colors
- `--color-bg-base`: #0f1117 (darkest)
- `--color-bg-surface`: #161922 (cards)
- `--color-bg-elevated`: #1e222d (active states)
- `--color-accent`: #3b82f6 (VMware-inspired blue)

### Shadows
- `shadow-floating`: Cards and buttons
- `shadow-elevated`: Active/selected items
- `shadow-recessed`: Tables and input fields

### Components
All components follow the UI Expert rules for visual hierarchy, depth, and proper hover states.

## Development

```bash
# Navigate to project
cd quantix-host-ui

# Install dependencies
npm install

# Development server (port 3001)
npm run dev

# Production build
npm run build
```

## Deployment

The built UI is served by the node daemon:

1. Build the UI: `npm run build`
2. Copy `dist/` to node daemon's static file path
3. Node daemon serves files on port 8443

## Future Enhancements

- [ ] WebSocket-based real-time updates
- [ ] VM creation wizard with cloud-init
- [ ] Performance charts with historical data
- [ ] ISO upload and management
- [ ] SSH key management
- [ ] Dark/light theme toggle
- [ ] Keyboard shortcuts
- [ ] Cluster mode (join/leave cluster)

## Related Documentation

- [Node Daemon Implementation](../node-daemon/000031-node-daemon-implementation-plan.md)
- [Console Access](../console-access/000042-console-access-implementation.md)
- [QVMRC Native Client](../console-access/000043-qvmrc-native-client.md)
- [UI Design System](000007-dashboard-ui-guide.md)
