# TUI Installer Bug Fixes - Resolution Summary

**Document Number:** 000002  
**Created:** 2026-01-09  
**Last Updated:** 2026-01-09  
**Status:** Resolved  
**Related:** 000001-tui-installer-boot-system.md

---

## Executive Summary

The Quantix-vDC TUI installer was failing to display after boot. The ISO would boot successfully, mount the squashfs, and log "Running TUI in chroot..." but the dialog interface would never appear. This document details all bugs discovered and their resolutions.

---

## Bug #1: Squashfs Path Not Updated After mount --move

### Symptoms
- Boot would hang or fail to find squashfs
- Error: "Squashfs file not accessible"

### Root Cause
After using `mount --move` to relocate the CD-ROM mount from `/mnt/check` to `/mnt/cdrom`, the `SQUASHFS_FILE` variable still referenced the old path.

### Fix
```bash
# BEFORE (buggy)
mount --move /mnt/check /mnt/cdrom
# SQUASHFS_FILE still pointing to /mnt/check/...

# AFTER (fixed)
mount --move /mnt/check /mnt/cdrom
SQUASHFS_FILE="/mnt/cdrom/quantix-vdc/system.squashfs"  # Update path!
```

### Files Modified
- `builder/build-installer-initramfs.sh` (lines ~400-405)

---

## Bug #2: OverlayFS Directories Created Before tmpfs Mount

### Symptoms
- OverlayFS mount would fail
- Error about missing upper/work directories

### Root Cause
The code created `/mnt/overlay/upper` and `/mnt/overlay/work` directories, then mounted tmpfs over `/mnt/overlay`, which hid the created directories.

### Fix
```bash
# BEFORE (buggy)
mkdir -p /mnt/overlay/upper
mkdir -p /mnt/overlay/work
mount -t tmpfs tmpfs /mnt/overlay  # Hides the directories!

# AFTER (fixed)
mkdir -p /mnt/overlay
mount -t tmpfs tmpfs /mnt/overlay  # Mount first
mkdir -p /mnt/overlay/upper        # Then create inside tmpfs
mkdir -p /mnt/overlay/work
mkdir -p /mnt/overlay/merged
```

### Files Modified
- `builder/build-installer-initramfs.sh` (lines ~480-495)

---

## Bug #3: Installer Scripts Not Copied to Squashfs

### Symptoms
- "Installer script not found inside rootfs!"
- TUI never launches

### Root Cause
The installer scripts (`tui.sh`, `install.sh`, `firstboot.sh`) existed in the source tree but were not being copied into the root filesystem that becomes the squashfs.

### Fix
Added a new step in `build-rootfs.sh`:

```bash
# Step 7: Copy installer scripts
echo "📋 Step 7: Copy installer scripts..."
mkdir -p "${ROOTFS_DIR}/installer"
cp "${WORK_DIR}/installer/"*.sh "${ROOTFS_DIR}/installer/"
chmod +x "${ROOTFS_DIR}/installer/"*
```

### Files Modified
- `builder/build-rootfs.sh` (lines ~227-242)

---

## Bug #4: Missing losetup Busybox Symlink

### Symptoms
- Warning: "losetup failed with code 127"
- Fallback to `mount -o loop` succeeded but was suboptimal

### Root Cause
`losetup` is a busybox applet but wasn't included in the symlinks created during initramfs generation.

### Fix
Added `losetup` to the busybox symlinks:

```bash
for cmd in ... losetup ...; do
    ln -sf busybox "${INITRAMFS_DIR}/bin/$cmd"
done

# Also in /sbin for compatibility
for cmd in ... losetup ...; do
    ln -sf ../bin/busybox "${INITRAMFS_DIR}/sbin/$cmd"
done
```

### Files Modified
- `builder/build-installer-initramfs.sh` (lines ~127-143)

---

## Bug #5: Missing TTY Device Nodes

### Symptoms
- Console I/O not working properly
- Dialog unable to render

### Root Cause
Even with `devtmpfs` mounted, some TTY devices weren't being auto-created by the kernel, depending on boot configuration.

### Fix
Explicitly create TTY devices after mounting devtmpfs:

```bash
[ -c /dev/tty ] || mknod /dev/tty c 5 0
[ -c /dev/tty0 ] || mknod /dev/tty0 c 4 0
[ -c /dev/tty1 ] || mknod /dev/tty1 c 4 1
[ -c /dev/console ] || mknod /dev/console c 5 1
[ -c /dev/null ] || mknod /dev/null c 1 3
chmod 666 /dev/tty /dev/tty0 /dev/tty1 /dev/console /dev/null
```

### Files Modified
- `builder/build-installer-initramfs.sh` (lines ~341-352)

---

## Bug #6: Missing Terminfo Database

### Symptoms
- TUI logs "Running TUI in chroot..." then exits
- Dialog unable to render any UI elements

### Root Cause
The initramfs didn't include terminfo database files. Dialog/ncurses needs these to know how to draw boxes, handle colors, and control cursor positioning.

### Fix
Copy terminfo files into the initramfs:

```bash
mkdir -p "${INITRAMFS_DIR}/usr/share/terminfo/l"
mkdir -p "${INITRAMFS_DIR}/usr/share/terminfo/v"
mkdir -p "${INITRAMFS_DIR}/usr/share/terminfo/x"

# Find and copy terminal definitions
for terminfo_base in /usr/share/terminfo /lib/terminfo /etc/terminfo; do
    if [ -f "${terminfo_base}/l/linux" ]; then
        cp "${terminfo_base}/l/linux" "${INITRAMFS_DIR}/usr/share/terminfo/l/"
        break
    fi
done
```

### Files Modified
- `builder/build-installer-initramfs.sh` (lines ~243-285)

---

## Bug #7: Using cttyhack (Not Available in Alpine)

### Symptoms
- "cttyhack: applet not found"
- Installer exits with code 127

### Root Cause
Alpine Linux's busybox does NOT include the `cttyhack` applet, which is used in some distributions to set up a controlling terminal.

### Fix
Replace `cttyhack` with a wrapper script approach:

```bash
# BEFORE (buggy)
setsid cttyhack chroot "${INSTALL_ROOT}" /bin/sh -c "..."

# AFTER (fixed)
# Create wrapper script
cat > /tmp/run-tui.sh << 'TUISCRIPT'
#!/bin/sh
export TERM=linux
export HOME=/root
export TERMINFO=/usr/share/terminfo
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
exec /installer/tui.sh
TUISCRIPT

chmod +x /tmp/run-tui.sh
cp /tmp/run-tui.sh "${INSTALL_ROOT}/tmp/run-tui.sh"

# Use setsid with exec
setsid sh -c "exec chroot ${INSTALL_ROOT} /tmp/run-tui.sh <${CONSOLE_DEV} >${CONSOLE_DEV} 2>&1"
```

### Files Modified
- `builder/build-installer-initramfs.sh` (lines ~590-620)

---

## Bug #8: Environment Variables Not Set in Chroot

### Symptoms
- Dialog behaves incorrectly
- Terminal not recognized

### Root Cause
The chroot environment didn't have essential environment variables set for ncurses/dialog to function.

### Fix
Set required environment variables:

```bash
export TERM=linux
export HOME=/root
export TERMINFO=/usr/share/terminfo
export PATH=/bin:/sbin:/usr/bin:/usr/sbin
```

### Files Modified
- `builder/build-installer-initramfs.sh` (multiple locations)

---

## Summary of All Modified Files

| File                                   | Changes Made                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `builder/build-installer-initramfs.sh` | TTY creation, terminfo copying, losetup/setsid symlinks, OverlayFS fix, squashfs path fix, cttyhack replacement, environment setup |
| `builder/build-rootfs.sh`              | Added installer scripts copying step                                                                                               |
| `builder/build-iso.sh`                 | Added squashfs verification and size checks                                                                                        |
| `Makefile`                             | Combined rootfs + iso build in single container                                                                                    |

---

## Verification

After all fixes were applied:

1. ISO boots successfully ✅
2. Squashfs mounts correctly ✅
3. OverlayFS sets up properly ✅
4. TUI installer displays in QEMU ✅
5. Dialog UI renders with proper colors and boxes ✅

---

## Lessons Learned

1. **Path references must be updated after mount operations** - `mount --move` changes the effective path
2. **Order of operations matters for overlay filesystems** - tmpfs must be mounted before creating directories inside it
3. **Alpine busybox has limited applets** - Don't assume `cttyhack` or other applets exist
4. **Terminfo is essential for ncurses applications** - Always include terminal definitions
5. **Device nodes may need explicit creation** - Don't rely solely on devtmpfs
6. **Environment variables must be explicitly set in chroot** - The chroot environment is minimal
