# Workflow State

## Current Status: COMPLETED

## Active Workflow: USB Deployment Script

**Date:** January 7, 2026

### Task Completed

Created a comprehensive USB deployment script (`deploy-usb.sh`) that handles all the edge cases that cause issues with manual `dd`:

### Files Created/Modified

| File | Change |
|------|--------|
| `Quantix-OS/builder/deploy-usb.sh` | **NEW** - Complete USB deployment script |
| `Quantix-OS/Makefile` | Added `deploy-usb` and `list-usb` targets |
| `Quantix-OS/build.sh` | Updated final instructions to use deploy-usb.sh |
| `docs/Quantix-OS/000059-quantix-os-build-guide.md` | Added USB deployment documentation |

### Why This Is Better Than Manual DD

| Problem | Manual DD | deploy-usb.sh |
|---------|-----------|---------------|
| Windows "file not found" error | ❌ Leaves old signatures | ✅ Wipes with wipefs + sgdisk |
| "Device busy" errors | ❌ Must manually unmount | ✅ Auto-unmounts all partitions |
| Fake "2.5 GB/s" speed | ❌ Reports cached speed | ✅ Uses `conv=fsync` for true sync |
| Corrupted writes | ❌ No verification | ✅ Optional MD5 verification |
| Wrong device | ❌ Easy to destroy system | ✅ Validates USB, warns on non-USB |

### Script Features

1. **Signature Wiping** - `wipefs -a` + `sgdisk --zap-all` + zero first/last 1MB
2. **Auto Unmounting** - Detaches all partitions, uses udisksctl if available
3. **Hardware Sync** - `conv=fsync oflag=direct` + standalone `sync`
4. **Device Validation** - Checks for system disk, warns on non-USB
5. **Verification** - Optional MD5 checksum comparison
6. **Pretty Output** - Colored progress, ASCII art banner

### Usage

   ```bash
# List USB devices
sudo ./builder/deploy-usb.sh --list
# Or: make list-usb

# Deploy ISO to USB
sudo ./builder/deploy-usb.sh /dev/sdb
# Or: make deploy-usb USB=/dev/sdb

# Deploy with verification
sudo ./builder/deploy-usb.sh --verify /dev/sdb
# Or: make deploy-usb USB=/dev/sdb VERIFY=1

# Force mode (skip confirmation)
sudo ./builder/deploy-usb.sh --force /dev/sdb
```

### Testing Checklist

- [ ] Script executes without errors
- [ ] `--list` shows USB devices correctly
- [ ] Device validation catches partition paths (e.g., /dev/sdb1)
- [ ] Device validation warns on non-USB devices
- [ ] Unmounting works for mounted partitions
- [ ] Signature wiping completes
- [ ] DD with progress works
- [ ] Verification mode works
- [ ] Make targets work (`make list-usb`, `make deploy-usb USB=/dev/sdb`)

---

## Previous Workflow (Archived)

The TUI Build Fix workflow has been moved to `completed_workflow.md`.
