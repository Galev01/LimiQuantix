# ADR-000010: TUI-Only Console for Quantix-OS

**Document ID:** 000010  
**Date:** January 10, 2026  
**Status:** Accepted  
**Scope:** Quantix-OS console interface

## Context

Quantix-OS needs a local management console similar to VMware ESXi's DCUI (Direct Console User Interface). This console runs on the physical server and allows administrators to:

- Configure network settings
- Set root password
- View system status
- Join/leave clusters
- Access troubleshooting tools

We evaluated three approaches:

1. **Slint GUI** - Native Rust GUI framework with KMS/DRM rendering
2. **Web Kiosk** - Cage (Wayland compositor) + Cog (WebKit browser) running React UI
3. **TUI** - Terminal User Interface using ratatui on text console

## Decision

**We chose the TUI-only approach.**

The console will be implemented as a Rust application using ratatui, running directly on TTY1 (the Linux text console).

## Rationale

### Why Not Slint GUI?

- Complex dependencies (Wayland, Mesa, GPU drivers)
- Debugging display issues on headless servers is difficult
- Added ~200MB to ISO for graphics stack
- Not all server hardware has compatible GPU/display output
- Build complexity with cross-compilation for musl

### Why Not Web Kiosk?

- Cage + Cog + WPE WebKit adds significant complexity
- WebKit is a massive dependency (~100MB+)
- JavaScript runtime overhead for a simple config UI
- Wayland still requires display server infrastructure
- Overkill for displaying a few configuration screens

### Why TUI?

- **Minimal dependencies**: Just needs a terminal (always available)
- **Works everywhere**: Serial console, SSH, KVM, direct display
- **Tiny footprint**: ratatui is lightweight (~1MB binary)
- **Fast startup**: No display server initialization
- **Reliable**: Text console is the most battle-tested interface
- **ESXi-like**: VMware's DCUI is also text-based
- **Easy debugging**: Can run over serial port for headless servers

## Implementation

### Components

```
Quantix-OS/console-tui/
├── Cargo.toml
├── src/
│   ├── main.rs         # Entry point, event loop
│   ├── ui.rs           # TUI rendering (ratatui)
│   ├── auth.rs         # Password verification
│   ├── config.rs       # System configuration
│   └── ...
```

### Runtime

- Binary: `/usr/local/bin/qx-console`
- Launcher: `/usr/local/bin/qx-console-launcher`
- Service: `/etc/init.d/quantix-console`
- Runs on: TTY1 (primary console)

### Features

- Network configuration (IP, gateway, DNS, VLAN)
- Hostname configuration
- Root password management
- SSH enable/disable
- System status dashboard
- Cluster join/leave
- Reboot/shutdown

### Technology Stack

- **Rust 2021 edition**
- **ratatui** - Terminal UI library
- **crossterm** - Cross-platform terminal handling
- **tokio** - Async runtime for API calls
- **serde/serde_yaml** - Configuration parsing

## Consequences

### Positive

- Simpler build process (no graphics dependencies)
- Smaller ISO size (~100MB savings)
- Works on all hardware (including serial-only servers)
- Faster boot to console
- Easier to maintain and debug

### Negative

- No mouse support (keyboard-only navigation)
- Limited visual richness (no images, limited colors)
- Must design UI for 80x25 terminal constraints

### Mitigations

- Keyboard navigation is natural for server admins
- TUI can still look professional (see htop, lazygit)
- Host UI (web) provides rich interface for detailed management

## Related Documents

- ADR-000008: Console Access Strategy
- docs/Quantix-OS/000048-tui-console-architecture.md

## Changelog

| Date | Change |
|------|--------|
| 2026-01-10 | Initial decision - TUI-only approach adopted |
