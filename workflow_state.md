# LimiQuantix Workflow State

## Current Status: QVMRC WebSocket Proxy Fix 🔧

**Last Updated:** January 3, 2026 (Session 5 - VNC Connection Fix)

---

## 🔧 Active Task: QVMRC VNC Connection Fix

### Problem

QVMRC shows error: "Handshake failed: Authentication failed: Sorry, loopback connections are not enabled"

**Root Cause:**
1. QVMRC calls `GetConsole` API which returns `host: "127.0.0.1"` (from hypervisor's perspective)
2. QVMRC tries to connect directly to `127.0.0.1:PORT` from user's Windows machine
3. This can't reach the hypervisor's localhost - the VNC server rejects it

**Why Web Console Works:**
- Web console uses WebSocket proxy at `/api/console/{vmId}/ws`
- Backend connects to VNC from hypervisor host, then proxies over WebSocket
- User's browser connects to backend, not directly to VNC

### Solution

Make QVMRC use WebSocket proxy like web console instead of direct VNC connection.

**Architecture Change:**
```
BEFORE (broken):
┌──────────┐                    ┌─────────────┐     ┌─────────┐
│  QVMRC   │──X──Direct TCP────X│  Hypervisor │─────│   VM    │
│ (Windows)│     127.0.0.1:5900 │  (Linux)    │     │   VNC   │
└──────────┘                    └─────────────┘     └─────────┘

AFTER (working):
┌──────────┐     ┌──────────┐     ┌─────────────┐     ┌─────────┐
│  QVMRC   │─────│  Backend │─────│  Hypervisor │─────│   VM    │
│ (Windows)│ WS  │  (Go)    │ TCP │  (Linux)    │     │   VNC   │
└──────────┘     └──────────┘     └─────────────┘     └─────────┘
                 /api/console/{vmId}/ws
```

### Implementation Plan

1. **Update QVMRC API** (`qvmrc/src-tauri/src/api.rs`):
   - Modify `get_console_info` to return WebSocket URL instead of VNC host/port
   - Return `websocketUrl: ws://controlPlane/api/console/{vmId}/ws`

2. **Update QVMRC VNC Client** (`qvmrc/src-tauri/src/vnc/mod.rs`):
   - Change `connect_vnc` to connect via WebSocket instead of direct TCP
   - Use `tokio-tungstenite` for WebSocket client

3. **Update RFBClient** (`qvmrc/src-tauri/src/vnc/rfb.rs`):
   - Create variant that works over WebSocket stream instead of TcpStream

### Files to Modify

| File | Changes |
|------|---------|
| `qvmrc/src-tauri/Cargo.toml` | Add `tokio-tungstenite` dependency |
| `qvmrc/src-tauri/src/api.rs` | Return websocket URL from console info |
| `qvmrc/src-tauri/src/vnc/mod.rs` | Connect via WebSocket proxy |
| `qvmrc/src-tauri/src/vnc/rfb.rs` | Support WebSocket stream transport |

---

## ✅ Previous Session (Session 4 - Jan 3, 2026)

### Console Reconnection UX Fix
- Added loading overlay during reconnection
- Fixed race condition with vnc:connected event
- Added debug logging panel to QVMRC
- Fixed power action name consistency

### Files Updated
- `frontend/public/novnc/limiquantix.html`
- `qvmrc/src/components/ConsoleView.tsx`
- `qvmrc/src/lib/debug-logger.ts`
- `qvmrc/src/components/DebugPanel.tsx`
- `qvmrc/src/index.css`

---

## Build Commands

```bash
# Backend
cd backend && go build ./...

# QVMRC
cd qvmrc/src-tauri && cargo build

# Frontend
cd frontend && npm run dev
```
