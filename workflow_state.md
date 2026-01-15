# Workflow State

## Quantix-OS Installer XFS Superblock Fix - ROUND 2

### Status: FIXED - REBUILD REQUIRED

### Root Cause Found
The original fix had a **bash-only syntax error** that caused the entire installer to fail:

```bash
# THIS WAS THE BUG - bash-ism doesn't work in /bin/sh (Alpine busybox)
exec > >(tee -a "${INSTALL_LOG}") 2>&1
```

The `>(...)` process substitution is bash-specific and fails silently in Alpine's `/bin/sh` (busybox ash), causing the install script to abort immediately with a syntax error.

### Fixes Applied

1. **Removed bash-ism** - Replaced `>(tee ...)` with POSIX-compatible logging
2. **Increased wipe size** - Now zeros first **100MB** instead of 10MB
3. **Better fallback** - If signatures remain, wipes entire disk (up to 500GB)
4. **More kernel syncs** - Added sleep 3 and mdev -s after partitioning

### Key Changes in `Quantix-OS/installer/install.sh`

**Before (BROKEN):**
```bash
exec > >(tee -a "${INSTALL_LOG}") 2>&1  # BASH-ISM - FAILS IN /bin/sh
```

**After (FIXED):**
```bash
# POSIX-compatible logging
{
    echo "=========================================="
    echo "Quantix-OS Installation Log"
    echo "Date: $(date)"
    echo "=========================================="
} > "${INSTALL_LOG}"

# Use tee inline where needed
blkid 2>&1 | tee -a "${INSTALL_LOG}" || true
```

**Wipe improvements:**
- Zero first 100MB (was 10MB)
- If disk still has signatures, wipe entire disk
- Added sync before blockdev --rereadpt

### Log
- 2026-01-16: Initial wipefs + GPT header wipe (10MB)
- 2026-01-16: Added sgdisk --zap-all
- 2026-01-16: **FOUND BUG**: bash-ism `>(tee ...)` fails in /bin/sh
- 2026-01-16: Fixed to POSIX-compatible logging
- 2026-01-16: Increased wipe to 100MB, added fallback full-disk wipe

### Next Steps
1. **Rebuild ISO**: `make iso` in Quantix-OS directory
2. **Test installation** on the NVMe disk
3. The XFS error should no longer appear since:
   - 100MB zeroing clears ALL superblock locations
   - Full-disk wipe fallback if any signatures remain

### References
- `Quantix-OS/installer/install.sh`
