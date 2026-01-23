# Workflow State

## Active Task: QvDC Host Update Progress Tracking

**Date:** January 23, 2026
**Status:** Complete

### Objective

Improve host update UI in QvDC Settings page:
1. Fix "Update available" showing when host is already at latest version
2. Add real-time progress tracking for host updates (progress bar, download info)

### Changes Made

**1. `frontend/src/pages/Settings.tsx` - HostUpdateCard component**

- Added version comparison logic: If `current_version === available_version`, show "Up to date" instead of "Update available"
- Added progress tracking with real-time polling during downloads
- Added progress bar showing download/apply status
- Shows current component being downloaded, bytes downloaded/total, percentage

**2. `frontend/src/hooks/useUpdates.ts` - Progress hooks**

- Added `HostUpdateProgress` interface for progress data
- Added `fetchHostProgress()` API function
- Added `useHostUpdateProgress()` hook that polls every 1 second during active updates
- Updated `useHostsUpdateStatus()` to poll every 3 seconds when any host is updating

**3. `frontend/src/components/ui/ProgressBar.tsx`**

- Added `info` variant for the update progress bar

**4. `backend/internal/server/update_handler.go` - New endpoint**

- Added `GET /api/v1/updates/hosts/{nodeId}/progress` endpoint
- Routes to `handleHostProgress()` handler

**5. `backend/internal/services/update/service.go` - Progress proxy**

- Added `HostUpdateProgress` struct for progress data
- Added `GetHostUpdateProgress()` function that proxies to QHCI's `/api/v1/updates/status` endpoint
- Added `updateHostStateFromProgress()` to sync local state with host status

### Architecture

```
QvDC Dashboard (React)
    │
    ├─ Settings.tsx → HostUpdateCard
    │   └─ useHostUpdateProgress(nodeId, enabled)
    │       └─ Poll every 1s during update
    │
    └─ GET /api/v1/updates/hosts/{nodeId}/progress
            │
            └─ Go Backend (update_handler.go)
                └─ GetHostUpdateProgress()
                    │
                    └─ Proxy to QHCI: GET https://{host}:8443/api/v1/updates/status
                            │
                            └─ Returns: { status, message, progress: { currentComponent, downloadedBytes, totalBytes, percentage } }
```

### How It Works

1. User clicks "Update" on a host card
2. `applyHostUpdate()` triggers the update on QHCI
3. HostUpdateCard detects `status === 'downloading' || 'applying'`
4. Enables `useHostUpdateProgress()` hook which polls every 1 second
5. Progress bar and status message update in real-time
6. When status becomes `idle` or `complete`, polling stops

---

## Previous Task: Fix QHCI Update System (Completed)

The tar.gz extraction bug and self-restart issues were fixed in the previous session.
See git history for details.
