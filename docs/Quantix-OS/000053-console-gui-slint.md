# 000053 - Quantix-OS Console GUI (Slint)

This document describes the Quantix-OS graphical console (DCUI - Direct Console User Interface), built with the Slint UI framework.

**Last Updated:** January 4, 2026

---

## Overview

The console GUI provides local management of the Quantix-OS hypervisor node. It renders directly to the framebuffer using KMS/DRM on production systems, or uses a windowed mode (winit) for desktop development.

### Why Slint Over Wayland Kiosk?

| Feature | Slint | Wayland Kiosk (Chromium) |
|---------|-------|--------------------------|
| RAM Usage | ~10 MB | ~500 MB |
| Boot Time | Milliseconds | 5-10 seconds |
| Dependencies | Single binary | Chromium + Mesa + Fonts |
| Offline | ✅ Works offline | ❌ Needs web server |
| Attack Surface | Minimal | Large (Chromium CVEs) |
| ISO Size Impact | +3-5 MB | +150-200 MB |
| Development | Compile-time checked | Runtime debugging |

**Winner: Slint** - Lightweight, secure, modern UI with CSS-like syntax, and native Rust integration.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Boot Flow                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  First Boot?  ──Yes──> Installation Wizard                  │
│      │                   1. Set hostname                     │
│      │                   2. Create admin user                │
│      │                   3. Set admin password               │
│      │                   4. Configure network (DHCP/Static)  │
│      No                  5. Enable/disable SSH               │
│      │                                                       │
│      v                                                       │
│  Main Console (DCUI)                                         │
│      - System status (CPU, RAM, VMs)                         │
│      - Network config (requires auth)                        │
│      - SSH management (requires auth)                        │
│      - Service management (requires auth)                    │
│      - Emergency shell (requires auth + logged)              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Component Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                         main.rs                                 │
│  - Application entry point                                     │
│  - Event loop management                                       │
│  - State management (AppState)                                 │
│  - Callback handlers                                           │
└────────────────────┬───────────────────────────────────────────┘
                     │
    ┌────────────────┼────────────────┬─────────────────┐
    v                v                v                 v
┌─────────┐   ┌───────────┐   ┌─────────────┐   ┌──────────────┐
│ auth.rs │   │  ssh.rs   │   │ network.rs  │   │system_info.rs│
│         │   │           │   │             │   │              │
│ Argon2  │   │ OpenRC    │   │ Interface   │   │ CPU/Memory   │
│ hashing │   │ sshd      │   │ discovery   │   │ usage        │
│         │   │ control   │   │ Static/DHCP │   │              │
│ Audit   │   │           │   │ config      │   │ Uptime       │
│ logging │   │ Host key  │   │             │   │              │
│         │   │ generation│   │ DNS/Gateway │   │ Hostname     │
└─────────┘   └───────────┘   └─────────────┘   └──────────────┘
                     │
                     v
┌────────────────────────────────────────────────────────────────┐
│                      ui/main.slint                              │
│  - Theme (colors, fonts, spacing)                              │
│  - Reusable components (Card, Button, Input, Toggle)           │
│  - InstallWizard screen (4 steps)                              │
│  - MainScreen dashboard                                        │
│  - AuthDialog and ConfirmDialog overlays                       │
└────────────────────────────────────────────────────────────────┘
```

---

## Files

| Path | Description |
|------|-------------|
| `quantix-os/console-gui/Cargo.toml` | Dependencies and feature flags |
| `quantix-os/console-gui/build.rs` | Slint build script |
| `quantix-os/console-gui/src/main.rs` | Application entry point and event handling |
| `quantix-os/console-gui/src/auth.rs` | Admin authentication (Argon2 password hashing) |
| `quantix-os/console-gui/src/ssh.rs` | SSH service management |
| `quantix-os/console-gui/src/network.rs` | Network interface configuration |
| `quantix-os/console-gui/src/system_info.rs` | System information utilities |
| `quantix-os/console-gui/ui/main.slint` | Slint UI definition (~1700 lines) |
| `quantix-os/console-gui/assets/logo.png` | Quantix logo (64x64 PNG) |
| `quantix-os/overlay/etc/init.d/quantix-console` | OpenRC service script |
| `quantix-os/overlay/etc/init.d/quantix-setup` | First-boot setup script |
| `quantix-os/overlay/etc/local.d/10-quantix-init.start` | Early init script |

---

## Feature Flags & Build Targets

The `Cargo.toml` uses feature flags to support different rendering backends:

```toml
[features]
default = ["desktop"]
desktop = ["slint/backend-winit", "slint/renderer-femtovg"]
# Uses femtovg (pure Rust) instead of Skia to enable static linking with musl
linuxkms = ["slint/backend-linuxkms", "slint/renderer-femtovg"]
```

> **Note**: We use `renderer-femtovg` instead of `renderer-skia` for the production build because:
> 1. Femtovg is pure Rust and links statically with musl
> 2. Skia has C++ dependencies that require glibc, causing "not found" errors on Alpine
> 3. The binary must run on Quantix-OS (Alpine Linux with musl libc)

### Desktop Build (Development)

```bash
cd quantix-os/console-gui

# Uses winit (windowed) + femtovg (OpenGL) - runs on X11/Wayland/Windows/macOS
cargo build --release

./target/release/qx-console-gui
```

### LinuxKMS Build (Production)

```bash
cd quantix-os/console-gui

# Uses LinuxKMS (framebuffer) + Skia (hardware-accelerated)
cargo build --release --no-default-features --features linuxkms

# Binary goes to /usr/bin/qx-console-gui on Quantix-OS
```

### System Dependencies (LinuxKMS only)

For the `linuxkms` backend, you need these development libraries:

**Ubuntu/Debian:**
```bash
sudo apt install libudev-dev libxkbcommon-dev libfreetype-dev \
                 libfontconfig1-dev libgbm-dev libinput-dev libseat-dev
```

**Alpine Linux:**
```bash
apk add eudev-dev libxkbcommon-dev freetype-dev fontconfig-dev \
        mesa-dev libinput-dev seatd-dev
```

---

## Slint UI Structure

### Theme

The UI uses a dark theme optimized for server consoles:

```slint
global Theme {
    // Background layers (dark to light)
    out property <color> bg-dark: #0a0e14;      // Darkest - page background
    out property <color> bg-panel: #141a22;     // Panel backgrounds
    out property <color> bg-card: #1a222c;      // Card backgrounds
    out property <color> bg-hover: #242d3a;     // Hover states
    out property <color> bg-selected: #2a3645;  // Selected states
    
    // Text colors
    out property <color> text-primary: #e6edf3;
    out property <color> text-secondary: #8b949e;
    out property <color> text-muted: #6e7681;
    
    // Brand colors
    out property <color> accent-blue: #58a6ff;
    out property <color> accent-green: #3fb950;
    out property <color> accent-yellow: #d29922;
    out property <color> accent-red: #f85149;
    
    // Font sizes
    out property <length> font-sm: 13px;
    out property <length> font-md: 15px;
    out property <length> font-lg: 18px;
    out property <length> font-xl: 24px;
    out property <length> font-2xl: 32px;
}
```

### Data Structures

```slint
// System status (passed from Rust)
export struct SystemStatus {
    hostname: string,
    ip-address: string,
    cluster-status: string,
    cpu-percent: float,
    memory-percent: float,
    memory-used: string,
    memory-total: string,
    vm-count: int,
    uptime: string,
    version: string,
    ssh-enabled: bool,
    ssh-sessions: int,
}

// Log entry for recent activity
export struct LogEntry {
    timestamp: string,
    level: string,      // "info", "warn", "error"
    message: string,
}

// Installation configuration
export struct InstallConfig {
    hostname: string,
    admin-username: string,
    admin-password: string,
    confirm-password: string,
    network-interface: string,
    use-dhcp: bool,
    static-ip: string,
    gateway: string,
    dns: string,
    enable-ssh: bool,
}
```

### Reusable Components

| Component | Description |
|-----------|-------------|
| `StatusDot` | Colored indicator (green/yellow/red) |
| `ProgressBar` | Animated progress bar with custom color |
| `Card` | Rounded container with border and shadow |
| `MenuButton` | Menu item with icon and keyboard shortcut |
| `ActionButton` | Button with primary/danger variants |
| `InputField` | Text input with label, placeholder, and validation |
| `Toggle` | On/off switch with label |
| `StatRow` | Key-value display row |
| `LogRow` | Log entry with colored level indicator |
| `InterfaceRow` | Network interface card |
| `ModalOverlay` | Semi-transparent dialog backdrop |
| `AuthDialog` | Username/password authentication modal |
| `ConfirmDialog` | Confirmation modal with cancel/confirm buttons |

### Screens

1. **InstallWizard** - First-boot setup with 4 steps
2. **MainScreen** - Dashboard with system status and menu

---

## Features

### 1. Installation Wizard

On first boot (when `/quantix/.setup_complete` doesn't exist), the wizard guides through:

| Step | Title | Fields |
|------|-------|--------|
| 1 | Node Identity | Hostname |
| 2 | Admin Account | Username, Password, Confirm Password |
| 3 | Network Configuration | Interface, DHCP toggle, Static IP/Gateway/DNS |
| 4 | Security Settings | SSH enable toggle, Summary |

**Logo**: The wizard displays the Quantix logo at the top (from `assets/logo.png`).

### 2. Authentication System

- **Password Hashing**: Argon2id (memory-hard, resistant to GPU attacks)
- **Storage**: `/quantix/admin.yaml` (mode 0600, root-only)
- **Account Lockout**: 5 failed attempts = 15-minute lockout
- **Audit Logging**: All auth attempts logged to `/var/log/quantix-console.log`

```yaml
# /quantix/admin.yaml
username: admin
password_hash: $argon2id$v=19$m=19456,t=2,p=1$...
ssh_enabled: false
created_at: 2026-01-04T12:00:00Z
last_login: 2026-01-04T12:30:00Z
failed_attempts: 0
last_failed_at: null
```

### 3. SSH Management

- **Disabled by default** - SSH is off on first boot
- Admin must authenticate to enable SSH
- Shows SSH status and active session count
- Uses OpenRC services (`sshd`)
- Generates host keys on first enable

### 4. Protected Operations

These operations require admin authentication:

| Operation | Menu Key | Notes |
|-----------|----------|-------|
| Configure Network | F2 | IP, gateway, DNS |
| SSH Management | F3 | Enable/disable |
| Join Cluster | F4 | Control plane URL |
| Restart Services | F5 | Node daemon, libvirt, OVS |
| View Diagnostics | F7 | System logs, hardware info |
| Shutdown/Reboot | F10 | Shows confirmation dialog |
| Emergency Shell | F12 | All activity logged |

### 5. System Monitoring

Real-time display (refreshes every 5 seconds):
- CPU usage (percentage + animated bar)
- Memory usage (percentage + used/total)
- Running VM count
- System uptime
- SSH status (enabled/disabled, session count)
- Recent log entries with error/warning counts

---

## Security Model

### Threat Model

The console is accessible to anyone with **physical access** to the server. We mitigate risks by:

1. **Authentication**: Password required for sensitive operations
2. **Password Hashing**: Argon2id is resistant to offline attacks
3. **Lockout**: Prevents brute-force attacks (15-min after 5 failures)
4. **Audit Logging**: All actions logged with timestamps
5. **SSH Off by Default**: Reduces remote attack surface
6. **Emergency Shell Logging**: Full session audit trail

### Audit Log Format

```
[2026-01-04 12:30:00 UTC] AUTH_SUCCESS user=admin Authentication successful
[2026-01-04 12:31:00 UTC] SSH_ENABLED user=admin SSH access enabled
[2026-01-04 12:45:00 UTC] SHELL_START user=admin Emergency shell session started
[2026-01-04 12:50:00 UTC] SHELL_END user=admin Emergency shell session ended
[2026-01-04 13:00:00 UTC] POWER_ACTION user=admin Power action: reboot
[2026-01-04 13:15:00 UTC] AUTH_FAILURE user=admin Authentication failed (attempt 1/5)
```

---

## Keyboard Navigation

### Main Dashboard

| Key | Action |
|-----|--------|
| ↑/↓ | Navigate menu items |
| Enter | Select current menu item |
| F2 | Configure Network |
| F3 | SSH Management |
| F4 | Join Cluster |
| F5 | Restart Services |
| F7 | View Diagnostics |
| F10 | Shutdown/Reboot |
| F12 | Emergency Shell |

### Dialogs

| Key | Action |
|-----|--------|
| Tab | Move between fields |
| Enter | Submit/Confirm |
| Esc | Cancel/Close |

### Installation Wizard

| Key | Action |
|-----|--------|
| Tab | Move between fields |
| Enter | Submit input / Next step |
| Click | Select interface / Toggle options |

**Note**: The FocusScope for keyboard navigation is only active on the main dashboard. During the installation wizard, text inputs receive focus normally.

---

## Customization

### Changing the Logo

1. Replace `quantix-os/console-gui/assets/logo.png` with your image
2. Recommended size: 64x64 or 128x128 pixels
3. Formats supported: PNG, JPEG, SVG
4. Rebuild the application

### Changing Colors

Edit the `Theme` global in `ui/main.slint`:

```slint
global Theme {
    out property <color> accent-blue: #your-brand-color;
    // ...
}
```

---

## Deployment

### Building the ISO

The console GUI is automatically included when building the Quantix-OS ISO:

```bash
cd quantix-os

# Build the complete ISO (includes TUI + GUI consoles)
make iso

# Or just build the GUI binary
make console-gui-binary
```

### Manual Build for Production

```bash
cd quantix-os/console-gui

# Build with LinuxKMS backend for framebuffer rendering
# Uses musl target for Alpine Linux compatibility
cargo build --release --no-default-features --features linuxkms --target x86_64-unknown-linux-musl

# Strip symbols for smaller binary
strip target/x86_64-unknown-linux-musl/release/qx-console-gui

# Copy to overlay
cp target/x86_64-unknown-linux-musl/release/qx-console-gui ../overlay/usr/bin/
```

> **Important**: Always build with `x86_64-unknown-linux-musl` target. The `x86_64-unknown-linux-gnu` target produces glibc binaries that fail with "not found" on Alpine Linux (which uses musl libc).

### Console Launcher

The system uses a launcher script (`/usr/local/bin/qx-console-launcher`) that:
1. Tries the Slint GUI console first (`/usr/bin/qx-console-gui`)
2. Falls back to TUI console if GUI fails (`/usr/local/bin/qx-console`)
3. Ultimate fallback: drops to shell

### Testing in VMware Workstation

1. Build the ISO: `cd quantix-os && make iso`
2. Create a new VM in VMware Workstation:
   - Guest OS: Other Linux 5.x (64-bit)
   - RAM: 4GB+
   - Enable "Accelerate 3D graphics" in Display settings
   - Boot from the ISO
3. The Slint GUI should render on the VM's virtual framebuffer

### OpenRC Service Script

```sh
#!/sbin/openrc-run
# /etc/init.d/quantix-console

name="Quantix Console GUI"
command="/usr/bin/qx-console-gui"
command_background="yes"
pidfile="/run/quantix-console.pid"

# Direct framebuffer rendering
export SLINT_BACKEND=linuxkms

depend() {
    need localmount
    after quantix-setup
}

start_pre() {
    # Ensure runtime directory exists
    mkdir -p /run/user/0
    chmod 700 /run/user/0
}
```

---

## Troubleshooting

### "Could not initialize backend" Error

**Desktop**: You're running the `linuxkms` binary on a desktop. Rebuild with:
```bash
cargo build --release  # Uses default 'desktop' feature
```

**Production**: Ensure DRM/KMS is available:
```bash
ls /dev/dri/card*
```

### Text Input Not Working

The FocusScope might be intercepting keyboard events. This was fixed by making the FocusScope conditional (only renders on main screen).

### Portal Permission Error

```
Portal operation not allowed: Unable to open /proc/.../root
```

This is a harmless warning from the XDG portal on desktop systems. It doesn't affect functionality and won't appear on Quantix-OS (no portal service).

### Missing System Libraries

```
unable to find library -lxkbcommon
```

Install development libraries (see [System Dependencies](#system-dependencies-linuxkms-only)).

---

## Fallback Behavior

If the Slint GUI fails to start (e.g., no KMS support), the system falls back to:

1. **TUI Console** (`qx-console`): Ratatui-based terminal UI
2. **Getty**: Standard login prompt on tty1

---

## Related Documents

- [000052 - Quantix-OS Architecture](./000052-quantix-os-architecture.md)
- [000051 - Quantix-OS Logging & Diagnostics](../000051-quantix-os-logging-diagnostics.md)
- [000006 - Proto and Build System Guide](../000006-proto-and-build-system-guide.md)
