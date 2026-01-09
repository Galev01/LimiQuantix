# Quantix-vDC TUI Installer - Boot & Init System Documentation

**Document Number:** 000001  
**Created:** 2026-01-09  
**Last Updated:** 2026-01-09  
**Status:** Complete  

---

## Overview

This document describes the boot process, initramfs architecture, and TUI installer launch mechanism for the Quantix-vDC control plane appliance. It covers the technical details of how the ISO boots, mounts the squashfs filesystem, sets up OverlayFS, and launches the interactive TUI installer.

---

## Architecture

### Boot Flow

```
ISO Boot (ISOLINUX/GRUB)
    │
    ▼
Linux Kernel Load
    │
    ▼
Initramfs Extraction
    │
    ▼
/init Script Execution
    │
    ├── Mount essential filesystems (proc, sys, devtmpfs)
    ├── Create TTY devices
    ├── Load kernel modules
    ├── Find boot media (CD-ROM)
    ├── Mount squashfs
    ├── Setup OverlayFS
    │
    ▼
Chroot into OverlayFS
    │
    ▼
TUI Installer (dialog-based)
```

### Key Components

| Component                      | Location     | Purpose                                           |
| ------------------------------ | ------------ | ------------------------------------------------- |
| `build-installer-initramfs.sh` | `builder/`   | Generates the initramfs with embedded init script |
| `build-rootfs.sh`              | `builder/`   | Creates the squashfs root filesystem              |
| `build-iso.sh`                 | `builder/`   | Assembles the final bootable ISO                  |
| `tui.sh`                       | `installer/` | Dialog-based TUI installer                        |
| `install.sh`                   | `installer/` | Core installation logic                           |

---

## Initramfs Structure

The initramfs is a compressed CPIO archive containing:

```
/
├── bin/
│   ├── busybox          # Static busybox binary
│   ├── sh -> busybox    # Essential command symlinks
│   ├── mount -> busybox
│   ├── setsid -> busybox
│   └── ... (other symlinks)
├── sbin/
│   ├── modprobe -> ../bin/busybox
│   └── ... (other symlinks)
├── lib/
│   ├── ld-musl-*.so     # musl libc
│   └── modules/         # Kernel modules
├── usr/share/terminfo/
│   ├── l/linux          # Terminal definitions
│   ├── v/vt100
│   └── x/xterm
├── etc/
│   ├── passwd
│   └── group
├── installer/
│   ├── tui.sh
│   ├── install.sh
│   └── firstboot.sh
└── init                 # Init script (shell script)
```

---

## Critical Implementation Details

### 1. TTY Device Creation

The init script must create essential TTY devices after mounting `devtmpfs`:

```bash
# Create essential TTY devices if not present
[ -c /dev/tty ] || mknod /dev/tty c 5 0
[ -c /dev/tty0 ] || mknod /dev/tty0 c 4 0
[ -c /dev/tty1 ] || mknod /dev/tty1 c 4 1
[ -c /dev/console ] || mknod /dev/console c 5 1
[ -c /dev/null ] || mknod /dev/null c 1 3

# Set proper permissions
chmod 666 /dev/tty /dev/tty0 /dev/tty1 /dev/console /dev/null
```

**Why:** Even with `devtmpfs`, some TTY devices may not be auto-created. Dialog requires these for terminal I/O.

### 2. Terminal Definitions (terminfo)

Dialog/ncurses requires terminfo database files to render UI elements:

```bash
mkdir -p "${INITRAMFS_DIR}/usr/share/terminfo/l"
mkdir -p "${INITRAMFS_DIR}/usr/share/terminfo/v"
mkdir -p "${INITRAMFS_DIR}/usr/share/terminfo/x"

# Copy terminal definitions from build environment
cp /usr/share/terminfo/l/linux "${INITRAMFS_DIR}/usr/share/terminfo/l/"
cp /usr/share/terminfo/v/vt100 "${INITRAMFS_DIR}/usr/share/terminfo/v/"
cp /usr/share/terminfo/x/xterm "${INITRAMFS_DIR}/usr/share/terminfo/x/"
```

**Why:** Without terminfo, dialog cannot determine how to draw boxes, colors, or handle cursor movement.

### 3. Squashfs Path After mount --move

When moving a mount point, all path references must be updated:

```bash
# Initial mount
mount -o ro "$dev" /mnt/check

# Move to final location
mount --move /mnt/check /mnt/cdrom

# CRITICAL: Update the path reference!
SQUASHFS_FILE="/mnt/cdrom/quantix-vdc/system.squashfs"  # NOT /mnt/check!
```

**Why:** After `mount --move`, the original path no longer contains the mounted filesystem.

### 4. OverlayFS Setup Order

The overlay directories must be created AFTER mounting tmpfs:

```bash
# 1. Create base overlay directory
mkdir -p /mnt/overlay

# 2. Mount tmpfs FIRST
mount -t tmpfs tmpfs /mnt/overlay

# 3. THEN create subdirectories inside tmpfs
mkdir -p /mnt/overlay/upper
mkdir -p /mnt/overlay/work
mkdir -p /mnt/overlay/merged

# 4. Mount overlay
mount -t overlay overlay \
    -o lowerdir=/mnt/rootfs,upperdir=/mnt/overlay/upper,workdir=/mnt/overlay/work \
    /mnt/overlay/merged
```

**Why:** Creating directories before tmpfs mount results in them being hidden when tmpfs is mounted.

### 5. Launching TUI in Chroot

Alpine's busybox does NOT include `cttyhack`. Use this alternative approach:

```bash
# Determine console device
CONSOLE_DEV="/dev/console"
[ -c /dev/tty1 ] && CONSOLE_DEV="/dev/tty1"

# Create wrapper script
cat > /tmp/run-tui.sh << 'TUISCRIPT'
#!/bin/sh
export TERM=linux
export HOME=/root
export TERMINFO=/usr/share/terminfo
export PATH=/bin:/sbin:/usr/bin:/usr/sbin

if command -v dialog >/dev/null 2>&1; then
    exec /installer/tui.sh
else
    echo 'ERROR: dialog command not found!'
    exec /bin/sh
fi
TUISCRIPT

chmod +x /tmp/run-tui.sh
cp /tmp/run-tui.sh "${INSTALL_ROOT}/tmp/run-tui.sh"

# Launch with setsid for new session
setsid sh -c "exec chroot ${INSTALL_ROOT} /tmp/run-tui.sh <${CONSOLE_DEV} >${CONSOLE_DEV} 2>&1"
```

**Why:** `cttyhack` is not available in Alpine busybox. The wrapper script + setsid approach provides equivalent functionality.

---

## Environment Variables

The following environment variables must be set for dialog to work:

| Variable   | Value                           | Purpose                       |
| ---------- | ------------------------------- | ----------------------------- |
| `TERM`     | `linux`                         | Terminal type for console     |
| `TERMINFO` | `/usr/share/terminfo`           | Location of terminfo database |
| `HOME`     | `/root`                         | Home directory                |
| `PATH`     | `/bin:/sbin:/usr/bin:/usr/sbin` | Command search path           |

---

## Required Kernel Modules

The init script loads these modules in order:

```bash
# Filesystem support
modprobe squashfs
modprobe overlay
modprobe isofs
modprobe loop

# Storage drivers
modprobe scsi_mod
modprobe sd_mod
modprobe sr_mod    # CD-ROM
modprobe cdrom

# Hardware drivers (QEMU/real hardware)
modprobe ahci      # SATA
modprobe nvme      # NVMe
modprobe virtio_pci
modprobe virtio_blk
modprobe virtio_scsi
```

---

## Busybox Symlinks

Essential busybox symlinks for the initramfs:

```bash
# Core utilities
sh ash ls cat cp mv rm mkdir mount umount mknod

# Process control
setsid ps kill killall

# Disk utilities  
losetup fdisk sfdisk blkid lsblk dd

# Module loading
modprobe insmod lsmod depmod

# Networking (for later stages)
ip ifconfig route ping hostname

# Text utilities
grep sed awk head tail sort uniq
```

**Note:** `cttyhack` is NOT available in Alpine busybox and should not be used.

---

## Troubleshooting

### TUI Shows "Running TUI in chroot..." But Nothing Appears

**Causes:**
1. Missing terminfo files
2. Console device not accessible
3. Missing TTY devices

**Solutions:**
- Verify terminfo exists: `ls -la /usr/share/terminfo/l/linux`
- Check console devices: `ls -la /dev/tty*`
- Review console selection in init script

### "Installer exited with 127"

**Cause:** Command not found (usually `cttyhack` or missing symlink)

**Solution:** Ensure all busybox symlinks are created and don't use `cttyhack`

### Squashfs Mount Fails

**Causes:**
1. Path not updated after `mount --move`
2. Loop device not available
3. Squashfs module not loaded

**Solutions:**
- Update `SQUASHFS_FILE` after moving mount
- Ensure `losetup` symlink exists
- Verify `modprobe squashfs` succeeds

### OverlayFS Mount Fails

**Cause:** upper/work directories created before tmpfs mount

**Solution:** Mount tmpfs first, then create directories inside it

---

## Build Process

```bash
# Full ISO build
make iso

# Test in QEMU
make test-qemu

# Test with virtual disk (installer testing)
make test-qemu-install

# Clean and rebuild
make clean
make iso
```

---

## References

- Alpine Linux Wiki: https://wiki.alpinelinux.org/
- Busybox Applets: https://busybox.net/downloads/BusyBox.html
- OverlayFS Documentation: https://docs.kernel.org/filesystems/overlayfs.html
- Terminfo Database: https://invisible-island.net/ncurses/terminfo.html
