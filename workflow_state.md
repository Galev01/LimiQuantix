# Workflow State

## Active Task: Fix QvDC Update Download Timeout

**Date:** January 21, 2026
**Status:** ✅ Complete

### Issue

QvDC update was failing with:
```
Failed to apply dashboard: download failed: Get "http://192.168.0.251:9000/api/v1/quantix-vdc/releases/0.0.3/dashboard.tar.gz?channel=dev": context canceled
```

The "context canceled" error was caused by the HTTP client timeout (30 seconds) being too short for file downloads.

### Root Cause

The update service was using the same `httpClient` with a 30-second timeout for both:
1. API calls (manifest fetch) - needs short timeout
2. File downloads (tar.gz artifacts) - needs longer timeout

### Fix

Added a separate `downloadClient` with a 10-minute timeout specifically for file downloads:

```go
// backend/internal/services/update/service.go

// HTTP client for update server API calls (short timeout)
httpClient *http.Client  // 30s timeout

// HTTP client for file downloads (longer timeout)  
downloadClient *http.Client  // 10 min timeout
```

Also added logging to the `downloadFile` function for better debugging.

### Files Changed

- `backend/internal/services/update/service.go`

---

## Previous Changes

- OTA Update System - Docker Build Support ✅
- Auto-version bump on publish ✅
- VERSION files reset to 0.0.1 ✅  
- VMFolderView.tsx modal props fixed ✅
- publish-vdc-update.sh Go path fixed ✅
- node.yaml OTA config added ✅
