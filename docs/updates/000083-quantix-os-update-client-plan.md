# Quantix-OS OTA Update Client Implementation Plan

**Document ID:** 000083  
**Date:** January 16, 2026  
**Scope:** Implementation guide for receiving updates pushed from Quantix-vDC  
**Audience:** Quantix-OS developer

## Overview

This document outlines the complete implementation plan for the Quantix-OS (QHCI) update client system. The goal is to enable QHCI hosts to:

1. **Receive update notifications** from Quantix-vDC
2. **Check for updates** against the Update Server
3. **Download and apply** component/full-system updates
4. **Report status** back to vDC for monitoring
5. **Coordinate maintenance mode** for safe hypervisor updates

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        QHCI UPDATE FLOW                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Quantix-vDC Dashboard                    Update Server                      │
│  ┌─────────────────────┐                  ┌─────────────────────┐           │
│  │ Settings → Updates  │                  │ Port 9000           │           │
│  │ • Check All Hosts   │                  │ /api/v1/quantix-os/ │           │
│  │ • Apply to Host     │                  │   manifest          │           │
│  └─────────┬───────────┘                  │   releases/         │           │
│            │                              │   manifest/signed   │           │
│            │ POST /api/v1/updates/        └──────────┬──────────┘           │
│            │      hosts/{nodeId}/apply               │                      │
│            ▼                                         │                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     QHCI Host (qx-node)                              │   │
│  │                                                                      │   │
│  │  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │   │
│  │  │ REST API Handlers│    │  UpdateManager   │    │ AB Update Mgr │  │   │
│  │  │ /api/v1/updates/ │───►│  (mod.rs)        │───►│ (ab_update.rs)│  │   │
│  │  │  • check         │    │  • check         │    │ A/B partition │  │   │
│  │  │  • current       │    │  • download      │    │ switching     │  │   │
│  │  │  • status        │    │  • apply         │    └───────────────┘  │   │
│  │  │  • apply         │    └────────┬─────────┘                       │   │
│  │  └──────────────────┘             │                                 │   │
│  │                                   ▼                                 │   │
│  │  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐  │   │
│  │  │  Downloader      │    │  Applier         │    │ OpenRC        │  │   │
│  │  │  (downloader.rs) │───►│  (applier.rs)    │───►│ Service Mgmt  │  │   │
│  │  │  HTTP + SHA256   │    │  Extract + Backup│    │ Restart       │  │   │
│  │  └──────────────────┘    └──────────────────┘    └───────────────┘  │   │
│  │                                                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      Host UI (quantix-host-ui)                        │   │
│  │  Settings → Updates Tab                                               │   │
│  │  • Current version                                                    │   │
│  │  • Available update                                                   │   │
│  │  • Check / Apply buttons                                              │   │
│  │  • Update history                                                     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Backend (Rust - qx-node)

### 1.1 Current State

The update module already exists at `/agent/limiquantix-node/src/update/`:

| File | Status | Description |
|------|--------|-------------|
| `mod.rs` | ✅ Exists | Main `UpdateManager` coordinator |
| `manifest.rs` | ✅ Exists | Manifest parsing types |
| `downloader.rs` | ✅ Exists | HTTP download with SHA256 verification |
| `applier.rs` | ✅ Exists | Extract tar.zst, backup, install |
| `config.rs` | ✅ Exists | Configuration struct |
| `status.rs` | ✅ Exists | Status enum and progress tracking |
| `ab_update.rs` | ✅ Exists | A/B partition handling |

### 1.2 REST API Endpoints to Add

Add these endpoints to `http_server.rs`:

```rust
// In the router setup, add these routes:
.route("/api/v1/updates/check", get(handle_update_check))
.route("/api/v1/updates/current", get(handle_update_current))
.route("/api/v1/updates/status", get(handle_update_status))
.route("/api/v1/updates/apply", post(handle_update_apply))
.route("/api/v1/updates/config", get(handle_update_config).put(handle_update_config_update))
```

### 1.3 Implementation Steps

#### Step 1: Add UpdateManager to AppState

Modify `http_server.rs`:

```rust
pub struct AppState {
    pub service: Arc<NodeDaemonServiceImpl>,
    pub webui_path: PathBuf,
    pub tls_manager: Arc<TlsManager>,
    pub tls_config: TlsConfig,
    pub telemetry: Arc<TelemetryCollector>,
    pub storage: Arc<limiquantix_hypervisor::storage::StorageManager>,
    // ADD THIS:
    pub update_manager: Arc<crate::update::UpdateManager>,
}
```

#### Step 2: Initialize UpdateManager in main.rs

```rust
// In main.rs, after config loading:
let update_config = crate::update::UpdateConfig {
    server_url: config.updates.server_url.clone()
        .unwrap_or_else(|| "http://localhost:9000".to_string()),
    channel: config.updates.channel.clone()
        .unwrap_or_else(|| "dev".to_string()),
    staging_dir: PathBuf::from("/data/updates/staging"),
    backup_dir: PathBuf::from("/data/updates/backup"),
    auto_check: config.updates.auto_check.unwrap_or(true),
    check_interval: Duration::from_secs(3600), // 1 hour
};

let update_manager = Arc::new(crate::update::UpdateManager::new(update_config));
update_manager.init().await?;
```

#### Step 3: Implement REST Handlers

Create a new file `update_handlers.rs` or add to `http_server.rs`:

```rust
// =============================================================================
// Update API Handlers
// =============================================================================

/// GET /api/v1/updates/check - Check for available updates
async fn handle_update_check(
    State(state): State<Arc<AppState>>,
) -> Result<Json<UpdateCheckResponse>, StatusCode> {
    let update_info = state.update_manager
        .check_for_updates()
        .await
        .map_err(|e| {
            error!("Failed to check updates: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    
    Ok(Json(UpdateCheckResponse {
        available: update_info.available,
        current_version: update_info.current_version,
        available_version: update_info.latest_version,
        channel: update_info.channel,
        components: update_info.components.into_iter().map(|c| ComponentInfo {
            name: c.name,
            current_version: c.current_version,
            new_version: c.new_version,
            size_bytes: c.size_bytes,
        }).collect(),
        full_image_available: update_info.full_image_available,
        total_download_size: update_info.total_download_size,
        release_notes: update_info.release_notes,
    }))
}

/// GET /api/v1/updates/current - Get currently installed versions
async fn handle_update_current(
    State(state): State<Arc<AppState>>,
) -> Json<InstalledVersionsResponse> {
    let versions = state.update_manager.get_installed_versions().await;
    
    Json(InstalledVersionsResponse {
        os_version: versions.os_version,
        qx_node: versions.qx_node,
        qx_console: versions.qx_console,
        host_ui: versions.host_ui,
    })
}

/// GET /api/v1/updates/status - Get current update status
async fn handle_update_status(
    State(state): State<Arc<AppState>>,
) -> Json<UpdateStatusResponse> {
    let status = state.update_manager.get_status().await;
    
    let (status_str, message, progress) = match status {
        UpdateStatus::Idle => ("idle", None, None),
        UpdateStatus::Checking => ("checking", None, None),
        UpdateStatus::UpToDate => ("up_to_date", None, None),
        UpdateStatus::Available(v) => ("available", Some(format!("Version {} available", v)), None),
        UpdateStatus::Downloading(p) => ("downloading", Some(p.current_component.clone()), Some(p.percentage)),
        UpdateStatus::Applying(msg) => ("applying", Some(msg), None),
        UpdateStatus::Complete(v) => ("complete", Some(format!("Updated to {}", v)), None),
        UpdateStatus::Error(e) => ("error", Some(e), None),
        UpdateStatus::RebootRequired => ("reboot_required", Some("Reboot required to complete update".into()), None),
    };
    
    Json(UpdateStatusResponse {
        status: status_str.to_string(),
        message,
        progress,
    })
}

/// POST /api/v1/updates/apply - Apply available updates
async fn handle_update_apply(
    State(state): State<Arc<AppState>>,
) -> Result<Json<UpdateApplyResponse>, StatusCode> {
    // Start update in background
    let manager = state.update_manager.clone();
    tokio::spawn(async move {
        if let Err(e) = manager.apply_updates().await {
            error!("Update application failed: {}", e);
        }
    });
    
    Ok(Json(UpdateApplyResponse {
        status: "started".to_string(),
        message: "Update process started".to_string(),
    }))
}

/// GET /api/v1/updates/config - Get update configuration
async fn handle_update_config(
    State(state): State<Arc<AppState>>,
) -> Json<UpdateConfigResponse> {
    let config = state.update_manager.get_config();
    
    Json(UpdateConfigResponse {
        server_url: config.server_url.clone(),
        channel: config.channel.clone(),
        auto_check: config.auto_check,
        check_interval_secs: config.check_interval.as_secs(),
    })
}
```

#### Step 4: Response Types

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckResponse {
    available: bool,
    current_version: String,
    available_version: Option<String>,
    channel: String,
    components: Vec<ComponentInfo>,
    full_image_available: bool,
    total_download_size: u64,
    release_notes: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComponentInfo {
    name: String,
    current_version: Option<String>,
    new_version: String,
    size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledVersionsResponse {
    os_version: String,
    qx_node: Option<String>,
    qx_console: Option<String>,
    host_ui: Option<String>,
}

#[derive(Serialize)]
struct UpdateStatusResponse {
    status: String,
    message: Option<String>,
    progress: Option<u32>,
}

#[derive(Serialize)]
struct UpdateApplyResponse {
    status: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateConfigResponse {
    server_url: String,
    channel: String,
    auto_check: bool,
    check_interval_secs: u64,
}
```

#### Step 5: Add Config Section for Updates

In `config.rs` (or your YAML config):

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct UpdatesConfig {
    pub server_url: Option<String>,
    pub channel: Option<String>,
    pub auto_check: Option<bool>,
    pub auto_apply: Option<bool>,
}
```

Example YAML:
```yaml
updates:
  server_url: "http://192.168.0.95:9000"
  channel: "dev"
  auto_check: true
  auto_apply: false
```

---

## Part 2: Frontend (React - quantix-host-ui)

### 2.1 Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/useUpdates.ts` | **Create** | React Query hooks for update API |
| `src/api/updates.ts` | **Create** | API client functions |
| `src/pages/Settings.tsx` | **Modify** | Add "Updates" tab |

### 2.2 Create API Client

Create `src/api/updates.ts`:

```typescript
import { apiClient } from './client';

export interface UpdateCheckResponse {
  available: boolean;
  currentVersion: string;
  availableVersion?: string;
  channel: string;
  components: ComponentInfo[];
  fullImageAvailable: boolean;
  totalDownloadSize: number;
  releaseNotes?: string;
}

export interface ComponentInfo {
  name: string;
  currentVersion?: string;
  newVersion: string;
  sizeBytes: number;
}

export interface InstalledVersions {
  osVersion: string;
  qxNode?: string;
  qxConsole?: string;
  hostUi?: string;
}

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'up_to_date' | 'available' | 'downloading' | 'applying' | 'complete' | 'error' | 'reboot_required';
  message?: string;
  progress?: number;
}

export interface UpdateConfig {
  serverUrl: string;
  channel: string;
  autoCheck: boolean;
  checkIntervalSecs: number;
}

export const updatesApi = {
  check: async (): Promise<UpdateCheckResponse> => {
    const response = await apiClient.get('/api/v1/updates/check');
    return response.data;
  },

  getCurrent: async (): Promise<InstalledVersions> => {
    const response = await apiClient.get('/api/v1/updates/current');
    return response.data;
  },

  getStatus: async (): Promise<UpdateStatus> => {
    const response = await apiClient.get('/api/v1/updates/status');
    return response.data;
  },

  apply: async (): Promise<{ status: string; message: string }> => {
    const response = await apiClient.post('/api/v1/updates/apply');
    return response.data;
  },

  getConfig: async (): Promise<UpdateConfig> => {
    const response = await apiClient.get('/api/v1/updates/config');
    return response.data;
  },
};
```

### 2.3 Create React Query Hooks

Create `src/hooks/useUpdates.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { updatesApi, UpdateCheckResponse, InstalledVersions, UpdateStatus, UpdateConfig } from '@/api/updates';
import { toast } from '@/lib/toast';

export const updateKeys = {
  all: ['updates'] as const,
  check: () => [...updateKeys.all, 'check'] as const,
  current: () => [...updateKeys.all, 'current'] as const,
  status: () => [...updateKeys.all, 'status'] as const,
  config: () => [...updateKeys.all, 'config'] as const,
};

// Check for updates
export function useCheckUpdate() {
  return useMutation({
    mutationFn: updatesApi.check,
    onSuccess: (data) => {
      if (data.available) {
        toast.success(`Update available: v${data.availableVersion}`);
      } else {
        toast.info('System is up to date');
      }
    },
    onError: (error) => {
      toast.error(`Failed to check updates: ${error}`);
    },
  });
}

// Get current installed versions
export function useInstalledVersions() {
  return useQuery({
    queryKey: updateKeys.current(),
    queryFn: updatesApi.getCurrent,
    staleTime: 60000, // 1 minute
  });
}

// Get update status (poll while updating)
export function useUpdateStatus(options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: updateKeys.status(),
    queryFn: updatesApi.getStatus,
    staleTime: 5000,
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled ?? true,
  });
}

// Apply update
export function useApplyUpdate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: updatesApi.apply,
    onSuccess: () => {
      toast.success('Update started');
      // Start polling status
      queryClient.invalidateQueries({ queryKey: updateKeys.status() });
    },
    onError: (error) => {
      toast.error(`Failed to apply update: ${error}`);
    },
  });
}

// Get update config
export function useUpdateConfig() {
  return useQuery({
    queryKey: updateKeys.config(),
    queryFn: updatesApi.getConfig,
    staleTime: 60000,
  });
}

// Helper to format bytes
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Helper to get status color
export function getStatusVariant(status: UpdateStatus['status']): 'success' | 'warning' | 'error' | 'info' | 'default' {
  switch (status) {
    case 'up_to_date':
    case 'complete':
      return 'success';
    case 'available':
      return 'info';
    case 'checking':
    case 'downloading':
    case 'applying':
      return 'warning';
    case 'error':
      return 'error';
    case 'reboot_required':
      return 'warning';
    default:
      return 'default';
  }
}
```

### 2.4 Add Updates Tab to Settings.tsx

Add to the tabs array in `Settings.tsx`:

```typescript
const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <SettingsIcon className="w-4 h-4" /> },
  { id: 'updates', label: 'Updates', icon: <Download className="w-4 h-4" /> }, // ADD THIS
  { id: 'storage', label: 'Storage', icon: <HardDrive className="w-4 h-4" /> },
  // ... rest of tabs
];
```

Add tab content:

```tsx
{activeTab === 'updates' && <UpdatesSettingsTab />}
```

### 2.5 Create UpdatesSettingsTab Component

Add to `Settings.tsx`:

```tsx
import { 
  useInstalledVersions, 
  useUpdateStatus, 
  useCheckUpdate, 
  useApplyUpdate, 
  useUpdateConfig,
  formatBytes,
  getStatusVariant 
} from '@/hooks/useUpdates';

function UpdatesSettingsTab() {
  const { data: versions, isLoading: versionsLoading } = useInstalledVersions();
  const { data: status, isLoading: statusLoading } = useUpdateStatus({
    refetchInterval: status?.status === 'downloading' || status?.status === 'applying' ? 2000 : undefined,
  });
  const { data: config } = useUpdateConfig();
  
  const checkMutation = useCheckUpdate();
  const applyMutation = useApplyUpdate();
  
  const isUpdating = status?.status === 'downloading' || status?.status === 'applying';
  
  return (
    <div className="space-y-6">
      {/* Current Version Card */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Package className="w-5 h-5 text-accent" />
            Quantix-OS Version
          </h3>
          <Badge variant={getStatusVariant(status?.status || 'idle')}>
            {status?.status === 'up_to_date' ? 'Up to Date' : 
             status?.status === 'available' ? 'Update Available' :
             status?.status || 'Unknown'}
          </Badge>
        </div>
        
        {versionsLoading ? (
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading version info...
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="flex justify-between p-3 bg-bg-base rounded-lg">
              <span className="text-text-muted">OS Version</span>
              <span className="text-text-primary font-mono">{versions?.osVersion || 'Unknown'}</span>
            </div>
            <div className="flex justify-between p-3 bg-bg-base rounded-lg">
              <span className="text-text-muted">qx-node</span>
              <span className="text-text-primary font-mono">{versions?.qxNode || 'N/A'}</span>
            </div>
            <div className="flex justify-between p-3 bg-bg-base rounded-lg">
              <span className="text-text-muted">Host UI</span>
              <span className="text-text-primary font-mono">{versions?.hostUi || 'N/A'}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Update Actions */}
      <Card>
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Download className="w-5 h-5 text-info" />
          Update Actions
        </h3>
        
        <div className="space-y-4">
          {/* Status display when updating */}
          {isUpdating && status && (
            <div className="p-4 bg-info/10 border border-info/20 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="w-5 h-5 animate-spin text-info" />
                <span className="font-medium text-info">
                  {status.status === 'downloading' ? 'Downloading update...' : 'Applying update...'}
                </span>
              </div>
              {status.message && (
                <p className="text-sm text-text-muted">{status.message}</p>
              )}
              {status.progress !== undefined && (
                <div className="mt-2">
                  <div className="h-2 bg-bg-surface rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-info transition-all"
                      style={{ width: `${status.progress}%` }}
                    />
                  </div>
                  <p className="text-xs text-text-muted mt-1">{status.progress}% complete</p>
                </div>
              )}
            </div>
          )}

          {/* Reboot required */}
          {status?.status === 'reboot_required' && (
            <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
              <div className="flex items-center gap-2 text-warning">
                <AlertTriangle className="w-5 h-5" />
                <span className="font-medium">Reboot Required</span>
              </div>
              <p className="text-sm text-text-muted mt-1">
                A system reboot is required to complete the update.
              </p>
            </div>
          )}

          {/* Error display */}
          {status?.status === 'error' && status.message && (
            <div className="p-4 bg-error/10 border border-error/20 rounded-lg">
              <div className="flex items-center gap-2 text-error">
                <XCircle className="w-5 h-5" />
                <span className="font-medium">Update Error</span>
              </div>
              <p className="text-sm text-text-muted mt-1">{status.message}</p>
            </div>
          )}

          {/* Update available info */}
          {checkMutation.data?.available && (
            <div className="p-4 bg-success/10 border border-success/20 rounded-lg">
              <div className="flex items-center gap-2 text-success mb-2">
                <ArrowDownToLine className="w-5 h-5" />
                <span className="font-medium">
                  Version {checkMutation.data.availableVersion} Available
                </span>
              </div>
              <div className="text-sm text-text-muted space-y-1">
                <p>Download size: {formatBytes(checkMutation.data.totalDownloadSize)}</p>
                <p>{checkMutation.data.components.length} component(s) to update</p>
              </div>
              {checkMutation.data.releaseNotes && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <p className="text-xs text-text-muted mb-1">Release Notes:</p>
                  <p className="text-sm text-text-secondary">{checkMutation.data.releaseNotes}</p>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => checkMutation.mutate()}
              disabled={checkMutation.isPending || isUpdating}
            >
              {checkMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Check for Updates
            </Button>
            
            {checkMutation.data?.available && (
              <Button
                onClick={() => applyMutation.mutate()}
                disabled={applyMutation.isPending || isUpdating}
              >
                {applyMutation.isPending || isUpdating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Apply Update
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Update Configuration */}
      <Card>
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-accent" />
          Update Settings
        </h3>
        
        <div className="space-y-4">
          <div className="flex justify-between p-3 bg-bg-base rounded-lg">
            <span className="text-text-muted">Update Server</span>
            <span className="text-text-primary font-mono text-sm">
              {config?.serverUrl || 'Not configured'}
            </span>
          </div>
          <div className="flex justify-between p-3 bg-bg-base rounded-lg">
            <span className="text-text-muted">Channel</span>
            <Badge variant="default">{config?.channel || 'dev'}</Badge>
          </div>
          <div className="flex justify-between p-3 bg-bg-base rounded-lg">
            <span className="text-text-muted">Auto Check</span>
            <Badge variant={config?.autoCheck ? 'success' : 'default'}>
              {config?.autoCheck ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
        </div>
        
        <p className="text-xs text-text-muted mt-4">
          Update settings are managed by the Quantix-vDC control plane. 
          Contact your administrator to change update policies.
        </p>
      </Card>
    </div>
  );
}
```

---

## Part 3: Integration with Maintenance Mode

### 3.1 When vDC Pushes Full System Update

For A/B partition updates that require reboot:

1. **vDC calls** `/api/v1/updates/hosts/{nodeId}/apply` with `force_reboot: true`
2. **qx-node receives** the apply request
3. **qx-node requests maintenance** from Update Server:
   ```
   POST /api/v1/maintenance/request
   {
     "node_id": "qhci-01",
     "target_version": "0.0.6",
     "update_type": "full",
     "requires_reboot": true
   }
   ```
4. **Update Server notifies vDC** to drain VMs
5. **vDC migrates** VMs to other hosts
6. **When empty**, Update Server marks node as `ready`
7. **qx-node applies** update and reboots
8. **After reboot**, qx-node reports completion

### 3.2 Add Maintenance Request to UpdateManager

Add to `mod.rs`:

```rust
/// Request maintenance mode from update server before A/B update
pub async fn request_maintenance(&self, target_version: &str) -> Result<String> {
    let request = MaintenanceRequest {
        node_id: self.get_node_id().await,
        target_version: target_version.to_string(),
        update_type: "full".to_string(),
        requires_reboot: true,
    };
    
    let response = self.http_client
        .post(format!("{}/api/v1/maintenance/request", self.config.server_url))
        .json(&request)
        .send()
        .await?;
    
    let result: MaintenanceResponse = response.json().await?;
    Ok(result.maintenance_id)
}

/// Poll maintenance status until ready
pub async fn wait_for_maintenance_ready(&self, maintenance_id: &str) -> Result<()> {
    loop {
        let response = self.http_client
            .get(format!("{}/api/v1/maintenance/status/{}", 
                self.config.server_url, maintenance_id))
            .send()
            .await?;
        
        let status: MaintenanceStatus = response.json().await?;
        
        match status.state.as_str() {
            "ready" => return Ok(()),
            "draining" => {
                info!(vms_remaining = status.vms_remaining, "Waiting for VM drain");
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
            "cancelled" | "failed" => {
                return Err(anyhow!("Maintenance cancelled or failed"));
            }
            _ => {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
}
```

---

## Part 4: Testing Checklist

### Backend Tests

- [ ] `GET /api/v1/updates/check` returns correct version comparison
- [ ] `GET /api/v1/updates/current` returns all component versions
- [ ] `GET /api/v1/updates/status` reflects current state
- [ ] `POST /api/v1/updates/apply` starts update in background
- [ ] Component update restarts correct service
- [ ] A/B update requests maintenance mode
- [ ] SHA256 verification fails on corrupted download
- [ ] Backup is created before applying

### Frontend Tests

- [ ] Updates tab shows in Settings
- [ ] Current versions display correctly
- [ ] Check button queries API and shows result
- [ ] Apply button starts update
- [ ] Progress bar updates during download
- [ ] Error states display correctly
- [ ] Reboot required warning shows

---

## Part 5: File Summary

### Files to Create

| File | Location | Description |
|------|----------|-------------|
| `updates.ts` | `quantix-host-ui/src/api/` | API client |
| `useUpdates.ts` | `quantix-host-ui/src/hooks/` | React hooks |

### Files to Modify

| File | Location | Changes |
|------|----------|---------|
| `http_server.rs` | `agent/limiquantix-node/src/` | Add REST endpoints, UpdateManager to state |
| `main.rs` | `agent/limiquantix-node/src/` | Initialize UpdateManager |
| `config.rs` | `agent/limiquantix-node/src/` | Add UpdatesConfig |
| `Settings.tsx` | `quantix-host-ui/src/pages/` | Add Updates tab |

### Existing Files (Reference)

| File | Location | Status |
|------|----------|--------|
| `mod.rs` | `agent/limiquantix-node/src/update/` | ✅ Ready to use |
| `downloader.rs` | `agent/limiquantix-node/src/update/` | ✅ Ready to use |
| `applier.rs` | `agent/limiquantix-node/src/update/` | ✅ Ready to use |
| `ab_update.rs` | `agent/limiquantix-node/src/update/` | ✅ Ready to use |

---

## Summary

The Quantix-OS update client implementation requires:

1. **Backend (~4-6 hours)**
   - Add REST API endpoints to `http_server.rs`
   - Wire UpdateManager into AppState
   - Add config section for updates

2. **Frontend (~2-3 hours)**
   - Create API client and hooks
   - Add Updates tab to Settings page
   - Implement UI components

3. **Integration (~2-3 hours)**
   - Test with Update Server
   - Verify maintenance mode flow
   - End-to-end testing with vDC

The core update logic already exists in the Rust `update/` module. The main work is exposing it via REST API and building the UI.
