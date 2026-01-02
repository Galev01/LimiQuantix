//! gRPC server setup and lifecycle.

use anyhow::Result;
use std::sync::Arc;
use tonic::transport::Server;
use tracing::{info, warn};

use limiquantix_hypervisor::{Hypervisor, MockBackend};
use limiquantix_proto::NodeDaemonServiceServer;
use limiquantix_telemetry::TelemetryCollector;

use crate::config::{Config, HypervisorBackend};
use crate::registration::RegistrationClient;
use crate::service::NodeDaemonServiceImpl;

/// Run the gRPC server.
pub async fn run(config: Config) -> Result<()> {
    // Initialize hypervisor backend
    let hypervisor: Arc<dyn Hypervisor> = match config.hypervisor.backend {
        HypervisorBackend::Mock => {
            info!("Using mock hypervisor backend");
            Arc::new(MockBackend::new())
        }
        HypervisorBackend::Libvirt => {
            #[cfg(feature = "libvirt")]
            {
                let uri = config.hypervisor.libvirt_uri.as_deref()
                    .unwrap_or("qemu:///system");
                info!(uri = %uri, "Connecting to libvirt");
                Arc::new(limiquantix_hypervisor::LibvirtBackend::new(uri).await?)
            }
            #[cfg(not(feature = "libvirt"))]
            {
                warn!("Libvirt backend requested but not compiled in, falling back to mock");
                Arc::new(MockBackend::new())
            }
        }
        HypervisorBackend::CloudHypervisor => {
            warn!("Cloud Hypervisor backend not yet implemented, falling back to mock");
            Arc::new(MockBackend::new())
        }
    };
    
    // Check hypervisor health
    if let Ok(healthy) = hypervisor.health_check().await {
        if healthy {
            if let Ok(caps) = hypervisor.capabilities().await {
                info!(
                    name = %caps.name,
                    version = %caps.version,
                    live_migration = %caps.supports_live_migration,
                    snapshots = %caps.supports_snapshots,
                    "Hypervisor capabilities"
                );
            }
        }
    }
    
    // Initialize telemetry collector
    let telemetry = Arc::new(TelemetryCollector::new());
    
    // Collect initial telemetry
    let node_info = telemetry.collect();
    info!(
        hostname = %node_info.system.hostname,
        os = %node_info.system.os_name,
        cpus = %node_info.cpu.logical_cores,
        memory_gb = %(node_info.memory.total_bytes / 1024 / 1024 / 1024),
        "Node telemetry collected"
    );
    
    // Create service implementation
    let node_id = config.node.get_id();
    let hostname = config.node.get_hostname();
    
    let service = NodeDaemonServiceImpl::new(
        node_id.clone(),
        hostname.clone(),
        hypervisor,
        telemetry.clone(),
    );
    
    // Parse listen address
    let addr: std::net::SocketAddr = config.server.listen_address.parse()
        .map_err(|e| anyhow::anyhow!("Invalid listen address: {}", e))?;
    
    info!(
        address = %addr,
        node_id = %node_id,
        hostname = %hostname,
        "Starting gRPC server"
    );
    
    // Start control plane registration in the background (if enabled)
    if config.control_plane.registration_enabled {
        let registration_client = RegistrationClient::new(&config, telemetry.clone());
        
        info!(
            control_plane = %config.control_plane.address,
            heartbeat_interval_secs = config.control_plane.heartbeat_interval_secs,
            "Starting control plane registration"
        );
        
        // Spawn registration task in background
        tokio::spawn(async move {
            registration_client.run().await;
        });
    } else {
        info!("Control plane registration disabled");
    }
    
    // Start gRPC server
    Server::builder()
        .add_service(NodeDaemonServiceServer::new(service))
        .serve(addr)
        .await
        .map_err(|e| anyhow::anyhow!("gRPC server error: {}", e))?;
    
    Ok(())
}
