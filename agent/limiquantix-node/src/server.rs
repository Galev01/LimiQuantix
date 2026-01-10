//! gRPC and HTTP server setup and lifecycle.

use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use tonic::transport::Server;
use tracing::{info, warn, error};

use limiquantix_hypervisor::{Hypervisor, MockBackend};
use limiquantix_proto::NodeDaemonServiceServer;
use limiquantix_telemetry::TelemetryCollector;

use crate::config::{Config, HypervisorBackend};
use crate::event_store::{init_event_store, emit_event, Event, EventLevel, EventCategory};
use crate::http_server;
use crate::registration::{RegistrationClient, detect_management_ip};
use crate::service::NodeDaemonServiceImpl;

/// Run the gRPC server.
pub async fn run(config: Config) -> Result<()> {
    // Initialize event store with optional persistence
    let event_persistence_path = std::path::PathBuf::from("/var/lib/limiquantix/events.json");
    init_event_store(Some(event_persistence_path));
    
    emit_event(Event::new(
        EventLevel::Info,
        EventCategory::System,
        format!("Node daemon starting (version {})", env!("CARGO_PKG_VERSION")),
        "qx-node"
    ));
    
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
                
                // Try to connect to libvirt, but don't crash if it fails
                // The web UI should still work even without hypervisor connectivity
                match limiquantix_hypervisor::LibvirtBackend::new(uri).await {
                    Ok(backend) => {
                        info!("Successfully connected to libvirt");
                        emit_event(Event::new(
                            EventLevel::Info,
                            EventCategory::System,
                            "Connected to libvirt hypervisor".to_string(),
                            "qx-node"
                        ));
                        Arc::new(backend) as Arc<dyn Hypervisor>
                    }
                    Err(e) => {
                        // Log error but don't crash - fall back to mock backend
                        error!(error = %e, "Failed to connect to libvirt - web UI will still work but VM operations will fail");
                        emit_event(Event::new(
                            EventLevel::Warning,
                            EventCategory::System,
                            format!("Failed to connect to libvirt: {}. VM operations unavailable.", e),
                            "qx-node"
                        ));
                        warn!("Falling back to mock hypervisor backend");
                        Arc::new(MockBackend::new()) as Arc<dyn Hypervisor>
                    }
                }
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
    
    // Start background telemetry refresh task (every 2 seconds for accurate CPU metrics)
    let _telemetry_handle = telemetry.start_background_refresh(std::time::Duration::from_secs(2));
    info!("Started background telemetry refresh task (2s interval)");
    
    // Collect initial telemetry
    let node_info = telemetry.collect();
    info!(
        hostname = %node_info.system.hostname,
        os = %node_info.system.os_name,
        cpus = %node_info.cpu.logical_cores,
        memory_gb = %(node_info.memory.total_bytes / 1024 / 1024 / 1024),
        cpu_usage = %node_info.cpu.usage_percent,
        "Node telemetry collected"
    );
    
    // Create service implementation
    let node_id = config.node.get_id();
    let hostname = config.node.get_hostname();
    let management_ip = detect_management_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    
    info!(management_ip = %management_ip, "Detected management IP");
    
    // Clone hypervisor before moving into service (needed for registration)
    let hypervisor_for_registration = hypervisor.clone();
    
    let service = Arc::new(NodeDaemonServiceImpl::new(
        node_id.clone(),
        hostname.clone(),
        management_ip.clone(),
        hypervisor,
        telemetry.clone(),
    ));
    
    // Auto-detect storage pools (NFS mounts, local storage)
    service.init_storage_auto_detect().await;
    
    // Parse gRPC listen address
    let grpc_addr: std::net::SocketAddr = config.server.listen_address.parse()
        .map_err(|e| anyhow::anyhow!("Invalid gRPC listen address: {}", e))?;
    
    info!(
        grpc_address = %grpc_addr,
        node_id = %node_id,
        hostname = %hostname,
        "Starting gRPC server"
    );
    
    // Start control plane registration in the background (if enabled)
    if config.control_plane.registration_enabled {
        // Get storage manager from service for heartbeat reporting
        let storage_for_registration = service.get_storage_manager();
        
        let registration_client = RegistrationClient::new(
            &config, 
            telemetry.clone(),
            hypervisor_for_registration,
            storage_for_registration,
        );
        
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
    
    // Clone service for HTTP/HTTPS servers
    let http_service = service.clone();
    let https_service = service.clone();
    
    let webui_path = PathBuf::from(&config.server.http.webui_path);
    let tls_config = config.server.http.tls.clone();
    let host = if management_ip == "0.0.0.0" { "localhost" } else { &management_ip };
    
    // Track server handles for cleanup
    let mut server_handles = Vec::new();
    
    // Start HTTP server on port 8080 (if enabled - default)
    if config.server.http.enabled {
        let http_addr: std::net::SocketAddr = config.server.http.listen_address.parse()
            .map_err(|e| anyhow::anyhow!("Invalid HTTP listen address: {}", e))?;
        
        let webui_path_http = webui_path.clone();
        let tls_config_http = tls_config.clone();
        let telemetry_http = telemetry.clone();
        
        info!(
            address = %http_addr,
            webui_path = %webui_path_http.display(),
            "Starting HTTP server for Web UI"
        );
        
        info!(
            "🌐 HTTP URL: http://{}:{}",
            host, http_addr.port()
        );
        
        server_handles.push(tokio::spawn(async move {
            if let Err(e) = http_server::run_http_server(http_addr, http_service, webui_path_http, tls_config_http, telemetry_http).await {
                error!(error = %e, "HTTP server failed");
            }
        }));
    } else {
        info!("HTTP server (port 8080) disabled");
    }
    
    // Start HTTPS server on port 8443 (if TLS enabled)
    if tls_config.enabled {
        let https_addr: std::net::SocketAddr = tls_config.listen_address.parse()
            .map_err(|e| anyhow::anyhow!("Invalid HTTPS listen address: {}", e))?;
        
        let webui_path_https = webui_path.clone();
        let tls_config_https = tls_config.clone();
        let telemetry_https = telemetry.clone();
        
        info!(
            address = %https_addr,
            cert = %tls_config.cert_path,
            "Starting HTTPS server for Web UI"
        );
        
        info!(
            "🔒 HTTPS URL: https://{}:{}",
            host, https_addr.port()
        );
        
        // Start HTTP→HTTPS redirect server if enabled
        if tls_config.redirect_http {
            let redirect_addr = std::net::SocketAddr::from(([0, 0, 0, 0], tls_config.redirect_port));
            let https_port = https_addr.port();
            
            info!(
                "↪️  HTTP redirect: http://{}:{} → https://{}:{}",
                host, tls_config.redirect_port,
                host, https_port
            );
            
            server_handles.push(tokio::spawn(async move {
                http_server::run_redirect_server(redirect_addr, https_port).await;
            }));
        }
        
        server_handles.push(tokio::spawn(async move {
            if let Err(e) = http_server::run_https_server(https_addr, https_service, webui_path_https, tls_config_https, telemetry_https).await {
                error!(error = %e, "HTTPS server failed");
            }
        }));
    } else {
        info!("HTTPS server (port 8443) disabled - use --enable-https to enable");
    }
    
    // Ensure at least one server is running
    if server_handles.is_empty() && !config.server.http.enabled && !tls_config.enabled {
        warn!("Both HTTP and HTTPS servers are disabled - Web UI will not be accessible");
    }
    
    // Start gRPC server (this blocks)
    let grpc_result = Server::builder()
        .add_service(NodeDaemonServiceServer::new(service.as_ref().clone()))
        .serve(grpc_addr)
        .await;
    
    // If gRPC server exits, stop all HTTP/HTTPS servers
    for handle in server_handles {
        handle.abort();
    }
    
    grpc_result.map_err(|e| anyhow::anyhow!("gRPC server error: {}", e))?;
    
    Ok(())
}
