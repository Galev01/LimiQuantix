# Workflow State

## Active Task: Fix QHCI Update System

**Date:** January 23, 2026
**Status:** Complete

### Root Cause Analysis

The QHCI hosts were broken because:

1. **tar.gz extraction bug**: The old `qx-node` binary only handled `.tar.zst` archives. When `.tar.gz` was used (because `zstd` wasn't available on the build machine), it fell back to **direct file copy** instead of extraction.

2. **Result**: The `.tar.gz` archive was copied directly to `/data/bin/qx-node`, making it an invalid executable (gzip file instead of ELF binary).

3. **Web UI issue**: Same problem - the `host-ui.tar.gz` was not extracted, so `/data/share/quantix-host-ui/` contained a gzip archive instead of the actual HTML/JS files.

### Fixes Applied

**1. `agent/limiquantix-node/src/update/applier.rs`**

Added support for `.tar.gz` archives:
- New function `extract_and_install_tar_gz()` that properly extracts gzip tarballs
- Updated `apply_component()` to detect `.tar.gz` files and route to the new function
- Handles both single-binary and directory components (like host-ui)

**2. `scripts/fix-qhci-update.sh`** (new file)

Created a recovery script that:
- Downloads artifacts directly from the update server
- Properly extracts both qx-node and host-ui
- Installs them to the correct locations
- Writes version files
- Restarts the service

### How to Recover Hosts

**Option 1: Copy and run the recovery script**
```bash
# From your local machine
scp scripts/fix-qhci-update.sh root@192.168.0.101:/tmp/
ssh root@192.168.0.101 "chmod +x /tmp/fix-qhci-update.sh && /tmp/fix-qhci-update.sh"

# Repeat for QHCI02
scp scripts/fix-qhci-update.sh root@192.168.0.102:/tmp/
ssh root@192.168.0.102 "chmod +x /tmp/fix-qhci-update.sh && /tmp/fix-qhci-update.sh"
```

**Option 2: Manual recovery (run on each host via SSH)**
```bash
# Stop service
rc-service quantix-node stop

# Download and extract qx-node
cd /tmp
wget http://192.168.0.251:9000/api/v1/quantix-os/releases/0.0.15/qx-node.tar.gz
tar -xzf qx-node.tar.gz
mv limiquantix-node /data/bin/qx-node
chmod +x /data/bin/qx-node

# Download and extract host-ui  
wget http://192.168.0.251:9000/api/v1/quantix-os/releases/0.0.15/host-ui.tar.gz
mkdir -p /data/share/quantix-host-ui
rm -rf /data/share/quantix-host-ui/*
tar -xzf host-ui.tar.gz -C /data/share/quantix-host-ui/

# Start service
rc-service quantix-node start
```

### Future Prevention

After recovering the hosts, publish a new version (0.0.16) that includes the tar.gz fix:

```bash
./scripts/publish-update.sh --channel dev
```

This new version will have the fixed applier code, so future updates with either `.tar.gz` or `.tar.zst` will work correctly.

### Files Modified

- `agent/limiquantix-node/src/update/applier.rs` - Added tar.gz support
- `scripts/fix-qhci-update.sh` - New recovery script
- `backend/internal/services/update/service.go` - Better error messages (earlier fix)
- `frontend/src/pages/Settings.tsx` - Better error display (earlier fix)
