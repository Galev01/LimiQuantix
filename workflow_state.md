# Workflow State

## Quantix-OS Installer TUI Boot Fix

### Status: IN PROGRESS

### Goal
Ensure the Quantix-OS ISO boots directly into the installer TUI, even when
`toram` is used, and avoid the "Installer not found" error.

### Plan
1. Ensure installer scripts are copied into the live root during initramfs boot.
2. Keep installer discovery robust (prefer `/installer/tui.sh` in live root).
3. Update installer documentation with troubleshooting guidance.
4. Rebuild ISO and validate installer TUI shows on boot.

### Progress Log
- Added initramfs copy step to place installer scripts in `/installer`.
- Added troubleshooting guidance to `docs/Quantix-OS/000057-installer-storage-pool-configuration.md`.

### References
- `Quantix-OS/initramfs/init`
- `Quantix-OS/overlay/usr/local/bin/qx-console-launcher`
- `Quantix-OS/builder/build-iso.sh`
- `docs/Quantix-OS/000057-installer-storage-pool-configuration.md`
