//! Control Plane Registration and Heartbeat.
//!
//! This module handles:
//! - Initial node registration with the control plane
//! - Periodic heartbeat to report node status
//! - Re-registration on connection loss
//! - VM sync to report existing VMs to the control plane
//! - Image scanning and sync to report available cloud images
//! - Storage pool status reporting (host is source of truth)

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time::interval;
use tracing::{debug, error, info, warn};

use limiquantix_hypervisor::{Hypervisor, StorageManager};
use limiquantix_telemetry::TelemetryCollector;

use crate::config::Config;

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
}

impl RegistrationClient {
    /// Create a new registration client.
    pub fn new(
        config: &Config,
        telemetry: Arc<TelemetryCollector>,
        hypervisor: Arc<dyn Hypervisor>,
        storage: Arc<StorageManager>,
    ) -> Self {
        let hostname = config.node.get_hostname();
        
        // Detect management IP
        let management_ip = detect_management_ip()
            .unwrap_or_else(|| "127.0.0.1".to_string());
        
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
        let request = serde_json::json!({
            "hostname": self.hostname,
            "managementIp": format!("{}:9090", self.management_ip),
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
    
    /// Send a heartbeat to the control plane.
    pub async fn heartbeat(&self) -> anyhow::Result<()> {
        // Get the registered node ID
        let node_id = self.registered_node_id.read().await.clone();
        let node_id = match node_id {
            Some(id) => id,
            None => {
                warn!("Cannot send heartbeat: not registered yet");
                return Err(anyhow::anyhow!("Not registered"));
            }
        };
        
        debug!(node_id = %node_id, "Sending heartbeat");
        
        let telemetry = self.telemetry.collect();
        
        // Collect storage pool status (host is source of truth)
        let storage_pools = self.collect_storage_pool_status().await;
        
        // Build heartbeat request with storage pool status
        let request = serde_json::json!({
            "nodeId": node_id,
            "cpuUsagePercent": telemetry.cpu.usage_percent,
            "memoryUsedMib": telemetry.memory.used_bytes / 1024 / 1024,
            "memoryTotalMib": telemetry.memory.total_bytes / 1024 / 1024,
            "storagePools": storage_pools
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
                // Parse response to check for assigned pools we should mount
                if let Ok(body) = resp.text().await {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                        if let Some(assigned_ids) = json.get("assignedPoolIds").and_then(|v| v.as_array()) {
                            debug!(
                                node_id = %node_id,
                                assigned_pools = assigned_ids.len(),
                                "Heartbeat acknowledged with assigned pool list"
                            );
                            // TODO: Check if any assigned pools are not mounted and mount them
                        }
                    }
                }
                debug!(node_id = %node_id, "Heartbeat acknowledged");
                Ok(())
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
            
            serde_json::json!({
                "poolId": pool.pool_id,
                "health": health,
                "totalBytes": pool.total_bytes,
                "usedBytes": pool.total_bytes.saturating_sub(pool.available_bytes),
                "availableBytes": pool.available_bytes,
                "mountPath": pool.mount_path,
                "volumeCount": pool.volume_count,
                "errorMessage": ""
            })
        }).collect()
    }
    
    /// Start the registration and heartbeat loop.
    /// 
    /// This will:
    /// 1. Attempt to register with the control plane
    /// 2. Retry registration on failure
    /// 3. Send periodic heartbeats after successful registration
    pub async fn run(&self) {
        // Initial registration with retry
        let mut retry_delay = Duration::from_secs(1);
        let max_retry_delay = Duration::from_secs(60);
        
        loop {
            match self.register().await {
                Ok(node_id) => {
                    info!(node_id = %node_id, "Registration complete, starting heartbeat loop");
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
        
        // Heartbeat loop
        let mut heartbeat_timer = interval(self.heartbeat_interval);
        let mut consecutive_failures = 0;
        
        loop {
            heartbeat_timer.tick().await;
            
            match self.heartbeat().await {
                Ok(_) => {
                    consecutive_failures = 0;
                }
                Err(_) => {
                    consecutive_failures += 1;
                    
                    // After 3 consecutive failures, attempt re-registration
                    if consecutive_failures >= 3 {
                        warn!(
                            consecutive_failures = consecutive_failures,
                            "Multiple heartbeat failures, attempting re-registration"
                        );
                        
                        if self.register().await.is_ok() {
                            consecutive_failures = 0;
                        }
                    }
                }
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
    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
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
        
        if let Some((name, ip, _)) = candidates.first() {
            info!(
                interface = %name,
                ip = %ip,
                "Selected management IP"
            );
            return Some(ip.to_string());
        }
    }
    
    // Fallback: try local_ip_address crate's default detection
    local_ip_address::local_ip()
        .ok()
        .map(|ip| ip.to_string())
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
