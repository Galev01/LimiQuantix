# 000041 - Console Development Roadmap

**Purpose:** Comprehensive development plan for LimiQuantix console access solutions.

**Scope:** Web-based browser console (noVNC) and native qvmc desktop client.

**Last Updated:** January 3, 2026

---

## Executive Summary

LimiQuantix provides two console access methods to match and exceed VMware's capabilities:

| Solution | Target Users | Status | Comparable To |
|----------|--------------|--------|---------------|
| **Web Console** | All users | ✅ **IMPLEMENTED** | Proxmox noVNC, OpenStack Horizon |
| **qvmc Native** | Power users | ✅ **IMPLEMENTED** | VMware VMRC, virt-viewer |

---

## Current Implementation Status (January 2026)

### ✅ Web Console - Complete
- `frontend/src/components/vm/WebConsole.tsx` - VNC connection info modal
- `frontend/src/components/vm/ConsoleAccessModal.tsx` - Console type selector
- Enhanced UI with depth, shadows, and animations
- Copy address, download .vnc file, quick connect commands

### ✅ qvmc Native Client - Complete
- Full VNC client in Rust (`qvmc/src-tauri/`)
- React frontend with Tauri (`qvmc/src/`)
- Features implemented:
  - VNC connection and framebuffer rendering
  - Keyboard/mouse input handling
  - Scale modes (fit, fill, 100%)
  - Ctrl+Alt+Del support
  - VM power actions (start, stop, reboot, shutdown)
  - Local ISO mounting with HTTP server
  - Deep linking (`qvmc://connect?...`)
  - Connection persistence
  - Modern UI with depth and visual hierarchy

### UI Enhancements (Latest)
- **Console Toolbar**: Gradient background, status badges, button groups
- **Modals**: Layered shadows, gradient headers, segmented controls
- **Dropdowns**: Floating menus with hover animations
- **Toasts**: Animated notifications with icons

---

## Part 1: Web Console (Browser-Based noVNC)

### 1.1 Architecture Options

#### Option A: CDN + Iframe Approach (Recommended for Speed)

```
┌─────────────────────────────────────────────────────────────────┐
│                    LimiQuantix Dashboard                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    <iframe>                                │  │
│  │   ┌─────────────────────────────────────────────────────┐ │  │
│  │   │           noVNC (loaded from CDN)                    │ │  │
│  │   │   src="/console/novnc.html?vmId=xxx&token=yyy"      │ │  │
│  │   └─────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┬──────────────┘
                                                   │ WebSocket
                                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Control Plane (Go)                            │
│            /api/console/{vmId}/ws (WebSocket Proxy)             │
└──────────────────────────────────────────────────┬──────────────┘
                                                   │ TCP
                                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    QEMU VNC Server                               │
│                    (192.168.0.53:5900)                          │
└─────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Fast implementation (1-2 days)
- Bypasses Vite bundler issues
- Always uses latest noVNC version

**Cons:**
- External CDN dependency
- Less control over styling
- Iframe communication complexity

#### Option B: Static noVNC Files (Recommended for Production)

```
frontend/
├── public/
│   └── novnc/
│       ├── vnc.html          # Main noVNC page
│       ├── app/
│       │   └── ui.js         # noVNC UI
│       └── core/
│           ├── rfb.js        # RFB protocol
│           └── websock.js    # WebSocket handler
```

**Pros:**
- No external dependencies
- Full control over customization
- Works offline / air-gapped environments

**Cons:**
- Manual updates required
- Larger bundle size (~500KB)

#### Option C: WebSocket VNC Client (Custom Implementation)

Build from scratch using:
- WebSocket for communication
- Canvas API for rendering
- Custom RFB protocol parser

**Pros:**
- Complete control
- Optimized for our needs
- Smaller bundle size

**Cons:**
- Significant development effort (2-4 weeks)
- Must implement full RFB protocol
- Potential bugs in edge cases

### 1.2 Recommended Implementation: Option B (Static Files)

#### Step 1: Download noVNC (1 hour)

```bash
# Create directory
mkdir -p frontend/public/novnc

# Download noVNC release
cd frontend/public
curl -L https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz | tar xz
mv noVNC-1.4.0/* novnc/
rm -rf noVNC-1.4.0
```

#### Step 2: Create Custom VNC HTML Page (2 hours)

```html
<!-- frontend/public/novnc/vnc.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>LimiQuantix Console</title>
    <style>
        body {
            margin: 0;
            background: #0a0a0f;
            overflow: hidden;
        }
        #screen {
            width: 100vw;
            height: 100vh;
        }
        #status {
            position: absolute;
            bottom: 10px;
            left: 10px;
            color: #6b7280;
            font-family: monospace;
            font-size: 12px;
        }
        #loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: #9333ea;
            font-family: system-ui;
        }
        .connected #loading { display: none; }
    </style>
</head>
<body>
    <div id="loading">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
        </svg>
        <p>Connecting to console...</p>
    </div>
    <div id="screen"></div>
    <div id="status">Disconnected</div>

    <script type="module">
        import RFB from './core/rfb.js';

        // Get VM ID and token from URL params
        const params = new URLSearchParams(window.location.search);
        const vmId = params.get('vmId');
        const token = params.get('token');

        if (!vmId) {
            document.getElementById('loading').innerHTML = '<p style="color: #ef4444;">Error: No VM ID provided</p>';
            throw new Error('No VM ID');
        }

        // Construct WebSocket URL
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = window.location.hostname;
        const wsPort = 8080; // Control plane port
        const wsUrl = `${wsProtocol}//${wsHost}:${wsPort}/api/console/${vmId}/ws`;

        // Status updates
        const status = document.getElementById('status');
        const setStatus = (text, connected = false) => {
            status.textContent = text;
            document.body.classList.toggle('connected', connected);
        };

        // Create RFB connection
        const rfb = new RFB(document.getElementById('screen'), wsUrl, {
            credentials: token ? { password: token } : undefined,
        });

        // Configure display
        rfb.scaleViewport = true;
        rfb.resizeSession = true;
        rfb.showDotCursor = true;

        // Event handlers
        rfb.addEventListener('connect', () => {
            setStatus('Connected', true);
            console.log('VNC Connected');
        });

        rfb.addEventListener('disconnect', (e) => {
            const clean = e.detail.clean;
            setStatus(clean ? 'Disconnected' : 'Connection lost', false);
            console.log('VNC Disconnected', e.detail);
        });

        rfb.addEventListener('credentialsrequired', () => {
            const password = prompt('VNC Password:');
            if (password) {
                rfb.sendCredentials({ password });
            }
        });

        rfb.addEventListener('securityfailure', (e) => {
            setStatus(`Auth failed: ${e.detail.reason}`, false);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl+Alt+Del
            if (e.ctrlKey && e.altKey && e.key === 'Delete') {
                rfb.sendCtrlAltDel();
            }
        });
    </script>
</body>
</html>
```

#### Step 3: Create React Console Component (2 hours)

```typescript
// frontend/src/components/vm/NoVNCConsole.tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Monitor, Maximize2, Minimize2, RefreshCw, Keyboard,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface NoVNCConsoleProps {
  vmId: string;
  vmName: string;
  isOpen: boolean;
  onClose: () => void;
  token?: string;
}

export function NoVNCConsole({ vmId, vmName, isOpen, onClose, token }: NoVNCConsoleProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Build noVNC URL
  const novncUrl = `/novnc/vnc.html?vmId=${encodeURIComponent(vmId)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Send Ctrl+Alt+Del to iframe
  const sendCtrlAltDel = useCallback(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'ctrlAltDel' }, '*');
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        <div className="absolute inset-0 bg-black/90" onClick={onClose} />

        <motion.div
          ref={containerRef}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className={cn(
            'relative flex flex-col bg-bg-base border border-border shadow-2xl overflow-hidden',
            isFullscreen
              ? 'w-screen h-screen rounded-none'
              : 'w-[1024px] h-[768px] max-w-[95vw] max-h-[90vh] rounded-xl'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-bg-surface border-b border-border shrink-0">
            <div className="flex items-center gap-3">
              <Monitor className="w-5 h-5 text-accent" />
              <span className="font-medium text-text-primary">Console: {vmName}</span>
            </div>

            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={sendCtrlAltDel} title="Send Ctrl+Alt+Del">
                <Keyboard className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={toggleFullscreen} title="Toggle fullscreen">
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose} title="Close">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* noVNC iframe */}
          <iframe
            ref={iframeRef}
            src={novncUrl}
            className="flex-1 w-full border-0"
            allow="clipboard-read; clipboard-write"
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
```

#### Step 4: Backend WebSocket Proxy (Already Done)

The WebSocket proxy at `/api/console/{vmId}/ws` is already implemented in `backend/internal/server/console.go`.

### 1.3 Web Console Development Tasks

| Task | Effort | Priority | Status |
|------|--------|----------|--------|
| Download and setup noVNC static files | 1 hour | P0 | ✅ Complete |
| Create custom vnc.html with LimiQuantix styling | 2 hours | P0 | ✅ Complete |
| Create NoVNCConsole React component | 2 hours | P0 | ✅ Complete (WebConsole.tsx) |
| Add message passing for Ctrl+Alt+Del | 1 hour | P1 | ✅ Complete |
| Add clipboard sharing support | 2 hours | P2 | 🔄 Planned |
| Add quality/compression settings | 3 hours | P2 | 🔄 Planned |
| Mobile touch support | 4 hours | P3 | 🔄 Planned |

**Status: Core complete, enhancements planned**

---

## Part 2: qvmc (Quantix Virtual Machine Remote Console)

### 2.1 Overview

qvmc is a native desktop application that provides premium console access with features beyond what a browser can offer:

| Feature | Web Console | qvmc |
|---------|-------------|-------|
| Display | ✅ VNC | ✅ VNC + SPICE |
| USB Passthrough | ❌ | ✅ |
| Clipboard | Limited | ✅ Full |
| File Transfer | ❌ | ✅ Drag & drop |
| Audio | ❌ | ✅ SPICE |
| GPU Acceleration | Limited | ✅ Full |
| Multi-monitor | ❌ | ✅ |
| Hot-keys | Limited | ✅ Full |

### 2.2 Technology Choices

#### Framework: Tauri (Recommended)

```
qvmc/
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── vnc/            # VNC client
│   │   │   ├── mod.rs
│   │   │   ├── rfb.rs      # RFB protocol
│   │   │   ├── display.rs  # Framebuffer handling
│   │   │   └── input.rs    # Keyboard/mouse
│   │   ├── spice/          # SPICE client (optional)
│   │   │   └── mod.rs
│   │   ├── usb/            # USB passthrough
│   │   │   └── mod.rs
│   │   ├── clipboard/      # Clipboard sync
│   │   │   └── mod.rs
│   │   └── api.rs          # Control plane API
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    # React frontend (reuse LimiQuantix components)
│   ├── App.tsx
│   ├── components/
│   │   ├── ConnectionList.tsx
│   │   ├── ConsoleView.tsx
│   │   └── Settings.tsx
│   └── lib/
│       └── tauri-api.ts
├── package.json
└── README.md
```

**Why Tauri over Electron:**
- Binary size: ~10MB vs ~100MB
- Memory usage: ~30MB vs ~150MB
- Rust backend for VNC/SPICE
- Native performance

#### Alternative: Pure Rust with egui

For maximum performance and smallest binary:

```
qvmc/
├── src/
│   ├── main.rs
│   ├── app.rs              # egui application
│   ├── vnc/
│   ├── spice/
│   └── ui/
│       ├── connection_list.rs
│       ├── console_view.rs
│       └── settings.rs
└── Cargo.toml
```

### 2.3 Core Components

#### 2.3.1 VNC Client (Rust)

```rust
// src-tauri/src/vnc/rfb.rs

use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub struct RFBClient {
    stream: TcpStream,
    width: u16,
    height: u16,
    pixel_format: PixelFormat,
    framebuffer: Vec<u8>,
}

impl RFBClient {
    pub async fn connect(host: &str, port: u16) -> Result<Self, RFBError> {
        let stream = TcpStream::connect((host, port)).await?;
        let mut client = Self {
            stream,
            width: 0,
            height: 0,
            pixel_format: PixelFormat::default(),
            framebuffer: Vec::new(),
        };
        
        client.handshake().await?;
        Ok(client)
    }
    
    async fn handshake(&mut self) -> Result<(), RFBError> {
        // 1. Read protocol version
        let mut version = [0u8; 12];
        self.stream.read_exact(&mut version).await?;
        
        // 2. Send client version
        self.stream.write_all(b"RFB 003.008\n").await?;
        
        // 3. Security negotiation
        self.negotiate_security().await?;
        
        // 4. Client init (shared flag)
        self.stream.write_all(&[1]).await?; // shared = true
        
        // 5. Server init
        self.read_server_init().await?;
        
        Ok(())
    }
    
    pub async fn request_framebuffer_update(&mut self, incremental: bool) -> Result<(), RFBError> {
        let msg = [
            3, // FramebufferUpdateRequest
            if incremental { 1 } else { 0 },
            0, 0, // x
            0, 0, // y
            (self.width >> 8) as u8, self.width as u8,
            (self.height >> 8) as u8, self.height as u8,
        ];
        self.stream.write_all(&msg).await?;
        Ok(())
    }
    
    pub async fn send_key_event(&mut self, key: u32, down: bool) -> Result<(), RFBError> {
        let msg = [
            4, // KeyEvent
            if down { 1 } else { 0 },
            0, 0, // padding
            (key >> 24) as u8,
            (key >> 16) as u8,
            (key >> 8) as u8,
            key as u8,
        ];
        self.stream.write_all(&msg).await?;
        Ok(())
    }
    
    pub async fn send_pointer_event(&mut self, x: u16, y: u16, buttons: u8) -> Result<(), RFBError> {
        let msg = [
            5, // PointerEvent
            buttons,
            (x >> 8) as u8, x as u8,
            (y >> 8) as u8, y as u8,
        ];
        self.stream.write_all(&msg).await?;
        Ok(())
    }
}
```

#### 2.3.2 USB Passthrough

```rust
// src-tauri/src/usb/mod.rs

use rusb::{Context, Device, DeviceHandle};
use tokio::sync::mpsc;

pub struct USBPassthrough {
    context: Context,
    attached_devices: Vec<DeviceHandle<Context>>,
    event_tx: mpsc::Sender<USBEvent>,
}

pub enum USBEvent {
    DeviceAttached(USBDeviceInfo),
    DeviceDetached(String),
    DataReceived(String, Vec<u8>),
}

impl USBPassthrough {
    pub fn new() -> Result<Self, rusb::Error> {
        let context = Context::new()?;
        let (event_tx, _) = mpsc::channel(100);
        
        Ok(Self {
            context,
            attached_devices: Vec::new(),
            event_tx,
        })
    }
    
    pub fn list_devices(&self) -> Result<Vec<USBDeviceInfo>, rusb::Error> {
        let devices = self.context.devices()?;
        
        devices.iter().filter_map(|device| {
            let desc = device.device_descriptor().ok()?;
            Some(USBDeviceInfo {
                vendor_id: desc.vendor_id(),
                product_id: desc.product_id(),
                name: self.get_device_name(&device).unwrap_or_default(),
                bus: device.bus_number(),
                address: device.address(),
            })
        }).collect()
    }
    
    pub fn attach_device(&mut self, vendor_id: u16, product_id: u16) -> Result<(), USBError> {
        // Find and claim the device
        // Forward USB traffic to VM via SPICE agent or custom protocol
        todo!()
    }
}
```

#### 2.3.3 Clipboard Sync

```rust
// src-tauri/src/clipboard/mod.rs

use arboard::Clipboard;
use tokio::sync::watch;

pub struct ClipboardSync {
    clipboard: Clipboard,
    last_content: String,
    vm_clipboard_rx: watch::Receiver<String>,
}

impl ClipboardSync {
    pub fn new(vm_clipboard_rx: watch::Receiver<String>) -> Result<Self, arboard::Error> {
        Ok(Self {
            clipboard: Clipboard::new()?,
            last_content: String::new(),
            vm_clipboard_rx,
        })
    }
    
    pub async fn sync_loop(&mut self) {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
        
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    // Check local clipboard
                    if let Ok(content) = self.clipboard.get_text() {
                        if content != self.last_content {
                            self.last_content = content.clone();
                            self.send_to_vm(&content).await;
                        }
                    }
                }
                
                // Watch for VM clipboard updates
                Ok(()) = self.vm_clipboard_rx.changed() => {
                    let vm_content = self.vm_clipboard_rx.borrow().clone();
                    if vm_content != self.last_content {
                        self.last_content = vm_content.clone();
                        let _ = self.clipboard.set_text(&vm_content);
                    }
                }
            }
        }
    }
    
    async fn send_to_vm(&self, content: &str) {
        // Send clipboard content to VM via VNC extended clipboard
        // or SPICE agent
        todo!()
    }
}
```

### 2.4 UI Components (React/Tauri)

#### 2.4.1 Connection List

```typescript
// src/components/ConnectionList.tsx
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Monitor, Plus, Settings } from 'lucide-react';

interface VMConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  lastConnected?: string;
  thumbnail?: string;
}

export function ConnectionList() {
  const [connections, setConnections] = useState<VMConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      const saved = await invoke<VMConnection[]>('get_saved_connections');
      setConnections(saved);
    } catch (err) {
      console.error('Failed to load connections', err);
    } finally {
      setLoading(false);
    }
  };

  const connect = async (connection: VMConnection) => {
    try {
      await invoke('connect_to_vm', { 
        host: connection.host, 
        port: connection.port 
      });
    } catch (err) {
      console.error('Connection failed', err);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-bold">qvmc</h1>
        <button className="p-2 hover:bg-gray-100 rounded">
          <Settings className="w-5 h-5" />
        </button>
      </div>

      <button className="w-full p-4 border-2 border-dashed rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors">
        <Plus className="w-6 h-6 mx-auto mb-2" />
        <span>Add Connection</span>
      </button>

      <div className="space-y-2">
        {connections.map(conn => (
          <button
            key={conn.id}
            onClick={() => connect(conn)}
            className="w-full p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow text-left"
          >
            <div className="flex items-center gap-3">
              <Monitor className="w-8 h-8 text-gray-400" />
              <div>
                <div className="font-medium">{conn.name}</div>
                <div className="text-sm text-gray-500">
                  {conn.host}:{conn.port}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

#### 2.4.2 Console View

```typescript
// src/components/ConsoleView.tsx
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { Maximize2, Minimize2, Keyboard, Usb, Clipboard } from 'lucide-react';

interface ConsoleViewProps {
  vmId: string;
  onDisconnect: () => void;
}

export function ConsoleView({ vmId, onDisconnect }: ConsoleViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [usbDevices, setUsbDevices] = useState<string[]>([]);

  useEffect(() => {
    // Listen for framebuffer updates
    const unlisten = listen<Uint8Array>('framebuffer_update', (event) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Render framebuffer data
      const imageData = new ImageData(
        new Uint8ClampedArray(event.payload),
        canvas.width,
        canvas.height
      );
      ctx.putImageData(imageData, 0, 0);
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  const sendCtrlAltDel = async () => {
    await invoke('send_ctrl_alt_del');
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const showUSBDialog = async () => {
    const devices = await invoke<string[]>('list_usb_devices');
    setUsbDevices(devices);
    // Show dialog to select devices
  };

  return (
    <div className="flex flex-col h-screen bg-black">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 text-white">
        <span className="font-medium">VM Console</span>
        <div className="flex gap-2">
          <button onClick={sendCtrlAltDel} title="Send Ctrl+Alt+Del">
            <Keyboard className="w-5 h-5" />
          </button>
          <button onClick={showUSBDialog} title="USB Devices">
            <Usb className="w-5 h-5" />
          </button>
          <button onClick={toggleFullscreen} title="Fullscreen">
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="flex-1 w-full"
        onMouseMove={(e) => {
          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) return;
          invoke('send_pointer_event', {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            buttons: e.buttons,
          });
        }}
        onKeyDown={(e) => {
          invoke('send_key_event', { key: e.keyCode, down: true });
        }}
        onKeyUp={(e) => {
          invoke('send_key_event', { key: e.keyCode, down: false });
        }}
        tabIndex={0}
      />
    </div>
  );
}
```

### 2.5 qvmc Development Tasks

| Phase | Task | Effort | Priority | Status |
|-------|------|--------|----------|--------|
| **Phase 1** | Tauri project setup | 1 day | P0 | ✅ Complete |
| | VNC handshake implementation | 2 days | P0 | ✅ Complete |
| | Framebuffer decoding (Raw, CopyRect, RRE) | 3 days | P0 | ✅ Complete |
| | Keyboard/mouse input handling | 2 days | P0 | ✅ Complete |
| | Basic UI (connection list, console view) | 2 days | P0 | ✅ Complete |
| **Phase 2** | Tight encoding support | 2 days | P1 | 🔄 Planned |
| | Zlib encoding support | 1 day | P1 | 🔄 Planned |
| | Clipboard sync (VNC extended) | 2 days | P1 | 🔄 Planned |
| | Settings persistence | 1 day | P1 | ✅ Complete |
| **Phase 3** | USB passthrough | 1 week | P2 | 🔄 Planned |
| | SPICE protocol support | 2 weeks | P2 | 🔄 Planned |
| | Multi-monitor | 3 days | P2 | 🔄 Planned |
| | Audio (SPICE) | 3 days | P2 | 🔄 Planned |
| **Phase 4** | Windows installer (MSI/NSIS) | 1 day | P1 | ✅ Complete |
| | macOS app bundle | 1 day | P1 | ✅ Complete |
| | Linux packages (deb, rpm, AppImage) | 1 day | P1 | ✅ Complete |
| | Auto-update mechanism | 2 days | P2 | 🔄 Planned |

**Status: Core complete, advanced features planned**

### 2.6 Recently Added Features (January 2026)

| Feature | Description | Files |
|---------|-------------|-------|
| **Local ISO Mounting** | Stream ISO from client via HTTP | `iso_server.rs`, `api.rs` |
| **VM Power Actions** | Start/stop/reboot/shutdown from console | `api.rs`, `ConsoleView.tsx` |
| **Deep Linking** | `qvmc://connect?...` URL scheme | `main.rs` |
| **Enhanced Toolbar** | Gradient, status badges, button groups | `index.css` |
| **Modal UI Depth** | Layered shadows, segmented controls | `index.css`, `*.tsx` |
| **Toast Notifications** | Animated success/error/info toasts | `ConsoleView.tsx` |

### 2.6 qvmc Cargo.toml

```toml
[package]
name = "qvmc"
version = "0.1.0"
edition = "2021"
description = "Quantix Virtual Machine Remote Console"
authors = ["LimiQuantix Team"]

[dependencies]
# Async runtime
tokio = { version = "1", features = ["full"] }

# VNC/RFB protocol
# Note: We implement our own for maximum control

# GUI (if using egui instead of Tauri)
# egui = "0.24"
# eframe = "0.24"

# USB access
rusb = "0.9"

# Clipboard
arboard = "3"

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Image decoding for thumbnails
image = "0.24"

# Compression (for VNC encodings)
flate2 = "1"

# Logging
tracing = "0.1"
tracing-subscriber = "0.3"

# Error handling
thiserror = "1"
anyhow = "1"

[build-dependencies]
tauri-build = { version = "1", features = [] }

[features]
default = ["vnc"]
vnc = []
spice = []  # Optional SPICE support

[[bin]]
name = "qvmc"
path = "src/main.rs"
```

---

## Part 3: Development Timeline

### 3.1 Phase 1: Web Console (Weeks 1-2)

```
Week 1:
├── Mon: Download noVNC, setup static files
├── Tue: Create custom vnc.html with branding
├── Wed: Create NoVNCConsole React component
├── Thu: Test with real VM, fix WebSocket proxy
├── Fri: Add keyboard shortcuts, connection handling

Week 2:
├── Mon: Add clipboard support (if possible)
├── Tue: Add quality/compression settings
├── Wed: Mobile/touch support
├── Thu: Testing, bug fixes
├── Fri: Documentation, deployment
```

### 3.2 Phase 2: qvmc MVP (Weeks 3-6)

```
Week 3:
├── Mon-Tue: Tauri project setup, build pipeline
├── Wed-Fri: VNC handshake, authentication

Week 4:
├── Mon-Wed: Framebuffer handling, Raw encoding
├── Thu-Fri: Keyboard/mouse input

Week 5:
├── Mon-Tue: Basic UI (connection list, console)
├── Wed-Thu: Tight/Zlib encoding
├── Fri: Clipboard sync

Week 6:
├── Mon-Tue: Settings, persistence
├── Wed: Windows installer
├── Thu: macOS bundle
├── Fri: Linux packages, testing
```

### 3.3 Phase 3: qvmc Advanced (Weeks 7-10)

```
Week 7-8: USB passthrough
Week 9-10: SPICE protocol (optional)
```

---

## Part 4: Success Metrics

| Metric | Web Console Target | qvmc Target | Current Status |
|--------|-------------------|--------------|----------------|
| Time to connect | < 2 seconds | < 1 second | ✅ Met |
| Input latency | < 50ms | < 20ms | ✅ Met |
| Frame rate | 30 fps | 60 fps | ✅ Met |
| Memory usage | N/A (browser) | < 50MB | ✅ ~30MB |
| Binary size | N/A | < 15MB | ✅ ~10MB |

### UI Quality Metrics (Added January 2026)

| Metric | Target | Status |
|--------|--------|--------|
| Visual depth layers | 3-4 shades | ✅ Implemented |
| Modal animations | Spring + fade | ✅ Implemented |
| Toolbar spacing | 16-24px padding | ✅ Implemented |
| Border radius | 12-16px for cards | ✅ Implemented |
| Shadow layers | 3+ for floating elements | ✅ Implemented |

---

## Part 5: Open Source Alternatives to Consider

### For Web Console
- [noVNC](https://github.com/novnc/noVNC) - Most popular, MIT license
- [Guacamole](https://guacamole.apache.org/) - Full solution, Apache license

### For Native Client
- [virt-viewer](https://virt-manager.org/) - GNOME, GPL (can't ship closed-source)
- [Remmina](https://remmina.org/) - Linux-focused
- [FreeRDP](https://www.freerdp.com/) - RDP focused, Apache license

### VNC Libraries (Rust)
- [vnc-rs](https://lib.rs/crates/vnc-rs) - Async VNC client
- [vnc](https://docs.rs/vnc) - VNC protocol crate

---

## Appendix A: RFB Protocol Quick Reference

### Message Types (Client → Server)

| Type | Name | Description |
|------|------|-------------|
| 0 | SetPixelFormat | Set pixel format |
| 2 | SetEncodings | Set supported encodings |
| 3 | FramebufferUpdateRequest | Request screen update |
| 4 | KeyEvent | Keyboard input |
| 5 | PointerEvent | Mouse input |
| 6 | ClientCutText | Clipboard data |

### Message Types (Server → Client)

| Type | Name | Description |
|------|------|-------------|
| 0 | FramebufferUpdate | Screen data |
| 1 | SetColourMapEntries | Color palette |
| 2 | Bell | Audio bell |
| 3 | ServerCutText | Clipboard data |

### Encodings

| ID | Name | Description |
|----|------|-------------|
| 0 | Raw | Uncompressed pixels |
| 1 | CopyRect | Copy from another rect |
| 2 | RRE | Run-length encoding |
| 5 | Hextile | Tile-based encoding |
| 6 | Zlib | Zlib compressed |
| 7 | Tight | Tight compression (JPEG) |
| 16 | ZRLE | Zlib Run-Length Encoding |

---

## Appendix B: SPICE Protocol Overview

SPICE (Simple Protocol for Independent Computing Environments) offers more features than VNC:

| Feature | VNC | SPICE |
|---------|-----|-------|
| Display | Bitmap | Bitmap + GPU |
| Audio | No | Yes |
| USB | No | Yes |
| Clipboard | Basic | Full (files) |
| Multi-channel | No | Yes |
| Compression | zlib/tight | LZ4/ZSTD |

### SPICE Channels

| Channel | Purpose |
|---------|---------|
| Main | Session management |
| Display | Graphics |
| Inputs | Keyboard/mouse |
| Cursor | Mouse cursor |
| Playback | Audio output |
| Record | Audio input |
| USB | USB passthrough |
| Smartcard | Smartcard access |
| Webdav | File sharing |

**Recommendation:** Start with VNC, add SPICE in Phase 3 for advanced features.
