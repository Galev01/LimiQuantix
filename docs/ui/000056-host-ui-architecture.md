# 000056 - Quantix Host UI Architecture

**Description:** Documentation for the Quantix-OS Host Management UI - the web-based ESXi Host Client-like interface for remote hypervisor management. This complements the local Slint console GUI (DCUI).

**Related Documents:**
- [000052 - Quantix-OS Architecture](../Quantix-OS/000052-quantix-os-architecture.md)
- [000053 - Console GUI (Slint)](../Quantix-OS/000053-console-gui-slint.md)
- [000051 - Logging & Diagnostics](../Quantix-OS/000051-quantix-os-logging-diagnostics.md)

## Overview

The `quantix-host-ui` is a lightweight React application that runs on every Quantix-OS node, providing **remote management via web browser**. It works alongside the Slint console GUI which handles local DCUI management.

### Two Consoles, One Node

| Feature | Console GUI (Slint) | Host UI (React) |
|---------|---------------------|-----------------|
| **Access** | Local TTY1 only | Remote via browser |
| **First Boot** | ✅ Setup wizard | ❌ Requires setup complete |
| **Network Config** | ✅ Full control | ⚠️ View only (future) |
| **SSH Management** | ✅ Enable/disable | ⚠️ View only (future) |
| **Emergency Shell** | ✅ Authenticated | ❌ Not available |
| **VM Management** | ❌ Not available | ✅ Full CRUD |
| **Storage Pools** | ❌ Status only | ✅ Full management |
| **Performance** | ❌ Basic stats | ✅ Charts + history |
| **Console Access** | ❌ N/A | ✅ qvmc deep link |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Quantix-OS Node                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LOCAL (Physical Console)     │    REMOTE (Web Browser)         │
│  ┌────────────────────────┐   │   ┌────────────────────────┐   │
│  │  Slint Console GUI     │   │   │   Quantix Host UI      │   │
│  │  (DCUI - TTY1)         │   │   │   (Port 8443)          │   │
│  │                        │   │   │                        │   │
│  │  - First boot wizard   │   │   │  - Dashboard           │   │
│  │  - Network config      │   │   │  - VM management       │   │
│  │  - SSH enable/disable  │   │   │  - Storage pools       │   │
│  │  - Emergency shell     │   │   │  - Performance charts  │   │
│  │  - Cluster join        │   │   │  - qvmc console       │   │
│  └────────────────────────┘   │   └────────────────────────┘   │
│            │                  │              │                  │
│            └──────────────────┼──────────────┘                  │
│                               │                                 │
│                               ▼                                 │
│              ┌─────────────────────────────────┐                │
│              │       Node Daemon (Rust)        │                │
│              │  - gRPC API (port 9443)         │                │
│              │  - REST/WebSocket (port 8443)   │                │
│              │  - Static file serving          │                │
│              └─────────────────────────────────┘                │
│                               │                                 │
│              ┌────────────────┼────────────────┐                │
│              ▼                ▼                ▼                │
│         libvirtd          OVS/OVN         Storage               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Integration with Quantix-OS

The Host UI is baked into the Quantix-OS ISO during build time:

### Build Process

```
┌────────────────────────────────────────────────────────────────┐
│  quantix-os/Makefile                                           │
│                                                                 │
│  webui:                                                         │
│      cd ../quantix-host-ui && npm ci && npm run build          │
│      cp -r ../quantix-host-ui/dist/* overlay/usr/share/...     │
│                                                                 │
│  iso: webui console-gui ...                                     │
│      # Include webui in squashfs                                │
└────────────────────────────────────────────────────────────────┘
```

### File Layout on Quantix-OS

```
/                                    # OverlayFS root
├── usr/
│   ├── bin/
│   │   ├── qx-node                  # Node daemon (serves webui)
│   │   └── qx-console-gui           # Slint console GUI
│   └── share/
│       └── quantix/
│           └── webui/               # ← This project's build output
│               ├── index.html
│               ├── assets/
│               │   ├── index-xxx.js
│               │   └── index-xxx.css
│               └── icon.png
│
└── quantix/                         # Persistent config (Part 4)
    ├── node.yaml                    # Node configuration
    ├── admin.yaml                   # Admin credentials (from console wizard)
    └── certificates/                # TLS certs
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
│       ├── qvmc.ts            # qvmc deep link launcher
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
- Console button (launches qvmc)
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

## qvmc Integration

The UI can launch qvmc (native console app) via deep links:

```typescript
import { launchqvmc } from '@/lib/qvmc';

launchqvmc({
  hostUrl: 'https://192.168.1.100:8443',
  vmId: 'vm-abc123',
  vmName: 'Ubuntu Server',
});
// Opens: qvmc://connect?url=https://...&vm=vm-abc123&name=Ubuntu%20Server
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

### Node Daemon HTTP Server

The node daemon (`limiquantix-node`) includes an Axum-based HTTP server that:

1. **Serves Static Files**: The React SPA from `/usr/share/quantix/webui/`
2. **REST API Gateway**: Proxies requests to the gRPC service
3. **SPA Fallback**: All unknown routes return `index.html` for client-side routing

```rust
// Configuration (from /etc/limiquantix/node.yaml or CLI)
server:
  http:
    enabled: true
    listen_address: "0.0.0.0:8443"
    webui_path: "/usr/share/quantix/webui"
```

#### CLI Options

```bash
limiquantix-node \
  --http-listen 0.0.0.0:8443 \
  --webui-path /usr/share/quantix/webui \
  --no-webui  # Disable HTTP server entirely
```

### Build Integration

The Quantix-OS Makefile automates the build:

```bash
# Build just the webui
make webui

# Build complete ISO (includes webui)
make iso VERSION=1.0.0
```

The webui target:
1. Runs `npm ci` in `quantix-host-ui/`
2. Runs `npm run build`
3. Copies `dist/*` to `overlay/usr/share/quantix/webui/`

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
- [qvmc Native Client](../console-access/000043-qvmc-native-client.md)
- [UI Design System](000007-dashboard-ui-guide.md)
