//! HTTP Server for Web UI
//!
//! This module provides:
//! - Static file serving for the React-based Host UI
//! - REST API endpoints that proxy to the gRPC service
//! - WebSocket support for real-time updates (future)
//!
//! The HTTP server runs on port 8443 alongside the gRPC server on port 9443.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    Router,
    routing::{get, post},
    extract::{Path, State},
    http::{StatusCode, header, Method},
    response::{IntoResponse, Response, Json},
    body::Body,
};
use tower_http::{
    cors::{CorsLayer, Any},
    trace::TraceLayer,
    services::ServeDir,
};
use tokio::fs;
use tracing::{info, error};
use serde::{Deserialize, Serialize};

use crate::service::NodeDaemonServiceImpl;

/// Shared state for HTTP handlers
pub struct AppState {
    /// Reference to the node daemon service
    pub service: Arc<NodeDaemonServiceImpl>,
    /// Path to webui static files
    pub webui_path: PathBuf,
}

// ============================================================================
// API Response Types
// ============================================================================

#[derive(Serialize)]
struct ApiError {
    error: String,
    message: String,
}

impl ApiError {
    fn new(error: &str, message: &str) -> Self {
        Self {
            error: error.to_string(),
            message: message.to_string(),
        }
    }
}

#[derive(Serialize)]
struct HostInfo {
    node_id: String,
    hostname: String,
    management_ip: String,
    cpu_model: String,
    cpu_cores: u32,
    memory_total_bytes: u64,
    memory_available_bytes: u64,
    os_name: String,
    os_version: String,
    kernel_version: String,
    uptime_seconds: u64,
    hypervisor_name: String,
    hypervisor_version: String,
}

// Hardware inventory types
#[derive(Serialize)]
struct HardwareInventory {
    cpu: CpuInfo,
    memory: MemoryInfo,
    storage: Vec<DiskInfo>,
    network: Vec<NicInfo>,
    gpus: Vec<GpuInfo>,
    pci_devices: Vec<PciDevice>,
}

#[derive(Serialize)]
struct CpuInfo {
    model: String,
    vendor: String,
    cores: u32,
    threads: u32,
    sockets: u32,
    frequency_mhz: u64,
    features: Vec<String>,
    architecture: String,
}

#[derive(Serialize)]
struct MemoryInfo {
    total_bytes: u64,
    available_bytes: u64,
    used_bytes: u64,
    swap_total_bytes: u64,
    swap_used_bytes: u64,
    ecc_enabled: bool,
    dimm_count: u32,
}

#[derive(Serialize)]
struct DiskInfo {
    name: String,
    model: String,
    serial: String,
    size_bytes: u64,
    disk_type: String,  // "HDD", "SSD", "NVMe"
    interface: String,  // "SATA", "NVMe", "USB"
    is_removable: bool,
    smart_status: String,
    partitions: Vec<PartitionInfo>,
}

#[derive(Serialize)]
struct PartitionInfo {
    name: String,
    mount_point: Option<String>,
    size_bytes: u64,
    used_bytes: u64,
    filesystem: String,
}

#[derive(Serialize)]
struct NicInfo {
    name: String,
    mac_address: String,
    driver: String,
    speed_mbps: Option<u64>,
    link_state: String,
    pci_address: Option<String>,
    sriov_capable: bool,
    sriov_vfs: u32,
}

#[derive(Serialize)]
struct GpuInfo {
    name: String,
    vendor: String,
    pci_address: String,
    driver: String,
    memory_bytes: Option<u64>,
    passthrough_capable: bool,
}

#[derive(Serialize)]
struct PciDevice {
    address: String,
    vendor: String,
    device: String,
    class: String,
    driver: Option<String>,
    iommu_group: Option<u32>,
}

#[derive(Serialize)]
struct HealthResponse {
    healthy: bool,
    version: String,
    hypervisor: String,
    hypervisor_version: String,
    uptime_seconds: u64,
}

#[derive(Serialize)]
struct HostMetricsResponse {
    timestamp: String,
    cpu_usage_percent: f64,
    memory_used_bytes: u64,
    memory_total_bytes: u64,
    memory_usage_percent: f64,
    disk_read_bytes_per_sec: u64,
    disk_write_bytes_per_sec: u64,
    network_rx_bytes_per_sec: u64,
    network_tx_bytes_per_sec: u64,
    load_average_1min: f64,
    load_average_5min: f64,
    load_average_15min: f64,
    vm_count: u32,
    vm_running_count: u32,
}

#[derive(Serialize)]
struct EventResponse {
    event_id: String,
    timestamp: String,
    level: String,
    category: String,
    message: String,
    source: String,
    details: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct EventListResponse {
    events: Vec<EventResponse>,
    total_count: u32,
}

#[derive(Serialize, Deserialize)]
struct SettingsResponse {
    node_name: String,
    node_id: String,
    grpc_listen: String,
    http_listen: String,
    log_level: String,
    storage_default_pool: Option<String>,
    network_default_bridge: Option<String>,
    vnc_listen_address: String,
    vnc_port_range_start: u16,
    vnc_port_range_end: u16,
}

#[derive(Deserialize)]
struct UpdateSettingsRequest {
    node_name: Option<String>,
    log_level: Option<String>,
    storage_default_pool: Option<String>,
    network_default_bridge: Option<String>,
    vnc_listen_address: Option<String>,
}

#[derive(Serialize)]
struct ServiceInfo {
    name: String,
    status: String,
    enabled: bool,
    description: String,
}

#[derive(Serialize)]
struct ServiceListResponse {
    services: Vec<ServiceInfo>,
}

#[derive(Serialize)]
struct VmResponse {
    vm_id: String,
    name: String,
    state: String,
    cpu_usage_percent: f64,
    memory_used_bytes: u64,
    memory_total_bytes: u64,
    guest_agent: Option<GuestAgentInfo>,
}

#[derive(Serialize)]
struct GuestAgentInfo {
    connected: bool,
    version: String,
    os_name: String,
    hostname: String,
    ip_addresses: Vec<String>,
}

#[derive(Serialize)]
struct VmListResponse {
    vms: Vec<VmResponse>,
}

#[derive(Serialize)]
struct ConsoleResponse {
    console_type: String,
    host: String,
    port: u32,
    password: String,
    websocket_path: String,
}

#[derive(Serialize)]
struct StoragePoolResponse {
    pool_id: String,
    #[serde(rename = "type")]
    pool_type: String,
    mount_path: String,
    total_bytes: u64,
    available_bytes: u64,
    used_bytes: u64,
    volume_count: u32,
}

#[derive(Serialize)]
struct StoragePoolListResponse {
    pools: Vec<StoragePoolResponse>,
}

#[derive(Deserialize)]
struct CreateStoragePoolRequest {
    pool_id: String,
    #[serde(rename = "type")]
    pool_type: String,  // "LOCAL_DIR", "NFS", "CEPH_RBD", "ISCSI"
    path: Option<String>,
    nfs_server: Option<String>,
    nfs_export: Option<String>,
}

#[derive(Serialize)]
struct VolumeResponse {
    volume_id: String,
    pool_id: String,
    size_bytes: u64,
    format: String,
    path: String,
    attached_to: Option<String>,
}

#[derive(Serialize)]
struct VolumeListResponse {
    volumes: Vec<VolumeResponse>,
}

#[derive(Deserialize)]
struct CreateVolumeRequest {
    volume_id: String,
    size_bytes: u64,
    format: Option<String>,  // "qcow2", "raw"
}

#[derive(Serialize)]
struct ImageResponse {
    image_id: String,
    name: String,
    path: String,
    size_bytes: u64,
    format: String,
}

#[derive(Serialize)]
struct ImageListResponse {
    images: Vec<ImageResponse>,
}

// ============================================================================
// Request Types
// ============================================================================

#[derive(Deserialize)]
struct StopVmRequest {
    timeout_seconds: Option<u32>,
}

#[derive(Deserialize)]
struct CreateVmRequest {
    name: String,
    cpu_cores: u32,
    cpu_sockets: Option<u32>,
    memory_mib: u64,
    disks: Vec<DiskSpecRequest>,
    nics: Vec<NicSpecRequest>,
    cloud_init: Option<CloudInitRequest>,
}

#[derive(Deserialize)]
struct DiskSpecRequest {
    id: String,
    size_gib: u64,
    bus: Option<String>,
    format: Option<String>,
    backing_file: Option<String>,
    bootable: Option<bool>,
}

#[derive(Deserialize)]
struct NicSpecRequest {
    id: String,
    network: Option<String>,
    bridge: Option<String>,
    mac_address: Option<String>,
    model: Option<String>,
}

#[derive(Deserialize)]
struct CloudInitRequest {
    user_data: Option<String>,
    meta_data: Option<String>,
    network_config: Option<String>,
}

#[derive(Deserialize)]
struct CreateSnapshotRequest {
    name: String,
    description: Option<String>,
    quiesce: Option<bool>,
}

#[derive(Serialize)]
struct SnapshotResponse {
    snapshot_id: String,
    name: String,
    description: String,
    created_at: String,
    vm_state: String,
    parent_id: Option<String>,
}

#[derive(Serialize)]
struct SnapshotListResponse {
    snapshots: Vec<SnapshotResponse>,
}

// ============================================================================
// Cluster Types
// ============================================================================

#[derive(Serialize, Deserialize)]
struct ClusterConfig {
    enabled: bool,
    control_plane_address: String,
    node_id: Option<String>,
    registration_token: Option<String>,
    heartbeat_interval_secs: u32,
}

#[derive(Deserialize)]
struct JoinClusterRequest {
    control_plane_address: String,
    registration_token: String,
}

#[derive(Serialize)]
struct ClusterStatus {
    joined: bool,
    control_plane_address: Option<String>,
    node_id: Option<String>,
    last_heartbeat: Option<String>,
    status: String,  // "connected", "disconnected", "standalone"
}

// ============================================================================
// Network Types
// ============================================================================

#[derive(Serialize)]
struct NetworkInterface {
    name: String,
    mac_address: String,
    #[serde(rename = "type")]
    interface_type: String,  // "ethernet", "bridge", "bond", "vlan"
    state: String,           // "up", "down"
    ip_addresses: Vec<String>,
    mtu: u32,
    speed_mbps: Option<u64>,
}

#[derive(Serialize)]
struct NetworkInterfaceList {
    interfaces: Vec<NetworkInterface>,
}

#[derive(Deserialize)]
struct ConfigureInterfaceRequest {
    dhcp: bool,
    ip_address: Option<String>,
    netmask: Option<String>,
    gateway: Option<String>,
}

#[derive(Deserialize)]
struct CreateBridgeRequest {
    name: String,
    interfaces: Vec<String>,  // Physical interfaces to add to bridge
}

#[derive(Serialize, Deserialize)]
struct DnsConfig {
    nameservers: Vec<String>,
    search_domains: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct HostnameConfig {
    hostname: String,
}

// ============================================================================
// HTTP Server
// ============================================================================

/// Start the HTTP server for Web UI
pub async fn run_http_server(
    listen_addr: SocketAddr,
    service: Arc<NodeDaemonServiceImpl>,
    webui_path: PathBuf,
) -> anyhow::Result<()> {
    let state = Arc::new(AppState {
        service,
        webui_path: webui_path.clone(),
    });

    // CORS configuration for development
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any);

    // API routes
    let api_routes = Router::new()
        // Host endpoints
        .route("/host", get(get_host_info))
        .route("/host/health", get(get_host_health))
        .route("/host/hardware", get(get_hardware_inventory))
        .route("/host/metrics", get(get_host_metrics))
        .route("/host/reboot", post(reboot_host))
        .route("/host/shutdown", post(shutdown_host))
        // Events endpoint
        .route("/events", get(list_events))
        // VM endpoints
        .route("/vms", get(list_vms))
        .route("/vms", post(create_vm))
        .route("/vms/:vm_id", get(get_vm))
        .route("/vms/:vm_id", axum::routing::delete(delete_vm))
        .route("/vms/:vm_id/start", post(start_vm))
        .route("/vms/:vm_id/stop", post(stop_vm))
        .route("/vms/:vm_id/force-stop", post(force_stop_vm))
        .route("/vms/:vm_id/reboot", post(reboot_vm))
        .route("/vms/:vm_id/pause", post(pause_vm))
        .route("/vms/:vm_id/resume", post(resume_vm))
        .route("/vms/:vm_id/console", get(get_vm_console))
        .route("/vms/:vm_id/snapshots", get(list_snapshots))
        .route("/vms/:vm_id/snapshots", post(create_snapshot))
        .route("/vms/:vm_id/snapshots/:snapshot_id", axum::routing::delete(delete_snapshot))
        .route("/vms/:vm_id/snapshots/:snapshot_id/revert", post(revert_snapshot))
        // Storage endpoints
        .route("/storage/pools", get(list_storage_pools))
        .route("/storage/pools", post(create_storage_pool))
        .route("/storage/pools/:pool_id", get(get_storage_pool))
        .route("/storage/pools/:pool_id", axum::routing::delete(delete_storage_pool))
        .route("/storage/pools/:pool_id/volumes", get(list_volumes))
        .route("/storage/pools/:pool_id/volumes", post(create_volume))
        .route("/storage/pools/:pool_id/volumes/:volume_id", axum::routing::delete(delete_volume))
        .route("/storage/images", get(list_images))
        // Network endpoints
        .route("/network/interfaces", get(list_network_interfaces))
        .route("/network/interfaces/:name", get(get_network_interface))
        .route("/network/interfaces/:name/configure", post(configure_network_interface))
        .route("/network/bridges", post(create_bridge))
        .route("/network/dns", get(get_dns_config))
        .route("/network/dns", post(set_dns_config))
        .route("/network/hostname", get(get_hostname))
        .route("/network/hostname", post(set_hostname))
        // Cluster endpoints
        .route("/cluster/status", get(get_cluster_status))
        .route("/cluster/join", post(join_cluster))
        .route("/cluster/leave", post(leave_cluster))
        .route("/cluster/config", get(get_cluster_config))
        // Settings endpoints
        .route("/settings", get(get_settings))
        .route("/settings", post(update_settings))
        .route("/settings/services", get(list_services))
        .route("/settings/services/:name/restart", post(restart_service))
        .with_state(state.clone());

    // Check if webui directory exists
    let webui_exists = webui_path.exists();
    if webui_exists {
        info!(path = %webui_path.display(), "Serving Web UI from static files");
    } else {
        info!(path = %webui_path.display(), "Web UI path not found, API-only mode");
    }

    // Build the main router
    let app = if webui_exists {
        // Serve static files and API
        Router::new()
            .nest("/api/v1", api_routes)
            // Serve static files from webui directory
            .nest_service("/assets", ServeDir::new(webui_path.join("assets")))
            // Fallback to index.html for SPA routing
            .fallback(get(serve_index))
            .with_state(state)
    } else {
        // API only mode (no static files)
        Router::new()
            .nest("/api/v1", api_routes)
            .fallback(get(api_only_fallback))
            .with_state(state)
    };

    let app = app
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    info!(address = %listen_addr, "Starting HTTP server for Web UI");

    let listener = tokio::net::TcpListener::bind(listen_addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// ============================================================================
// Static File Handlers
// ============================================================================

/// Serve index.html for SPA fallback
async fn serve_index(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let index_path = state.webui_path.join("index.html");
    
    match fs::read(&index_path).await {
        Ok(contents) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .body(Body::from(contents))
            .unwrap(),
        Err(e) => {
            error!(error = %e, path = %index_path.display(), "Failed to read index.html");
            Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header(header::CONTENT_TYPE, "text/html")
                .body(Body::from("<h1>Web UI not found</h1><p>The Quantix Host UI is not installed.</p>"))
                .unwrap()
        }
    }
}

/// Fallback for API-only mode
async fn api_only_fallback() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        Json(serde_json::json!({
            "message": "Quantix Node Daemon API",
            "version": env!("CARGO_PKG_VERSION"),
            "webui": false,
            "api_docs": "/api/v1"
        }))
    )
}

// ============================================================================
// Host API Handlers
// ============================================================================

/// GET /api/v1/host - Get host information
async fn get_host_info(
    State(state): State<Arc<AppState>>,
) -> Result<Json<HostInfo>, (StatusCode, Json<ApiError>)> {
    // Get telemetry from the service
    let telemetry = state.service.get_telemetry();
    
    // Call the local health check method (not gRPC)
    match state.service.health_check().await {
        Ok(health) => {
            Ok(Json(HostInfo {
                node_id: state.service.get_node_id().to_string(),
                hostname: telemetry.system.hostname.clone(),
                management_ip: local_ip_address::local_ip()
                    .map(|ip| ip.to_string())
                    .unwrap_or_else(|_| "127.0.0.1".to_string()),
                cpu_model: telemetry.cpu.model.clone(),
                cpu_cores: telemetry.cpu.logical_cores as u32,
                memory_total_bytes: telemetry.memory.total_bytes,
                memory_available_bytes: telemetry.memory.available_bytes,
                os_name: telemetry.system.os_name.clone(),
                os_version: telemetry.system.os_version.clone(),
                kernel_version: telemetry.system.kernel_version.clone(),
                uptime_seconds: health.uptime_seconds,
                hypervisor_name: health.hypervisor,
                hypervisor_version: health.hypervisor_version,
            }))
        }
        Err(e) => {
            error!(error = %e, "Failed to get host info");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("internal_error", &e.to_string())),
            ))
        }
    }
}

/// GET /api/v1/host/health - Health check
async fn get_host_health(
    State(state): State<Arc<AppState>>,
) -> Result<Json<HealthResponse>, (StatusCode, Json<ApiError>)> {
    // Call the local health check method (not gRPC)
    match state.service.health_check().await {
        Ok(health) => {
            Ok(Json(HealthResponse {
                healthy: health.healthy,
                version: health.version,
                hypervisor: health.hypervisor,
                hypervisor_version: health.hypervisor_version,
                uptime_seconds: health.uptime_seconds,
            }))
        }
        Err(e) => {
            error!(error = %e, "Health check failed");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("health_check_failed", &e.to_string())),
            ))
        }
    }
}

/// GET /api/v1/host/hardware - Get full hardware inventory
async fn get_hardware_inventory(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<HardwareInventory>, (StatusCode, Json<ApiError>)> {
    use sysinfo::{System, Disks, Networks, Cpu};
    
    let mut sys = System::new_all();
    sys.refresh_all();
    
    // CPU Info
    let first_cpu: Option<&Cpu> = sys.cpus().first();
    let cpu_info = CpuInfo {
        model: first_cpu.map(|c| c.brand().to_string()).unwrap_or_default(),
        vendor: first_cpu.map(|c| c.vendor_id().to_string()).unwrap_or_default(),
        cores: sys.physical_core_count().unwrap_or(0) as u32,
        threads: sys.cpus().len() as u32,
        sockets: 1, // sysinfo doesn't provide this directly
        frequency_mhz: first_cpu.map(|c| c.frequency()).unwrap_or(0),
        features: get_cpu_features(),
        architecture: std::env::consts::ARCH.to_string(),
    };
    
    // Memory Info
    let memory_info = MemoryInfo {
        total_bytes: sys.total_memory(),
        available_bytes: sys.available_memory(),
        used_bytes: sys.used_memory(),
        swap_total_bytes: sys.total_swap(),
        swap_used_bytes: sys.used_swap(),
        ecc_enabled: false, // Would need dmidecode to detect
        dimm_count: 0,      // Would need dmidecode to detect
    };
    
    // Storage Info
    let disks = Disks::new_with_refreshed_list();
    let mut storage: Vec<DiskInfo> = Vec::new();
    
    for disk in disks.list() {
        let disk_name = disk.name().to_string_lossy().to_string();
        let mount_point = disk.mount_point().to_string_lossy().to_string();
        
        // Try to determine disk type
        let disk_type = if disk_name.contains("nvme") {
            "NVMe"
        } else if disk_name.contains("sd") {
            // Could be SSD or HDD - would need to check /sys/block/*/queue/rotational
            "SSD/HDD"
        } else {
            "Unknown"
        }.to_string();
        
        storage.push(DiskInfo {
            name: disk_name.clone(),
            model: String::new(), // Would need lsblk -o MODEL
            serial: String::new(),
            size_bytes: disk.total_space(),
            disk_type,
            interface: if disk_name.contains("nvme") { "NVMe" } else { "SATA" }.to_string(),
            is_removable: disk.is_removable(),
            smart_status: "Unknown".to_string(),
            partitions: vec![PartitionInfo {
                name: disk_name.clone(),
                mount_point: Some(mount_point),
                size_bytes: disk.total_space(),
                used_bytes: disk.total_space() - disk.available_space(),
                filesystem: disk.file_system().to_string_lossy().to_string(),
            }],
        });
    }
    
    // Network Info
    let networks = Networks::new_with_refreshed_list();
    let mut network: Vec<NicInfo> = Vec::new();
    
    for (iface_name, _data) in networks.list() {
        // Get more info from /sys/class/net
        let driver = std::fs::read_to_string(format!("/sys/class/net/{}/device/driver/module", iface_name))
            .map(|s| s.trim().to_string())
            .ok();
        
        let speed = std::fs::read_to_string(format!("/sys/class/net/{}/speed", iface_name))
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok());
        
        let operstate = std::fs::read_to_string(format!("/sys/class/net/{}/operstate", iface_name))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| "unknown".to_string());
        
        let mac = std::fs::read_to_string(format!("/sys/class/net/{}/address", iface_name))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        
        // Check for SR-IOV capability
        let sriov_capable = std::path::Path::new(&format!("/sys/class/net/{}/device/sriov_numvfs", iface_name)).exists();
        let sriov_vfs = std::fs::read_to_string(format!("/sys/class/net/{}/device/sriov_numvfs", iface_name))
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0);
        
        network.push(NicInfo {
            name: iface_name.clone(),
            mac_address: mac,
            driver: driver.unwrap_or_default(),
            speed_mbps: speed,
            link_state: operstate,
            pci_address: None,
            sriov_capable,
            sriov_vfs,
        });
    }
    
    // GPU Info - parse lspci output
    let gpus = get_gpu_info();
    
    // PCI Devices - get passthrough-capable devices
    let pci_devices = get_pci_devices();
    
    Ok(Json(HardwareInventory {
        cpu: cpu_info,
        memory: memory_info,
        storage,
        network,
        gpus,
        pci_devices,
    }))
}

fn get_cpu_features() -> Vec<String> {
    // Read from /proc/cpuinfo
    if let Ok(cpuinfo) = std::fs::read_to_string("/proc/cpuinfo") {
        for line in cpuinfo.lines() {
            if line.starts_with("flags") || line.starts_with("Features") {
                if let Some(flags) = line.split(':').nth(1) {
                    return flags.split_whitespace()
                        .take(20) // Limit to first 20 features
                        .map(|s| s.to_string())
                        .collect();
                }
            }
        }
    }
    Vec::new()
}

fn get_gpu_info() -> Vec<GpuInfo> {
    use std::process::Command;
    
    let output = Command::new("lspci")
        .args(&["-nn", "-D"])
        .output();
    
    let mut gpus = Vec::new();
    
    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("VGA") || line.contains("3D controller") || line.contains("Display") {
                let parts: Vec<&str> = line.splitn(2, ' ').collect();
                if parts.len() >= 2 {
                    let address = parts[0].to_string();
                    let name = parts[1].to_string();
                    
                    let vendor = if name.contains("NVIDIA") {
                        "NVIDIA"
                    } else if name.contains("AMD") || name.contains("ATI") {
                        "AMD"
                    } else if name.contains("Intel") {
                        "Intel"
                    } else {
                        "Unknown"
                    }.to_string();
                    
                    // Check if passthrough capable (has IOMMU group)
                    let iommu_path = format!("/sys/bus/pci/devices/{}/iommu_group", address);
                    let passthrough_capable = std::path::Path::new(&iommu_path).exists();
                    
                    gpus.push(GpuInfo {
                        name,
                        vendor,
                        pci_address: address,
                        driver: String::new(),
                        memory_bytes: None,
                        passthrough_capable,
                    });
                }
            }
        }
    }
    
    gpus
}

fn get_pci_devices() -> Vec<PciDevice> {
    use std::process::Command;
    
    let output = Command::new("lspci")
        .args(&["-nn", "-D", "-k"])
        .output();
    
    let mut devices = Vec::new();
    
    if let Ok(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut current_device: Option<PciDevice> = None;
        
        for line in stdout.lines() {
            if !line.starts_with('\t') && !line.starts_with(' ') {
                // New device line
                if let Some(dev) = current_device.take() {
                    devices.push(dev);
                }
                
                let parts: Vec<&str> = line.splitn(2, ' ').collect();
                if parts.len() >= 2 {
                    let address = parts[0].to_string();
                    let rest = parts[1];
                    
                    // Parse class and device name
                    let class_end = rest.find(':').unwrap_or(rest.len());
                    let class = rest[..class_end].to_string();
                    let device = rest[class_end..].trim_start_matches(':').trim().to_string();
                    
                    // Check IOMMU group
                    let iommu_path = format!("/sys/bus/pci/devices/{}/iommu_group", address);
                    let iommu_group = std::fs::read_link(&iommu_path)
                        .ok()
                        .and_then(|p| p.file_name()?.to_str()?.parse::<u32>().ok());
                    
                    current_device = Some(PciDevice {
                        address,
                        vendor: String::new(),
                        device,
                        class,
                        driver: None,
                        iommu_group,
                    });
                }
            } else if line.contains("Kernel driver in use:") {
                if let Some(ref mut dev) = current_device {
                    dev.driver = line.split(':').nth(1).map(|s| s.trim().to_string());
                }
            }
        }
        
        if let Some(dev) = current_device {
            devices.push(dev);
        }
    }
    
    // Filter to interesting devices (GPUs, network, USB controllers, storage controllers)
    devices.into_iter()
        .filter(|d| {
            d.class.contains("VGA") || 
            d.class.contains("3D") ||
            d.class.contains("Network") ||
            d.class.contains("Ethernet") ||
            d.class.contains("USB") ||
            d.class.contains("SATA") ||
            d.class.contains("NVMe")
        })
        .collect()
}

/// POST /api/v1/host/reboot - Reboot the host
async fn reboot_host(
    State(_state): State<Arc<AppState>>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use std::process::Command;
    
    info!("Reboot requested via API");
    
    // Schedule reboot in 5 seconds to allow response to be sent
    let result = Command::new("shutdown")
        .args(&["-r", "+0", "Reboot requested via Quantix API"])
        .spawn();
    
    match result {
        Ok(_) => Ok(StatusCode::ACCEPTED),
        Err(e) => {
            error!(error = %e, "Failed to initiate reboot");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("reboot_failed", &e.to_string())),
            ))
        }
    }
}

/// POST /api/v1/host/shutdown - Shutdown the host
async fn shutdown_host(
    State(_state): State<Arc<AppState>>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use std::process::Command;
    
    info!("Shutdown requested via API");
    
    let result = Command::new("shutdown")
        .args(&["-h", "+0", "Shutdown requested via Quantix API"])
        .spawn();
    
    match result {
        Ok(_) => Ok(StatusCode::ACCEPTED),
        Err(e) => {
            error!(error = %e, "Failed to initiate shutdown");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("shutdown_failed", &e.to_string())),
            ))
        }
    }
}

/// GET /api/v1/host/metrics - Get current host metrics
async fn get_host_metrics(
    State(state): State<Arc<AppState>>,
) -> Result<Json<HostMetricsResponse>, (StatusCode, Json<ApiError>)> {
    use sysinfo::System;
    use tonic::Request;
    use limiquantix_proto::NodeDaemonService;
    
    let mut sys = System::new_all();
    sys.refresh_all();
    
    // Get VM count
    let (vm_count, vm_running_count) = match state.service.list_v_ms(Request::new(())).await {
        Ok(response) => {
            let vms = response.into_inner().vms;
            let total = vms.len() as u32;
            let running = vms.iter().filter(|vm| vm.state == 1).count() as u32; // 1 = RUNNING
            (total, running)
        }
        Err(_) => (0, 0),
    };
    
    // Calculate CPU usage
    let cpu_usage = sys.global_cpu_usage() as f64;
    
    // Memory
    let memory_total = sys.total_memory();
    let memory_used = sys.used_memory();
    let memory_usage_percent = if memory_total > 0 {
        (memory_used as f64 / memory_total as f64) * 100.0
    } else {
        0.0
    };
    
    // Load average (Linux only)
    let load_avg = System::load_average();
    
    // Disk I/O (we'd need to track this over time for rates, for now return 0)
    // In a real implementation, we'd keep a history and calculate deltas
    let disk_read_bytes_per_sec = 0u64;
    let disk_write_bytes_per_sec = 0u64;
    
    // Network I/O (same as disk)
    let network_rx_bytes_per_sec = 0u64;
    let network_tx_bytes_per_sec = 0u64;
    
    Ok(Json(HostMetricsResponse {
        timestamp: chrono::Utc::now().to_rfc3339(),
        cpu_usage_percent: cpu_usage,
        memory_used_bytes: memory_used,
        memory_total_bytes: memory_total,
        memory_usage_percent,
        disk_read_bytes_per_sec,
        disk_write_bytes_per_sec,
        network_rx_bytes_per_sec,
        network_tx_bytes_per_sec,
        load_average_1min: load_avg.one,
        load_average_5min: load_avg.five,
        load_average_15min: load_avg.fifteen,
        vm_count,
        vm_running_count,
    }))
}

/// GET /api/v1/events - List events
async fn list_events(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<EventListResponse>, (StatusCode, Json<ApiError>)> {
    // For now, return a placeholder list of events
    // In a real implementation, this would query an event store
    let events = vec![
        EventResponse {
            event_id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: "info".to_string(),
            category: "system".to_string(),
            message: "Node daemon started".to_string(),
            source: "qx-node".to_string(),
            details: None,
        },
    ];
    
    Ok(Json(EventListResponse {
        events,
        total_count: 1,
    }))
}

// ============================================================================
// Settings API Handlers
// ============================================================================

/// GET /api/v1/settings - Get current settings
async fn get_settings(
    State(state): State<Arc<AppState>>,
) -> Result<Json<SettingsResponse>, (StatusCode, Json<ApiError>)> {
    Ok(Json(SettingsResponse {
        node_name: state.service.get_node_id().to_string(),
        node_id: state.service.get_node_id().to_string(),
        grpc_listen: "0.0.0.0:9443".to_string(),
        http_listen: "0.0.0.0:8443".to_string(),
        log_level: "info".to_string(),
        storage_default_pool: Some("default".to_string()),
        network_default_bridge: Some("br0".to_string()),
        vnc_listen_address: "0.0.0.0".to_string(),
        vnc_port_range_start: 5900,
        vnc_port_range_end: 5999,
    }))
}

/// POST /api/v1/settings - Update settings
async fn update_settings(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<UpdateSettingsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    // In a real implementation, this would update the config file
    info!(
        node_name = ?req.node_name,
        log_level = ?req.log_level,
        "Settings update requested"
    );
    
    Ok(Json(serde_json::json!({
        "message": "Settings updated. Some changes may require a restart."
    })))
}

/// GET /api/v1/settings/services - List system services
async fn list_services(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<ServiceListResponse>, (StatusCode, Json<ApiError>)> {
    // Try to get service status using systemctl or rc-service
    let services = vec![
        ServiceInfo {
            name: "qx-node".to_string(),
            status: "running".to_string(),
            enabled: true,
            description: "Quantix Node Daemon".to_string(),
        },
        ServiceInfo {
            name: "libvirtd".to_string(),
            status: get_service_status("libvirtd"),
            enabled: true,
            description: "Libvirt Virtualization Daemon".to_string(),
        },
        ServiceInfo {
            name: "sshd".to_string(),
            status: get_service_status("sshd"),
            enabled: true,
            description: "OpenSSH Server".to_string(),
        },
    ];
    
    Ok(Json(ServiceListResponse { services }))
}

fn get_service_status(name: &str) -> String {
    use std::process::Command;
    
    // Try systemctl first
    if let Ok(output) = Command::new("systemctl")
        .args(&["is-active", name])
        .output()
    {
        if output.status.success() {
            return String::from_utf8_lossy(&output.stdout).trim().to_string();
        }
    }
    
    // Try rc-service (Alpine/OpenRC)
    if let Ok(output) = Command::new("rc-service")
        .args(&[name, "status"])
        .output()
    {
        if output.status.success() {
            return "running".to_string();
        }
    }
    
    "unknown".to_string()
}

/// POST /api/v1/settings/services/:name/restart - Restart a service
async fn restart_service(
    State(_state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    use std::process::Command;
    
    info!(service = %name, "Service restart requested");
    
    // Try systemctl first
    let result = Command::new("systemctl")
        .args(&["restart", &name])
        .output();
    
    if let Ok(output) = result {
        if output.status.success() {
            return Ok(Json(serde_json::json!({
                "message": format!("Service {} restarted", name)
            })));
        }
    }
    
    // Try rc-service (Alpine/OpenRC)
    let result = Command::new("rc-service")
        .args(&[&name, "restart"])
        .output();
    
    match result {
        Ok(output) if output.status.success() => {
            Ok(Json(serde_json::json!({
                "message": format!("Service {} restarted", name)
            })))
        }
        _ => {
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("restart_failed", &format!("Failed to restart service {}", name))),
            ))
        }
    }
}

// ============================================================================
// VM API Handlers
// ============================================================================

/// GET /api/v1/vms - List all VMs
async fn list_vms(
    State(state): State<Arc<AppState>>,
) -> Result<Json<VmListResponse>, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::NodeDaemonService;

    match state.service.list_v_ms(Request::new(())).await {
        Ok(response) => {
            let vms = response.into_inner().vms.into_iter().map(|vm| {
                VmResponse {
                    vm_id: vm.vm_id,
                    name: vm.name,
                    state: power_state_to_string(vm.state),
                    cpu_usage_percent: vm.cpu_usage_percent,
                    memory_used_bytes: vm.memory_used_bytes,
                    memory_total_bytes: vm.memory_total_bytes,
                    guest_agent: vm.guest_agent.map(|ga| GuestAgentInfo {
                        connected: ga.connected,
                        version: ga.version,
                        os_name: ga.os_name,
                        hostname: ga.hostname,
                        ip_addresses: ga.ip_addresses,
                    }),
                }
            }).collect();
            
            Ok(Json(VmListResponse { vms }))
        }
        Err(e) => {
            error!(error = %e, "Failed to list VMs");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("list_vms_failed", &e.message())),
            ))
        }
    }
}

/// GET /api/v1/vms/:vm_id - Get single VM
async fn get_vm(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<Json<VmResponse>, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, VmIdRequest};

    match state.service.get_vm_status(Request::new(VmIdRequest { vm_id: vm_id.clone() })).await {
        Ok(response) => {
            let vm = response.into_inner();
            Ok(Json(VmResponse {
                vm_id: vm.vm_id,
                name: vm.name,
                state: power_state_to_string(vm.state),
                cpu_usage_percent: vm.cpu_usage_percent,
                memory_used_bytes: vm.memory_used_bytes,
                memory_total_bytes: vm.memory_total_bytes,
                guest_agent: vm.guest_agent.map(|ga| GuestAgentInfo {
                    connected: ga.connected,
                    version: ga.version,
                    os_name: ga.os_name,
                    hostname: ga.hostname,
                    ip_addresses: ga.ip_addresses,
                }),
            }))
        }
        Err(e) => {
            let status = if e.code() == tonic::Code::NotFound {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            Err((status, Json(ApiError::new("get_vm_failed", &e.message()))))
        }
    }
}

/// POST /api/v1/vms/:vm_id/start - Start VM
async fn start_vm(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, VmIdRequest};

    match state.service.start_vm(Request::new(VmIdRequest { vm_id: vm_id.clone() })).await {
        Ok(_) => {
            info!(vm_id = %vm_id, "VM started via HTTP API");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(e) => {
            error!(vm_id = %vm_id, error = %e, "Failed to start VM");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("start_vm_failed", &e.message())),
            ))
        }
    }
}

/// POST /api/v1/vms/:vm_id/stop - Stop VM (graceful)
async fn stop_vm(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
    body: Option<Json<StopVmRequest>>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, StopVmRequest as ProtoStopVmRequest};

    let timeout = body.and_then(|b| b.timeout_seconds).unwrap_or(30);

    match state.service.stop_vm(Request::new(ProtoStopVmRequest { 
        vm_id: vm_id.clone(),
        timeout_seconds: timeout,
    })).await {
        Ok(_) => {
            info!(vm_id = %vm_id, "VM stopped via HTTP API");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(e) => {
            error!(vm_id = %vm_id, error = %e, "Failed to stop VM");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("stop_vm_failed", &e.message())),
            ))
        }
    }
}

/// POST /api/v1/vms/:vm_id/force-stop - Force stop VM
async fn force_stop_vm(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, VmIdRequest};

    match state.service.force_stop_vm(Request::new(VmIdRequest { vm_id: vm_id.clone() })).await {
        Ok(_) => {
            info!(vm_id = %vm_id, "VM force stopped via HTTP API");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(e) => {
            error!(vm_id = %vm_id, error = %e, "Failed to force stop VM");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("force_stop_vm_failed", &e.message())),
            ))
        }
    }
}

/// POST /api/v1/vms/:vm_id/reboot - Reboot VM
async fn reboot_vm(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, VmIdRequest};

    match state.service.reboot_vm(Request::new(VmIdRequest { vm_id: vm_id.clone() })).await {
        Ok(_) => {
            info!(vm_id = %vm_id, "VM rebooted via HTTP API");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(e) => {
            error!(vm_id = %vm_id, error = %e, "Failed to reboot VM");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("reboot_vm_failed", &e.message())),
            ))
        }
    }
}

/// POST /api/v1/vms/:vm_id/pause - Pause VM
async fn pause_vm(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, VmIdRequest};

    match state.service.pause_vm(Request::new(VmIdRequest { vm_id: vm_id.clone() })).await {
        Ok(_) => {
            info!(vm_id = %vm_id, "VM paused via HTTP API");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(e) => {
            error!(vm_id = %vm_id, error = %e, "Failed to pause VM");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("pause_vm_failed", &e.message())),
            ))
        }
    }
}

/// POST /api/v1/vms/:vm_id/resume - Resume VM
async fn resume_vm(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, VmIdRequest};

    match state.service.resume_vm(Request::new(VmIdRequest { vm_id: vm_id.clone() })).await {
        Ok(_) => {
            info!(vm_id = %vm_id, "VM resumed via HTTP API");
            Ok(StatusCode::NO_CONTENT)
        }
        Err(e) => {
            error!(vm_id = %vm_id, error = %e, "Failed to resume VM");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("resume_vm_failed", &e.message())),
            ))
        }
    }
}

/// GET /api/v1/vms/:vm_id/console - Get console connection info
async fn get_vm_console(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<Json<ConsoleResponse>, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, VmIdRequest};

    match state.service.get_console(Request::new(VmIdRequest { vm_id: vm_id.clone() })).await {
        Ok(response) => {
            let console = response.into_inner();
            Ok(Json(ConsoleResponse {
                console_type: console.console_type,
                host: console.host,
                port: console.port,
                password: console.password,
                websocket_path: console.websocket_path,
            }))
        }
        Err(e) => {
            let status = if e.code() == tonic::Code::NotFound {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            Err((status, Json(ApiError::new("get_console_failed", &e.message()))))
        }
    }
}

/// POST /api/v1/vms - Create a new VM
async fn create_vm(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateVmRequest>,
) -> Result<Json<VmResponse>, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{
        NodeDaemonService, CreateVmOnNodeRequest, VmSpec, DiskSpec, NicSpec,
        DiskBus, DiskFormat, NicModel, CloudInitConfig,
    };
    
    // Generate VM ID
    let vm_id = format!("vm-{}", uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("unknown"));
    
    // Convert disk specs
    let disks: Vec<DiskSpec> = request.disks.iter().map(|d| {
        let bus = match d.bus.as_deref() {
            Some("scsi") => DiskBus::Scsi as i32,
            Some("sata") => DiskBus::Sata as i32,
            Some("ide") => DiskBus::Ide as i32,
            _ => DiskBus::Virtio as i32,
        };
        let format = match d.format.as_deref() {
            Some("raw") => DiskFormat::Raw as i32,
            _ => DiskFormat::Qcow2 as i32,
        };
        DiskSpec {
            id: d.id.clone(),
            path: String::new(),
            size_gib: d.size_gib,
            bus,
            format,
            readonly: false,
            bootable: d.bootable.unwrap_or(false),
            iops_limit: 0,
            throughput_mbps: 0,
            backing_file: d.backing_file.clone().unwrap_or_default(),
        }
    }).collect();
    
    // Convert NIC specs
    let nics: Vec<NicSpec> = request.nics.iter().map(|n| {
        let model = match n.model.as_deref() {
            Some("e1000") => NicModel::E1000 as i32,
            Some("rtl8139") => NicModel::Rtl8139 as i32,
            _ => NicModel::Virtio as i32,
        };
        NicSpec {
            id: n.id.clone(),
            mac_address: n.mac_address.clone().unwrap_or_default(),
            bridge: n.bridge.clone().unwrap_or_default(),
            network: n.network.clone().unwrap_or_default(),
            model,
            bandwidth_mbps: 0,
        }
    }).collect();
    
    // Build cloud-init config if provided
    let cloud_init = request.cloud_init.map(|ci| CloudInitConfig {
        user_data: ci.user_data.unwrap_or_default(),
        meta_data: ci.meta_data.unwrap_or_default(),
        network_config: ci.network_config.unwrap_or_default(),
        vendor_data: String::new(),
    });
    
    let proto_request = CreateVmOnNodeRequest {
        vm_id: vm_id.clone(),
        name: request.name.clone(),
        labels: std::collections::HashMap::new(),
        spec: Some(VmSpec {
            cpu_cores: request.cpu_cores,
            cpu_sockets: request.cpu_sockets.unwrap_or(1),
            cpu_threads_per_core: 1,
            memory_mib: request.memory_mib,
            memory_hugepages: false,
            firmware: 0, // BIOS
            boot_order: vec![0], // Disk first
            disks,
            nics,
            cdroms: vec![],
            console: None,
            cloud_init,
        }),
    };
    
    match state.service.create_vm(Request::new(proto_request)).await {
        Ok(response) => {
            let result = response.into_inner();
            Ok(Json(VmResponse {
                vm_id: result.vm_id,
                name: request.name,
                state: "STOPPED".to_string(),
                cpu_usage_percent: 0.0,
                memory_used_bytes: 0,
                memory_total_bytes: request.memory_mib * 1024 * 1024,
                guest_agent: None,
            }))
        }
        Err(e) => {
            error!(error = %e, "Failed to create VM");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("create_vm_failed", &e.message())),
            ))
        }
    }
}

/// DELETE /api/v1/vms/:vm_id - Delete a VM
async fn delete_vm(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, VmIdRequest};

    match state.service.delete_vm(Request::new(VmIdRequest { vm_id: vm_id.clone() })).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => {
            let status = if e.code() == tonic::Code::NotFound {
                StatusCode::NOT_FOUND
            } else if e.code() == tonic::Code::FailedPrecondition {
                StatusCode::CONFLICT // VM must be stopped first
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            Err((status, Json(ApiError::new("delete_vm_failed", &e.message()))))
        }
    }
}

/// GET /api/v1/vms/:vm_id/snapshots - List snapshots
async fn list_snapshots(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<Json<SnapshotListResponse>, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, VmIdRequest};

    match state.service.list_snapshots(Request::new(VmIdRequest { vm_id: vm_id.clone() })).await {
        Ok(response) => {
            let snapshots = response.into_inner().snapshots.into_iter().map(|s| {
                SnapshotResponse {
                    snapshot_id: s.snapshot_id,
                    name: s.name,
                    description: s.description,
                    created_at: s.created_at.map(|t| {
                        chrono::DateTime::from_timestamp(t.seconds, t.nanos as u32)
                            .map(|dt| dt.to_rfc3339())
                            .unwrap_or_default()
                    }).unwrap_or_default(),
                    vm_state: power_state_to_string(s.vm_state),
                    parent_id: if s.parent_id.is_empty() { None } else { Some(s.parent_id) },
                }
            }).collect();
            
            Ok(Json(SnapshotListResponse { snapshots }))
        }
        Err(e) => {
            error!(error = %e, vm_id = %vm_id, "Failed to list snapshots");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("list_snapshots_failed", &e.message())),
            ))
        }
    }
}

/// POST /api/v1/vms/:vm_id/snapshots - Create a snapshot
async fn create_snapshot(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
    Json(request): Json<CreateSnapshotRequest>,
) -> Result<Json<SnapshotResponse>, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, CreateSnapshotRequest as ProtoRequest};

    let proto_request = ProtoRequest {
        vm_id: vm_id.clone(),
        name: request.name.clone(),
        description: request.description.unwrap_or_default(),
        quiesce: request.quiesce.unwrap_or(false),
    };

    match state.service.create_snapshot(Request::new(proto_request)).await {
        Ok(response) => {
            let s = response.into_inner();
            Ok(Json(SnapshotResponse {
                snapshot_id: s.snapshot_id,
                name: s.name,
                description: s.description,
                created_at: s.created_at.map(|t| {
                    chrono::DateTime::from_timestamp(t.seconds, t.nanos as u32)
                        .map(|dt| dt.to_rfc3339())
                        .unwrap_or_default()
                }).unwrap_or_default(),
                vm_state: power_state_to_string(s.vm_state),
                parent_id: if s.parent_id.is_empty() { None } else { Some(s.parent_id) },
            }))
        }
        Err(e) => {
            error!(error = %e, vm_id = %vm_id, "Failed to create snapshot");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("create_snapshot_failed", &e.message())),
            ))
        }
    }
}

/// DELETE /api/v1/vms/:vm_id/snapshots/:snapshot_id - Delete a snapshot
async fn delete_snapshot(
    State(state): State<Arc<AppState>>,
    Path((vm_id, snapshot_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, DeleteSnapshotRequest};

    match state.service.delete_snapshot(Request::new(DeleteSnapshotRequest { 
        vm_id: vm_id.clone(), 
        snapshot_id: snapshot_id.clone() 
    })).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => {
            error!(error = %e, vm_id = %vm_id, snapshot_id = %snapshot_id, "Failed to delete snapshot");
            let status = if e.code() == tonic::Code::NotFound {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            Err((status, Json(ApiError::new("delete_snapshot_failed", &e.message()))))
        }
    }
}

/// POST /api/v1/vms/:vm_id/snapshots/:snapshot_id/revert - Revert to a snapshot
async fn revert_snapshot(
    State(state): State<Arc<AppState>>,
    Path((vm_id, snapshot_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, RevertSnapshotRequest};

    match state.service.revert_snapshot(Request::new(RevertSnapshotRequest { 
        vm_id: vm_id.clone(), 
        snapshot_id: snapshot_id.clone() 
    })).await {
        Ok(_) => Ok(StatusCode::OK),
        Err(e) => {
            error!(error = %e, vm_id = %vm_id, snapshot_id = %snapshot_id, "Failed to revert snapshot");
            let status = if e.code() == tonic::Code::NotFound {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            Err((status, Json(ApiError::new("revert_snapshot_failed", &e.message()))))
        }
    }
}

// ============================================================================
// Storage API Handlers
// ============================================================================

/// GET /api/v1/storage/pools - List storage pools
async fn list_storage_pools(
    State(state): State<Arc<AppState>>,
) -> Result<Json<StoragePoolListResponse>, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::NodeDaemonService;

    match state.service.list_storage_pools(Request::new(())).await {
        Ok(response) => {
            let pools = response.into_inner().pools.into_iter().map(|pool| {
                StoragePoolResponse {
                    pool_id: pool.pool_id,
                    pool_type: pool_type_to_string(pool.r#type),
                    mount_path: pool.mount_path,
                    total_bytes: pool.total_bytes,
                    available_bytes: pool.available_bytes,
                    used_bytes: pool.used_bytes,
                    volume_count: pool.volume_count,
                }
            }).collect();
            
            Ok(Json(StoragePoolListResponse { pools }))
        }
        Err(e) => {
            error!(error = %e, "Failed to list storage pools");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("list_pools_failed", &e.message())),
            ))
        }
    }
}

/// GET /api/v1/storage/pools/:pool_id - Get a specific storage pool
async fn get_storage_pool(
    State(state): State<Arc<AppState>>,
    Path(pool_id): Path<String>,
) -> Result<Json<StoragePoolResponse>, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::NodeDaemonService;

    match state.service.list_storage_pools(Request::new(())).await {
        Ok(response) => {
            let pools = response.into_inner().pools;
            if let Some(pool) = pools.into_iter().find(|p| p.pool_id == pool_id) {
                Ok(Json(StoragePoolResponse {
                    pool_id: pool.pool_id,
                    pool_type: pool_type_to_string(pool.r#type),
                    mount_path: pool.mount_path,
                    total_bytes: pool.total_bytes,
                    available_bytes: pool.available_bytes,
                    used_bytes: pool.used_bytes,
                    volume_count: pool.volume_count,
                }))
            } else {
                Err((
                    StatusCode::NOT_FOUND,
                    Json(ApiError::new("pool_not_found", &format!("Pool {} not found", pool_id))),
                ))
            }
        }
        Err(e) => {
            error!(error = %e, "Failed to get storage pool");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("get_pool_failed", &e.message())),
            ))
        }
    }
}

/// POST /api/v1/storage/pools - Create a storage pool
async fn create_storage_pool(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateStoragePoolRequest>,
) -> Result<Json<StoragePoolResponse>, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{
        NodeDaemonService, InitStoragePoolRequest, StoragePoolType, StoragePoolConfig,
        LocalDirPoolConfig, NfsPoolConfig,
    };

    let pool_type = match request.pool_type.to_uppercase().as_str() {
        "LOCAL_DIR" => StoragePoolType::LocalDir,
        "NFS" => StoragePoolType::Nfs,
        "CEPH_RBD" => StoragePoolType::CephRbd,
        "ISCSI" => StoragePoolType::Iscsi,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiError::new("invalid_pool_type", "Valid types: LOCAL_DIR, NFS, CEPH_RBD, ISCSI")),
            ));
        }
    };

    // Build the config based on pool type
    let config = match pool_type {
        StoragePoolType::LocalDir => Some(StoragePoolConfig {
            local: Some(LocalDirPoolConfig {
                path: request.path.unwrap_or_else(|| format!("/var/lib/limiquantix/pools/{}", request.pool_id)),
            }),
            nfs: None,
            ceph: None,
            iscsi: None,
        }),
        StoragePoolType::Nfs => Some(StoragePoolConfig {
            local: None,
            nfs: Some(NfsPoolConfig {
                server: request.nfs_server.unwrap_or_default(),
                export_path: request.nfs_export.unwrap_or_default(),
                version: "4".to_string(),
                options: "".to_string(),
                mount_point: "".to_string(),
            }),
            ceph: None,
            iscsi: None,
        }),
        _ => None,
    };

    let proto_request = InitStoragePoolRequest {
        pool_id: request.pool_id.clone(),
        r#type: pool_type as i32,
        config,
    };

    match state.service.init_storage_pool(Request::new(proto_request)).await {
        Ok(response) => {
            let pool = response.into_inner();
            Ok(Json(StoragePoolResponse {
                pool_id: pool.pool_id,
                pool_type: pool_type_to_string(pool.r#type),
                mount_path: pool.mount_path,
                total_bytes: pool.total_bytes,
                available_bytes: pool.available_bytes,
                used_bytes: pool.used_bytes,
                volume_count: 0,
            }))
        }
        Err(e) => {
            error!(error = %e, "Failed to create storage pool");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("create_pool_failed", &e.message())),
            ))
        }
    }
}

/// DELETE /api/v1/storage/pools/:pool_id - Delete a storage pool
async fn delete_storage_pool(
    State(state): State<Arc<AppState>>,
    Path(pool_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, StoragePoolIdRequest};

    match state.service.destroy_storage_pool(Request::new(StoragePoolIdRequest { pool_id: pool_id.clone() })).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => {
            error!(error = %e, pool_id = %pool_id, "Failed to delete storage pool");
            let status = if e.code() == tonic::Code::NotFound {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            Err((status, Json(ApiError::new("delete_pool_failed", &e.message()))))
        }
    }
}

/// GET /api/v1/storage/pools/:pool_id/volumes - List volumes in a pool
async fn list_volumes(
    State(state): State<Arc<AppState>>,
    Path(pool_id): Path<String>,
) -> Result<Json<VolumeListResponse>, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, ListVolumesRequest};

    match state.service.list_volumes(Request::new(ListVolumesRequest { pool_id: pool_id.clone() })).await {
        Ok(response) => {
            let volumes = response.into_inner().volumes.into_iter().map(|vol| {
                VolumeResponse {
                    volume_id: vol.volume_id,
                    pool_id: vol.pool_id,
                    size_bytes: vol.size_bytes,
                    format: vol.format,
                    path: vol.path,
                    attached_to: if vol.attached_to.is_empty() { None } else { Some(vol.attached_to) },
                }
            }).collect();
            
            Ok(Json(VolumeListResponse { volumes }))
        }
        Err(e) => {
            error!(error = %e, pool_id = %pool_id, "Failed to list volumes");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("list_volumes_failed", &e.message())),
            ))
        }
    }
}

/// POST /api/v1/storage/pools/:pool_id/volumes - Create a volume
async fn create_volume(
    State(state): State<Arc<AppState>>,
    Path(pool_id): Path<String>,
    Json(request): Json<CreateVolumeRequest>,
) -> Result<Json<VolumeResponse>, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, CreateVolumeRequest as ProtoRequest, VolumeSourceType};

    let proto_request = ProtoRequest {
        pool_id: pool_id.clone(),
        volume_id: request.volume_id.clone(),
        size_bytes: request.size_bytes,
        source_type: VolumeSourceType::VolumeSourceEmpty as i32,
        source_id: "".to_string(),
    };

    match state.service.create_volume(Request::new(proto_request)).await {
        Ok(response) => {
            let vol = response.into_inner();
            Ok(Json(VolumeResponse {
                volume_id: vol.volume_id,
                pool_id: vol.pool_id,
                size_bytes: vol.size_bytes,
                format: vol.format,
                path: vol.path,
                attached_to: if vol.attached_to.is_empty() { None } else { Some(vol.attached_to) },
            }))
        }
        Err(e) => {
            error!(error = %e, pool_id = %pool_id, "Failed to create volume");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("create_volume_failed", &e.message())),
            ))
        }
    }
}

/// DELETE /api/v1/storage/pools/:pool_id/volumes/:volume_id - Delete a volume
async fn delete_volume(
    State(state): State<Arc<AppState>>,
    Path((pool_id, volume_id)): Path<(String, String)>,
) -> Result<StatusCode, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::{NodeDaemonService, VolumeIdRequest};

    match state.service.delete_volume(Request::new(VolumeIdRequest { 
        pool_id: pool_id.clone(), 
        volume_id: volume_id.clone() 
    })).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => {
            error!(error = %e, pool_id = %pool_id, volume_id = %volume_id, "Failed to delete volume");
            let status = if e.code() == tonic::Code::NotFound {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            Err((status, Json(ApiError::new("delete_volume_failed", &e.message()))))
        }
    }
}

/// GET /api/v1/storage/images - List ISO images
async fn list_images(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ImageListResponse>, (StatusCode, Json<ApiError>)> {
    use tonic::Request;
    use limiquantix_proto::NodeDaemonService;

    match state.service.list_images(Request::new(())).await {
        Ok(response) => {
            let images = response.into_inner().images.into_iter().map(|img| {
                ImageResponse {
                    image_id: img.image_id,
                    name: img.name,
                    path: img.path,
                    size_bytes: img.size_bytes,
                    format: img.format,
                }
            }).collect();
            
            Ok(Json(ImageListResponse { images }))
        }
        Err(e) => {
            error!(error = %e, "Failed to list images");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("list_images_failed", &e.message())),
            ))
        }
    }
}

// ============================================================================
// Network Handlers
// ============================================================================

/// List all network interfaces
async fn list_network_interfaces(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<NetworkInterfaceList>, (StatusCode, Json<ApiError>)> {
    use std::process::Command;
    
    // Use `ip` command to list interfaces with JSON output
    let output = Command::new("ip")
        .args(&["-j", "addr", "show"])
        .output();
    
    match output {
        Ok(output) if output.status.success() => {
            let json_str = String::from_utf8_lossy(&output.stdout);
            
            // Parse the JSON output from `ip` command
            let ip_interfaces: Vec<serde_json::Value> = serde_json::from_str(&json_str)
                .unwrap_or_default();
            
            let interfaces: Vec<NetworkInterface> = ip_interfaces.iter().filter_map(|iface| {
                let name = iface.get("ifname")?.as_str()?.to_string();
                
                // Skip loopback interface
                if name == "lo" {
                    return None;
                }
                
                let mac_address = iface.get("address")
                    .and_then(|v| v.as_str())
                    .unwrap_or("00:00:00:00:00:00")
                    .to_string();
                
                let state = iface.get("operstate")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_lowercase())
                    .unwrap_or_else(|| "unknown".to_string());
                
                let mtu = iface.get("mtu")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(1500) as u32;
                
                // Get link type to determine interface type
                let link_type = iface.get("link_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("ether");
                
                let interface_type = if name.starts_with("br") || name.starts_with("virbr") {
                    "bridge"
                } else if name.starts_with("bond") {
                    "bond"
                } else if name.contains(".") {
                    "vlan"
                } else if link_type == "ether" {
                    "ethernet"
                } else {
                    link_type
                }.to_string();
                
                // Extract IP addresses
                let addr_info = iface.get("addr_info")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                
                let ip_addresses: Vec<String> = addr_info.iter().filter_map(|addr| {
                    let local = addr.get("local")?.as_str()?;
                    let prefixlen = addr.get("prefixlen")?.as_u64()?;
                    Some(format!("{}/{}", local, prefixlen))
                }).collect();
                
                Some(NetworkInterface {
                    name,
                    mac_address,
                    interface_type,
                    state,
                    ip_addresses,
                    mtu,
                    speed_mbps: None, // Would need ethtool to get this
                })
            }).collect();
            
            Ok(Json(NetworkInterfaceList { interfaces }))
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!(stderr = %stderr, "ip command failed");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("list_interfaces_failed", &format!("ip command failed: {}", stderr))),
            ))
        }
        Err(e) => {
            error!(error = %e, "Failed to execute ip command");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("list_interfaces_failed", &format!("Failed to execute ip command: {}", e))),
            ))
        }
    }
}

/// Get details of a specific network interface
async fn get_network_interface(
    State(_state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<Json<NetworkInterface>, (StatusCode, Json<ApiError>)> {
    use std::process::Command;
    
    // Use `ip` command to get specific interface
    let output = Command::new("ip")
        .args(&["-j", "addr", "show", "dev", &name])
        .output();
    
    match output {
        Ok(output) if output.status.success() => {
            let json_str = String::from_utf8_lossy(&output.stdout);
            
            let ip_interfaces: Vec<serde_json::Value> = serde_json::from_str(&json_str)
                .unwrap_or_default();
            
            if let Some(iface) = ip_interfaces.first() {
                let mac_address = iface.get("address")
                    .and_then(|v| v.as_str())
                    .unwrap_or("00:00:00:00:00:00")
                    .to_string();
                
                let state = iface.get("operstate")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_lowercase())
                    .unwrap_or_else(|| "unknown".to_string());
                
                let mtu = iface.get("mtu")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(1500) as u32;
                
                let link_type = iface.get("link_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("ether");
                
                let interface_type = if name.starts_with("br") || name.starts_with("virbr") {
                    "bridge"
                } else if name.starts_with("bond") {
                    "bond"
                } else if name.contains(".") {
                    "vlan"
                } else if link_type == "ether" {
                    "ethernet"
                } else {
                    link_type
                }.to_string();
                
                let addr_info = iface.get("addr_info")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                
                let ip_addresses: Vec<String> = addr_info.iter().filter_map(|addr| {
                    let local = addr.get("local")?.as_str()?;
                    let prefixlen = addr.get("prefixlen")?.as_u64()?;
                    Some(format!("{}/{}", local, prefixlen))
                }).collect();
                
                Ok(Json(NetworkInterface {
                    name,
                    mac_address,
                    interface_type,
                    state,
                    ip_addresses,
                    mtu,
                    speed_mbps: None,
                }))
            } else {
                Err((
                    StatusCode::NOT_FOUND,
                    Json(ApiError::new("interface_not_found", &format!("Interface {} not found", name))),
                ))
            }
        }
        _ => {
            Err((
                StatusCode::NOT_FOUND,
                Json(ApiError::new("interface_not_found", &format!("Interface {} not found", name))),
            ))
        }
    }
}

/// Configure a network interface
async fn configure_network_interface(
    State(_state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(config): Json<ConfigureInterfaceRequest>,
) -> Result<Json<NetworkInterface>, (StatusCode, Json<ApiError>)> {
    use std::process::Command;
    
    info!(interface = %name, dhcp = config.dhcp, "Configuring network interface");
    
    // Clone the IP address before the match to use later
    let configured_ip = config.ip_address.clone();
    
    if config.dhcp {
        // Configure for DHCP
        let _ = Command::new("ip")
            .args(&["link", "set", &name, "up"])
            .output();
        
        // Start DHCP client (simplified - in production use proper DHCP client)
        info!(interface = %name, "Configured for DHCP");
    } else if let (Some(ip), Some(netmask)) = (config.ip_address, config.netmask) {
        // Configure static IP
        let _ = Command::new("ip")
            .args(&["addr", "add", &format!("{}/{}", ip, netmask), "dev", &name])
            .output();
        
        let _ = Command::new("ip")
            .args(&["link", "set", &name, "up"])
            .output();
        
        if let Some(gateway) = config.gateway {
            let _ = Command::new("ip")
                .args(&["route", "add", "default", "via", &gateway])
                .output();
        }
        
        info!(interface = %name, ip = %ip, "Configured with static IP");
    }
    
    // Return updated interface info
    Ok(Json(NetworkInterface {
        name: name.clone(),
        mac_address: "00:00:00:00:00:00".to_string(),
        interface_type: "ethernet".to_string(),
        state: "up".to_string(),
        ip_addresses: configured_ip.map(|ip| vec![ip]).unwrap_or_default(),
        mtu: 1500,
        speed_mbps: Some(1000),
    }))
}

/// Create a network bridge
async fn create_bridge(
    State(_state): State<Arc<AppState>>,
    Json(request): Json<CreateBridgeRequest>,
) -> Result<Json<NetworkInterface>, (StatusCode, Json<ApiError>)> {
    use std::process::Command;
    
    info!(bridge = %request.name, interfaces = ?request.interfaces, "Creating network bridge");
    
    // Create bridge
    let _ = Command::new("ip")
        .args(&["link", "add", "name", &request.name, "type", "bridge"])
        .output();
    
    // Add interfaces to bridge
    for iface in &request.interfaces {
        let _ = Command::new("ip")
            .args(&["link", "set", iface, "master", &request.name])
            .output();
    }
    
    // Bring bridge up
    let _ = Command::new("ip")
        .args(&["link", "set", &request.name, "up"])
        .output();
    
    info!(bridge = %request.name, "Bridge created successfully");
    
    Ok(Json(NetworkInterface {
        name: request.name.clone(),
        mac_address: "00:00:00:00:00:00".to_string(),
        interface_type: "bridge".to_string(),
        state: "up".to_string(),
        ip_addresses: vec![],
        mtu: 1500,
        speed_mbps: None,
    }))
}

/// Get DNS configuration
async fn get_dns_config(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<DnsConfig>, (StatusCode, Json<ApiError>)> {
    use tokio::fs;
    
    // Read /etc/resolv.conf
    match fs::read_to_string("/etc/resolv.conf").await {
        Ok(content) => {
            let mut nameservers = Vec::new();
            let mut search_domains = Vec::new();
            
            for line in content.lines() {
                if line.starts_with("nameserver") {
                    if let Some(ns) = line.split_whitespace().nth(1) {
                        nameservers.push(ns.to_string());
                    }
                } else if line.starts_with("search") {
                    search_domains = line.split_whitespace().skip(1).map(|s| s.to_string()).collect();
                }
            }
            
            Ok(Json(DnsConfig {
                nameservers,
                search_domains,
            }))
        }
        Err(e) => {
            error!(error = %e, "Failed to read DNS configuration");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("read_dns_failed", &e.to_string())),
            ))
        }
    }
}

/// Set DNS configuration
async fn set_dns_config(
    State(_state): State<Arc<AppState>>,
    Json(config): Json<DnsConfig>,
) -> Result<Json<DnsConfig>, (StatusCode, Json<ApiError>)> {
    use tokio::fs;
    
    info!(nameservers = ?config.nameservers, "Setting DNS configuration");
    
    // Build resolv.conf content
    let mut content = String::new();
    
    if !config.search_domains.is_empty() {
        content.push_str(&format!("search {}\n", config.search_domains.join(" ")));
    }
    
    for ns in &config.nameservers {
        content.push_str(&format!("nameserver {}\n", ns));
    }
    
    // Write to /etc/resolv.conf
    match fs::write("/etc/resolv.conf", content).await {
        Ok(_) => {
            info!("DNS configuration updated successfully");
            Ok(Json(config))
        }
        Err(e) => {
            error!(error = %e, "Failed to write DNS configuration");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("write_dns_failed", &e.to_string())),
            ))
        }
    }
}

/// Get hostname
async fn get_hostname(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<HostnameConfig>, (StatusCode, Json<ApiError>)> {
    use tokio::fs;
    
    match fs::read_to_string("/etc/hostname").await {
        Ok(hostname) => Ok(Json(HostnameConfig {
            hostname: hostname.trim().to_string(),
        })),
        Err(e) => {
            error!(error = %e, "Failed to read hostname");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("read_hostname_failed", &e.to_string())),
            ))
        }
    }
}

/// Set hostname
async fn set_hostname(
    State(_state): State<Arc<AppState>>,
    Json(config): Json<HostnameConfig>,
) -> Result<Json<HostnameConfig>, (StatusCode, Json<ApiError>)> {
    use tokio::fs;
    use std::process::Command;
    
    info!(hostname = %config.hostname, "Setting hostname");
    
    // Write to /etc/hostname
    match fs::write("/etc/hostname", format!("{}\n", config.hostname)).await {
        Ok(_) => {
            // Also set the running hostname
            let _ = Command::new("hostname")
                .arg(&config.hostname)
                .output();
            
            info!(hostname = %config.hostname, "Hostname updated successfully");
            Ok(Json(config))
        }
        Err(e) => {
            error!(error = %e, "Failed to write hostname");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("write_hostname_failed", &e.to_string())),
            ))
        }
    }
}

// ============================================================================
// Cluster Handlers
// ============================================================================

/// Get cluster status
async fn get_cluster_status(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<ClusterStatus>, (StatusCode, Json<ApiError>)> {
    use tokio::fs;
    
    // Read cluster config from /etc/limiquantix/config.yaml
    let config_path = "/etc/limiquantix/config.yaml";
    
    match fs::read_to_string(config_path).await {
        Ok(_content) => {
            // Parse YAML to check if cluster is enabled
            // For now, return a simple status
            Ok(Json(ClusterStatus {
                joined: false,
                control_plane_address: None,
                node_id: None,
                last_heartbeat: None,
                status: "standalone".to_string(),
            }))
        }
        Err(_) => {
            // Config doesn't exist, standalone mode
            Ok(Json(ClusterStatus {
                joined: false,
                control_plane_address: None,
                node_id: None,
                last_heartbeat: None,
                status: "standalone".to_string(),
            }))
        }
    }
}

/// Join a Quantix-vDC cluster
async fn join_cluster(
    State(_state): State<Arc<AppState>>,
    Json(request): Json<JoinClusterRequest>,
) -> Result<Json<ClusterStatus>, (StatusCode, Json<ApiError>)> {
    use tokio::fs;
    
    info!(
        control_plane = %request.control_plane_address,
        "Joining Quantix-vDC cluster"
    );
    
    // Validate control plane address
    if request.control_plane_address.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiError::new("invalid_address", "Control plane address is required")),
        ));
    }
    
    // Read existing config
    let config_path = "/etc/limiquantix/config.yaml";
    let mut config_content = fs::read_to_string(config_path)
        .await
        .unwrap_or_else(|_| String::from("# Limiquantix Node Configuration\n"));
    
    // Update cluster configuration
    // In production, use proper YAML parsing/serialization
    let cluster_config = format!(
        r#"
# Cluster Configuration
control_plane:
  registration_enabled: true
  address: "{}"
  heartbeat_interval_secs: 30
"#,
        request.control_plane_address
    );
    
    // Append or replace cluster config
    if !config_content.contains("control_plane:") {
        config_content.push_str(&cluster_config);
    }
    
    // Write updated config
    match fs::write(config_path, config_content).await {
        Ok(_) => {
            info!(
                control_plane = %request.control_plane_address,
                "Successfully joined cluster. Restart required for changes to take effect."
            );
            
            Ok(Json(ClusterStatus {
                joined: true,
                control_plane_address: Some(request.control_plane_address),
                node_id: None,
                last_heartbeat: None,
                status: "pending_restart".to_string(),
            }))
        }
        Err(e) => {
            error!(error = %e, "Failed to write cluster configuration");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("write_config_failed", &e.to_string())),
            ))
        }
    }
}

/// Leave the cluster (return to standalone mode)
async fn leave_cluster(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<ClusterStatus>, (StatusCode, Json<ApiError>)> {
    use tokio::fs;
    
    info!("Leaving Quantix-vDC cluster");
    
    let config_path = "/etc/limiquantix/config.yaml";
    
    // Read existing config
    match fs::read_to_string(config_path).await {
        Ok(mut content) => {
            // Remove cluster configuration
            // In production, use proper YAML parsing
            if let Some(start) = content.find("# Cluster Configuration") {
                if let Some(end) = content[start..].find("\n\n") {
                    content.replace_range(start..start + end, "");
                }
            }
            
            // Disable registration
            content = content.replace("registration_enabled: true", "registration_enabled: false");
            
            match fs::write(config_path, content).await {
                Ok(_) => {
                    info!("Successfully left cluster. Restart required.");
                    Ok(Json(ClusterStatus {
                        joined: false,
                        control_plane_address: None,
                        node_id: None,
                        last_heartbeat: None,
                        status: "standalone".to_string(),
                    }))
                }
                Err(e) => {
                    error!(error = %e, "Failed to write configuration");
                    Err((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ApiError::new("write_config_failed", &e.to_string())),
                    ))
                }
            }
        }
        Err(e) => {
            error!(error = %e, "Failed to read configuration");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("read_config_failed", &e.to_string())),
            ))
        }
    }
}

/// Get cluster configuration
async fn get_cluster_config(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<ClusterConfig>, (StatusCode, Json<ApiError>)> {
    // Return current cluster configuration
    Ok(Json(ClusterConfig {
        enabled: false,
        control_plane_address: "".to_string(),
        node_id: None,
        registration_token: None,
        heartbeat_interval_secs: 30,
    }))
}

// ============================================================================
// Utility Functions
// ============================================================================

fn power_state_to_string(state: i32) -> String {
    match state {
        0 => "UNKNOWN".to_string(),
        1 => "RUNNING".to_string(),
        2 => "STOPPED".to_string(),
        3 => "PAUSED".to_string(),
        4 => "SUSPENDED".to_string(),
        5 => "CRASHED".to_string(),
        6 => "MIGRATING".to_string(),
        _ => "UNKNOWN".to_string(),
    }
}

fn pool_type_to_string(pool_type: i32) -> String {
    match pool_type {
        0 => "UNSPECIFIED".to_string(),
        1 => "LOCAL_DIR".to_string(),
        2 => "NFS".to_string(),
        3 => "CEPH_RBD".to_string(),
        4 => "ISCSI".to_string(),
        _ => "UNKNOWN".to_string(),
    }
}
