# Quantix-vDC ISO Build and Installer Troubleshooting Guide

**Document ID:** 000080  
**Date:** January 16, 2026  
**Scope:** Quantix-vDC ISO build process and installer issues

## Overview

This document describes troubleshooting efforts and fixes applied to resolve multiple issues with the Quantix-vDC ISO build process, installer TUI, and post-installation service startup. These issues primarily affected the Docker-based build system on Windows/WSL and the OpenRC service configuration within the installed appliance.

---

## Issue Summary

| Issue | Symptom | Root Cause | Status |
|-------|---------|------------|--------|
| 1. Installer TUI not starting | `/installer/tui.sh: not found` or `Permission denied` | CRLF line endings + Docker volume issues | ✅ Fixed |
| 2. ISO won't boot (GRUB kernel not found) | System hangs after GRUB menu | GRUB couldn't locate `/boot/vmlinuz` on boot device | ✅ Fixed |
| 3. PostgreSQL fails to start | `start-stop-daemon: failed to start '/usr/bin/pg_ctl'` | PostgreSQL 16 binaries in non-standard path | ✅ Fixed |
| 4. nginx fails to start | `mkdir() "/var/lib/nginx/tmp/client_body" failed` | Missing nginx runtime directories | ✅ Fixed |
| 5. Control Plane falls back to in-memory | PostgreSQL connection refused | PostgreSQL not started due to issue #3 | ✅ Fixed |
| 6. Services don't persist after reboot | All services down after first reboot | Mount shadowing + missing runlevel entries | ✅ Fixed |
| 7. tui.sh not copied to initramfs | Build shows `tui.sh not found in initramfs` | Docker volume mount issues on Windows | ✅ Fixed |

---

## Issue 1: Installer TUI Not Starting

### Symptom
When booting the installer ISO:
```
/installer/tui.sh: not found
```
or
```
/installer/tui.sh: Permission denied (exit code 126)
```

### Diagnosis
```bash
# Check file exists
ls -la /installer/

# Check if it's executable
file /installer/tui.sh

# Check for CRLF line endings
cat -A /installer/tui.sh | head -5
# If you see ^M at end of lines, it has Windows line endings
```

### Root Cause
Two separate issues:
1. **CRLF line endings**: Scripts edited on Windows have `\r\n` line endings. Linux shell expects `\n` only. The shebang `#!/bin/sh\r` becomes an invalid interpreter path.
2. **Docker volume issues on Windows/WSL**: The `/work/installer/` directory wasn't properly mounted inside the Docker container, causing scripts to not be copied.

### Fix Applied

**File:** `Quantix-vDC/Makefile`

Changed from glob copy to explicit file copy:
```makefile
# Copy installer scripts to output directory (workaround for Docker volume issues)
@mkdir -p $(OUTPUT_DIR)/installer-scripts
@cp -v $(BUILD_DIR)/installer/install.sh $(OUTPUT_DIR)/installer-scripts/
@cp -v $(BUILD_DIR)/installer/tui.sh $(OUTPUT_DIR)/installer-scripts/
@cp -v $(BUILD_DIR)/installer/firstboot.sh $(OUTPUT_DIR)/installer-scripts/
@chmod +x $(OUTPUT_DIR)/installer-scripts/*.sh
# Convert CRLF to LF
@sed -i 's/\r$$//' $(OUTPUT_DIR)/installer-scripts/*.sh
```

**File:** `Quantix-vDC/builder/build-installer-initramfs.sh`

Prioritize `/output/installer-scripts/` (copied outside Docker, bypasses volume issues):
```bash
# PRIORITY: /output/installer-scripts (copied by Makefile, avoids Docker volume issues)
if [ -d "/output/installer-scripts" ] && [ -f "/output/installer-scripts/tui.sh" ]; then
    INSTALLER_SRC="/output/installer-scripts"
    echo "   Using installer scripts from /output/installer-scripts (preferred)"
elif [ -d "${WORK_DIR}/installer" ] && [ -f "${WORK_DIR}/installer/tui.sh" ]; then
    # ... fallbacks
fi
```

---

## Issue 2: ISO Won't Boot (GRUB Kernel Not Found)

### Symptom
After selecting a GRUB menu entry, the system hangs or shows:
```
error: file `/boot/vmlinuz` not found
```

### Diagnosis
```bash
# After build, mount ISO and check kernel location
sudo mount -o loop output/quantix-vdc-*.iso /mnt/iso
ls -la /mnt/iso/boot/
# Verify vmlinuz exists

# Check GRUB config
cat /mnt/iso/boot/grub/grub.cfg
```

### Root Cause
GRUB couldn't determine which device contained the kernel. On different boot configurations (USB, CD, HDD), the root device varies.

### Fix Applied

**File:** `Quantix-vDC/builder/build-iso.sh`

Added `search` command to GRUB menu entries:
```bash
menuentry "Quantix-vDC Installer" {
    search --no-floppy --set=root --file /boot/vmlinuz
    linux /boot/vmlinuz quiet console=tty0 console=ttyS0,115200
    initrd /boot/initramfs-installer.img
}
```

The `search` command locates the device containing `/boot/vmlinuz` and sets it as the root before loading the kernel.

---

## Issue 3: PostgreSQL Fails to Start

### Symptom
```
start-stop-daemon: failed to start '/usr/bin/pg_ctl'
PostgreSQL connection failed, falling back to in-memory
dial tcp 127.0.0.1:5432: connect: connection refused
```

### Diagnosis
```bash
# Check if pg_ctl exists
which pg_ctl
ls -la /usr/bin/pg_ctl

# Find actual PostgreSQL 16 binaries
find /usr -name "pg_ctl" 2>/dev/null
# Output: /usr/libexec/postgresql16/pg_ctl

# Check data directory
ls -la /var/lib/postgresql/16/data/
```

### Root Cause
PostgreSQL 16 on Alpine Linux installs binaries to `/usr/libexec/postgresql16/` (or `/usr/lib/postgresql16/bin/`), not `/usr/bin/`. The init scripts and service startup expected them in `/usr/bin/`.

### Fix Applied

**File:** `Quantix-vDC/builder/build-rootfs.sh`

Create symlinks during rootfs build:
```bash
# Create PostgreSQL 16 binary symlinks
PG16_BIN="/usr/libexec/postgresql16"
if [ -d "${ROOTFS}${PG16_BIN}" ]; then
    for bin in pg_ctl initdb postgres psql pg_dump pg_restore pg_isready; do
        if [ -f "${ROOTFS}${PG16_BIN}/${bin}" ]; then
            ln -sf "${PG16_BIN}/${bin}" "${ROOTFS}/usr/bin/${bin}"
        fi
    done
fi
```

**File:** `Quantix-vDC/installer/install.sh`

Create symlinks during installation:
```bash
# PostgreSQL 16 binary symlinks in installed system
chroot "${TARGET_MOUNT}" /bin/sh -c '
    PG16_BIN=""
    [ -d "/usr/libexec/postgresql16" ] && PG16_BIN="/usr/libexec/postgresql16"
    [ -d "/usr/lib/postgresql16/bin" ] && PG16_BIN="/usr/lib/postgresql16/bin"
    
    if [ -n "$PG16_BIN" ]; then
        for bin in pg_ctl initdb postgres psql pg_dump pg_restore pg_isready; do
            [ -f "${PG16_BIN}/${bin}" ] && ln -sf "${PG16_BIN}/${bin}" /usr/bin/${bin}
        done
    fi
'
```

**File:** `Quantix-vDC/overlay/etc/local.d/99-start-services.start`

Dynamic binary detection:
```bash
# Find PostgreSQL binaries in various locations
PG_CTL=""
for path in /usr/bin/pg_ctl /usr/libexec/postgresql16/pg_ctl /usr/lib/postgresql16/bin/pg_ctl; do
    if [ -x "$path" ]; then
        PG_CTL="$path"
        break
    fi
done
```

---

## Issue 4: nginx Fails to Start

### Symptom
```
nginx: [alert] could not open error log file: open() "/var/lib/nginx/logs/error.log" failed
nginx: [emerg] mkdir() "/var/lib/nginx/tmp/client_body" failed (2: No such file or directory)
nginx: configuration file /etc/nginx/nginx.conf test failed
```

Also:
```
the "listen ... http2" directive is deprecated
```

### Diagnosis
```bash
# Check if directories exist
ls -la /var/lib/nginx/
ls -la /var/lib/nginx/tmp/
ls -la /var/log/nginx/

# Check ownership
stat /var/lib/nginx
```

### Root Cause
nginx runtime directories were not created on the persistent data partition. When the squashfs was extracted over a new installation, the empty directories weren't created.

### Fix Applied

**File:** `Quantix-vDC/installer/install.sh`

Create directories on DATA partition during install:
```bash
# Create nginx runtime directories on DATA partition
mkdir -p "${TARGET_MOUNT}/var/lib/nginx/logs"
mkdir -p "${TARGET_MOUNT}/var/lib/nginx/tmp/client_body"
mkdir -p "${TARGET_MOUNT}/var/lib/nginx/tmp/proxy"
mkdir -p "${TARGET_MOUNT}/var/lib/nginx/tmp/fastcgi"
mkdir -p "${TARGET_MOUNT}/var/log/nginx"

# Set ownership (use numeric UIDs for chroot compatibility)
chown -R 100:101 "${TARGET_MOUNT}/var/lib/nginx" 2>/dev/null || \
    chroot "${TARGET_MOUNT}" chown -R nginx:nginx /var/lib/nginx
```

**File:** `Quantix-vDC/overlay/etc/init.d/quantix-firstboot`

Create directories on first boot:
```bash
# Ensure nginx directories exist
rm -rf /var/lib/nginx/logs /var/lib/nginx/tmp  # Clean any stale files
mkdir -p /var/lib/nginx/logs
mkdir -p /var/lib/nginx/tmp/client_body
mkdir -p /var/lib/nginx/tmp/proxy
mkdir -p /var/lib/nginx/tmp/fastcgi
mkdir -p /var/log/nginx
chown -R 100:101 /var/lib/nginx /var/log/nginx 2>/dev/null || \
    chown -R nginx:nginx /var/lib/nginx /var/log/nginx
```

**File:** `Quantix-vDC/overlay/etc/nginx/conf.d/quantix-vdc.conf`

Fixed deprecated http2 directive:
```nginx
# Before (deprecated)
listen 443 ssl http2;

# After
listen 443 ssl;
http2 on;
```

---

## Issue 5: Control Plane Falls Back to In-Memory

### Symptom
```json
{"level":"warn","msg":"PostgreSQL connection failed, falling back to in-memory",
 "error":"dial tcp 127.0.0.1:5432: connect: connection refused"}
```

### Root Cause
This is a cascading failure from Issue #3. If PostgreSQL doesn't start, the Control Plane can't connect and falls back to in-memory storage.

### Fix
Fixing Issue #3 (PostgreSQL startup) resolves this issue.

---

## Issue 6: Services Don't Persist After Reboot

### Symptom
After installation completes and the system reboots:
- PostgreSQL, nginx, Control Plane all show as "Stopped"
- Services were running before reboot but don't start automatically

### Diagnosis
```bash
# Check runlevel entries
rc-update show default

# Check if service files exist
ls -la /etc/init.d/

# Check OpenRC logging
cat /var/log/rc.log
```

### Root Cause
**Mount shadowing**: During installation, the squashfs was extracted first, then the DATA partition mounted over `/var/lib`. But the squashfs already had empty `/var/lib/*` directories, which shadowed the DATA partition contents.

**Missing runlevel entries**: Services weren't explicitly added to the `default` runlevel during installation.

### Fix Applied

**File:** `Quantix-vDC/installer/install.sh`

1. Mount DATA partition **after** squashfs extraction to proper location:
```bash
# Extract squashfs first
unsquashfs -f -d "${TARGET_MOUNT}" /mnt/installer/quantix-vdc/system.squashfs

# Then create DATA partition mount point and mount
mkdir -p "${TARGET_MOUNT}/var/lib"
mount "${DATA_PART}" "${TARGET_MOUNT}/var/lib"

# Create subdirectories on the actual DATA partition
mkdir -p "${TARGET_MOUNT}/var/lib/postgresql/16/data"
mkdir -p "${TARGET_MOUNT}/var/lib/nginx/logs"
# ... etc
```

2. Explicitly add services to default runlevel:
```bash
# Add services to default runlevel
for svc in postgresql16 redis etcd nginx quantix-controlplane quantix-firstboot sshd; do
    chroot "${TARGET_MOUNT}" rc-update add $svc default 2>/dev/null || true
done
```

3. Enable OpenRC logging for debugging:
```bash
# Enable OpenRC logging
echo 'rc_logger="YES"' >> "${TARGET_MOUNT}/etc/rc.conf"
```

---

## Issue 7: tui.sh Not Copied to Initramfs

### Symptom
During ISO build:
```
Copying installer scripts...
Using installer scripts from /work/installer
Copying: install.sh
❌ ERROR: tui.sh not found in initramfs!
✅ install.sh ready
```

### Diagnosis
```bash
# Inside Docker container
ls -la /work/installer/
# May show files missing that exist on Windows host
```

### Root Cause
Docker volume mounts from Windows to Linux containers can have issues with file visibility, especially with certain file attributes or when files are open in Windows applications.

### Fix Applied

**File:** `Quantix-vDC/Makefile`

Copy scripts **before** Docker runs, to the output directory:
```makefile
@cp -v $(BUILD_DIR)/installer/install.sh $(OUTPUT_DIR)/installer-scripts/
@cp -v $(BUILD_DIR)/installer/tui.sh $(OUTPUT_DIR)/installer-scripts/
@cp -v $(BUILD_DIR)/installer/firstboot.sh $(OUTPUT_DIR)/installer-scripts/
```

**File:** `Quantix-vDC/builder/build-installer-initramfs.sh`

Prioritize `/output/installer-scripts/` over `/work/installer/`:
```bash
# PRIORITY: /output/installer-scripts (copied by Makefile, avoids Docker volume issues)
if [ -d "/output/installer-scripts" ] && [ -f "/output/installer-scripts/tui.sh" ]; then
    INSTALLER_SRC="/output/installer-scripts"
```

Explicitly copy each script by name:
```bash
for script_name in install.sh tui.sh firstboot.sh; do
    script="${INSTALLER_SRC}/${script_name}"
    if [ -f "$script" ]; then
        sed 's/\r$//' "$script" > "${INITRAMFS_DIR}/installer/${script_name}"
        chmod +x "${INITRAMFS_DIR}/installer/${script_name}"
    fi
done
```

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `Makefile` | Explicit script copying, CRLF conversion before Docker |
| `builder/build-iso.sh` | Added GRUB `search` command for kernel location |
| `builder/build-rootfs.sh` | PostgreSQL symlinks, nginx directory cleanup |
| `builder/build-installer-initramfs.sh` | Prioritize `/output/installer-scripts/`, explicit file copying |
| `installer/install.sh` | PostgreSQL symlinks, nginx dirs, runlevel entries, mount order |
| `overlay/etc/init.d/quantix-firstboot` | Numeric UID fallbacks, nginx dir creation |
| `overlay/etc/local.d/99-start-services.start` | Dynamic PostgreSQL binary detection |
| `overlay/etc/nginx/conf.d/quantix-vdc.conf` | Fixed http2 deprecation, Connect RPC proxy |

---

## Quick Verification Steps

### After ISO Build

```bash
# Mount ISO and verify contents
sudo mount -o loop output/quantix-vdc-*.iso /mnt/iso

# Check GRUB has search command
grep "search" /mnt/iso/boot/grub/grub.cfg

# Check kernel exists
ls -la /mnt/iso/boot/vmlinuz

# Extract and check initramfs
mkdir /tmp/initrd
cd /tmp/initrd
zcat /mnt/iso/boot/initramfs-installer.img | cpio -idmv

# Verify installer scripts
ls -la /tmp/initrd/installer/
cat /tmp/initrd/installer/tui.sh | head -1  # Should show #!/bin/sh without ^M

sudo umount /mnt/iso
```

### After Installation

```bash
# Check all services running
netstat -tlnp | grep -E ':5432|:6379|:2379|:8080|:80|:443'

# Expected:
# :5432  - PostgreSQL
# :6379  - Redis
# :2379  - etcd
# :8080  - Control Plane
# :80    - nginx HTTP
# :443   - nginx HTTPS

# Verify PostgreSQL symlinks
ls -la /usr/bin/pg_ctl

# Check nginx directories
ls -la /var/lib/nginx/tmp/

# Test web UI
curl -sk https://localhost/
curl -s http://localhost:8080/health
```

---

## Lessons Learned

1. **Windows ↔ Linux file transfers require CRLF handling**: Always use `sed 's/\r$//'` when building Linux ISOs on Windows.

2. **Docker volume mounts from Windows are unreliable**: Copy files to the output directory *before* Docker runs, then access them from inside the container.

3. **PostgreSQL on Alpine uses non-standard paths**: Version-specific binaries are in `/usr/libexec/postgresql16/`, not `/usr/bin/`.

4. **Mount order matters**: When using overlay filesystems, mount persistent storage *after* extracting the base image to avoid shadowing.

5. **OpenRC services must be in runlevels**: Explicit `rc-update add <service> default` is required for services to start on boot.

6. **GRUB needs help finding kernels**: Use `search --no-floppy --set=root --file /boot/vmlinuz` to locate the kernel device.

7. **Use numeric UIDs in chroot**: `chown 100:101` works better than `chown nginx:nginx` in chroot environments where name resolution may not work.

8. **Enable OpenRC logging**: Add `rc_logger="YES"` to `/etc/rc.conf` for debugging boot issues via `/var/log/rc.log`.
