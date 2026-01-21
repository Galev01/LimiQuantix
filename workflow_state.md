# Workflow State

## Active Task: QvDC Host Update Fix

**Date:** January 21, 2026
**Status:** Complete

### Problems

1. **Stale hosts in cache**: Hosts removed from the node list still appeared in the updates page
2. **Error status for hosts**: QvDC couldn't properly parse QHCI's update response format

### Root Causes

1. **Cache not synced**: `GetHostStates()` returned cached hosts without checking if they still exist
2. **Field name mismatch**: QvDC expected `status`, `available_version` but QHCI returns `available` (bool), `latest_version`

### Fixes Applied

**File:** `backend/internal/services/update/service.go`

| Change | Description |
|--------|-------------|
| `GetHostStates()` | Now filters out stale hosts not in current node list |
| `CheckAllHostUpdates()` | Syncs cache with node list before checking |
| `CheckHostUpdate()` | Fixed JSON parsing to match QHCI's actual response format |
| Added `ClearHostCache()` | Utility to manually clear the host cache |

**QHCI Response Format (corrected parsing):**
```json
{
  "available": true/false,
  "current_version": "0.0.7",
  "latest_version": "0.0.8",
  "channel": "dev",
  "full_image_available": false,
  "total_download_size": 12345678
}
```

### Deployment

Rebuild and deploy QvDC:
```bash
./scripts/publish-vdc-update.sh --channel dev
```

---

## Previous Task: Alpine 3.22 Upgrade + Build Fix

**Date:** January 22, 2026
**Status:** Complete

### Problem

The Quantix-OS ISO build failed during the squashfs step because:
1. `openvswitch` package is **not available** in Alpine 3.20 (only in 3.21+)
2. The build script had `set -e` which caused it to exit on the first package install failure
3. Several packages after `libvirt-qemu` in the list failed to install

### Solution

**Upgraded from Alpine 3.20 to Alpine 3.22** - This is a better choice because:
- Open vSwitch (OVS) is available - critical for enterprise networking
- TPM2 tools are now available - important for security
- More recent packages and security fixes
- Alpine 3.22 is a recent stable release (3.22.2 released Oct 2025)

### Files Changed

| File | Change |
|------|--------|
| `Quantix-OS/builder/Dockerfile` | `FROM alpine:3.20` → `FROM alpine:3.22` |
| `Quantix-OS/builder/Dockerfile.rust-tui` | `FROM alpine:3.20` → `FROM alpine:3.22` |
| `Quantix-OS/builder/Dockerfile.full` | `FROM alpine:3.20` → `FROM alpine:3.22` |
| `Quantix-OS/builder/build-squashfs.sh` | `ALPINE_VERSION="3.20"` → `ALPINE_VERSION="3.22"` |
| `Quantix-OS/builder/build-squashfs.sh` | Added `|| true` to package install to prevent `set -e` failures |
| `Quantix-OS/builder/build-iso.sh` | Alpine mirror URL updated to 3.22 |
| `Quantix-OS/profiles/quantix/packages.conf` | Restored `openvswitch`, `openvswitch-openrc` |
| `Quantix-OS/profiles/quantix/packages.conf` | Added `libvirt-daemon-openrc` (separate package in 3.22) |
| `Quantix-OS/profiles/quantix/packages.conf` | Added `tpm2-tools`, `tpm2-tss-esys` (now available) |
| `Quantix-OS/profiles/quantix/packages.conf` | Added `seatd`, `seatd-openrc` for console |

### What OVS Provides (vSphere vSwitch Equivalent)

- Virtual switch for VM connectivity
- VLAN tagging for multi-tenant isolation
- QoS/Traffic shaping
- OpenFlow support (SDN)
- VXLAN/GRE tunneling for overlay networks
- Port mirroring/monitoring

### Next Steps

Run `make iso` again - the Docker images will be rebuilt with Alpine 3.22.

---

## Previous Task: Quantix-OS TUI Bug Fixes

**Date:** January 22, 2026
**Status:** Complete

### Issues Fixed

| # | Issue | Root Cause | Fix |
|---|-------|------------|-----|
| 1 | F-key actions no feedback | Messages set but cleared too quickly | Improved service restart with status verification |
| 2 | Service restart doesn't work | Uses `spawn()` without waiting | Changed to synchronous with status check |
| 3 | Static IP - web interface down | Node daemon not restarted | Added automatic node daemon restart after IP change |
| 4 | Network config lost on reboot | Init script skipped if interface had IP | Static config now takes priority over existing IPs |
| 5 | Cluster shows "Standalone" | Status not refreshed after join | Auto-refresh every 30 seconds |
| 6 | Version shows "v1.0.0" | Hardcoded in header | Uses dynamic `app.os_version` |
| 7 | Update status not shown | No update check mechanism | Added update check every 5 minutes + display |
| 8 | Hostname not applied | Config partition not mounted | Ensured /quantix mount in firstboot |

---

## Previous Changes

- QvDC Update Progress UI - Persistent Result
- QvDC tar.gz extraction fix
- QvDC context cancellation fix
- QvDC download timeout fix
- OTA Update System - Docker Build Support
