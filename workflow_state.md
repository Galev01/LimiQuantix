# Workflow State: Framebuffer Fallback GUI for Quantix-OS Console

## Problem

The current console launcher fails when:
- DRM/KMS is unavailable (basic VGA-only VMs)
- TTY terminal emulation is broken

Current fallback chain: Slint LinuxKMS (GPU) → Slint LinuxKMS (Software) → TUI → Shell

## Solution

Add a **raw framebuffer backend** that renders directly to `/dev/fb0` using `linuxfb` + `embedded-graphics`. This bypasses all display servers and terminal requirements.

New fallback chain: Slint LinuxKMS (GPU) → Slint LinuxKMS (Software) → **Raw Framebuffer** → TUI → Shell

## Implementation Tasks

- [x] 1. Update `Cargo.toml` with framebuffer dependencies (`linuxfb`, `embedded-graphics`, `evdev`)
- [x] 2. Create `framebuffer/mod.rs` - Module root with run() entry point
- [x] 3. Create `framebuffer/fb.rs` - Framebuffer device wrapper with double-buffering
- [x] 4. Create `framebuffer/ui.rs` - UI rendering (header, status, menu, dialogs)
- [x] 5. Create `framebuffer/input.rs` - Keyboard input via evdev or raw stdin
- [x] 6. Create `framebuffer/app.rs` - Application state and event loop
- [x] 7. Update `main.rs` - Add framebuffer fallback path with `--framebuffer` flag
- [x] 8. Update `qx-console-launcher` - Add framebuffer attempt before shell fallback
- [x] 9. Update `Makefile` - Build with framebuffer feature
- [x] 10. Update `Dockerfile.rust-gui` - Add framebuffer library dependencies
- [x] 11. Update `README.md` - Document framebuffer fallback

## Files Created

- `quantix-os/console-gui/src/framebuffer/mod.rs` - Module root
- `quantix-os/console-gui/src/framebuffer/fb.rs` - Framebuffer wrapper with IOCTL, mmap, double-buffering
- `quantix-os/console-gui/src/framebuffer/ui.rs` - ESXi-style UI rendering with embedded-graphics
- `quantix-os/console-gui/src/framebuffer/input.rs` - Evdev keyboard input handler
- `quantix-os/console-gui/src/framebuffer/app.rs` - Application event loop and state

## Files Modified

- `quantix-os/console-gui/Cargo.toml` - Added framebuffer feature and dependencies
- `quantix-os/console-gui/src/main.rs` - Added `--framebuffer` flag and fallback logic
- `quantix-os/overlay/usr/local/bin/qx-console-launcher` - Added framebuffer attempt step
- `quantix-os/Makefile` - Build with `linuxkms,framebuffer` features
- `quantix-os/builder/Dockerfile.rust-gui` - Updated description
- `quantix-os/README.md` - Added framebuffer documentation

## Key Features

### Framebuffer Rendering (`fb.rs`)
- Direct `/dev/fb0` access via IOCTL and mmap
- Supports 16, 24, and 32-bit color depths
- Automatic pixel format detection (BGR/RGB)
- Double-buffering for flicker-free updates
- Implements `DrawTarget` trait for embedded-graphics

### Input Handling (`input.rs`)
- Evdev-based keyboard reading from `/dev/input/event*`
- Automatic keyboard device detection
- Fallback to raw stdin reading
- Full function key support (F1-F12)
- Character input for authentication dialogs

### UI Components (`ui.rs`)
- ESXi-inspired color palette
- Header with branding and version
- Node status panel (hostname, IP, cluster, uptime)
- Resource usage with progress bars (CPU, memory, VMs)
- Function key menu bar
- Authentication dialog with username/password fields
- Confirmation dialogs for dangerous actions

### Application Logic (`app.rs`)
- Same features as Slint GUI (auth, SSH toggle, services, shell, reboot)
- 60fps render loop with periodic status refresh
- State machine for screen transitions
- Full audit logging for sensitive actions

## Testing

To test framebuffer mode:
1. Boot QEMU with `-vga std` (no virtio-gpu)
2. The console launcher will try Slint first, then fall back to framebuffer
3. Or manually run: `qx-console-gui --framebuffer`

## Status: COMPLETE ✅
