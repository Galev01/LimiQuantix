# Workflow State

## Quantix-OS Installer TUI Boot Fix

### Status: IN PROGRESS

### Goal
Eliminate the "Installer not found" error when booting the ISO by ensuring
installer scripts are available in the live root, even with `toram`.

### Plan
1. Cache installer scripts before unmounting boot media in initramfs.
2. Copy cached installer scripts into `/installer` in the live root.
3. Update installer troubleshooting documentation.
4. Rebuild ISO and validate installer TUI shows on boot.

### Log
- Cached installer scripts during initramfs for toram boots.
- Updated installer troubleshooting guidance.

### References
- `Quantix-OS/initramfs/init`
- `docs/Quantix-OS/000057-installer-storage-pool-configuration.md`
