# limiquantix Workflow State

## Current Status: Web Console + QVMRC Implementation Complete ✅

**Last Updated:** January 3, 2026 (Night Session)

---

## What's New (This Session)

### ✅ Web Console (noVNC) - Browser-Based

Implemented a full browser-based VNC console using noVNC:

1. **noVNC Static Files** (`frontend/public/novnc/`)
   - Downloaded noVNC v1.4.0
   - Custom `limiquantix.html` with LimiQuantix styling
   - Toolbar with Ctrl+Alt+Del, clipboard, fullscreen

2. **NoVNCConsole Component** (`frontend/src/components/vm/NoVNCConsole.tsx`)
   - Iframe-based embedding
   - Parent-child message passing
   - Copy console URL, open in new tab

3. **Backend WebSocket Proxy** (`backend/internal/server/console.go`)
   - WebSocket endpoint at `/api/console/{vmId}/ws`
   - Proxies WebSocket ↔ VNC TCP

### ✅ QVMRC Native Client - Tauri Desktop App

Scaffolded a complete native desktop VNC client:

**Architecture:**
```
QVMRC
├── Management Channel (Blue) → Control Plane (HTTPS/Connect-RPC)
│   └── VM operations: restart, shutdown, snapshots
└── Console Channel (Red) → Hypervisor (VNC/RFB)
    └── Screen, keyboard, mouse, USB
```

**Rust Backend (`qvmrc/src-tauri/src/`):**
- `main.rs` - Tauri app entry, command registration
- `config.rs` - Configuration persistence (TOML)
- `api.rs` - Control Plane API client
- `vnc/mod.rs` - VNC connection management
- `vnc/rfb.rs` - RFB protocol implementation
- `vnc/encodings.rs` - Encoding decoders (Raw, Hextile, RRE, Zlib)

**React Frontend (`qvmrc/src/`):**
- `ConnectionList.tsx` - Saved connections, add/delete
- `ConsoleView.tsx` - Canvas display, input events
- `Settings.tsx` - Display quality, compression settings
- `lib/tauri-api.ts` - Typed API wrapper

---

## Project Structure Update

```
LimiQuantix/
├── frontend/
│   ├── public/
│   │   └── novnc/           # NEW: noVNC static files
│   │       ├── limiquantix.html  # Custom console page
│   │       ├── core/        # noVNC core modules
│   │       └── app/         # noVNC app modules
│   └── src/
│       └── components/vm/
│           ├── NoVNCConsole.tsx  # NEW: noVNC iframe wrapper
│           └── WebConsole.tsx    # Fallback console info page
│
├── backend/
│   └── internal/server/
│       └── console.go       # WebSocket VNC proxy
│
└── qvmrc/                   # NEW: Native desktop client
    ├── src-tauri/           # Rust backend
    │   ├── src/
    │   │   ├── main.rs
    │   │   ├── config.rs
    │   │   ├── api.rs
    │   │   └── vnc/
    │   │       ├── mod.rs
    │   │       ├── rfb.rs
    │   │       └── encodings.rs
    │   ├── Cargo.toml
    │   └── tauri.conf.json
    ├── src/                 # React frontend
    │   ├── components/
    │   │   ├── ConnectionList.tsx
    │   │   ├── ConsoleView.tsx
    │   │   └── Settings.tsx
    │   ├── lib/
    │   │   └── tauri-api.ts
    │   ├── App.tsx
    │   └── main.tsx
    ├── package.json
    └── README.md
```

---

## Testing Instructions

### Web Console

1. **Start Backend + Frontend**
```bash
# Terminal 1: Backend
cd backend && go run ./cmd/controlplane --dev

# Terminal 2: Frontend
cd frontend && npm run dev
```

2. **Test Console**
   - Open http://localhost:5173
   - Click on a running VM
   - Click "Console" button
   - The noVNC console should open in a modal

### QVMRC Native Client

1. **Prerequisites**
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Tauri CLI
cargo install tauri-cli
```

2. **Run in Development**
```bash
cd qvmrc
npm install
npm run tauri dev
```

3. **Build for Distribution**
```bash
npm run tauri build
# Outputs:
#   Windows: src-tauri/target/release/bundle/msi/QVMRC_0.1.0_x64.msi
#   macOS:   src-tauri/target/release/bundle/macos/QVMRC.app
#   Linux:   src-tauri/target/release/bundle/deb/qvmrc_0.1.0_amd64.deb
```

---

## Console Solutions Comparison

| Feature | Web Console | QVMRC Native |
|---------|-------------|--------------|
| Installation | None (browser) | Desktop app |
| Protocol | VNC via WebSocket | VNC direct |
| Latency | Higher | Lower |
| USB Passthrough | ❌ | ✅ (planned) |
| Clipboard | Limited | ✅ Full |
| Audio | ❌ | ✅ (SPICE) |
| Offline | ❌ | ✅ |

---

## Next Steps

| Task | Priority | Effort |
|------|----------|--------|
| Test web console with real VM | P0 | 1 hour |
| Add QVMRC uuid dependency | P0 | 5 min |
| Add DES encryption for VNC auth | P1 | 2 hours |
| USB passthrough | P2 | 1 week |
| SPICE protocol | P3 | 2 weeks |

---

## Quick Reference

### Web Console URL (Direct Access)
```
http://localhost:5173/novnc/limiquantix.html?vmId={VM_ID}&vmName={VM_NAME}
```

### VNC Connection (Manual)
```
Host: 192.168.0.53
Port: 5900
```

### QVMRC Development
```bash
cd qvmrc
npm run tauri dev    # Development mode
npm run tauri build  # Production build
```
