# QvMC - Quantix Virtual Machine Console

**Document ID:** 000043  
**Date:** January 3, 2026 (Updated: January 11, 2026 - Sidebar + Tab UI Redesign)  
**Status:** Production Ready  
**Purpose:** Native desktop VNC client for VM console access

---

## Overview

QvMC (Quantix Virtual Machine Console) is a native desktop application built with Tauri (Rust + React) that provides high-performance VNC console access to virtual machines managed by the LimiQuantix platform.

### UI Design Philosophy

QvMC follows a modern, layer-based UI design with:

- **Deep color hierarchy**: Base → Surface → Elevated layers for visual depth
- **Smooth animations**: Spring-based transitions, scale/fade effects
- **Proper spacing**: Consistent 24px page margins, 16px component gaps
- **Accessibility**: High contrast text, visible focus states, WCAG compliant

### New UI Layout (v0.2.0)

The redesigned UI features a collapsible sidebar and tab-based console management:

```
+------------------+----------------------------------------+
| VM List (toggle) |  [VM1 Tab] [VM2 Tab] [VM3 Tab]  [+]   |
|                  |----------------------------------------|
| - vm-1 ●         |                                        |
| - vm-2 ●         |         Active Console Canvas          |
| - vm-3 ○         |                                        |
|                  |                                        |
| [+ Add]          |                                        |
+------------------+----------------------------------------+
```

**Key Features:**
- **Collapsible Sidebar**: Toggle the VM list to maximize console space
- **Tab-Based Consoles**: Open multiple VMs simultaneously, switch between them
- **Persistent Connections**: Tabs maintain their VNC sessions when switching
- **Quick Actions**: Power controls and ISO mounting from sidebar context menu

### Why a Native Client?

| Feature | Web Console (noVNC) | QvMC Native |
|---------|---------------------|--------------|
| Installation | None | Requires install |
| Performance | Good | Excellent (native rendering) |
| Input Latency | ~10-20ms | ~1-5ms |
| USB Passthrough | ❌ No | ✅ Planned |
| Audio Forwarding | Limited | ✅ Planned |
| Clipboard | Limited | ✅ Full |
| Offline Saved Connections | ❌ No | ✅ Yes |
| Multi-Console Tabs | ❌ No | ✅ Yes |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        QvMC (Tauri App)                             │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              React Frontend (TypeScript)                      │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │ VM Sidebar  │  │ Console     │  │  Console    │          │   │
│  │  │ (List)      │  │   Tabs      │  │  Tab Pane   │          │   │
│  │  └─────────────┘  └─────────────┘  └──────┬──────┘          │   │
│  │                                           │                    │   │
│  │                    Canvas Rendering / Multi-Tab State          │   │
│  │                    Mouse/Keyboard Events                       │   │
│  └──────────────────────────┼───────────────────────────────────┘   │
│                             │ Tauri IPC (invoke)                     │
│  ┌──────────────────────────┼───────────────────────────────────┐   │
│  │              Rust Backend (Tauri Commands)                    │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │   Config    │  │  VNC/RFB    │  │  API Client │          │   │
│  │  │  Manager    │  │   Client    │  │  (HTTP)     │          │   │
│  │  └─────────────┘  └──────┬──────┘  └─────────────┘          │   │
│  │                          │                                    │   │
│  │              ┌───────────┴───────────┐                       │   │
│  │              │    VNC Connection(s)  │                       │   │
│  │              │    (tokio TCP)        │                       │   │
│  │              └───────────┬───────────┘                       │   │
│  └──────────────────────────┼───────────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────────┘
                              │ TCP (RFB Protocol)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Control Plane API                               │
│            GET /limiquantix.compute.v1.VMService/GetConsole         │
│                              ↓                                       │
│                     Returns VNC host:port                            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     QEMU VNC Server                                  │
│                  (e.g., 192.168.0.53:5900)                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
qvmc/
├── index.html              # HTML entry point
├── package.json            # NPM dependencies
├── vite.config.ts          # Vite bundler config
├── tsconfig.json           # TypeScript config
│
├── src/                    # React Frontend
│   ├── main.tsx            # React entry
│   ├── App.tsx             # Main app layout (sidebar + tabs + console)
│   ├── index.css           # Global styles + CSS variables
│   ├── components/
│   │   ├── VMSidebar.tsx       # Collapsible VM list sidebar
│   │   ├── ConsoleTabs.tsx     # Horizontal tab bar for open consoles
│   │   ├── ConsoleTabPane.tsx  # Individual console instance (VNC canvas)
│   │   ├── ConsoleView.tsx     # Legacy single-console view
│   │   ├── ConnectionList.tsx  # Legacy grid connection view
│   │   ├── Settings.tsx        # App settings modal
│   │   ├── ThemeToggle.tsx     # Light/dark mode toggle
│   │   └── DebugPanel.tsx      # VNC debug logging panel
│   └── lib/
│       ├── tauri-api.ts        # Tauri command bindings
│       └── debug-logger.ts     # Logging utilities
│
└── src-tauri/              # Rust Backend
    ├── Cargo.toml          # Rust dependencies
    ├── tauri.conf.json     # Tauri configuration
    ├── build.rs            # Build script
    │
    └── src/
        ├── main.rs         # Tauri entry point
        ├── api.rs          # Control Plane API client
        ├── config.rs       # Config file management
        └── vnc/
            ├── mod.rs      # VNC module + Tauri commands
            ├── rfb.rs      # RFB protocol implementation
            ├── keysym.rs   # X11 keysym mappings
            └── encodings.rs # VNC encoding decoders
```

---

## UI Components

### App Layout (`App.tsx`)

The main application uses a CSS Grid layout with two columns:

```typescript
interface AppState {
  sidebarCollapsed: boolean;      // Toggle sidebar visibility
  tabs: TabConnection[];          // Array of open console tabs
  activeTabId: string | null;     // Currently focused tab
  showSettings: boolean;          // Settings modal visibility
}
```

**Layout CSS:**
```css
.app-layout {
  display: grid;
  grid-template-columns: 280px 1fr;  /* Sidebar | Main */
  transition: grid-template-columns 0.3s ease;
}

.app-layout.sidebar-collapsed {
  grid-template-columns: 56px 1fr;   /* Collapsed sidebar */
}
```

### VM Sidebar (`VMSidebar.tsx`)

Collapsible sidebar displaying saved VM connections:

- **Expanded Mode**: Shows VM name, ID, search bar, and action menu
- **Collapsed Mode**: Shows only VM icons with tooltips
- **Features**:
  - Add new connections
  - Power actions (start, stop, reboot, shutdown)
  - Mount ISO
  - Delete connections
  - Theme toggle

### Console Tabs (`ConsoleTabs.tsx`)

Horizontal tab bar for managing multiple console sessions:

```typescript
interface TabConnection {
  id: string;                       // Tab unique ID
  connectionId: string;             // VNC connection ID
  vmId: string;
  vmName: string;
  controlPlaneUrl: string;
  status: 'connecting' | 'connected' | 'disconnected';
}
```

**Features**:
- Click tab to switch consoles
- Close button on each tab
- Status indicator (connecting/connected/disconnected)
- Add button to open sidebar

### Console Tab Pane (`ConsoleTabPane.tsx`)

Individual console instance with VNC canvas:

- VNC framebuffer rendering
- Mouse and keyboard input handling
- Power controls and ISO mounting
- Scale mode (fit, fill, 1:1)
- Fullscreen toggle
- Debug panel access

---

## Features

### 1. Connection Management

```typescript
// Save a connection
await invoke('save_connection', {
  connection: {
    id: crypto.randomUUID(),
    name: 'My Production VM',
    control_plane_url: 'http://10.0.0.100:8080',
    vm_id: 'abc123-def456...',
  }
});

// Load saved connections
const { connections } = await invoke('get_saved_connections');
```

### 2. Multi-Tab Console Sessions

```typescript
// Open a new tab
const handleSelectVM = async (connection: SavedConnection) => {
  // Check if already open
  const existingTab = tabs.find(t => t.vmId === connection.vm_id);
  if (existingTab) {
    setActiveTabId(existingTab.id);
    return;
  }
  
  // Connect and create new tab
  const vncConnectionId = await invoke('connect_vnc', { ... });
  const newTab = { id: crypto.randomUUID(), connectionId: vncConnectionId, ... };
  setTabs([...tabs, newTab]);
  setActiveTabId(newTab.id);
};
```

### 3. VNC Connection

```typescript
// Connect to VM's VNC console
const connectionId = await invoke('connect_vnc', {
  controlPlaneUrl: 'http://localhost:8080',
  vmId: 'abc123...',
  password: 'optional-vnc-password',
});

// Listen for framebuffer updates
listen('vnc:framebuffer', (event) => {
  const { x, y, width, height, data } = event.payload;
  // Render to canvas...
});
```

### 4. Input Events

```typescript
// Send key event (X11 keysym)
await invoke('send_key_event', {
  connectionId,
  key: 0xffe3, // Ctrl_L
  down: true,
});

// Send pointer event
await invoke('send_pointer_event', {
  connectionId,
  x: 512,
  y: 384,
  buttons: 0x01, // Left button
});

// Send Ctrl+Alt+Del
await invoke('send_ctrl_alt_del', { connectionId });
```

---

## VNC Protocol Implementation

### Supported Features

| Feature | Status |
|---------|--------|
| **Protocol Versions** | RFB 3.8, 3.7, 3.3 |
| **Security Types** | None (1), VNC Auth (2) |
| **Pixel Formats** | 8/16/24/32 bpp, RGB/BGR |
| **Encodings** | Raw, CopyRect, RRE, Hextile, Zlib |
| **Input** | Keyboard (X11 keysyms), Pointer |
| **Clipboard** | Send text to server |
| **Cursor** | Pseudo-encoding (cursor shape) |
| **Desktop Resize** | Pseudo-encoding |

### VNC Authentication

VNC uses DES encryption for password authentication:

```rust
/// VNC Auth uses DES with bit-reversed key bytes
fn encrypt_challenge(challenge: &[u8; 16], password: &str) -> [u8; 16] {
    let mut key = [0u8; 8];
    for (i, &b) in password.as_bytes().iter().take(8).enumerate() {
        key[i] = b.reverse_bits(); // VNC quirk
    }
    
    let cipher = Des::new_from_slice(&key).unwrap();
    let mut response = *challenge;
    
    // Encrypt two 8-byte blocks
    cipher.encrypt_block((&mut response[0..8]).into());
    cipher.encrypt_block((&mut response[8..16]).into());
    
    response
}
```

### Keyboard Mapping

JavaScript keyCode → X11 keysym conversion:

```typescript
const codeMap: Record<string, number> = {
  'F1': 0xffbe, 'F2': 0xffbf, // Function keys
  'ArrowUp': 0xff52,          // Navigation
  'Enter': 0xff0d,            // Editing
  'ShiftLeft': 0xffe1,        // Modifiers
  // ...
};
```

---

## Building

### Prerequisites

1. **Node.js** 18+
2. **Rust** 1.70+
3. **Platform-specific**:
   - **Windows**: VS Build Tools
   - **macOS**: Xcode Command Line Tools
   - **Linux**: webkit2gtk, libappindicator

### Development

```bash
cd qvmc

# Install dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Production Build

```bash
# Build optimized binaries
npm run tauri build
```

### Output Locations

| Platform | Binary | Installer |
|----------|--------|-----------|
| Windows | `target/release/qvmc.exe` | `target/release/bundle/msi/*.msi` |
| macOS | `target/release/bundle/macos/qvmc.app` | `target/release/bundle/dmg/*.dmg` |
| Linux | `target/release/qvmc` | `target/release/bundle/appimage/*.AppImage` |

---

## Configuration

### Config File Location

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\limiquantix\qvmc\config.toml` |
| macOS | `~/Library/Application Support/com.limiquantix.qvmc/config.toml` |
| Linux | `~/.config/qvmc/config.toml` |

### Config Structure

```toml
[display]
scale_viewport = true
show_remote_cursor = true
preferred_encoding = "tight"
quality = 6
compression = 6

[[connections]]
id = "abc123..."
name = "Production Web Server"
control_plane_url = "http://10.0.0.100:8080"
vm_id = "vm-abc123..."
last_connected = "2026-01-03T12:00:00Z"

last_control_plane_url = "http://localhost:8080"
window_width = 1024
window_height = 768
window_maximized = false
```

---

## Cross-Platform Support

### Windows

- Windows 10/11 (x64)
- Uses WebView2 (Edge-based)
- MSI installer included

### macOS

- macOS 10.13+ (High Sierra)
- Universal binary (Intel + Apple Silicon)
- Code signing ready

### Linux

- Any modern distribution with GTK/WebKitGTK
- AppImage for universal distribution
- Deb package for Debian/Ubuntu

---

## Deep Link Integration

QvMC supports deep link URLs to automatically open and connect to VMs directly from the web UI.

### URL Format

```
qvmc://connect?url=<control_plane_url>&vmId=<vm_id>&vmName=<vm_name>
```

**Example:**
```
qvmc://connect?url=http%3A%2F%2Flocalhost%3A8080&vmId=vm-abc123&vmName=My%20Web%20Server
```

### How It Works

1. **User clicks "Open in QvMC"** in the web UI
2. Browser launches QvMC with the deep link URL
3. QvMC parses the URL and:
   - Saves the connection to config
   - Creates a new tab with the connection
   - Immediately connects to the VM's VNC console
4. Connection is saved for future access

### Frontend Integration

The web UI `ConsoleAccessModal` component generates the deep link:

```typescript
const qvmcConnectionUrl = `qvmc://connect?url=${encodeURIComponent(controlPlaneUrl)}&vmId=${encodeURIComponent(vmId)}&vmName=${encodeURIComponent(vmName)}`;
```

### Protocol Handler Registration

The protocol handler is registered when QvMC is installed:

- **Windows:** Registry entries created by NSIS installer (HKCU\SOFTWARE\Classes\qvmc)
- **macOS:** `Info.plist` URL scheme registration
- **Linux:** `.desktop` file with `x-scheme-handler`

#### Manual Protocol Registration (Windows)

If the protocol handler isn't working after installation, run the registration script:

```powershell
# Option 1: Use the provided script
cd qvmc/scripts
.\register-protocol.ps1

# Option 2: Manual PowerShell command
$ExePath = "$env:LOCALAPPDATA\qvmc\qvmc.exe"
New-Item -Path "HKCU:\SOFTWARE\Classes\qvmc" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\SOFTWARE\Classes\qvmc" -Name "(Default)" -Value "URL:qvmc Protocol"
New-ItemProperty -Path "HKCU:\SOFTWARE\Classes\qvmc" -Name "URL Protocol" -Value "" -Force | Out-Null
New-Item -Path "HKCU:\SOFTWARE\Classes\qvmc\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\SOFTWARE\Classes\qvmc\shell\open\command" -Name "(Default)" -Value "`"$ExePath`" `"%1`""
```

#### Verifying Registration

```powershell
# Check if protocol is registered
Get-ItemProperty -Path "HKCU:\SOFTWARE\Classes\qvmc\shell\open\command"
```

---

## Security Considerations

1. **VNC Passwords** - Stored in config file (consider adding keychain integration)
2. **TLS** - Control Plane API supports HTTPS (configure `control_plane_url`)
3. **VNC Encryption** - VNC Auth uses weak DES; prefer SSH tunneling for production
4. **Code Signing** - Set up certificates for distribution

---

## Future Enhancements

| Feature | Priority | Status |
|---------|----------|--------|
| USB Passthrough | P2 | Scaffolded |
| SPICE Protocol | P2 | Not started |
| Audio Forwarding | P3 | Not started |
| File Transfer | P3 | Not started |
| Multi-Monitor | P3 | Not started |
| SSH Tunnel Integration | P2 | Not started |

---

## Troubleshooting

### "Scheme does not have a registered handler" Error

This means the `qvmc://` protocol handler isn't registered:

1. **Reinstall QvMC** using the NSIS installer (not MSI)
2. **Or manually register** using the PowerShell script in `qvmc/scripts/register-protocol.ps1`
3. **Or run the registration command** shown in the "Protocol Handler Registration" section

### "Failed to connect" Error

1. Check Control Plane URL is reachable
2. Verify VM ID is correct
3. Ensure VM is running
4. Check firewall allows VNC port (5900+)

### Black Screen

1. Click inside the console to focus
2. Press any key to trigger refresh
3. VM might still be booting

### Keyboard Not Working

1. Click inside console to focus canvas
2. Check browser didn't capture keys (Ctrl+Tab, etc.)
3. Try Ctrl+Alt+Del button instead

### Building Fails

**Windows:**
```bash
# Install Visual Studio Build Tools
winget install Microsoft.VisualStudio.2022.BuildTools
```

**Linux:**
```bash
# Ubuntu/Debian
sudo apt install webkit2gtk-4.0-dev libappindicator3-dev
```

---

## References

- [Tauri Documentation](https://tauri.app/v1/guides/)
- [RFB Protocol RFC 6143](https://datatracker.ietf.org/doc/html/rfc6143)
- [X11 Keysym Reference](https://www.x.org/releases/current/doc/xproto/x11protocol.html)
