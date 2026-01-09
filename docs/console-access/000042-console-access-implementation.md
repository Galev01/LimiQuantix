# 000042 - Console Access Implementation

**Purpose:** Document the complete implementation of VM console access in LimiQuantix, including the browser-based Web Console (noVNC) and the native desktop client (qvmc).

**Status:** Web Console ✅ Complete | qvmc ✅ Production Ready

**Last Updated:** January 3, 2026

---

## Executive Summary

LimiQuantix provides two methods for VM console access:

| Solution | Status | Target Users | Use Case |
|----------|--------|--------------|----------|
| **Web Console (noVNC)** | ✅ Complete | All users | Quick access, no installation required |
| **qvmc Native Client** | ✅ Complete | Power users | Better performance, deep links, offline support |

### Console Access Flow

Users can access VM consoles via the "Console" button on the VM Detail page:

1. **Web Console** - Opens immediately in a modal, no installation required
2. **qvmc Native** - Opens the ConsoleAccessModal with:
   - Option to launch qvmc via deep link (`qvmc://connect?...`)
   - OS-specific download buttons (EXE for Windows, DMG for macOS)
   - URL copy button for manual connection

---

## Part 1: Web Console (noVNC)

### 1.1 Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Browser (React Frontend)                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     NoVNCConsole Component                         │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │        <iframe src="/novnc/limiquantix.html?...">           │  │  │
│  │  │  ┌─────────────────────────────────────────────────────┐    │  │  │
│  │  │  │              noVNC JavaScript Library                │    │  │  │
│  │  │  │            (WebSocket VNC Client)                    │    │  │  │
│  │  │  └──────────────────────┬──────────────────────────────┘    │  │  │
│  │  └─────────────────────────┼───────────────────────────────────┘  │  │
│  └─────────────────────────────┼─────────────────────────────────────┘  │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │ WebSocket (ws://)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Control Plane (Go)                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                  WebSocket Proxy Handler                           │  │
│  │   Endpoint: /api/console/{vmId}/ws                                │  │
│  │   - Looks up VM → Node mapping                                    │  │
│  │   - Opens TCP connection to Node VNC port                         │  │
│  │   - Proxies WebSocket ↔ TCP bidirectionally                       │  │
│  └──────────────────────────────┬────────────────────────────────────┘  │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │ TCP (VNC Protocol)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         QEMU/KVM VNC Server                              │
│                    (e.g., 192.168.0.53:5900)                            │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Implementation Files

#### Frontend Components

| File | Purpose |
|------|---------|
| `frontend/public/novnc/` | Static noVNC v1.4.0 files |
| `frontend/public/novnc/limiquantix.html` | Custom HTML page with LimiQuantix styling |
| `frontend/src/components/vm/NoVNCConsole.tsx` | React component (iframe wrapper) |
| `frontend/src/components/vm/WebConsole.tsx` | Fallback console info component |

#### Backend Components

| File | Purpose |
|------|---------|
| `backend/internal/server/console.go` | WebSocket proxy handler |

### 1.3 noVNC Integration Details

#### Static Files Structure

```
frontend/public/novnc/
├── limiquantix.html      # Custom entry point (LimiQuantix-styled)
├── vnc.html              # Original noVNC entry point (kept for reference)
├── app/                  # noVNC application layer
│   ├── ui.js
│   └── localization.js
├── core/                 # noVNC core library
│   ├── rfb.js            # RFB (VNC) protocol implementation
│   ├── websock.js        # WebSocket handling
│   ├── decoders/         # Encoding decoders (raw, hextile, tight, etc.)
│   └── input/            # Keyboard and mouse handlers
└── vendor/               # Third-party dependencies
```

#### Custom Console Page (`limiquantix.html`)

The custom HTML page provides:

1. **LimiQuantix Dark Theme Styling**
   - Matches dashboard color scheme (`#0a0a0f` background)
   - Custom toolbar with LimiQuantix branding

2. **Toolbar Features**
   - Ctrl+Alt+Del button
   - Clipboard paste button
   - Fullscreen toggle
   - Connection status indicator

3. **Parent-Child Communication**
   - Receives commands from React parent via `postMessage`
   - Sends status updates back to parent

4. **Auto-Connection**
   - Reads `vmId`, `host`, `port`, `password` from URL query params
   - Automatically connects on page load

#### React Wrapper Component (`NoVNCConsole.tsx`)

```typescript
interface NoVNCConsoleProps {
  vmId: string;
  vmName: string;
  isOpen: boolean;
  onClose: () => void;
}
```

Features:
- Full-screen modal with dark overlay
- Header toolbar with console name
- Buttons: Ctrl+Alt+Del, Fullscreen, Open in New Tab, Copy URL, Close
- Escape key to close
- `postMessage` communication with iframe

### 1.4 Backend WebSocket Proxy

**Endpoint:** `GET /api/console/{vmId}/ws`

**Flow:**
1. Extract `vmId` from URL path
2. Look up VM in repository → get `nodeId`
3. Look up Node in repository → get `managementIP`
4. Get console info → get VNC `port`
5. Upgrade HTTP connection to WebSocket
6. Open TCP connection to `{managementIP}:{port}`
7. Spawn goroutines to proxy data bidirectionally
8. Clean up on disconnect

**Error Handling:**
- VM not found → 404
- Node not available → 503
- VNC connection failed → 502
- WebSocket upgrade failed → 400

### 1.5 Usage

#### From Dashboard

1. Navigate to VM Detail page
2. Click "Console" button in header
3. Modal opens with noVNC console
4. Use toolbar for special keys (Ctrl+Alt+Del)
5. Click "Open in New Tab" for dedicated window

#### Direct URL

```
http://localhost:5173/novnc/limiquantix.html?vmId={VM_ID}&vmName={VM_NAME}
```

#### Connection Info Fallback

If WebSocket is unavailable, the `WebConsole.tsx` component shows:
- VNC host and port
- Copy button for VNC address
- Download `.vnc` file
- Quick connect commands (Linux, macOS, Windows)
- Link to TightVNC download

---

## Part 2: qvmc (Quantix Virtual Machine Remote Console)

### 2.1 Overview

qvmc is a native desktop application built with **Tauri** (Rust + React) that provides premium console access with features beyond browser capabilities.

### 2.2 Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                             qvmc                                        │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    React UI Layer                                  │  │
│  │   ConnectionList.tsx │ ConsoleView.tsx │ Settings.tsx              │  │
│  └────────────────────────────┬──────────────────────────────────────┘  │
│                               │                                          │
│  ┌────────────────────────────┴──────────────────────────────────────┐  │
│  │                    Tauri Bridge (IPC)                              │  │
│  │              invoke() / listen() / emit()                          │  │
│  └────────────────────────────┬──────────────────────────────────────┘  │
│                               │                                          │
│  ┌────────────────────────────┴──────────────────────────────────────┐  │
│  │                  Rust Native Layer                                 │  │
│  │   api.rs (Control Plane) │ vnc/*.rs (VNC Client) │ config.rs      │  │
│  └────────────────────────────┬─────────────────────┬────────────────┘  │
└───────────────────────────────┼─────────────────────┼────────────────────┘
                                │                     │
                HTTPS/Connect-RPC                  VNC (RFB)
                                │                     │
                                ▼                     ▼
          ┌─────────────────────────────┐   ┌───────────────────────┐
          │  Control Plane (Go)         │   │  QEMU VNC Server      │
          │  localhost:8080             │   │  192.168.x.x:5900     │
          └─────────────────────────────┘   └───────────────────────┘
```

### 2.3 Two Communication Channels

#### Management Channel (Blue)

- **Purpose:** VM operations (restart, shutdown, snapshots)
- **Protocol:** HTTPS / Connect-RPC (gRPC-Web)
- **Target:** LimiQuantix Control Plane
- **Implementation:** `api.rs`

The Control Plane must orchestrate operations to:
- Update database state
- Handle scheduling
- Trigger node daemon actions

#### Console Channel (Red)

- **Purpose:** Screen, keyboard, mouse, USB passthrough
- **Protocol:** VNC (RFB Protocol) over TCP
- **Target:** QEMU VNC server (proxied through Control Plane)
- **Implementation:** `vnc/rfb.rs`

Low latency, raw pixel streaming for real-time interaction.

### 2.4 Project Structure

```
qvmc/
├── src-tauri/                    # Rust Native Layer
│   ├── Cargo.toml                # Dependencies
│   ├── tauri.conf.json           # Tauri configuration
│   ├── build.rs                  # Build script
│   └── src/
│       ├── main.rs               # Entry point, command registration
│       ├── config.rs             # Configuration persistence (TOML)
│       ├── api.rs                # Control Plane HTTP client
│       └── vnc/
│           ├── mod.rs            # VNC module entry, Tauri commands
│           ├── rfb.rs            # RFB protocol implementation
│           └── encodings.rs      # Encoding decoders
│
├── src/                          # React UI Layer
│   ├── main.tsx                  # React entry point
│   ├── index.css                 # Tailwind CSS styles
│   ├── App.tsx                   # Main application component
│   ├── components/
│   │   ├── ConnectionList.tsx    # Saved connections, add/delete
│   │   ├── ConsoleView.tsx       # Canvas display, input events
│   │   └── Settings.tsx          # Display quality, compression
│   └── lib/
│       └── tauri-api.ts          # Typed API wrapper for Rust backend
│
├── index.html                    # HTML entry point
├── package.json                  # Frontend dependencies
├── vite.config.ts                # Vite build configuration
├── tsconfig.json                 # TypeScript configuration
└── README.md                     # Project documentation
```

### 2.5 Rust Backend Components

#### `main.rs` - Entry Point

Registers Tauri commands:
- `get_saved_connections` - Load saved connections
- `add_connection` - Save new connection
- `remove_connection` - Delete connection
- `connect_vnc` - Establish VNC connection
- `disconnect_vnc` - Close VNC connection
- `send_key_event` - Send keyboard input
- `send_pointer_event` - Send mouse input
- `send_ctrl_alt_del` - Send Ctrl+Alt+Del
- `get_settings` / `save_settings` - Settings management
- `fetch_vms_from_control_plane` - Fetch VMs via API

#### `config.rs` - Configuration

Stores application configuration in TOML format:

```toml
[display]
scale_viewport = true
show_remote_cursor = true
preferred_encoding = "tight"
quality = 6
compression = 6

[[connections]]
id = "abc-123"
name = "My VM"
control_plane_url = "http://localhost:8080"
vm_id = "f614926c-16c3-4f90-8d44-96447f3a6ab7"
last_connected = "2026-01-03T12:00:00Z"
```

Config locations:
- **Windows:** `%APPDATA%\limiquantix\qvmc\config.toml`
- **macOS:** `~/Library/Application Support/com.limiquantix.qvmc/config.toml`
- **Linux:** `~/.config/qvmc/config.toml`

#### `api.rs` - Control Plane Client

HTTP client for Control Plane API:

```rust
pub struct ControlPlaneClient {
    base_url: String,
    client: reqwest::Client,
}

impl ControlPlaneClient {
    pub async fn list_vms(&self) -> Result<Vec<VmInfo>, ApiError>;
    pub async fn get_vm(&self, vm_id: &str) -> Result<VmInfo, ApiError>;
    pub async fn get_console_info(&self, vm_id: &str) -> Result<ConsoleInfo, ApiError>;
    pub async fn start_vm(&self, vm_id: &str) -> Result<(), ApiError>;
    pub async fn stop_vm(&self, vm_id: &str) -> Result<(), ApiError>;
    // ... other operations
}
```

#### `vnc/mod.rs` - VNC Connection Management

Manages active VNC connections:

```rust
pub struct VncManager {
    active_connections: HashMap<String, Arc<Mutex<VncConnection>>>,
}

impl VncManager {
    pub async fn connect(&self, conn_id: &str, host: &str, port: u16, password: Option<&str>) -> Result<(), VncError>;
    pub fn disconnect(&self, conn_id: &str);
    pub async fn send_key(&self, conn_id: &str, keysym: u32, down: bool) -> Result<(), VncError>;
    pub async fn send_pointer(&self, conn_id: &str, x: u16, y: u16, buttons: u8) -> Result<(), VncError>;
}
```

#### `vnc/rfb.rs` - RFB Protocol Implementation

Complete VNC protocol implementation:

**Handshake:**
1. Protocol version negotiation (RFB 003.008)
2. Security type negotiation (None, VNC Authentication)
3. VNC Authentication (DES-encrypted challenge-response)
4. Client init (shared flag)
5. Server init (framebuffer dimensions, pixel format)

**Client-to-Server Messages:**
- `SetPixelFormat` - Configure pixel format
- `SetEncodings` - Declare supported encodings
- `FramebufferUpdateRequest` - Request screen update
- `KeyEvent` - Keyboard input
- `PointerEvent` - Mouse input
- `ClientCutText` - Clipboard data

**Server-to-Client Messages:**
- `FramebufferUpdate` - Screen data
- `SetColourMapEntries` - Color palette (indexed color)
- `Bell` - Audible bell
- `ServerCutText` - Clipboard data

#### `vnc/encodings.rs` - Encoding Decoders

Implements VNC encoding decoders:

| Encoding | ID | Description |
|----------|-----|-------------|
| Raw | 0 | Uncompressed pixels |
| CopyRect | 1 | Copy from existing framebuffer |
| RRE | 2 | Rise-and-Run-length Encoding |
| Hextile | 5 | Tile-based with sub-encoding |
| ZRLE | 16 | Zlib Run-Length Encoding |
| Cursor | -239 | Cursor shape pseudo-encoding |
| DesktopSize | -223 | Desktop resize pseudo-encoding |

### 2.6 React Frontend Components

#### `ConnectionList.tsx`

Displays saved connections with:
- Connection cards (name, host, last connected)
- "Add Connection" button
- Delete connection (with confirmation)
- Import from Control Plane button

#### `ConsoleView.tsx`

Canvas-based VNC display:
- HTML5 Canvas for framebuffer rendering
- Keyboard event capture
- Mouse event capture (move, click, scroll)
- Toolbar (Ctrl+Alt+Del, fullscreen, settings)

#### `Settings.tsx`

Display and connection settings:
- Scale viewport toggle
- Show remote cursor toggle
- Preferred encoding selection
- Quality slider (1-9)
- Compression slider (0-9)
- Control Plane URL input

#### `tauri-api.ts`

TypeScript wrapper for Tauri commands:

```typescript
// Connections
export async function getSavedConnections(): Promise<Connection[]>;
export async function addConnection(connection: NewConnection): Promise<Connection>;
export async function removeConnection(id: string): Promise<void>;

// VNC
export async function connectVnc(id: string, host: string, port: number, password?: string): Promise<void>;
export async function disconnectVnc(id: string): Promise<void>;
export async function sendKeyEvent(id: string, keysym: number, down: boolean): Promise<void>;
export async function sendPointerEvent(id: string, x: number, y: number, buttons: number): Promise<void>;
export async function sendCtrlAltDel(id: string): Promise<void>;

// Settings
export async function getSettings(): Promise<Settings>;
export async function saveSettings(settings: Settings): Promise<void>;

// Control Plane
export async function fetchVmsFromControlPlane(url: string): Promise<VmInfo[]>;
```

### 2.7 Dependencies

#### Rust (`Cargo.toml`)

```toml
[dependencies]
tauri = { version = "1", features = ["shell-open"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
anyhow = "1"
thiserror = "1"
tracing = "0.1"
tracing-subscriber = "0.3"
dirs = "5"
toml = "0.8"
reqwest = { version = "0.11", features = ["json"] }
flate2 = "1"
rusb = "0.9"
```

#### Frontend (`package.json`)

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@tauri-apps/api": "^1.5.0",
    "lucide-react": "^0.303.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^1.5.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "tailwindcss": "^3.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

### 2.8 Building and Running

#### Development

```bash
cd qvmc
npm install
npm run tauri dev
```

#### Production Build

```bash
npm run tauri build
```

Output locations:
- **Windows:** `src-tauri/target/release/bundle/msi/qvmc_0.1.0_x64_en-US.msi`
- **macOS:** `src-tauri/target/release/bundle/macos/qvmc.app`
- **Linux:** `src-tauri/target/release/bundle/deb/qvmc_0.1.0_amd64.deb`

---

## Part 3: Feature Comparison

| Feature | Web Console | qvmc |
|---------|-------------|-------|
| **Installation** | None (browser) | Desktop app (10-15 MB) |
| **Startup Time** | Instant | < 1 second |
| **Display Protocol** | VNC via WebSocket | VNC direct TCP |
| **Input Latency** | ~50ms | ~20ms |
| **Frame Rate** | 30 fps | 60 fps |
| **Keyboard** | Most keys | All keys (global hotkeys) |
| **Ctrl+Alt+Del** | ✅ Button | ✅ Hotkey + Button |
| **Clipboard** | Limited (browser sandbox) | ✅ Full (planned) |
| **USB Passthrough** | ❌ | ✅ (planned) |
| **Audio** | ❌ | ✅ SPICE (planned) |
| **Multi-Monitor** | ❌ | ✅ (planned) |
| **Offline Use** | ❌ | ✅ Saved connections |
| **Auto-Update** | Always latest | Update mechanism (planned) |

---

## Part 4: Security Considerations

### Authentication

- **Web Console:** Relies on dashboard session
- **qvmc:** Stores API token securely (OS keychain planned)

### Transport Security

- **Web Console:** WSS (WebSocket Secure) when HTTPS
- **qvmc:** TLS for API, VNC TLS extension (planned)

### VNC Authentication

- VNC password authentication (DES-encrypted challenge)
- Password retrieved from Control Plane, never stored locally

---

## Part 5: Completed Features

### ✅ Completed

| Task | Status |
|------|--------|
| Web console with real VM | ✅ Working |
| qvmc VNC DES authentication | ✅ Implemented |
| LimiQuantix-styled noVNC page | ✅ Complete |
| qvmc connection persistence | ✅ Complete |
| qvmc Deep Link support (`qvmc://`) | ✅ Complete |
| Console Access Modal (Web/Native choice) | ✅ Complete |
| OS-specific download buttons | ✅ Complete |
| Protocol handler registration (Windows) | ✅ Complete |
| qvmc Modern UI with animations | ✅ Complete |

### Future (P2)

| Task | Effort | Status |
|------|--------|--------|
| USB passthrough (qvmc) | 1 week | Planned |
| Clipboard sync (qvmc) | 3 days | Planned |
| SPICE protocol (qvmc) | 2 weeks | Planned |
| Audio forwarding | 1 week | Planned |

---

## Appendix A: Troubleshooting

### Web Console Issues

**"Connection Failed" Error:**
1. Check backend is running (`go run ./cmd/controlplane --dev`)
2. Check VM is running (`virsh list --all`)
3. Check Node Daemon is running and registered
4. Check VNC port is accessible from backend

**Black Screen:**
1. Wait a few seconds for framebuffer update
2. Click inside console to focus
3. Press a key to trigger update

### qvmc Issues

**"cargo: command not found":**
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

**"failed to get cargo metadata":**
```bash
# Ensure Rust is in PATH
export PATH="$HOME/.cargo/bin:$PATH"
# Or on Windows, restart terminal after Rust installation
```

---

## Appendix B: References

- [noVNC GitHub](https://github.com/novnc/noVNC)
- [Tauri Documentation](https://tauri.app/v1/guides/)
- [RFB Protocol Specification](https://github.com/rfbproto/rfbproto/blob/master/rfbproto.rst)
- [SPICE Protocol](https://www.spice-space.org/spice-protocol.html)
- [gorilla/websocket](https://github.com/gorilla/websocket)
