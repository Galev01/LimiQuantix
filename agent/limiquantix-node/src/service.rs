//! Node Daemon gRPC service implementation.

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
    // Volume listing types
    ListVolumesRequest, ListVolumesResponse, VolumeInfoResponse,
    ListImagesResponse, ImageInfo,
    // Filesystem quiesce/time sync types
    QuiesceFilesystemsRequest, QuiesceFilesystemsResponse,
    ThawFilesystemsRequest, ThawFilesystemsResponse,
    SyncTimeRequest, SyncTimeResponse,
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
        }
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
    
    /// Get the management IP address
    pub fn get_management_ip(&self) -> String {
        self.management_ip.clone()
    }
    
    /// Get current telemetry data
    pub fn get_telemetry(&self) -> limiquantix_telemetry::NodeTelemetry {
        self.telemetry.collect()
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
            management_ip: String::new(), // TODO: Get from config
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
        
        // Extract spec from request (required field)
        let spec = req.spec.ok_or_else(|| Status::invalid_argument("VM spec is required"))?;
        
        // Build VM configuration from the nested spec structure
        let mut config = VmConfig::new(&req.name)
            .with_id(&req.vm_id);
        
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
                vm_id = %req.vm_id,
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
                vm_id = %req.vm_id,
                disk_id = %disk_id,
                needs_creation = needs_disk_creation,
                path_empty = disk_spec.path.is_empty(),
                size_gib = disk_spec.size_gib,
                has_backing_file = has_backing_file,
                "Disk creation check"
            );
            
            if needs_disk_creation {
                // Create disk image in default VM storage path
                let vm_dir = std::path::PathBuf::from("/var/lib/limiquantix/vms").join(&req.vm_id);
                if let Err(e) = std::fs::create_dir_all(&vm_dir) {
                    error!(vm_id = %req.vm_id, error = %e, "Failed to create VM directory");
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
                            vm_id = %req.vm_id,
                            backing_file = %bf,
                            "Backing file (cloud image) does not exist"
                        );
                        return Err(Status::failed_precondition(format!(
                            "Cloud image not found: {}. Download it with: setup-cloud-images.sh ubuntu-22.04",
                            bf
                        )));
                    }
                    
                    info!(
                        vm_id = %req.vm_id,
                        disk_id = %disk_id,
                        backing_file = %bf,
                        "Creating disk with backing file (cloud image)"
                    );
                    cmd.arg("-b").arg(bf);
                    cmd.arg("-F").arg("qcow2"); // Backing file format
                } else {
                    info!(
                        vm_id = %req.vm_id,
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
                    vm_id = %req.vm_id,
                    command = ?cmd,
                    "Executing qemu-img command"
                );
                
                match cmd.output() {
                    Ok(output) if output.status.success() => {
                        info!(
                            vm_id = %req.vm_id,
                            disk_id = %disk_id,
                            path = %disk_path.display(),
                            has_backing_file = has_backing_file,
                            "Disk image created successfully"
                        );
                    }
                    Ok(output) => {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        error!(
                            vm_id = %req.vm_id,
                            disk_id = %disk_id,
                            error = %stderr,
                            "Failed to create disk image"
                        );
                        return Err(Status::internal(format!("Failed to create disk image: {}", stderr)));
                    }
                    Err(e) => {
                        error!(
                            vm_id = %req.vm_id,
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
        
        // Check if we have a cloud image - if so, generate a minimal default cloud-init
        // NOTE: Cloud-init config is not currently exposed via proto - this generates defaults
        let has_cloud_image = config.disks.iter().any(|d| d.backing_file.is_some());
        
        if has_cloud_image {
            info!(
                vm_id = %req.vm_id,
                "Generating default cloud-init ISO for cloud image"
            );
            
            // Generate default cloud-init config
            let ci_config = CloudInitConfig::new(&req.vm_id, &req.name);
            
            let vm_dir = std::path::PathBuf::from("/var/lib/limiquantix/vms").join(&req.vm_id);
            let generator = CloudInitGenerator::new();
            
            match generator.generate_iso(&ci_config, &vm_dir) {
                Ok(iso_path) => {
                    info!(
                        vm_id = %req.vm_id,
                        iso_path = %iso_path.display(),
                        "Default cloud-init ISO generated"
                    );
                    
                    config.cdroms.push(CdromConfig {
                        id: "cloud-init".to_string(),
                        iso_path: Some(iso_path.to_string_lossy().to_string()),
                        bootable: false,
                    });
                }
                Err(e) => {
                    warn!(
                        vm_id = %req.vm_id,
                        error = %e,
                        "Failed to generate default cloud-init ISO (continuing without it)"
                    );
                    // Don't fail the VM creation, just warn
                }
            }
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
            vm_id = %req.vm_id,
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
                
                Ok(Response::new(CreateVmOnNodeResponse {
                    vm_id: created_id,
                    created: true,
                    message: "VM created successfully".to_string(),
                }))
            }
            Err(e) => {
                error!(vm_id = %req.vm_id, error = %e, "Failed to create VM in hypervisor");
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
        info!(pool_id = %req.pool_id, pool_type = ?req.r#type, "Initializing storage pool");
        
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
        debug!("Listing ISO images");
        
        // Look for ISO files in the images directory
        let images_path = std::path::Path::new("/var/lib/limiquantix/cloud-images");
        let iso_path = std::path::Path::new("/var/lib/limiquantix/isos");
        
        let mut images = Vec::new();
        
        // Helper to scan a directory for images
        async fn scan_dir(path: &std::path::Path, images: &mut Vec<ImageInfo>) {
            if let Ok(mut entries) = tokio::fs::read_dir(path).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let file_path = entry.path();
                    if let Some(ext) = file_path.extension() {
                        let ext_str = ext.to_string_lossy().to_lowercase();
                        if ext_str == "iso" || ext_str == "qcow2" || ext_str == "img" {
                            if let Ok(metadata) = entry.metadata().await {
                                let name = file_path.file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_default();
                                images.push(ImageInfo {
                                    image_id: name.clone(),
                                    name,
                                    path: file_path.to_string_lossy().to_string(),
                                    size_bytes: metadata.len(),
                                    format: ext_str,
                                });
                            }
                        }
                    }
                }
            }
        }
        
        scan_dir(images_path, &mut images).await;
        scan_dir(iso_path, &mut images).await;
        
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
}
