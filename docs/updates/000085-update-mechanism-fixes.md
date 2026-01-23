# Update Mechanism Fixes & Findings
Date: 2026-01-24
Status: Implemented

## 1. Executive Summary

This document details the investigation and remediation of the OTA update mechanism for Quantix-vDC. Updates were successfully building and "installing" but failed to take effect on the running system due to a critical binary naming mismatch and file locking issues on Linux.

**Key Findings:**
*   **Root Cause**: The update script was installing the backend binary with the wrong name (`quantix-controlplane`), while the system service was executing `qx-controlplane`.
*   **Secondary Issue**: Direct file overwrites on Linux caused `text file busy` (ETXTBSY) errors when the service was running.
*   **Missing Feature**: Database migrations were not being packaged or applied during updates.

## 2. Quantix-vDC Findings & Fixes

### 2.1. Binary Name Mismatch (Critical)
*   **Build System (`Makefile`)**: Builds the binary as `qx-controlplane`.
*   **Init Script (`/etc/init.d/quantix-controlplane`)**: Executes `/usr/bin/qx-controlplane`.
*   **Old Update Script**: Built and installed `/usr/bin/quantix-controlplane`.
*   **Result**: The update process installed a *new file* that was ignored by the system service. The service kept restarting the old, untouched binary.
*   **Fix**: Updated `scripts/publish-vdc-update.sh` to target `/usr/bin/qx-controlplane`.

### 2.2. Atomic Binary Replacement (ETXTBSY)
*   **Issue**: Linux kernels prevent opening a running executable file for writing (`O_TRUNC`), returning `text file busy`.
*   **Old Behavior**: The update service tried to overwrite the target binary directly.
*   **Fix**: Implemented **Atomic Replacement** in `backend/internal/services/update/service.go`:
    1.  Download/Extract new binary to a temporary file (`.update-tmp-*`) in the same directory.
    2.  Use `os.Rename(temp, target)` to swap the files.
    3.  `rename` is atomic and works even if the target is currently executing (the running process keeps a reference to the old inode, new executions use the new one).

### 2.3. Database Migrations
*   **Issue**: Updates only replaced binaries but did not modify the database schema, leading to crashes when new code referenced new tables/columns.
*   **Fix**:
    1.  Bundled the `quantix-migrate` tool and SQL files into a `migrations` component.
    2.  Updated `ApplyVDCUpdate` to execute `quantix-migrate up` **before** restarting the service.
    3.  If migration fails, the update is aborted to prevent data corruption.

### 2.4. Logging
*   **Improvement**: Implemented a dedicated update log at `/var/log/quantix-vdc/update.log` that captures:
    *   Manifest details (version, release notes).
    *   Detailed progress of download/extract/verify steps.
    *   Full `stdout/stderr` capture of the migration tool for debugging.

## 3. Quantix-OS Audit

A proactive audit of the Quantix-OS (Hypervisor Node) update mechanism was conducted to ensure similar issues did not exist.

**Findings:**
*   **Robust Logic**: Quantix-OS components (`qx-node`, `qx-console`) use a smart priority system.
*   **Init Scripts**: Explicitly check for an OTA update in `/data/bin/` first.
    *   `if [ -x /data/bin/qx-node ]; then ... else ... /usr/bin/qx-node`
*   **Result**: The Quantix-OS update mechanism is **CORRECT** and requires no changes. It correctly handles updates by prioritizing the non-immutable OTA partition.

## 4. Recommendations for Future Development

1.  **Naming Consistency**: Stick to `qx-*` prefixes for binaries to match the repository and build artifacts.
2.  **Atomic Writes**: Always use the "Write Temp -> Rename" pattern for replacing any file that might be in use (binaries, config files, SQLite DBs).
3.  **Migration Testing**: Ensure every PR that adds a migration is tested against the `quantix-migrate` tool, not just `go run`.
4.  **Version alignment**: Ensure `Makefile` version and `package.json` versions are synced during the release process (the publish script now handles this for updates).
