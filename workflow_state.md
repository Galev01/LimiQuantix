# Workflow State

## Active Task: QvDC Update Progress UI - Persistent Result

**Date:** January 21, 2026
**Status:** Complete

### Issue

After applying a QvDC update, the progress bar and success message would disappear immediately because the backend resets status to `idle` after completion. Users couldn't see:
- That the update completed successfully
- What version was installed
- Which components were updated

### Solution

Implemented frontend-side tracking of the update lifecycle that persists after completion:

1. **New `useVDCUpdateWithTracking` hook** - Wraps the status query and tracks:
   - When update starts (status changes to `downloading`/`applying`)
   - When update completes (status returns to `idle` or `error`)
   - Stores the result until user dismisses it

2. **New `VDCUpdateResult` interface** - Stores:
   - `success`: boolean
   - `version`: the new version installed
   - `previousVersion`: what we upgraded from
   - `components`: list of updated components
   - `error`: error message if failed
   - `completedAt`: timestamp

3. **Updated Settings.tsx** - Shows:
   - Progress bar with "do not close" warning during update
   - Persistent result card after completion with:
     - Success/error icon and message
     - Version info (from → to)
     - List of updated components
     - Timestamp
     - Dismiss button
     - 100% progress bar (green) for success
   - Retry button for failed updates

### Files Changed

- `frontend/src/hooks/useUpdates.ts`
  - Added `VDCUpdateResult` interface
  - Added `useVDCUpdateWithTracking()` hook
  - Tracks update lifecycle and stores result

- `frontend/src/pages/Settings.tsx`
  - Uses `useVDCUpdateWithTracking` instead of `useVDCUpdateStatus`
  - Shows persistent result card after update
  - Shows "do not close page" warning during update
  - Added Retry button for failed updates

### UI States

**During Update:**
```
┌─────────────────────────────────────────┐
│ Quantix-vDC                [Updating...] │
│ Updating to v0.0.3                       │
│                                          │
│ [═══════════════════►          ] 75%    │
│ Downloading controlplane (2/2)...        │
│                                          │
│ Please do not close this page...         │
└─────────────────────────────────────────┘
```

**After Success:**
```
┌─────────────────────────────────────────┐
│ ✓ Successfully updated to v0.0.3        │
│                                          │
│ Updated from v0.0.1 to v0.0.3           │
│ Components updated:                      │
│   • dashboard                            │
│   • controlplane                         │
│                                          │
│ Completed at 2:34:56 PM      [Dismiss]  │
│ [════════════════════════════════] 100% │
└─────────────────────────────────────────┘
```

**After Error:**
```
┌─────────────────────────────────────────┐
│ ✗ Update Failed                         │
│                                          │
│ Failed to apply dashboard: download     │
│ failed: connection timeout              │
│                                          │
│ Completed at 2:34:56 PM      [Dismiss]  │
└─────────────────────────────────────────┘
│ [Check for Updates] [Retry Update]      │
```

---

## Previous Changes

- QvDC Update Progress UI (initial implementation)
- QvDC tar.gz extraction fix
- QvDC context cancellation fix
- QvDC download timeout fix
- OTA Update System - Docker Build Support
