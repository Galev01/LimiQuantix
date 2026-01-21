# Workflow State

## Active Task: Quantix-OS Update Settings Implementation

**Date:** January 21, 2026
**Status:** ✅ Complete

### Summary

Implemented full configurability for the Quantix-OS OTA update system, allowing users to:
1. Configure the update server URL
2. Select the update channel (dev/beta/stable)
3. Choose where downloaded updates are stored (local /data or dedicated volume)
4. Create a dedicated updates storage volume from the Settings UI

### Changes Made

#### Backend (Rust - limiquantix-node)

**`agent/limiquantix-node/src/update/config.rs`**
- Added `StorageLocation` enum (Local, Volume)
- Added `storage_location` and `volume_path` fields to `UpdateConfig`
- Added `effective_staging_dir()` and `effective_backup_dir()` methods
- Updated validation to check volume path when storage_location = volume

**`agent/limiquantix-node/src/update/mod.rs`**
- Refactored `UpdateManager` to use `RwLock` for mutable fields
- Added `update_config()` method for runtime configuration updates
- Updated `get_config()` to be async (returns clone)
- Exported `StorageLocation` from module

**`agent/limiquantix-node/src/http_server.rs`**
- Added `PUT /api/v1/updates/config` endpoint for saving config
- Added `GET /api/v1/updates/volumes` endpoint for listing available volumes
- Added `persist_update_config()` function to save to node.yaml
- Extended `UpdateConfigResponse` with `storageLocation` and `volumePath`

#### Frontend (TypeScript/React - quantix-host-ui)

**`quantix-host-ui/src/api/updates.ts`**
- Added `UpdateConfigRequest` interface
- Added `UpdateVolumeInfo` interface
- Extended `UpdateConfig` with `storageLocation` and `volumePath`
- Added `saveUpdateConfig()` API function
- Added `listUpdateVolumes()` API function

**`quantix-host-ui/src/hooks/useUpdates.ts`**
- Added `useSaveUpdateConfig` mutation hook
- Added `useUpdateVolumes` query hook
- Updated `useUpdatesTab()` composite hook with new functionality

**`quantix-host-ui/src/pages/Settings.tsx`**
- Completely redesigned `UpdatesSettingsTab` with editable form:
  - Server URL text input
  - Channel dropdown (dev/beta/stable)
  - Storage location radio buttons (local vs dedicated volume)
  - Volume selector dropdown with refresh
  - "Create Updates Volume" button
- Added `CreateUpdatesVolumeModal` component

**`quantix-host-ui/src/components/storage/CreateVolumeModal.tsx`**
- Added optional `purpose` prop ('general' | 'updates')
- Pre-fills name as "updates-storage" and size as 20 GiB when purpose='updates'
- Shows info banner explaining updates volume purpose

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/updates/config` | Get current update configuration |
| PUT | `/api/v1/updates/config` | Save update configuration |
| GET | `/api/v1/updates/volumes` | List volumes available for update storage |

### Configuration Persistence

Configuration changes are saved to `/etc/limiquantix/node.yaml` under the `updates` section:

```yaml
updates:
  enabled: true
  server_url: "http://192.168.0.148:9000"
  channel: "dev"
  storage_location: "local"  # or "volume"
  volume_path: null  # or "/mnt/updates-storage"
  staging_dir: "/data/updates/staging"
  backup_dir: "/data/updates/backup"
```

---

## Previous Changes

- OTA Update System - Docker Build Support ✅
- Auto-version bump on publish ✅
- VERSION files reset to 0.0.1 ✅  
- VMFolderView.tsx modal props fixed ✅
- publish-vdc-update.sh Go path fixed ✅
- node.yaml OTA config added ✅
- QvDC tar.gz extraction fix ✅
