# Workflow State

## Active Task: Updates Page UI Logging

**Date:** January 21, 2026
**Status:** Complete

### Scope

Log all actions on the Updates page, including every button, toggle, and update outcome (success/error) with audit metadata.

### Changes Applied

**Frontend:** `frontend/src/pages/Settings.tsx`

- Added `useActionLogger('updates')` in `UpdateSettings` and `useActionLogger('settings')` in `Settings`.
- Logged all update page actions:
  - Check vDC updates
  - Apply vDC update
  - Retry update
  - Dismiss result card
  - Check all hosts
  - Apply host update
  - Change update channel
  - Save/cancel update server URL
  - Toggle auto-check and auto-apply
  - Updates tab switching
- Logged update success/error outcomes with audit metadata and correlation IDs.
- Logged vDC status errors when backend reports update errors.

**Backend:** `backend/internal/server/logs_handler.go`

- Added `ui-updates` to the log sources list for filtering.

### Notes

All update page actions now emit `ui-updates` logs with structured metadata and audit markers.
- `getVDCVersion()` now checks the persistent file first, then `/etc`, then fallback release file
- `writeVDCVersion()` now writes to both `/var/lib/quantix-vdc/version` and `/etc/quantix-vdc/version`
- Existing update completion still updates in-memory state and now persists to disk

### Result

After restart, the control plane reads the persisted version and correctly reports "up to date" when the installed version matches the update server.

