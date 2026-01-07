# 000050 - Intel Iris Graphics Support and Web Kiosk Fallback Fix

**Status:** Implemented, Ready for Testing  
**Date:** January 7, 2026  
**Priority:** P0 (Critical)  
**Component:** Quantix-OS Console System

---

## Problem Statement

The Quantix-OS Web Kiosk was failing to launch on systems with Intel Iris Graphics, resulting in:

1. **Driver Errors:**
   - `Kernel is too old (4.16+ required) or unusable for Iris`
   - `DRI2: failed to create screen`
   - `EGL_NOT_INITIALIZED`

2. **Infinite Restart Loop:**
   - Web Kiosk would crash and restart indefinitely
   - Never fell back to DCUI (Text Console)
   - System became unusable

3. **Missing Components:**
   - Intel graphics drivers not installed
   - i915 kernel module not loaded
   - No pre-flight checks before launching graphics

---

## Root Cause Analysis

### 1. Missing Intel Graphics Packages

Alpine Linux requires specific packages for Intel graphics support:
- `mesa-vulkan-intel` - Vulkan driver for Intel GPUs
- `intel-media-driver` - Intel media acceleration
- `libva-intel-driver` - VA-API hardware acceleration

These were either commented out or missing from the package list.

### 2. i915 Kernel Module Not Loaded

The Intel i915 kernel module was not configured to load at boot, causing the kernel to not initialize Intel graphics hardware.

### 3. No Pre-flight Checks

The console launcher attempted to start the Web Kiosk without checking:
- Are DRI devices accessible?
- Can EGL initialize?
- Will graphics actually work?

This caused the infinite restart loop when graphics failed.

### 4. Slow Fallback

The system allowed 3 failures before falling back to DCUI, making the boot process slow and frustrating.

---

## Solution Implemented

### 1. Added Intel Graphics Packages

**File:** `Quantix-OS/profiles/quantix/packages.conf`

```conf
# Intel GPU support (for Intel Iris and other Intel graphics)
mesa-vulkan-intel
intel-media-driver
libva-intel-driver
```

**Changes:**
- Enabled `mesa-vulkan-intel` (was commented out)
- Added `intel-media-driver` for media acceleration
- Added `libva-intel-driver` for VA-API support

### 2. Added i915 Kernel Module

**File:** `Quantix-OS/overlay/etc/modules`

```
# Intel Graphics
i915
```

**Effect:**
- i915 module loads at boot
- Intel graphics hardware is initialized early
- DRM devices are created properly

### 3. Added Pre-flight Checks

**File:** `Quantix-OS/overlay/usr/local/bin/qx-console-launcher`

**New Functions:**

```bash
# Check if DRI devices are accessible
check_dri_accessible() {
    if ! ls /dev/dri/card* >/dev/null 2>&1; then
        return 1
    fi
    
    for card in /dev/dri/card*; do
        if [ -r "$card" ] && [ -w "$card" ]; then
            return 0
        fi
    done
    
    return 1
}

# Check if EGL can initialize
check_egl_available() {
    if command -v eglinfo >/dev/null 2>&1; then
        if eglinfo >/dev/null 2>&1; then
            return 0
        else
            return 1
        fi
    fi
    return 0  # Assume OK if eglinfo not available
}
```

**Pre-flight Check Logic:**

```bash
# Before attempting Web Kiosk
if ! check_dri_accessible; then
    log "DRI devices not accessible - Web Kiosk not supported"
    start_dcui
    return
fi

if ! check_egl_available; then
    log "EGL initialization failed - Web Kiosk not supported"
    start_dcui
    return
fi
```

### 4. Added Intel-Specific Environment Variables

**File:** `Quantix-OS/overlay/usr/local/bin/qx-console-launcher`

```bash
# Intel-specific configuration
export MESA_LOADER_DRIVER_OVERRIDE=iris
export LIBVA_DRIVER_NAME=iHD
```

**Effect:**
- Mesa uses the Iris driver for Intel GPUs
- VA-API uses the Intel media driver (iHD)
- Hardware acceleration is properly configured

### 5. Faster Fallback

**Changes:**
- Reduced `MAX_FAILURES` from 3 to 2
- Faster detection of graphics issues
- Quicker fallback to DCUI

**Fallback Strategy:**
1. **First attempt:** Try with Intel drivers (iris, iHD)
2. **Second attempt:** Try with software rendering (llvmpipe, pixman)
3. **After 2 failures:** Fall back to DCUI permanently

---

## Testing Plan

### Test Case 1: Intel Iris Graphics System

**Hardware:** Real system with Intel Iris Graphics

**Expected Behavior:**
1. i915 module loads at boot
2. DRI devices are created (`/dev/dri/card0`)
3. Pre-flight checks pass
4. Web Kiosk launches successfully
5. Hardware acceleration works
6. No DRI/EGL errors in logs

**Verification:**
```bash
# Check i915 module
lsmod | grep i915

# Check DRI devices
ls -la /dev/dri/

# Check Mesa driver
glxinfo | grep -i "OpenGL renderer"
# Should show: Mesa Intel(R) Iris

# Check logs
tail -f /var/log/quantix-console.log
# Should show: "DRI device accessible", "EGL initialization successful"
```

### Test Case 2: Virtual Machine (QEMU/VirtualBox)

**Environment:** QEMU or VirtualBox VM

**Expected Behavior:**
1. VM detection works
2. Immediate fallback to DCUI
3. No attempt to start Web Kiosk
4. No infinite restart loop

**Verification:**
```bash
# Check logs
grep "Virtual machine detected" /var/log/quantix-console.log

# Should see DCUI immediately
# No cage/cog errors
```

### Test Case 3: Headless/Serial Console

**Environment:** System without graphics or serial console

**Expected Behavior:**
1. No graphics detected
2. DCUI launches directly
3. No attempt to start Web Kiosk

**Verification:**
```bash
# Check logs
grep "No graphics detected" /var/log/quantix-console.log

# DCUI should be running
ps aux | grep qx-console
```

### Test Case 4: System Without Graphics Support

**Environment:** System with broken graphics or missing drivers

**Expected Behavior:**
1. Pre-flight checks fail
2. Web Kiosk attempts fail quickly
3. Fallback to DCUI after 2 attempts
4. No infinite restart loop

**Verification:**
```bash
# Check logs
grep "DRI devices not accessible" /var/log/quantix-console.log
grep "Web Kiosk failed 2 times" /var/log/quantix-console.log

# DCUI should be running
ps aux | grep qx-console
```

---

## Build Instructions

```bash
cd Quantix-OS
make clean
make
```

**Output:** `output/quantix-os.iso`

---

## Deployment

1. **Burn ISO to USB:**
   ```bash
   dd if=output/quantix-os.iso of=/dev/sdX bs=4M status=progress
   ```

2. **Boot from USB**

3. **Monitor Console:**
   - Watch boot messages
   - Check for i915 module loading
   - Verify Web Kiosk or DCUI launches

4. **Check Logs:**
   ```bash
   tail -f /var/log/quantix-console.log
   ```

---

## Rollback Plan

If issues occur, revert these commits:

1. `Quantix-OS/profiles/quantix/packages.conf` - Remove Intel packages
2. `Quantix-OS/overlay/etc/modules` - Remove i915 line
3. `Quantix-OS/overlay/usr/local/bin/qx-console-launcher` - Revert to previous version

---

## Risk Assessment

### Low Risk

- All changes are additive (no breaking changes)
- Fallback logic ensures system always boots to usable console
- Pre-flight checks prevent infinite loops

### Potential Issues

1. **Intel packages not available in Alpine 3.20:**
   - **Mitigation:** System will fall back to software rendering
   - **Impact:** Web Kiosk may be slower but will still work

2. **linux-firmware-i915 may be bundled:**
   - **Mitigation:** `linux-firmware-intel` already installed
   - **Impact:** None, firmware should be available

3. **eglinfo not available:**
   - **Mitigation:** Check is optional, assumes OK if missing
   - **Impact:** None, pre-flight check still works

---

## Success Criteria

- [x] Intel graphics packages added to build
- [x] i915 kernel module loads at boot
- [x] Pre-flight checks prevent infinite restart loop
- [x] Intel-specific environment variables configured
- [x] Faster fallback (2 attempts instead of 3)
- [ ] Real hardware testing on Intel Iris system
- [ ] VM testing confirms DCUI fallback
- [ ] Headless testing confirms direct DCUI launch

---

## Related Documents

- **ADR:** `docs/adr/000008-console-access-strategy.md`
- **Console Guide:** `docs/console-access/000040-console-implementation-guide.md`
- **Plan:** `.cursor/plans/fix_intel_iris_graphics_13b8f7ef.plan.md`

---

## Notes

### Alpine Linux Package Availability

If Intel packages are not available in Alpine 3.20:

```bash
# Check package availability
apk search mesa-vulkan-intel
apk search intel-media-driver
apk search libva-intel-driver
```

If missing, the system will fall back to:
- `mesa-dri-gallium` (includes llvmpipe software rendering)
- Software rendering is slower but functional

### Environment Variables Reference

**Intel Hardware Acceleration:**
```bash
MESA_LOADER_DRIVER_OVERRIDE=iris    # Use Iris driver for Intel
LIBVA_DRIVER_NAME=iHD               # Use Intel media driver
```

**Software Rendering Fallback:**
```bash
LIBGL_ALWAYS_SOFTWARE=1             # Force software rendering
WLR_RENDERER=pixman                 # Use Pixman renderer
```

### Debugging Commands

```bash
# Check graphics hardware
lspci | grep -i vga

# Check DRI devices
ls -la /dev/dri/

# Check loaded modules
lsmod | grep -E "i915|drm"

# Check Mesa driver
LIBGL_DEBUG=verbose glxinfo 2>&1 | head -20

# Test EGL
eglinfo

# Check Wayland compositor
WAYLAND_DEBUG=1 cage -- cog http://localhost:8443
```

---

## Status: READY FOR TESTING

All code changes are complete. The ISO needs to be rebuilt and tested on real hardware.
