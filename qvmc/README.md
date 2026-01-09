# qvmc - Quantix Virtual Machine Remote Console

A native desktop application for remote VM console access with VNC/SPICE support.

## Overview

qvmc is a hybrid Management UI and Direct Hypervisor Client, similar to VMware VMRC. It provides:

- **Management Channel (Blue)**: VM operations (restart, shutdown, snapshots) via the LimiQuantix Control Plane
- **Console Channel (Red)**: Screen, keyboard, mouse, USB passthrough via VNC/SPICE

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         qvmc                                    │
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
- [x] VNC Authentication (DES encryption)
- [x] Full RFB protocol implementation
- [x] Keyboard input (X11 keysym mapping)
- [x] Mouse input (pointer events)
- [x] Ctrl+Alt+Del hotkey
- [x] Fullscreen mode
- [x] Saved connections with persistence
- [x] Display settings (quality, compression)
- [x] Cross-platform builds (Windows, macOS, Linux)

### Planned
- [ ] USB device passthrough
- [ ] Clipboard sync (two-way)
- [ ] SPICE protocol support
- [ ] Audio passthrough
- [ ] Multi-monitor support
- [ ] File transfer (drag & drop)
- [ ] SSH tunnel integration

## Development

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Node.js](https://nodejs.org/) 18+

#### Platform-Specific Dependencies

**Windows:**
```bash
# Install Visual Studio Build Tools 2022
winget install Microsoft.VisualStudio.2022.BuildTools
```

**macOS:**
```bash
# Install Xcode Command Line Tools
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install -y libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf
```

**Linux (Fedora):**
```bash
sudo dnf install webkit2gtk4.0-devel libappindicator-gtk3-devel librsvg2-devel
```

**Linux (Arch):**
```bash
sudo pacman -S webkit2gtk libappindicator-gtk3 librsvg
```

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
qvmc/
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

### Step 1: Generate Icons (if not already done)
```bash
npm run generate-icons
```

### Step 2: Build for Your Platform

#### Windows (.exe Installer)
```bash
npm run tauri:build
# Output:
#   src-tauri/target/release/qvmc.exe                           (standalone)
#   src-tauri/target/release/bundle/nsis/qvmc_0.1.0_x64-setup.exe  (NSIS installer)
#   src-tauri/target/release/bundle/msi/qvmc_0.1.0_x64_en-US.msi   (MSI installer)
```

#### macOS (.dmg Installer)
```bash
npm run tauri:build
# Output:
#   src-tauri/target/release/bundle/macos/qvmc.app              (app bundle)
#   src-tauri/target/release/bundle/dmg/qvmc_0.1.0_x64.dmg      (DMG installer)
```

#### Linux (.AppImage / .deb)
```bash
npm run tauri:build
# Output:
#   src-tauri/target/release/bundle/deb/qvmc_0.1.0_amd64.deb
#   src-tauri/target/release/bundle/appimage/qvmc_0.1.0_amd64.AppImage
```

### Quick Build Commands
```bash
# Windows (on Windows machine)
npm run tauri:build

# macOS Universal Binary (on macOS)
npm run tauri:build:macos

# Linux (on Linux)
npm run tauri:build:linux
```

## Configuration

Configuration is stored in:
- **Windows**: `%APPDATA%\limiquantix\qvmc\config.toml`
- **macOS**: `~/Library/Application Support/com.limiquantix.qvmc/config.toml`
- **Linux**: `~/.config/qvmc/config.toml`

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
