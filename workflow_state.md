# Workflow State

## Current Status: COMPLETED

## Active Workflow: Console TUI Fixes

**Date:** January 8, 2026

### Latest Fix: DHCP/Network and Factory Reset

Fixed Console TUI network functions and implemented factory reset:

1. **DHCP Refresh (D key in Network screen)**
   - Moved execution to background thread to prevent TUI blocking
   - Changed `udhcpc` flags from `-n -q` to `-b` (background mode)
   - Added `-T 3` timeout and `-S` syslog flag
   - Skips virtual interfaces (vir*, br-*)

2. **Network Restart (R key in Network screen)**
   - Moved execution to background thread
   - Tries `quantix-network` service first, falls back to `networking`

3. **Factory Reset (F9 from main screen)**
   - Added new `Screen::FactoryReset` variant
   - Created `render_factory_reset_screen()` with detailed warning
   - Created `perform_factory_reset()` function that deletes:
     - Network configuration (interfaces, wpa_supplicant, resolv.conf)
     - TLS certificates
     - SSH host keys and authorized_keys
     - Node daemon and cluster configuration
     - Hostname (regenerates on boot)
     - First boot marker (triggers firstboot script)
   - System reboots automatically after reset
   - Virtual machines and storage data are preserved

### Files Modified

- `Quantix-OS/console-tui/src/main.rs`
  - Added `Screen::FactoryReset` enum variant
  - Fixed `run_dhcp_all()` to use background thread
  - Fixed `restart_network()` to use background thread
  - Added `render_factory_reset_screen()`
  - Added `perform_factory_reset()`
  - Added input handler for FactoryReset screen (Y/N/Esc)

### Build Instructions

Rebuild the Console TUI and ISO:
```bash
cd ~/LimiQuantix/quantix-os
sudo ./build.sh --clean
```

Or just rebuild the TUI:
```bash
cd ~/LimiQuantix/quantix-os
make tui
```

### Testing

1. Boot the ISO in QEMU
2. Press F2 to go to Network screen
3. Press D to refresh DHCP - should return immediately with message "Running DHCP on all interfaces..."
4. Press R to restart network - should return immediately with message "Restarting network service..."
5. Press Esc to return to main, then press F9 for Factory Reset
6. Verify confirmation screen appears with red border and clear instructions
7. Press N or Esc to cancel, verify "Factory reset cancelled" message
8. To test actual reset: Press Y (will delete configs and reboot)

### Previous Workflows

Archived to `completed_workflow.md`.
