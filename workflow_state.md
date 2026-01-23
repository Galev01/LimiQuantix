# Workflow State

## Active Task: Improve QHCI Host Update Error Messages

**Date:** January 21, 2026
**Status:** Complete

### Problem

When QHCI hosts check for updates but the update server has no releases published for `quantix-os`, the error message displayed was confusing:

```
Host returned status 503: {"error":"update_check_failed","message":"Failed to check for updates: Update server returned error 404 Not Found: {\"channel\":\"dev\",\"error\":\"No releases found\",\"product\":\"quantix-os\"}"}
```

### Solution

Added intelligent error message parsing in the QvDC backend to extract user-friendly messages from QHCI error responses.

### Changes Applied

**Backend:** `backend/internal/services/update/service.go`

1. Added `parseHostErrorResponse()` helper function that:
   - Parses JSON error responses from QHCI
   - Detects known error patterns (no releases, connection refused, timeout, 404, auth errors)
   - Extracts nested JSON to find product/channel info
   - Returns clear, actionable error messages

2. Updated the error handling in `CheckHostUpdate()` to use the new parser instead of dumping raw JSON.

**Example transformations:**
| Before | After |
|--------|-------|
| `Host returned status 503: {"error":"update_check_failed","message":"Failed to check for updates: Update server returned error 404 Not Found: {\"channel\":\"dev\",\"error\":\"No releases found\",\"product\":\"quantix-os\"}"}` | `No releases available for quantix-os on the 'dev' channel. The update server has no published releases yet.` |
| Connection refused errors | `Cannot reach update server. Check that the update server is running and accessible.` |
| Timeout errors | `Update server request timed out. The server may be overloaded or unreachable.` |

**Frontend:** `frontend/src/pages/Settings.tsx`

- Improved error display in `HostUpdateCard` component:
  - Error messages now shown in a styled error box (red background/border)
  - Better layout with `flex-1 min-w-0` for proper text wrapping
  - Removed truncation so full message is visible

### Result

Users now see clear, actionable error messages instead of raw JSON when host update checks fail.

