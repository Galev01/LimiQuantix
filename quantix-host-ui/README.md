# Quantix Host UI

**ESXi Host Client-like web interface for direct Quantix-OS hypervisor management.**

This is the web-based management interface that runs on every Quantix-OS node, providing remote management via browser while the [Slint console GUI](../docs/Quantix-OS/000053-console-gui-slint.md) provides local DCUI management.

## Overview

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

This UI is baked into the Quantix-OS ISO during build time:

1. **Build Time**: UI is compiled to static files and copied to `/usr/share/quantix/webui/`
2. **Runtime**: Node daemon serves these files on `https://<ip>:8443`
3. **Configuration**: Uses the same `/quantix/` config directory as the console GUI

### Relationship with Console GUI

| Feature | Console GUI (Slint) | Host UI (React) |
|---------|---------------------|-----------------|
| Access | Local TTY1 only | Remote via browser |
| First Boot | ✅ Setup wizard | ❌ Requires setup complete |
| Network Config | ✅ Full control | ⚠️ View only (future) |
| SSH Management | ✅ Enable/disable | ⚠️ View only (future) |
| Emergency Shell | ✅ Authenticated | ❌ Not available |
| VM Management | ❌ Not available | ✅ Full CRUD |
| Storage Pools | ❌ Status only | ✅ Full management |
| Performance | ❌ Basic stats | ✅ Charts + history |
| Console Access | ❌ N/A | ✅ qvmc deep link |

## Features

- **Dashboard**: Host overview with CPU, memory, storage rings
- **Virtual Machines**: Create, start, stop, delete VMs
- **Storage Pools**: Manage local, NFS, Ceph storage
- **Networking**: View network configuration
- **Performance**: Real-time metrics with Recharts
- **Events**: System event log with filtering
- **qvmc Integration**: One-click console access via native app

## Technology Stack

- **React 19** + TypeScript
- **Vite** for development and building
- **Tailwind CSS v4** for styling
- **TanStack Query** for server state
- **Zustand** for client state
- **Framer Motion** for animations
- **Lucide React** for icons
- **Recharts** for performance charts

## Development

```bash
# Install dependencies
npm install

# Start development server (port 3001)
npm run dev
```

The dev server proxies API calls to `localhost:8443` (node daemon).

## Production Build

```bash
# Build optimized static files
npm run build

# Output: dist/
```

## Building with Quantix-OS

The Makefile target handles integration:

```bash
cd quantix-os

# Build Host UI and include in ISO
make webui iso

# Or just build the webui
make webui
# Outputs to: overlay/usr/share/quantix/webui/
```

### Build Process

```
┌────────────────────────────────────────────────────────────────┐
│  quantix-os/Makefile                                           │
│                                                                 │
│  webui:                                                         │
│      cd ../quantix-host-ui && npm install && npm run build     │
│      cp -r ../quantix-host-ui/dist/* overlay/usr/share/...     │
│                                                                 │
│  iso: webui console-gui ...                                     │
│      # Include webui in squashfs                                │
└────────────────────────────────────────────────────────────────┘
```

## File Layout on Quantix-OS

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
    ├── admin.yaml                   # Admin credentials (from setup wizard)
    └── certificates/                # TLS certs
```

## API Endpoints

The node daemon exposes REST endpoints that mirror the gRPC service:

```
GET  /                        # Serves index.html (webui)
GET  /assets/*                # Static files

GET  /api/v1/host             # Host info (hostname, CPU, memory, etc.)
GET  /api/v1/host/health      # Health check
GET  /api/v1/host/hardware    # Hardware inventory

GET  /api/v1/vms              # List VMs
POST /api/v1/vms              # Create VM
GET  /api/v1/vms/:id          # Get VM details
POST /api/v1/vms/:id/start    # Start VM
POST /api/v1/vms/:id/stop     # Graceful shutdown
POST /api/v1/vms/:id/console  # Get console connection info

GET  /api/v1/storage/pools    # List storage pools
GET  /api/v1/storage/images   # List ISOs/images

WS   /api/v1/ws               # Real-time updates (metrics, events)
```

## Authentication

The webui uses the same admin credentials created during the Slint console's first-boot wizard:

1. **Setup Required**: Node must complete first-boot setup via console GUI
2. **Login**: Username/password from `/quantix/admin.yaml`
3. **Session**: JWT token stored in browser localStorage
4. **TLS**: All connections over HTTPS (self-signed cert by default)

## Console Access (qvmc)

Clicking "Console" on a running VM launches qvmc:

```typescript
import { launchqvmc } from '@/lib/qvmc';

launchqvmc({
  hostUrl: window.location.origin,  // https://192.168.1.100:8443
  vmId: 'vm-abc123',
  vmName: 'Ubuntu Server',
});
// Opens: qvmc://connect?url=https://...&vm=vm-abc123&name=Ubuntu%20Server
```

## Configuration

### Development

Edit `vite.config.ts`:
- Port: 3001 (default)
- API proxy: http://localhost:8443

### Production

The webui reads configuration from the node daemon's API. No separate config file needed.

## Logging

The webui logs to browser console. Server-side logging is handled by the node daemon (see [000051-quantix-os-logging-diagnostics.md](../docs/Quantix-OS/000051-quantix-os-logging-diagnostics.md)).

## Related Documentation

- [000052 - Quantix-OS Architecture](../docs/Quantix-OS/000052-quantix-os-architecture.md)
- [000053 - Console GUI (Slint)](../docs/Quantix-OS/000053-console-gui-slint.md)
- [000051 - Logging & Diagnostics](../docs/Quantix-OS/000051-quantix-os-logging-diagnostics.md)
- [000056 - Host UI Architecture](../docs/ui/000056-host-ui-architecture.md)

## License

Part of the Quantix-KVM project. Apache 2.0.
