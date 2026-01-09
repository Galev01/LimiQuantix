# Quick Testing Guide - Quantix-vDC Kernel Panic Fix

## 🚀 Quick Start

### 1. Rebuild the ISO
```bash
cd ~/LimiQuantix/Quantix-vDC
sudo make clean
sudo make iso
```

### 2. Test with Serial Console (Recommended)
```bash
# This shows ALL boot messages including kernel panic details
qemu-system-x86_64 \
    -m 4G \
    -smp 2 \
    -cdrom output/quantix-vdc-1.0.0.iso \
    -boot d \
    -nographic \
    -serial mon:stdio
```

**To exit QEMU:** Press `Ctrl+A` then `X`

### 3. Test with GUI (Alternative)
```bash
make test-qemu
```

---

## 🔍 What to Look For

### ✅ **SUCCESS** - Boot should show:
```
[    0.000000] Linux version 6.6.119-0-lts
[    0.123456] Unpacking initramfs...
============================================================
     QUANTIX-VDC INSTALLER STARTING
============================================================
[INIT] Script is running!
[INIT] Loading kernel modules...
[INIT]   ✅ scsi_mod loaded
[INIT]   ✅ sr_mod loaded
[INIT]   ✅ isofs loaded
[INIT] Detected block devices:
brw-rw----    1 root     root       11,   0 /dev/sr0
[INIT] Found squashfs on CD-ROM: /dev/sr0
[INIT] Launching TUI installer...
```

### ❌ **FAILURE** - Common errors:

#### 1. Kernel Panic - No init found
```
Kernel panic - not syncing: No working init found
```
**Cause:** Init script missing or busybox is dynamically linked  
**Fix:** Check build output for busybox verification errors

#### 2. Kernel Panic - Attempted to kill init
```
Kernel panic - not syncing: Attempted to kill init! exitcode=0x00000127
```
**Cause:** Init script tried to run but failed (usually missing /bin/sh)  
**Fix:** Check initramfs validation output

#### 3. Emergency Shell - No boot media
```
[ERROR] Could not find Quantix-vDC boot media!
[ERROR] Dropping to emergency shell...
```
**Cause:** CD-ROM not detected or squashfs not found  
**Fix:** Check module loading output for sr_mod, cdrom, isofs

---

## 🛠️ Debugging Commands

### If you get to the emergency shell:

```bash
# Check if busybox works
/bin/busybox --help

# List devices
ls -la /dev/

# Check loaded modules
lsmod

# Try loading CD-ROM modules manually
modprobe sr_mod
modprobe cdrom
modprobe isofs

# Rescan devices
mdev -s

# Check if CD-ROM appeared
ls -la /dev/sr*

# Try mounting manually
mkdir /mnt/test
mount -t iso9660 /dev/sr0 /mnt/test
ls /mnt/test/
```

### Extract and inspect initramfs:
```bash
# On your build machine
mkdir -p /tmp/initramfs-inspect
cd /tmp/initramfs-inspect

# Extract from ISO
sudo mount -o loop ~/LimiQuantix/Quantix-vDC/output/quantix-vdc-1.0.0.iso /mnt
cp /mnt/boot/initramfs .
sudo umount /mnt

# Decompress and extract
gunzip < initramfs > initramfs.cpio
cpio -idmv < initramfs.cpio

# Verify critical files
ls -la init
file init
head -5 init

ls -la bin/busybox
file bin/busybox
ldd bin/busybox  # Should say "not a dynamic executable"

ls -la bin/sh
```

---

## 📊 Build Output Verification

### ✅ **GOOD** - Build should show:
```
   Verifying busybox linkage...
   ✅ Busybox is statically linked (verified)

   Validating initramfs structure...
   ✅ /init exists and is executable
   ✅ /bin/busybox exists and is executable
   ✅ /bin/sh exists
   ✅ /init has correct shebang
   ✅ Initramfs validation passed

✅ Installer initramfs created:
   File: /output/installer-initramfs.img
   Size: 87M
   Modules: 3720
```

### ❌ **BAD** - Build errors to watch for:
```
❌ ERROR: Busybox is DYNAMICALLY linked!
   This WILL cause kernel panic!
```
**Action:** Install `busybox-static` package or download static binary

```
❌ ERROR: /init is missing!
```
**Action:** Check if init script creation failed

```
❌ Initramfs validation FAILED!
```
**Action:** Review the validation output for missing files

---

## 🎯 GRUB Menu Options

When the ISO boots, you'll see 3 options:

1. **Install Quantix-vDC** - Normal boot with console output
2. **Install Quantix-vDC (Debug Mode)** - Maximum verbosity (use this for debugging)
3. **Rescue Shell (Emergency)** - Drops to shell before mounting (for manual debugging)

**For debugging, always use option 2 or 3**

---

## 🔧 Common Fixes

### Fix 1: Busybox is dynamically linked
```bash
# In the Docker builder container
apk add --no-cache busybox-static

# Or download static busybox
wget https://www.busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox
```

### Fix 2: Modules not loading
Check that kernel version matches:
```bash
# In initramfs
ls /lib/modules/

# Should match the running kernel
uname -r
```

### Fix 3: CD-ROM not detected in QEMU
Add explicit CD-ROM device:
```bash
qemu-system-x86_64 \
    -m 4G \
    -cdrom output/quantix-vdc-1.0.0.iso \
    -drive file=output/quantix-vdc-1.0.0.iso,media=cdrom,readonly=on \
    -boot d
```

---

## 📝 Reporting Issues

If the panic persists, capture:

1. **Full boot log** (from serial console)
2. **Build output** (especially busybox and validation sections)
3. **Initramfs inspection** results
4. **QEMU command** used for testing

---

## ✅ Success Criteria

You know it's working when you see:

1. ✅ Kernel boots without panic
2. ✅ Init script runs and prints messages
3. ✅ Modules load successfully
4. ✅ CD-ROM device detected (/dev/sr0)
5. ✅ Squashfs mounted
6. ✅ Installer TUI launches

---

**Last Updated:** 2026-01-09  
**Related:** KERNEL_PANIC_DIAGNOSIS.md
