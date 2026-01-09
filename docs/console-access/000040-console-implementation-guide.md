# 000040 - Console Implementation Guide

**Purpose:** Document the architecture and implementation plan for VM console access in LimiQuantix.

---

## Overview

LimiQuantix needs two console access methods:
1. **Web Console (noVNC)** - Zero-install, browser-based access
2. **qvmc (Quantix VM Remote Console)** - Native desktop client for power users

---

## Option 1: Web Console (noVNC) - Recommended First

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    noVNC JavaScript                       │   │
│  │              (WebSocket VNC Client)                       │   │
│  └──────────────────────┬──────────────────────────────────┘   │
└─────────────────────────┼───────────────────────────────────────┘
                          │ WebSocket (wss://)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Control Plane (Go)                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              WebSocket Proxy Handler                      │   │
│  │   - Authenticates user session                           │   │
│  │   - Looks up VM → Node mapping                           │   │
│  │   - Proxies WebSocket to Node Daemon                     │   │
│  └──────────────────────┬──────────────────────────────────┘   │
└─────────────────────────┼───────────────────────────────────────┘
                          │ gRPC / TCP
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Node Daemon (Rust)                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              VNC WebSocket Bridge                         │   │
│  │   Option A: Direct to QEMU WebSocket port                │   │
│  │   Option B: Use tokio-tungstenite to bridge TCP→WS       │   │
│  └──────────────────────┬──────────────────────────────────┘   │
└─────────────────────────┼───────────────────────────────────────┘
                          │ VNC Protocol (TCP or WebSocket)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                         QEMU/KVM                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              VNC Server (built-in)                        │   │
│  │   - Port 5900+ (TCP)                                     │   │
│  │   - WebSocket port (if enabled)                          │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Steps

#### Step 1: Enable QEMU WebSocket Support

Modify libvirt VM XML to enable WebSocket:
```xml
<graphics type='vnc' port='-1' autoport='yes' websocket='-1' listen='0.0.0.0'>
  <listen type='address' address='0.0.0.0'/>
</graphics>
```

The `websocket='-1'` means QEMU auto-assigns a WebSocket port.

#### Step 2: Node Daemon VNC Proxy

Add a WebSocket proxy in the Node Daemon:

```rust
// agent/limiquantix-node/src/vnc_proxy.rs

use tokio::net::TcpStream;
use tokio_tungstenite::{accept_async, connect_async, WebSocketStream};
use futures_util::{SinkExt, StreamExt};

pub async fn proxy_vnc_websocket(
    client_ws: WebSocketStream<TcpStream>,
    vnc_host: &str,
    vnc_port: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    // Connect to QEMU VNC
    let vnc_stream = TcpStream::connect((vnc_host, vnc_port)).await?;
    
    // Bridge WebSocket ↔ TCP
    let (mut ws_write, mut ws_read) = client_ws.split();
    let (mut vnc_read, mut vnc_write) = tokio::io::split(vnc_stream);
    
    // Bidirectional copy
    tokio::select! {
        _ = copy_ws_to_tcp(&mut ws_read, &mut vnc_write) => {},
        _ = copy_tcp_to_ws(&mut vnc_read, &mut ws_write) => {},
    }
    
    Ok(())
}
```

#### Step 3: Control Plane WebSocket Endpoint

Add a WebSocket endpoint in the Go backend:

```go
// backend/internal/server/console.go

func (s *Server) HandleConsoleWebSocket(w http.ResponseWriter, r *http.Request) {
    vmID := chi.URLParam(r, "vmId")
    
    // Authenticate user
    user, err := s.auth.ValidateSession(r)
    if err != nil {
        http.Error(w, "Unauthorized", http.StatusUnauthorized)
        return
    }
    
    // Get VM and node info
    vm, err := s.vmRepo.Get(r.Context(), vmID)
    if err != nil {
        http.Error(w, "VM not found", http.StatusNotFound)
        return
    }
    
    // Get node daemon WebSocket URL
    nodeWsURL, err := s.getNodeConsoleWebSocket(vm.Status.NodeID, vmID)
    
    // Upgrade to WebSocket and proxy
    upgrader := websocket.Upgrader{
        CheckOrigin: func(r *http.Request) bool { return true },
    }
    
    clientConn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        return
    }
    defer clientConn.Close()
    
    // Proxy to node daemon
    proxyWebSocket(clientConn, nodeWsURL)
}
```

#### Step 4: Frontend noVNC Integration

Install noVNC:
```bash
npm install @novnc/novnc
```

Create the console component:

```typescript
// frontend/src/components/vm/WebConsole.tsx

import { useEffect, useRef } from 'react';
import RFB from '@novnc/novnc/lib/rfb';

interface WebConsoleProps {
  vmId: string;
  onClose: () => void;
}

export function WebConsole({ vmId, onClose }: WebConsoleProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const wsUrl = `wss://${window.location.host}/api/console/${vmId}/ws`;
    
    const rfb = new RFB(canvasRef.current, wsUrl, {
      credentials: { password: '' }, // If password is needed
    });
    
    rfb.scaleViewport = true;
    rfb.resizeSession = true;
    
    rfbRef.current = rfb;

    return () => {
      rfb.disconnect();
    };
  }, [vmId]);

  return (
    <div className="w-full h-full bg-black">
      <div ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
```

### Effort Estimate: 2-3 days

| Component | Effort |
|-----------|--------|
| QEMU WebSocket config | 2 hours |
| Node Daemon VNC proxy | 4-6 hours |
| Control Plane WebSocket proxy | 4-6 hours |
| Frontend noVNC integration | 4-6 hours |
| Testing & debugging | 4-8 hours |
| **Total** | **18-28 hours** |

---

## Option 2: qvmc (Quantix VM Remote Console) - Native Client

### What is qvmc?

A native desktop application (Windows/macOS/Linux) that provides:
- **GPU-accelerated rendering** (OpenGL/Vulkan)
- **USB device passthrough** (share USB devices with VM)
- **Clipboard sharing** (copy/paste between host and guest)
- **Multi-monitor support**
- **Better keyboard handling** (Ctrl+Alt+Del, special keys)
- **File transfer** (drag and drop files to VM)
- **Audio passthrough**

### Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                    qvmc Desktop App                           │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  GUI Framework (Tauri/Electron or native Qt/GTK)        │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │  VNC/SPICE Protocol Handler                             │ │
│  │  - VNC: Pure Rust implementation (vnc-rs)               │ │
│  │  - SPICE: Rust bindings to spice-gtk or native impl     │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │  USB Passthrough (libusb bindings)                      │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │  Clipboard Sync (platform-specific)                     │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │  GPU Renderer (wgpu for cross-platform)                 │ │
│  └─────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket + Custom Protocol
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                    Control Plane (Go)                          │
│  - Authentication                                              │
│  - VM lookup                                                   │
│  - Proxy to Node                                              │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                    Node Daemon (Rust)                          │
│  - VNC/SPICE proxy                                            │
│  - USB passthrough coordination                               │
└───────────────────────────────────────────────────────────────┘
```

### Technology Options

#### Option A: Tauri (Recommended)
- **Pros:** Rust backend, small binary size (~10MB), cross-platform
- **Cons:** WebView-based UI (some limitations)
- **Effort:** 2-3 weeks for MVP

```
qvmc/
├── src-tauri/       # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── vnc.rs   # VNC client
│   │   └── usb.rs   # USB passthrough
│   └── Cargo.toml
├── src/             # React/Vue frontend
│   └── App.tsx
└── package.json
```

#### Option B: Pure Rust with egui/iced
- **Pros:** Native performance, no web dependencies
- **Cons:** More work for UI, less polished
- **Effort:** 3-4 weeks for MVP

#### Option C: Electron
- **Pros:** Fastest development, rich ecosystem
- **Cons:** Large binary (100MB+), RAM hungry
- **Effort:** 1-2 weeks for MVP

### Protocol: Custom vs VNC/SPICE

| Protocol | Pros | Cons |
|----------|------|------|
| **VNC** | Simple, widely supported | No USB, no audio, no clipboard |
| **SPICE** | USB, audio, clipboard, GPU | More complex, Linux-focused |
| **Custom** | Tailored features | Development cost |

**Recommendation:** Start with VNC for display, add SPICE agent for clipboard/USB.

### Effort Estimate: 3-6 weeks

| Component | Effort |
|-----------|--------|
| Tauri project setup | 1 day |
| VNC client integration | 3-5 days |
| Connection management | 2-3 days |
| UI/UX (connection list, settings) | 3-5 days |
| USB passthrough | 1 week |
| Clipboard sync | 2-3 days |
| Installers (Windows/macOS/Linux) | 2-3 days |
| Testing & polish | 1 week |
| **Total** | **3-6 weeks** |

---

## Recommendation

### Phase 1: Web Console (noVNC) - Do This First
- **Timeline:** 2-3 days
- **Value:** Immediate console access for all users
- **No installation required**

### Phase 2: qvmc Native Client - Future Enhancement
- **Timeline:** 4-6 weeks
- **Value:** Power users, advanced features
- **Can be branded and distributed**

---

## Quick Wins Before Full Implementation

### 1. Improve VNC Connection UX (Today)
The frontend already shows the connection info. We can:
- Add a "Launch TightVNC" button that uses custom URL scheme
- Provide `.vnc` file download that VNC clients can open

### 2. SSH Tunnel Helper (Quick)
Generate SSH tunnel command for secure access:
```bash
ssh -L 5900:localhost:5900 user@192.168.0.53
# Then connect to localhost:5900
```

---

## References

- [noVNC GitHub](https://github.com/novnc/noVNC)
- [websockify](https://github.com/novnc/websockify)
- [QEMU VNC documentation](https://www.qemu.org/docs/master/system/vnc-security.html)
- [Tauri](https://tauri.app/)
- [spice-protocol](https://www.spice-space.org/)
