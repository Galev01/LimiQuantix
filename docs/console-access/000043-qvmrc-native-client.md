# qvmc - Quantix Virtual Machine Remote Console

**Document ID:** 000043  
**Date:** January 3, 2026 (Updated: UI Redesign & Protocol Handler Fix)  
**Status:** Production Ready  
**Purpose:** Native desktop VNC client for VM console access

---

## Overview

qvmc (Quantix Virtual Machine Remote Console) is a native desktop application built with Tauri (Rust + React) that provides high-performance VNC console access to virtual machines managed by the LimiQuantix platform.

### UI Design Philosophy

qvmc follows a modern, layer-based UI design with:

- **Deep color hierarchy**: Base → Surface → Elevated layers for visual depth
- **Smooth animations**: Spring-based transitions, scale/fade effects
- **Proper spacing**: Consistent 24px page margins, 16px component gaps
- **Accessibility**: High contrast text, visible focus states, WCAG compliant

### Why a Native Client?

| Feature | Web Console (noVNC) | qvmc Native |
|---------|---------------------|--------------|
| Installation | None | Requires install |
| Performance | Good | Excellent (native rendering) |
| Input Latency | ~10-20ms | ~1-5ms |
| USB Passthrough | ❌ No | ✅ Planned |
| Audio Forwarding | Limited | ✅ Planned |
| Clipboard | Limited | ✅ Full |
| Offline Saved Connections | ❌ No | ✅ Yes |
| Multi-Window | ❌ Tabs only | ✅ Yes |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        qvmc (Tauri App)                             │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              React Frontend (TypeScript)                      │   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │ Connection  │  │  Console    │  │  Settings   │          │   │
│  │  │    List     │  │    View     │  │    Page     │          │   │
│  │  └─────────────┘  └──────┬──────┘  └─────────────┘          │   │
│  │                          │                                    │   │
│  │                    Canvas Rendering                           │   │
│  │                    Mouse/Keyboard Events                      │   │
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
│  │              │    VNC Connection     │                       │   │
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
│   ├── App.tsx             # Main app component
│   ├── index.css           # Global styles
│   ├── components/
│   │   ├── ConnectionList.tsx   # Saved connections
│   │   ├── ConsoleView.tsx      # VNC canvas + toolbar
│   │   └── Settings.tsx         # App settings
│   └── lib/
│       └── tauri-api.ts    # Tauri command bindings
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

### 2. VNC Connection

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

### 3. Input Events

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

qvmc supports deep link URLs to automatically open and connect to VMs directly from the web UI.

### URL Format

```
qvmc://connect?url=<control_plane_url>&vmId=<vm_id>&vmName=<vm_name>
```

**Example:**
```
qvmc://connect?url=http%3A%2F%2Flocalhost%3A8080&vmId=vm-abc123&vmName=My%20Web%20Server
```

### How It Works

1. **User clicks "Open in qvmc"** in the web UI
2. Browser launches qvmc with the deep link URL
3. qvmc parses the URL and:
   - Saves the connection to config
   - Immediately connects to the VM's VNC console
4. Connection is saved for future access

### Frontend Integration

The web UI `ConsoleAccessModal` component generates the deep link:

```typescript
const qvmcConnectionUrl = `qvmc://connect?url=${encodeURIComponent(controlPlaneUrl)}&vmId=${encodeURIComponent(vmId)}&vmName=${encodeURIComponent(vmName)}`;
```

### Protocol Handler Registration

The protocol handler is registered when qvmc is installed:

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

1. **Reinstall qvmc** using the NSIS installer (not MSI)
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
