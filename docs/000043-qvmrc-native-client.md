# QVMRC - Quantix Virtual Machine Remote Console

**Document ID:** 000043  
**Date:** January 3, 2026  
**Status:** Implemented  
**Purpose:** Native desktop VNC client for VM console access

---

## Overview

QVMRC (Quantix Virtual Machine Remote Console) is a native desktop application built with Tauri (Rust + React) that provides high-performance VNC console access to virtual machines managed by the LimiQuantix platform.

### Why a Native Client?

| Feature | Web Console (noVNC) | QVMRC Native |
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
│                        QVMRC (Tauri App)                             │
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
qvmrc/
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
cd qvmrc

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
| Windows | `target/release/QVMRC.exe` | `target/release/bundle/msi/*.msi` |
| macOS | `target/release/bundle/macos/QVMRC.app` | `target/release/bundle/dmg/*.dmg` |
| Linux | `target/release/qvmrc` | `target/release/bundle/appimage/*.AppImage` |

---

## Configuration

### Config File Location

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\limiquantix\qvmrc\config.toml` |
| macOS | `~/Library/Application Support/com.limiquantix.qvmrc/config.toml` |
| Linux | `~/.config/qvmrc/config.toml` |

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
