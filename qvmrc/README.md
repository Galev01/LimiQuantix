# QVMRC - Quantix Virtual Machine Remote Console

A native desktop application for remote VM console access with VNC/SPICE support.

## Overview

QVMRC is a hybrid Management UI and Direct Hypervisor Client, similar to VMware VMRC. It provides:

- **Management Channel (Blue)**: VM operations (restart, shutdown, snapshots) via the LimiQuantix Control Plane
- **Console Channel (Red)**: Screen, keyboard, mouse, USB passthrough via VNC/SPICE

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         QVMRC                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    React UI Layer                            │ │
│  │   ConnectionList.tsx | ConsoleView.tsx | Settings.tsx        │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                 Tauri Bridge (IPC)                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                  Rust Native Layer                           │ │
│  │     api.rs (Control Plane) | vnc.rs (VNC Client)            │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
        │                                    │
        │ HTTPS/Connect-RPC                 │ VNC (RFB)
        ▼                                    ▼
┌───────────────────────┐          ┌───────────────────────┐
│   Control Plane (Go)  │          │   QEMU VNC Server     │
│   localhost:8080      │          │   192.168.x.x:5900    │
└───────────────────────┘          └───────────────────────┘
```

## Features

### Current (v0.1.0)
- [x] VNC connection via Control Plane
- [x] Keyboard and mouse input
- [x] Ctrl+Alt+Del hotkey
- [x] Fullscreen mode
- [x] Saved connections
- [x] Display settings (quality, compression)

### Planned
- [ ] USB device passthrough
- [ ] Clipboard sync
- [ ] SPICE protocol support
- [ ] Audio passthrough
- [ ] Multi-monitor support
- [ ] File transfer (drag & drop)

## Development

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Node.js](https://nodejs.org/) 18+
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites)

### Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

### Project Structure

```
qvmrc/
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── api.rs          # Control Plane API client
│   │   ├── config.rs       # Configuration management
│   │   └── vnc/            # VNC client implementation
│   │       ├── mod.rs      # Connection management
│   │       ├── rfb.rs      # RFB protocol
│   │       └── encodings.rs# Encoding decoders
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    # React frontend
│   ├── components/
│   │   ├── ConnectionList.tsx
│   │   ├── ConsoleView.tsx
│   │   └── Settings.tsx
│   ├── lib/
│   │   └── tauri-api.ts    # Tauri API wrapper
│   ├── App.tsx
│   └── main.tsx
├── package.json
└── vite.config.ts
```

## Building Installers

### Windows
```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/msi/QVMRC_0.1.0_x64_en-US.msi
```

### macOS
```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/macos/QVMRC.app
```

### Linux
```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/deb/qvmrc_0.1.0_amd64.deb
#         src-tauri/target/release/bundle/appimage/qvmrc_0.1.0_amd64.AppImage
```

## Configuration

Configuration is stored in:
- **Windows**: `%APPDATA%\limiquantix\qvmrc\config.toml`
- **macOS**: `~/Library/Application Support/com.limiquantix.qvmrc/config.toml`
- **Linux**: `~/.config/qvmrc/config.toml`

Example:
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
```

## License

Apache-2.0

## Credits

- Built with [Tauri](https://tauri.app/)
- VNC protocol implementation inspired by [noVNC](https://github.com/novnc/noVNC)
- Part of the [LimiQuantix](https://github.com/Galev01/LimiQuantix) project
