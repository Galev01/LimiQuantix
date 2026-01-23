//! State Watcher Module - Real-time state synchronization with Control Plane.
//!
//! This module implements the agent-push model for state reconciliation:
//! - Polls libvirt every 2-3 seconds for VM state changes
//! - Detects new, updated, and deleted VMs
//! - Sends real-time notifications to the control plane
//! - Calculates state hash for anti-entropy drift detection
//! - Supports immediate poll trigger after local mutations
//!
//! Design Decisions:
//! - Polling over libvirt events (simpler, more reliable)
//! - Minimal hash calculation (id:state:count) for performance
//! - UUID validation to skip transient/nil UUIDs
//! - Status-only sync (never sends Spec to avoid controller fighting)

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use sha2::{Sha256, Digest};
use tokio::sync::{mpsc, RwLock};
use tokio::time::interval;
use tracing::{debug, error, info, warn, instrument};

use limiquantix_hypervisor::{Hypervisor, StorageManager, VmInfo, VmState};

/// Default polling interval for state changes (2 seconds for responsive UI)
const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Cached VM state for change detection
#[derive(Debug, Clone)]
struct CachedVmState {
    /// VM display name
    name: String,
    /// Current power state
    state: VmState,
    /// Counter for state changes (increments on each change)
    state_change_count: u64,
}

impl From<VmInfo> for CachedVmState {
    fn from(vm: VmInfo) -> Self {
        Self {
            name: vm.name,
            state: vm.state,
            state_change_count: 0,
        }
    }
}

/// VM change event types
#[derive(Debug, Clone)]
pub enum VmChangeEvent {
    /// New VM appeared on the node
    Created(VmInfo),
    /// VM state changed (e.g., started, stopped)
    Updated { vm: VmInfo, previous_state: VmState },
    /// VM was removed from the node
    Deleted { id: String, name: String },
}

impl VmChangeEvent {
    /// Get the VM ID from the event
    pub fn vm_id(&self) -> &str {
        match self {
            VmChangeEvent::Created(vm) => &vm.id,
            VmChangeEvent::Updated { vm, .. } => &vm.id,
            VmChangeEvent::Deleted { id, .. } => id,
        }
    }
}

/// State Watcher - Monitors hypervisor state and pushes changes to control plane.
pub struct StateWatcher {
    /// Hypervisor backend for querying VM state
    hypervisor: Arc<dyn Hypervisor>,
    /// Storage manager for querying storage pools
    storage: Arc<StorageManager>,
    /// Node ID (assigned by control plane)
    node_id: RwLock<Option<String>>,
    /// Control plane address for API calls
    control_plane_address: String,
    /// HTTP client for control plane communication
    http_client: reqwest::Client,
    /// Cached VM states for change detection
    cached_vms: RwLock<HashMap<String, CachedVmState>>,
    /// Polling interval
    poll_interval: Duration,
    /// Channel for immediate poll trigger
    immediate_poll_tx: mpsc::Sender<()>,
    /// Receiver for immediate poll trigger (moved to run_loop)
    immediate_poll_rx: RwLock<Option<mpsc::Receiver<()>>>,
    /// Running flag
    running: RwLock<bool>,
}

impl StateWatcher {
    /// Create a new StateWatcher.
    pub fn new(
        hypervisor: Arc<dyn Hypervisor>,
        storage: Arc<StorageManager>,
        control_plane_address: String,
    ) -> Self {
        let (tx, rx) = mpsc::channel(16);
        
        Self {
            hypervisor,
            storage,
            node_id: RwLock::new(None),
            control_plane_address,
            http_client: reqwest::Client::new(),
            cached_vms: RwLock::new(HashMap::new()),
            poll_interval: DEFAULT_POLL_INTERVAL,
            immediate_poll_tx: tx,
            immediate_poll_rx: RwLock::new(Some(rx)),
            running: RwLock::new(false),
        }
    }
    
    /// Set the node ID (called after registration).
    pub async fn set_node_id(&self, node_id: String) {
        *self.node_id.write().await = Some(node_id);
    }
    
    /// Get a clone of the immediate poll trigger sender.
    pub fn get_poll_trigger(&self) -> mpsc::Sender<()> {
        self.immediate_poll_tx.clone()
    }
    
    /// Start the state watcher loop.
    /// 
    /// This runs in the background and:
    /// - Polls libvirt every `poll_interval`
    /// - Detects changes and notifies the control plane
    /// - Responds to immediate poll triggers
    #[instrument(skip(self))]
    pub async fn run(&self) {
        // Take the receiver (can only be taken once)
        let mut immediate_poll_rx = {
            let mut rx_guard = self.immediate_poll_rx.write().await;
            match rx_guard.take() {
                Some(rx) => rx,
                None => {
                    error!("StateWatcher::run called multiple times - only one instance allowed");
                    return;
                }
            }
        };
        
        *self.running.write().await = true;
        info!(poll_interval_secs = self.poll_interval.as_secs(), "Starting state watcher");
        
        let mut poll_timer = interval(self.poll_interval);
        
        loop {
            tokio::select! {
                _ = poll_timer.tick() => {
                    self.poll_and_notify().await;
                }
                Some(_) = immediate_poll_rx.recv() => {
                    debug!("Immediate poll triggered");
                    self.poll_and_notify().await;
                    // Reset interval to avoid double-polling
                    poll_timer.reset();
                }
            }
        }
    }
    
    /// Poll the hypervisor and notify control plane of any changes.
    async fn poll_and_notify(&self) {
        let node_id = match self.node_id.read().await.clone() {
            Some(id) => id,
            None => {
                debug!("Cannot poll: node ID not set (not registered yet)");
                return;
            }
        };
        
        let changes = match self.detect_vm_changes().await {
            Ok(changes) => changes,
            Err(e) => {
                error!(error = %e, "Failed to detect VM changes");
                return;
            }
        };
        
        if changes.is_empty() {
            return;
        }
        
        debug!(change_count = changes.len(), "Detected VM changes");
        
        // Notify control plane of each change
        for change in changes {
            if let Err(e) = self.notify_vm_change(&node_id, &change).await {
                warn!(
                    vm_id = %change.vm_id(),
                    error = %e,
                    "Failed to notify control plane of VM change"
                );
            }
        }
    }
    
    /// Detect VM changes by comparing current state with cached state.
    async fn detect_vm_changes(&self) -> anyhow::Result<Vec<VmChangeEvent>> {
        let current_vms = self.hypervisor.list_vms().await?;
        let mut cached = self.cached_vms.write().await;
        let mut changes = Vec::new();
        
        // Track which cached VMs we've seen
        let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        
        for vm in &current_vms {
            // CRITICAL: Skip VMs without valid/stable UUIDs
            if !is_valid_uuid(&vm.id) {
                warn!(
                    vm_name = %vm.name,
                    vm_id = %vm.id,
                    "Skipping VM with invalid/transient UUID - not syncing to control plane"
                );
                continue;
            }
            
            seen_ids.insert(vm.id.clone());
            
            match cached.get(&vm.id) {
                None => {
                    // New VM discovered
                    info!(
                        vm_id = %vm.id,
                        vm_name = %vm.name,
                        state = ?vm.state,
                        "New VM discovered"
                    );
                    changes.push(VmChangeEvent::Created(vm.clone()));
                    
                    // Add to cache
                    cached.insert(vm.id.clone(), CachedVmState::from(vm.clone()));
                }
                Some(cached_vm) if cached_vm.state != vm.state => {
                    // State changed
                    info!(
                        vm_id = %vm.id,
                        vm_name = %vm.name,
                        previous_state = ?cached_vm.state,
                        new_state = ?vm.state,
                        "VM state changed"
                    );
                    
                    let previous_state = cached_vm.state;
                    changes.push(VmChangeEvent::Updated {
                        vm: vm.clone(),
                        previous_state,
                    });
                    
                    // Update cache with incremented change count
                    if let Some(entry) = cached.get_mut(&vm.id) {
                        entry.state = vm.state;
                        entry.state_change_count += 1;
                    }
                }
                _ => {
                    // No change
                }
            }
        }
        
        // Detect deleted VMs
        let cached_ids: Vec<String> = cached.keys().cloned().collect();
        for id in cached_ids {
            if !seen_ids.contains(&id) {
                if let Some(removed) = cached.remove(&id) {
                    info!(
                        vm_id = %id,
                        vm_name = %removed.name,
                        "VM deleted from node"
                    );
                    changes.push(VmChangeEvent::Deleted {
                        id,
                        name: removed.name,
                    });
                }
            }
        }
        
        Ok(changes)
    }
    
    /// Calculate a lightweight state hash for anti-entropy.
    /// 
    /// Hash input format: "{uuid}:{state}:{change_count}\n" for each VM (sorted by ID)
    /// Returns first 16 hex chars of SHA256 (64 bits - sufficient for drift detection)
    pub async fn calculate_state_hash(&self) -> String {
        let cached = self.cached_vms.read().await;
        let mut hasher = Sha256::new();
        
        // Sort by ID for deterministic ordering
        let mut entries: Vec<_> = cached.iter().collect();
        entries.sort_by_key(|(id, _)| *id);
        
        for (id, vm) in entries {
            // MINIMAL hash input: "{uuid}:{state_enum}:{change_count}\n"
            let hash_input = format!(
                "{}:{}:{}\n",
                id,
                vm_state_to_u8(vm.state),
                vm.state_change_count
            );
            hasher.update(hash_input.as_bytes());
        }
        
        // Return first 16 hex chars (64 bits)
        hex::encode(hasher.finalize())[..16].to_string()
    }
    
    /// Perform a full state sync to the control plane.
    /// 
    /// Called on:
    /// - Startup (after registration)
    /// - Reconnect (after network failure)
    /// - Control plane request (anti-entropy drift detection)
    #[instrument(skip(self))]
    pub async fn sync_full_state(&self, node_id: &str) -> anyhow::Result<SyncStats> {
        info!(node_id = %node_id, "Performing full state sync");
        
        // Collect current VM state from hypervisor
        let vms = self.hypervisor.list_vms().await?;
        
        // Filter out invalid UUIDs and build status reports
        let vm_reports: Vec<serde_json::Value> = vms.iter()
            .filter(|vm| is_valid_uuid(&vm.id))
            .map(|vm| {
                serde_json::json!({
                    "id": vm.id,
                    "name": vm.name,
                    "state": vm_state_to_proto_enum(vm.state),
                    "stateChangeCount": 0u64,
                    "cpuUsagePercent": 0.0,
                    "memoryUsedBytes": 0u64,
                    "ipAddresses": serde_json::Value::Array(vec![]),
                    "stateChangedAtUnix": chrono::Utc::now().timestamp()
                })
            })
            .collect();
        
        // Collect storage pool status
        let pools = self.storage.list_pools().await;
        let pool_reports: Vec<serde_json::Value> = pools.iter()
            .map(|pool| {
                let health = if pool.available_bytes > 0 {
                    1 // HEALTH_HEALTHY
                } else if pool.total_bytes > 0 {
                    2 // HEALTH_DEGRADED
                } else {
                    3 // HEALTH_ERROR
                };
                
                serde_json::json!({
                    "poolId": pool.pool_id,
                    "health": health,
                    "totalBytes": pool.total_bytes,
                    "usedBytes": pool.total_bytes.saturating_sub(pool.available_bytes),
                    "availableBytes": pool.available_bytes,
                    "mountPath": pool.mount_path.as_ref().or(pool.device_path.as_ref()).cloned().unwrap_or_default(),
                    "volumeCount": pool.volume_count,
                    "errorMessage": ""
                })
            })
            .collect();
        
        // Calculate state hash
        let state_hash = self.calculate_state_hash().await;
        
        // Build request
        let request = serde_json::json!({
            "nodeId": node_id,
            "hostInfo": {
                "hostname": gethostname::gethostname().to_string_lossy().to_string(),
                "managementIp": "",  // Filled by registration
                "memoryTotalBytes": 0u64,
                "memoryAvailableBytes": 0u64,
                "cpuCores": 0u32,
                "cpuUsagePercent": 0.0
            },
            "vms": vm_reports,
            "storagePools": pool_reports,
            "stateHash": state_hash
        });
        
        let url = format!(
            "{}/limiquantix.compute.v1.NodeService/SyncFullState",
            self.control_plane_address
        );
        
        let response = self.http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await;
        
        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    let body = resp.text().await.unwrap_or_default();
                    let stats = parse_sync_response(&body);
                    
                    info!(
                        vms_reconciled = stats.vms_reconciled,
                        vms_discovered = stats.vms_discovered,
                        vms_lost = stats.vms_lost,
                        pools_reconciled = stats.pools_reconciled,
                        "Full state sync completed"
                    );
                    
                    // Update cache with current VMs
                    self.update_cache_from_vms(&vms).await;
                    
                    Ok(stats)
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    warn!(status = %status, body = %body, "Full state sync request failed");
                    Err(anyhow::anyhow!("Sync failed: {} - {}", status, body))
                }
            }
            Err(e) => {
                warn!(error = %e, "Failed to send full state sync request");
                Err(anyhow::anyhow!("Sync request failed: {}", e))
            }
        }
    }
    
    /// Notify control plane of a VM change.
    async fn notify_vm_change(&self, node_id: &str, change: &VmChangeEvent) -> anyhow::Result<()> {
        let (event_type, vm_report, previous_state) = match change {
            VmChangeEvent::Created(vm) => {
                (1, Some(vm_to_status_report(vm)), None)
            }
            VmChangeEvent::Updated { vm, previous_state } => {
                (2, Some(vm_to_status_report(vm)), Some(*previous_state))
            }
            VmChangeEvent::Deleted { id, name } => {
                let report = serde_json::json!({
                    "id": id,
                    "name": name,
                    "state": 2,  // STOPPED
                    "stateChangeCount": 0u64
                });
                (3, Some(report), None)
            }
        };
        
        let request = serde_json::json!({
            "nodeId": node_id,
            "vm": vm_report,
            "eventType": event_type,
            "timestampUnix": chrono::Utc::now().timestamp(),
            "previousState": previous_state.map(vm_state_to_proto_enum).unwrap_or(0)
        });
        
        let url = format!(
            "{}/limiquantix.compute.v1.NodeService/NotifyVMChange",
            self.control_plane_address
        );
        
        let response = self.http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await;
        
        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    let body = resp.text().await.unwrap_or_default();
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                        let action = json.get("action").and_then(|v| v.as_str()).unwrap_or("unknown");
                        debug!(
                            vm_id = %change.vm_id(),
                            action = %action,
                            "VM change notification acknowledged"
                        );
                    }
                    Ok(())
                } else {
                    let status = resp.status();
                    Err(anyhow::anyhow!("Notification failed: {}", status))
                }
            }
            Err(e) => {
                Err(anyhow::anyhow!("Notification request failed: {}", e))
            }
        }
    }
    
    /// Update internal cache from a list of VMs.
    async fn update_cache_from_vms(&self, vms: &[VmInfo]) {
        let mut cached = self.cached_vms.write().await;
        cached.clear();
        
        for vm in vms {
            if is_valid_uuid(&vm.id) {
                cached.insert(vm.id.clone(), CachedVmState::from(vm.clone()));
            }
        }
    }
}

/// Statistics from a full state sync.
#[derive(Debug, Default)]
pub struct SyncStats {
    pub vms_reconciled: i32,
    pub vms_discovered: i32,
    pub vms_lost: i32,
    pub pools_reconciled: i32,
}

/// Check if a UUID is valid and non-nil.
/// 
/// Rejects:
/// - Nil UUIDs (00000000-0000-0000-0000-000000000000)
/// - Malformed UUID strings
/// - Obviously transient patterns
fn is_valid_uuid(id: &str) -> bool {
    // Parse as UUID
    let uuid = match uuid::Uuid::parse_str(id) {
        Ok(u) => u,
        Err(_) => {
            debug!(id = %id, "Invalid UUID format");
            return false;
        }
    };
    
    // Reject nil UUID
    if uuid.is_nil() {
        debug!(id = %id, "Nil UUID detected");
        return false;
    }
    
    // Reject obviously transient patterns
    let bytes = uuid.as_bytes();
    if bytes.iter().all(|&b| b == 0 || b == 0xFF) {
        debug!(id = %id, "Transient UUID pattern detected");
        return false;
    }
    
    true
}

/// Convert VmState to a u8 for hashing.
fn vm_state_to_u8(state: VmState) -> u8 {
    match state {
        VmState::Running => 1,
        VmState::Stopped => 2,
        VmState::Paused => 3,
        VmState::Suspended => 4,
        VmState::Crashed => 5,
        VmState::Unknown => 0,
    }
}

/// Convert VmState to proto enum value.
fn vm_state_to_proto_enum(state: VmState) -> i32 {
    match state {
        VmState::Running => 1,
        VmState::Stopped => 2,
        VmState::Paused => 3,
        VmState::Suspended => 4,
        VmState::Crashed => 5,
        VmState::Unknown => 0,
    }
}

/// Convert VmInfo to a status report JSON.
fn vm_to_status_report(vm: &VmInfo) -> serde_json::Value {
    serde_json::json!({
        "id": vm.id,
        "name": vm.name,
        "state": vm_state_to_proto_enum(vm.state),
        "stateChangeCount": 0u64,
        "cpuUsagePercent": 0.0,
        "memoryUsedBytes": 0u64,
        "ipAddresses": serde_json::Value::Array(vec![]),
        "stateChangedAtUnix": chrono::Utc::now().timestamp()
    })
}

/// Parse sync response into SyncStats.
fn parse_sync_response(body: &str) -> SyncStats {
    let mut stats = SyncStats::default();
    
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(body) {
        stats.vms_reconciled = json.get("vmsReconciled").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        stats.vms_discovered = json.get("vmsDiscovered").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        stats.vms_lost = json.get("vmsLost").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        stats.pools_reconciled = json.get("poolsReconciled").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    }
    
    stats
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_is_valid_uuid() {
        // Valid UUID
        assert!(is_valid_uuid("550e8400-e29b-41d4-a716-446655440000"));
        
        // Nil UUID (should be rejected)
        assert!(!is_valid_uuid("00000000-0000-0000-0000-000000000000"));
        
        // Invalid format
        assert!(!is_valid_uuid("not-a-uuid"));
        assert!(!is_valid_uuid(""));
        
        // Too short
        assert!(!is_valid_uuid("550e8400"));
    }
    
    #[test]
    fn test_vm_state_to_u8() {
        assert_eq!(vm_state_to_u8(VmState::Running), 1);
        assert_eq!(vm_state_to_u8(VmState::Stopped), 2);
        assert_eq!(vm_state_to_u8(VmState::Paused), 3);
        assert_eq!(vm_state_to_u8(VmState::Unknown), 0);
    }
}
