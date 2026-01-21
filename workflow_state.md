# Workflow State

## Active Task: Fix QvDC Update Download "context canceled" Error

**Date:** January 21, 2026
**Status:** ✅ Complete

### Issue

QvDC update was failing with:
```
Failed to apply dashboard: download failed: Get "http://192.168.0.251:9000/api/v1/quantix-vdc/releases/0.0.3/dashboard.tar.gz?channel=dev": context canceled
```

### Root Cause

The `handleVDCApply` handler was starting the update in a goroutine but passing `r.Context()`:

```go
go func() {
    if err := h.service.ApplyVDCUpdate(r.Context()); err != nil {  // BUG!
        h.logger.Error("Failed to apply vDC update", zap.Error(err))
    }
}()
```

When the HTTP response was sent, `r.Context()` was canceled, which immediately canceled the in-progress download.

### Fix

1. **update_handler.go**: Use `context.Background()` for background update operations
2. **service.go**: Added separate `downloadClient` with 10-minute timeout (bonus fix)

```go
go func() {
    ctx := context.Background()  // Fresh context that won't be canceled
    if err := h.service.ApplyVDCUpdate(ctx); err != nil {
        h.logger.Error("Failed to apply vDC update", zap.Error(err))
    }
}()
```

### Files Changed

- `backend/internal/server/update_handler.go` - Use context.Background() for background goroutine
- `backend/internal/services/update/service.go` - Added downloadClient with longer timeout + logging

### To Deploy

Rebuild and redeploy the QvDC control plane.

---

## Previous Changes

- OTA Update System - Docker Build Support ✅
- Auto-version bump on publish ✅
- VERSION files reset to 0.0.1 ✅  
- VMFolderView.tsx modal props fixed ✅
- publish-vdc-update.sh Go path fixed ✅
- node.yaml OTA config added ✅
