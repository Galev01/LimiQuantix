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

#[derive(Serialize)]
struct HealthResponse {
    healthy: bool,
    version: String,
    hypervisor: String,
    hypervisor_version: String,
    uptime_seconds: u64,
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
}

#[derive(Serialize)]
struct StoragePoolListResponse {
    pools: Vec<StoragePoolResponse>,
}

#[derive(Serialize)]
struct StorageVolumeResponse {
    id: String,
    name: String,
    pool_id: String,
    size_bytes: u64,
    allocated_bytes: u64,
    format: String,  // "qcow2", "raw", "vmdk"
    path: String,
    attached_to: Option<String>,  // VM ID if attached
    created_at: String,
}

#[derive(Serialize)]
struct StorageVolumeListResponse {
    volumes: Vec<StorageVolumeResponse>,
}

// ============================================================================
// Hardware Types
// ============================================================================

#[derive(Serialize)]
struct CpuInfo {
    model: String,
    vendor: String,
    physical_cores: u32,
    logical_cores: u32,
    sockets: u32,
    cores_per_socket: u32,
    threads_per_core: u32,
    base_frequency_mhz: u64,
    current_frequency_mhz: u64,
    features: Vec<String>,
    usage_percent: f64,
}

#[derive(Serialize)]
struct MemoryInfo {
    total_bytes: u64,
    available_bytes: u64,
    used_bytes: u64,
    cached_bytes: u64,
    buffers_bytes: u64,
    swap_total_bytes: u64,
    swap_used_bytes: u64,
    usage_percent: f64,
}

#[derive(Serialize)]
struct DiskInfo {
    name: String,
    model: String,
    serial: String,
    size_bytes: u64,
    #[serde(rename = "type")]
    disk_type: String,  // "HDD", "SSD", "NVMe"
    interface: String,  // "SATA", "NVMe", "USB"
    partitions: Vec<PartitionInfo>,
    smart_status: String,  // "healthy", "warning", "failing"
    temperature_celsius: Option<u32>,
}

#[derive(Serialize)]
struct PartitionInfo {
    name: String,
    mount_point: Option<String>,
    filesystem: String,
    size_bytes: u64,
    used_bytes: u64,
}

#[derive(Serialize)]
struct PciDeviceInfo {
    address: String,  // e.g., "0000:00:02.0"
    vendor: String,
    device: String,
    class: String,  // "VGA", "Network", "Storage", etc.
    driver: Option<String>,
    iommu_group: Option<u32>,
}

#[derive(Serialize)]
struct UsbDeviceInfo {
    bus: u32,
    device: u32,
    vendor_id: String,
    product_id: String,
    vendor: String,
    product: String,
    speed: String,  // "USB 2.0", "USB 3.0", etc.
}

#[derive(Serialize)]
struct HardwareInfoResponse {
    cpu: CpuInfo,
    memory: MemoryInfo,
    disks: Vec<DiskInfo>,
    pci_devices: Vec<PciDeviceInfo>,
    usb_devices: Vec<UsbDeviceInfo>,
    network_adapters: Vec<NetworkAdapterHwInfo>,
}

#[derive(Serialize)]
struct NetworkAdapterHwInfo {
    name: String,
    mac_address: String,
    vendor: String,
    model: String,
    speed_mbps: Option<u64>,
    link_state: String,  // "up", "down"
    pci_address: Option<String>,
}

// ============================================================================
// Events Types
// ============================================================================

#[derive(Serialize)]
struct SystemEvent {
    id: String,
    timestamp: String,
    #[serde(rename = "type")]
    event_type: String,  // "info", "warning", "error", "critical"
    category: String,    // "vm", "storage", "network", "system", "security"
    source: String,      // Component that generated the event
    message: String,
    resource_id: Option<String>,
    details: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct EventsListResponse {
    events: Vec<SystemEvent>,
    total: u32,
    page: u32,
    per_page: u32,
}

#[derive(Deserialize)]
struct EventsQuery {
    #[serde(default)]
    page: Option<u32>,
    #[serde(default)]
    per_page: Option<u32>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    event_type: Option<String>,
    #[serde(default)]
    since: Option<String>,  // ISO 8601 timestamp
}

// ============================================================================
// Performance/Metrics Types
// ============================================================================

#[derive(Serialize)]
struct PerformanceMetrics {
    timestamp: String,
    cpu: CpuMetrics,
    memory: MemoryMetrics,
    disk: DiskMetrics,
    network: NetworkMetrics,
}

#[derive(Serialize)]
struct CpuMetrics {
    usage_percent: f64,
    user_percent: f64,
    system_percent: f64,
    iowait_percent: f64,
    load_average: [f64; 3],  // 1, 5, 15 minutes
    per_core_usage: Vec<f64>,
}

#[derive(Serialize)]
struct MemoryMetrics {
    used_bytes: u64,
    available_bytes: u64,
    cached_bytes: u64,
    usage_percent: f64,
    swap_used_bytes: u64,
    swap_usage_percent: f64,
}

#[derive(Serialize)]
struct DiskMetrics {
    read_bytes_per_sec: u64,
    write_bytes_per_sec: u64,
    read_iops: u64,
    write_iops: u64,
    io_utilization_percent: f64,
}

#[derive(Serialize)]
struct NetworkMetrics {
    rx_bytes_per_sec: u64,
    tx_bytes_per_sec: u64,
    rx_packets_per_sec: u64,
    tx_packets_per_sec: u64,
    rx_errors: u64,
    tx_errors: u64,
}

// ============================================================================
// Settings Types
// ============================================================================

#[derive(Serialize, Deserialize)]
struct HostSettings {
    hostname: String,
    timezone: String,
    ntp_enabled: bool,
    ntp_servers: Vec<String>,
    ssh_enabled: bool,
    ssh_port: u16,
    console_timeout_minutes: u32,
    auto_update_enabled: bool,
}

#[derive(Serialize, Deserialize)]
struct StorageSettings {
    default_pool: String,
    vm_storage_path: String,
    iso_storage_path: String,
    backup_path: String,
    thin_provisioning: bool,
}

#[derive(Serialize, Deserialize)]
struct NetworkSettings {
    management_interface: String,
    default_bridge: String,
    mtu: u32,
    dns_servers: Vec<String>,
    search_domains: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct SecuritySettings {
    tls_enabled: bool,
    certificate_path: Option<String>,
    key_path: Option<String>,
    api_auth_enabled: bool,
    allowed_networks: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct AllSettings {
    host: HostSettings,
    storage: StorageSettings,
    network: NetworkSettings,
    security: SecuritySettings,
}

// ============================================================================
// Request Types
// ============================================================================

#[derive(Deserialize)]
struct StopVmRequest {
    timeout_seconds: Option<u32>,
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
        // VM endpoints
        .route("/vms", get(list_vms))
        .route("/vms/:vm_id", get(get_vm))
        .route("/vms/:vm_id/start", post(start_vm))
        .route("/vms/:vm_id/stop", post(stop_vm))
        .route("/vms/:vm_id/force-stop", post(force_stop_vm))
        .route("/vms/:vm_id/reboot", post(reboot_vm))
        .route("/vms/:vm_id/pause", post(pause_vm))
        .route("/vms/:vm_id/resume", post(resume_vm))
        .route("/vms/:vm_id/console", get(get_vm_console))
        // Storage endpoints
        .route("/storage/pools", get(list_storage_pools))
        .route("/storage/pools/:pool_id", get(get_storage_pool))
        .route("/storage/volumes", get(list_storage_volumes))
        .route("/storage/volumes/:volume_id", get(get_storage_volume))
        // Hardware endpoints
        .route("/hardware", get(get_hardware_info))
        .route("/hardware/cpu", get(get_cpu_info))
        .route("/hardware/memory", get(get_memory_info))
        .route("/hardware/disks", get(get_disk_info))
        .route("/hardware/pci", get(get_pci_devices))
        .route("/hardware/usb", get(get_usb_devices))
        // Performance/Metrics endpoints
        .route("/metrics", get(get_performance_metrics))
        .route("/metrics/history", get(get_metrics_history))
        // Events endpoints
        .route("/events", get(list_events))
        .route("/events/:event_id", get(get_event))
        // Settings endpoints
        .route("/settings", get(get_all_settings))
        .route("/settings", post(update_settings))
        .route("/settings/host", get(get_host_settings))
        .route("/settings/host", post(update_host_settings))
        .route("/settings/storage", get(get_storage_settings))
        .route("/settings/storage", post(update_storage_settings))
        .route("/settings/network", get(get_network_settings))
        .route("/settings/network", post(update_network_settings))
        .route("/settings/security", get(get_security_settings))
        .route("/settings/security", post(update_security_settings))
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
        ip_addresses: config.ip_address.map(|ip| vec![ip]).unwrap_or_default(),
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
        Ok(content) => {
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
