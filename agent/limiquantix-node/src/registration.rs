//! Control Plane Registration and Heartbeat.
//!
//! This module handles:
//! - Initial node registration with the control plane
//! - Periodic heartbeat to report node status
//! - Re-registration on connection loss
//! - Full state sync via StateWatcher
//! - Image scanning and sync to report available cloud images
//! - Storage pool status reporting (host is source of truth)
//! - Thundering herd protection via startup jitter

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use rand::Rng;
use tokio::sync::RwLock;
use tokio::time::interval;
use tracing::{debug, error, info, warn};

use limiquantix_hypervisor::{Hypervisor, StorageManager};
use limiquantix_telemetry::TelemetryCollector;

use crate::config::Config;
use crate::state_watcher::StateWatcher;

/// Maximum jitter before full state sync (5 seconds) - thundering herd protection
const STARTUP_JITTER_MAX_MS: u64 = 5000;

/// Registration client for the control plane.
pub struct RegistrationClient {
    control_plane_address: String,
    hostname: String,
    management_ip: String,
    labels: std::collections::HashMap<String, String>,
    heartbeat_interval: Duration,
    telemetry: Arc<TelemetryCollector>,
    hypervisor: Arc<dyn Hypervisor>,
    storage: Arc<StorageManager>,
    http_client: reqwest::Client,
    /// Path to cloud images directory
    images_path: PathBuf,
    /// The server-assigned node ID (set after registration)
    registered_node_id: RwLock<Option<String>>,
    /// State watcher for real-time state synchronization
    state_watcher: Arc<StateWatcher>,
}

impl RegistrationClient {
    /// Create a new registration client.
    pub fn new(
        config: &Config,
        telemetry: Arc<TelemetryCollector>,
        hypervisor: Arc<dyn Hypervisor>,
        storage: Arc<StorageManager>,
        state_watcher: Arc<StateWatcher>,
    ) -> Self {
        let hostname = config.node.get_hostname();
        
        // Use configured management IP if set, otherwise auto-detect
        let management_ip = config.node.get_management_ip()
            .or_else(|| detect_management_ip())
            .unwrap_or_else(|| {
                warn!("Failed to detect management IP for registration, falling back to 127.0.0.1");
                "127.0.0.1".to_string()
            });
        
        info!(management_ip = %management_ip, "Registration client using management IP");
        
        Self {
            control_plane_address: config.control_plane.address.clone(),
            hostname,
            management_ip,
            labels: config.node.labels.clone(),
            heartbeat_interval: Duration::from_secs(config.control_plane.heartbeat_interval_secs),
            telemetry,
            hypervisor,
            storage,
            http_client: reqwest::Client::new(),
            images_path: PathBuf::from(&config.hypervisor.images_path),
            registered_node_id: RwLock::new(None),
            state_watcher,
        }
    }
    
    /// Register with the control plane.
    pub async fn register(&self) -> anyhow::Result<String> {
        info!(
            control_plane = %self.control_plane_address,
            hostname = %self.hostname,
            "Registering with control plane"
        );
        
        let telemetry = self.telemetry.collect();
        
        // Calculate CPU topology
        let threads_per_core = if telemetry.cpu.physical_cores > 0 {
            telemetry.cpu.logical_cores / telemetry.cpu.physical_cores
        } else {
            1
        };
        
        // Build storage devices array from telemetry
        let storage_devices: Vec<serde_json::Value> = telemetry.disks.iter()
            .filter(|d| !d.removable && d.total_bytes > 0) // Filter out removable/empty devices
            .map(|disk| {
                // Determine device type based on path
                let device_type = if disk.device.contains("nvme") {
                    "NVME"
                } else if disk.device.contains("sd") {
                    "SSD" // Assume SSD for now, could check rotational
                } else {
                    "HDD"
                };
                
                serde_json::json!({
                    "path": disk.device.clone(),
                    "model": disk.filesystem.clone(), // Using filesystem as model for now
                    "sizeBytes": disk.total_bytes,
                    "type": device_type,
                    "available": true
                })
            })
            .collect();
        
        // Build network devices array from telemetry
        let network_devices: Vec<serde_json::Value> = telemetry.networks.iter()
            .filter(|n| !n.name.starts_with("lo") && !n.name.starts_with("docker") && !n.name.starts_with("veth") && !n.name.starts_with("br-"))
            .map(|nic| {
                serde_json::json!({
                    "name": nic.name.clone(),
                    "macAddress": nic.mac_address.clone(),
                    "speedMbps": 1000u64, // Default 1Gbps, sysinfo doesn't provide speed
                    "mtu": 1500u32,       // Default MTU
                    "sriovCapable": false
                })
            })
            .collect();
        
        // Build registration request matching the proto format
        // Note: Field names use camelCase for JSON, matching Connect-RPC conventions
        // Always re-detect management IP to handle network changes (DHCP <-> static)
        let current_ip = detect_management_ip().unwrap_or_else(|| self.management_ip.clone());
        let request = serde_json::json!({
            "hostname": self.hostname,
            "managementIp": format!("{}:9090", current_ip),
            "labels": self.labels,
            "role": {
                "compute": true,
                "storage": false,
                "controlPlane": false
            },
            "cpuInfo": {
                "model": telemetry.cpu.model,
                "sockets": 1u32,
                "coresPerSocket": telemetry.cpu.physical_cores as u32,
                "threadsPerCore": threads_per_core as u32,
                "totalThreads": telemetry.cpu.logical_cores as u32,
                "frequencyMhz": telemetry.cpu.frequency_mhz,
                "features": serde_json::Value::Array(vec![])
            },
            "memoryInfo": {
                "totalBytes": telemetry.memory.total_bytes,
                "allocatableBytes": telemetry.memory.available_bytes
            },
            "storageDevices": storage_devices,
            "networkDevices": network_devices
        });
        
        let url = format!(
            "{}/limiquantix.compute.v1.NodeService/RegisterNode",
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
                    
                    // Parse the response to get the server-assigned node ID
                    let node_id = match serde_json::from_str::<serde_json::Value>(&body) {
                        Ok(json) => {
                            json.get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                        }
                        Err(_) => None
                    };
                    
                    if let Some(id) = &node_id {
                        // Store the server-assigned node ID
                        *self.registered_node_id.write().await = Some(id.clone());
                        
                        info!(
                            node_id = %id,
                            hostname = %self.hostname,
                            "Successfully registered with control plane"
                        );
                        
                        // Sync existing VMs from the hypervisor to the control plane
                        if let Err(e) = self.sync_vms(id).await {
                            warn!(error = %e, "Failed to sync VMs to control plane");
                        }
                        
                        // Scan and sync local images to the control plane
                        if let Err(e) = self.sync_images(id).await {
                            warn!(error = %e, "Failed to sync images to control plane");
                        }
                        
                        Ok(id.clone())
                    } else {
                        warn!(
                            body = %body,
                            "Registration response missing node ID"
                        );
                        Err(anyhow::anyhow!("Registration response missing node ID"))
                    }
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    warn!(
                        status = %status,
                        body = %body,
                        "Registration request failed"
                    );
                    Err(anyhow::anyhow!("Registration failed: {} - {}", status, body))
                }
            }
            Err(e) => {
                warn!(
                    error = %e,
                    "Failed to connect to control plane"
                );
                Err(anyhow::anyhow!("Connection failed: {}", e))
            }
        }
    }
    
    /// Sync existing VMs from the hypervisor to the control plane.
    async fn sync_vms(&self, node_id: &str) -> anyhow::Result<()> {
        info!(node_id = %node_id, "Syncing existing VMs to control plane");
        
        // Get list of VMs from hypervisor
        let vms = match self.hypervisor.list_vms().await {
            Ok(vms) => vms,
            Err(e) => {
                error!(error = %e, "Failed to list VMs from hypervisor");
                return Err(anyhow::anyhow!("Failed to list VMs: {}", e));
            }
        };
        
        if vms.is_empty() {
            info!("No VMs to sync");
            return Ok(());
        }
        
        info!(count = vms.len(), "Found VMs to sync");
        
        // Build VM info list for the control plane
        let vm_info: Vec<serde_json::Value> = vms.iter().map(|vm| {
            serde_json::json!({
                "id": vm.id,
                "name": vm.name,
                "state": format!("{:?}", vm.state),
                "cpuCores": 0u32,  // Not available from basic VmInfo
                "memoryMib": 0u64, // Not available from basic VmInfo
                "diskPaths": serde_json::Value::Array(vec![])
            })
        }).collect();
        
        // Send sync request
        let request = serde_json::json!({
            "nodeId": node_id,
            "vms": vm_info
        });
        
        let url = format!(
            "{}/limiquantix.compute.v1.NodeService/SyncNodeVMs",
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
                        let imported = json.get("importedCount").and_then(|v| v.as_i64()).unwrap_or(0);
                        let existing = json.get("existingCount").and_then(|v| v.as_i64()).unwrap_or(0);
                        info!(
                            imported = imported,
                            existing = existing,
                            "VM sync completed"
                        );
                    }
                    Ok(())
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    warn!(status = %status, body = %body, "VM sync request failed");
                    Err(anyhow::anyhow!("VM sync failed: {} - {}", status, body))
                }
            }
            Err(e) => {
                warn!(error = %e, "Failed to send VM sync request");
                Err(anyhow::anyhow!("VM sync request failed: {}", e))
            }
        }
    }
    
    /// Scan local images and sync them to the control plane.
    async fn sync_images(&self, node_id: &str) -> anyhow::Result<()> {
        info!(node_id = %node_id, path = %self.images_path.display(), "Scanning local images");
        
        // Ensure the images directory exists
        if !self.images_path.exists() {
            info!("Images directory does not exist, skipping image sync");
            return Ok(());
        }
        
        // Scan the images directory
        let mut images = Vec::new();
        let mut entries = match tokio::fs::read_dir(&self.images_path).await {
            Ok(entries) => entries,
            Err(e) => {
                warn!(error = %e, "Failed to read images directory");
                return Ok(()); // Not a fatal error
            }
        };
        
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            
            // Only process files with supported extensions
            let extension = path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            
            if !matches!(extension.to_lowercase().as_str(), "qcow2" | "img" | "raw" | "iso" | "vmdk") {
                continue;
            }
            
            // Get file metadata
            let metadata = match tokio::fs::metadata(&path).await {
                Ok(m) => m,
                Err(e) => {
                    warn!(path = %path.display(), error = %e, "Failed to get file metadata");
                    continue;
                }
            };
            
            if !metadata.is_file() {
                continue;
            }
            
            let filename = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            
            let size_bytes = metadata.len();
            
            // Get virtual size for qcow2 images using qemu-img
            let virtual_size_bytes = if extension == "qcow2" {
                get_qcow2_virtual_size(&path).await.unwrap_or(size_bytes)
            } else {
                size_bytes
            };
            
            // Detect OS from filename
            let detected_os = detect_os_from_filename(&filename);
            
            // Get modification time
            let modified_at = metadata.modified()
                .ok()
                .map(|t| {
                    chrono::DateTime::<chrono::Utc>::from(t)
                        .format("%Y-%m-%dT%H:%M:%SZ")
                        .to_string()
                })
                .unwrap_or_default();
            
            info!(
                filename = %filename,
                size_mb = size_bytes / 1024 / 1024,
                os = %detected_os.distribution,
                "Found cloud image"
            );
            
            images.push(serde_json::json!({
                "path": path.to_string_lossy(),
                "filename": filename,
                "sizeBytes": size_bytes,
                "virtualSizeBytes": virtual_size_bytes,
                "format": extension,
                "checksum": "", // TODO: Calculate SHA256
                "detectedOs": {
                    "family": detected_os.family,
                    "distribution": detected_os.distribution,
                    "version": detected_os.version,
                    "architecture": "x86_64",
                    "defaultUser": detected_os.default_user,
                    "cloudInitEnabled": true,
                    "provisioningMethod": 1 // CLOUD_INIT
                },
                "modifiedAt": modified_at
            }));
        }
        
        if images.is_empty() {
            info!("No cloud images found in {}", self.images_path.display());
            return Ok(());
        }
        
        info!(count = images.len(), "Found cloud images to sync");
        
        // Send sync request to control plane
        let request = serde_json::json!({
            "nodeId": node_id,
            "images": images
        });
        
        let url = format!(
            "{}/limiquantix.storage.v1.ImageService/ScanLocalImages",
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
                        let registered = json.get("registeredCount").and_then(|v| v.as_i64()).unwrap_or(0);
                        let existing = json.get("existingCount").and_then(|v| v.as_i64()).unwrap_or(0);
                        info!(
                            registered = registered,
                            existing = existing,
                            "Image sync completed"
                        );
                    }
                    Ok(())
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    warn!(status = %status, body = %body, "Image sync request failed");
                    Err(anyhow::anyhow!("Image sync failed: {} - {}", status, body))
                }
            }
            Err(e) => {
                warn!(error = %e, "Failed to send image sync request");
                Err(anyhow::anyhow!("Image sync request failed: {}", e))
            }
        }
    }
    
    /// Ensure all assigned storage pools are mounted on this node.
    /// 
    /// Compares the list of assigned pool IDs from the control plane with the
    /// currently mounted pools. For any pool that is assigned but not mounted,
    /// fetches the pool configuration from the control plane and mounts it.
    /// Also unmounts pools that are no longer assigned.
    async fn ensure_assigned_pools_mounted(&self, assigned_pool_ids: &[String]) {
        // Get currently mounted pools
        let mounted_pools = self.storage.list_pools().await;
        let mounted_pool_ids: std::collections::HashSet<&str> = mounted_pools
            .iter()
            .map(|p| p.pool_id.as_str())
            .collect();
        
        // Build set of assigned pool IDs for quick lookup
        let assigned_set: std::collections::HashSet<&str> = assigned_pool_ids
            .iter()
            .map(|s| s.as_str())
            .collect();
        
        // Build a map of pools that need name updates (already mounted but no name)
        let pools_needing_name: std::collections::HashSet<&str> = mounted_pools
            .iter()
            .filter(|p| p.name.is_none())
            .map(|p| p.pool_id.as_str())
            .collect();
        
        // First, handle unassignment: unmount pools that are mounted but no longer assigned
        // Only unmount pools that have a name (i.e., were assigned from QvDC, not locally created)
        for pool in &mounted_pools {
            if !assigned_set.contains(pool.pool_id.as_str()) && pool.name.is_some() {
                info!(
                    pool_id = %pool.pool_id,
                    pool_name = ?pool.name,
                    "Pool unassigned from QvDC, unmounting"
                );
                
                if let Err(e) = self.storage.destroy_pool(&pool.pool_id).await {
                    error!(
                        pool_id = %pool.pool_id,
                        error = %e,
                        "Failed to unmount unassigned pool"
                    );
                }
            }
        }
        
        // Process each assigned pool
        for pool_id in assigned_pool_ids {
            let is_mounted = mounted_pool_ids.contains(pool_id.as_str());
            let needs_name = pools_needing_name.contains(pool_id.as_str());
            
            if is_mounted && !needs_name {
                // Pool is mounted and has a name, nothing to do
                continue;
            }
            
            if is_mounted && needs_name {
                // Pool is mounted but needs its name updated from QvDC
                debug!(
                    pool_id = %pool_id,
                    "Pool mounted but missing name, fetching from control plane"
                );
                
                if let Ok(pool_config) = self.fetch_pool_config(pool_id).await {
                    let pool_name = pool_config.get("name")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    
                    if let Some(name) = pool_name {
                        info!(
                            pool_id = %pool_id,
                            pool_name = %name,
                            "Updating pool name from QvDC"
                        );
                        self.storage.update_pool_name(pool_id, Some(name)).await;
                    }
                }
                continue;
            }
            
            // Pool is not mounted, fetch config and mount it
            info!(
                pool_id = %pool_id,
                "Assigned pool not mounted, fetching configuration from control plane"
            );
            
            // Fetch pool configuration from control plane
            match self.fetch_pool_config(pool_id).await {
                Ok(pool_config) => {
                    if let Err(e) = self.mount_assigned_pool(pool_id, &pool_config).await {
                        error!(
                            pool_id = %pool_id,
                            error = %e,
                            "Failed to mount assigned pool"
                        );
                    }
                }
                Err(e) => {
                    warn!(
                        pool_id = %pool_id,
                        error = %e,
                        "Failed to fetch pool configuration from control plane"
                    );
                }
            }
        }
    }
    
    /// Fetch storage pool configuration from the control plane.
    async fn fetch_pool_config(&self, pool_id: &str) -> anyhow::Result<serde_json::Value> {
        let url = format!(
            "{}/limiquantix.storage.v1.StoragePoolService/GetPool",
            self.control_plane_address
        );
        
        let request = serde_json::json!({
            "id": pool_id
        });
        
        let response = self.http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;
        
        if !response.status().is_success() {
            let status = response.status();
            return Err(anyhow::anyhow!("GetPool request failed with status: {}", status));
        }
        
        let body = response.text().await?;
        let json: serde_json::Value = serde_json::from_str(&body)?;
        
        Ok(json)
    }
    
    /// Mount an assigned storage pool based on its configuration.
    async fn mount_assigned_pool(&self, pool_id: &str, pool_config: &serde_json::Value) -> anyhow::Result<()> {
        use limiquantix_hypervisor::storage::{PoolType, PoolConfig, NfsConfig, CephConfig, IscsiConfig, LocalConfig};
        
        // Log the full response for debugging
        debug!(
            pool_id = %pool_id,
            pool_config = %pool_config,
            "Full pool config from QvDC"
        );
        
        // Extract the friendly name from the pool response
        // Connect-RPC uses camelCase, so try both "name" and check top-level keys
        let pool_name = pool_config.get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        
        info!(
            pool_id = %pool_id,
            pool_name = ?pool_name,
            available_keys = ?pool_config.as_object().map(|o| o.keys().collect::<Vec<_>>()),
            "Extracting pool configuration"
        );
        
        // Extract backend configuration from the pool spec
        let spec = pool_config.get("spec")
            .ok_or_else(|| anyhow::anyhow!("Pool spec not found in response"))?;
        let backend = spec.get("backend")
            .ok_or_else(|| anyhow::anyhow!("Backend config not found in pool spec"))?;
        
        // Determine pool type from backend type (can be string or integer from protobuf enum)
        // Proto enum: CEPH_RBD=0, CEPH_CEPHFS=1, LOCAL_LVM=2, LOCAL_DIR=3, NFS=4, ISCSI=5
        let backend_type_value = backend.get("type");
        let backend_type: &str = match backend_type_value {
            Some(serde_json::Value::String(s)) => s.as_str(),
            Some(serde_json::Value::Number(n)) => {
                match n.as_u64() {
                    Some(0) => "CEPH_RBD",
                    Some(1) => "CEPH_CEPHFS",
                    Some(2) => "LOCAL_LVM",
                    Some(3) => "LOCAL_DIR",
                    Some(4) => "NFS",
                    Some(5) => "ISCSI",
                    _ => "LOCAL_DIR",
                }
            }
            _ => "LOCAL_DIR",
        };
        
        info!(
            pool_id = %pool_id,
            backend_type = %backend_type,
            raw_type = ?backend_type_value,
            "Parsed backend type for pool"
        );
        
        let (pool_type, config) = match backend_type {
            "NFS" | "BACKEND_TYPE_NFS" => {
                let nfs = backend.get("nfs")
                    .ok_or_else(|| anyhow::anyhow!("NFS config missing for NFS pool"))?;
                
                let config = PoolConfig {
                    name: pool_name.clone(),
                    nfs: Some(NfsConfig {
                        server: nfs.get("server").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        export_path: nfs.get("exportPath").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        version: nfs.get("version").and_then(|v| v.as_str()).unwrap_or("4.1").to_string(),
                        options: nfs.get("options").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        mount_point: nfs.get("mountPoint").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    }),
                    ..Default::default()
                };
                (PoolType::Nfs, config)
            }
            "CEPH_RBD" | "BACKEND_TYPE_CEPH_RBD" => {
                let ceph = backend.get("ceph")
                    .ok_or_else(|| anyhow::anyhow!("Ceph config missing for Ceph pool"))?;
                
                let monitors: Vec<String> = ceph.get("monitors")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                
                let config = PoolConfig {
                    name: pool_name.clone(),
                    ceph: Some(CephConfig {
                        cluster_id: ceph.get("clusterId").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        pool_name: ceph.get("poolName").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        monitors,
                        user: ceph.get("user").and_then(|v| v.as_str()).unwrap_or("admin").to_string(),
                        keyring_path: ceph.get("keyringPath").and_then(|v| v.as_str()).unwrap_or("/etc/ceph/ceph.client.admin.keyring").to_string(),
                        namespace: ceph.get("namespace").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        secret_uuid: ceph.get("secretUuid").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    }),
                    ..Default::default()
                };
                (PoolType::CephRbd, config)
            }
            "ISCSI" | "BACKEND_TYPE_ISCSI" => {
                let iscsi = backend.get("iscsi")
                    .ok_or_else(|| anyhow::anyhow!("iSCSI config missing for iSCSI pool"))?;
                
                let config = PoolConfig {
                    name: pool_name.clone(),
                    iscsi: Some(IscsiConfig {
                        portal: iscsi.get("portal").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        target: iscsi.get("target").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        chap_enabled: iscsi.get("chapEnabled").and_then(|v| v.as_bool()).unwrap_or(false),
                        chap_user: iscsi.get("chapUser").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        chap_password: iscsi.get("chapPassword").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                        lun: iscsi.get("lun").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                        volume_group: iscsi.get("volumeGroup").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    }),
                    ..Default::default()
                };
                (PoolType::Iscsi, config)
            }
            "LOCAL_DIR" | "BACKEND_TYPE_LOCAL_DIR" | _ => {
                let local_dir = backend.get("localDir");
                let path = local_dir
                    .and_then(|l| l.get("path"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_else(|| {
                        // Default path if not specified
                        "/var/lib/limiquantix/pools"
                    });
                
                let config = PoolConfig {
                    name: pool_name.clone(),
                    local: Some(LocalConfig {
                        path: format!("{}/{}", path.trim_end_matches('/'), pool_id),
                    }),
                    ..Default::default()
                };
                (PoolType::LocalDir, config)
            }
        };
        
        info!(
            pool_id = %pool_id,
            pool_type = ?pool_type,
            "Mounting assigned storage pool"
        );
        
        // Initialize the pool using the storage manager
        self.storage.init_pool(pool_id, pool_type, config).await
            .map_err(|e| anyhow::anyhow!("Failed to initialize pool: {}", e))?;
        
        info!(
            pool_id = %pool_id,
            "Successfully mounted assigned storage pool"
        );
        
        Ok(())
    }
    
    /// Collect storage pool status for heartbeat (host is source of truth).
    async fn collect_storage_pool_status(&self) -> Vec<serde_json::Value> {
        let pools = self.storage.list_pools().await;
        
        pools.iter().map(|pool| {
            // Determine health based on pool availability
            let health = if pool.available_bytes > 0 {
                1 // HEALTH_HEALTHY
            } else if pool.total_bytes > 0 {
                2 // HEALTH_DEGRADED
            } else {
                3 // HEALTH_ERROR
            };
            
            // Get mount path or device path
            let mount_path = pool.mount_path.as_ref()
                .or(pool.device_path.as_ref())
                .cloned()
                .unwrap_or_default();
            
            serde_json::json!({
                "poolId": pool.pool_id,
                "health": health,
                "totalBytes": pool.total_bytes,
                "usedBytes": pool.total_bytes.saturating_sub(pool.available_bytes),
                "availableBytes": pool.available_bytes,
                "mountPath": mount_path,
                "volumeCount": pool.volume_count,
                "errorMessage": ""
            })
        }).collect()
    }
    
    /// Start the registration and heartbeat loop.
    /// 
    /// This will:
    /// 1. Attempt to register with the control plane
    /// 2. Apply startup jitter (thundering herd protection)
    /// 3. Perform full state sync via StateWatcher
    /// 4. Send periodic heartbeats after successful registration
    /// 5. Handle request_full_sync from heartbeat response
    pub async fn run(&self) {
        // Initial registration with retry
        let mut retry_delay = Duration::from_secs(1);
        let max_retry_delay = Duration::from_secs(60);
        let mut node_id: String;
        
        loop {
            match self.register().await {
                Ok(id) => {
                    node_id = id;
                    info!(node_id = %node_id, "Registration complete");
                    
                    // Set node ID on state watcher for subsequent syncs
                    self.state_watcher.set_node_id(node_id.clone()).await;
                    
                    break;
                }
                Err(e) => {
                    warn!(
                        error = %e,
                        retry_in_secs = retry_delay.as_secs(),
                        "Registration failed, will retry"
                    );
                    tokio::time::sleep(retry_delay).await;
                    retry_delay = std::cmp::min(retry_delay * 2, max_retry_delay);
                }
            }
        }
        
        // ===== THUNDERING HERD PROTECTION =====
        // Add random jitter (0-5 seconds) before full state sync
        // This spreads out requests when many hosts restart together
        let jitter_ms = rand::thread_rng().gen_range(0..STARTUP_JITTER_MAX_MS);
        let jitter = Duration::from_millis(jitter_ms);
        info!(
            jitter_ms = jitter_ms,
            "Applying startup jitter before full state sync"
        );
        tokio::time::sleep(jitter).await;
        // ========================================
        
        // Perform full state sync via StateWatcher
        if let Err(e) = self.state_watcher.sync_full_state(&node_id).await {
            warn!(error = %e, "Failed to sync full state, will retry on heartbeat drift detection");
        }
        
        // Sync images (keep existing functionality)
        if let Err(e) = self.sync_images(&node_id).await {
            warn!(error = %e, "Failed to sync images to control plane");
        }
        
        info!(node_id = %node_id, "Starting heartbeat loop");
        
        // Heartbeat loop
        let mut heartbeat_timer = interval(self.heartbeat_interval);
        let mut consecutive_failures = 0;
        
        loop {
            heartbeat_timer.tick().await;
            
            match self.heartbeat_with_hash().await {
                Ok(request_full_sync) => {
                    consecutive_failures = 0;
                    
                    // If control plane detected drift, perform full sync
                    if request_full_sync {
                        info!("Control plane requested full sync (drift detected)");
                        
                        // Apply jitter on drift sync too
                        let jitter_ms = rand::thread_rng().gen_range(0..STARTUP_JITTER_MAX_MS);
                        tokio::time::sleep(Duration::from_millis(jitter_ms)).await;
                        
                        if let Err(e) = self.state_watcher.sync_full_state(&node_id).await {
                            warn!(error = %e, "Failed to sync full state after drift detection");
                        }
                    }
                }
                Err(_) => {
                    consecutive_failures += 1;
                    
                    // After 3 consecutive failures, attempt re-registration
                    if consecutive_failures >= 3 {
                        warn!(
                            consecutive_failures = consecutive_failures,
                            "Multiple heartbeat failures, attempting re-registration"
                        );
                        
                        // Apply jitter on reconnection too
                        let jitter_ms = rand::thread_rng().gen_range(0..STARTUP_JITTER_MAX_MS);
                        tokio::time::sleep(Duration::from_millis(jitter_ms)).await;
                        
                        if let Ok(new_node_id) = self.register().await {
                            node_id = new_node_id;
                            self.state_watcher.set_node_id(node_id.clone()).await;
                            
                            // Sync state after re-registration
                            if let Err(e) = self.state_watcher.sync_full_state(&node_id).await {
                                warn!(error = %e, "Failed to sync state after re-registration");
                            }
                            
                            consecutive_failures = 0;
                        }
                    }
                }
            }
        }
    }
    
    /// Send a heartbeat with state hash and return whether full sync is requested.
    async fn heartbeat_with_hash(&self) -> anyhow::Result<bool> {
        // Get the registered node ID
        let node_id = self.registered_node_id.read().await.clone();
        let node_id = match node_id {
            Some(id) => id,
            None => {
                warn!("Cannot send heartbeat: not registered yet");
                return Err(anyhow::anyhow!("Not registered"));
            }
        };
        
        debug!(node_id = %node_id, "Sending heartbeat with state hash");
        
        let telemetry = self.telemetry.collect();
        
        // Collect storage pool status (host is source of truth)
        let storage_pools = self.collect_storage_pool_status().await;
        
        // Calculate state hash for anti-entropy
        let state_hash = self.state_watcher.calculate_state_hash().await;
        
        // Build heartbeat request with state hash
        let request = serde_json::json!({
            "nodeId": node_id,
            "cpuUsagePercent": telemetry.cpu.usage_percent,
            "memoryUsedMib": telemetry.memory.used_bytes / 1024 / 1024,
            "memoryTotalMib": telemetry.memory.total_bytes / 1024 / 1024,
            "storagePools": storage_pools,
            "stateHash": state_hash
        });
        
        let url = format!(
            "{}/limiquantix.compute.v1.NodeService/UpdateHeartbeat",
            self.control_plane_address
        );
        
        let response = self.http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await;
        
        match response {
            Ok(resp) if resp.status().is_success() => {
                let body = resp.text().await.unwrap_or_default();
                let mut request_full_sync = false;
                
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                    // Check if control plane requests full sync (drift detected)
                    request_full_sync = json.get("requestFullSync")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    
                    // Handle assigned pools as before
                    if let Some(assigned_ids) = json.get("assignedPoolIds").and_then(|v| v.as_array()) {
                        let assigned_pool_ids: Vec<String> = assigned_ids
                            .iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect();
                        
                        if !assigned_pool_ids.is_empty() {
                            self.ensure_assigned_pools_mounted(&assigned_pool_ids).await;
                        }
                    }
                }
                
                debug!(node_id = %node_id, request_full_sync = %request_full_sync, "Heartbeat acknowledged");
                Ok(request_full_sync)
            }
            Ok(resp) => {
                let status = resp.status();
                warn!(
                    node_id = %node_id,
                    status = %status,
                    "Heartbeat failed"
                );
                Err(anyhow::anyhow!("Heartbeat failed: {}", status))
            }
            Err(e) => {
                warn!(
                    node_id = %node_id,
                    error = %e,
                    "Failed to send heartbeat"
                );
                Err(anyhow::anyhow!("Heartbeat connection failed: {}", e))
            }
        }
    }
}

/// Detect the management IP address.
/// 
/// Priority order:
/// 1. Real physical interfaces (eth*, enp*, ens*, wlan*, wlp*)
/// 2. Bonded/team interfaces (bond*, team*)
/// 3. Any other non-virtual interface
/// 4. Fallback to any non-loopback IP
pub fn detect_management_ip() -> Option<String> {
    debug!("Detecting management IP address...");
    
    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
        debug!("Found {} network interfaces", interfaces.len());
        
        // Collect all valid (non-loopback, non-link-local) IPv4 addresses with interface names
        let mut candidates: Vec<(String, std::net::Ipv4Addr, i32)> = Vec::new();
        
        for (name, ip) in interfaces {
            // Skip loopback
            if ip.is_loopback() {
                continue;
            }
            
            if let std::net::IpAddr::V4(ipv4) = ip {
                // Skip link-local (169.254.x.x)
                if ipv4.is_link_local() {
                    continue;
                }
                
                // Skip private addresses that are commonly used for VMs (192.168.122.x = libvirt default)
                // But still allow other 192.168.x.x networks
                let octets = ipv4.octets();
                if octets[0] == 192 && octets[1] == 168 && octets[2] == 122 {
                    // This is the libvirt default bridge, skip it
                    debug!(interface = %name, ip = %ipv4, "Skipping libvirt default bridge network");
                    continue;
                }
                
                // Calculate priority based on interface name
                let priority = get_interface_priority(&name);
                
                debug!(
                    interface = %name,
                    ip = %ipv4,
                    priority = priority,
                    "Found network interface candidate"
                );
                
                candidates.push((name, ipv4, priority));
            }
        }
        
        // Sort by priority (higher is better)
        candidates.sort_by(|a, b| b.2.cmp(&a.2));
        
        if candidates.is_empty() {
            warn!("No valid network interface candidates found");
            // Log all interfaces for debugging
            if let Ok(all_ifaces) = local_ip_address::list_afinet_netifas() {
                for (name, ip) in all_ifaces {
                    warn!(interface = %name, ip = %ip, "Available interface (filtered out)");
                }
            }
        } else {
            debug!("Found {} candidate interfaces", candidates.len());
            for (name, ip, priority) in &candidates {
                debug!(interface = %name, ip = %ip, priority = %priority, "Candidate");
            }
        }
        
        if let Some((name, ip, _)) = candidates.first() {
            info!(
                interface = %name,
                ip = %ip,
                "Selected management IP"
            );
            return Some(ip.to_string());
        }
    } else {
        warn!("Failed to list network interfaces");
    }
    
    // Fallback: try local_ip_address crate's default detection
    debug!("Trying fallback IP detection");
    let fallback = local_ip_address::local_ip()
        .ok()
        .map(|ip| {
            info!(ip = %ip, "Using fallback IP detection");
            ip.to_string()
        });
    
    if fallback.is_none() {
        warn!("Fallback IP detection also failed");
    }
    
    fallback
}

/// Get priority for an interface based on its name.
/// Higher priority = more likely to be the management interface.
fn get_interface_priority(name: &str) -> i32 {
    let name_lower = name.to_lowercase();
    
    // Virtual bridges and VM-related interfaces (lowest priority)
    if name_lower.starts_with("virbr") 
        || name_lower.starts_with("vnet")
        || name_lower.starts_with("tap")
        || name_lower.starts_with("veth")
        || name_lower.starts_with("docker")
        || name_lower.starts_with("br-")
        || name_lower.starts_with("cni")
        || name_lower.starts_with("flannel")
        || name_lower.starts_with("calico")
    {
        return -10;
    }
    
    // Generic bridges (might be user-configured management bridges)
    if name_lower.starts_with("br") {
        return 20; // User-configured bridges get medium priority
    }
    
    // Wireless interfaces (good priority - often the active connection)
    if name_lower.starts_with("wlan") || name_lower.starts_with("wlp") {
        return 80;
    }
    
    // Physical ethernet interfaces (highest priority)
    if name_lower.starts_with("eth") 
        || name_lower.starts_with("enp")
        || name_lower.starts_with("ens")
        || name_lower.starts_with("eno")
        || name_lower.starts_with("em")
    {
        return 100;
    }
    
    // Bonded/team interfaces (very high priority - usually management)
    if name_lower.starts_with("bond") || name_lower.starts_with("team") {
        return 90;
    }
    
    // Infiniband
    if name_lower.starts_with("ib") {
        return 70;
    }
    
    // Everything else gets medium priority
    50
}

/// Detected OS information from filename.
struct DetectedOs {
    family: i32,     // 1 = Linux, 2 = Windows
    distribution: String,
    version: String,
    default_user: String,
}

/// Detect OS information from a cloud image filename.
fn detect_os_from_filename(filename: &str) -> DetectedOs {
    let filename_lower = filename.to_lowercase();
    
    // Check for known distributions
    if filename_lower.contains("ubuntu") {
        let version = extract_version(&filename_lower, &["22.04", "24.04", "20.04", "18.04"]);
        DetectedOs {
            family: 1,
            distribution: "ubuntu".to_string(),
            version,
            default_user: "ubuntu".to_string(),
        }
    } else if filename_lower.contains("debian") {
        let version = extract_version(&filename_lower, &["12", "11", "10"]);
        DetectedOs {
            family: 1,
            distribution: "debian".to_string(),
            version,
            default_user: "debian".to_string(),
        }
    } else if filename_lower.contains("rocky") {
        let version = extract_version(&filename_lower, &["9", "8"]);
        DetectedOs {
            family: 1,
            distribution: "rocky".to_string(),
            version,
            default_user: "rocky".to_string(),
        }
    } else if filename_lower.contains("almalinux") || filename_lower.contains("alma") {
        let version = extract_version(&filename_lower, &["9", "8"]);
        DetectedOs {
            family: 1,
            distribution: "almalinux".to_string(),
            version,
            default_user: "almalinux".to_string(),
        }
    } else if filename_lower.contains("centos") {
        let version = extract_version(&filename_lower, &["9", "8", "7"]);
        DetectedOs {
            family: 1,
            distribution: "centos".to_string(),
            version,
            default_user: "cloud-user".to_string(),
        }
    } else if filename_lower.contains("fedora") {
        let version = extract_version(&filename_lower, &["40", "39", "38"]);
        DetectedOs {
            family: 1,
            distribution: "fedora".to_string(),
            version,
            default_user: "fedora".to_string(),
        }
    } else if filename_lower.contains("opensuse") || filename_lower.contains("suse") {
        let version = extract_version(&filename_lower, &["15.5", "15.4", "15"]);
        DetectedOs {
            family: 1,
            distribution: "opensuse".to_string(),
            version,
            default_user: "root".to_string(),
        }
    } else if filename_lower.contains("windows") {
        DetectedOs {
            family: 2,
            distribution: "windows".to_string(),
            version: String::new(),
            default_user: "Administrator".to_string(),
        }
    } else {
        DetectedOs {
            family: 1,
            distribution: "unknown".to_string(),
            version: String::new(),
            default_user: "root".to_string(),
        }
    }
}

/// Extract version from filename.
fn extract_version(filename: &str, versions: &[&str]) -> String {
    for version in versions {
        if filename.contains(version) {
            return version.to_string();
        }
    }
    String::new()
}

/// Get virtual size of a QCOW2 image using qemu-img.
async fn get_qcow2_virtual_size(path: &std::path::Path) -> Option<u64> {
    use tokio::process::Command;
    
    let output = Command::new("qemu-img")
        .args(["info", "--output=json", &path.to_string_lossy()])
        .output()
        .await
        .ok()?;
    
    if !output.status.success() {
        return None;
    }
    
    let json_str = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&json_str).ok()?;
    
    json.get("virtual-size")
        .and_then(|v| v.as_u64())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_detect_management_ip() {
        // Should return some IP (not necessarily the "right" one in tests)
        let ip = detect_management_ip();
        // Just ensure it doesn't panic
        println!("Detected IP: {:?}", ip);
    }
}
