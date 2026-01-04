# Workflow State: Quantix-OS Host Management UI

## Status: Planning Phase

### Overview

Building a new React application (`quantix-host-ui/`) that provides direct management of a Quantix-OS hypervisor host, similar to ESXi's Host Client.

---

## Analysis Summary

### Existing Infrastructure
- **Main Frontend** (`frontend/`): React 19 + Vite + TypeScript + Tailwind CSS v4
- **Node Daemon** (`agent/limiquantix-node/`): Rust gRPC service with full VM/Storage/Network operations
- **Proto Definitions** (`proto/limiquantix/`): Complete API definitions for compute, storage, network, node
- **QVMRC** (`qvmrc/`): Tauri-based native console client with VNC support

### Key Decisions Required

1. **Approach**: New standalone app vs. integrate into existing frontend?
   - **Recommendation**: Create `quantix-host-ui/` as a **standalone lightweight app** optimized for single-host management
   - Rationale: Different use case (local host vs. cluster), smaller bundle, direct node daemon communication

2. **Backend API Gateway**: Rust HTTP server in node daemon vs. Go sidecar?
   - **Recommendation**: Add **Axum HTTP/WebSocket** to existing Rust node daemon
   - Rationale: Single binary, no additional dependencies, gRPC already implemented

3. **Code Sharing**: Reuse patterns from main frontend
   - Copy: Tailwind config, UI components, design tokens
   - Reference: API patterns, hook patterns, store patterns
   - Unique: Simplified routing (single host context), direct daemon connection

---

## Implementation Plan

### Phase 1: Project Foundation (Current)
- [x] Analyze plan and existing codebase
- [ ] Create `quantix-host-ui/` project structure
- [ ] Set up Vite + React 19 + TypeScript + Tailwind
- [ ] Copy shared UI components and design tokens
- [ ] Create layout shell (sidebar, header, navigation)
- [ ] Build API client for REST/WebSocket

### Phase 2: Dashboard & Core Pages
- [ ] Dashboard page with host overview
- [ ] Host hardware inventory page
- [ ] Basic VM list with power operations

### Phase 3: VM Management
- [ ] VM detail page with tabs
- [ ] Create VM wizard
- [ ] Console access (QVMRC deep link + Web VNC)
- [ ] Snapshots management

### Phase 4: Storage & Network
- [ ] Storage pools page
- [ ] Volumes management
- [ ] Network configuration page
- [ ] Physical NIC status

### Phase 5: Advanced Features
- [ ] Performance monitoring charts
- [ ] Tasks & events pages
- [ ] Host configuration/services
- [ ] Real-time WebSocket updates

---

## File Structure

```
quantix-host-ui/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/                    # API client layer
│   │   ├── client.ts           # HTTP/WS client to node daemon
│   │   ├── vm.ts               # VM operations
│   │   ├── storage.ts          # Storage pools/volumes
│   │   ├── network.ts          # Network configuration
│   │   └── host.ts             # Host/system info
│   ├── hooks/                  # React Query hooks
│   │   ├── useVMs.ts
│   │   ├── useStorage.ts
│   │   ├── useNetwork.ts
│   │   ├── useHost.ts
│   │   └── useEvents.ts
│   ├── stores/                 # Zustand stores
│   │   └── useAppStore.ts      # App state (theme, sidebar)
│   ├── pages/                  # Main pages
│   │   ├── Dashboard.tsx
│   │   ├── VirtualMachines.tsx
│   │   ├── VMDetail.tsx
│   │   ├── Storage.tsx
│   │   ├── Networking.tsx
│   │   ├── Hardware.tsx
│   │   ├── Monitor.tsx
│   │   └── Events.tsx
│   ├── components/
│   │   ├── layout/             # Shell, sidebar, header
│   │   ├── vm/                 # VM-specific components
│   │   ├── storage/            # Storage components
│   │   ├── charts/             # Performance charts
│   │   └── ui/                 # Base UI components (copied from main frontend)
│   └── lib/
│       ├── utils.ts
│       ├── qvmrc.ts            # QVMRC deep link launcher
│       └── websocket.ts        # WebSocket for real-time updates
├── index.html
├── package.json
├── tailwind.config.js
├── vite.config.ts
└── tsconfig.json
```

---

## Backend Changes Required

### Node Daemon HTTP Gateway
Add to `agent/limiquantix-node/`:
- Axum HTTP server on port 8443
- REST endpoints proxying to gRPC
- Static file serving for UI build
- WebSocket endpoint for real-time updates

### API Endpoints
```
GET  /api/v1/host              # Host info, status
GET  /api/v1/host/hardware     # Hardware inventory
GET  /api/v1/vms               # List VMs
POST /api/v1/vms               # Create VM
GET  /api/v1/vms/:id           # Get VM
POST /api/v1/vms/:id/start     # Start VM
POST /api/v1/vms/:id/stop      # Stop VM
GET  /api/v1/vms/:id/console   # Console info
GET  /api/v1/storage/pools     # Storage pools
GET  /api/v1/network/nics      # Physical NICs
WS   /api/v1/ws                # Real-time updates
```

---

## Notes

- Reuse existing Tailwind design system from `frontend/`
- QVMRC integration via `qvmrc://` deep link already exists
- Node daemon already has all gRPC methods needed
- Focus on ESXi Host Client-like simplicity
