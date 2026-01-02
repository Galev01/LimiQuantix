//! Node Daemon gRPC service implementation.

use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use futures::Stream;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};
use tracing::{info, debug, instrument};

use Quantixkvm_hypervisor::{
    Hypervisor, VmConfig, VmState, DiskConfig, NicConfig,
    DiskBus, DiskFormat, NicModel, StorageManager,
};
use Quantixkvm_telemetry::TelemetryCollector;
use Quantixkvm_proto::{
    NodeDaemonService, HealthCheckRequest, HealthCheckResponse,
    NodeInfoResponse, VmIdRequest, CreateVmRequest, CreateVmResponse,
    StopVmRequest, VmStatusResponse, ListVMsResponse, ConsoleInfoResponse,
    CreateSnapshotRequest, SnapshotResponse, RevertSnapshotRequest,
    DeleteSnapshotRequest, ListSnapshotsResponse, StreamMetricsRequest,
    NodeMetrics, NodeEvent, PowerState,
};

/// Node Daemon gRPC service implementation.
pub struct NodeDaemonServiceImpl {
    node_id: String,
    hostname: String,
    hypervisor: Arc<dyn Hypervisor>,
    telemetry: Arc<TelemetryCollector>,
    storage: StorageManager,
}

impl NodeDaemonServiceImpl {
    /// Create a new service instance.
    pub fn new(
        node_id: String,
        hostname: String,
        hypervisor: Arc<dyn Hypervisor>,
        telemetry: Arc<TelemetryCollector>,
    ) -> Self {
        Self {
            node_id,
            hostname,
            hypervisor,
            telemetry,
            storage: StorageManager::new(),
        }
    }
    
    /// Create a new service instance with a custom storage path.
    pub fn with_storage_path(
        node_id: String,
        hostname: String,
        hypervisor: Arc<dyn Hypervisor>,
        telemetry: Arc<TelemetryCollector>,
        storage_path: impl Into<std::path::PathBuf>,
    ) -> Self {
        Self {
            node_id,
            hostname,
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
        request: Request<CreateVmRequest>,
    ) -> Result<Response<CreateVmResponse>, Status> {
        info!("Creating VM");
        
        let req = request.into_inner();
        
        let mut config = VmConfig::new(&req.name)
            .with_id(&req.vm_id)
            .with_cpu(req.cpu_cores)
            .with_memory(req.memory_mib);
        
        // Add disks - create disk images if path not provided
        for disk in req.disks {
            let format = match disk.format {
                0 => DiskFormat::Qcow2,
                1 => DiskFormat::Raw,
                _ => DiskFormat::Qcow2,
            };
            
            let mut disk_config = DiskConfig {
                id: disk.id.clone(),
                path: disk.path.clone(),
                size_gib: disk.size_gib,
                bus: match disk.bus {
                    0 => DiskBus::Virtio,
                    1 => DiskBus::Scsi,
                    2 => DiskBus::Sata,
                    3 => DiskBus::Ide,
                    _ => DiskBus::Virtio,
                },
                format,
                readonly: disk.readonly,
                bootable: disk.bootable,
                ..Default::default()
            };
            
            // If no disk path provided, create a new disk image
            if disk.path.is_empty() && disk.size_gib > 0 {
                info!(
                    vm_id = %req.vm_id,
                    disk_id = %disk.id,
                    size_gib = disk.size_gib,
                    "Creating disk image for VM"
                );
                
                self.storage.create_disk(&req.vm_id, &mut disk_config)
                    .map_err(|e| Status::internal(format!("Failed to create disk image: {}", e)))?;
            }
            
            config = config.with_disk(disk_config);
        }
        
        // Add NICs
        for nic in req.nics {
            let nic_config = NicConfig {
                id: nic.id,
                mac_address: if nic.mac_address.is_empty() { None } else { Some(nic.mac_address) },
                bridge: if nic.bridge.is_empty() { None } else { Some(nic.bridge) },
                network: if nic.network.is_empty() { None } else { Some(nic.network) },
                model: match nic.model {
                    0 => NicModel::Virtio,
                    1 => NicModel::E1000,
                    2 => NicModel::Rtl8139,
                    _ => NicModel::Virtio,
                },
            };
            config = config.with_nic(nic_config);
        }
        
        let created_id = self.hypervisor.create_vm(config).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
        info!(vm_id = %created_id, "VM created");
        
        Ok(Response::new(CreateVmResponse {
            vm_id: created_id,
            created: true,
            message: "VM created successfully".to_string(),
        }))
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
        self.hypervisor.delete_vm(vm_id).await
            .map_err(|e| Status::internal(e.to_string()))?;
        
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
    ) -> Result<Response<ListVMsResponse>, Status> {
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
        
        Ok(Response::new(ListVMsResponse { vms: responses }))
    }
    
    #[instrument(skip(self, request), fields(vm_id = %request.get_ref().vm_id))]
    async fn get_console(
        &self,
        request: Request<VmIdRequest>,
    ) -> Result<Response<ConsoleInfoResponse>, Status> {
        let vm_id = &request.into_inner().vm_id;
        
        let console = self.hypervisor.get_console(vm_id).await
            .map_err(|e| Status::not_found(e.to_string()))?;
        
        Ok(Response::new(ConsoleInfoResponse {
            console_type: match console.console_type {
                Quantixkvm_hypervisor::ConsoleType::Vnc => "vnc".to_string(),
                Quantixkvm_hypervisor::ConsoleType::Spice => "spice".to_string(),
            },
            host: console.host,
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
                let vm_metrics: Vec<Quantixkvm_proto::VmMetrics> = vms.into_iter().map(|vm| {
                    Quantixkvm_proto::VmMetrics {
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
