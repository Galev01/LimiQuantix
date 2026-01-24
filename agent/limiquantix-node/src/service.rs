//! Node Daemon gRPC service implementation.

// Many OVS and network port methods are prepared for future SDN features
#![allow(dead_code)]

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use futures::Stream;
use tokio::sync::{mpsc, RwLock};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};
use tracing::{info, debug, warn, error, instrument};

use limiquantix_hypervisor::{
    Hypervisor, VmConfig, VmState, DiskConfig, NicConfig, CdromConfig,
    DiskBus, DiskFormat, NicModel, StorageManager, Firmware, BootDevice,
    // Network/OVS types
    OvsPortManager, NetworkPortConfig,
    // Storage types
    PoolType, PoolConfig, VolumeSource, LocalConfig,
    // Cloud-init
    CloudInitConfig, CloudInitGenerator,
};
use limiquantix_telemetry::TelemetryCollector;
use limiquantix_proto::{
    NodeDaemonService, HealthCheckRequest, HealthCheckResponse,
    NodeInfoResponse, VmIdRequest, 
    // VM types - note: proto uses CreateVmOnNodeRequest/Response naming
    CreateVmOnNodeRequest, CreateVmOnNodeResponse,
    StopVmRequest, VmStatusResponse, ListVMsOnNodeResponse, ConsoleInfoResponse, DiskSpec,
    CreateSnapshotRequest, SnapshotResponse, RevertSnapshotRequest,
    DeleteSnapshotRequest, ListSnapshotsResponse, StreamMetricsRequest,
    NodeMetrics, NodeEvent, PowerState,
    // VM logs for troubleshooting
    GetVmLogsRequest, GetVmLogsResponse,
    // Guest agent types (exposed via node daemon service)
    AgentPingResponse, ExecuteInGuestRequest, ExecuteInGuestResponse,
    ReadGuestFileRequest, ReadGuestFileResponse, WriteGuestFileRequest,
    WriteGuestFileResponse, GuestShutdownRequest, GuestShutdownResponse,
    GuestAgentInfo, GuestResourceUsage, GuestNetworkInterface, GuestDiskUsage,
    // Storage pool/volume types
    InitStoragePoolRequest, StoragePoolIdRequest, StoragePoolInfoResponse,
    ListStoragePoolsResponse, CreateVolumeRequest, VolumeIdRequest,
    ResizeVolumeRequest, CloneVolumeRequest, VolumeAttachInfoResponse,
    CreateVolumeSnapshotRequest, StoragePoolType,
    // Storage pool file listing types
    ListStoragePoolFilesRequest, ListStoragePoolFilesResponse, StoragePoolFileEntry,
    // Volume listing types
    ListVolumesRequest, ListVolumesResponse, VolumeInfoResponse,
    ListImagesResponse, ImageInfo,
    // Filesystem quiesce/time sync types
    QuiesceFilesystemsRequest, QuiesceFilesystemsResponse,
    ThawFilesystemsRequest, ThawFilesystemsResponse,
    SyncTimeRequest, SyncTimeResponse,
    // CD-ROM media change
    ChangeMediaRequest,
};
// Agent types (from guest agent protocol - used by AgentClient)
use limiquantix_proto::agent::TelemetryReport;

use crate::agent_client::AgentClient;

/// Cached guest agent info for a VM
#[derive(Debug, Clone, Default)]
struct CachedAgentInfo {
    connected: bool,
    version: String,
    os_name: String,
    os_version: String,
    kernel_version: String,
    hostname: String,
    ip_addresses: Vec<String>,
    last_telemetry: Option<TelemetryReport>,
    last_seen: Option<std::time::Instant>,
}

/// Node Daemon gRPC service implementation.
#[derive(Clone)]
pub struct NodeDaemonServiceImpl {
    node_id: String,
    hostname: String,
    management_ip: String,
    hypervisor: Arc<dyn Hypervisor>,
    telemetry: Arc<TelemetryCollector>,
    storage: Arc<StorageManager>,
    /// OVS port manager for network operations
    ovs_manager: OvsPortManager,
    /// Guest agent manager for all VMs
    agent_manager: Arc<RwLock<HashMap<String, AgentClient>>>,
    /// Cached agent info per VM
    agent_cache: Arc<RwLock<HashMap<String, CachedAgentInfo>>>,
    /// Network ports cache (port_id -> config)
    network_ports: Arc<RwLock<HashMap<String, NetworkPortConfig>>>,
    /// Trigger for immediate state watcher poll (after mutations)
    poll_trigger: Arc<RwLock<Option<mpsc::Sender<()>>>>,
}

impl NodeDaemonServiceImpl {
    /// Create a new service instance.
    pub fn new(
        node_id: String,
        hostname: String,
        management_ip: String,
        hypervisor: Arc<dyn Hypervisor>,
        telemetry: Arc<TelemetryCollector>,
    ) -> Self {
        // Ensure runtime directories exist on startup
        // These directories are in /var/run which is typically a tmpfs and cleared on reboot
        let runtime_dirs = [
            "/var/run/limiquantix",
            "/var/run/limiquantix/vms",
        ];
        
        for dir in &runtime_dirs {
            if let Err(e) = std::fs::create_dir_all(dir) {
                tracing::warn!(path = %dir, error = %e, "Failed to create runtime directory");
            } else {
                tracing::debug!(path = %dir, "Ensured runtime directory exists");
            }
        }
        
        Self {
            node_id,
            hostname,
            management_ip,
            hypervisor,
            telemetry,
            storage: Arc::new(StorageManager::new()),
            ovs_manager: OvsPortManager::new(),
            agent_manager: Arc::new(RwLock::new(HashMap::new())),
            agent_cache: Arc::new(RwLock::new(HashMap::new())),
            network_ports: Arc::new(RwLock::new(HashMap::new())),
            poll_trigger: Arc::new(RwLock::new(None)),
        }
    }
    
    /// Set the poll trigger for immediate state watcher notifications after mutations.
    pub fn set_poll_trigger(&self, trigger: mpsc::Sender<()>) {
        // Use block_on for sync context, or tokio::spawn for async
        let poll_trigger = self.poll_trigger.clone();
        tokio::spawn(async move {
            *poll_trigger.write().await = Some(trigger);
        });
    }
    
    /// Trigger an immediate state watcher poll (call after StartVM, StopVM, CreateVM, DeleteVM).
    async fn trigger_immediate_poll(&self) {
        if let Some(trigger) = self.poll_trigger.read().await.as_ref() {
            if let Err(e) = trigger.send(()).await {
                debug!(error = %e, "Failed to trigger immediate poll (watcher may not be running)");
            }
        }
    }
    
    /// Initialize the service by auto-detecting storage pools (NFS mounts, local storage).
    /// This should be called after creating the service to register existing storage.
    pub async fn init_storage_auto_detect(&self) {
        tracing::info!("Auto-detecting storage pools...");
        
        // Auto-detect NFS mounts
        if let Err(e) = self.detect_nfs_mounts().await {
            tracing::warn!(error = %e, "Failed to auto-detect NFS mounts");
        }
        
        // Auto-detect default local storage path
        if let Err(e) = self.detect_local_storage().await {
            tracing::warn!(error = %e, "Failed to auto-detect local storage");
        }
        
        tracing::info!("Storage auto-detection complete");
    }
    
    /// Get the storage manager (for heartbeat reporting).
    pub fn get_storage_manager(&self) -> Arc<StorageManager> {
        self.storage.clone()
    }
    
    /// Detect and register NFS mounts as storage pools.
    /// 
    /// This method handles two types of NFS mounts:
    /// 1. QvDC-assigned pools: Mounted at /var/lib/limiquantix/mnt/nfs-{UUID}
    ///    - Pool ID is the UUID from the mount path
    ///    - These are managed by QvDC and synced via heartbeat
    /// 2. Manually mounted NFS shares: Mounted elsewhere
    ///    - Pool ID is generated from the mount path
    ///    - These are local-only and not synced to QvDC
    async fn detect_nfs_mounts(&self) -> anyhow::Result<()> {
        use tokio::fs;
        
        // Read /proc/mounts to find NFS mounts
        let content = match fs::read_to_string("/proc/mounts").await {
            Ok(c) => c,
            Err(e) => {
                tracing::debug!(error = %e, "Could not read /proc/mounts (may not be on Linux)");
                return Ok(());
            }
        };
        
        // QvDC mount path pattern: /var/lib/limiquantix/mnt/nfs-{UUID}
        let qvdc_mount_prefix = "/var/lib/limiquantix/mnt/nfs-";
        
        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 && (parts[2] == "nfs" || parts[2] == "nfs4") {
                let source = parts[0];
                let mount_point = parts[1];
                
                // Parse server:export format
                let (server, export_path) = if let Some(colon_pos) = source.find(':') {
                    (source[..colon_pos].to_string(), source[colon_pos+1..].to_string())
                } else {
                    continue; // Invalid NFS mount format
                };
                
                // Determine pool ID based on mount path
                let pool_id = if mount_point.starts_with(qvdc_mount_prefix) {
                    // QvDC-assigned pool: Extract UUID from mount path
                    // Mount path format: /var/lib/limiquantix/mnt/nfs-{UUID}
                    let uuid_part = &mount_point[qvdc_mount_prefix.len()..];
                    
                    // Validate it looks like a UUID (8-4-4-4-12 format)
                    if uuid_part.len() == 36 && uuid_part.chars().filter(|c| *c == '-').count() == 4 {
                        tracing::info!(
                            pool_id = %uuid_part,
                            mount_point = %mount_point,
                            "Found QvDC-assigned NFS pool mount"
                        );
                        uuid_part.to_string()
                    } else {
                        // Not a valid UUID, use path-based ID
                        format!("nfs-{}", mount_point.replace('/', "-").trim_matches('-'))
                    }
                } else {
                    // Manually mounted NFS share: Generate path-based ID
                    format!("nfs-{}", mount_point.replace('/', "-").trim_matches('-'))
                };
                
                // Check if pool already exists
                let pools = self.storage.list_pools().await;
                if pools.iter().any(|p| p.pool_id == pool_id) {
                    tracing::debug!(pool_id = %pool_id, "NFS pool already registered");
                    continue;
                }
                
                // Also check if any existing pool has the same mount point
                // (prevents duplicate registration with different IDs)
                if pools.iter().any(|p| p.mount_path.as_ref() == Some(&mount_point.to_string())) {
                    tracing::debug!(
                        mount_point = %mount_point,
                        "NFS mount already registered under different pool ID"
                    );
                    continue;
                }
                
                tracing::info!(
                    pool_id = %pool_id,
                    server = %server,
                    export = %export_path,
                    mount_point = %mount_point,
                    "Auto-registering NFS mount as storage pool"
                );
                
                // Create pool config
                // Note: Auto-discovered pools don't have a friendly name until synced from QvDC
                let config = limiquantix_hypervisor::storage::PoolConfig {
                    name: None, // Will be set when synced from QvDC
                    nfs: Some(limiquantix_hypervisor::storage::NfsConfig {
                        server,
                        export_path,
                        version: "4.1".to_string(),
                        options: String::new(),
                        mount_point: Some(mount_point.to_string()),
                    }),
                    ..Default::default()
                };
                
                // Initialize the pool
                if let Err(e) = self.storage.init_pool(&pool_id, limiquantix_hypervisor::storage::PoolType::Nfs, config).await {
                    tracing::warn!(pool_id = %pool_id, error = %e, "Failed to register NFS pool");
                }
            }
        }
        
        Ok(())
    }
    
    /// Detect and register default local storage path.
    async fn detect_local_storage(&self) -> anyhow::Result<()> {
        use tokio::fs;
        
        // Priority-ordered list of local storage paths to check
        // /data is the primary storage mount on Quantix-OS
        let local_paths = [
            ("/data", "datastore"),                      // Primary Quantix-OS data partition
            ("/data/vms", "datastore-vms"),              // VM storage subdirectory
            ("/data/images", "datastore-images"),        // Image storage subdirectory  
            ("/var/lib/limiquantix/storage", "local-storage"),
            ("/var/lib/libvirt/images", "local-libvirt"),
        ];
        
        let mut registered_paths: Vec<String> = Vec::new();
        
        for (path, pool_name) in &local_paths {
            // Skip subdirectories of already registered paths
            if registered_paths.iter().any(|p| path.starts_with(p)) {
                tracing::debug!(path = %path, "Skipping subdirectory of already registered pool");
                continue;
            }
            
            if fs::metadata(path).await.is_ok() {
                let pool_id = pool_name.to_string();
                
                // Check if pool already exists
                let pools = self.storage.list_pools().await;
                if pools.iter().any(|p| p.pool_id == pool_id || p.mount_path.as_deref() == Some(*path)) {
                    tracing::debug!(pool_id = %pool_id, "Local pool already registered");
                    registered_paths.push(path.to_string());
                    continue;
                }
                
                // Get disk usage info for this path
                let (total_bytes, available_bytes) = Self::get_mount_usage(path).await;
                
                tracing::info!(
                    pool_id = %pool_id,
                    path = %path,
                    total_gb = total_bytes / (1024 * 1024 * 1024),
                    available_gb = available_bytes / (1024 * 1024 * 1024),
                    "Auto-registering local storage pool"
                );
                
                let config = limiquantix_hypervisor::storage::PoolConfig {
                    local: Some(limiquantix_hypervisor::storage::LocalConfig {
                        path: path.to_string(),
                    }),
                    ..Default::default()
                };
                
                if let Err(e) = self.storage.init_pool(&pool_id, limiquantix_hypervisor::storage::PoolType::LocalDir, config).await {
                    tracing::warn!(pool_id = %pool_id, error = %e, "Failed to register local pool");
                } else {
                    registered_paths.push(path.to_string());
                }
            }
        }
        
        // Detect installer-configured storage pools (from /quantix/limiquantix/storage-pools.yaml)
        self.detect_installer_pools(&mut registered_paths).await?;
        
        // Also detect additional mounted filesystems that look like data storage
        self.detect_additional_mounts(&registered_paths).await?;
        
        Ok(())
    }
    
    /// Detect installer-configured storage pools from Quantix-OS config
    async fn detect_installer_pools(&self, registered_paths: &mut Vec<String>) -> anyhow::Result<()> {
        use tokio::fs;
        
        // Installer saves pool config to /quantix/limiquantix/storage-pools.yaml
        let config_path = "/quantix/limiquantix/storage-pools.yaml";
        
        let content = match fs::read_to_string(config_path).await {
            Ok(c) => c,
            Err(_) => {
                tracing::debug!("No installer storage pools config found at {}", config_path);
                return Ok(());
            }
        };
        
        tracing::info!("Found installer storage pools config: {}", config_path);
        
        // Simple YAML parsing for the storage pool format:
        // storage_pools:
        //   - name: SSD-local01
        //     disk: /dev/nvme1n1
        //     partition: /dev/nvme1n1p1
        //     uuid: be0bc548-a45e-4b67-a991-7635f988aff4
        //     filesystem: xfs
        //     mount_point: /data/pools/SSD-local01
        
        let mut current_pool_name = String::new();
        
        for line in content.lines() {
            let trimmed = line.trim();
            
            // Parse name field
            if trimmed.starts_with("- name:") || trimmed.starts_with("name:") {
                current_pool_name = trimmed
                    .trim_start_matches("- name:")
                    .trim_start_matches("name:")
                    .trim()
                    .to_string();
            }
            
            // Parse mount_point field
            if trimmed.starts_with("mount_point:") {
                let current_mount_point = trimmed
                    .trim_start_matches("mount_point:")
                    .trim()
                    .to_string();
                
                // If we have both name and mount_point, register the pool
                if !current_pool_name.is_empty() && !current_mount_point.is_empty() {
                    // Check if mount point exists and is mounted
                    if fs::metadata(&current_mount_point).await.is_ok() {
                        let pool_id = current_pool_name.clone();
                        
                        // Check if pool already exists
                        let pools = self.storage.list_pools().await;
                        if pools.iter().any(|p| p.pool_id == pool_id || p.mount_path.as_deref() == Some(&current_mount_point)) {
                            tracing::debug!(pool_id = %pool_id, "Installer pool already registered");
                            registered_paths.push(current_mount_point.clone());
                            current_pool_name.clear();
                            continue;
                        }
                        
                        // Get disk usage info
                        let (total_bytes, available_bytes) = Self::get_mount_usage(&current_mount_point).await;
                        
                        tracing::info!(
                            pool_id = %pool_id,
                            mount_point = %current_mount_point,
                            total_gb = total_bytes / (1024 * 1024 * 1024),
                            available_gb = available_bytes / (1024 * 1024 * 1024),
                            "Registering installer-configured storage pool"
                        );
                        
                        let config = limiquantix_hypervisor::storage::PoolConfig {
                            local: Some(limiquantix_hypervisor::storage::LocalConfig {
                                path: current_mount_point.clone(),
                            }),
                            ..Default::default()
                        };
                        
                        if let Err(e) = self.storage.init_pool(&pool_id, limiquantix_hypervisor::storage::PoolType::LocalDir, config).await {
                            tracing::warn!(pool_id = %pool_id, error = %e, "Failed to register installer pool");
                        } else {
                            registered_paths.push(current_mount_point.clone());
                        }
                    } else {
                        tracing::warn!(
                            pool_id = %current_pool_name,
                            mount_point = %current_mount_point,
                            "Installer pool mount point not found - pool may not be mounted"
                        );
                    }
                    
                    // Reset for next pool
                    current_pool_name.clear();
                }
            }
        }
        
        Ok(())
    }
    
    /// Get mount point disk usage
    async fn get_mount_usage(path: &str) -> (u64, u64) {
        // Use statfs to get disk usage
        #[cfg(target_os = "linux")]
        {
            use std::ffi::CString;
            use std::mem::MaybeUninit;
            
            if let Ok(c_path) = CString::new(path) {
                let mut stat: MaybeUninit<libc::statfs> = MaybeUninit::uninit();
                unsafe {
                    if libc::statfs(c_path.as_ptr(), stat.as_mut_ptr()) == 0 {
                        let stat = stat.assume_init();
                        let total = stat.f_blocks as u64 * stat.f_bsize as u64;
                        let available = stat.f_bavail as u64 * stat.f_bsize as u64;
                        return (total, available);
                    }
                }
            }
        }
        (0, 0)
    }
    
    /// Detect additional mounted filesystems (xfs, ext4 on dedicated partitions)
    async fn detect_additional_mounts(&self, already_registered: &[String]) -> anyhow::Result<()> {
        use tokio::fs;
        
        // Read /proc/mounts to find local mounts
        let content = match fs::read_to_string("/proc/mounts").await {
            Ok(c) => c,
            Err(_) => return Ok(()),
        };
        
        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                continue;
            }
            
            let device = parts[0];
            let mount_point = parts[1];
            let fs_type = parts[2];
            
            // Only consider xfs or ext4 on block devices with substantial storage
            if !device.starts_with("/dev/") {
                continue;
            }
            
            // Skip system partitions
            let skip_mounts = ["/", "/boot", "/boot/efi", "/home", "/tmp", "/var", "/usr", "/quantix", "/proc", "/sys", "/dev"];
            if skip_mounts.contains(&mount_point) || mount_point.starts_with("/sys") || mount_point.starts_with("/proc") {
                continue;
            }
            
            // Only consider data-oriented filesystems
            if !["xfs", "ext4", "btrfs"].contains(&fs_type) {
                continue;
            }
            
            // Skip if already registered
            if already_registered.iter().any(|p| mount_point.starts_with(p) || p.starts_with(mount_point)) {
                continue;
            }
            
            // Check if already in pools
            let pools = self.storage.list_pools().await;
            if pools.iter().any(|p| p.mount_path.as_deref() == Some(mount_point)) {
                continue;
            }
            
            // Get size and skip small partitions (< 10GB)
            let (total_bytes, _available) = Self::get_mount_usage(mount_point).await;
            if total_bytes < 10 * 1024 * 1024 * 1024 {
                tracing::debug!(mount_point = %mount_point, "Skipping small partition");
                continue;
            }
            
            // Generate pool ID from mount point
            let pool_id = format!("local{}", mount_point.replace('/', "-"));
            
            tracing::info!(
                pool_id = %pool_id,
                mount_point = %mount_point,
                device = %device,
                fs_type = %fs_type,
                total_gb = total_bytes / (1024 * 1024 * 1024),
                "Auto-registering additional local storage pool"
            );
            
            let config = limiquantix_hypervisor::storage::PoolConfig {
                local: Some(limiquantix_hypervisor::storage::LocalConfig {
                    path: mount_point.to_string(),
                }),
                ..Default::default()
            };
            
            if let Err(e) = self.storage.init_pool(&pool_id, limiquantix_hypervisor::storage::PoolType::LocalDir, config).await {
                tracing::warn!(pool_id = %pool_id, error = %e, "Failed to register additional local pool");
            }
        }
        
        Ok(())
    }
    
    // =========================================================================
    // Accessors
    // =========================================================================
    
    /// Get the node ID
    pub fn get_node_id(&self) -> &str {
        &self.node_id
    }
    
    /// Get the hostname
    pub fn get_hostname(&self) -> &str {
        &self.hostname
    }
    
    /// Get the management IP address.
    /// 
    /// This dynamically re-detects the IP address to handle network changes
    /// (e.g., switching from DHCP to static IP or vice versa).
    /// Falls back to the initially detected IP if detection fails.
    pub fn get_management_ip(&self) -> String {
        // Try to detect current IP dynamically
        if let Some(current_ip) = crate::registration::detect_management_ip() {
            current_ip
        } else {
            // Fallback to initially detected IP
            self.management_ip.clone()
        }
    }
    
    /// Get current telemetry data
    pub fn get_telemetry(&self) -> limiquantix_telemetry::NodeTelemetry {
        self.telemetry.collect()
    }
    
    // =========================================================================
    // Hypervisor Access
    // =========================================================================
    
    /// Get a reference to the hypervisor backend.
    /// Used by HTTP handlers that need direct hypervisor access.
    pub fn hypervisor(&self) -> &Arc<dyn Hypervisor> {
        &self.hypervisor
    }
    
    // =========================================================================
    // Network Operations (OVS/OVN)
    // =========================================================================
    
    /// Get OVS status information
    pub fn get_ovs_status_info(&self) -> Result<limiquantix_hypervisor::OvsStatus, String> {
        self.ovs_manager.get_status().map_err(|e| e.to_string())
    }
    
    /// Configure a network port for a VM
    pub async fn configure_network_port_internal(
        &self,
        config: NetworkPortConfig,
    ) -> Result<limiquantix_hypervisor::NetworkPortInfo, String> {
        let port_id = config.port_id.clone();
        
        // Configure the port in OVS
        let result = self.ovs_manager.configure_port(&config).map_err(|e| e.to_string())?;
        
        // Store in cache for later reference
        {
            let mut ports = self.network_ports.write().await;
            ports.insert(port_id, config);
        }
        
        Ok(result)
    }
    
    /// Delete a network port
    pub async fn delete_network_port_internal(
        &self,
        port_id: &str,
        vm_id: &str,
    ) -> Result<(), String> {
        // Remove from cache
        {
            let mut ports = self.network_ports.write().await;
            ports.remove(port_id);
        }
        
        // Delete from OVS
        self.ovs_manager.delete_port(port_id, vm_id).map_err(|e| e.to_string())
    }
    
    /// Get network port status
    pub async fn get_network_port_status_internal(
        &self,
        port_id: &str,
    ) -> Option<limiquantix_hypervisor::NetworkPortInfo> {
        let ports = self.network_ports.read().await;
        if let Some(config) = ports.get(port_id) {
            self.ovs_manager.get_port_status(port_id, &config.ovn_port_name).ok().flatten()
        } else {
            None
        }
    }
    
    /// List all network ports
    pub async fn list_network_ports_internal(&self) -> Vec<(String, NetworkPortConfig)> {
        let ports = self.network_ports.read().await;
        ports.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }
    
    /// Get or create an agent client for a VM
    async fn get_agent_client(&self, vm_id: &str) -> Result<(), Status> {
        let mut agents = self.agent_manager.write().await;
        
        if !agents.contains_key(vm_id) {
            let mut client = AgentClient::new(vm_id);
            
            if client.socket_exists() {
                match client.connect().await {
                    Ok(()) => {
                        info!(vm_id = %vm_id, "Connected to guest agent");
                        agents.insert(vm_id.to_string(), client);
                    }
                    Err(e) => {
                        debug!(vm_id = %vm_id, error = %e, "Failed to connect to guest agent");
                        return Err(Status::unavailable(format!("Agent not available: {}", e)));
                    }
                }
            } else {
                return Err(Status::unavailable("Agent socket not found"));
            }
        }
        
        Ok(())
    }
    
    /// Update cached agent info from telemetry
    async fn update_agent_cache(&self, vm_id: &str, telemetry: &TelemetryReport) {
        let mut cache = self.agent_cache.write().await;
        let entry = cache.entry(vm_id.to_string()).or_default();
        
        entry.connected = true;
        entry.hostname = telemetry.hostname.clone();
        entry.last_telemetry = Some(telemetry.clone());
        entry.last_seen = Some(std::time::Instant::now());
        
        // Extract IPs from interfaces
        let mut ips = Vec::new();
        for iface in &telemetry.interfaces {
            ips.extend(iface.ipv4_addresses.clone());
        }
        if !ips.is_empty() {
            entry.ip_addresses = ips;
        }
    }
    
    /// Get cached agent info for a VM
    async fn get_agent_info(&self, vm_id: &str) -> Option<GuestAgentInfo> {
        let cache = self.agent_cache.read().await;
        
        cache.get(vm_id).map(|info| {
            let resource_usage = info.last_telemetry.as_ref().map(|t| {
                // Calculate usage_percent for each disk
                let disks = t.disks.iter().map(|d| {
                    let usage_percent = if d.total_bytes > 0 {
                        (d.used_bytes as f64 / d.total_bytes as f64) * 100.0
                    } else {
                        0.0
                    };
                    GuestDiskUsage {
                        mount_point: d.mount_point.clone(),
                        device: d.device.clone(),
                        filesystem: d.filesystem.clone(),
                        total_bytes: d.total_bytes,
                        used_bytes: d.used_bytes,
                        available_bytes: d.available_bytes,
                        usage_percent,
                    }
                }).collect();
                
                GuestResourceUsage {
                    cpu_usage_percent: t.cpu_usage_percent,
                    memory_total_bytes: t.memory_total_bytes,
                    memory_used_bytes: t.memory_used_bytes,
                    memory_available_bytes: t.memory_total_bytes.saturating_sub(t.memory_used_bytes),
                    swap_total_bytes: t.swap_total_bytes,
                    swap_used_bytes: t.swap_used_bytes,
                    load_avg_1: t.load_avg_1,
                    load_avg_5: t.load_avg_5,
                    load_avg_15: t.load_avg_15,
                    disks,
                    process_count: t.process_count,
                    uptime_seconds: t.uptime_seconds,
                }
            });
            
            let interfaces = info.last_telemetry.as_ref()
                .map(|t| t.interfaces.iter().map(|i| GuestNetworkInterface {
                    name: i.name.clone(),
                    mac_address: i.mac_address.clone(),
                    ipv4_addresses: i.ipv4_addresses.clone(),
                    ipv6_addresses: i.ipv6_addresses.clone(),
                    is_up: i.state == 1, // INTERFACE_STATE_UP
                }).collect())
                .unwrap_or_default();
            
            GuestAgentInfo {
                connected: info.connected,
                version: info.version.clone(),
                os_name: info.os_name.clone(),
                os_version: info.os_version.clone(),
                kernel_version: info.kernel_version.clone(),
                hostname: info.hostname.clone(),
                ip_addresses: info.ip_addresses.clone(),
                interfaces,
                resource_usage,
                capabilities: vec![
                    "telemetry".to_string(),
                    "execute".to_string(),
                    "file_read".to_string(),
                    "file_write".to_string(),
                    "shutdown".to_string(),
                ],
                last_seen: info.last_seen.map(|instant| {
                    let duration = instant.elapsed();
                    let now = std::time::SystemTime::now();
                    let seen_time = now - duration;
                    let unix_time = seen_time.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
                    prost_types::Timestamp {
                        seconds: unix_time.as_secs() as i64,
                        nanos: unix_time.subsec_nanos() as i32,
                    }
                }),
            }
        })
    }
    
    /// Perform a local health check (used by the server loop).
    pub async fn health_check(&self) -> Result<HealthCheckResponse, Status> {
        let healthy = self.hypervisor.health_check().await
            .unwrap_or(false);
        
        let caps = self.hypervisor.capabilities().await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        let telemetry = self.telemetry.collect();
        
        Ok(HealthCheckResponse {
            healthy,
            version: env!("CARGO_PKG_VERSION").to_string(),
            hypervisor: caps.name,
            hypervisor_version: caps.version,
            uptime_seconds: telemetry.system.uptime_seconds,
        })
    }
    
    fn map_vm_state(state: VmState) -> i32 {
        match state {
            VmState::Running => PowerState::Running as i32,
            VmState::Stopped => PowerState::Stopped as i32,
            VmState::Paused => PowerState::Paused as i32,
            VmState::Suspended => PowerState::Suspended as i32,
            VmState::Crashed => PowerState::Crashed as i32,
            VmState::Unknown => PowerState::Unknown as i32,
        }
    }
    
    fn convert_disk_bus(bus: i32) -> DiskBus {
        match bus {
            0 => DiskBus::Virtio,
            1 => DiskBus::Scsi,
            2 => DiskBus::Sata,
            3 => DiskBus::Ide,
            _ => DiskBus::Virtio,
        }
    }
    
    fn convert_disk_format(format: i32) -> DiskFormat {
        match format {
            0 => DiskFormat::Qcow2,
            1 => DiskFormat::Raw,
            _ => DiskFormat::Qcow2,
        }
    }
    
    fn convert_nic_model(model: i32) -> NicModel {
        match model {
            0 => NicModel::Virtio,
            1 => NicModel::E1000,
            2 => NicModel::Rtl8139,
            _ => NicModel::Virtio,
        }
    }
    
    fn convert_firmware(firmware: i32) -> Firmware {
        match firmware {
            0 => Firmware::Bios,
            1 => Firmware::Uefi,
            _ => Firmware::Bios,
        }
    }
    
    fn convert_boot_device(device: i32) -> BootDevice {
        match device {
            0 => BootDevice::Disk,
            1 => BootDevice::Cdrom,
            2 => BootDevice::Network,
            _ => BootDevice::Disk,
        }
    }
}

#[tonic::async_trait]
impl NodeDaemonService for NodeDaemonServiceImpl {
    #[instrument(skip(self, _request))]
    async fn health_check(
        &self,
        _request: Request<HealthCheckRequest>,
    ) -> Result<Response<HealthCheckResponse>, Status> {
        debug!("Health check requested");
        
        let healthy = self.hypervisor.health_check().await
            .unwrap_or(false);
        
        let caps = self.hypervisor.capabilities().await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        let telemetry = self.telemetry.collect();
        
        Ok(Response::new(HealthCheckResponse {
            healthy,
            version: env!("CARGO_PKG_VERSION").to_string(),
            hypervisor: caps.name,
            hypervisor_version: caps.version,
            uptime_seconds: telemetry.system.uptime_seconds,
        }))
    }
    
    #[instrument(skip(self, _request))]
    async fn get_node_info(
        &self,
        _request: Request<()>,
    ) -> Result<Response<NodeInfoResponse>, Status> {
        debug!("Node info requested");
        
        let telemetry = self.telemetry.collect();
        let caps = self.hypervisor.capabilities().await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        Ok(Response::new(NodeInfoResponse {
            node_id: self.node_id.clone(),
            hostname: self.hostname.clone(),
            management_ip: self.management_ip.clone(),
            cpu_model: telemetry.cpu.model,
            cpu_cores: telemetry.cpu.logical_cores as u32,
            memory_total_bytes: telemetry.memory.total_bytes,
            memory_available_bytes: telemetry.memory.available_bytes,
            os_name: telemetry.system.os_name,
            os_version: telemetry.system.os_version,
            kernel_version: telemetry.system.kernel_version,
            uptime_seconds: telemetry.system.uptime_seconds,
            hypervisor_name: caps.name,
            hypervisor_version: caps.version,
            supports_live_migration: caps.supports_live_migration,
            supports_snapshots: caps.supports_snapshots,
            supports_hotplug: caps.supports_hotplug,
            max_vcpus: caps.max_vcpus,
            max_memory_bytes: caps.max_memory_bytes,
        }))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id, name = %request.get_ref().name))]
    async fn create_vm(
        &self,
        request: Request<CreateVmOnNodeRequest>,
    ) -> Result<Response<CreateVmOnNodeResponse>, Status> {
        info!("Creating VM via libvirt");
        
        let req = request.into_inner();
        
        // Validate that vm_id is a proper UUID (required by libvirt)
        let vm_uuid = if req.vm_id.is_empty() {
            // Generate a new UUID if not provided
            uuid::Uuid::new_v4().to_string()
        } else {
            // Validate the provided ID is a proper UUID
            uuid::Uuid::parse_str(&req.vm_id)
                .map_err(|_| Status::invalid_argument(format!(
                    "VM ID must be a valid UUID, got: {}", req.vm_id
                )))?
                .to_string()
        };
        
        // Extract spec from request (required field)
        let spec = req.spec.ok_or_else(|| Status::invalid_argument("VM spec is required"))?;
        
        // Build VM configuration from the nested spec structure
        let mut config = VmConfig::new(&req.name)
            .with_id(&vm_uuid);
        
        // Set Guest OS family - this affects hardware configuration (timers, CPU mode, video)
        // Must be set BEFORE other settings as it determines the base hardware profile
        if !spec.guest_os.is_empty() {
            use limiquantix_hypervisor::guest_os::GuestOSFamily;
            config.guest_os = match spec.guest_os.as_str() {
                "rhel" => GuestOSFamily::Rhel,
                "debian" => GuestOSFamily::Debian,
                "fedora" => GuestOSFamily::Fedora,
                "suse" => GuestOSFamily::Suse,
                "arch" => GuestOSFamily::Arch,
                "windows_server" => GuestOSFamily::WindowsServer,
                "windows_desktop" => GuestOSFamily::WindowsDesktop,
                "windows_legacy" => GuestOSFamily::WindowsLegacy,
                "freebsd" => GuestOSFamily::FreeBsd,
                "generic_linux" | _ => GuestOSFamily::GenericLinux,
            };
            info!(guest_os = %spec.guest_os, "Applied Guest OS profile");
        }
        
        // Set CPU configuration from spec
        config.cpu.cores = spec.cpu_cores;
        config.cpu.sockets = if spec.cpu_sockets > 0 { spec.cpu_sockets } else { 1 };
        config.cpu.threads_per_core = if spec.cpu_threads_per_core > 0 { spec.cpu_threads_per_core } else { 1 };
        
        // Set memory configuration from spec
        config.memory.size_mib = spec.memory_mib;
        
        // Set default boot configuration
        config.boot.firmware = Firmware::Bios;
        config.boot.order = vec![BootDevice::Disk, BootDevice::Cdrom, BootDevice::Network];
        
        // Process disks - create disk images if path not provided
        for (disk_index, disk_spec) in spec.disks.into_iter().enumerate() {
            let format = Self::convert_disk_format(disk_spec.format);
            
            // Check if backing file is specified (cloud image for copy-on-write)
            let backing_file = if disk_spec.backing_file.is_empty() {
                None
            } else {
                Some(disk_spec.backing_file.clone())
            };
            let has_backing_file = backing_file.is_some();
            
            // Generate disk ID if not provided
            let disk_id = if disk_spec.id.is_empty() {
                format!("disk{}", disk_index)
            } else {
                disk_spec.id.clone()
            };
            
            info!(
                vm_id = %vm_uuid,
                disk_index = disk_index,
                disk_id = %disk_id,
                disk_path = %disk_spec.path,
                size_gib = disk_spec.size_gib,
                backing_file = ?backing_file,
                "Processing disk spec"
            );
            
            let mut disk_config = DiskConfig {
                id: disk_id.clone(),
                path: disk_spec.path.clone(),
                size_gib: disk_spec.size_gib,
                bus: Self::convert_disk_bus(disk_spec.bus),
                format,
                readonly: disk_spec.readonly,
                bootable: disk_spec.bootable,
                backing_file: backing_file.clone(),
                ..Default::default()
            };
            
            // If no disk path provided, create a new disk image
            // Note: When using a backing file (cloud image), we MUST create an overlay even if size_gib is 0
            let needs_disk_creation = disk_spec.path.is_empty() && (disk_spec.size_gib > 0 || has_backing_file);
            
            info!(
                vm_id = %vm_uuid,
                disk_id = %disk_id,
                needs_creation = needs_disk_creation,
                path_empty = disk_spec.path.is_empty(),
                size_gib = disk_spec.size_gib,
                has_backing_file = has_backing_file,
                "Disk creation check"
            );
            
            if needs_disk_creation {
                // Determine storage path - use pool_id if specified, otherwise fall back to default
                let base_path = if !disk_spec.pool_id.is_empty() {
                    // Look up the storage pool to get its mount path
                    let pools = self.storage.list_pools().await;
                    let pool = pools.iter().find(|p| p.pool_id == disk_spec.pool_id);
                    
                    if let Some(pool_info) = pool {
                        if let Some(mount_path) = &pool_info.mount_path {
                            info!(
                                vm_id = %vm_uuid,
                                pool_id = %disk_spec.pool_id,
                                mount_path = %mount_path,
                                "Using storage pool for disk creation"
                            );
                            std::path::PathBuf::from(mount_path)
                        } else {
                            error!(
                                vm_id = %vm_uuid,
                                pool_id = %disk_spec.pool_id,
                                "Storage pool has no mount path"
                            );
                            return Err(Status::failed_precondition(format!(
                                "Storage pool '{}' has no mount path configured",
                                disk_spec.pool_id
                            )));
                        }
                    } else {
                        error!(
                            vm_id = %vm_uuid,
                            pool_id = %disk_spec.pool_id,
                            "Storage pool not found"
                        );
                        return Err(Status::not_found(format!(
                            "Storage pool '{}' not found. Available pools: {:?}",
                            disk_spec.pool_id,
                            pools.iter().map(|p| &p.pool_id).collect::<Vec<_>>()
                        )));
                    }
                } else {
                    // Fall back to default path (should ideally require pool_id)
                    warn!(
                        vm_id = %vm_uuid,
                        "No storage pool specified for disk, using default path /data/limiquantix/vms"
                    );
                    std::path::PathBuf::from("/data/limiquantix/vms")
                };
                
                // Create VM directory within the storage path
                // Use format: {VM_NAME}_{UUID_SHORT} for human-readable folder names
                let uuid_short = if vm_uuid.len() >= 8 { &vm_uuid[..8] } else { &vm_uuid };
                let safe_name = sanitize_filename(&req.name);
                let folder_name = format!("{}_{}", safe_name, uuid_short);
                let vm_dir = base_path.join("vms").join(&folder_name);
                
                info!(
                    vm_id = %vm_uuid,
                    folder_name = %folder_name,
                    vm_dir = %vm_dir.display(),
                    "Creating VM directory with human-readable name"
                );
                
                if let Err(e) = std::fs::create_dir_all(&vm_dir) {
                    error!(vm_id = %vm_uuid, error = %e, path = ?vm_dir, "Failed to create VM directory");
                    return Err(Status::internal(format!("Failed to create VM directory: {}", e)));
                }
                
                let disk_path = vm_dir.join(format!("{}.qcow2", disk_id));
                disk_config.path = disk_path.to_string_lossy().to_string();
                
                // Use qemu-img to create disk
                let mut cmd = std::process::Command::new("qemu-img");
                cmd.arg("create").arg("-f").arg("qcow2");
                
                // If backing file is specified, create a copy-on-write overlay
                if let Some(ref bf) = backing_file {
                    // Verify the backing file exists before trying to use it
                    let backing_path = std::path::Path::new(bf);
                    if !backing_path.exists() {
                        error!(
                            vm_id = %vm_uuid,
                            backing_file = %bf,
                            "Backing file (cloud image) does not exist"
                        );
                        return Err(Status::failed_precondition(format!(
                            "Cloud image not found: {}. Download it with: setup-cloud-images.sh ubuntu-22.04",
                            bf
                        )));
                    }
                    
                    info!(
                        vm_id = %vm_uuid,
                        disk_id = %disk_id,
                        backing_file = %bf,
                        "Creating disk with backing file (cloud image)"
                    );
                    cmd.arg("-b").arg(bf);
                    cmd.arg("-F").arg("qcow2"); // Backing file format
                } else {
                    info!(
                        vm_id = %vm_uuid,
                        disk_id = %disk_id,
                        size_gib = disk_spec.size_gib,
                        "Creating empty disk image"
                    );
                }
                
                cmd.arg(&disk_path);
                
                // Only specify size if no backing file (overlay inherits size)
                if !has_backing_file {
                    cmd.arg(format!("{}G", disk_spec.size_gib));
                }
                
                // Log the full command for debugging
                debug!(
                    vm_id = %vm_uuid,
                    command = ?cmd,
                    "Executing qemu-img command"
                );
                
                match cmd.output() {
                    Ok(output) if output.status.success() => {
                        info!(
                            vm_id = %vm_uuid,
                            disk_id = %disk_id,
                            path = %disk_path.display(),
                            has_backing_file = has_backing_file,
                            "Disk image created successfully"
                        );
                    }
                    Ok(output) => {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        error!(
                            vm_id = %vm_uuid,
                            disk_id = %disk_id,
                            error = %stderr,
                            "Failed to create disk image"
                        );
                        return Err(Status::internal(format!("Failed to create disk image: {}", stderr)));
                    }
                    Err(e) => {
                        error!(
                            vm_id = %vm_uuid,
                            disk_id = %disk_id,
                            error = %e,
                            "Failed to run qemu-img"
                        );
                        return Err(Status::internal(format!("Failed to create disk image: {}", e)));
                    }
                }
            }
            
            config.disks.push(disk_config);
        }
        
        // Process NICs
        for nic_spec in spec.nics {
            // Determine bridge vs network mode
            // If the network name looks like a mock ID (starts with "net-" or is a UUID),
            // fall back to the default libvirt "default" network or virbr0 bridge
            let (bridge, network) = if !nic_spec.bridge.is_empty() {
                // Explicit bridge specified
                (Some(nic_spec.bridge.clone()), None)
            } else if !nic_spec.network.is_empty() {
                // Check if it's a mock/unknown network
                let net_name = &nic_spec.network;
                if net_name.starts_with("net-") || net_name.contains('-') && net_name.len() > 30 {
                    // Looks like a mock network ID or UUID - use default libvirt network
                    info!(
                        nic_id = %nic_spec.id,
                        requested_network = %net_name,
                        "Using 'default' libvirt network (requested network not available locally)"
                    );
                    (None, Some("default".to_string()))
                } else {
                    // Use the provided network name (could be "default", "isolated", etc.)
                    (None, Some(net_name.clone()))
                }
            } else {
                // No bridge or network specified - use default virbr0 bridge
                (Some("virbr0".to_string()), None)
            };
            
            let nic_config = NicConfig {
                id: nic_spec.id,
                mac_address: if nic_spec.mac_address.is_empty() { None } else { Some(nic_spec.mac_address) },
                bridge,
                network,
                model: Self::convert_nic_model(nic_spec.model),
                ovn_port_name: None,
                ovs_bridge: None,
            };
            config.nics.push(nic_config);
        }
        
        // If no NICs specified, add a default one connected to the default libvirt network
        if config.nics.is_empty() {
            config.nics.push(NicConfig {
                id: "nic0".to_string(),
                mac_address: None,
                bridge: None,
                network: Some("default".to_string()),
                model: NicModel::Virtio,
                ovn_port_name: None,
                ovs_bridge: None,
            });
        }
        
        // Set console configuration - use defaults (VNC enabled)
        config.console.vnc_enabled = true;
        config.console.spice_enabled = false;
        
        // ============================================================
        // CLOUD-INIT CONFIGURATION PROCESSING
        // ============================================================
        // This section handles cloud-init data passed from the control plane.
        // Cloud-init is used to configure VMs on first boot (password, SSH keys, timezone, etc.)
        
        // Check if we have cloud-init config from the request OR a cloud image
        let has_cloud_image = config.disks.iter().any(|d| d.backing_file.is_some());
        let has_cloud_init_config = spec.cloud_init.as_ref()
            .map(|ci| !ci.user_data.is_empty() || !ci.meta_data.is_empty())
            .unwrap_or(false);
        
        // Log the cloud-init detection results
        debug!(
            vm_id = %vm_uuid,
            vm_name = %req.name,
            has_cloud_image = has_cloud_image,
            has_cloud_init_config = has_cloud_init_config,
            cloud_init_present_in_request = spec.cloud_init.is_some(),
            "Cloud-init detection: checking if cloud-init ISO generation is needed"
        );
        
        // Generate cloud-init ISO if we have config from request OR a cloud image
        if has_cloud_init_config || has_cloud_image {
            info!(
                vm_id = %vm_uuid,
                has_cloud_init_config = has_cloud_init_config,
                has_cloud_image = has_cloud_image,
                "Generating cloud-init ISO for VM"
            );
            
            // Build CloudInitConfig from request or use defaults
            let ci_config = if let Some(ref cloud_init) = spec.cloud_init {
                // Use cloud-init config from the control plane (includes password, SSH keys, etc.)
                let user_data_preview = if cloud_init.user_data.len() > 200 {
                    format!("{}...[truncated, total {} bytes]", &cloud_init.user_data[..200], cloud_init.user_data.len())
                } else {
                    cloud_init.user_data.clone()
                };
                
                info!(
                    vm_id = %vm_uuid,
                    user_data_len = cloud_init.user_data.len(),
                    meta_data_len = cloud_init.meta_data.len(),
                    "Using cloud-init config from control plane"
                );
                
                // Debug log: Show user-data content (useful for troubleshooting)
                // This helps verify that password/SSH keys are actually being passed
                debug!(
                    vm_id = %vm_uuid,
                    user_data_preview = %user_data_preview,
                    "Cloud-init user-data content preview (check for password/ssh_authorized_keys)"
                );
                
                // Check for common cloud-init fields to help with debugging
                let has_password = cloud_init.user_data.contains("password:") || cloud_init.user_data.contains("passwd:");
                let has_ssh_keys = cloud_init.user_data.contains("ssh_authorized_keys") || cloud_init.user_data.contains("ssh-rsa") || cloud_init.user_data.contains("ssh-ed25519");
                let has_timezone = cloud_init.user_data.contains("timezone:");
                let has_hostname = cloud_init.user_data.contains("hostname:");
                let has_users = cloud_init.user_data.contains("users:");
                
                debug!(
                    vm_id = %vm_uuid,
                    has_password = has_password,
                    has_ssh_keys = has_ssh_keys,
                    has_timezone = has_timezone,
                    has_hostname = has_hostname,
                    has_users = has_users,
                    "Cloud-init user-data field detection (verify expected fields are present)"
                );
                
                if !has_password && !has_ssh_keys {
                    warn!(
                        vm_id = %vm_uuid,
                        "Cloud-init user-data does NOT contain password or SSH keys - VM may be inaccessible!"
                    );
                }
                
                CloudInitConfig::new(&vm_uuid, &req.name)
                    .with_user_data(&cloud_init.user_data)
            } else {
                // Generate minimal default config for cloud images without explicit cloud-init
                warn!(
                    vm_id = %vm_uuid,
                    vm_name = %req.name,
                    "No cloud-init config in request - generating DEFAULT config. \
                     This means password/SSH keys from the wizard were NOT received!"
                );
                info!(
                    vm_id = %vm_uuid,
                    "Generating default cloud-init config for cloud image (no access credentials)"
                );
                CloudInitConfig::new(&vm_uuid, &req.name)
            };
            
            let vm_dir = std::path::PathBuf::from("/var/lib/limiquantix/vms").join(&vm_uuid);
            let generator = CloudInitGenerator::new();
            
            match generator.generate_iso(&ci_config, &vm_dir) {
                Ok(iso_path) => {
                    info!(
                        vm_id = %vm_uuid,
                        iso_path = %iso_path.display(),
                        vm_dir = %vm_dir.display(),
                        "Cloud-init ISO generated successfully"
                    );
                    
                    // Log the ISO file size for verification
                    if let Ok(metadata) = std::fs::metadata(&iso_path) {
                        debug!(
                            vm_id = %vm_uuid,
                            iso_size_bytes = metadata.len(),
                            "Cloud-init ISO file size"
                        );
                    }
                    
                    // Log the user-data and meta-data files if they exist (for debugging)
                    let user_data_path = vm_dir.join("cloud-init").join("user-data");
                    let meta_data_path = vm_dir.join("cloud-init").join("meta-data");
                    
                    if user_data_path.exists() {
                        if let Ok(content) = std::fs::read_to_string(&user_data_path) {
                            let preview = if content.len() > 500 {
                                format!("{}...[truncated]", &content[..500])
                            } else {
                                content.clone()
                            };
                            debug!(
                                vm_id = %vm_uuid,
                                user_data_file = %user_data_path.display(),
                                content_len = content.len(),
                                content_preview = %preview,
                                "Cloud-init user-data file written to disk"
                            );
                        }
                    }
                    
                    if meta_data_path.exists() {
                        if let Ok(content) = std::fs::read_to_string(&meta_data_path) {
                            debug!(
                                vm_id = %vm_uuid,
                                meta_data_file = %meta_data_path.display(),
                                content = %content,
                                "Cloud-init meta-data file written to disk"
                            );
                        }
                    }
                    
                    config.cdroms.push(CdromConfig {
                        id: "cloud-init".to_string(),
                        iso_path: Some(iso_path.to_string_lossy().to_string()),
                        bootable: false,
                    });
                    
                    info!(
                        vm_id = %vm_uuid,
                        cdrom_id = "cloud-init",
                        "Cloud-init ISO attached as CD-ROM"
                    );
                }
                Err(e) => {
                    error!(
                        vm_id = %vm_uuid,
                        error = %e,
                        vm_dir = %vm_dir.display(),
                        "Failed to generate cloud-init ISO - VM will boot without cloud-init configuration!"
                    );
                    warn!(
                        vm_id = %vm_uuid,
                        "Cloud-init ISO generation failed. Check: \
                         1) genisoimage/mkisofs is installed, \
                         2) VM directory is writable, \
                         3) Disk space is available"
                    );
                    // Don't fail the VM creation, just warn
                }
            }
        } else {
            // No cloud-init needed - log why
            debug!(
                vm_id = %vm_uuid,
                has_cloud_image = has_cloud_image,
                has_cloud_init_config = has_cloud_init_config,
                "Skipping cloud-init ISO generation - no cloud image or cloud-init config"
            );
        }
        
        // Process CD-ROMs from the request
        let mut has_bootable_cdrom = false;
        for cdrom_spec in spec.cdroms {
            if cdrom_spec.bootable {
                has_bootable_cdrom = true;
            }
            
            info!(
                vm_id = %vm_uuid,
                cdrom_id = %cdrom_spec.id,
                iso_path = %cdrom_spec.iso_path,
                bootable = cdrom_spec.bootable,
                "Processing CD-ROM spec"
            );
            
            config.cdroms.push(CdromConfig {
                id: if cdrom_spec.id.is_empty() { 
                    format!("cdrom-{}", config.cdroms.len()) 
                } else { 
                    cdrom_spec.id 
                },
                iso_path: if cdrom_spec.iso_path.is_empty() { 
                    None 
                } else { 
                    Some(cdrom_spec.iso_path) 
                },
                bootable: cdrom_spec.bootable,
            });
        }
        
        // If a bootable CD-ROM is present, adjust boot order to prioritize CD-ROM
        if has_bootable_cdrom {
            info!(
                vm_id = %vm_uuid,
                "Bootable CD-ROM detected, setting boot order to CD-ROM first"
            );
            config.boot.order = vec![BootDevice::Cdrom, BootDevice::Disk, BootDevice::Network];
        }
        
        // Create the VM via the hypervisor backend
        // Ensure the agent socket directory exists before creating the VM
        // This is required because libvirt will try to bind the virtio-serial socket
        let socket_dir = std::path::PathBuf::from("/var/run/limiquantix/vms");
        if let Err(e) = std::fs::create_dir_all(&socket_dir) {
            error!(error = %e, "Failed to create agent socket directory");
            return Err(Status::internal(format!("Failed to create agent socket directory: {}", e)));
        }
        debug!(path = %socket_dir.display(), "Ensured agent socket directory exists");
        
        info!(
            vm_id = %vm_uuid,
            vm_name = %req.name,
            cpu_cores = config.cpu.total_vcpus(),
            memory_mib = config.memory.size_mib,
            disk_count = config.disks.len(),
            cdrom_count = config.cdroms.len(),
            nic_count = config.nics.len(),
            "Creating VM in hypervisor"
        );
        
        match self.hypervisor.create_vm(config).await {
            Ok(created_id) => {
                info!(vm_id = %created_id, "VM created successfully in libvirt");
                
                // Trigger immediate state watcher poll to push update to control plane
                self.trigger_immediate_poll().await;
                
                Ok(Response::new(CreateVmOnNodeResponse {
                    vm_id: created_id,
                    created: true,
                    message: "VM created successfully".to_string(),
                }))
            }
            Err(e) => {
                error!(vm_id = %vm_uuid, error = %e, "Failed to create VM in hypervisor");
                Err(Status::internal(format!("Failed to create VM: {}", e)))
            }
        }
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn start_vm(
        &self,
        request: Request<VmIdRequest>,
    ) -> Result<Response<()>, Status> {
        info!("Starting VM");
        
        let vm_id = &request.into_inner().vm_id;
        
        // Ensure the agent socket directory exists before starting the VM
        // This directory is in /var/run which may be cleared on reboot
        let socket_dir = std::path::PathBuf::from("/var/run/limiquantix/vms");
        if let Err(e) = std::fs::create_dir_all(&socket_dir) {
            error!(error = %e, "Failed to create agent socket directory");
            return Err(Status::internal(format!("Failed to create agent socket directory: {}", e)));
        }
        
        self.hypervisor.start_vm(vm_id).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        // Trigger immediate state watcher poll to push update to control plane
        self.trigger_immediate_poll().await;
        
        info!("VM started");
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn stop_vm(
        &self,
        request: Request<StopVmRequest>,
    ) -> Result<Response<()>, Status> {
        info!("Stopping VM");
        
        let req = request.into_inner();
        let timeout = Duration::from_secs(req.timeout_seconds as u64);
        
        self.hypervisor.stop_vm(&req.vm_id, timeout).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        // Trigger immediate state watcher poll to push update to control plane
        self.trigger_immediate_poll().await;
        
        info!("VM stopped");
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn force_stop_vm(
        &self,
        request: Request<VmIdRequest>,
    ) -> Result<Response<()>, Status> {
        info!("Force stopping VM");
        
        let vm_id = &request.into_inner().vm_id;
        self.hypervisor.force_stop_vm(vm_id).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        // Trigger immediate state watcher poll to push update to control plane
        self.trigger_immediate_poll().await;
        
        info!("VM force stopped");
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn reboot_vm(
        &self,
        request: Request<VmIdRequest>,
    ) -> Result<Response<()>, Status> {
        info!("Rebooting VM");
        
        let vm_id = &request.into_inner().vm_id;
        self.hypervisor.reboot_vm(vm_id).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        info!("VM rebooted");
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn pause_vm(
        &self,
        request: Request<VmIdRequest>,
    ) -> Result<Response<()>, Status> {
        info!("Pausing VM");
        
        let vm_id = &request.into_inner().vm_id;
        self.hypervisor.pause_vm(vm_id).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        info!("VM paused");
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn resume_vm(
        &self,
        request: Request<VmIdRequest>,
    ) -> Result<Response<()>, Status> {
        info!("Resuming VM");
        
        let vm_id = &request.into_inner().vm_id;
        self.hypervisor.resume_vm(vm_id).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        info!("VM resumed");
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn delete_vm(
        &self,
        request: Request<VmIdRequest>,
    ) -> Result<Response<()>, Status> {
        info!("Deleting VM");
        
        let vm_id = &request.into_inner().vm_id;
        
        // Delete from hypervisor
        self.hypervisor.delete_vm(vm_id).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        // Delete disk images (best effort)
        let vm_dir = std::path::PathBuf::from("/var/lib/limiquantix/vms").join(vm_id);
        if vm_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&vm_dir) {
                warn!(vm_id = %vm_id, error = %e, "Failed to delete VM disk images");
            }
        }
        
        // Trigger immediate state watcher poll to push update to control plane
        self.trigger_immediate_poll().await;
        
        info!("VM deleted");
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn get_vm_status(
        &self,
        request: Request<VmIdRequest>,
    ) -> Result<Response<VmStatusResponse>, Status> {
        let vm_id = &request.into_inner().vm_id;
        
        let status = self.hypervisor.get_vm_status(vm_id).await
            .map_err(|e| Status::not_found(e.to_string()))?;
        
        // Try to get guest agent info
        let guest_agent = self.get_agent_info(vm_id).await;
        
        // If VM is running, try to connect to agent if not already connected
        if status.state == VmState::Running && guest_agent.is_none() {
            let _ = self.get_agent_client(vm_id).await;
        }
        
        Ok(Response::new(VmStatusResponse {
            vm_id: status.id,
            name: status.name,
            state: Self::map_vm_state(status.state),
            cpu_usage_percent: guest_agent.as_ref()
                .and_then(|a| a.resource_usage.as_ref())
                .map(|r| r.cpu_usage_percent)
                .unwrap_or(0.0),
            memory_used_bytes: guest_agent.as_ref()
                .and_then(|a| a.resource_usage.as_ref())
                .map(|r| r.memory_used_bytes)
                .unwrap_or(status.memory_rss_bytes),
            memory_total_bytes: status.memory_max_bytes,
            started_at: None,
            guest_agent,
            disks: status.disks.into_iter().map(|d| DiskSpec {
                id: d.id,
                path: d.path,
                size_gib: d.size_gib,
                bus: match d.bus {
                    limiquantix_hypervisor::DiskBus::Virtio => limiquantix_proto::DiskBus::Virtio.into(),
                    limiquantix_hypervisor::DiskBus::Scsi => limiquantix_proto::DiskBus::Scsi.into(),
                    limiquantix_hypervisor::DiskBus::Sata => limiquantix_proto::DiskBus::Sata.into(),
                    limiquantix_hypervisor::DiskBus::Ide => limiquantix_proto::DiskBus::Ide.into(),
                },
                format: match d.format {
                    limiquantix_hypervisor::DiskFormat::Qcow2 => limiquantix_proto::DiskFormat::Qcow2.into(),
                    limiquantix_hypervisor::DiskFormat::Raw => limiquantix_proto::DiskFormat::Raw.into(),
                    limiquantix_hypervisor::DiskFormat::Vmdk => limiquantix_proto::DiskFormat::Qcow2.into(),
                },
                readonly: d.readonly,
                bootable: d.bootable,
                iops_limit: 0,
                throughput_mbps: 0,
                backing_file: d.backing_file.unwrap_or_default(),
                pool_id: String::new(), // Pool ID not tracked for existing VMs
            }).collect(),
        }))
    }
    
    #[instrument(skip(self, _request))]
    async fn list_v_ms(
        &self,
        _request: Request<()>,
    ) -> Result<Response<ListVMsOnNodeResponse>, Status> {
        let vms = self.hypervisor.list_vms().await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        let responses: Vec<VmStatusResponse> = vms.into_iter().map(|vm| {
            VmStatusResponse {
                vm_id: vm.id,
                name: vm.name,
                state: Self::map_vm_state(vm.state),
                cpu_usage_percent: 0.0,
                memory_used_bytes: 0,
                memory_total_bytes: 0,
                started_at: None,
                guest_agent: None,
                disks: vec![],
            }
        }).collect();
        
        debug!(count = responses.len(), "Listed VMs");
        
        Ok(Response::new(ListVMsOnNodeResponse { vms: responses }))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn get_console(
        &self,
        request: Request<VmIdRequest>,
    ) -> Result<Response<ConsoleInfoResponse>, Status> {
        let vm_id = &request.into_inner().vm_id;
        
        let console = self.hypervisor.get_console(vm_id).await
            .map_err(|e| Status::not_found(e.to_string()))?;
        
        // Use the node's management IP instead of localhost
        // This allows remote clients to connect to the VNC console
        let host = if console.host == "127.0.0.1" || console.host == "localhost" {
            self.management_ip.clone()
        } else {
            console.host
        };
        
        info!(host = %host, port = console.port, "Returning console info");
        
        Ok(Response::new(ConsoleInfoResponse {
            console_type: match console.console_type {
                limiquantix_hypervisor::ConsoleType::Vnc => "vnc".to_string(),
                limiquantix_hypervisor::ConsoleType::Spice => "spice".to_string(),
            },
            host,
            port: console.port as u32,
            password: console.password.unwrap_or_default(),
            websocket_path: console.websocket_path.unwrap_or_default(),
        }))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn get_vm_logs(
        &self,
        request: Request<GetVmLogsRequest>,
    ) -> Result<Response<GetVmLogsResponse>, Status> {
        use tokio::fs;
        use tokio::io::{AsyncBufReadExt, BufReader};
        
        let req = request.into_inner();
        let vm_id = &req.vm_id;
        let max_lines = if req.lines == 0 { 100 } else { req.lines.min(1000) } as usize;
        
        // Get the VM to find its name by listing all VMs and finding by ID or name
        let vms = self.hypervisor.list_vms().await
            .map_err(|e| Status::internal(format!("Failed to list VMs: {}", e)))?;
        
        let vm = vms.iter()
            .find(|v| v.id == *vm_id || v.name == *vm_id)
            .ok_or_else(|| Status::not_found(format!("VM not found: {}", vm_id)))?;
        
        let vm_name = &vm.name;
        let log_path = format!("/var/log/libvirt/qemu/{}.log", vm_name);
        
        // Check if log file exists
        let metadata = match fs::metadata(&log_path).await {
            Ok(m) => m,
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    return Ok(Response::new(GetVmLogsResponse {
                        vm_id: vm_id.clone(),
                        vm_name: vm_name.clone(),
                        qemu_log: String::new(),
                        log_path,
                        log_size_bytes: 0,
                        lines_returned: 0,
                        truncated: false,
                        last_modified: String::new(),
                    }));
                }
                return Err(Status::internal(format!("Failed to read log metadata: {}", e)));
            }
        };
        
        let log_size_bytes = metadata.len();
        let last_modified = metadata.modified().ok().map(|t| {
            chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339()
        }).unwrap_or_default();
        
        // Read the log file
        let file = fs::File::open(&log_path).await
            .map_err(|e| Status::internal(format!("Failed to open log file: {}", e)))?;
        
        // Read all lines and keep the last N
        let reader = BufReader::new(file);
        let mut lines_iter = reader.lines();
        let mut all_lines: Vec<String> = Vec::new();
        
        while let Ok(Some(line)) = lines_iter.next_line().await {
            all_lines.push(line);
        }
        
        let total_lines = all_lines.len();
        let truncated = total_lines > max_lines;
        
        // Take the last N lines
        let lines: Vec<String> = if truncated {
            all_lines.into_iter().skip(total_lines - max_lines).collect()
        } else {
            all_lines
        };
        
        let lines_returned = lines.len() as u32;
        let qemu_log = lines.join("\n");
        
        info!(
            vm_id = %vm_id,
            vm_name = %vm_name,
            log_path = %log_path,
            log_size_bytes = log_size_bytes,
            lines_returned = lines_returned,
            truncated = truncated,
            "Retrieved VM QEMU logs via gRPC"
        );
        
        Ok(Response::new(GetVmLogsResponse {
            vm_id: vm_id.clone(),
            vm_name: vm_name.clone(),
            qemu_log,
            log_path,
            log_size_bytes,
            lines_returned,
            truncated,
            last_modified,
        }))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id, name = %request.get_ref().name))]
    async fn create_snapshot(
        &self,
        request: Request<CreateSnapshotRequest>,
    ) -> Result<Response<SnapshotResponse>, Status> {
        info!("Creating snapshot");
        
        let req = request.into_inner();
        
        let snapshot = self.hypervisor.create_snapshot(&req.vm_id, &req.name, &req.description).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        info!(snapshot_id = %snapshot.id, "Snapshot created");
        
        Ok(Response::new(SnapshotResponse {
            snapshot_id: snapshot.id,
            name: snapshot.name,
            description: snapshot.description,
            created_at: Some(prost_types::Timestamp {
                seconds: snapshot.created_at.timestamp(),
                nanos: snapshot.created_at.timestamp_subsec_nanos() as i32,
            }),
            vm_state: Self::map_vm_state(snapshot.vm_state),
            parent_id: snapshot.parent_id.unwrap_or_default(),
        }))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id, snapshot_id = %request.get_ref().snapshot_id))]
    async fn revert_snapshot(
        &self,
        request: Request<RevertSnapshotRequest>,
    ) -> Result<Response<()>, Status> {
        info!("Reverting to snapshot");
        
        let req = request.into_inner();
        
        self.hypervisor.revert_snapshot(&req.vm_id, &req.snapshot_id).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        info!("Reverted to snapshot");
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id, snapshot_id = %request.get_ref().snapshot_id))]
    async fn delete_snapshot(
        &self,
        request: Request<DeleteSnapshotRequest>,
    ) -> Result<Response<()>, Status> {
        info!("Deleting snapshot");
        
        let req = request.into_inner();
        
        self.hypervisor.delete_snapshot(&req.vm_id, &req.snapshot_id).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        info!("Snapshot deleted");
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn list_snapshots(
        &self,
        request: Request<VmIdRequest>,
    ) -> Result<Response<ListSnapshotsResponse>, Status> {
        let vm_id = &request.into_inner().vm_id;
        
        let snapshots = self.hypervisor.list_snapshots(vm_id).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        let responses: Vec<SnapshotResponse> = snapshots.into_iter().map(|s| {
            SnapshotResponse {
                snapshot_id: s.id,
                name: s.name,
                description: s.description,
                created_at: Some(prost_types::Timestamp {
                    seconds: s.created_at.timestamp(),
                    nanos: s.created_at.timestamp_subsec_nanos() as i32,
                }),
                vm_state: Self::map_vm_state(s.vm_state),
                parent_id: s.parent_id.unwrap_or_default(),
            }
        }).collect();
        
        Ok(Response::new(ListSnapshotsResponse { snapshots: responses }))
    }
    
    type StreamMetricsStream = Pin<Box<dyn Stream<Item = Result<NodeMetrics, Status>> + Send>>;
    
    #[instrument(skip(self, request))]
    async fn stream_metrics(
        &self,
        request: Request<StreamMetricsRequest>,
    ) -> Result<Response<Self::StreamMetricsStream>, Status> {
        let interval_secs = request.into_inner().interval_seconds.max(1);
        
        let (tx, rx) = mpsc::channel(10);
        let telemetry = self.telemetry.clone();
        let hypervisor = self.hypervisor.clone();
        
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(interval_secs as u64));
            
            loop {
                interval.tick().await;
                
                let node_telemetry = telemetry.collect();
                
                // Get VM metrics
                let vms = hypervisor.list_vms().await.unwrap_or_default();
                let vm_metrics: Vec<limiquantix_proto::VmMetrics> = vms.into_iter().map(|vm| {
                    limiquantix_proto::VmMetrics {
                        vm_id: vm.id,
                        name: vm.name,
                        cpu_usage_percent: 0.0,
                        memory_used_bytes: 0,
                        disk_read_bytes: 0,
                        disk_write_bytes: 0,
                        network_rx_bytes: 0,
                        network_tx_bytes: 0,
                    }
                }).collect();
                
                let metrics = NodeMetrics {
                    timestamp: Some(prost_types::Timestamp {
                        seconds: chrono::Utc::now().timestamp(),
                        nanos: 0,
                    }),
                    cpu_usage_percent: node_telemetry.cpu.usage_percent as f64,
                    memory_used_bytes: node_telemetry.memory.used_bytes,
                    memory_total_bytes: node_telemetry.memory.total_bytes,
                    vms: vm_metrics,
                };
                
                if tx.send(Ok(metrics)).await.is_err() {
                    break;
                }
            }
        });
        
        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }
    
    type StreamEventsStream = Pin<Box<dyn Stream<Item = Result<NodeEvent, Status>> + Send>>;
    
    #[instrument(skip(self, _request))]
    async fn stream_events(
        &self,
        _request: Request<()>,
    ) -> Result<Response<Self::StreamEventsStream>, Status> {
        let (tx, rx) = mpsc::channel(100);
        
        // For now, just keep the channel open
        // In a real implementation, we'd hook into hypervisor events
        tokio::spawn(async move {
            // Keep the sender alive
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                
                // Send a heartbeat event
                let event = NodeEvent {
                    id: uuid::Uuid::new_v4().to_string(),
                    timestamp: Some(prost_types::Timestamp {
                        seconds: chrono::Utc::now().timestamp(),
                        nanos: 0,
                    }),
                    r#type: 0, // Unknown/heartbeat
                    vm_id: String::new(),
                    message: "Node heartbeat".to_string(),
                    metadata: std::collections::HashMap::new(),
                };
                
                if tx.send(Ok(event)).await.is_err() {
                    break;
                }
            }
        });
        
        Ok(Response::new(Box::pin(ReceiverStream::new(rx))))
    }
    
    // =========================================================================
    // Guest Agent Operations
    // =========================================================================
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn ping_agent(
        &self,
        request: Request<VmIdRequest>,
    ) -> Result<Response<AgentPingResponse>, Status> {
        let vm_id = &request.into_inner().vm_id;
        debug!("Pinging guest agent");
        
        // Try to connect/get agent client
        if let Err(e) = self.get_agent_client(vm_id).await {
            return Ok(Response::new(AgentPingResponse {
                connected: false,
                version: String::new(),
                uptime_seconds: 0,
                error: e.message().to_string(),
            }));
        }
        
        let agents = self.agent_manager.read().await;
        if let Some(client) = agents.get(vm_id) {
            match client.ping().await {
                Ok(pong) => {
                    info!(vm_id = %vm_id, version = %pong.version, "Agent ping successful");
                    Ok(Response::new(AgentPingResponse {
                        connected: true,
                        version: pong.version,
                        uptime_seconds: pong.uptime_seconds,
                        error: String::new(),
                    }))
                }
                Err(e) => {
                    warn!(vm_id = %vm_id, error = %e, "Agent ping failed");
                    Ok(Response::new(AgentPingResponse {
                        connected: false,
                        version: String::new(),
                        uptime_seconds: 0,
                        error: e.to_string(),
                    }))
                }
            }
        } else {
            Ok(Response::new(AgentPingResponse {
                connected: false,
                version: String::new(),
                uptime_seconds: 0,
                error: "Agent not connected".to_string(),
            }))
        }
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn execute_in_guest(
        &self,
        request: Request<ExecuteInGuestRequest>,
    ) -> Result<Response<ExecuteInGuestResponse>, Status> {
        let req = request.into_inner();
        info!(vm_id = %req.vm_id, command = %req.command, "Executing command in guest");
        
        // Ensure agent is connected
        self.get_agent_client(&req.vm_id).await?;
        
        let agents = self.agent_manager.read().await;
        let client = agents.get(&req.vm_id)
            .ok_or_else(|| Status::unavailable("Agent not connected"))?;
        
        // Execute the command
        let timeout = if req.timeout_seconds > 0 { req.timeout_seconds } else { 60 };
        
        match client.execute(&req.command, timeout).await {
            Ok(response) => {
                info!(
                    vm_id = %req.vm_id,
                    exit_code = response.exit_code,
                    duration_ms = response.duration_ms,
                    "Command executed successfully"
                );
                Ok(Response::new(ExecuteInGuestResponse {
                    success: response.exit_code == 0,
                    exit_code: response.exit_code,
                    stdout: response.stdout,
                    stderr: response.stderr,
                    timed_out: response.timed_out,
                    duration_ms: response.duration_ms,
                    error: response.error,
                }))
            }
            Err(e) => {
                error!(vm_id = %req.vm_id, error = %e, "Command execution failed");
                Ok(Response::new(ExecuteInGuestResponse {
                    success: false,
                    exit_code: -1,
                    stdout: String::new(),
                    stderr: String::new(),
                    timed_out: false,
                    duration_ms: 0,
                    error: e.to_string(),
                }))
            }
        }
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id, path = %request.get_ref().path))]
    async fn read_guest_file(
        &self,
        request: Request<ReadGuestFileRequest>,
    ) -> Result<Response<ReadGuestFileResponse>, Status> {
        let req = request.into_inner();
        info!(vm_id = %req.vm_id, path = %req.path, "Reading file from guest");
        
        // Ensure agent is connected
        self.get_agent_client(&req.vm_id).await?;
        
        let agents = self.agent_manager.read().await;
        let client = agents.get(&req.vm_id)
            .ok_or_else(|| Status::unavailable("Agent not connected"))?;
        
        match client.read_file(&req.path).await {
            Ok(data) => {
                let total_size = data.len() as u64;
                info!(vm_id = %req.vm_id, path = %req.path, size = total_size, "File read successfully");
                Ok(Response::new(ReadGuestFileResponse {
                    success: true,
                    data,
                    total_size,
                    eof: true,
                    error: String::new(),
                }))
            }
            Err(e) => {
                error!(vm_id = %req.vm_id, path = %req.path, error = %e, "File read failed");
                Ok(Response::new(ReadGuestFileResponse {
                    success: false,
                    data: Vec::new(),
                    total_size: 0,
                    eof: true,
                    error: e.to_string(),
                }))
            }
        }
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id, path = %request.get_ref().path))]
    async fn write_guest_file(
        &self,
        request: Request<WriteGuestFileRequest>,
    ) -> Result<Response<WriteGuestFileResponse>, Status> {
        let req = request.into_inner();
        info!(vm_id = %req.vm_id, path = %req.path, size = req.data.len(), "Writing file to guest");
        
        // Ensure agent is connected
        self.get_agent_client(&req.vm_id).await?;
        
        let agents = self.agent_manager.read().await;
        let client = agents.get(&req.vm_id)
            .ok_or_else(|| Status::unavailable("Agent not connected"))?;
        
        match client.write_file(&req.path, &req.data, req.mode).await {
            Ok(()) => {
                info!(vm_id = %req.vm_id, path = %req.path, "File written successfully");
                Ok(Response::new(WriteGuestFileResponse {
                    success: true,
                    bytes_written: req.data.len() as u64,
                    error: String::new(),
                }))
            }
            Err(e) => {
                error!(vm_id = %req.vm_id, path = %req.path, error = %e, "File write failed");
                Ok(Response::new(WriteGuestFileResponse {
                    success: false,
                    bytes_written: 0,
                    error: e.to_string(),
                }))
            }
        }
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn guest_shutdown(
        &self,
        request: Request<GuestShutdownRequest>,
    ) -> Result<Response<GuestShutdownResponse>, Status> {
        let req = request.into_inner();
        info!(vm_id = %req.vm_id, reboot = req.reboot, "Requesting guest shutdown");
        
        // Ensure agent is connected
        self.get_agent_client(&req.vm_id).await?;
        
        let agents = self.agent_manager.read().await;
        let client = agents.get(&req.vm_id)
            .ok_or_else(|| Status::unavailable("Agent not connected"))?;
        
        match client.shutdown(req.reboot).await {
            Ok(response) => {
                if response.accepted {
                    info!(vm_id = %req.vm_id, reboot = req.reboot, "Shutdown request accepted");
                } else {
                    warn!(vm_id = %req.vm_id, error = %response.error, "Shutdown request rejected");
                }
                Ok(Response::new(GuestShutdownResponse {
                    accepted: response.accepted,
                    error: response.error,
                }))
            }
            Err(e) => {
                error!(vm_id = %req.vm_id, error = %e, "Shutdown request failed");
                Ok(Response::new(GuestShutdownResponse {
                    accepted: false,
                    error: e.to_string(),
                }))
            }
        }
    }
    
    // NOTE: quiesce_filesystems, thaw_filesystems, and sync_time methods
    // require proto types that are not generated. They will be added when
    // the proto file is regenerated with protoc on Linux.
    
    // =========================================================================
    // Storage Pool Operations
    // =========================================================================
    
    #[instrument(skip(self, request), fields(pool_id = %request.get_ref().pool_id))]
    async fn init_storage_pool(
        &self,
        request: Request<InitStoragePoolRequest>,
    ) -> Result<Response<StoragePoolInfoResponse>, Status> {
        use limiquantix_hypervisor::storage::{NfsConfig, CephConfig, IscsiConfig};
        
        let req = request.into_inner();
        info!(
            pool_id = %req.pool_id, 
            pool_type = ?req.r#type, 
            has_config = req.config.is_some(),
            has_nfs = req.config.as_ref().map(|c| c.nfs.is_some()).unwrap_or(false),
            has_local = req.config.as_ref().map(|c| c.local.is_some()).unwrap_or(false),
            "Initializing storage pool - request details"
        );
        
        let pool_type = match StoragePoolType::try_from(req.r#type) {
            Ok(StoragePoolType::LocalDir) => PoolType::LocalDir,
            Ok(StoragePoolType::Nfs) => PoolType::Nfs,
            Ok(StoragePoolType::CephRbd) => PoolType::CephRbd,
            Ok(StoragePoolType::Iscsi) => PoolType::Iscsi,
            _ => return Err(Status::invalid_argument("Invalid pool type")),
        };
        
        // Build pool config from proto - handle ALL storage backend types
        let config = if let Some(cfg) = req.config {
            let mut pool_config = PoolConfig::default();
            
            // Local directory config
            if let Some(local) = cfg.local {
                info!(pool_id = %req.pool_id, path = %local.path, "Using local directory config");
                pool_config.local = Some(LocalConfig { path: local.path });
            }
            
            // NFS config
            if let Some(nfs) = cfg.nfs {
                info!(
                    pool_id = %req.pool_id,
                    server = %nfs.server,
                    export_path = %nfs.export_path,
                    version = %nfs.version,
                    "Using NFS config"
                );
                pool_config.nfs = Some(NfsConfig {
                    server: nfs.server,
                    export_path: nfs.export_path,
                    version: if nfs.version.is_empty() { "4.1".to_string() } else { nfs.version },
                    options: nfs.options,
                    mount_point: if nfs.mount_point.is_empty() { None } else { Some(nfs.mount_point) },
                });
            }
            
            // Ceph RBD config
            if let Some(ceph) = cfg.ceph {
                info!(
                    pool_id = %req.pool_id,
                    ceph_pool = %ceph.pool_name,
                    monitors = ?ceph.monitors,
                    "Using Ceph RBD config"
                );
                pool_config.ceph = Some(CephConfig {
                    cluster_id: ceph.cluster_id,
                    pool_name: ceph.pool_name,
                    monitors: ceph.monitors,
                    user: if ceph.user.is_empty() { "admin".to_string() } else { ceph.user },
                    keyring_path: if ceph.keyring_path.is_empty() { "/etc/ceph/ceph.client.admin.keyring".to_string() } else { ceph.keyring_path },
                    namespace: ceph.namespace,
                    secret_uuid: if ceph.secret_uuid.is_empty() { None } else { Some(ceph.secret_uuid) },
                });
            }
            
            // iSCSI config
            if let Some(iscsi) = cfg.iscsi {
                info!(
                    pool_id = %req.pool_id,
                    portal = %iscsi.portal,
                    target = %iscsi.target,
                    "Using iSCSI config"
                );
                pool_config.iscsi = Some(IscsiConfig {
                    portal: iscsi.portal,
                    target: iscsi.target,
                    chap_enabled: iscsi.chap_enabled,
                    chap_user: iscsi.chap_user,
                    chap_password: iscsi.chap_password,
                    lun: iscsi.lun,
                    volume_group: if iscsi.volume_group.is_empty() { None } else { Some(iscsi.volume_group) },
                });
            }
            
            pool_config
        } else {
            warn!(pool_id = %req.pool_id, "No config provided for storage pool");
            PoolConfig::default()
        };
        
        // Debug: log final config state before init
        info!(
            pool_id = %req.pool_id,
            has_nfs_config = config.nfs.is_some(),
            has_local_config = config.local.is_some(),
            has_ceph_config = config.ceph.is_some(),
            has_iscsi_config = config.iscsi.is_some(),
            "Final pool config before init"
        );
        
        let pool_info = self.storage.init_pool(&req.pool_id, pool_type, config).await
            .map_err(|e| {
                error!(pool_id = %req.pool_id, error = %e, "Failed to init storage pool");
                Status::internal(format!("Failed to init pool: {}", e))
            })?;
        
        Ok(Response::new(StoragePoolInfoResponse {
            pool_id: req.pool_id.clone(),
            r#type: req.r#type,
            mount_path: pool_info.mount_path.unwrap_or_default(),
            device_path: String::new(),
            rbd_pool: String::new(),
            total_bytes: pool_info.total_bytes,
            available_bytes: pool_info.available_bytes,
            used_bytes: pool_info.total_bytes.saturating_sub(pool_info.available_bytes),
            volume_count: self.storage.list_volumes(&req.pool_id).await.unwrap_or_default().len() as u32,
        }))
    }
    
    #[instrument(skip(self, request), fields(pool_id = %request.get_ref().pool_id))]
    async fn destroy_storage_pool(
        &self,
        request: Request<StoragePoolIdRequest>,
    ) -> Result<Response<()>, Status> {
        let req = request.into_inner();
        info!(pool_id = %req.pool_id, "Destroying storage pool");
        
        self.storage.destroy_pool(&req.pool_id).await
            .map_err(|e| Status::internal(format!("Failed to destroy pool: {}", e)))?;
        
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(pool_id = %request.get_ref().pool_id))]
    async fn get_storage_pool_info(
        &self,
        request: Request<StoragePoolIdRequest>,
    ) -> Result<Response<StoragePoolInfoResponse>, Status> {
        let req = request.into_inner();
        
        let pool_info = self.storage.get_pool_info(&req.pool_id).await
            .map_err(|e| Status::not_found(format!("Pool not found: {}", e)))?;
        
        let pool_type = match pool_info.pool_type {
            PoolType::LocalDir => StoragePoolType::LocalDir as i32,
            PoolType::Nfs => StoragePoolType::Nfs as i32,
            PoolType::CephRbd => StoragePoolType::CephRbd as i32,
            PoolType::Iscsi => StoragePoolType::Iscsi as i32,
            _ => StoragePoolType::Unspecified as i32,
        };
        
        Ok(Response::new(StoragePoolInfoResponse {
            pool_id: req.pool_id.clone(),
            r#type: pool_type,
            mount_path: pool_info.mount_path.unwrap_or_default(),
            device_path: String::new(),
            rbd_pool: String::new(),
            total_bytes: pool_info.total_bytes,
            available_bytes: pool_info.available_bytes,
            used_bytes: pool_info.total_bytes.saturating_sub(pool_info.available_bytes),
            volume_count: self.storage.list_volumes(&req.pool_id).await.unwrap_or_default().len() as u32,
        }))
    }
    
    #[instrument(skip(self, _request))]
    async fn list_storage_pools(
        &self,
        _request: Request<()>,
    ) -> Result<Response<ListStoragePoolsResponse>, Status> {
        let pools = self.storage.list_pools().await;
        
        let mut pool_responses = Vec::new();
        for p in pools {
            let pool_type = match p.pool_type {
                PoolType::LocalDir => StoragePoolType::LocalDir as i32,
                PoolType::Nfs => StoragePoolType::Nfs as i32,
                PoolType::CephRbd => StoragePoolType::CephRbd as i32,
                PoolType::Iscsi => StoragePoolType::Iscsi as i32,
                _ => StoragePoolType::Unspecified as i32,
            };
            
            // Get volume count
            let volume_count = self.storage.list_volumes(&p.pool_id).await.unwrap_or_default().len() as u32;
            pool_responses.push(StoragePoolInfoResponse {
                pool_id: p.pool_id,
                r#type: pool_type,
                mount_path: p.mount_path.unwrap_or_default(),
                device_path: String::new(),
                rbd_pool: String::new(),
                total_bytes: p.total_bytes,
                available_bytes: p.available_bytes,
                used_bytes: p.total_bytes.saturating_sub(p.available_bytes),
                volume_count,
            });
        }
        
        Ok(Response::new(ListStoragePoolsResponse { pools: pool_responses }))
    }

    #[instrument(skip(self, request), fields(pool_id = %request.get_ref().pool_id))]
    async fn list_storage_pool_files(
        &self,
        request: Request<ListStoragePoolFilesRequest>,
    ) -> Result<Response<ListStoragePoolFilesResponse>, Status> {
        let req = request.into_inner();
        info!(pool_id = %req.pool_id, path = %req.path, "Listing storage pool files");
        
        // Log available pools for debugging
        let available_pools = self.storage.list_pools().await;
        debug!(
            pool_id = %req.pool_id,
            available_pool_count = available_pools.len(),
            available_pools = ?available_pools.iter().map(|p| (&p.pool_id, &p.mount_path)).collect::<Vec<_>>(),
            "Checking for pool in cache"
        );
        
        // Get the pool to find its mount path (with fallback to discovery)
        let pool = self.storage.get_pool_info_or_discover(&req.pool_id).await
            .map_err(|e| {
                warn!(
                    pool_id = %req.pool_id,
                    error = %e,
                    available_pools = ?available_pools.iter().map(|p| &p.pool_id).collect::<Vec<_>>(),
                    "Pool not found in cache or discovery. Available pools listed above."
                );
                Status::not_found(format!(
                    "Pool '{}' not found. Error: {}. The pool may need to be synced from the control plane. Available pools: {:?}",
                    req.pool_id, e, available_pools.iter().map(|p| &p.pool_id).collect::<Vec<_>>()
                ))
            })?;
        
        let mount_path = pool.mount_path
            .ok_or_else(|| Status::failed_precondition(format!(
                "Pool {} has no mount path. Pool type: {:?}. This storage type may not support file browsing.",
                req.pool_id, pool.pool_type
            )))?;
        
        // Build the full path
        let base_path = std::path::PathBuf::from(&mount_path);
        let target_path = if req.path.is_empty() {
            base_path.clone()
        } else {
            // Sanitize path to prevent directory traversal
            let clean_path = req.path.trim_start_matches('/');
            if clean_path.contains("..") {
                return Err(Status::invalid_argument("Invalid path: contains '..'"));
            }
            base_path.join(clean_path)
        };
        
        // Verify the target path is within the mount path
        let canonical_base = base_path.canonicalize()
            .map_err(|e| Status::internal(format!("Failed to resolve base path: {}", e)))?;
        let canonical_target = target_path.canonicalize()
            .map_err(|e| Status::not_found(format!("Path not found: {}", e)))?;
        
        if !canonical_target.starts_with(&canonical_base) {
            return Err(Status::invalid_argument("Path is outside pool mount"));
        }
        
        // Read directory contents
        let mut entries = Vec::new();
        let mut dir = tokio::fs::read_dir(&canonical_target).await
            .map_err(|e| Status::internal(format!("Failed to read directory: {}", e)))?;
        
        while let Some(entry) = dir.next_entry().await
            .map_err(|e| Status::internal(format!("Failed to read entry: {}", e)))? 
        {
            let metadata = entry.metadata().await
                .map_err(|e| Status::internal(format!("Failed to get metadata: {}", e)))?;
            
            let file_name = entry.file_name().to_string_lossy().to_string();
            let file_path = entry.path();
            
            // Calculate relative path from pool root
            let relative_path = file_path.strip_prefix(&canonical_base)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| file_name.clone());
            
            let is_directory = metadata.is_dir();
            let size_bytes = if is_directory { 0 } else { metadata.len() };
            
            // Get modification time
            let modified_at = metadata.modified()
                .map(|t| {
                    let datetime: chrono::DateTime<chrono::Utc> = t.into();
                    datetime.to_rfc3339()
                })
                .unwrap_or_default();
            
            // Determine file type
            let file_type = if is_directory {
                "directory".to_string()
            } else {
                file_name.rsplit('.').next()
                    .map(|ext| ext.to_lowercase())
                    .unwrap_or_else(|| "unknown".to_string())
            };
            
            // Get permissions (Unix-specific, fallback for Windows)
            #[cfg(unix)]
            let permissions = {
                use std::os::unix::fs::PermissionsExt;
                format!("{:o}", metadata.permissions().mode() & 0o777)
            };
            #[cfg(not(unix))]
            let permissions = if metadata.permissions().readonly() { "444" } else { "644" }.to_string();
            
            entries.push(StoragePoolFileEntry {
                name: file_name,
                path: relative_path,
                is_directory,
                size_bytes,
                modified_at,
                file_type,
                permissions,
            });
        }
        
        // Sort: directories first, then by name
        entries.sort_by(|a, b| {
            match (a.is_directory, b.is_directory) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            }
        });
        
        Ok(Response::new(ListStoragePoolFilesResponse {
            entries,
            current_path: req.path,
        }))
    }
    
    // =========================================================================
    // Storage Volume Operations
    // =========================================================================
    
    #[instrument(skip(self, request), fields(pool_id = %request.get_ref().pool_id))]
    async fn list_volumes(
        &self,
        request: Request<ListVolumesRequest>,
    ) -> Result<Response<ListVolumesResponse>, Status> {
        let req = request.into_inner();
        debug!(pool_id = %req.pool_id, "Listing volumes");
        
        let volumes = self.storage.list_volumes(&req.pool_id).await
            .map_err(|e| Status::internal(format!("Failed to list volumes: {}", e)))?;
        
        let proto_volumes: Vec<VolumeInfoResponse> = volumes.into_iter().map(|v| {
            VolumeInfoResponse {
                volume_id: v.name,
                pool_id: req.pool_id.clone(),
                size_bytes: v.capacity,
                format: v.format.unwrap_or_else(|| "qcow2".to_string()),
                path: v.path,
                attached_to: String::new(), // TODO: Track attachments
            }
        }).collect();
        
        Ok(Response::new(ListVolumesResponse { volumes: proto_volumes }))
    }
    
    #[instrument(skip(self, request), fields(pool_id = %request.get_ref().pool_id, volume_id = %request.get_ref().volume_id))]
    async fn create_volume(
        &self,
        request: Request<CreateVolumeRequest>,
    ) -> Result<Response<VolumeInfoResponse>, Status> {
        let req = request.into_inner();
        info!(pool_id = %req.pool_id, volume_id = %req.volume_id, size = req.size_bytes, "Creating volume");
        
        // VolumeSourceType enum values: 0=Empty, 1=Clone, 2=Image, 3=Snapshot
        let source = match req.source_type {
            1 => Some(VolumeSource::Clone(req.source_id.clone())), // VOLUME_SOURCE_CLONE
            2 => Some(VolumeSource::Image(req.source_id.clone())), // VOLUME_SOURCE_IMAGE
            3 => Some(VolumeSource::Snapshot(req.source_id.clone())), // VOLUME_SOURCE_SNAPSHOT
            _ => None, // 0 = VOLUME_SOURCE_EMPTY or unknown
        };
        
        self.storage.create_volume(&req.pool_id, &req.volume_id, req.size_bytes, source).await
            .map_err(|e| Status::internal(format!("Failed to create volume: {}", e)))?;
        
        // Get the volume path
        let attach_info = self.storage.get_attach_info(&req.pool_id, &req.volume_id).await
            .map_err(|e| Status::internal(format!("Failed to get volume info: {}", e)))?;
        
        Ok(Response::new(VolumeInfoResponse {
            volume_id: req.volume_id,
            pool_id: req.pool_id,
            size_bytes: req.size_bytes,
            format: "qcow2".to_string(),
            path: attach_info.path,
            attached_to: String::new(),
        }))
    }
    
    #[instrument(skip(self, request), fields(pool_id = %request.get_ref().pool_id, volume_id = %request.get_ref().volume_id))]
    async fn delete_volume(
        &self,
        request: Request<VolumeIdRequest>,
    ) -> Result<Response<()>, Status> {
        let req = request.into_inner();
        info!(pool_id = %req.pool_id, volume_id = %req.volume_id, "Deleting volume");
        
        self.storage.delete_volume(&req.pool_id, &req.volume_id).await
            .map_err(|e| Status::internal(format!("Failed to delete volume: {}", e)))?;
        
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(pool_id = %request.get_ref().pool_id, volume_id = %request.get_ref().volume_id))]
    async fn resize_volume(
        &self,
        request: Request<ResizeVolumeRequest>,
    ) -> Result<Response<()>, Status> {
        let req = request.into_inner();
        info!(pool_id = %req.pool_id, volume_id = %req.volume_id, new_size = req.new_size_bytes, "Resizing volume");
        
        self.storage.resize_volume(&req.pool_id, &req.volume_id, req.new_size_bytes).await
            .map_err(|e| Status::internal(format!("Failed to resize volume: {}", e)))?;
        
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(pool_id = %request.get_ref().pool_id))]
    async fn clone_volume(
        &self,
        request: Request<CloneVolumeRequest>,
    ) -> Result<Response<()>, Status> {
        let req = request.into_inner();
        info!(pool_id = %req.pool_id, source = %req.source_volume_id, dest = %req.dest_volume_id, "Cloning volume");
        
        self.storage.clone_volume(&req.pool_id, &req.source_volume_id, &req.dest_volume_id).await
            .map_err(|e| Status::internal(format!("Failed to clone volume: {}", e)))?;
        
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, request), fields(pool_id = %request.get_ref().pool_id, volume_id = %request.get_ref().volume_id))]
    async fn get_volume_attach_info(
        &self,
        request: Request<VolumeIdRequest>,
    ) -> Result<Response<VolumeAttachInfoResponse>, Status> {
        let req = request.into_inner();
        
        let attach_info = self.storage.get_attach_info(&req.pool_id, &req.volume_id).await
            .map_err(|e| Status::not_found(format!("Volume not found: {}", e)))?;
        
        Ok(Response::new(VolumeAttachInfoResponse {
            volume_id: req.volume_id,
            path: attach_info.path,
            disk_xml: attach_info.disk_xml,
        }))
    }
    
    #[instrument(skip(self, request), fields(pool_id = %request.get_ref().pool_id, volume_id = %request.get_ref().volume_id))]
    async fn create_volume_snapshot(
        &self,
        request: Request<CreateVolumeSnapshotRequest>,
    ) -> Result<Response<()>, Status> {
        let req = request.into_inner();
        info!(pool_id = %req.pool_id, volume_id = %req.volume_id, snapshot_id = %req.snapshot_id, "Creating volume snapshot");
        
        self.storage.create_snapshot(&req.pool_id, &req.volume_id, &req.snapshot_id).await
            .map_err(|e| Status::internal(format!("Failed to create snapshot: {}", e)))?;
        
        Ok(Response::new(()))
    }
    
    #[instrument(skip(self, _request))]
    async fn list_images(
        &self,
        _request: Request<()>,
    ) -> Result<Response<ListImagesResponse>, Status> {
        info!("Listing storage images (ISO, QCOW2, OVA, IMG)");
        
        // Directories to scan for images
        let image_dirs = [
            // Primary Quantix-OS data partition locations
            "/data/images",
            "/data/isos",
            "/data/templates",
            // Legacy/fallback locations  
            "/var/lib/limiquantix/cloud-images",
            "/var/lib/limiquantix/isos",
            "/var/lib/limiquantix/images",
            "/var/lib/limiquantix/templates",
            // Libvirt default location
            "/var/lib/libvirt/images",
        ];
        
        let mut images = Vec::new();
        let mut scanned_paths = std::collections::HashSet::new();
        
        // Supported image formats
        let supported_formats = ["iso", "qcow2", "img", "ova", "vmdk", "raw"];
        
        // Helper to scan a directory for images (including subdirectories)
        async fn scan_dir(
            path: &std::path::Path, 
            images: &mut Vec<ImageInfo>,
            scanned: &mut std::collections::HashSet<String>,
            formats: &[&str],
            depth: usize,
        ) {
            // Limit recursion depth
            if depth > 3 {
                return;
            }
            
            let dir_result = tokio::fs::read_dir(path).await;
            let mut entries = match dir_result {
                Ok(e) => e,
                Err(e) => {
                    // Only log at debug level - directories may not exist
                    tracing::debug!(path = %path.display(), error = %e, "Could not read directory");
                    return;
                }
            };
            
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let file_path = entry.path();
                
                // Skip if already scanned
                let path_str = file_path.to_string_lossy().to_string();
                if scanned.contains(&path_str) {
                    continue;
                }
                
                if let Ok(metadata) = entry.metadata().await {
                    if metadata.is_dir() {
                        // Recursively scan subdirectories
                        Box::pin(scan_dir(&file_path, images, scanned, formats, depth + 1)).await;
                    } else if metadata.is_file() {
                    if let Some(ext) = file_path.extension() {
                        let ext_str = ext.to_string_lossy().to_lowercase();
                            if formats.contains(&ext_str.as_str()) {
                                let name = file_path.file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_default();
                                
                                // Generate a stable ID from the path
                                let image_id = format!("{:x}", md5::compute(&path_str));
                                
                                scanned.insert(path_str.clone());
                                
                                tracing::debug!(
                                    name = %name,
                                    path = %path_str,
                                    size = metadata.len(),
                                    format = %ext_str,
                                    "Found image"
                                );
                                
                                images.push(ImageInfo {
                                    image_id,
                                    name,
                                    path: path_str,
                                    size_bytes: metadata.len(),
                                    format: ext_str,
                                });
                            }
                        }
                    }
                }
            }
        }
        
        // Scan all image directories
        for dir in &image_dirs {
            let path = std::path::Path::new(dir);
            scan_dir(path, &mut images, &mut scanned_paths, &supported_formats, 0).await;
        }
        
        // Sort by name
        images.sort_by(|a, b| a.name.cmp(&b.name));
        
        info!(count = images.len(), "Found storage images");
        
        Ok(Response::new(ListImagesResponse { images }))
    }
    
    // =========================================================================
    // Filesystem Quiescing & Time Sync
    // =========================================================================
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn quiesce_filesystems(
        &self,
        request: Request<QuiesceFilesystemsRequest>,
    ) -> Result<Response<QuiesceFilesystemsResponse>, Status> {
        use limiquantix_proto::FrozenFilesystem;
        
        let req = request.into_inner();
        info!(vm_id = %req.vm_id, "Quiescing filesystems via guest agent");
        
        // Get agent client for this VM
        let agents = self.agent_manager.read().await;
        let agent = agents.get(&req.vm_id).ok_or_else(|| {
            Status::unavailable(format!("No agent connection for VM {}", req.vm_id))
        })?;
        
        // Execute fsfreeze command via guest agent (30 second timeout)
        match agent.execute("fsfreeze --freeze /", 30).await {
            Ok(output) => {
                if output.exit_code == 0 {
                    // Generate a quiesce token (simple UUID for now)
                    let quiesce_token = uuid::Uuid::new_v4().to_string();
                    info!(vm_id = %req.vm_id, quiesce_token = %quiesce_token, "Filesystems quiesced");
                    Ok(Response::new(QuiesceFilesystemsResponse {
                        success: true,
                        frozen: vec![FrozenFilesystem {
                            mount_point: "/".to_string(),
                            device: String::new(),
                            filesystem: String::new(),
                            frozen: true,
                            error: String::new(),
                        }],
                        error: String::new(),
                        quiesce_token,
                    }))
                } else {
                    warn!(vm_id = %req.vm_id, stderr = %output.stderr, "fsfreeze failed");
                    Ok(Response::new(QuiesceFilesystemsResponse {
                        success: false,
                        frozen: vec![],
                        error: output.stderr,
                        quiesce_token: String::new(),
                    }))
                }
            }
            Err(e) => {
                error!(vm_id = %req.vm_id, error = %e, "Failed to quiesce filesystems");
                Ok(Response::new(QuiesceFilesystemsResponse {
                    success: false,
                    frozen: vec![],
                    error: e.to_string(),
                    quiesce_token: String::new(),
                }))
            }
        }
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn thaw_filesystems(
        &self,
        request: Request<ThawFilesystemsRequest>,
    ) -> Result<Response<ThawFilesystemsResponse>, Status> {
        let req = request.into_inner();
        info!(vm_id = %req.vm_id, quiesce_token = %req.quiesce_token, "Thawing filesystems via guest agent");
        
        // Get agent client for this VM
        let agents = self.agent_manager.read().await;
        let agent = agents.get(&req.vm_id).ok_or_else(|| {
            Status::unavailable(format!("No agent connection for VM {}", req.vm_id))
        })?;
        
        // Execute fsfreeze --unfreeze command via guest agent (30 second timeout)
        match agent.execute("fsfreeze --unfreeze /", 30).await {
            Ok(output) => {
                if output.exit_code == 0 {
                    info!(vm_id = %req.vm_id, "Filesystems thawed");
                    Ok(Response::new(ThawFilesystemsResponse {
                        success: true,
                        thawed_mount_points: vec!["/".to_string()],
                        error: String::new(),
                        frozen_duration_ms: 0, // We don't track duration currently
                    }))
                } else {
                    warn!(vm_id = %req.vm_id, stderr = %output.stderr, "fsfreeze --unfreeze failed");
                    Ok(Response::new(ThawFilesystemsResponse {
                        success: false,
                        thawed_mount_points: vec![],
                        error: output.stderr,
                        frozen_duration_ms: 0,
                    }))
                }
            }
            Err(e) => {
                error!(vm_id = %req.vm_id, error = %e, "Failed to thaw filesystems");
                Ok(Response::new(ThawFilesystemsResponse {
                    success: false,
                    thawed_mount_points: vec![],
                    error: e.to_string(),
                    frozen_duration_ms: 0,
                }))
            }
        }
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn sync_time(
        &self,
        request: Request<SyncTimeRequest>,
    ) -> Result<Response<SyncTimeResponse>, Status> {
        let req = request.into_inner();
        info!(vm_id = %req.vm_id, "Syncing guest time via guest agent");
        
        // Get agent client for this VM
        let agents = self.agent_manager.read().await;
        let agent = agents.get(&req.vm_id).ok_or_else(|| {
            Status::unavailable(format!("No agent connection for VM {}", req.vm_id))
        })?;
        
        // Set time via guest agent using hwclock sync (10 second timeout)
        // This syncs the guest's system clock to the hardware clock which should be kept in sync with host
        match agent.execute("hwclock --hctosys", 10).await {
            Ok(output) => {
                if output.exit_code == 0 {
                    info!(vm_id = %req.vm_id, "Guest time synchronized");
                    Ok(Response::new(SyncTimeResponse {
                        success: true,
                        offset_seconds: 0.0,
                        time_source: "host".to_string(),
                        error: String::new(),
                    }))
                } else {
                    warn!(vm_id = %req.vm_id, stderr = %output.stderr, "time sync failed");
                    // Return success anyway as some VMs may not have hwclock
                    Ok(Response::new(SyncTimeResponse {
                        success: false,
                        offset_seconds: 0.0,
                        time_source: "unknown".to_string(),
                        error: output.stderr,
                    }))
                }
            }
            Err(e) => {
                error!(vm_id = %req.vm_id, error = %e, "Failed to sync time");
                Ok(Response::new(SyncTimeResponse {
                    success: false,
                    offset_seconds: 0.0,
                    time_source: String::new(),
                    error: e.to_string(),
                }))
            }
        }
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id, device = %request.get_ref().device))]
    async fn change_media(
        &self,
        request: Request<ChangeMediaRequest>,
    ) -> Result<Response<()>, Status> {
        let req = request.into_inner();
        
        let iso_path = if req.iso_path.is_empty() {
            None
        } else {
            Some(req.iso_path.as_str())
        };
        
        if iso_path.is_some() {
            info!(iso_path = ?iso_path, "Mounting ISO to CD-ROM");
        } else {
            info!("Ejecting CD-ROM media");
        }
        
        // Call the hypervisor to change the media
        self.hypervisor
            .change_media(&req.vm_id, &req.device, iso_path)
            .await
            .map_err(|e| Status::internal(format!("Failed to change media: {}", e)))?;
        
        if iso_path.is_some() {
            info!("ISO mounted successfully");
        } else {
            info!("CD-ROM ejected successfully");
        }
        
        Ok(Response::new(()))
    }
}

/// Sanitize a string to be safe for use as a filename/directory name.
/// Replaces unsafe characters with underscores and limits length.
fn sanitize_filename(name: &str) -> String {
    // Replace characters that are problematic in filenames
    let sanitized: String = name
        .chars()
        .map(|c| match c {
            // Allow alphanumeric, dash, underscore, and dot
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
            // Replace spaces with underscores
            ' ' => '_',
            // Replace everything else with underscore
            _ => '_',
        })
        .collect();
    
    // Remove consecutive underscores
    let mut result = String::with_capacity(sanitized.len());
    let mut last_was_underscore = false;
    for c in sanitized.chars() {
        if c == '_' {
            if !last_was_underscore {
                result.push(c);
            }
            last_was_underscore = true;
        } else {
            result.push(c);
            last_was_underscore = false;
        }
    }
    
    // Trim leading/trailing underscores and dots
    let result = result.trim_matches(|c| c == '_' || c == '.');
    
    // Limit length to 64 characters (reasonable for filesystem)
    if result.len() > 64 {
        result[..64].to_string()
    } else {
        result.to_string()
    }
}
