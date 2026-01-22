# Workflow State

## Active Task: QvDC Version Persistence After Restart

**Date:** January 21, 2026
**Status:** Complete

### Issue

After applying a QvDC update, restarting the control plane reverted the displayed version to the older value (for example, `0.0.21`). This caused the UI to think an update was still available even when the installed version matched the update server.

### Root Cause

The version was only stored in `/etc/quantix-vdc/version`, which is overwritten by the appliance image on restart. The update process updated in-memory state but did not persist the version to a location that survives restarts.

### Fix Applied

**File:** `backend/internal/services/update/service.go`

- Added a persistent version file path: `/var/lib/quantix-vdc/version`
- `getVDCVersion()` now checks the persistent file first, then `/etc`, then fallback release file
- `writeVDCVersion()` now writes to both `/var/lib/quantix-vdc/version` and `/etc/quantix-vdc/version`
- Existing update completion still updates in-memory state and now persists to disk

### Result

After restart, the control plane reads the persisted version and correctly reports "up to date" when the installed version matches the update server.

