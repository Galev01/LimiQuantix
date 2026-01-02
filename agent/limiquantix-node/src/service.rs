//! Node Daemon gRPC service implementation.

use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use futures::Stream;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};
use tracing::{info, debug, warn, error, instrument};

use limiquantix_hypervisor::{
    Hypervisor, VmConfig, VmState, DiskConfig, NicConfig, CdromConfig,
    DiskBus, DiskFormat, NicModel, StorageManager, BootConfig, Firmware, BootDevice,
    CloudInitConfig, CloudInitGenerator,
};
use limiquantix_telemetry::TelemetryCollector;
use limiquantix_proto::{
    NodeDaemonService, HealthCheckRequest, HealthCheckResponse,
    NodeInfoResponse, VmIdRequest, CreateVmOnNodeRequest, CreateVmOnNodeResponse,
    StopVmRequest, VmStatusResponse, ListVMsOnNodeResponse, ConsoleInfoResponse,
    CreateSnapshotRequest, SnapshotResponse, RevertSnapshotRequest,
    DeleteSnapshotRequest, ListSnapshotsResponse, StreamMetricsRequest,
    NodeMetrics, NodeEvent, PowerState,
};

/// Node Daemon gRPC service implementation.
pub struct NodeDaemonServiceImpl {
    node_id: String,
    hostname: String,
    management_ip: String,
    hypervisor: Arc<dyn Hypervisor>,
    telemetry: Arc<TelemetryCollector>,
    storage: StorageManager,
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
        Self {
            node_id,
            hostname,
            management_ip,
            hypervisor,
            telemetry,
            storage: StorageManager::new(),
        }
    }
    
    /// Create a new service instance with a custom storage path.
    #[allow(dead_code)]
    pub fn with_storage_path(
        node_id: String,
        hostname: String,
        management_ip: String,
        hypervisor: Arc<dyn Hypervisor>,
        telemetry: Arc<TelemetryCollector>,
        storage_path: impl Into<std::path::PathBuf>,
    ) -> Self {
        Self {
            node_id,
            hostname,
            management_ip,
            hypervisor,
            telemetry,
            storage: StorageManager::with_path(storage_path),
        }
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
        let spec = req.spec.ok_or_else(|| {
            Status::invalid_argument("VM spec is required")
        })?;
        
        // Build VM configuration from the nested spec
        let mut config = VmConfig::new(&req.name)
            .with_id(&req.vm_id);
        
        // Set CPU configuration
        config.cpu.cores = spec.cpu_cores;
        config.cpu.sockets = if spec.cpu_sockets > 0 { spec.cpu_sockets } else { 1 };
        config.cpu.threads_per_core = if spec.cpu_threads_per_core > 0 { spec.cpu_threads_per_core } else { 1 };
        
        // Set memory configuration
        config.memory.size_mib = spec.memory_mib;
        config.memory.hugepages = spec.memory_hugepages;
        
        // Set boot configuration
        config.boot.firmware = Self::convert_firmware(spec.firmware);
        config.boot.order = spec.boot_order.iter()
            .map(|&d| Self::convert_boot_device(d))
            .collect();
        if config.boot.order.is_empty() {
            config.boot.order = vec![BootDevice::Disk, BootDevice::Cdrom, BootDevice::Network];
        }
        
        // Process disks - create disk images if path not provided
        for disk_spec in spec.disks {
            let format = Self::convert_disk_format(disk_spec.format);
            
            let mut disk_config = DiskConfig {
                id: disk_spec.id.clone(),
                path: disk_spec.path.clone(),
                size_gib: disk_spec.size_gib,
                bus: Self::convert_disk_bus(disk_spec.bus),
                format,
                readonly: disk_spec.readonly,
                bootable: disk_spec.bootable,
                // Set backing file if provided (for cloud images)
                backing_file: if disk_spec.backing_file.is_empty() { 
                    None 
                } else { 
                    Some(disk_spec.backing_file.clone()) 
                },
                ..Default::default()
            };
            
            // If no disk path provided, create a new disk image
            if disk_spec.path.is_empty() && (disk_spec.size_gib > 0 || !disk_spec.backing_file.is_empty()) {
                let has_backing = !disk_spec.backing_file.is_empty();
                
                info!(
                    vm_id = %req.vm_id,
                    disk_id = %disk_spec.id,
                    size_gib = disk_spec.size_gib,
                    has_backing = has_backing,
                    "Creating disk image for VM"
                );
                
                match self.storage.create_disk(&req.vm_id, &mut disk_config) {
                    Ok(path) => {
                        info!(
                            vm_id = %req.vm_id,
                            disk_id = %disk_spec.id,
                            path = %path.display(),
                            from_backing = has_backing,
                            "Disk image created successfully"
                        );
                    }
                    Err(e) => {
                        error!(
                            vm_id = %req.vm_id,
                            disk_id = %disk_spec.id,
                            error = %e,
                            "Failed to create disk image"
                        );
                        return Err(Status::internal(format!("Failed to create disk image: {}", e)));
                    }
                }
            }
            
            config.disks.push(disk_config);
        }
        
        // Process cloud-init configuration if provided
        if let Some(cloud_init) = spec.cloud_init {
            if !cloud_init.user_data.is_empty() || !cloud_init.meta_data.is_empty() {
                info!(vm_id = %req.vm_id, "Processing cloud-init configuration");
                
                // Build cloud-init config
                let ci_config = CloudInitConfig {
                    instance_id: req.vm_id.clone(),
                    hostname: req.name.clone(),
                    user_data: cloud_init.user_data,
                    meta_data: if cloud_init.meta_data.is_empty() { 
                        None 
                    } else { 
                        Some(cloud_init.meta_data) 
                    },
                    network_config: if cloud_init.network_config.is_empty() { 
                        None 
                    } else { 
                        Some(cloud_init.network_config) 
                    },
                    vendor_data: if cloud_init.vendor_data.is_empty() { 
                        None 
                    } else { 
                        Some(cloud_init.vendor_data) 
                    },
                    ..Default::default()
                };
                
                // Generate cloud-init ISO
                let generator = CloudInitGenerator::new();
                let vm_dir = self.storage.base_path().join(&req.vm_id);
                
                match generator.generate_iso(&ci_config, &vm_dir) {
                    Ok(iso_path) => {
                        info!(
                            vm_id = %req.vm_id,
                            iso_path = %iso_path.display(),
                            "Cloud-init ISO generated"
                        );
                        
                        // Add cloud-init ISO as a CD-ROM device
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
                            "Failed to generate cloud-init ISO, continuing without it"
                        );
                    }
                }
            }
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
            });
        }
        
        // Process CD-ROMs
        for cdrom_spec in spec.cdroms {
            let cdrom_config = CdromConfig {
                id: cdrom_spec.id,
                iso_path: if cdrom_spec.iso_path.is_empty() { None } else { Some(cdrom_spec.iso_path) },
                bootable: cdrom_spec.bootable,
            };
            config.cdroms.push(cdrom_config);
        }
        
        // Set console configuration
        if let Some(console) = spec.console {
            config.console.vnc_enabled = console.vnc_enabled;
            config.console.vnc_port = if console.vnc_port > 0 { Some(console.vnc_port as u16) } else { None };
            config.console.vnc_password = if console.vnc_password.is_empty() { None } else { Some(console.vnc_password) };
            config.console.spice_enabled = console.spice_enabled;
            config.console.spice_port = if console.spice_port > 0 { Some(console.spice_port as u16) } else { None };
        }
        
        // Create the VM via the hypervisor backend
        info!(
            vm_id = %req.vm_id,
            vm_name = %req.name,
            cpu_cores = config.cpu.total_vcpus(),
            memory_mib = config.memory.size_mib,
            disk_count = config.disks.len(),
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
        
        // Delete disk images
        if let Err(e) = self.storage.delete_vm_disks(vm_id) {
            warn!(vm_id = %vm_id, error = %e, "Failed to delete VM disk images");
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
        
        Ok(Response::new(VmStatusResponse {
            vm_id: status.id,
            name: status.name,
            state: Self::map_vm_state(status.state),
            cpu_usage_percent: 0.0,
            memory_used_bytes: status.memory_rss_bytes,
            memory_total_bytes: status.memory_max_bytes,
            started_at: None,
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
}
