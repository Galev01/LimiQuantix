# Workflow State

## Current Status: COMPLETED

## Active Workflow: Remove Web Kiosk - TUI Only

**Date:** January 7, 2026

### Summary

Removed the Web Kiosk (Cage + Cog + Wayland) functionality entirely. The TUI is now the only local console interface, which simplifies the system significantly and eliminates all the graphics driver issues.

### Changes Made

#### 1. Simplified Console Launcher (`qx-console-launcher`)
- Removed all Web Kiosk code (Cage, Cog, Wayland setup)
- Removed graphics detection and DRI checks
- Removed fallback logic and retry mechanisms
- Now directly launches the TUI console
- Kept emergency shell fallback if TUI binary is missing

#### 2. Reduced Package List (`packages.conf`)
**Removed packages:**
- `cage` - Wayland kiosk compositor
- `wpewebkit` - WebKit browser engine
- `cog` - WPE WebKit browser
- `wlroots` - Wayland compositor library
- `seatd`, `seatd-openrc`, `libseat` - Seat management (for Wayland)
- `setxkbmap` - X keyboard config
- `mesa-*` - All Mesa OpenGL/Vulkan packages
- `mesa-vulkan-intel`, `libva-intel-driver`, `intel-media-driver` - Intel GPU
- `libdrm` - DRM library
- `freetype`, `fontconfig`, `font-*`, `ttf-*` - Fonts

**Kept packages:**
- `kbd` - Keyboard utilities
- `libinput` - Input handling
- `ncurses`, `ncurses-terminfo-base` - Terminal support for TUI

#### 3. Simplified Console Service (`quantix-console`)
- Removed Wayland/seatd dependencies
- Removed XDG_RUNTIME_DIR setup
- Simplified service to just launch TUI

### Benefits

1. **Reliability** - No more graphics driver issues
2. **Smaller Image** - Removed ~200MB of graphics packages
3. **Faster Boot** - No waiting for Web UI or graphics initialization
4. **Simpler Code** - Easier to maintain and debug
5. **Universal** - Works on all hardware (VMs, servers, laptops)

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Quantix-OS Console                       │
├─────────────────────────────────────────────────────────────┤
│  TTY1: TUI Console (qx-console)                             │
│    - Network configuration (F2)                             │
│    - SSH access with timer (F3)                             │
│    - Cluster join/leave (F4)                                │
│    - Refresh display (F5)                                   │
│    - Restart services (F6)                                  │
│    - System logs (F7)                                       │
│    - Shutdown/Reboot (F10)                                  │
├─────────────────────────────────────────────────────────────┤
│  ttyS0: Serial Console (getty)                              │
│    - For headless servers                                   │
│    - 115200 baud                                            │
├─────────────────────────────────────────────────────────────┤
│  Web UI: https://<host-ip>:8443                             │
│    - Full management interface                              │
│    - Served by qx-node daemon                               │
│    - Access from any browser                                │
└─────────────────────────────────────────────────────────────┘
```

### Files Modified

- `Quantix-OS/overlay/usr/local/bin/qx-console-launcher` - Simplified to TUI only
- `Quantix-OS/profiles/quantix/packages.conf` - Removed graphics packages
- `Quantix-OS/overlay/etc/init.d/quantix-console` - Simplified service

### Testing

To rebuild and test:

```bash
cd Quantix-OS
make iso
```

### Previous Work

Previous workflows have been archived to `completed_workflow.md`.
