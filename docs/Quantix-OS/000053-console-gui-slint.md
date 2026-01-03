# 000053 - Quantix-OS Console GUI (Slint)

This document describes the Quantix-OS graphical console (DCUI - Direct Console User Interface), built with the Slint UI framework.

## Overview

The console GUI provides local management of the Quantix-OS hypervisor node. It renders directly to the framebuffer using KMS/DRM, without requiring X11 or Wayland.

### Why Slint?

| Feature | Slint | Wayland Kiosk (Chromium) |
|---------|-------|--------------------------|
| RAM Usage | ~10 MB | ~500 MB |
| Boot Time | Milliseconds | 5-10 seconds |
| Dependencies | Single binary | Chromium + Mesa + Fonts |
| Offline | ✅ Works offline | ❌ Needs web server |
| Attack Surface | Minimal | Large (Chromium CVEs) |
| ISO Size Impact | +3-5 MB | +150-200 MB |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Boot Flow                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  First Boot?  ──Yes──> Installation Wizard                  │
│      │                   - Set hostname                     │
│      │                   - Create admin user                │
│      │                   - Set admin password               │
│      │                   - Configure network                │
│      No                  - Enable/disable SSH               │
│      │                                                      │
│      v                                                      │
│  Main Console (DCUI)                                        │
│      - System status (CPU, RAM, VMs)                        │
│      - Network config (requires auth)                       │
│      - SSH management (requires auth)                       │
│      - Service management (requires auth)                   │
│      - Emergency shell (requires auth + logged)             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Files

| Path | Description |
|------|-------------|
| `quantix-os/console-gui/src/main.rs` | Application entry point and event handling |
| `quantix-os/console-gui/src/auth.rs` | Admin authentication (Argon2 password hashing) |
| `quantix-os/console-gui/src/ssh.rs` | SSH service management |
| `quantix-os/console-gui/src/network.rs` | Network interface configuration |
| `quantix-os/console-gui/src/system_info.rs` | System information utilities |
| `quantix-os/console-gui/ui/main.slint` | Slint UI definition |
| `quantix-os/overlay/etc/init.d/quantix-console` | OpenRC service script |

## Features

### 1. Installation Wizard

On first boot (when `/quantix/.setup_complete` doesn't exist), the wizard guides through:

1. **Node Identity**: Set hostname
2. **Admin Account**: Create username and password
3. **Network Configuration**: Select interface, DHCP or static IP
4. **Security Settings**: Enable/disable SSH

### 2. Authentication System

- **Password Hashing**: Argon2id (secure, memory-hard)
- **Storage**: `/quantix/admin.yaml` (mode 0600)
- **Account Lockout**: 5 failed attempts = 15-minute lockout
- **Audit Logging**: All auth attempts logged to `/var/log/quantix-console.log`

```yaml
# /quantix/admin.yaml
username: admin
password_hash: $argon2id$v=19$...
ssh_enabled: false
created_at: 2026-01-04T12:00:00Z
last_login: 2026-01-04T12:30:00Z
failed_attempts: 0
```

### 3. SSH Management

- **Disabled by default** - SSH is off on first boot
- Admin must authenticate to enable SSH
- Shows SSH status and active session count
- Uses OpenRC services (`sshd`)

### 4. Protected Operations

These operations require admin authentication:

| Operation | Menu Key | Notes |
|-----------|----------|-------|
| Configure Network | F2 | IP, gateway, DNS |
| SSH Management | F3 | Enable/disable |
| Restart Services | F5 | Node daemon, libvirt, OVS |
| Shutdown/Reboot | F10 | Shows confirmation |
| Emergency Shell | F12 | All activity logged |

### 5. System Monitoring

Real-time display of:
- CPU usage (percentage + bar)
- Memory usage (percentage + used/total)
- Running VM count
- System uptime
- Recent log entries with error/warning counts

## Security Model

### Threat Model

The console is accessible to anyone with physical access to the server. We mitigate risks by:

1. **Authentication**: Password required for sensitive operations
2. **Lockout**: Prevents brute-force attacks
3. **Audit Logging**: All actions logged with timestamps
4. **SSH Off by Default**: Reduces remote attack surface

### Audit Log Format

```
[2026-01-04 12:30:00 UTC] AUTH_SUCCESS user=admin Authentication successful
[2026-01-04 12:31:00 UTC] SSH_ENABLED user=admin SSH access enabled
[2026-01-04 12:45:00 UTC] SHELL_START user=admin Emergency shell session started
[2026-01-04 12:50:00 UTC] SHELL_END user=admin Emergency shell session ended
[2026-01-04 13:00:00 UTC] POWER_ACTION user=admin Power action: reboot
```

## Building

```bash
# From project root
cd quantix-os/console-gui

# Debug build
cargo build

# Release build (optimized, stripped)
cargo build --release

# The binary will be at:
# target/release/qx-console-gui
```

### Dependencies

- Slint 1.9+ with `backend-linuxkms` and `renderer-skia`
- sysinfo for system metrics
- argon2 for password hashing
- nix for hostname/network operations

## Deployment

1. Copy binary to `/usr/bin/qx-console-gui`
2. Copy init script to `/etc/init.d/quantix-console`
3. Enable the service:
   ```bash
   rc-update add quantix-console default
   ```

## Keyboard Navigation

| Key | Action |
|-----|--------|
| ↑/↓ | Navigate menu |
| Enter | Select current item |
| F2 | Configure Network |
| F3 | SSH Management |
| F4 | Join Cluster |
| F5 | Restart Services |
| F7 | Diagnostics |
| F10 | Shutdown/Reboot |
| F12 | Emergency Shell |
| Esc | Cancel/Back |

## Fallback

If the Slint GUI fails to start (e.g., no KMS support), the system falls back to:

1. **TUI Console** (`qx-console`): Ratatui-based terminal UI
2. **Emergency Shell**: If TUI also fails

## Related Documents

- [000052 - Quantix-OS Architecture](./000052-quantix-os-architecture.md)
- [000051 - Quantix-OS Logging & Diagnostics](../000051-quantix-os-logging-diagnostics.md)
