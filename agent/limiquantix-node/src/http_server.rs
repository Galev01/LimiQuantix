//! HTTP Server for Web UI
//!
//! This module provides:
//! - Static file serving for the React-based Host UI
//! - REST API endpoints that proxy to the gRPC service
//! - HTTPS with TLS certificate management
//! - HTTP to HTTPS redirect
//! - WebSocket support for real-time updates (future)
//!
//! The HTTP server runs on port 8443 (HTTPS) alongside the gRPC server on port 9443.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use once_cell::sync::Lazy;
use futures::StreamExt;
use tokio::io::AsyncWriteExt;

use axum::{
    Router,
    routing::{get, post},
    extract::{Path, State, Multipart, Query, DefaultBodyLimit, ws::{Message, WebSocket}},
    http::{StatusCode, header, Method, Uri, HeaderMap},
    response::{IntoResponse, Response, Json, Redirect},
    body::Body,
};
use axum_server::tls_rustls::RustlsConfig;
use tower_http::{
    cors::{CorsLayer, Any},
    trace::TraceLayer,
    services::ServeDir,
};
use tokio::fs;
use tracing::{info, warn, error, debug};
use serde::{Deserialize, Serialize};

use crate::config::TlsConfig;
use crate::service::NodeDaemonServiceImpl;
use crate::tls::{TlsManager, AcmeManager, CertificateInfo, AcmeAccountInfo, AcmeChallengeStatus};
use crate::update::{UpdateManager, UpdateStatus};

use limiquantix_telemetry::TelemetryCollector;

/// Shared state for HTTP handlers
pub struct AppState {
    /// Reference to the node daemon service
    pub service: Arc<NodeDaemonServiceImpl>,
    /// Path to webui static files
    pub webui_path: PathBuf,
    /// TLS manager for certificate operations
    pub tls_manager: Arc<TlsManager>,
    /// TLS configuration
    pub tls_config: TlsConfig,
    /// Direct access to telemetry collector for disk I/O rates
    pub telemetry: Arc<TelemetryCollector>,
    /// Storage manager for pool operations (e.g., ISO uploads to pools)
    pub storage: Arc<limiquantix_hypervisor::storage::StorageManager>,
    /// OTA Update manager for checking and applying updates
    pub update_manager: Arc<UpdateManager>,
    /// ISO Manager for ISO file tracking and sync
    pub iso_manager: Arc<crate::iso_manager::IsoManager>,
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
struct HardwareInventory {
    cpu: CpuInfo,
    memory: MemoryInfo,
    storage: Vec<DiskInfo>,
    network: Vec<NicInfo>,
    gpus: Vec<GpuInfo>,
    pci_devices: Vec<PciDevice>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
struct PartitionInfo {
    name: String,
    mount_point: Option<String>,
    size_bytes: u64,
    used_bytes: u64,
    filesystem: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
struct GpuInfo {
    name: String,
    vendor: String,
    pci_address: String,
    driver: String,
    memory_bytes: Option<u64>,
    passthrough_capable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PciDevice {
    address: String,
    vendor: String,
    device: String,
    class: String,
    driver: Option<String>,
    iommu_group: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
struct EventListResponse {
    events: Vec<EventResponse>,
    total_count: u32,
}

/// Query parameters for event filtering
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventQueryParams {
    /// Filter by level: debug, info, warning, error
    level: Option<String>,
    /// Filter by category: system, vm, storage, network, cluster, security
    category: Option<String>,
    /// Maximum number of events to return
    limit: Option<usize>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
struct UpdateSettingsRequest {
    node_name: Option<String>,
    log_level: Option<String>,
    #[allow(dead_code)] // Will be used when storage settings are implemented
    storage_default_pool: Option<String>,
    #[allow(dead_code)] // Will be used when network defaults are implemented
    network_default_bridge: Option<String>,
    #[allow(dead_code)] // Will be used when VNC settings are implemented
    vnc_listen_address: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceInfo {
    name: String,
    status: String,
    enabled: bool,
    description: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceListResponse {
    services: Vec<ServiceInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VmResponse {
    vm_id: String,
    name: String,
    state: String,
    cpu_usage_percent: f64,
    memory_used_bytes: u64,
    memory_total_bytes: u64,
    guest_agent: Option<GuestAgentInfo>,
    disks: Vec<DiskSpecResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskSpecResponse {
    id: String,
    path: String,
    size_gib: u64,
    bus: String,
    format: String,
    readonly: bool,
    bootable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GuestAgentInfo {
    connected: bool,
    version: String,
    os_name: String,
    hostname: String,
    ip_addresses: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VmListResponse {
    vms: Vec<VmResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleResponse {
    console_type: String,
    host: String,
    port: u32,
    password: String,
    websocket_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoragePoolResponse {
    pool_id: String,
    /// Friendly name from QvDC (e.g., "NFS01")
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(rename = "type")]
    pool_type: String,
    mount_path: String,
    total_bytes: u64,
    available_bytes: u64,
    used_bytes: u64,
    volume_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoragePoolListResponse {
    pools: Vec<StoragePoolResponse>,
}

/// Local block device information for storage discovery
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalDeviceInfo {
    /// Device path (e.g., /dev/nvme0n1, /dev/sda)
    device: String,
    /// Device name/model
    name: String,
    /// Device type (nvme, ssd, hdd)
    device_type: String,
    /// Total size in bytes
    total_bytes: u64,
    /// Whether the device is already in use (has partitions or is mounted)
    in_use: bool,
    /// Partitions on this device
    partitions: Vec<LocalPartitionInfo>,
    /// Whether this device can be initialized as a qDV
    can_initialize: bool,
    /// Serial number if available
    serial: Option<String>,
    /// Model name
    model: Option<String>,
}

/// Partition information for local device discovery
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalPartitionInfo {
    /// Partition device path (e.g., /dev/nvme0n1p1)
    device: String,
    /// Filesystem type (ext4, xfs, ntfs, etc.)
    filesystem: Option<String>,
    /// Mount point if mounted
    mount_point: Option<String>,
    /// Partition size in bytes
    size_bytes: u64,
    /// Used space in bytes
    used_bytes: u64,
    /// Partition label
    label: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalDeviceListResponse {
    devices: Vec<LocalDeviceInfo>,
}

/// Request to initialize a local device as a qDV storage pool
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InitializeDeviceRequest {
    /// Name for the new storage pool
    pool_name: String,
    /// Filesystem to use (ext4, xfs)
    filesystem: Option<String>,
    /// Whether to wipe existing data (required for safety)
    confirm_wipe: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InitializeDeviceResponse {
    success: bool,
    pool_id: Option<String>,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateStoragePoolRequest {
    pool_id: String,
    #[serde(rename = "type")]
    pool_type: String,  // "LOCAL_DIR", "NFS", "CEPH_RBD", "ISCSI"
    path: Option<String>,
    nfs_server: Option<String>,
    nfs_export: Option<String>,
    /// Optional capacity limit in GiB for local directory pools (None = use filesystem capacity)
    capacity_gib: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VolumeResponse {
    volume_id: String,
    pool_id: String,
    size_bytes: u64,
    format: String,
    path: String,
    attached_to: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VolumeListResponse {
    volumes: Vec<VolumeResponse>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateVolumeRequest {
    volume_id: String,
    size_bytes: u64,
    #[allow(dead_code)] // Format selection will be implemented
    format: Option<String>,  // "qcow2", "raw"
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageResponse {
    image_id: String,
    name: String,
    path: String,
    size_bytes: u64,
    format: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageListResponse {
    images: Vec<ImageResponse>,
}

// ============================================================================
// Request Types
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StopVmRequest {
    timeout_seconds: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateVmRequest {
    name: String,
    cpu_cores: u32,
    cpu_sockets: Option<u32>,
    memory_mib: u64,
    disks: Vec<DiskSpecRequest>,
    nics: Vec<NicSpecRequest>,
    cloud_init: Option<CloudInitRequest>,
    /// Guest OS family - determines hardware configuration (timers, video, CPU mode)
    /// Values: 'rhel', 'debian', 'fedora', 'windows_server', 'windows_desktop', etc.
    guest_os: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskSpecRequest {
    id: String,
    size_gib: u64,
    bus: Option<String>,
    format: Option<String>,
    backing_file: Option<String>,
    bootable: Option<bool>,
    /// Storage pool to create the disk in (e.g., "SSD-local01", "nfs-xxx")
    pool_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NicSpecRequest {
    id: String,
    network: Option<String>,
    bridge: Option<String>,
    mac_address: Option<String>,
    model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudInitRequest {
    user_data: Option<String>,
    meta_data: Option<String>,
    network_config: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSnapshotRequest {
    name: String,
    description: Option<String>,
    quiesce: Option<bool>,
    include_memory: Option<bool>,  // If false (default), create disk-only snapshot; if true, include memory state
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotResponse {
    snapshot_id: String,
    name: String,
    description: String,
    created_at: String,
    vm_state: String,
    parent_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotListResponse {
    snapshots: Vec<SnapshotResponse>,
}

// ============================================================================
// Cluster Types
// ============================================================================

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClusterConfig {
    enabled: bool,
    control_plane_address: String,
    node_id: Option<String>,
    registration_token: Option<String>,
    heartbeat_interval_secs: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Reserved for future cluster join flow
struct JoinClusterRequest {
    control_plane_address: String,
    registration_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClusterStatus {
    joined: bool,
    control_plane_address: Option<String>,
    node_id: Option<String>,
    last_heartbeat: Option<String>,
    status: String,       // "connected", "disconnected", "standalone", "pending_restart"
    mode: String,         // "cluster" or "standalone"
    cluster_name: Option<String>,
}

/// Request to test connection to vDC control plane
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestConnectionRequest {
    control_plane_url: String,
}

/// Response from testing connection to vDC
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TestConnectionResponse {
    success: bool,
    message: String,
    cluster_name: Option<String>,
    cluster_version: Option<String>,
}

/// Response containing generated token for vDC registration
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateTokenResponse {
    token: String,
    node_id: String,
    host_name: String,
    management_ip: String,
    expires_at: String,
}

/// Registration token for vDC to add this host
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegistrationToken {
    token: String,
    created_at: String,
    expires_at: String,
    expires_in_seconds: u64,
    hostname: String,
    management_ip: String,
}

/// Full hardware inventory for host discovery
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostDiscoveryResponse {
    hostname: String,
    management_ip: String,
    cpu: CpuInfo,
    memory: MemoryInfo,
    storage: StorageInventory,
    network: Vec<NicInfo>,
    gpus: Vec<GpuInfo>,
}

/// Storage inventory including local, NFS, and iSCSI storage
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageInventory {
    local: Vec<DiskInfo>,
    nfs: Vec<NfsMount>,
    iscsi: Vec<IscsiTarget>,
}

/// NFS mount information
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NfsMount {
    mount_point: String,
    server: String,
    export_path: String,
    size_bytes: u64,
    used_bytes: u64,
    available_bytes: u64,
}

/// iSCSI target information
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IscsiTarget {
    target_iqn: String,
    portal: String,
    device_path: String,
    size_bytes: u64,
    lun: u32,
}

// ============================================================================
// System Logs Types
// ============================================================================

/// Log entry from the system
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEntry {
    timestamp: String,
    level: String,
    message: String,
    source: Option<String>,
    fields: Option<serde_json::Value>,
    stack_trace: Option<String>,
    request_id: Option<String>,
    vm_id: Option<String>,
    node_id: Option<String>,
    duration_ms: Option<u64>,
    // UI-specific fields
    action: Option<String>,
    component: Option<String>,
    target: Option<String>,
    correlation_id: Option<String>,
    user_id: Option<String>,
    session_id: Option<String>,
    user_action: Option<bool>,
}

/// Response for logs listing
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogsResponse {
    logs: Vec<LogEntry>,
    total: usize,
    has_more: bool,
}

/// Query parameters for logs
#[derive(Deserialize)]
struct LogsQuery {
    level: Option<String>,
    source: Option<String>,
    search: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
    since: Option<String>,
    until: Option<String>,
}

/// UI log entry submitted from the frontend
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UILogEntry {
    timestamp: String,
    level: String,
    action: String,
    component: String,
    target: String,
    message: String,
    metadata: Option<serde_json::Value>,
    correlation_id: Option<String>,
    user_id: Option<String>,
    session_id: Option<String>,
    user_action: bool,
}

/// Request body for submitting UI logs
#[derive(Deserialize)]
struct UILogsRequest {
    logs: Vec<UILogEntry>,
}

/// Response for UI log submission
#[derive(Serialize)]
struct UILogsResponse {
    accepted: usize,
    message: String,
}

// ============================================================================
// Network Types
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
struct NetworkInterfaceList {
    interfaces: Vec<NetworkInterface>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigureInterfaceRequest {
    dhcp: bool,
    ip_address: Option<String>,
    netmask: Option<String>,
    gateway: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBridgeRequest {
    name: String,
    interfaces: Vec<String>,  // Physical interfaces to add to bridge
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DnsConfig {
    nameservers: Vec<String>,
    search_domains: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostnameConfig {
    hostname: String,
}

// ============================================================================
// HTTP/HTTPS Server
// ============================================================================

/// Start HTTP server for Web UI (port 8080 by default)
pub async fn run_http_server(
    http_addr: SocketAddr,
    service: Arc<NodeDaemonServiceImpl>,
    webui_path: PathBuf,
    tls_config: TlsConfig,
    telemetry: Arc<TelemetryCollector>,
    update_manager: Arc<UpdateManager>,
    control_plane_address: String,
) -> anyhow::Result<()> {
    // Initialize TLS manager (needed for certificate management API even if HTTPS is disabled)
    let tls_manager = Arc::new(TlsManager::new(tls_config.clone()));
    
    // Get storage manager from service for ISO uploads to pools
    let storage = service.get_storage_manager();
    
    // Initialize ISO manager
    let iso_manager = Arc::new(crate::iso_manager::IsoManager::new(control_plane_address));
    if let Err(e) = iso_manager.load().await {
        warn!(error = %e, "Failed to load ISO metadata (starting fresh)");
    }
    // Scan for ISOs on startup
    if let Err(e) = iso_manager.scan_directories().await {
        warn!(error = %e, "Failed to scan ISO directories on startup");
    }
    
    let state = Arc::new(AppState {
        service,
        webui_path: webui_path.clone(),
        tls_manager: tls_manager.clone(),
        tls_config: tls_config.clone(),
        telemetry,
        storage,
        update_manager,
        iso_manager,
    });

    // Build the application router
    let app = build_app_router(state, &webui_path);

    info!(address = %http_addr, "Starting HTTP server for Web UI");
    
    let listener = tokio::net::TcpListener::bind(http_addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Start HTTPS server for Web UI (port 8443 by default)
pub async fn run_https_server(
    https_addr: SocketAddr,
    service: Arc<NodeDaemonServiceImpl>,
    webui_path: PathBuf,
    tls_config: TlsConfig,
    telemetry: Arc<TelemetryCollector>,
    update_manager: Arc<UpdateManager>,
    control_plane_address: String,
) -> anyhow::Result<()> {
    // Initialize TLS manager and certificates
    let tls_manager = Arc::new(TlsManager::new(tls_config.clone()));
    tls_manager.initialize().await?;
    
    // Get storage manager from service for ISO uploads to pools
    let storage = service.get_storage_manager();
    
    // Initialize ISO manager
    let iso_manager = Arc::new(crate::iso_manager::IsoManager::new(control_plane_address));
    if let Err(e) = iso_manager.load().await {
        warn!(error = %e, "Failed to load ISO metadata (starting fresh)");
    }
    // Scan for ISOs on startup
    if let Err(e) = iso_manager.scan_directories().await {
        warn!(error = %e, "Failed to scan ISO directories on startup");
    }
    
    let state = Arc::new(AppState {
        service,
        webui_path: webui_path.clone(),
        tls_manager: tls_manager.clone(),
        tls_config: tls_config.clone(),
        telemetry,
        storage,
        update_manager,
        iso_manager,
    });

    // Build the application router
    let app = build_app_router(state, &webui_path);

    // Load TLS configuration
    let rustls_config = RustlsConfig::from_pem_file(
        &tls_config.cert_path,
        &tls_config.key_path,
    )
    .await
    .map_err(|e| anyhow::anyhow!("Failed to load TLS certificates: {}", e))?;
    
    info!(
        address = %https_addr,
        cert = %tls_config.cert_path,
        "Starting HTTPS server for Web UI"
    );
    
    axum_server::bind_rustls(https_addr, rustls_config)
        .serve(app.into_make_service())
        .await?;

    Ok(())
}

/// Build the application router with all routes
fn build_app_router(state: Arc<AppState>, webui_path: &PathBuf) -> Router {
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
        .route("/vms/:vm_id/logs", get(get_vm_logs))
        .route("/vms/:vm_id/snapshots", get(list_snapshots))
        .route("/vms/:vm_id/snapshots", post(create_snapshot))
        .route("/vms/:vm_id/snapshots/:snapshot_id", axum::routing::delete(delete_snapshot))
        .route("/vms/:vm_id/snapshots/:snapshot_id/revert", post(revert_snapshot))
        // Quantix Agent endpoints (advanced agent)
        .route("/vms/:vm_id/agent/ping", get(ping_quantix_agent))
        .route("/vms/:vm_id/agent/install", post(install_quantix_agent))
        .route("/vms/:vm_id/agent/update", post(update_quantix_agent))
        .route("/vms/:vm_id/agent/refresh", post(refresh_quantix_agent))
        .route("/vms/:vm_id/agent/logs", get(get_agent_logs))
        .route("/vms/:vm_id/agent/shutdown", post(agent_shutdown))
        .route("/vms/:vm_id/agent/reboot", post(agent_reboot))
        .route("/vms/:vm_id/agent/files/list", get(list_guest_files))
        .route("/vms/:vm_id/agent/files/read", get(read_guest_file))
        .route("/vms/:vm_id/execute", post(execute_in_guest))
        // Agent ISO installation endpoint
        .route("/vms/:vm_id/cdrom/mount-agent-iso", post(mount_agent_iso))
        .route("/vms/:vm_id/cdrom/eject", post(eject_cdrom))
        // QEMU Guest Agent endpoints (basic hypervisor agent)
        .route("/vms/:vm_id/qemu-agent/ping", get(ping_qemu_guest_agent))
        .route("/vms/:vm_id/qemu-agent/exec", post(exec_qemu_guest_agent))
        .route("/vms/:vm_id/qemu-agent/file-write", post(qemu_agent_file_write))
        // Storage endpoints
        .route("/storage/pools", get(list_storage_pools))
        .route("/storage/pools", post(create_storage_pool))
        // Upload endpoint with disabled body limit for large ISO files
        .route("/storage/upload", post(upload_image).layer(DefaultBodyLimit::disable()))
        .route("/storage/pools/:pool_id", get(get_storage_pool))
        .route("/storage/pools/:pool_id", axum::routing::delete(delete_storage_pool))
        .route("/storage/pools/:pool_id/volumes", get(list_volumes))
        .route("/storage/pools/:pool_id/volumes", post(create_volume))
        .route("/storage/pools/:pool_id/volumes/:volume_id", axum::routing::delete(delete_volume))
        .route("/storage/images", get(list_images))
        // ISO management endpoints
        .route("/images", get(list_isos))
        .route("/images/:id", get(get_iso))
        .route("/images/:id/move", post(move_iso_to_folder))
        .route("/images/:id", axum::routing::delete(delete_iso))
        .route("/images/folders", get(list_iso_folders))
        .route("/images/scan", post(scan_iso_directories))
        .route("/images/sync", post(sync_isos_to_control_plane))
        // Cloud image download endpoint (for vDC to download images to this node's storage)
        .route("/images/download", post(download_cloud_image))
        .route("/images/download/:job_id", get(get_download_status))
        // Local storage device discovery
        .route("/storage/local-devices", get(list_local_devices))
        .route("/storage/local-devices/:device/initialize", post(initialize_local_device))
        // Disk conversion endpoint (VMDK to QCOW2)
        .route("/storage/convert", post(convert_disk_format))
        .route("/storage/convert/:job_id", get(get_conversion_status))
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
        .route("/cluster/leave", post(leave_cluster))
        .route("/cluster/config", get(get_cluster_config))
        // Token-based cluster connection (Host UI generates token, vDC uses it to add host)
        .route("/cluster/test-connection", post(test_vdc_connection))
        .route("/cluster/generate-token", post(generate_cluster_registration_token))
        // Registration endpoints (for vDC to discover and add this host)
        .route("/registration/ping", get(registration_ping))  // Diagnostic endpoint (no auth)
        .route("/registration/token", post(generate_registration_token))
        .route("/registration/token", get(get_current_registration_token))
        .route("/registration/discovery", get(get_host_discovery))
        .route("/registration/complete", post(complete_registration))
        // System logs endpoints
        .route("/logs", get(get_logs))
        .route("/logs/sources", get(get_log_sources))
        .route("/logs/ui", post(submit_ui_logs))
        .route("/logs/stream", get(stream_logs_ws))
        // Settings endpoints
        .route("/settings", get(get_settings))
        .route("/settings", post(update_settings))
        .route("/settings/services", get(list_services))
        .route("/settings/services/:name/restart", post(restart_service))
        // Certificate management endpoints
        .route("/settings/certificates", get(get_certificate_info))
        .route("/settings/certificates", axum::routing::delete(reset_certificate))
        .route("/settings/certificates/upload", post(upload_certificate))
        .route("/settings/certificates/generate", post(generate_self_signed))
        .route("/settings/certificates/acme", get(get_acme_info))
        .route("/settings/certificates/acme/register", post(register_acme_account))
        .route("/settings/certificates/acme/issue", post(issue_acme_certificate))
        // OTA Update endpoints
        .route("/updates/check", get(check_for_updates))
        .route("/updates/version", get(get_simple_version))  // Simple version endpoint (no update server required)
        .route("/updates/current", get(get_current_versions))
        .route("/updates/status", get(get_update_status))
        .route("/updates/apply", post(apply_updates))
        .route("/updates/config", get(get_update_config).put(save_update_config))
        .route("/updates/volumes", get(list_update_volumes))
        // Guest Agent download endpoints (for cloud-init installation)
        .route("/agent/version", get(get_agent_version))
        .route("/agent/install.sh", get(get_agent_install_script))
        .route("/agent/linux/binary/:arch", get(download_agent_binary))
        .route("/agent/linux/deb/:arch", get(download_agent_deb))
        .route("/agent/linux/rpm/:arch", get(download_agent_rpm))
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

    app
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

/// Start HTTP→HTTPS redirect server (port 80 by default)
pub async fn run_redirect_server(redirect_addr: SocketAddr, https_port: u16) {
    info!(
        address = %redirect_addr,
        https_port = https_port,
        "Starting HTTP→HTTPS redirect server"
    );
    
    let redirect_app = Router::new()
        .fallback(move |uri: Uri, headers: axum::http::HeaderMap| async move {
            // Get the host from the request
            let host = headers
                .get(header::HOST)
                .and_then(|h| h.to_str().ok())
                .map(|h| {
                    // Remove port from host if present
                    h.split(':').next().unwrap_or(h).to_string()
                })
                .unwrap_or_else(|| "localhost".to_string());
            
            // Build HTTPS URL
            let https_url = if https_port == 443 {
                format!("https://{}{}", host, uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/"))
            } else {
                format!("https://{}:{}{}", host, https_port, uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/"))
            };
            
            debug!(from = %uri, to = %https_url, "Redirecting HTTP to HTTPS");
            
            Redirect::permanent(&https_url)
        });
    
    match tokio::net::TcpListener::bind(redirect_addr).await {
        Ok(listener) => {
            info!(address = %redirect_addr, "HTTP redirect server started");
            if let Err(e) = axum::serve(listener, redirect_app).await {
                error!(error = %e, "HTTP redirect server failed");
            }
        }
        Err(e) => {
            warn!(
                error = %e,
                address = %redirect_addr,
                "Failed to start HTTP redirect server (port may be in use or require root)"
            );
        }
    }
}

// ============================================================================
// OTA Update API Handlers
// ============================================================================

/// Response type for update check
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckResponse {
    available: bool,
    current_version: String,
    latest_version: Option<String>,
    channel: String,
    components: Vec<ComponentUpdateEntry>,
    full_image_available: bool,
    total_download_size: u64,
    release_notes: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComponentUpdateEntry {
    name: String,
    current_version: Option<String>,
    new_version: String,
    size_bytes: u64,
}

/// Response type for current versions
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CurrentVersionsResponse {
    os_version: String,
    qx_node: Option<String>,
    qx_console: Option<String>,
    host_ui: Option<String>,
}

/// Response type for update status
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatusResponse {
    status: String,
    message: Option<String>,
    progress: Option<UpdateProgressInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgressInfo {
    current_component: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    percentage: u8,
}

/// Response type for update config
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateConfigResponse {
    enabled: bool,
    server_url: String,
    channel: String,
    check_interval: String,
    auto_apply: bool,
    storage_location: String,
    volume_path: Option<String>,
}

/// Response type for simple version query (no update server required)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SimpleVersionResponse {
    current_version: String,
    channel: String,
    hostname: String,
}

/// GET /api/v1/updates/version - Get current version without contacting update server
/// This is a lightweight endpoint that QvDC can use to get the host's version
async fn get_simple_version(
    State(state): State<Arc<AppState>>,
) -> Json<SimpleVersionResponse> {
    let versions = state.update_manager.get_installed_versions().await;
    let config = state.update_manager.get_config().await;
    
    // Get hostname
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    
    Json(SimpleVersionResponse {
        current_version: versions.os_version,
        channel: config.channel,
        hostname,
    })
}

/// GET /api/v1/updates/check - Check for available updates
async fn check_for_updates(
    State(state): State<Arc<AppState>>,
) -> Result<Json<UpdateCheckResponse>, (StatusCode, Json<ApiError>)> {
    // Check for updates using the shared UpdateManager
    match state.update_manager.check_for_updates().await {
        Ok(info) => {
            Ok(Json(UpdateCheckResponse {
                available: info.available,
                current_version: info.current_version,
                latest_version: info.latest_version,
                channel: info.channel,
                components: info.components.into_iter().map(|c| ComponentUpdateEntry {
                    name: c.name,
                    current_version: c.current_version,
                    new_version: c.new_version,
                    size_bytes: c.size_bytes,
                }).collect(),
                full_image_available: info.full_image_available,
                total_download_size: info.total_download_size,
                release_notes: info.release_notes,
            }))
        }
        Err(e) => {
            error!(error = %e, "Failed to check for updates");
            Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ApiError::new("update_check_failed", &format!("Failed to check for updates: {}", e))),
            ))
        }
    }
}

/// GET /api/v1/updates/current - Get currently installed versions
async fn get_current_versions(
    State(state): State<Arc<AppState>>,
) -> Result<Json<CurrentVersionsResponse>, (StatusCode, Json<ApiError>)> {
    let versions = state.update_manager.get_installed_versions().await;
    
    Ok(Json(CurrentVersionsResponse {
        os_version: versions.os_version,
        qx_node: versions.qx_node,
        qx_console: versions.qx_console,
        host_ui: versions.host_ui,
    }))
}

/// GET /api/v1/updates/status - Get current update status
async fn get_update_status(
    State(state): State<Arc<AppState>>,
) -> Result<Json<UpdateStatusResponse>, (StatusCode, Json<ApiError>)> {
    let status = state.update_manager.get_status().await;
    
    let (status_str, message, progress) = match status {
        UpdateStatus::Idle => ("idle", None, None),
        UpdateStatus::Checking => ("checking", None, None),
        UpdateStatus::UpToDate => ("up_to_date", None, None),
        UpdateStatus::Available(ver) => ("available", Some(format!("Version {} available", ver)), None),
        UpdateStatus::Downloading(prog) => ("downloading", None, Some(UpdateProgressInfo {
            current_component: prog.current_component,
            downloaded_bytes: prog.downloaded_bytes,
            total_bytes: prog.total_bytes,
            percentage: prog.percentage,
        })),
        UpdateStatus::Applying(msg) => ("applying", Some(msg), None),
        UpdateStatus::Complete(ver) => ("complete", Some(format!("Updated to version {}", ver)), None),
        UpdateStatus::Error(err) => ("error", Some(err), None),
        UpdateStatus::RebootRequired => ("reboot_required", Some("Please reboot to complete the update".to_string()), None),
    };
    
    Ok(Json(UpdateStatusResponse {
        status: status_str.to_string(),
        message,
        progress,
    }))
}

/// POST /api/v1/updates/apply - Apply available updates
/// 
/// Starts the update process in the background and returns immediately.
/// Poll GET /api/v1/updates/status to check progress.
async fn apply_updates(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    // Check if already updating
    let current_status = state.update_manager.get_status().await;
    match current_status {
        UpdateStatus::Downloading(_) | UpdateStatus::Applying(_) => {
            return Err((
                StatusCode::CONFLICT,
                Json(ApiError::new("update_in_progress", "An update is already in progress")),
            ));
        }
        _ => {}
    }
    
    // Clone the manager for the background task
    let manager = state.update_manager.clone();
    
    // Start update in background task
    tokio::spawn(async move {
        info!("Starting background update application");
        if let Err(e) = manager.apply_updates().await {
            error!(error = %e, "Background update application failed");
        }
    });
    
    Ok(Json(serde_json::json!({
        "status": "started",
        "message": "Update process started. Poll /api/v1/updates/status for progress."
    })))
}

/// GET /api/v1/updates/config - Get update configuration
async fn get_update_config(
    State(state): State<Arc<AppState>>,
) -> Result<Json<UpdateConfigResponse>, (StatusCode, Json<ApiError>)> {
    let config = state.update_manager.get_config().await;
    
    Ok(Json(UpdateConfigResponse {
        enabled: config.enabled,
        server_url: config.server_url.clone(),
        channel: config.channel.clone(),
        check_interval: config.check_interval.clone(),
        auto_apply: config.auto_apply,
        storage_location: config.storage_location.to_string(),
        volume_path: config.volume_path.clone(),
    }))
}

/// Request type for update config changes
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateConfigUpdateRequest {
    server_url: Option<String>,
    channel: Option<String>,
    storage_location: Option<String>,
    volume_path: Option<String>,
}

/// PUT /api/v1/updates/config - Update the update configuration
/// 
/// Allows changing the update server URL, channel, and storage location at runtime.
/// Changes are applied immediately and persisted to /etc/limiquantix/node.yaml.
async fn save_update_config(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateConfigUpdateRequest>,
) -> Result<Json<UpdateConfigResponse>, (StatusCode, Json<ApiError>)> {
    use crate::update::StorageLocation;
    
    info!(
        server_url = ?req.server_url,
        channel = ?req.channel,
        storage_location = ?req.storage_location,
        volume_path = ?req.volume_path,
        "Update config change requested"
    );
    
    // Parse storage location if provided
    let storage_location = match &req.storage_location {
        Some(loc) => Some(loc.parse::<StorageLocation>().map_err(|e| {
            (StatusCode::BAD_REQUEST, Json(ApiError::new("invalid_storage_location", &e)))
        })?),
        None => None,
    };
    
    // Update the config in memory
    let updated_config = state.update_manager.update_config(
        req.server_url.clone(),
        req.channel.clone(),
        storage_location,
        req.volume_path.clone(),
    ).await.map_err(|e| {
        error!(error = %e, "Failed to update config");
        (StatusCode::BAD_REQUEST, Json(ApiError::new("config_update_failed", &e.to_string())))
    })?;
    
    // Persist to node.yaml
    if let Err(e) = persist_update_config(&updated_config).await {
        warn!(error = %e, "Failed to persist update config to node.yaml (in-memory config was updated)");
        // Don't fail the request - in-memory config was updated successfully
    }
    
    info!(
        server_url = %updated_config.server_url,
        channel = %updated_config.channel,
        storage_location = %updated_config.storage_location,
        "Update configuration saved"
    );
    
    Ok(Json(UpdateConfigResponse {
        enabled: updated_config.enabled,
        server_url: updated_config.server_url,
        channel: updated_config.channel,
        check_interval: updated_config.check_interval,
        auto_apply: updated_config.auto_apply,
        storage_location: updated_config.storage_location.to_string(),
        volume_path: updated_config.volume_path,
    }))
}

/// Persist update configuration to /etc/limiquantix/node.yaml
async fn persist_update_config(config: &crate::update::UpdateConfig) -> anyhow::Result<()> {
    use tokio::fs;
    
    let config_path = std::path::Path::new("/etc/limiquantix/node.yaml");
    
    // Read existing config if it exists
    let existing_content = if config_path.exists() {
        fs::read_to_string(config_path).await.unwrap_or_default()
    } else {
        String::new()
    };
    
    // Parse existing YAML (simple approach - in production use proper YAML library)
    // For now, we'll update the updates section
    let updates_section = format!(
        r#"
updates:
  enabled: {}
  server_url: "{}"
  channel: "{}"
  check_interval: "{}"
  auto_apply: {}
  auto_reboot: {}
  storage_location: "{}"
  volume_path: {}
  staging_dir: "{}"
  backup_dir: "{}""#,
        config.enabled,
        config.server_url,
        config.channel,
        config.check_interval,
        config.auto_apply,
        config.auto_reboot,
        config.storage_location,
        config.volume_path.as_ref().map(|p| format!("\"{}\"", p)).unwrap_or_else(|| "null".to_string()),
        config.staging_dir.display(),
        config.backup_dir.display(),
    );
    
    // Check if updates section exists in the file
    let new_content = if existing_content.contains("updates:") {
        // Replace the updates section (simplified - in production use proper YAML parsing)
        // This is a simple line-based replacement
        let mut lines: Vec<&str> = existing_content.lines().collect();
        let mut in_updates = false;
        let mut updates_start = None;
        let mut updates_end = None;
        
        for (i, line) in lines.iter().enumerate() {
            if line.trim().starts_with("updates:") {
                in_updates = true;
                updates_start = Some(i);
            } else if in_updates {
                // Check if we've reached a new top-level section
                if !line.is_empty() && !line.starts_with(' ') && !line.starts_with('\t') && !line.starts_with('#') {
                    updates_end = Some(i);
                    break;
                }
            }
        }
        
        if let Some(start) = updates_start {
            let end = updates_end.unwrap_or(lines.len());
            // Remove old updates section
            lines.drain(start..end);
            // Insert new section (skip the leading newline)
            let new_lines: Vec<&str> = updates_section.trim_start().lines().collect();
            for (i, line) in new_lines.iter().enumerate() {
                lines.insert(start + i, line);
            }
            lines.join("\n")
        } else {
            // No updates section found, append
            format!("{}\n{}", existing_content, updates_section.trim_start())
        }
    } else {
        // No updates section, append to end
        format!("{}\n{}", existing_content, updates_section.trim_start())
    };
    
    // Ensure parent directory exists
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).await?;
    }
    
    // Write back
    fs::write(config_path, new_content).await?;
    
    info!(path = %config_path.display(), "Update configuration persisted");
    Ok(())
}

/// Volume info for update storage selection
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateVolumeInfo {
    path: String,
    name: String,
    pool_id: String,
    total_bytes: u64,
    available_bytes: u64,
    is_mounted: bool,
}

/// GET /api/v1/updates/volumes - List volumes available for update storage
/// 
/// Returns mounted volumes that can be used as dedicated storage for updates.
async fn list_update_volumes(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    let mut volumes: Vec<UpdateVolumeInfo> = Vec::new();
    
    // Get storage pools and their volumes
    let pools = state.storage.list_pools().await;
    
    for pool in pools {
        // Get volumes in this pool
        if let Ok(pool_volumes) = state.storage.list_volumes(&pool.pool_id).await {
            for vol in pool_volumes {
                // Check if volume is mounted and suitable for updates
                // For now, include all volumes that have a path
                if !vol.path.is_empty() {
                    // Try to get disk usage for the volume
                    let (total, available) = get_path_disk_usage(&vol.path).await;
                    
                    volumes.push(UpdateVolumeInfo {
                        path: vol.path.clone(),
                        name: vol.name.clone(),
                        pool_id: pool.pool_id.clone(),
                        total_bytes: total,
                        available_bytes: available,
                        is_mounted: std::path::Path::new(&vol.path).exists(),
                    });
                }
            }
        }
    }
    
    // Also check for any existing updates-storage volume
    let updates_storage_paths = [
        "/mnt/updates-storage",
        "/data/updates-storage",
    ];
    
    for path in &updates_storage_paths {
        if std::path::Path::new(path).exists() {
            let (total, available) = get_path_disk_usage(path).await;
            
            // Check if already in list
            if !volumes.iter().any(|v| v.path == *path) {
                volumes.push(UpdateVolumeInfo {
                    path: path.to_string(),
                    name: "updates-storage".to_string(),
                    pool_id: "system".to_string(),
                    total_bytes: total,
                    available_bytes: available,
                    is_mounted: true,
                });
            }
        }
    }
    
    Ok(Json(serde_json::json!({
        "volumes": volumes
    })))
}

/// Get disk usage for a path (total and available bytes)
async fn get_path_disk_usage(path: &str) -> (u64, u64) {
    // Use statvfs on Unix, fallback to 0 on other platforms
    #[cfg(unix)]
    {
        use std::ffi::CString;
        
        let path_cstr = match CString::new(path.as_bytes()) {
            Ok(s) => s,
            Err(_) => return (0, 0),
        };
        
        unsafe {
            let mut stat: libc::statvfs = std::mem::zeroed();
            if libc::statvfs(path_cstr.as_ptr(), &mut stat) == 0 {
                let total = stat.f_blocks as u64 * stat.f_frsize as u64;
                let available = stat.f_bavail as u64 * stat.f_frsize as u64;
                return (total, available);
            }
        }
        (0, 0)
    }
    
    #[cfg(not(unix))]
    {
        let _ = path;
        (0, 0)
    }
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
                // Use the properly detected management IP from the service
                // This uses detect_management_ip() which prioritizes physical interfaces
                management_ip: state.service.get_management_ip(),
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
    use sysinfo::{System, Networks, Cpu};
    
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
    
    // Storage Info - Use lsblk to get physical block devices
    let storage = get_physical_storage_devices();
    
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

/// Get physical storage devices using lsblk for accurate disk detection
fn get_physical_storage_devices() -> Vec<DiskInfo> {
    use std::process::Command;
    
    let mut devices: Vec<DiskInfo> = Vec::new();
    
    // Use lsblk JSON output for structured data
    // -d = no partitions (disk only), -b = bytes, -o = output fields
    let output = Command::new("lsblk")
        .args(&["-J", "-b", "-o", "NAME,SIZE,MODEL,SERIAL,TYPE,TRAN,RM,ROTA,HOTPLUG"])
        .output();
    
    if let Ok(output) = output {
        if output.status.success() {
            let json_str = String::from_utf8_lossy(&output.stdout);
            
            if let Ok(lsblk_data) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(blockdevices) = lsblk_data.get("blockdevices").and_then(|v| v.as_array()) {
                    for dev in blockdevices {
                        let name = dev.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let dev_type = dev.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        
                        // Only process disk devices (not partitions, loop devices, rom, etc.)
                        if dev_type != "disk" {
                            continue;
                        }
                        
                        // Skip loop devices and ram disks
                        if name.starts_with("loop") || name.starts_with("ram") || name.starts_with("zram") {
                            continue;
                        }
                        
                        let size_bytes = dev.get("size")
                            .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                            .unwrap_or(0);
                        
                        let model = dev.get("model")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        
                        let serial = dev.get("serial")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        
                        let transport = dev.get("tran")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        
                        let is_removable = dev.get("rm")
                            .and_then(|v| v.as_bool().or_else(|| v.as_str().map(|s| s == "1")))
                            .unwrap_or(false);
                        
                        let is_rotational = dev.get("rota")
                            .and_then(|v| v.as_bool().or_else(|| v.as_str().map(|s| s == "1")))
                            .unwrap_or(false);
                        
                        let is_hotplug = dev.get("hotplug")
                            .and_then(|v| v.as_bool().or_else(|| v.as_str().map(|s| s == "1")))
                            .unwrap_or(false);
                        
                        // Determine disk type
                        let disk_type = if name.starts_with("nvme") {
                            "NVMe"
                        } else if is_rotational {
                            "HDD"
                        } else {
                            "SSD"
                        }.to_string();
                        
                        // Determine interface
                        let interface = match transport {
                            "nvme" => "NVMe",
                            "sata" => "SATA",
                            "usb" => "USB",
                            "sas" => "SAS",
                            "ata" => "SATA",
                            "" => if name.starts_with("nvme") { "NVMe" } else { "SATA" },
                            other => other,
                        }.to_string();
                        
                        // Get SMART status (simplified - would need smartctl for real status)
                        let smart_status = "Unknown".to_string();
                        
                        // Get partitions for this disk
                        let partitions = get_disk_partitions(name);
                        
                        devices.push(DiskInfo {
                            name: format!("/dev/{}", name),
                            model,
                            serial,
                            size_bytes,
                            disk_type,
                            interface,
                            is_removable: is_removable || is_hotplug,
                            smart_status,
                            partitions,
                        });
                    }
                }
            }
        }
    }
    
    // Sort: internal disks first, then external/removable
    devices.sort_by(|a, b| {
        let a_removable = a.is_removable as u8;
        let b_removable = b.is_removable as u8;
        a_removable.cmp(&b_removable).then(a.name.cmp(&b.name))
    });
    
    devices
}

/// Get partitions for a specific disk
fn get_disk_partitions(disk_name: &str) -> Vec<PartitionInfo> {
    use std::process::Command;
    
    let mut partitions = Vec::new();
    
    // Use lsblk to get partitions with mount info
    let output = Command::new("lsblk")
        .args(&["-J", "-b", "-o", "NAME,SIZE,FSTYPE,MOUNTPOINT,TYPE", &format!("/dev/{}", disk_name)])
        .output();
    
    if let Ok(output) = output {
        if output.status.success() {
            let json_str = String::from_utf8_lossy(&output.stdout);
            
            if let Ok(lsblk_data) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(blockdevices) = lsblk_data.get("blockdevices").and_then(|v| v.as_array()) {
                    for dev in blockdevices {
                        // Process children (partitions)
                        if let Some(children) = dev.get("children").and_then(|v| v.as_array()) {
                            for part in children {
                                let name = part.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                let part_type = part.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                
                                if part_type != "part" {
                                    continue;
                                }
                                
                                let size_bytes = part.get("size")
                                    .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                                    .unwrap_or(0);
                                
                                let mount_point = part.get("mountpoint")
                                    .and_then(|v| v.as_str())
                                    .filter(|s| !s.is_empty())
                                    .map(|s| s.to_string());
                                
                                let filesystem = part.get("fstype")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                
                                // Calculate used bytes if mounted
                                let used_bytes = if let Some(ref mp) = mount_point {
                                    get_mount_usage(mp)
                                } else {
                                    0
                                };
                                
                                partitions.push(PartitionInfo {
                                    name: format!("/dev/{}", name),
                                    mount_point,
                                    size_bytes,
                                    used_bytes,
                                    filesystem,
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    
    partitions
}

/// Get used bytes for a mounted filesystem
fn get_mount_usage(mount_point: &str) -> u64 {
    use std::process::Command;
    
    let output = Command::new("df")
        .args(&["-B1", "--output=used", mount_point])
        .output();
    
    if let Ok(output) = output {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Skip header line, get the used value
            if let Some(line) = stdout.lines().nth(1) {
                if let Ok(used) = line.trim().parse::<u64>() {
                    return used;
                }
            }
        }
    }
    
    0
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
    use tonic::Request;
    use limiquantix_proto::NodeDaemonService;
    
    // Use cached telemetry from the service (much faster and has history)
    let telemetry = state.service.get_telemetry();
    
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
    
    // Get metrics from telemetry
    let cpu_usage = telemetry.cpu.usage_percent as f64;
    
    let memory_total = telemetry.memory.total_bytes;
    let memory_used = telemetry.memory.used_bytes;
    let memory_usage_percent = if memory_total > 0 {
        (memory_used as f64 / memory_total as f64) * 100.0
    } else {
        0.0
    };
    
    // Use load average from telemetry or fallback
    let load_avg = sysinfo::System::load_average();
    
    // Get disk I/O rates from telemetry collector
    let (disk_read_bytes_per_sec, disk_write_bytes_per_sec) = state.telemetry.get_disk_io_rates();
    
    // Get network I/O from telemetry
    let network_rx_bytes_per_sec = telemetry.networks.iter()
        .map(|n| n.rx_rate)
        .sum::<u64>();
        
    let network_tx_bytes_per_sec = telemetry.networks.iter()
        .map(|n| n.tx_rate)
        .sum::<u64>();
    
    // Log telemetry for debugging (only at debug level to avoid spam)
    tracing::debug!(
        cpu_usage = cpu_usage,
        memory_total = memory_total,
        memory_used = memory_used,
        disk_read = disk_read_bytes_per_sec,
        disk_write = disk_write_bytes_per_sec,
        net_rx = network_rx_bytes_per_sec,
        net_tx = network_tx_bytes_per_sec,
        "Host Metrics Telemetry"
    );
    
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
    Query(params): Query<EventQueryParams>,
) -> Result<Json<EventListResponse>, (StatusCode, Json<ApiError>)> {
    use crate::event_store::{get_event_store, EventLevel, EventCategory};
    
    let store = get_event_store();
    
    // Parse optional filters
    let level = params.level.as_ref().map(|l| EventLevel::from(l.as_str()));
    let category = params.category.as_ref().map(|c| EventCategory::from(c.as_str()));
    let limit = params.limit;
    
    // Query events with filters
    let stored_events = store.query(level, category, limit);
    let total_count = store.len();
    
    // Convert to response format
    let events: Vec<EventResponse> = stored_events.into_iter().map(|e| {
        EventResponse {
            event_id: e.id,
            timestamp: e.timestamp.to_rfc3339(),
            level: e.level.to_string(),
            category: e.category.to_string(),
            message: e.message,
            source: e.source,
            details: e.details,
        }
    }).collect();
    
    Ok(Json(EventListResponse {
        events,
        total_count: total_count as u32,
    }))
}

// ============================================================================
// Settings API Handlers
// ============================================================================

/// GET /api/v1/settings - Get current settings
async fn get_settings(
    State(state): State<Arc<AppState>>,
) -> Result<Json<SettingsResponse>, (StatusCode, Json<ApiError>)> {
    use tokio::fs;
    
    // Read the actual hostname from /etc/hostname
    let node_name = match fs::read_to_string("/etc/hostname").await {
        Ok(content) => content.trim().to_string(),
        Err(e) => {
            warn!(error = %e, "Failed to read hostname from /etc/hostname, falling back to system hostname");
            // Fallback: try gethostname
            hostname::get()
                .map(|h| h.to_string_lossy().to_string())
                .unwrap_or_else(|_| "unknown".to_string())
        }
    };
    
    Ok(Json(SettingsResponse {
        node_name,
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
    use std::process::Command;
    use tokio::fs;

    info!(
        node_name = ?req.node_name,
        log_level = ?req.log_level,
        "Settings update requested"
    );
    
    let mut messages = Vec::new();

    // Handle Hostname update
    if let Some(hostname) = req.node_name {
        if !hostname.trim().is_empty() {
            // Write to /etc/hostname
            if let Err(e) = fs::write("/etc/hostname", format!("{}\n", hostname.trim())).await {
                error!(error = %e, "Failed to write hostname");
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiError::new("write_hostname_failed", &e.to_string())),
                ));
            }

            // Set running hostname
            let output = Command::new("hostname")
                .arg(hostname.trim())
                .output();
                
            match output {
                Ok(_) => messages.push("Hostname updated"),
                Err(e) => error!(error = %e, "Failed to set running hostname"),
            }
        }
    }
    
    let message = if messages.is_empty() { 
        "Settings updated".to_string()
    } else { 
        messages.join(", ")
    };
    
    Ok(Json(serde_json::json!({
        "message": message
    })))
}

/// GET /api/v1/settings/services - List system services
async fn list_services(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<ServiceListResponse>, (StatusCode, Json<ApiError>)> {
    // Core services for Quantix-OS
    let services = vec![
        ServiceInfo {
            name: "qx-node".to_string(),
            status: "running".to_string(),
            enabled: true,
            description: "Quantix Node Daemon - Host management service".to_string(),
        },
        ServiceInfo {
            name: "libvirtd".to_string(),
            status: get_service_status("libvirtd"),
            enabled: true,
            description: "Libvirt Virtualization Daemon - VM management".to_string(),
        },
        ServiceInfo {
            name: "sshd".to_string(),
            status: get_service_status("sshd"),
            enabled: true,
            description: "OpenSSH Server - Remote access".to_string(),
        },
        ServiceInfo {
            name: "nfs-client".to_string(),
            // Alpine uses nfsclient or nfs, Debian/Ubuntu uses nfs-common
            status: get_service_status("nfsclient").or_else(|| get_service_status("nfs-common")),
            enabled: is_service_enabled("nfsclient") || is_service_enabled("nfs-common"),
            description: "NFS Client - Shared storage access".to_string(),
        },
        ServiceInfo {
            name: "firewall".to_string(),
            // Alpine uses iptables, systemd distros may use firewalld
            status: get_service_status("iptables").or_else(|| get_service_status("firewalld")),
            enabled: is_service_enabled("iptables") || is_service_enabled("firewalld"),
            description: "Firewall - Network security".to_string(),
        },
        ServiceInfo {
            name: "chronyd".to_string(),
            status: get_service_status("chronyd").or_else(|| get_service_status("ntpd")),
            enabled: is_service_enabled("chronyd") || is_service_enabled("ntpd"),
            description: "NTP Client - Time synchronization".to_string(),
        },
        ServiceInfo {
            name: "snmpd".to_string(),
            status: get_service_status("snmpd"),
            enabled: is_service_enabled("snmpd"),
            description: "SNMP Agent - Monitoring integration (optional)".to_string(),
        },
        ServiceInfo {
            name: "ovs-vswitchd".to_string(),
            // Alpine uses ovs-vswitchd directly, Debian/Ubuntu uses openvswitch-switch
            status: get_service_status("ovs-vswitchd").or_else(|| get_service_status("openvswitch-switch")),
            enabled: is_service_enabled("ovs-vswitchd") || is_service_enabled("ovsdb-server"),
            description: "Open vSwitch - Software-defined networking".to_string(),
        },
        ServiceInfo {
            name: "iscsid".to_string(),
            status: get_service_status("iscsid"),
            enabled: is_service_enabled("iscsid"),
            description: "iSCSI Initiator - Block storage access".to_string(),
        },
    ];
    
    Ok(Json(ServiceListResponse { services }))
}

/// Helper trait extension for Option<String>
trait OptionExt {
    fn or_else<F: FnOnce() -> String>(self, f: F) -> String;
}

impl OptionExt for String {
    fn or_else<F: FnOnce() -> String>(self, f: F) -> String {
        if self == "unknown" { f() } else { self }
    }
}

fn is_service_enabled(name: &str) -> bool {
    use std::process::Command;
    use std::process::Stdio;
    
    // Try rc-update first (Alpine/OpenRC) - suppress stderr
    if let Ok(output) = Command::new("rc-update")
        .args(["show", "default"])
        .stderr(Stdio::null())
        .output()
    {
        let output_str = String::from_utf8_lossy(&output.stdout);
        if output_str.contains(name) {
            return true;
        }
    }
    
    // Try systemctl (for systemd-based systems) - suppress stderr
    if let Ok(output) = Command::new("systemctl")
        .args(["is-enabled", name])
        .stderr(Stdio::null())
        .output()
    {
        let status = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return status == "enabled";
    }
    
    false
}

fn get_service_status(name: &str) -> String {
    use std::process::Command;
    use std::process::Stdio;
    
    // Try rc-service first (Alpine/OpenRC) - suppress stderr to avoid log spam
    if let Ok(output) = Command::new("rc-service")
        .args([name, "status"])
        .stderr(Stdio::null())
        .output()
    {
        if output.status.success() {
            return "running".to_string();
        }
        // Service exists but not running
        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.contains("stopped") || stdout.contains("crashed") {
            return "stopped".to_string();
        }
    }
    
    // Try systemctl (for systemd-based systems) - suppress stderr
    if let Ok(output) = Command::new("systemctl")
        .args(["is-active", name])
        .stderr(Stdio::null())
        .output()
    {
        if output.status.success() {
            return String::from_utf8_lossy(&output.stdout).trim().to_string();
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
                    disks: vm.disks.into_iter().map(|d| DiskSpecResponse {
                        id: d.id,
                        path: d.path,
                        size_gib: d.size_gib,
                        bus: disk_bus_to_string(d.bus),
                        format: disk_format_to_string(d.format),
                        readonly: d.readonly,
                        bootable: d.bootable,
                    }).collect(),
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
                disks: vm.disks.into_iter().map(|d| DiskSpecResponse {
                    id: d.id,
                    path: d.path,
                    size_gib: d.size_gib,
                    bus: disk_bus_to_string(d.bus),
                    format: disk_format_to_string(d.format),
                    readonly: d.readonly,
                    bootable: d.bootable,
                }).collect(),
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

/// Response type for VM logs
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VmLogsResponse {
    /// VM ID
    vm_id: String,
    /// VM name (for display)
    vm_name: String,
    /// QEMU log content (last N lines)
    qemu_log: String,
    /// Log file path
    log_path: String,
    /// Total log file size in bytes
    log_size_bytes: u64,
    /// Number of lines returned
    lines_returned: usize,
    /// Whether the log was truncated
    truncated: bool,
    /// Timestamp of last modification
    last_modified: Option<String>,
}

/// GET /api/v1/vms/:vm_id/logs - Get VM QEMU logs for troubleshooting
/// 
/// Query parameters:
/// - lines: Number of lines to return (default: 100, max: 1000)
/// 
/// Returns the QEMU log file content from /var/log/libvirt/qemu/{vm_name}.log
async fn get_vm_logs(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<VmLogsResponse>, (StatusCode, Json<ApiError>)> {
    use tokio::fs;
    use tokio::io::{AsyncBufReadExt, BufReader};
    
    // Get the VM to find its name by listing all VMs and finding by ID or name
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    // Find VM by ID or name
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    let vm_name = &vm.name;
    let log_path = format!("/var/log/libvirt/qemu/{}.log", vm_name);
    
    // Parse lines parameter (default: 100, max: 1000)
    let max_lines: usize = params
        .get("lines")
        .and_then(|s| s.parse().ok())
        .unwrap_or(100)
        .min(1000);
    
    // Check if log file exists
    let metadata = match fs::metadata(&log_path).await {
        Ok(m) => m,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                return Ok(Json(VmLogsResponse {
                    vm_id: vm_id.clone(),
                    vm_name: vm_name.clone(),
                    qemu_log: String::new(),
                    log_path,
                    log_size_bytes: 0,
                    lines_returned: 0,
                    truncated: false,
                    last_modified: None,
                }));
            }
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("log_read_error", &format!("Failed to read log metadata: {}", e))),
            ));
        }
    };
    
    let log_size_bytes = metadata.len();
    let last_modified = metadata.modified().ok().map(|t| {
        chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339()
    });
    
    // Read the log file
    let file = match fs::File::open(&log_path).await {
        Ok(f) => f,
        Err(e) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("log_read_error", &format!("Failed to open log file: {}", e))),
            ));
        }
    };
    
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
    
    let lines_returned = lines.len();
    let qemu_log = lines.join("\n");
    
    info!(
        vm_id = %vm_id,
        vm_name = %vm_name,
        log_path = %log_path,
        log_size_bytes = log_size_bytes,
        lines_returned = lines_returned,
        truncated = truncated,
        "Retrieved VM QEMU logs"
    );
    
    Ok(Json(VmLogsResponse {
        vm_id,
        vm_name: vm_name.clone(),
        qemu_log,
        log_path,
        log_size_bytes,
        lines_returned,
        truncated,
        last_modified,
    }))
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
    
    // Generate VM ID - must be a valid UUID for libvirt
    let vm_id = uuid::Uuid::new_v4().to_string();
    
    // Convert disk specs
    let disks: Vec<DiskSpec> = request.disks.iter().map(|d| {
        let bus = match d.bus.as_deref() {
            Some("scsi") => DiskBus::Scsi.into(),
            Some("sata") => DiskBus::Sata.into(),
            Some("ide") => DiskBus::Ide.into(),
            _ => DiskBus::Virtio.into(),
        };
        let format = match d.format.as_deref() {
            Some("raw") => DiskFormat::Raw.into(),
            _ => DiskFormat::Qcow2.into(),
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
            pool_id: d.pool_id.clone().unwrap_or_default(),
        }
    }).collect();
    
    // Convert NIC specs
    let nics: Vec<NicSpec> = request.nics.iter().map(|n| {
        let model = match n.model.as_deref() {
            Some("e1000") => NicModel::E1000.into(),
            Some("rtl8139") => NicModel::Rtl8139.into(),
            _ => NicModel::Virtio.into(),
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
            // Guest OS profile - determines hardware configuration (timers, CPU mode, video)
            // Values: "rhel", "debian", "fedora", "windows_server", etc.
            guest_os: request.guest_os.unwrap_or_default(),
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
                disks: request.disks.iter().map(|d| DiskSpecResponse {
                    id: d.id.clone(),
                    path: String::new(), // Path unknown until started/inspected, but usually auto-generated
                    size_gib: d.size_gib,
                    bus: d.bus.clone().unwrap_or_else(|| "virtio".to_string()),
                    format: d.format.clone().unwrap_or_else(|| "qcow2".to_string()),
                    readonly: false,
                    bootable: d.bootable.unwrap_or(false),
                }).collect(),
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

// =============================================================================
// QEMU Guest Agent Endpoints
// =============================================================================

/// Response for QEMU Guest Agent ping
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QemuAgentPingResponse {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Response for QEMU Guest Agent exec
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QemuAgentExecResponse {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stdout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Request for QEMU Guest Agent exec
#[derive(Deserialize)]
struct QemuAgentExecRequest {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default = "default_timeout")]
    timeout: u32,
}

fn default_timeout() -> u32 {
    60
}

/// Response for Quantix Agent ping - mirrors the frontend QuantixAgentInfo interface
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct QuantixAgentPingResponse {
    connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hostname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    os_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    os_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kernel_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    architecture: Option<String>,
    #[serde(default)]
    ip_addresses: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resource_usage: Option<AgentResourceUsageResponse>,
    #[serde(default)]
    capabilities: Vec<String>,
    /// Latest available agent version (for update check)
    #[serde(skip_serializing_if = "Option::is_none")]
    latest_agent_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Resource usage data from the agent
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentResourceUsageResponse {
    cpu_usage_percent: f64,
    memory_total_bytes: u64,
    memory_used_bytes: u64,
    memory_available_bytes: u64,
    swap_total_bytes: u64,
    swap_used_bytes: u64,
    load_avg_1: f64,
    load_avg_5: f64,
    load_avg_15: f64,
    disks: Vec<AgentDiskUsageResponse>,
    process_count: u32,
    uptime_seconds: u64,
}

/// Disk usage data from the agent
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentDiskUsageResponse {
    mount_point: String,
    device: String,
    filesystem: String,
    total_bytes: u64,
    used_bytes: u64,
    available_bytes: u64,
    usage_percent: f64,
}

/// Latest agent version - fetched from update server or cached
/// TODO: In production, this should be fetched from the update server dynamically
const LATEST_AGENT_VERSION: &str = "0.1.0";

/// Find the agent socket in libvirt's standard channel paths
/// Returns the socket path if found, None otherwise
fn find_libvirt_agent_socket(vm_id: &str) -> Option<std::path::PathBuf> {
    // Check /run/libvirt/qemu/channel/{domain-id}-{vm_name}/org.quantix.agent.0
    let libvirt_base = std::path::Path::new("/run/libvirt/qemu/channel");
    if libvirt_base.exists() {
        if let Ok(entries) = std::fs::read_dir(libvirt_base) {
            for entry in entries.flatten() {
                let socket_path = entry.path().join("org.quantix.agent.0");
                if socket_path.exists() {
                    // Found a socket - in the future we should verify this matches our VM
                    // For now, if there's only one VM with the agent, this will work
                    debug!(vm_id = %vm_id, path = %socket_path.display(), "Found libvirt agent socket");
                    return Some(socket_path);
                }
            }
        }
    }
    
    // Also check /var/lib/libvirt/qemu/channel/
    let libvirt_var = std::path::Path::new("/var/lib/libvirt/qemu/channel");
    if libvirt_var.exists() {
        if let Ok(entries) = std::fs::read_dir(libvirt_var) {
            for entry in entries.flatten() {
                let socket_path = entry.path().join("org.quantix.agent.0");
                if socket_path.exists() {
                    debug!(vm_id = %vm_id, path = %socket_path.display(), "Found libvirt agent socket in /var/lib");
                    return Some(socket_path);
                }
            }
        }
    }
    
    None
}

/// Get the agent socket path from virsh dumpxml
/// This parses the VM's XML to find the actual socket path configured for org.quantix.agent.0
async fn get_agent_socket_from_virsh(vm_name: &str) -> Option<std::path::PathBuf> {
    info!(vm = %vm_name, "Parsing virsh dumpxml for agent socket path");
    
    // Add timeout for the virsh command
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::process::Command::new("virsh")
            .args(["dumpxml", vm_name])
            .output()
    ).await;
    
    let output = match result {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => {
            warn!(vm = %vm_name, error = %e, "virsh dumpxml command failed");
            return None;
        }
        Err(_) => {
            warn!(vm = %vm_name, "virsh dumpxml command timed out");
            return None;
        }
    };
    
    if !output.status.success() {
        warn!(vm = %vm_name, "virsh dumpxml returned non-zero exit code");
        return None;
    }
    
    let xml = String::from_utf8_lossy(&output.stdout);
    
    // Look for the limiquantix agent channel and extract its socket path
    // Format: <channel type='unix'>
    //           <source mode='bind' path='/path/to/socket'/>
    //           <target type='virtio' name='org.quantix.agent.0'.../>
    //         </channel>
    
    // Simple regex-free parsing: find org.quantix.agent.0, then backtrack to find the path
    if let Some(agent_pos) = xml.find("org.quantix.agent.0") {
        // Look backwards from agent_pos to find the channel start
        let channel_section = &xml[..agent_pos];
        if let Some(channel_start) = channel_section.rfind("<channel") {
            let section = &xml[channel_start..agent_pos + 50.min(xml.len() - agent_pos)];
            
            // Find path='...' in this section
            if let Some(path_start) = section.find("path='") {
                let path_content = &section[path_start + 6..];
                if let Some(path_end) = path_content.find('\'') {
                    let socket_path = &path_content[..path_end];
                    info!(vm = %vm_name, socket_path = %socket_path, "Found agent socket path from virsh XML");
                    return Some(std::path::PathBuf::from(socket_path));
                }
            }
        }
        warn!(vm = %vm_name, "Found org.quantix.agent.0 in XML but couldn't parse socket path");
    } else {
        info!(vm = %vm_name, "No org.quantix.agent.0 channel found in VM XML - agent channel not configured");
    }
    
    None
}

/// Build a disconnected response with all fields set to defaults
fn build_disconnected_response(error: Option<String>) -> QuantixAgentPingResponse {
    QuantixAgentPingResponse {
        connected: false,
        version: None,
        hostname: None,
        os_name: None,
        os_version: None,
        kernel_version: None,
        architecture: None,
        ip_addresses: vec![],
        resource_usage: None,
        capabilities: vec![],
        latest_agent_version: Some(LATEST_AGENT_VERSION.to_string()),
        error,
    }
}

/// Build a connected response from GuestAgentInfo
fn build_connected_response(agent_info: limiquantix_proto::GuestAgentInfo) -> QuantixAgentPingResponse {
    // Convert resource usage if available
    let resource_usage = agent_info.resource_usage.map(|ru| {
        AgentResourceUsageResponse {
            cpu_usage_percent: ru.cpu_usage_percent,
            memory_total_bytes: ru.memory_total_bytes,
            memory_used_bytes: ru.memory_used_bytes,
            memory_available_bytes: ru.memory_available_bytes,
            swap_total_bytes: ru.swap_total_bytes,
            swap_used_bytes: ru.swap_used_bytes,
            load_avg_1: ru.load_avg_1,
            load_avg_5: ru.load_avg_5,
            load_avg_15: ru.load_avg_15,
            disks: ru.disks.into_iter().map(|d| AgentDiskUsageResponse {
                mount_point: d.mount_point,
                device: d.device,
                filesystem: d.filesystem,
                total_bytes: d.total_bytes,
                used_bytes: d.used_bytes,
                available_bytes: d.available_bytes,
                usage_percent: d.usage_percent,
            }).collect(),
            process_count: ru.process_count,
            uptime_seconds: ru.uptime_seconds,
        }
    });

    QuantixAgentPingResponse {
        connected: agent_info.connected,
        version: if agent_info.version.is_empty() { None } else { Some(agent_info.version) },
        hostname: if agent_info.hostname.is_empty() { None } else { Some(agent_info.hostname) },
        os_name: if agent_info.os_name.is_empty() { None } else { Some(agent_info.os_name) },
        os_version: if agent_info.os_version.is_empty() { None } else { Some(agent_info.os_version) },
        kernel_version: if agent_info.kernel_version.is_empty() { None } else { Some(agent_info.kernel_version) },
        architecture: None, // TODO: Add architecture to GuestAgentInfo
        ip_addresses: agent_info.ip_addresses,
        resource_usage,
        capabilities: agent_info.capabilities,
        latest_agent_version: Some(LATEST_AGENT_VERSION.to_string()),
        error: None,
    }
}

/// GET /api/v1/vms/:vm_id/agent/ping - Check if Quantix Agent is available
/// 
/// This checks if the Quantix Guest Agent is connected via virtio-serial.
/// The agent connection is managed by the background service, so we check the cached state.
/// 
/// Returns full agent info including:
/// - Version, hostname, OS info
/// - IP addresses from network interfaces
/// - Resource usage (CPU, memory, disk, load averages)
/// - Capabilities list
/// - Latest available agent version for update checks
async fn ping_quantix_agent(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<Json<QuantixAgentPingResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, "Quantix Agent ping request received - START");
    
    // Wrap the entire ping operation in a timeout to prevent hanging
    // Use a short timeout (5s) since the page loads this on every view
    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        ping_quantix_agent_inner(state, vm_id.clone())
    ).await {
        Ok(result) => result,
        Err(_) => {
            warn!(vm_id = %vm_id, "Agent ping timed out after 5 seconds");
            Ok(Json(build_disconnected_response(
                Some("Agent not responding. Install the Quantix Agent inside the VM to enable advanced features.".to_string())
            )))
        }
    }
}

/// Inner implementation of ping_quantix_agent (with timeout wrapper above)
async fn ping_quantix_agent_inner(
    state: Arc<AppState>,
    vm_id: String,
) -> Result<Json<QuantixAgentPingResponse>, (StatusCode, Json<ApiError>)> {
    // Get the VM to verify it exists and is running
    info!(vm_id = %vm_id, "Step 1: Listing VMs");
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    info!(vm_id = %vm_id, vm_name = %vm.name, state = ?vm.state, "Step 2: VM found");
    
    // Check if VM is running
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(build_disconnected_response(
            Some(format!("VM is not running (state: {:?})", vm.state))
        )));
    }
    
    // First, determine the socket path for this VM
    // Check multiple possible socket paths:
    // 1. Our standard path
    // 2. Libvirt's channel directory
    // 3. Parse virsh XML to find the actual configured path
    info!(vm_id = %vm_id, "Step 3: Checking socket paths");
    let primary_socket_path = format!("/var/run/limiquantix/vms/{}.agent.sock", vm.id);
    let primary_exists = std::path::Path::new(&primary_socket_path).exists();
    info!(vm_id = %vm_id, primary_socket = %primary_socket_path, exists = primary_exists, "Step 3a: Primary socket check");
    
    let socket_path = if primary_exists {
        Some(std::path::PathBuf::from(&primary_socket_path))
    } else {
        info!(vm_id = %vm_id, "Step 3b: Checking libvirt socket paths");
        if let Some(path) = find_libvirt_agent_socket(&vm.id) {
            info!(vm_id = %vm_id, socket = %path.display(), "Step 3b: Found libvirt socket");
            Some(path)
        } else {
            // Try to get socket path from virsh XML
            info!(vm_id = %vm_id, "Step 3c: Parsing virsh XML");
            let result = get_agent_socket_from_virsh(&vm.name).await;
            info!(vm_id = %vm_id, found = result.is_some(), "Step 3c: virsh XML parsing complete");
            result
        }
    };
    
    info!(vm_id = %vm_id, socket_found = socket_path.is_some(), "Step 4: Socket path resolution complete");
    
    // Check the cached agent info from the service's background connection
    // The service maintains persistent connections and receives telemetry/ready events
    info!(vm_id = %vm_id, "Step 5: Checking agent cache");
    let cached_info = state.service.get_agent_info(&vm.id).await;
    let needs_os_info = cached_info.as_ref()
        .map(|i| i.os_name.is_empty() || i.hostname.is_empty())
        .unwrap_or(true);
    
    info!(vm_id = %vm_id, has_cache = cached_info.is_some(), needs_os_info = needs_os_info, "Step 5a: Cache status");
    
    if let Some(agent_info) = cached_info {
        if needs_os_info {
            info!(vm_id = %vm_id, "Step 6: Needs OS info, attempting to connect and fetch");
            // Try to actively fetch OS info from the agent using the discovered socket path
            let connect_result = if let Some(ref path) = socket_path {
                info!(vm_id = %vm_id, socket = %path.display(), "Step 6a: Connecting with discovered socket");
                state.service.get_agent_client_with_socket(&vm.id, Some(path.clone())).await
            } else {
                info!(vm_id = %vm_id, "Step 6b: Connecting with default socket");
                state.service.get_agent_client(&vm.id).await
            };
            
            info!(vm_id = %vm_id, success = connect_result.is_ok(), "Step 6c: Connection result");
            
            if let Ok(()) = connect_result {
                info!(vm_id = %vm_id, "Step 7: Getting agent manager");
                let agents = state.service.agent_manager().await;
                info!(vm_id = %vm_id, has_client = agents.contains_key(&vm.id), "Step 7a: Agent manager access");
                if let Some(client) = agents.get(&vm.id) {
                    info!(vm_id = %vm_id, "Step 8: Executing OS info commands");
                    // Execute commands to get OS info
                    let mut hostname = agent_info.hostname.clone();
                    let mut os_name = agent_info.os_name.clone();
                    let mut os_version = agent_info.os_version.clone();
                    let mut kernel_version = agent_info.kernel_version.clone();
                    let mut version = agent_info.version.clone();
                    let mut ip_addresses = agent_info.ip_addresses.clone();
                    
                    // Get hostname
                    if hostname.is_empty() {
                        if let Ok(result) = client.execute("hostname", 5).await {
                            if result.exit_code == 0 {
                                hostname = result.stdout.trim().to_string();
                            }
                        }
                    }
                    
                    // Get OS info from /etc/os-release
                    if os_name.is_empty() {
                        if let Ok(result) = client.execute("cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || echo 'Linux'", 5).await {
                            if result.exit_code == 0 {
                                let output = result.stdout;
                                // Parse os-release format
                                for line in output.lines() {
                                    if line.starts_with("PRETTY_NAME=") {
                                        os_name = line.trim_start_matches("PRETTY_NAME=")
                                            .trim_matches('"')
                                            .to_string();
                                        break;
                                    } else if line.starts_with("NAME=") && os_name.is_empty() {
                                        os_name = line.trim_start_matches("NAME=")
                                            .trim_matches('"')
                                            .to_string();
                                    } else if line.starts_with("VERSION=") && os_version.is_empty() {
                                        os_version = line.trim_start_matches("VERSION=")
                                            .trim_matches('"')
                                            .to_string();
                                    }
                                }
                                // If it's a simple one-liner (like redhat-release)
                                if os_name.is_empty() && !output.contains('=') {
                                    os_name = output.lines().next().unwrap_or("Linux").to_string();
                                }
                            }
                        }
                    }
                    
                    // Get kernel version
                    if kernel_version.is_empty() {
                        if let Ok(result) = client.execute("uname -r", 5).await {
                            if result.exit_code == 0 {
                                kernel_version = result.stdout.trim().to_string();
                            }
                        }
                    }
                    
                    // Get IP addresses if empty
                    if ip_addresses.is_empty() {
                        if let Ok(result) = client.execute("hostname -I 2>/dev/null || ip -4 addr show | grep -oP '(?<=inet\\s)\\d+(\\.\\d+){3}' | grep -v '^127\\.'", 5).await {
                            if result.exit_code == 0 {
                                ip_addresses = result.stdout.split_whitespace()
                                    .map(|s| s.to_string())
                                    .filter(|s| !s.is_empty() && s != "127.0.0.1")
                                    .collect();
                            }
                        }
                    }
                    
                    // Get agent version via ping
                    if version.is_empty() {
                        if let Ok(pong) = client.ping().await {
                            version = pong.version;
                        }
                    }
                    
                    drop(agents); // Release lock
                    
                    // Update the cache with full info
                    state.service.set_agent_info(
                        &vm.id, &version, &hostname, &os_name, &os_version, &kernel_version, ip_addresses.clone()
                    ).await;
                    
                    // Build response with fetched data
                    return Ok(Json(QuantixAgentPingResponse {
                        connected: true,
                        version: if version.is_empty() { None } else { Some(version) },
                        hostname: if hostname.is_empty() { None } else { Some(hostname) },
                        os_name: if os_name.is_empty() { None } else { Some(os_name) },
                        os_version: if os_version.is_empty() { None } else { Some(os_version) },
                        kernel_version: if kernel_version.is_empty() { None } else { Some(kernel_version) },
                        architecture: None,
                        ip_addresses,
                        resource_usage: agent_info.resource_usage.map(|ru| AgentResourceUsageResponse {
                            cpu_usage_percent: ru.cpu_usage_percent,
                            memory_total_bytes: ru.memory_total_bytes,
                            memory_used_bytes: ru.memory_used_bytes,
                            memory_available_bytes: ru.memory_available_bytes,
                            swap_total_bytes: ru.swap_total_bytes,
                            swap_used_bytes: ru.swap_used_bytes,
                            load_avg_1: ru.load_avg_1,
                            load_avg_5: ru.load_avg_5,
                            load_avg_15: ru.load_avg_15,
                            disks: ru.disks.into_iter().map(|d| AgentDiskUsageResponse {
                                mount_point: d.mount_point,
                                device: d.device,
                                filesystem: d.filesystem,
                                total_bytes: d.total_bytes,
                                used_bytes: d.used_bytes,
                                available_bytes: d.available_bytes,
                                usage_percent: d.usage_percent,
                            }).collect(),
                            process_count: ru.process_count,
                            uptime_seconds: ru.uptime_seconds,
                        }),
                        capabilities: agent_info.capabilities,
                        latest_agent_version: Some(LATEST_AGENT_VERSION.to_string()),
                        error: None,
                    }));
                }
            }
        }
        
        // If we still need OS info but couldn't connect to fetch it,
        // return what we have but indicate data may be incomplete
        if needs_os_info {
            info!(
                vm_id = %vm_id, 
                version = %agent_info.version,
                "Quantix Agent connected but couldn't fetch OS info - returning cached data"
            );
        } else {
            info!(
                vm_id = %vm_id, 
                version = %agent_info.version,
                hostname = %agent_info.hostname,
                "Quantix Agent is connected"
            );
        }
        return Ok(Json(build_connected_response(agent_info)));
    }
    
    // No cached info - try to connect to the agent directly
    // Use the socket path we already discovered at the start of the function
    if let Some(actual_socket_path) = socket_path {
        info!(vm_id = %vm_id, socket = %actual_socket_path.display(), "Found agent socket, attempting connection");
        // Socket exists - try to connect and get info with the specific socket path
        if let Ok(()) = state.service.get_agent_client_with_socket(&vm.id, Some(actual_socket_path.clone())).await {
            let agents = state.service.agent_manager().await;
            if let Some(client) = agents.get(&vm.id) {
                // Agent connected successfully - fetch OS info
                let mut hostname = String::new();
                let mut os_name = String::new();
                let mut os_version = String::new();
                let mut kernel_version = String::new();
                let mut version = String::new();
                let mut ip_addresses = Vec::new();
                
                // Get agent version via ping
                if let Ok(pong) = client.ping().await {
                    version = pong.version;
                }
                
                // Get hostname
                if let Ok(result) = client.execute("hostname", 5).await {
                    if result.exit_code == 0 {
                        hostname = result.stdout.trim().to_string();
                    }
                }
                
                // Get OS info
                if let Ok(result) = client.execute("cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null || echo 'Linux'", 5).await {
                    if result.exit_code == 0 {
                        let output = result.stdout;
                        for line in output.lines() {
                            if line.starts_with("PRETTY_NAME=") {
                                os_name = line.trim_start_matches("PRETTY_NAME=")
                                    .trim_matches('"')
                                    .to_string();
                                break;
                            } else if line.starts_with("NAME=") && os_name.is_empty() {
                                os_name = line.trim_start_matches("NAME=")
                                    .trim_matches('"')
                                    .to_string();
                            } else if line.starts_with("VERSION=") && os_version.is_empty() {
                                os_version = line.trim_start_matches("VERSION=")
                                    .trim_matches('"')
                                    .to_string();
                            }
                        }
                        if os_name.is_empty() && !output.contains('=') {
                            os_name = output.lines().next().unwrap_or("Linux").to_string();
                        }
                    }
                }
                
                // Get kernel version
                if let Ok(result) = client.execute("uname -r", 5).await {
                    if result.exit_code == 0 {
                        kernel_version = result.stdout.trim().to_string();
                    }
                }
                
                // Get IP addresses
                if let Ok(result) = client.execute("hostname -I 2>/dev/null || ip -4 addr show | grep -oP '(?<=inet\\s)\\d+(\\.\\d+){3}' | grep -v '^127\\.'", 5).await {
                    if result.exit_code == 0 {
                        ip_addresses = result.stdout.split_whitespace()
                            .map(|s| s.to_string())
                            .filter(|s| !s.is_empty() && s != "127.0.0.1")
                            .collect();
                    }
                }
                
                drop(agents); // Release lock
                
                // Update the cache with full info
                state.service.set_agent_info(
                    &vm.id, &version, &hostname, &os_name, &os_version, &kernel_version, ip_addresses.clone()
                ).await;
                
                info!(vm_id = %vm_id, version = %version, hostname = %hostname, os = %os_name, "Agent connected and info fetched");
                
                return Ok(Json(QuantixAgentPingResponse {
                    connected: true,
                    version: if version.is_empty() { None } else { Some(version) },
                    hostname: if hostname.is_empty() { None } else { Some(hostname) },
                    os_name: if os_name.is_empty() { None } else { Some(os_name) },
                    os_version: if os_version.is_empty() { None } else { Some(os_version) },
                    kernel_version: if kernel_version.is_empty() { None } else { Some(kernel_version) },
                    architecture: None,
                    ip_addresses,
                    resource_usage: None,
                    capabilities: vec![
                        "telemetry".to_string(),
                        "execute".to_string(),
                        "file_read".to_string(),
                        "file_write".to_string(),
                        "shutdown".to_string(),
                    ],
                    latest_agent_version: Some(LATEST_AGENT_VERSION.to_string()),
                    error: None,
                }));
            }
        }
        
        // Socket exists but couldn't connect - check virsh
        let output = tokio::process::Command::new("virsh")
            .args(["dumpxml", &vm.name])
            .output()
            .await;
        
        if let Ok(result) = output {
            if result.status.success() {
                let xml = String::from_utf8_lossy(&result.stdout);
                if xml.contains("org.quantix.agent.0") && xml.contains("state='connected'") {
                    debug!(vm_id = %vm_id, "Agent channel connected per virsh but connection failed");
                    return Ok(Json(build_disconnected_response(
                        Some("Agent appears connected but failed to communicate. The agent may be starting up.".to_string())
                    )));
                }
            }
        }
        
        // Socket exists but channel not connected
        debug!(vm_id = %vm_id, socket = %actual_socket_path.display(), "Agent socket exists but channel not connected");
        return Ok(Json(build_disconnected_response(
            Some("Agent socket exists but not yet connected. The agent may be starting up - please wait a few seconds and try again.".to_string())
        )));
    }
    
    // No socket found - agent is not installed or VM doesn't have virtio-serial configured
    Ok(Json(build_disconnected_response(
        Some("Quantix Agent not installed or not running. Install using the One-Click Installation button or: curl -fsSL https://<QHCI-HOST>/api/v1/agent/install.sh | sudo bash".to_string())
    )))
}

// =============================================================================
// NEW AGENT ENDPOINTS
// =============================================================================

/// Request body for agent update
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAgentRequest {
    /// Target version to update to (empty = latest)
    #[serde(default)]
    target_version: String,
}

/// Response for agent update
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAgentResponse {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    new_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// POST /api/v1/vms/:vm_id/agent/update - Update the Quantix Agent in the VM
/// 
/// This endpoint downloads the latest agent binary and installs it via virtio-serial.
async fn update_quantix_agent(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
    Json(_request): Json<UpdateAgentRequest>,
) -> Result<Json<UpdateAgentResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, "Updating Quantix Agent");
    
    // Verify VM exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(UpdateAgentResponse {
            success: false,
            message: "VM is not running".to_string(),
            new_version: None,
            error: Some(format!("VM is not running (state: {:?})", vm.state)),
        }));
    }
    
    // First, check if the Quantix Agent is connected
    // If not, we can't update it
    let agent_info = state.service.get_agent_info(&vm.id).await;
    if agent_info.is_none() || !agent_info.as_ref().map(|i| i.connected).unwrap_or(false) {
        return Ok(Json(UpdateAgentResponse {
            success: false,
            message: "Cannot update agent: Quantix Agent is not connected. Install the agent first.".to_string(),
            new_version: None,
            error: Some("Agent not connected".to_string()),
        }));
    }
    
    // TODO: Implement actual update logic:
    // 1. Download new agent binary from update server
    // 2. Transfer to guest via virtio-serial file write
    // 3. Execute upgrade script
    
    Ok(Json(UpdateAgentResponse {
        success: false,
        message: "Agent update coming soon. For now, reinstall the agent using the install button to get the latest version.".to_string(),
        new_version: None,
        error: Some("Update functionality is under development. Use reinstall as a workaround.".to_string()),
    }))
}

/// POST /api/v1/vms/:vm_id/agent/refresh - Request fresh telemetry from the agent
/// 
/// Unlike /ping which reads from cache, this endpoint actually contacts the guest
/// agent and requests an immediate telemetry push. The response includes real-time
/// CPU, memory, disk, and network usage.
async fn refresh_quantix_agent(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<Json<QuantixAgentPingResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, "Refreshing Quantix Agent telemetry");
    
    // Verify VM exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(build_disconnected_response(
            Some(format!("VM is not running (state: {:?})", vm.state))
        )));
    }
    
    // Try to get an agent client and request fresh telemetry
    if let Err(e) = state.service.get_agent_client(&vm.id).await {
        warn!(vm_id = %vm_id, error = %e, "Failed to get agent client");
        return Ok(Json(build_disconnected_response(
            Some(format!("Failed to connect to agent: {}", e))
        )));
    }
    
    let agents = state.service.agent_manager().await;
    if let Some(client) = agents.get(&vm.id) {
        match client.request_telemetry().await {
            Ok(_pong) => {
                drop(agents); // Release lock before sleeping
                
                // The telemetry is now updated in the cache via the response handler
                // Wait a moment for the cache to be updated
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                
                // Now read the updated cache
                if let Some(agent_info) = state.service.get_agent_info(&vm.id).await {
                    return Ok(Json(build_connected_response(agent_info)));
                }
                
                // Cache not updated yet - return minimal connected response
                Ok(Json(QuantixAgentPingResponse {
                    connected: true,
                    version: None,
                    hostname: None,
                    os_name: None,
                    os_version: None,
                    kernel_version: None,
                    architecture: None,
                    ip_addresses: vec![],
                    resource_usage: None,
                    capabilities: vec![],
                    latest_agent_version: Some(LATEST_AGENT_VERSION.to_string()),
                    error: Some("Telemetry refresh succeeded but cache not yet updated".to_string()),
                }))
            }
            Err(e) => {
                warn!(vm_id = %vm_id, error = %e, "Failed to request telemetry from agent");
                Ok(Json(build_disconnected_response(
                    Some(format!("Failed to request telemetry: {}", e))
                )))
            }
        }
    } else {
        Ok(Json(build_disconnected_response(
            Some("Agent client not found after connection".to_string())
        )))
    }
}

// =============================================================================
// Agent ISO Mount Endpoints
// =============================================================================

/// Response for ISO mount operations
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MountIsoResponse {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    iso_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    device: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// POST /api/v1/vms/:vm_id/cdrom/mount-agent-iso - Mount the Quantix Agent Tools ISO
/// 
/// This mounts the pre-built agent tools ISO to the VM's CD-ROM drive,
/// allowing air-gapped installation via the universal installer.
async fn mount_agent_iso(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<Json<MountIsoResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, "Mounting Quantix Agent Tools ISO");
    
    // Get the VM to verify it exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    // Check if VM is running
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(MountIsoResponse {
            success: false,
            message: "VM is not running".to_string(),
            iso_path: None,
            device: None,
            error: Some(format!("VM state: {:?}", vm.state)),
        }));
    }
    
    // Find the agent tools ISO
    let iso_paths = [
        "/data/share/quantix-agent/quantix-kvm-agent-tools.iso",
        "/data/isos/quantix-kvm-agent-tools.iso",
        "/opt/quantix/agent-tools.iso",
        "/usr/share/quantix/agent-tools.iso",
    ];
    
    let mut iso_path: Option<String> = None;
    for path in &iso_paths {
        if std::path::Path::new(path).exists() {
            iso_path = Some(path.to_string());
            info!(path = %path, "Found agent tools ISO");
            break;
        }
    }
    
    // If not found locally, try to download from update server
    if iso_path.is_none() {
        info!("Agent tools ISO not found locally, checking update server");
        
        if let Some(update_server) = get_update_server_url() {
            let url = format!("{}/api/v1/agent/iso", update_server.trim_end_matches('/'));
            info!(url = %url, "Downloading agent tools ISO from update server");
            
            match reqwest::get(&url).await {
                Ok(response) if response.status().is_success() => {
                    // Save the ISO locally
                    let target_path = "/data/share/quantix-agent/quantix-kvm-agent-tools.iso";
                    if let Err(e) = tokio::fs::create_dir_all("/data/share/quantix-agent").await {
                        warn!(error = %e, "Failed to create directory for agent ISO");
                    }
                    
                    if let Ok(bytes) = response.bytes().await {
                        if let Err(e) = tokio::fs::write(target_path, &bytes).await {
                            warn!(error = %e, "Failed to save agent ISO");
                        } else {
                            iso_path = Some(target_path.to_string());
                            info!(path = %target_path, size = bytes.len(), "Downloaded and saved agent tools ISO");
                        }
                    }
                }
                Ok(response) => {
                    warn!(status = %response.status(), "Update server returned error for ISO");
                }
                Err(e) => {
                    warn!(error = %e, "Failed to download agent ISO from update server");
                }
            }
        }
    }
    
    let iso_path = iso_path.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiError::new("iso_not_found", "Quantix Agent Tools ISO not found. Build it with: scripts/build-agent-iso.sh")),
        )
    })?;
    
    // Find the CD-ROM device in the VM
    // First, try to get the VM's XML to find the CD-ROM target device
    let output = tokio::process::Command::new("virsh")
        .args(["dumpxml", &vm.name])
        .output()
        .await;
    
    let cdrom_device = match output {
        Ok(result) if result.status.success() => {
            let xml = String::from_utf8_lossy(&result.stdout);
            
            // Parse XML to find CD-ROM device
            // Look for: <disk type='...' device='cdrom'> ... <target dev='sda'/> ... </disk>
            let mut device = "sda".to_string(); // default
            
            // Simple XML parsing for CD-ROM target
            if let Some(cdrom_start) = xml.find("device='cdrom'") {
                let cdrom_section = &xml[cdrom_start..];
                if let Some(target_start) = cdrom_section.find("<target dev='") {
                    let target_section = &cdrom_section[target_start + 13..];
                    if let Some(quote_end) = target_section.find('\'') {
                        device = target_section[..quote_end].to_string();
                    }
                }
            }
            
            device
        }
        _ => "sda".to_string(), // fallback to sda
    };
    
    info!(device = %cdrom_device, iso_path = %iso_path, "Mounting ISO to CD-ROM");
    
    // Mount the ISO using the hypervisor's change_media method
    state.service.hypervisor().change_media(&vm.id, &cdrom_device, Some(&iso_path))
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("mount_failed", &format!("Failed to mount ISO: {}", e))),
            )
        })?;
    
    info!(vm_id = %vm_id, device = %cdrom_device, "Agent Tools ISO mounted successfully");
    
    Ok(Json(MountIsoResponse {
        success: true,
        message: format!("Agent Tools ISO mounted to {}. Run: sudo /mnt/cdrom/linux/install.sh", cdrom_device),
        iso_path: Some(iso_path),
        device: Some(cdrom_device),
        error: None,
    }))
}

/// POST /api/v1/vms/:vm_id/cdrom/eject - Eject the CD-ROM
async fn eject_cdrom(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<Json<MountIsoResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, "Ejecting CD-ROM");
    
    // Get the VM
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    // Find the CD-ROM device
    let output = tokio::process::Command::new("virsh")
        .args(["dumpxml", &vm.name])
        .output()
        .await;
    
    let cdrom_device = match output {
        Ok(result) if result.status.success() => {
            let xml = String::from_utf8_lossy(&result.stdout);
            let mut device = "sda".to_string();
            
            if let Some(cdrom_start) = xml.find("device='cdrom'") {
                let cdrom_section = &xml[cdrom_start..];
                if let Some(target_start) = cdrom_section.find("<target dev='") {
                    let target_section = &cdrom_section[target_start + 13..];
                    if let Some(quote_end) = target_section.find('\'') {
                        device = target_section[..quote_end].to_string();
                    }
                }
            }
            
            device
        }
        _ => "sda".to_string(),
    };
    
    // Eject the CD-ROM
    state.service.hypervisor().change_media(&vm.id, &cdrom_device, None)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("eject_failed", &format!("Failed to eject CD-ROM: {}", e))),
            )
        })?;
    
    info!(vm_id = %vm_id, device = %cdrom_device, "CD-ROM ejected");
    
    Ok(Json(MountIsoResponse {
        success: true,
        message: "CD-ROM ejected".to_string(),
        iso_path: None,
        device: Some(cdrom_device),
        error: None,
    }))
}

/// Response for agent logs
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentLogsResponse {
    success: bool,
    lines: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Query parameters for agent logs
#[derive(Deserialize)]
struct AgentLogsQuery {
    /// Number of log lines to fetch (default: 50)
    #[serde(default = "default_log_lines")]
    lines: u32,
}

fn default_log_lines() -> u32 {
    50
}

/// GET /api/v1/vms/:vm_id/agent/logs - Fetch agent logs from the guest VM
/// 
/// This executes `journalctl -u quantix-kvm-agent` in the guest to retrieve
/// the agent's log output for debugging purposes.
async fn get_agent_logs(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
    Query(params): Query<AgentLogsQuery>,
) -> Result<Json<AgentLogsResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, lines = params.lines, "Fetching agent logs");
    
    // Verify VM exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(AgentLogsResponse {
            success: false,
            lines: vec![],
            error: Some(format!("VM is not running (state: {:?})", vm.state)),
        }));
    }
    
    // Get agent client and execute journalctl
    if let Err(e) = state.service.get_agent_client(&vm.id).await {
        return Ok(Json(AgentLogsResponse {
            success: false,
            lines: vec![],
            error: Some(format!("Failed to connect to agent: {}", e)),
        }));
    }
    
    let agents = state.service.agent_manager().await;
    if let Some(client) = agents.get(&vm.id) {
        let command = format!("journalctl -u quantix-kvm-agent -n {} --no-pager", params.lines);
        match client.execute(&command, 10).await {
            Ok(result) => {
                let lines: Vec<String> = result.stdout
                    .lines()
                    .map(|s| s.to_string())
                    .collect();
                
                Ok(Json(AgentLogsResponse {
                    success: true,
                    lines,
                    error: if result.stderr.is_empty() { None } else { Some(result.stderr) },
                }))
            }
            Err(e) => {
                Ok(Json(AgentLogsResponse {
                    success: false,
                    lines: vec![],
                    error: Some(format!("Failed to execute command: {}", e)),
                }))
            }
        }
    } else {
        Ok(Json(AgentLogsResponse {
            success: false,
            lines: vec![],
            error: Some("Agent client not found after connection".to_string()),
        }))
    }
}

/// Response for shutdown/reboot
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentShutdownResponse {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// POST /api/v1/vms/:vm_id/agent/shutdown - Graceful shutdown via agent
async fn agent_shutdown(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<Json<AgentShutdownResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, "Initiating graceful shutdown via agent");
    
    // Verify VM exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(AgentShutdownResponse {
            success: false,
            message: "VM is not running".to_string(),
            error: Some(format!("VM is not running (state: {:?})", vm.state)),
        }));
    }
    
    // Get agent client and request shutdown
    if let Err(e) = state.service.get_agent_client(&vm.id).await {
        return Ok(Json(AgentShutdownResponse {
            success: false,
            message: "Failed to connect to agent".to_string(),
            error: Some(format!("{}", e)),
        }));
    }
    
    let agents = state.service.agent_manager().await;
    if let Some(client) = agents.get(&vm.id) {
        match client.shutdown(false).await {
            Ok(result) => {
                if result.accepted {
                    Ok(Json(AgentShutdownResponse {
                        success: true,
                        message: "Graceful shutdown signal sent to guest".to_string(),
                        error: None,
                    }))
                } else {
                    Ok(Json(AgentShutdownResponse {
                        success: false,
                        message: "Shutdown was rejected by guest agent".to_string(),
                        error: Some(result.error),
                    }))
                }
            }
            Err(e) => {
                Ok(Json(AgentShutdownResponse {
                    success: false,
                    message: "Failed to send shutdown signal".to_string(),
                    error: Some(format!("{}", e)),
                }))
            }
        }
    } else {
        Ok(Json(AgentShutdownResponse {
            success: false,
            message: "Agent client not found after connection".to_string(),
            error: None,
        }))
    }
}

/// POST /api/v1/vms/:vm_id/agent/reboot - Graceful reboot via agent
async fn agent_reboot(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<Json<AgentShutdownResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, "Initiating graceful reboot via agent");
    
    // Verify VM exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(AgentShutdownResponse {
            success: false,
            message: "VM is not running".to_string(),
            error: Some(format!("VM is not running (state: {:?})", vm.state)),
        }));
    }
    
    // Get agent client and request reboot
    if let Err(e) = state.service.get_agent_client(&vm.id).await {
        return Ok(Json(AgentShutdownResponse {
            success: false,
            message: "Failed to connect to agent".to_string(),
            error: Some(format!("{}", e)),
        }));
    }
    
    let agents = state.service.agent_manager().await;
    if let Some(client) = agents.get(&vm.id) {
        match client.shutdown(true).await {
            Ok(result) => {
                if result.accepted {
                    Ok(Json(AgentShutdownResponse {
                        success: true,
                        message: "Graceful reboot signal sent to guest".to_string(),
                        error: None,
                    }))
                } else {
                    Ok(Json(AgentShutdownResponse {
                        success: false,
                        message: "Reboot was rejected by guest agent".to_string(),
                        error: Some(result.error),
                    }))
                }
            }
            Err(e) => {
                Ok(Json(AgentShutdownResponse {
                    success: false,
                    message: "Failed to send reboot signal".to_string(),
                    error: Some(format!("{}", e)),
                }))
            }
        }
    } else {
        Ok(Json(AgentShutdownResponse {
            success: false,
            message: "Agent client not found after connection".to_string(),
            error: None,
        }))
    }
}

/// Query parameters for file listing
#[derive(Deserialize)]
struct ListFilesQuery {
    /// Path to list (default: /)
    #[serde(default = "default_path")]
    path: String,
    /// Include hidden files
    #[serde(default)]
    include_hidden: bool,
}

fn default_path() -> String {
    "/".to_string()
}

/// Directory entry response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryEntryResponse {
    name: String,
    path: String,
    is_directory: bool,
    is_symlink: bool,
    size_bytes: u64,
    mode: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    modified_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    group: Option<String>,
}

/// Response for file listing
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListFilesResponse {
    success: bool,
    path: String,
    entries: Vec<DirectoryEntryResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// GET /api/v1/vms/:vm_id/agent/files/list - List directory contents in the guest
async fn list_guest_files(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
    Query(params): Query<ListFilesQuery>,
) -> Result<Json<ListFilesResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, path = %params.path, "Listing directory in guest");
    
    // Verify VM exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(ListFilesResponse {
            success: false,
            path: params.path.clone(),
            entries: vec![],
            error: Some(format!("VM is not running (state: {:?})", vm.state)),
        }));
    }
    
    // Get agent client and list directory
    if let Err(e) = state.service.get_agent_client(&vm.id).await {
        return Ok(Json(ListFilesResponse {
            success: false,
            path: params.path,
            entries: vec![],
            error: Some(format!("Failed to connect to agent: {}", e)),
        }));
    }
    
    let agents = state.service.agent_manager().await;
    if let Some(client) = agents.get(&vm.id) {
        match client.list_directory(&params.path, params.include_hidden).await {
            Ok(result) => {
                let entries: Vec<DirectoryEntryResponse> = result.entries
                    .into_iter()
                    .map(|e| DirectoryEntryResponse {
                        name: e.name,
                        path: e.path,
                        is_directory: e.is_directory,
                        is_symlink: e.is_symlink,
                        size_bytes: e.size_bytes,
                        mode: e.mode,
                        modified_at: e.modified_at.map(|t| {
                            chrono::DateTime::from_timestamp(t.seconds, t.nanos as u32)
                                .map(|dt| dt.to_rfc3339())
                                .unwrap_or_default()
                        }),
                        owner: if e.owner.is_empty() { None } else { Some(e.owner) },
                        group: if e.group.is_empty() { None } else { Some(e.group) },
                    })
                    .collect();
                
                Ok(Json(ListFilesResponse {
                    success: true,
                    path: params.path,
                    entries,
                    error: None,
                }))
            }
            Err(e) => {
                Ok(Json(ListFilesResponse {
                    success: false,
                    path: params.path,
                    entries: vec![],
                    error: Some(format!("Failed to list directory: {}", e)),
                }))
            }
        }
    } else {
        Ok(Json(ListFilesResponse {
            success: false,
            path: params.path,
            entries: vec![],
            error: Some("Agent client not found after connection".to_string()),
        }))
    }
}

/// Query parameters for file reading
#[derive(Deserialize)]
struct ReadFileQuery {
    /// Path to the file to read
    path: String,
}

/// Response for file reading
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadFileResponse {
    success: bool,
    path: String,
    /// Base64-encoded file content
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    /// File size in bytes
    #[serde(skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// GET /api/v1/vms/:vm_id/agent/files/read - Read a file from the guest
async fn read_guest_file(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
    Query(params): Query<ReadFileQuery>,
) -> Result<Json<ReadFileResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, path = %params.path, "Reading file from guest");
    
    // Verify VM exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(ReadFileResponse {
            success: false,
            path: params.path.clone(),
            content: None,
            size_bytes: None,
            error: Some(format!("VM is not running (state: {:?})", vm.state)),
        }));
    }
    
    // Get agent client and read file
    if let Err(e) = state.service.get_agent_client(&vm.id).await {
        return Ok(Json(ReadFileResponse {
            success: false,
            path: params.path,
            content: None,
            size_bytes: None,
            error: Some(format!("Failed to connect to agent: {}", e)),
        }));
    }
    
    let agents = state.service.agent_manager().await;
    if let Some(client) = agents.get(&vm.id) {
        match client.read_file(&params.path).await {
            Ok(data) => {
                use base64::Engine;
                let content = base64::engine::general_purpose::STANDARD.encode(&data);
                
                Ok(Json(ReadFileResponse {
                    success: true,
                    path: params.path,
                    content: Some(content),
                    size_bytes: Some(data.len() as u64),
                    error: None,
                }))
            }
            Err(e) => {
                Ok(Json(ReadFileResponse {
                    success: false,
                    path: params.path,
                    content: None,
                    size_bytes: None,
                    error: Some(format!("Failed to read file: {}", e)),
                }))
            }
        }
    } else {
        Ok(Json(ReadFileResponse {
            success: false,
            path: params.path,
            content: None,
            size_bytes: None,
            error: Some("Agent client not found after connection".to_string()),
        }))
    }
}

/// Request body for command execution
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteCommandRequest {
    /// Command to execute
    command: String,
    /// Timeout in seconds (default: 30, max: 30 for sync execution)
    #[serde(default = "default_execute_timeout")]
    timeout_seconds: u32,
    /// Wait for command to complete (always true for this endpoint)
    #[serde(default = "default_true")]
    wait_for_exit: bool,
}

fn default_execute_timeout() -> u32 {
    30
}

fn default_true() -> bool {
    true
}

/// Response for command execution
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteCommandResponse {
    success: bool,
    exit_code: i32,
    stdout: String,
    stderr: String,
    timed_out: bool,
    duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// POST /api/v1/vms/:vm_id/execute - Execute a command in the guest VM
/// 
/// WARNING: This endpoint has a maximum timeout of 30 seconds for synchronous execution.
/// Long-running scripts may timeout but continue running in the guest. For long operations,
/// check the VM console or use asynchronous execution (future feature).
async fn execute_in_guest(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
    Json(request): Json<ExecuteCommandRequest>,
) -> Result<Json<ExecuteCommandResponse>, (StatusCode, Json<ApiError>)> {
    // Enforce max timeout of 30 seconds
    let timeout = std::cmp::min(request.timeout_seconds, 30);
    
    info!(vm_id = %vm_id, command = %request.command, timeout = timeout, "Executing command in guest");
    
    // Verify VM exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(ExecuteCommandResponse {
            success: false,
            exit_code: -1,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: false,
            duration_ms: 0,
            error: Some(format!("VM is not running (state: {:?})", vm.state)),
        }));
    }
    
    // Get agent client and execute command
    if let Err(e) = state.service.get_agent_client(&vm.id).await {
        return Ok(Json(ExecuteCommandResponse {
            success: false,
            exit_code: -1,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: false,
            duration_ms: 0,
            error: Some(format!("Failed to connect to agent: {}", e)),
        }));
    }
    
    let agents = state.service.agent_manager().await;
    if let Some(client) = agents.get(&vm.id) {
        match client.execute(&request.command, timeout).await {
            Ok(result) => {
                Ok(Json(ExecuteCommandResponse {
                    success: result.exit_code == 0,
                    exit_code: result.exit_code,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    timed_out: result.timed_out,
                    duration_ms: result.duration_ms,
                    error: if result.error.is_empty() { None } else { Some(result.error) },
                }))
            }
            Err(e) => {
                Ok(Json(ExecuteCommandResponse {
                    success: false,
                    exit_code: -1,
                    stdout: String::new(),
                    stderr: String::new(),
                    timed_out: false,
                    duration_ms: 0,
                    error: Some(format!("Failed to execute command: {}", e)),
                }))
            }
        }
    } else {
        Ok(Json(ExecuteCommandResponse {
            success: false,
            exit_code: -1,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: false,
            duration_ms: 0,
            error: Some("Agent client not found after connection".to_string()),
        }))
    }
}

// =============================================================================
// END NEW AGENT ENDPOINTS
// =============================================================================

/// GET /api/v1/vms/:vm_id/qemu-agent/ping - Check if QEMU Guest Agent is available
/// 
/// This uses libvirt's qemuAgentCommand to send a "guest-ping" command
async fn ping_qemu_guest_agent(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
) -> Result<Json<QemuAgentPingResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, "Pinging QEMU Guest Agent");
    
    // Get the VM to verify it exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    // Check if VM is running
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(QemuAgentPingResponse {
            available: false,
            error: Some(format!("VM is not running (state: {:?})", vm.state)),
        }));
    }
    
    // Try to ping the QEMU Guest Agent using virsh qemu-agent-command
    // This sends a "guest-ping" command which returns empty object if agent is responsive
    let output = tokio::process::Command::new("virsh")
        .args([
            "qemu-agent-command",
            &vm.name,
            r#"{"execute":"guest-ping"}"#,
            "--timeout", "5",
        ])
        .output()
        .await;
    
    match output {
        Ok(result) => {
            if result.status.success() {
                info!(vm_id = %vm_id, "QEMU Guest Agent is available");
                Ok(Json(QemuAgentPingResponse {
                    available: true,
                    error: None,
                }))
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                warn!(vm_id = %vm_id, error = %stderr, "QEMU Guest Agent not available");
                Ok(Json(QemuAgentPingResponse {
                    available: false,
                    error: Some(stderr.to_string()),
                }))
            }
        }
        Err(e) => {
            error!(vm_id = %vm_id, error = %e, "Failed to run virsh command");
            Ok(Json(QemuAgentPingResponse {
                available: false,
                error: Some(format!("Failed to execute virsh: {}", e)),
            }))
        }
    }
}

/// POST /api/v1/vms/:vm_id/qemu-agent/exec - Execute a command via QEMU Guest Agent
/// 
/// This uses libvirt's qemuAgentCommand to execute commands inside the VM.
/// Requires QEMU Guest Agent to be installed and running in the VM.
async fn exec_qemu_guest_agent(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
    Json(request): Json<QemuAgentExecRequest>,
) -> Result<Json<QemuAgentExecResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, command = %request.command, "Executing command via QEMU Guest Agent");
    
    // Get the VM to verify it exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    // Check if VM is running
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(QemuAgentExecResponse {
            success: false,
            exit_code: None,
            stdout: None,
            stderr: None,
            error: Some(format!("VM is not running (state: {:?})", vm.state)),
        }));
    }
    
    // Build the guest-exec command
    // Format: {"execute":"guest-exec","arguments":{"path":"/bin/bash","arg":["-c","command"],"capture-output":true}}
    let mut args_json = vec!["-c".to_string(), request.command.clone()];
    args_json.extend(request.args.clone());
    
    let exec_cmd = serde_json::json!({
        "execute": "guest-exec",
        "arguments": {
            "path": "/bin/bash",
            "arg": args_json,
            "capture-output": true
        }
    });
    
    // Execute the command
    let output = tokio::process::Command::new("virsh")
        .args([
            "qemu-agent-command",
            &vm.name,
            &exec_cmd.to_string(),
            "--timeout", &request.timeout.to_string(),
        ])
        .output()
        .await;
    
    match output {
        Ok(result) => {
            if result.status.success() {
                let stdout = String::from_utf8_lossy(&result.stdout);
                
                // Parse the response to get the PID
                if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    if let Some(pid) = resp.get("return").and_then(|r| r.get("pid")).and_then(|p| p.as_i64()) {
                        // Now we need to wait for the command to complete and get output
                        // Use guest-exec-status
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        
                        let status_cmd = serde_json::json!({
                            "execute": "guest-exec-status",
                            "arguments": {
                                "pid": pid
                            }
                        });
                        
                        // Poll for completion (up to timeout)
                        let start = std::time::Instant::now();
                        let timeout_duration = std::time::Duration::from_secs(request.timeout as u64);
                        
                        loop {
                            let status_output = tokio::process::Command::new("virsh")
                                .args([
                                    "qemu-agent-command",
                                    &vm.name,
                                    &status_cmd.to_string(),
                                    "--timeout", "5",
                                ])
                                .output()
                                .await;
                            
                            if let Ok(status_result) = status_output {
                                if status_result.status.success() {
                                    let status_stdout = String::from_utf8_lossy(&status_result.stdout);
                                    if let Ok(status_resp) = serde_json::from_str::<serde_json::Value>(&status_stdout) {
                                        if let Some(ret) = status_resp.get("return") {
                                            let exited = ret.get("exited").and_then(|e| e.as_bool()).unwrap_or(false);
                                            
                                            if exited {
                                                let exit_code = ret.get("exitcode").and_then(|c| c.as_i64()).map(|c| c as i32);
                                                
                                                // Decode base64 output if present
                                                let stdout_data = ret.get("out-data")
                                                    .and_then(|d| d.as_str())
                                                    .and_then(|s| {
                                                        use base64::Engine;
                                                        base64::engine::general_purpose::STANDARD.decode(s).ok()
                                                    })
                                                    .and_then(|b| String::from_utf8(b).ok());
                                                
                                                let stderr_data = ret.get("err-data")
                                                    .and_then(|d| d.as_str())
                                                    .and_then(|s| {
                                                        use base64::Engine;
                                                        base64::engine::general_purpose::STANDARD.decode(s).ok()
                                                    })
                                                    .and_then(|b| String::from_utf8(b).ok());
                                                
                                                return Ok(Json(QemuAgentExecResponse {
                                                    success: exit_code == Some(0),
                                                    exit_code,
                                                    stdout: stdout_data,
                                                    stderr: stderr_data,
                                                    error: None,
                                                }));
                                            }
                                        }
                                    }
                                }
                            }
                            
                            if start.elapsed() > timeout_duration {
                                return Ok(Json(QemuAgentExecResponse {
                                    success: false,
                                    exit_code: None,
                                    stdout: None,
                                    stderr: None,
                                    error: Some("Command timed out".to_string()),
                                }));
                            }
                            
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        }
                    }
                }
                
                // If we couldn't parse the response properly
                Ok(Json(QemuAgentExecResponse {
                    success: false,
                    exit_code: None,
                    stdout: Some(stdout.to_string()),
                    stderr: None,
                    error: Some("Failed to parse guest-exec response".to_string()),
                }))
            } else {
                let stderr = String::from_utf8_lossy(&result.stderr);
                Ok(Json(QemuAgentExecResponse {
                    success: false,
                    exit_code: None,
                    stdout: None,
                    stderr: Some(stderr.to_string()),
                    error: Some("QEMU Guest Agent command failed".to_string()),
                }))
            }
        }
        Err(e) => {
            error!(vm_id = %vm_id, error = %e, "Failed to run virsh command");
            Ok(Json(QemuAgentExecResponse {
                success: false,
                exit_code: None,
                stdout: None,
                stderr: None,
                error: Some(format!("Failed to execute virsh: {}", e)),
            }))
        }
    }
}

// =============================================================================
// QEMU Guest Agent File Transfer (Network-free via virtio-serial)
// =============================================================================

/// Request for writing a file via QEMU Guest Agent
#[derive(Deserialize)]
struct QemuAgentFileWriteRequest {
    /// Path to write the file to (inside the VM)
    path: String,
    /// Base64-encoded file contents
    content_base64: String,
    /// File mode (e.g., "0755" for executable)
    #[serde(default = "default_file_mode")]
    mode: String,
}

fn default_file_mode() -> String {
    "0644".to_string()
}

/// Response for file write operation
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QemuAgentFileWriteResponse {
    success: bool,
    bytes_written: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// POST /api/v1/vms/:vm_id/qemu-agent/file-write - Write a file to VM via QEMU Guest Agent
/// 
/// This uses virtio-serial (no network required) to transfer files to the VM.
/// Uses guest-file-open, guest-file-write, guest-file-close commands.
async fn qemu_agent_file_write(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
    Json(request): Json<QemuAgentFileWriteRequest>,
) -> Result<Json<QemuAgentFileWriteResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, path = %request.path, "Writing file via QEMU Guest Agent");
    
    // Get the VM to verify it exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    // Check if VM is running
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(QemuAgentFileWriteResponse {
            success: false,
            bytes_written: None,
            error: Some(format!("VM is not running (state: {:?})", vm.state)),
        }));
    }

    // Decode the content
    let content = match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &request.content_base64) {
        Ok(data) => data,
        Err(e) => {
            return Ok(Json(QemuAgentFileWriteResponse {
                success: false,
                bytes_written: None,
                error: Some(format!("Invalid base64 content: {}", e)),
            }));
        }
    };
    
    let content_len = content.len();
    
    // Step 1: Open the file for writing
    let open_cmd = serde_json::json!({
        "execute": "guest-file-open",
        "arguments": {
            "path": request.path,
            "mode": "w"
        }
    });
    
    let open_output = tokio::process::Command::new("virsh")
        .args([
            "qemu-agent-command",
            &vm.name,
            &open_cmd.to_string(),
            "--timeout", "30",
        ])
        .output()
        .await;
    
    let handle = match open_output {
        Ok(result) if result.status.success() => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&stdout) {
                if let Some(h) = resp.get("return").and_then(|r| r.as_i64()) {
                    h
                } else {
                    return Ok(Json(QemuAgentFileWriteResponse {
                        success: false,
                        bytes_written: None,
                        error: Some("Failed to get file handle from guest-file-open".to_string()),
                    }));
                }
            } else {
                return Ok(Json(QemuAgentFileWriteResponse {
                    success: false,
                    bytes_written: None,
                    error: Some(format!("Failed to parse guest-file-open response: {}", stdout)),
                }));
            }
        }
        Ok(result) => {
            let stderr = String::from_utf8_lossy(&result.stderr);
            return Ok(Json(QemuAgentFileWriteResponse {
                success: false,
                bytes_written: None,
                error: Some(format!("guest-file-open failed: {}", stderr)),
            }));
        }
        Err(e) => {
            return Ok(Json(QemuAgentFileWriteResponse {
                success: false,
                bytes_written: None,
                error: Some(format!("Failed to execute virsh: {}", e)),
            }));
        }
    };
    
    // Step 2: Write the content (in chunks if large)
    // QEMU GA has a limit on message size, so we chunk large files
    const CHUNK_SIZE: usize = 65536; // 64KB chunks
    let mut total_written = 0;
    
    for chunk in content.chunks(CHUNK_SIZE) {
        let chunk_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, chunk);
        
        let write_cmd = serde_json::json!({
            "execute": "guest-file-write",
            "arguments": {
                "handle": handle,
                "buf-b64": chunk_b64
            }
        });
        
        let write_output = tokio::process::Command::new("virsh")
            .args([
                "qemu-agent-command",
                &vm.name,
                &write_cmd.to_string(),
                "--timeout", "60",
            ])
            .output()
            .await;
        
        match write_output {
            Ok(result) if result.status.success() => {
                let stdout = String::from_utf8_lossy(&result.stdout);
                if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    if let Some(count) = resp.get("return").and_then(|r| r.get("count")).and_then(|c| c.as_i64()) {
                        total_written += count as usize;
                    }
                }
            }
            Ok(result) => {
                let stderr = String::from_utf8_lossy(&result.stderr);
                // Try to close the file handle before returning error
                let _ = close_file_handle(&vm.name, handle).await;
                return Ok(Json(QemuAgentFileWriteResponse {
                    success: false,
                    bytes_written: Some(total_written),
                    error: Some(format!("guest-file-write failed: {}", stderr)),
                }));
            }
            Err(e) => {
                let _ = close_file_handle(&vm.name, handle).await;
                return Ok(Json(QemuAgentFileWriteResponse {
                    success: false,
                    bytes_written: Some(total_written),
                    error: Some(format!("Failed to execute virsh: {}", e)),
                }));
            }
        }
    }
    
    // Step 3: Close the file
    if let Err(e) = close_file_handle(&vm.name, handle).await {
        warn!(vm_id = %vm_id, error = %e, "Failed to close file handle");
    }
    
    // Step 4: Set file permissions using guest-exec (optional, may fail if disabled)
    let chmod_cmd = serde_json::json!({
        "execute": "guest-exec",
        "arguments": {
            "path": "/bin/chmod",
            "arg": [&request.mode, &request.path],
            "capture-output": false
        }
    });
    
    // Try to chmod, but don't fail if guest-exec is disabled
    let _ = tokio::process::Command::new("virsh")
        .args([
            "qemu-agent-command",
            &vm.name,
            &chmod_cmd.to_string(),
            "--timeout", "10",
        ])
        .output()
        .await;
    
    info!(vm_id = %vm_id, path = %request.path, bytes = content_len, "File written successfully via QEMU Guest Agent");
    
    Ok(Json(QemuAgentFileWriteResponse {
        success: true,
        bytes_written: Some(total_written),
        error: None,
    }))
}

/// Helper to close a QEMU Guest Agent file handle
async fn close_file_handle(vm_name: &str, handle: i64) -> Result<(), String> {
    let close_cmd = serde_json::json!({
        "execute": "guest-file-close",
        "arguments": {
            "handle": handle
        }
    });
    
    let result = tokio::process::Command::new("virsh")
        .args([
            "qemu-agent-command",
            vm_name,
            &close_cmd.to_string(),
            "--timeout", "10",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to execute virsh: {}", e))?;
    
    if result.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&result.stderr).to_string())
    }
}

// =============================================================================
// Agent Installation (Network-free via virtio-serial)
// =============================================================================

/// Request for agent installation
#[derive(Deserialize)]
struct InstallAgentRequest {
    /// Force reinstall even if already installed
    #[serde(default)]
    force: bool,
}

/// Response for agent installation
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallAgentResponse {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    /// Method used for installation
    method: String,
}

/// POST /api/v1/vms/:vm_id/agent/install - Install Quantix Agent without network
/// 
/// This transfers the agent binary via QEMU Guest Agent (virtio-serial)
/// and installs it without requiring network connectivity from the VM.
async fn install_quantix_agent(
    State(state): State<Arc<AppState>>,
    Path(vm_id): Path<String>,
    Json(_request): Json<InstallAgentRequest>,
) -> Result<Json<InstallAgentResponse>, (StatusCode, Json<ApiError>)> {
    info!(vm_id = %vm_id, "Installing Quantix Agent via virtio-serial");
    
    // Get the VM to verify it exists and is running
    let vms = state.service.hypervisor().list_vms().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("list_vms_failed", &format!("Failed to list VMs: {}", e))),
        )
    })?;
    
    let vm = vms.iter()
        .find(|v| v.id == vm_id || v.name == vm_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ApiError::new("vm_not_found", &format!("VM not found: {}", vm_id))),
            )
        })?;
    
    // Check if VM is running
    if vm.state != limiquantix_hypervisor::types::VmState::Running {
        return Ok(Json(InstallAgentResponse {
            success: false,
            message: "VM is not running".to_string(),
            error: Some(format!("VM state: {:?}", vm.state)),
            method: "none".to_string(),
        }));
    }
    
    // First, check if QEMU Guest Agent is available
    let ping_cmd = serde_json::json!({
        "execute": "guest-ping"
    });
    
    let ping_result = tokio::process::Command::new("virsh")
        .args([
            "qemu-agent-command",
            &vm.name,
            &ping_cmd.to_string(),
            "--timeout", "5",
        ])
        .output()
        .await;
    
    if ping_result.is_err() || !ping_result.as_ref().unwrap().status.success() {
        return Ok(Json(InstallAgentResponse {
            success: false,
            message: "QEMU Guest Agent not available".to_string(),
            error: Some("Install qemu-guest-agent in the VM first: apt/yum install qemu-guest-agent".to_string()),
            method: "none".to_string(),
        }));
    }
    
    // Try to find the agent binary locally
    // Check both new name (quantix-kvm-agent) and legacy name (limiquantix-agent) for compatibility
    let agent_paths = [
        "/data/share/quantix-agent/quantix-kvm-agent-linux-amd64",
        "/data/share/quantix-agent/quantix-kvm-agent",
        "/data/share/quantix-agent/limiquantix-agent-linux-amd64",  // Legacy name
        "/opt/quantix-kvm/agent/quantix-kvm-agent",
        "/opt/quantix-kvm/agent/limiquantix-agent",  // Legacy name
    ];
    
    let mut agent_binary: Option<Vec<u8>> = None;
    let mut source_path = "";
    
    for path in &agent_paths {
        if let Ok(data) = tokio::fs::read(path).await {
            agent_binary = Some(data);
            source_path = path;
            info!(path = %path, size = agent_binary.as_ref().unwrap().len(), "Found agent binary locally");
            break;
        }
    }
    
    // If not found locally, try to download from update server
    if agent_binary.is_none() {
        if let Some(update_server) = get_update_server_url() {
            let url = format!("{}/api/v1/agent/linux/binary/amd64", update_server.trim_end_matches('/'));
            info!(url = %url, "Downloading agent binary from update server");
            
            match reqwest::get(&url).await {
                Ok(response) if response.status().is_success() => {
                    if let Ok(bytes) = response.bytes().await {
                        agent_binary = Some(bytes.to_vec());
                        source_path = "update-server";
                        info!(size = agent_binary.as_ref().unwrap().len(), "Downloaded agent binary from update server");
                    }
                }
                Ok(response) => {
                    warn!(status = %response.status(), "Update server returned error");
                }
                Err(e) => {
                    warn!(error = %e, "Failed to download from update server");
                }
            }
        }
    }
    
    let agent_binary = match agent_binary {
        Some(data) => data,
        None => {
            return Ok(Json(InstallAgentResponse {
                success: false,
                message: "Agent binary not available".to_string(),
                error: Some("Could not find agent binary locally or download from update server".to_string()),
                method: "none".to_string(),
            }));
        }
    };
    
    info!(source = %source_path, size = agent_binary.len(), "Transferring agent to VM via virtio-serial");
    
    // Create the install script
    let install_script = r#"#!/bin/bash
set -e
echo "[Quantix] Installing agent..."

# Create directories
mkdir -p /etc/quantix-kvm/pre-freeze.d
mkdir -p /etc/quantix-kvm/post-thaw.d
mkdir -p /var/log/quantix-kvm

# Move binary to final location
mv /tmp/quantix-kvm-agent /usr/local/bin/quantix-kvm-agent
chmod +x /usr/local/bin/quantix-kvm-agent

# Fix SELinux context if SELinux is enabled (Rocky, CentOS, RHEL, Fedora)
if command -v getenforce &> /dev/null && [ "$(getenforce)" != "Disabled" ]; then
    echo "[Quantix] Fixing SELinux context..."
    # Set the correct SELinux type for executables
    if command -v chcon &> /dev/null; then
        chcon -t bin_t /usr/local/bin/quantix-kvm-agent 2>/dev/null || true
    fi
    # Also try restorecon if available
    if command -v restorecon &> /dev/null; then
        restorecon -v /usr/local/bin/quantix-kvm-agent 2>/dev/null || true
    fi
fi

# Create systemd service
cat > /etc/systemd/system/quantix-kvm-agent.service << 'EOF'
[Unit]
Description=Quantix Guest Agent
After=network.target
ConditionVirtualization=vm

[Service]
Type=simple
ExecStart=/usr/local/bin/quantix-kvm-agent
Restart=always
RestartSec=5
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOF

# Reload and start
systemctl daemon-reload
systemctl enable quantix-kvm-agent
systemctl restart quantix-kvm-agent

echo "[Quantix] Agent installed successfully!"
systemctl status quantix-kvm-agent --no-pager || true
"#;
    
    // Step 1: Transfer the agent binary
    let binary_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &agent_binary);
    
    // Use file-write directly (this always works, unlike guest-exec)
    let write_request = QemuAgentFileWriteRequest {
        path: "/tmp/quantix-kvm-agent".to_string(),
        content_base64: binary_b64,
        mode: "0755".to_string(),
    };
    
    // Write the binary
    let write_result = qemu_agent_file_write_internal(&vm.name, &write_request).await;
    if !write_result.success {
        return Ok(Json(InstallAgentResponse {
            success: false,
            message: "Failed to transfer agent binary".to_string(),
            error: write_result.error,
            method: "virtio-serial".to_string(),
        }));
    }
    
    // Step 2: Transfer the install script
    let script_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, install_script.as_bytes());
    
    let script_request = QemuAgentFileWriteRequest {
        path: "/tmp/install-quantix-agent.sh".to_string(),
        content_base64: script_b64,
        mode: "0755".to_string(),
    };
    
    let script_result = qemu_agent_file_write_internal(&vm.name, &script_request).await;
    if !script_result.success {
        return Ok(Json(InstallAgentResponse {
            success: false,
            message: "Failed to transfer install script".to_string(),
            error: script_result.error,
            method: "virtio-serial".to_string(),
        }));
    }
    
    // Step 3: Execute the install script (this might fail if guest-exec is disabled)
    let exec_cmd = serde_json::json!({
        "execute": "guest-exec",
        "arguments": {
            "path": "/bin/bash",
            "arg": ["/tmp/install-quantix-agent.sh"],
            "capture-output": true
        }
    });
    
    let exec_result = tokio::process::Command::new("virsh")
        .args([
            "qemu-agent-command",
            &vm.name,
            &exec_cmd.to_string(),
            "--timeout", "120",
        ])
        .output()
        .await;
    
    match exec_result {
        Ok(result) if result.status.success() => {
            info!(vm_id = %vm_id, "Agent installation initiated successfully");
            Ok(Json(InstallAgentResponse {
                success: true,
                message: "Quantix Agent installation initiated. The agent should connect within a minute.".to_string(),
                error: None,
                method: "virtio-serial".to_string(),
            }))
        }
        Ok(result) => {
            let stderr = String::from_utf8_lossy(&result.stderr);
            // guest-exec might be disabled - provide manual instructions
            if stderr.contains("not allowed") || stderr.contains("disabled") {
                warn!(vm_id = %vm_id, "guest-exec is disabled, providing manual instructions");
                Ok(Json(InstallAgentResponse {
                    success: true,
                    message: "Agent binary transferred. Run manually: /tmp/install-quantix-agent.sh".to_string(),
                    error: Some("guest-exec is disabled in QEMU Guest Agent. The agent binary and install script have been transferred to /tmp/. Run '/tmp/install-quantix-agent.sh' in the VM console to complete installation.".to_string()),
                    method: "virtio-serial-manual".to_string(),
                }))
            } else {
                Ok(Json(InstallAgentResponse {
                    success: false,
                    message: "Failed to execute install script".to_string(),
                    error: Some(stderr.to_string()),
                    method: "virtio-serial".to_string(),
                }))
            }
        }
        Err(e) => {
            Ok(Json(InstallAgentResponse {
                success: false,
                message: "Failed to execute virsh command".to_string(),
                error: Some(e.to_string()),
                method: "virtio-serial".to_string(),
            }))
        }
    }
}

/// Internal helper for file write (doesn't need State)
async fn qemu_agent_file_write_internal(vm_name: &str, request: &QemuAgentFileWriteRequest) -> QemuAgentFileWriteResponse {
    // Decode the content
    let content = match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &request.content_base64) {
        Ok(data) => data,
        Err(e) => {
            return QemuAgentFileWriteResponse {
                success: false,
                bytes_written: None,
                error: Some(format!("Invalid base64 content: {}", e)),
            };
        }
    };
    
    let content_len = content.len();
    
    // Step 1: Open the file for writing
    let open_cmd = serde_json::json!({
        "execute": "guest-file-open",
        "arguments": {
            "path": request.path,
            "mode": "w"
        }
    });
    
    let open_output = tokio::process::Command::new("virsh")
        .args([
            "qemu-agent-command",
            vm_name,
            &open_cmd.to_string(),
            "--timeout", "30",
        ])
        .output()
        .await;
    
    let handle = match open_output {
        Ok(result) if result.status.success() => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&stdout) {
                if let Some(h) = resp.get("return").and_then(|r| r.as_i64()) {
                    h
                } else {
                    return QemuAgentFileWriteResponse {
                        success: false,
                        bytes_written: None,
                        error: Some("Failed to get file handle from guest-file-open".to_string()),
                    };
                }
            } else {
                return QemuAgentFileWriteResponse {
                    success: false,
                    bytes_written: None,
                    error: Some(format!("Failed to parse guest-file-open response: {}", stdout)),
                };
            }
        }
        Ok(result) => {
            let stderr = String::from_utf8_lossy(&result.stderr);
            return QemuAgentFileWriteResponse {
                success: false,
                bytes_written: None,
                error: Some(format!("guest-file-open failed: {}", stderr)),
            };
        }
        Err(e) => {
            return QemuAgentFileWriteResponse {
                success: false,
                bytes_written: None,
                error: Some(format!("Failed to execute virsh: {}", e)),
            };
        }
    };
    
    // Step 2: Write the content in chunks
    const CHUNK_SIZE: usize = 65536;
    let mut total_written = 0;
    
    for chunk in content.chunks(CHUNK_SIZE) {
        let chunk_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, chunk);
        
        let write_cmd = serde_json::json!({
            "execute": "guest-file-write",
            "arguments": {
                "handle": handle,
                "buf-b64": chunk_b64
            }
        });
        
        let write_output = tokio::process::Command::new("virsh")
            .args([
                "qemu-agent-command",
                vm_name,
                &write_cmd.to_string(),
                "--timeout", "60",
            ])
            .output()
            .await;
        
        match write_output {
            Ok(result) if result.status.success() => {
                let stdout = String::from_utf8_lossy(&result.stdout);
                if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    if let Some(count) = resp.get("return").and_then(|r| r.get("count")).and_then(|c| c.as_i64()) {
                        total_written += count as usize;
                    }
                }
            }
            Ok(result) => {
                let stderr = String::from_utf8_lossy(&result.stderr);
                let _ = close_file_handle(vm_name, handle).await;
                return QemuAgentFileWriteResponse {
                    success: false,
                    bytes_written: Some(total_written),
                    error: Some(format!("guest-file-write failed: {}", stderr)),
                };
            }
            Err(e) => {
                let _ = close_file_handle(vm_name, handle).await;
                return QemuAgentFileWriteResponse {
                    success: false,
                    bytes_written: Some(total_written),
                    error: Some(format!("Failed to execute virsh: {}", e)),
                };
            }
        }
    }
    
    // Step 3: Close the file
    let _ = close_file_handle(vm_name, handle).await;
    
    info!(path = %request.path, bytes = content_len, "File written via QEMU Guest Agent");
    
    QemuAgentFileWriteResponse {
        success: true,
        bytes_written: Some(total_written),
        error: None,
    }
}

// =============================================================================
// Snapshot Endpoints
// =============================================================================

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

    // disk_only is the inverse of include_memory
    // If include_memory is false or not specified, we do disk-only snapshot (safer, works with invtsc)
    let disk_only = !request.include_memory.unwrap_or(false);

    let proto_request = ProtoRequest {
        vm_id: vm_id.clone(),
        name: request.name.clone(),
        description: request.description.unwrap_or_default(),
        quiesce: request.quiesce.unwrap_or(false),
        disk_only,
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
        Ok(_) => Ok(StatusCode::NO_CONTENT),
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
    // Get pools directly from storage manager to access the name field
    let raw_pools = state.storage.list_pools().await;
    
    let mut pools = Vec::new();
    for p in raw_pools {
        // Get volume count
        let volume_count = state.storage.list_volumes(&p.pool_id).await.unwrap_or_default().len() as u32;
        let used_bytes = p.total_bytes.saturating_sub(p.available_bytes);
        
        let pool_type = match p.pool_type {
            limiquantix_hypervisor::storage::PoolType::LocalDir => "LOCAL_DIR",
            limiquantix_hypervisor::storage::PoolType::Nfs => "NFS",
            limiquantix_hypervisor::storage::PoolType::CephRbd => "CEPH_RBD",
            limiquantix_hypervisor::storage::PoolType::Iscsi => "ISCSI",
            _ => "UNKNOWN",
        };
        
        pools.push(StoragePoolResponse {
            pool_id: p.pool_id,
            name: p.name,
            pool_type: pool_type.to_string(),
            mount_path: p.mount_path.unwrap_or_default(),
            total_bytes: p.total_bytes,
            available_bytes: p.available_bytes,
            used_bytes,
            volume_count,
        });
    }
    
    Ok(Json(StoragePoolListResponse { pools }))
}

/// GET /api/v1/storage/pools/:pool_id - Get a specific storage pool
async fn get_storage_pool(
    State(state): State<Arc<AppState>>,
    Path(pool_id): Path<String>,
) -> Result<Json<StoragePoolResponse>, (StatusCode, Json<ApiError>)> {
    // Get pool directly from storage manager to access the name field
    match state.storage.get_pool_info(&pool_id).await {
        Ok(p) => {
            let volume_count = state.storage.list_volumes(&p.pool_id).await.unwrap_or_default().len() as u32;
            let used_bytes = p.total_bytes.saturating_sub(p.available_bytes);
            
            let pool_type = match p.pool_type {
                limiquantix_hypervisor::storage::PoolType::LocalDir => "LOCAL_DIR",
                limiquantix_hypervisor::storage::PoolType::Nfs => "NFS",
                limiquantix_hypervisor::storage::PoolType::CephRbd => "CEPH_RBD",
                limiquantix_hypervisor::storage::PoolType::Iscsi => "ISCSI",
                _ => "UNKNOWN",
            };
            
            Ok(Json(StoragePoolResponse {
                pool_id: p.pool_id,
                name: p.name,
                pool_type: pool_type.to_string(),
                mount_path: p.mount_path.unwrap_or_default(),
                total_bytes: p.total_bytes,
                available_bytes: p.available_bytes,
                used_bytes,
                volume_count,
            }))
        }
        Err(e) => {
            error!(error = %e, pool_id = %pool_id, "Failed to get storage pool");
            Err((
                StatusCode::NOT_FOUND,
                Json(ApiError::new("pool_not_found", &format!("Pool {} not found: {}", pool_id, e))),
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

    // Debug logging for troubleshooting
    info!(
        pool_id = %request.pool_id,
        pool_type = %request.pool_type,
        path = ?request.path,
        nfs_server = ?request.nfs_server,
        nfs_export = ?request.nfs_export,
        "Creating storage pool"
    );

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
                capacity_gib: request.capacity_gib,
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
                name: None, // Locally created pools don't have QvDC names
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
// Local Storage Device Discovery
// ============================================================================

/// GET /api/v1/storage/local-devices - List available local block devices
async fn list_local_devices(
    State(state): State<Arc<AppState>>,
) -> Result<Json<LocalDeviceListResponse>, (StatusCode, Json<ApiError>)> {
    use std::process::Command;
    
    info!("Listing local storage devices");
    
    let mut devices = Vec::new();
    
    // Get disk info from telemetry for mounted filesystems
    let telemetry = state.service.get_telemetry();
    let mounted_devices: std::collections::HashSet<String> = telemetry.disks.iter()
        .map(|d| d.device.clone())
        .collect();
    
    // Use lsblk for reliable disk detection (same as hardware inventory)
    // -J = JSON output, -b = bytes, -o = specific fields
    let lsblk_result = Command::new("lsblk")
        .args(&["-J", "-b", "-o", "NAME,SIZE,TYPE,TRAN,MODEL,SERIAL,ROTA,RM,MOUNTPOINT,FSTYPE"])
        .output();
    
    match lsblk_result {
        Ok(output) if output.status.success() => {
            let json_str = String::from_utf8_lossy(&output.stdout);
            debug!(output = %json_str, "lsblk output for local devices");
            
            if let Ok(lsblk_data) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(blockdevices) = lsblk_data.get("blockdevices").and_then(|v| v.as_array()) {
                    for dev in blockdevices {
                        let name = dev.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let dev_type = dev.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        
                        // Only process disk devices (not partitions, loop devices, rom, etc.)
                        if dev_type != "disk" {
                            continue;
                        }
                        
                        // Skip loop, ram, dm, zram, sr (cdrom) devices
                        if name.starts_with("loop") || name.starts_with("ram") || 
                           name.starts_with("dm-") || name.starts_with("zram") ||
                           name.starts_with("sr") {
                            continue;
                        }
                        
                        let device_path = format!("/dev/{}", name);
                        
                        let size_bytes = dev.get("size")
                            .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                            .unwrap_or(0);
                        
                        // Skip very small devices (< 1GB)
                        if size_bytes < 1_000_000_000 {
                            debug!(device = %name, size = %size_bytes, "Skipping small device");
                            continue;
                        }
                        
                        // Determine device type from transport and rotational flag
                        let transport = dev.get("tran").and_then(|v| v.as_str()).unwrap_or("");
                        let is_rotational = dev.get("rota")
                            .and_then(|v| v.as_bool().or_else(|| v.as_str().map(|s| s == "1")))
                            .unwrap_or(false);
                        
                        let device_type = if name.starts_with("nvme") || transport == "nvme" {
                            "nvme"
                        } else if name.starts_with("vd") {
                            "virtio"
                        } else if transport == "sata" || transport == "ata" || name.starts_with("sd") {
                            if is_rotational { "hdd" } else { "ssd" }
                        } else if transport == "usb" {
                            "usb"
                        } else {
                            if is_rotational { "hdd" } else { "ssd" }
                        }.to_string();
                        
                        let model = dev.get("model")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .map(|s| s.trim().to_string());
                        
                        let serial = dev.get("serial")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .map(|s| s.trim().to_string());
                        
                        // Get partitions from children
                        let mut partitions = Vec::new();
                        let mut has_partitions = false;
                        
                        if let Some(children) = dev.get("children").and_then(|v| v.as_array()) {
                            for child in children {
                                let child_name = child.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                let child_type = child.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                
                                if child_type == "part" {
                                    has_partitions = true;
                                    let part_device = format!("/dev/{}", child_name);
                                    
                                    let part_size = child.get("size")
                                        .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                                        .unwrap_or(0);
                                    
                                    let mount_point = child.get("mountpoint")
                                        .and_then(|v| v.as_str())
                                        .filter(|s| !s.is_empty())
                                        .map(|s| s.to_string());
                                    
                                    let filesystem = child.get("fstype")
                                        .and_then(|v| v.as_str())
                                        .filter(|s| !s.is_empty())
                                        .map(|s| s.to_string());
                                    
                                    // Get used bytes from telemetry if mounted
                                    let used_bytes = telemetry.disks.iter()
                                        .find(|d| d.device.contains(child_name))
                                        .map(|d| d.used_bytes)
                                        .unwrap_or(0);
                                    
                                    partitions.push(LocalPartitionInfo {
                                        device: part_device,
                                        filesystem,
                                        mount_point,
                                        size_bytes: part_size,
                                        used_bytes,
                                        label: None,
                                    });
                                }
                            }
                        }
                        
                        // Check if device is in use
                        let in_use = has_partitions || mounted_devices.contains(&device_path);
                        
                        // Can only initialize if not in use
                        let can_initialize = !in_use;
                        
                        info!(
                            device = %name,
                            size_gb = size_bytes / 1_000_000_000,
                            device_type = %device_type,
                            in_use = %in_use,
                            partitions = partitions.len(),
                            "Found local storage device"
                        );
                        
                        devices.push(LocalDeviceInfo {
                            device: device_path,
                            name: name.to_string(),
                            device_type,
                            total_bytes: size_bytes,
                            in_use,
                            partitions,
                            can_initialize,
                            serial,
                            model,
                        });
                    }
                }
            } else {
                warn!("Failed to parse lsblk JSON output");
            }
        }
        Ok(output) => {
            warn!(stderr = %String::from_utf8_lossy(&output.stderr), "lsblk command failed");
        }
        Err(e) => {
            warn!(error = %e, "Failed to execute lsblk");
        }
    }
    
    // Fallback: if lsblk failed or returned empty, try /sys/block
    if devices.is_empty() {
        warn!("lsblk returned no devices, falling back to /sys/block");
        
    #[cfg(target_os = "linux")]
        if let Ok(entries) = std::fs::read_dir("/sys/block") {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                
                // Skip loop, ram, dm, zram, sr devices
                if name.starts_with("loop") || name.starts_with("ram") || 
                   name.starts_with("dm-") || name.starts_with("zram") ||
                   name.starts_with("sr") {
                    continue;
                }
                
                let device_path = format!("/dev/{}", name);
                
                // Read device size
                let size_path = entry.path().join("size");
                let size_bytes = std::fs::read_to_string(&size_path)
                    .ok()
                    .and_then(|s| s.trim().parse::<u64>().ok())
                    .map(|sectors| sectors * 512)
                    .unwrap_or(0);
                
                // Skip very small devices (< 1GB)
                if size_bytes < 1_000_000_000 {
                    continue;
                }
                
                // Determine device type
                let device_type = if name.starts_with("nvme") {
                    "nvme"
                } else if name.starts_with("vd") {
                    "virtio"
                } else if name.starts_with("sd") {
                    let rotational_path = entry.path().join("queue/rotational");
                    let is_rotational = std::fs::read_to_string(&rotational_path)
                        .ok()
                        .and_then(|s| s.trim().parse::<u8>().ok())
                        .unwrap_or(1) == 1;
                    if is_rotational { "hdd" } else { "ssd" }
                } else {
                    "unknown"
                }.to_string();
                
                // Read model name (NVMe uses different path)
                let model = if name.starts_with("nvme") {
                    // NVMe model is in /sys/block/nvme0n1/device/model
                    std::fs::read_to_string(entry.path().join("device/model"))
                    .ok()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                } else {
                    std::fs::read_to_string(entry.path().join("device/model"))
                        .ok()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                };
                
                // Read serial number
                let serial = std::fs::read_to_string(entry.path().join("device/serial"))
                    .ok()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                
                // Check for partitions in /sys/block/{name}/{name}*
                let mut partitions = Vec::new();
                if let Ok(children) = std::fs::read_dir(&entry.path()) {
                    for child in children.flatten() {
                        let child_name = child.file_name().to_string_lossy().to_string();
                        if child_name.starts_with(&name) && child_name != name {
                            let part_device = format!("/dev/{}", child_name);
                            let part_size_path = child.path().join("size");
                        let part_size = std::fs::read_to_string(&part_size_path)
                            .ok()
                            .and_then(|s| s.trim().parse::<u64>().ok())
                            .map(|sectors| sectors * 512)
                            .unwrap_or(0);
                        
                        partitions.push(LocalPartitionInfo {
                            device: part_device,
                                filesystem: None,
                                mount_point: None,
                            size_bytes: part_size,
                                used_bytes: 0,
                            label: None,
                        });
                        }
                    }
                }
                
                let has_partitions = !partitions.is_empty();
                let in_use = has_partitions || mounted_devices.contains(&device_path);
                let can_initialize = !in_use;
                
                let display_name = model.clone()
                    .unwrap_or_else(|| format!("{} {}", device_type.to_uppercase(), name));
                
                info!(
                    device = %name,
                    size_gb = size_bytes / 1_000_000_000,
                    device_type = %device_type,
                    in_use = %in_use,
                    "Found device via /sys/block fallback"
                );
                
                devices.push(LocalDeviceInfo {
                    device: device_path,
                    name: display_name,
                    device_type,
                    total_bytes: size_bytes,
                    in_use,
                    partitions,
                    can_initialize,
                    serial,
                    model,
                });
            }
        }
    }
    
    // On non-Linux, return empty list (or could use other methods)
    #[cfg(not(target_os = "linux"))]
    {
        warn!("Local device discovery not supported on this platform");
    }
    
    // Sort by device path
    devices.sort_by(|a: &LocalDeviceInfo, b: &LocalDeviceInfo| a.device.cmp(&b.device));
    
    info!(count = devices.len(), "Found local storage devices");
    
    Ok(Json(LocalDeviceListResponse { devices }))
}

/// Get filesystem type for a device using blkid
#[cfg(target_os = "linux")]
#[allow(dead_code)] // May be useful for future storage operations
fn get_filesystem_type(device: &str) -> Option<String> {
    std::process::Command::new("blkid")
        .args(["-o", "value", "-s", "TYPE", device])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(not(target_os = "linux"))]
fn get_filesystem_type(_device: &str) -> Option<String> {
    None
}

/// POST /api/v1/storage/local-devices/:device/initialize - Initialize a device as a qDV
async fn initialize_local_device(
    State(state): State<Arc<AppState>>,
    Path(device): Path<String>,
    Json(request): Json<InitializeDeviceRequest>,
) -> Result<Json<InitializeDeviceResponse>, (StatusCode, Json<ApiError>)> {
    use crate::event_store::{emit_event, Event, EventLevel};
    
    // URL decode the device path (e.g., %2Fdev%2Fnvme0n1 -> /dev/nvme0n1)
    let device_path = urlencoding::decode(&device)
        .map(|s| s.to_string())
        .unwrap_or(device);
    
    info!(
        device = %device_path,
        pool_name = %request.pool_name,
        filesystem = ?request.filesystem,
        "Initializing local device as qDV"
    );
    
    // Safety check
    if !request.confirm_wipe {
        return Ok(Json(InitializeDeviceResponse {
            success: false,
            pool_id: None,
            message: "Must confirm data wipe by setting confirmWipe to true".to_string(),
        }));
    }
    
    // Validate device exists
    #[cfg(target_os = "linux")]
    {
        if !std::path::Path::new(&device_path).exists() {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ApiError::new("device_not_found", &format!("Device {} not found", device_path))),
            ));
        }
    }
    
    // Check if device is in use (mounted)
    let telemetry = state.service.get_telemetry();
    let is_mounted = telemetry.disks.iter()
        .any(|d| d.device.contains(&device_path) || device_path.contains(&d.device));
    
    if is_mounted {
        return Ok(Json(InitializeDeviceResponse {
            success: false,
            pool_id: None,
            message: "Device is currently mounted. Unmount all partitions first.".to_string(),
        }));
    }
    
    // Emit event
    emit_event(Event::storage_event(
        EventLevel::Info,
        &device_path,
        format!("Initializing device {} as storage pool '{}'", device_path, request.pool_name),
    ));
    
    // Create filesystem and storage pool
    #[cfg(target_os = "linux")]
    {
        let fs_type = request.filesystem.as_deref().unwrap_or("xfs");
        
        // Create partition table and single partition
        let parted_result = tokio::process::Command::new("parted")
            .args(["-s", &device_path, "mklabel", "gpt", "mkpart", "primary", fs_type, "0%", "100%"])
            .output()
            .await;
        
        if let Err(e) = parted_result {
            error!(error = %e, "Failed to create partition");
            emit_event(Event::storage_event(
                EventLevel::Error,
                &device_path,
                format!("Failed to create partition on {}: {}", device_path, e),
            ));
            return Ok(Json(InitializeDeviceResponse {
                success: false,
                pool_id: None,
                message: format!("Failed to create partition: {}", e),
            }));
        }
        
        // Wait for partition to appear
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        
        // Determine partition device name
        let partition_device = if device_path.contains("nvme") {
            format!("{}p1", device_path)
        } else {
            format!("{}1", device_path)
        };
        
        // Format the partition
        let mkfs_cmd = match fs_type {
            "ext4" => "mkfs.ext4",
            "xfs" => "mkfs.xfs",
            _ => "mkfs.xfs",
        };
        
        let mkfs_result = tokio::process::Command::new(mkfs_cmd)
            .args(["-f", &partition_device])
            .output()
            .await;
        
        if let Err(e) = mkfs_result {
            error!(error = %e, "Failed to format partition");
            emit_event(Event::storage_event(
                EventLevel::Error,
                &device_path,
                format!("Failed to format {}: {}", partition_device, e),
            ));
            return Ok(Json(InitializeDeviceResponse {
                success: false,
                pool_id: None,
                message: format!("Failed to format partition: {}", e),
            }));
        }
        
        // Create mount point
        let mount_point = format!("/var/lib/limiquantix/storage/{}", request.pool_name);
        if let Err(e) = std::fs::create_dir_all(&mount_point) {
            error!(error = %e, "Failed to create mount point");
            return Ok(Json(InitializeDeviceResponse {
                success: false,
                pool_id: None,
                message: format!("Failed to create mount point: {}", e),
            }));
        }
        
        // Mount the filesystem
        let mount_result = tokio::process::Command::new("mount")
            .args([&partition_device, &mount_point])
            .output()
            .await;
        
        if let Err(e) = mount_result {
            error!(error = %e, "Failed to mount filesystem");
            return Ok(Json(InitializeDeviceResponse {
                success: false,
                pool_id: None,
                message: format!("Failed to mount filesystem: {}", e),
            }));
        }
        
        // Add to fstab for persistence
        let fstab_entry = format!("{} {} {} defaults 0 2\n", partition_device, mount_point, fs_type);
        if let Err(e) = std::fs::OpenOptions::new()
            .append(true)
            .open("/etc/fstab")
            .and_then(|mut f| std::io::Write::write_all(&mut f, fstab_entry.as_bytes()))
        {
            warn!(error = %e, "Failed to add fstab entry (mount will not persist across reboots)");
        }
        
        // Create storage pool in limiquantix
        let pool_id = format!("local-{}", uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("pool"));
        
        use tonic::Request;
        use limiquantix_proto::{NodeDaemonService, InitStoragePoolRequest, StoragePoolType, StoragePoolConfig, LocalDirPoolConfig};
        
        let init_request = InitStoragePoolRequest {
            pool_id: pool_id.clone(),
            r#type: StoragePoolType::LocalDir as i32,
            config: Some(StoragePoolConfig {
                local: Some(LocalDirPoolConfig {
                    path: mount_point.clone(),
                    capacity_gib: None, // Use full disk capacity
                }),
                nfs: None,
                ceph: None,
                iscsi: None,
            }),
        };
        
        match state.service.init_storage_pool(Request::new(init_request)).await {
            Ok(_) => {
                emit_event(Event::storage_event(
                    EventLevel::Info,
                    &pool_id,
                    format!("Storage pool '{}' created successfully from {}", request.pool_name, device_path),
                ));
                
                info!(
                    pool_id = %pool_id,
                    device = %device_path,
                    mount_point = %mount_point,
                    "Local device initialized as qDV"
                );
                
                Ok(Json(InitializeDeviceResponse {
                    success: true,
                    pool_id: Some(pool_id),
                    message: format!("Device {} initialized as storage pool '{}'", device_path, request.pool_name),
                }))
            }
            Err(e) => {
                error!(error = %e, "Failed to create storage pool");
                emit_event(Event::storage_event(
                    EventLevel::Error,
                    &device_path,
                    format!("Failed to create storage pool: {}", e.message()),
                ));
                Ok(Json(InitializeDeviceResponse {
                    success: false,
                    pool_id: None,
                    message: format!("Failed to create storage pool: {}", e.message()),
                }))
            }
        }
    }
    
    #[cfg(not(target_os = "linux"))]
    {
        Ok(Json(InitializeDeviceResponse {
            success: false,
            pool_id: None,
            message: "Device initialization not supported on this platform".to_string(),
        }))
    }
}

// ============================================================================
// Disk Conversion Handlers (VMDK to QCOW2)
// ============================================================================

/// Request body for disk format conversion
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConvertDiskRequest {
    /// Source file path (VMDK)
    source_path: String,
    /// Destination file path (QCOW2)
    dest_path: String,
    /// Source format (e.g., "vmdk", "raw")
    source_format: Option<String>,
    /// Destination format (e.g., "qcow2", "raw")
    dest_format: Option<String>,
}

/// Response for disk conversion job
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvertDiskResponse {
    /// Job ID for tracking progress
    job_id: String,
    /// Status message
    message: String,
    /// Source path
    source_path: String,
    /// Destination path
    dest_path: String,
}

/// Status of a disk conversion job
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConversionStatusResponse {
    /// Job ID
    job_id: String,
    /// Current status: "pending", "running", "completed", "failed"
    status: String,
    /// Progress percentage (0-100)
    progress_percent: u32,
    /// Source path
    source_path: String,
    /// Destination path
    dest_path: String,
    /// Error message if failed
    error_message: Option<String>,
    /// Completion time if finished
    completed_at: Option<String>,
}

/// Thread-safe storage for conversion jobs
static CONVERSION_JOBS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, ConversionJob>>> = std::sync::OnceLock::new();

fn get_conversion_jobs() -> &'static std::sync::Mutex<std::collections::HashMap<String, ConversionJob>> {
    CONVERSION_JOBS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

#[derive(Debug, Clone)]
#[allow(dead_code)] // Fields used for job tracking
struct ConversionJob {
    job_id: String,
    source_path: String,
    dest_path: String,
    source_format: String,
    dest_format: String,
    status: String,
    progress_percent: u32,
    error_message: Option<String>,
    started_at: std::time::Instant,
    completed_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Query parameters for image upload
#[derive(Debug, Deserialize, Default)]
struct UploadImageParams {
    /// Storage pool ID - if provided, uploads to the pool's mount path
    pool_id: Option<String>,
    /// Subdirectory within the pool (default: "iso")
    subdir: Option<String>,
    /// Virtual folder path for organization (e.g., "/windows/10")
    folder: Option<String>,
}

/// POST /api/v1/storage/upload - Upload a disk image or ISO
/// 
/// Query parameters:
/// - pool_id: Optional storage pool ID to upload to (uses pool's mount path)
/// - subdir: Optional subdirectory within the pool (e.g., "iso" or "images")
async fn upload_image(
    State(state): State<Arc<AppState>>,
    Query(params): Query<UploadImageParams>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    use tokio::fs;
    use tokio::io::AsyncWriteExt;
    
    info!(
        pool_id = ?params.pool_id,
        subdir = ?params.subdir,
        "🔼 Upload request received"
    );
    
    // Determine upload directory based on pool_id
    let upload_dir: std::path::PathBuf = if let Some(pool_id) = &params.pool_id {
        // Look up the pool's mount path (try cache first, then discover from mounts)
        match state.storage.get_pool_info_or_discover(pool_id).await {
            Ok(pool_info) => {
                if let Some(mount_path) = &pool_info.mount_path {
                    let base_path = std::path::PathBuf::from(mount_path);
                    // Optionally add subdirectory (e.g., "iso")
                    let subdir = params.subdir.as_deref().unwrap_or("iso");
                    info!(
                        pool_id = %pool_id,
                        mount_path = %mount_path,
                        subdir = %subdir,
                        "Using storage pool for upload"
                    );
                    base_path.join(subdir)
    } else {
                    warn!(pool_id = %pool_id, "Pool has no mount path, using default directory");
                    if std::path::Path::new("/data").exists() {
                        std::path::PathBuf::from("/data/images")
                    } else {
                        std::path::PathBuf::from("/var/lib/limiquantix/images")
                    }
                }
            }
            Err(e) => {
                warn!(pool_id = %pool_id, error = %e, "Pool not found, falling back to default directory");
                // Fall back to default if pool not found
                if std::path::Path::new("/data").exists() {
                    std::path::PathBuf::from("/data/images")
                } else {
                    std::path::PathBuf::from("/var/lib/limiquantix/images")
                }
            }
        }
    } else {
        // No pool_id specified - use default directory
        if std::path::Path::new("/data").exists() {
            std::path::PathBuf::from("/data/images")
        } else {
            std::path::PathBuf::from("/var/lib/limiquantix/images")
        }
    };
    
    info!(upload_dir = %upload_dir.display(), pool_id = ?params.pool_id, "Image upload directory");
    
    if let Err(e) = fs::create_dir_all(&upload_dir).await {
        error!(error = %e, path = %upload_dir.display(), "Failed to create upload directory");
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("create_dir_failed", &format!("Failed to create upload directory {}: {}", upload_dir.display(), e))),
        ));
    }
    
    let mut saved_file = String::new();
    let mut file_size: u64 = 0;
    
    while let Ok(Some(field)) = multipart.next_field().await {
        let file_name = if let Some(name) = field.file_name() {
            name.to_string()
        } else {
            warn!("Multipart field without filename, skipping");
            continue;
        };
        
        info!(file_name = %file_name, "Processing upload");
        
        let dest_path = upload_dir.join(&file_name);
        saved_file = file_name.clone();
        
        info!(dest_path = %dest_path.display(), "Creating file for upload");
        
        // Stream the file to disk
        // Note: For large files, this needs careful memory management, 
        // but simple streaming copy is generally okay.
        
        // We need to create the file...
        let mut file = match fs::File::create(&dest_path).await {
            Ok(f) => f,
            Err(e) => {
                error!(error = %e, path = %dest_path.display(), "Failed to create destination file");
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiError::new("file_create_failed", &format!("Failed to create file {}: {}", dest_path.display(), e))),
                ));
            }
        };
        
        // Read chunks and write
        // field is a stream
        let mut field = field; // rebind mut
        let mut bytes_written: u64 = 0;
        while let Ok(Some(chunk)) = field.chunk().await {
            bytes_written += chunk.len() as u64;
            if let Err(e) = file.write_all(&chunk).await {
                error!(error = %e, bytes_written = bytes_written, "Failed to write chunk");
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiError::new("write_failed", &e.to_string())),
                ));
            }
        }
        
        file_size = bytes_written;
        info!(
            file = %file_name, 
            size_bytes = bytes_written,
            size_mb = bytes_written / (1024 * 1024),
            path = %dest_path.display(),
            "Image uploaded successfully"
        );
        
        // Emit event for image upload
        crate::event_store::emit_event(crate::event_store::Event::new(
            crate::event_store::EventLevel::Info,
            crate::event_store::EventCategory::Storage,
            format!("Image '{}' uploaded ({:.2} MB)", file_name, bytes_written as f64 / (1024.0 * 1024.0)),
            "storage",
        ));
    }
    
    if saved_file.is_empty() {
        warn!("Upload request completed but no file was saved");
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiError::new("no_file", "No file provided in request. Make sure to include a 'file' field in the multipart form.")),
        ));
    }

    let final_path = upload_dir.join(&saved_file);
    
    // Register with ISO manager if it's an ISO/IMG file
    let iso_metadata = if saved_file.ends_with(".iso") || saved_file.ends_with(".img") {
        let folder_path = params.folder.as_deref().unwrap_or("/");
        match crate::iso_manager::IsoMetadata::from_file(&final_path, folder_path, params.pool_id.clone()) {
            Ok(mut iso) => {
                iso = state.iso_manager.upsert(iso).await;
                
                // Save metadata to disk
                if let Err(e) = state.iso_manager.save().await {
                    warn!(error = %e, "Failed to save ISO metadata");
                }
                
                // Notify control plane (async, don't block upload response)
                let iso_clone = iso.clone();
                let manager_clone = state.iso_manager.clone();
                tokio::spawn(async move {
                    if let Err(e) = manager_clone.notify_change("created", &iso_clone).await {
                        warn!(error = %e, "Failed to notify control plane of new ISO");
                    }
                });
                
                Some(iso)
            }
            Err(e) => {
                warn!(error = %e, "Failed to create ISO metadata (file uploaded but not registered)");
                None
            }
        }
    } else {
        None
    };

    let mut response = serde_json::json!({
        "success": true,
        "message": "Image uploaded successfully",
        "filename": saved_file,
        "size_bytes": file_size,
        "path": final_path.to_string_lossy()
    });
    
    if let Some(iso) = iso_metadata {
        response["iso"] = serde_json::json!({
            "id": iso.id,
            "name": iso.name,
            "folder_path": iso.folder_path,
            "full_path": iso.get_full_path()
        });
    }
    
    Ok(Json(response))
}

/// POST /api/v1/storage/convert - Start disk format conversion
async fn convert_disk_format(
    State(_state): State<Arc<AppState>>,
    Json(request): Json<ConvertDiskRequest>,
) -> Result<Json<ConvertDiskResponse>, (StatusCode, Json<ApiError>)> {
    use std::process::Command;
    use uuid::Uuid;
    
    info!(
        source = %request.source_path,
        dest = %request.dest_path,
        "Starting disk format conversion"
    );
    
    // Validate source file exists
    if !std::path::Path::new(&request.source_path).exists() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiError::new("source_not_found", "Source file does not exist")),
        ));
    }
    
    // Determine formats
    let source_format = request.source_format.unwrap_or_else(|| {
        if request.source_path.ends_with(".vmdk") {
            "vmdk".to_string()
        } else if request.source_path.ends_with(".raw") {
            "raw".to_string()
        } else if request.source_path.ends_with(".qcow2") {
            "qcow2".to_string()
        } else {
            "vmdk".to_string() // Default assumption for OVA
        }
    });
    
    let dest_format = request.dest_format.unwrap_or_else(|| "qcow2".to_string());
    
    // Create job
    let job_id = Uuid::new_v4().to_string();
    let job = ConversionJob {
        job_id: job_id.clone(),
        source_path: request.source_path.clone(),
        dest_path: request.dest_path.clone(),
        source_format: source_format.clone(),
        dest_format: dest_format.clone(),
        status: "pending".to_string(),
        progress_percent: 0,
        error_message: None,
        started_at: std::time::Instant::now(),
        completed_at: None,
    };
    
    // Store job
    {
        let mut jobs = get_conversion_jobs().lock().unwrap();
        jobs.insert(job_id.clone(), job);
    }
    
    // Spawn async conversion task
    let job_id_clone = job_id.clone();
    let source_path = request.source_path.clone();
    let dest_path = request.dest_path.clone();
    
    tokio::spawn(async move {
        // Update status to running
        {
            let mut jobs = get_conversion_jobs().lock().unwrap();
            if let Some(job) = jobs.get_mut(&job_id_clone) {
                job.status = "running".to_string();
                job.progress_percent = 10;
            }
        }
        
        // Ensure destination directory exists
        if let Some(parent) = std::path::Path::new(&dest_path).parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                error!(error = %e, "Failed to create destination directory");
                let mut jobs = get_conversion_jobs().lock().unwrap();
                if let Some(job) = jobs.get_mut(&job_id_clone) {
                    job.status = "failed".to_string();
                    job.error_message = Some(format!("Failed to create directory: {}", e));
                    job.completed_at = Some(chrono::Utc::now());
                }
                return;
            }
        }
        
        // Run qemu-img convert
        info!(
            job_id = %job_id_clone,
            source = %source_path,
            dest = %dest_path,
            source_format = %source_format,
            dest_format = %dest_format,
            "Running qemu-img convert"
        );
        
        let output = Command::new("qemu-img")
            .args(&[
                "convert",
                "-f", &source_format,
                "-O", &dest_format,
                "-p",  // Show progress (though we can't capture it easily)
                &source_path,
                &dest_path,
            ])
            .output();
        
        match output {
            Ok(result) => {
                let mut jobs = get_conversion_jobs().lock().unwrap();
                if let Some(job) = jobs.get_mut(&job_id_clone) {
                    if result.status.success() {
                        info!(job_id = %job_id_clone, "Disk conversion completed successfully");
                        job.status = "completed".to_string();
                        job.progress_percent = 100;
                        job.completed_at = Some(chrono::Utc::now());
                    } else {
                        let stderr = String::from_utf8_lossy(&result.stderr);
                        error!(job_id = %job_id_clone, error = %stderr, "Disk conversion failed");
                        job.status = "failed".to_string();
                        job.error_message = Some(stderr.to_string());
                        job.completed_at = Some(chrono::Utc::now());
                    }
                }
            }
            Err(e) => {
                error!(job_id = %job_id_clone, error = %e, "Failed to execute qemu-img");
                let mut jobs = get_conversion_jobs().lock().unwrap();
                if let Some(job) = jobs.get_mut(&job_id_clone) {
                    job.status = "failed".to_string();
                    job.error_message = Some(format!("Failed to execute qemu-img: {}", e));
                    job.completed_at = Some(chrono::Utc::now());
                }
            }
        }
    });
    
    Ok(Json(ConvertDiskResponse {
        job_id,
        message: "Conversion started".to_string(),
        source_path: request.source_path,
        dest_path: request.dest_path,
    }))
}

/// GET /api/v1/storage/convert/:job_id - Get conversion job status
async fn get_conversion_status(
    Path(job_id): Path<String>,
) -> Result<Json<ConversionStatusResponse>, (StatusCode, Json<ApiError>)> {
    let jobs = get_conversion_jobs().lock().unwrap();
    
    match jobs.get(&job_id) {
        Some(job) => {
            Ok(Json(ConversionStatusResponse {
                job_id: job.job_id.clone(),
                status: job.status.clone(),
                progress_percent: job.progress_percent,
                source_path: job.source_path.clone(),
                dest_path: job.dest_path.clone(),
                error_message: job.error_message.clone(),
                completed_at: job.completed_at.map(|t| t.to_rfc3339()),
            }))
        }
        None => {
            Err((
                StatusCode::NOT_FOUND,
                Json(ApiError::new("job_not_found", "Conversion job not found")),
            ))
        }
    }
}

// ============================================================================
// ISO Management Handlers
// ============================================================================

/// GET /api/v1/images - List all tracked ISOs
async fn list_isos(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ListIsosParams>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    let isos = if let Some(folder) = params.folder {
        let include_subfolders = params.include_subfolders.unwrap_or(false);
        state.iso_manager.list_by_folder(&folder, include_subfolders).await
    } else {
        state.iso_manager.list().await
    };
    
    Ok(Json(serde_json::json!({
        "images": isos,
        "count": isos.len()
    })))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ListIsosParams {
    folder: Option<String>,
    include_subfolders: Option<bool>,
}

/// GET /api/v1/images/:id - Get a specific ISO
async fn get_iso(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<crate::iso_manager::IsoMetadata>, (StatusCode, Json<ApiError>)> {
    match state.iso_manager.get(&id).await {
        Some(iso) => Ok(Json(iso)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "ISO not found")),
        )),
    }
}

/// POST /api/v1/images/:id/move - Move an ISO to a different folder
async fn move_iso_to_folder(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<MoveIsoRequest>,
) -> Result<Json<crate::iso_manager::IsoMetadata>, (StatusCode, Json<ApiError>)> {
    match state.iso_manager.move_to_folder(&id, &request.folder_path).await {
        Ok(iso) => {
            // Save metadata
            if let Err(e) = state.iso_manager.save().await {
                warn!(error = %e, "Failed to save ISO metadata after move");
            }
            
            // Notify control plane
            let iso_clone = iso.clone();
            let manager_clone = state.iso_manager.clone();
            tokio::spawn(async move {
                if let Err(e) = manager_clone.notify_change("updated", &iso_clone).await {
                    warn!(error = %e, "Failed to notify control plane of ISO move");
                }
            });
            
            Ok(Json(iso))
        }
        Err(e) => {
            if e.to_string().contains("not found") {
                Err((
                    StatusCode::NOT_FOUND,
                    Json(ApiError::new("not_found", "ISO not found")),
                ))
            } else {
                Err((
                    StatusCode::BAD_REQUEST,
                    Json(ApiError::new("invalid_folder", &e.to_string())),
                ))
            }
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveIsoRequest {
    folder_path: String,
}

/// DELETE /api/v1/images/:id - Delete an ISO and its file
async fn delete_iso(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    // Get ISO metadata first
    let iso = match state.iso_manager.get(&id).await {
        Some(iso) => iso,
        None => return Err((
            StatusCode::NOT_FOUND,
            Json(ApiError::new("not_found", "ISO not found")),
        )),
    };
    
    // Delete the file
    let path = std::path::Path::new(&iso.path);
    if path.exists() {
        if let Err(e) = tokio::fs::remove_file(path).await {
            warn!(error = %e, path = %iso.path, "Failed to delete ISO file");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("delete_failed", &format!("Failed to delete file: {}", e))),
            ));
        }
    }
    
    // Store path for logging before moving iso
    let iso_path = iso.path.clone();
    
    // Remove from manager
    state.iso_manager.remove(&id).await;
    
    // Save metadata
    if let Err(e) = state.iso_manager.save().await {
        warn!(error = %e, "Failed to save ISO metadata after delete");
    }
    
    // Notify control plane
    let manager_clone = state.iso_manager.clone();
    tokio::spawn(async move {
        if let Err(e) = manager_clone.notify_change("deleted", &iso).await {
            warn!(error = %e, "Failed to notify control plane of ISO delete");
        }
    });
    
    info!(id = %id, path = %iso_path, "ISO deleted");
    
    Ok(Json(serde_json::json!({
        "success": true,
        "message": "ISO deleted successfully"
    })))
}

/// GET /api/v1/images/folders - List all folder paths
async fn list_iso_folders(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    let folders = state.iso_manager.list_folders().await;
    
    Ok(Json(serde_json::json!({
        "folders": folders
    })))
}

/// POST /api/v1/images/scan - Scan default directories for ISOs
async fn scan_iso_directories(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    match state.iso_manager.scan_directories().await {
        Ok(result) => {
            info!(
                registered = result.registered,
                existing = result.existing,
                errors = result.errors.len(),
                "ISO directory scan completed"
            );
            
            // Sync new ISOs to control plane
            if result.registered > 0 {
                let manager_clone = state.iso_manager.clone();
                tokio::spawn(async move {
                    if let Err(e) = manager_clone.sync_all().await {
                        warn!(error = %e, "Failed to sync ISOs after scan");
                    }
                });
            }
            
            Ok(Json(serde_json::json!({
                "success": true,
                "registered": result.registered,
                "existing": result.existing,
                "errors": result.errors
            })))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("scan_failed", &e.to_string())),
        )),
    }
}

/// POST /api/v1/images/sync - Sync all ISOs to control plane
async fn sync_isos_to_control_plane(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ApiError>)> {
    match state.iso_manager.sync_all().await {
        Ok(count) => Ok(Json(serde_json::json!({
            "success": true,
            "synced": count
        }))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiError::new("sync_failed", &e.to_string())),
        )),
    }
}

// ============================================================================
// Cloud Image Download Handlers
// ============================================================================

/// Cloud image download job state
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJob {
    pub job_id: String,
    pub image_id: String,
    pub catalog_id: String,
    pub url: String,
    pub target_path: String,
    pub pool_id: Option<String>,
    pub status: String,  // pending, downloading, completed, failed
    pub progress_percent: u32,
    pub bytes_downloaded: u64,
    pub bytes_total: u64,
    pub error_message: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

/// Global storage for download jobs (keyed by job_id)
static DOWNLOAD_JOBS: Lazy<Mutex<HashMap<String, DownloadJob>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn get_download_jobs() -> &'static Mutex<HashMap<String, DownloadJob>> {
    &DOWNLOAD_JOBS
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadCloudImageRequest {
    /// Catalog ID (e.g., "ubuntu-22.04") - optional, used for tracking
    catalog_id: Option<String>,
    /// Image ID from the control plane
    image_id: String,
    /// URL to download the image from
    url: String,
    /// Target directory to save the image (e.g., NFS mount path)
    target_dir: String,
    /// Target filename (optional, derived from URL if not provided)
    filename: Option<String>,
    /// Storage pool ID (for tracking)
    pool_id: Option<String>,
    /// Expected checksum (SHA256) for verification
    checksum: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadCloudImageResponse {
    job_id: String,
    image_id: String,
    target_path: String,
    message: String,
}

/// POST /api/v1/images/download - Download a cloud image from URL to local storage
///
/// This endpoint is called by the vDC control plane to download cloud images
/// directly to a storage pool on this node.
async fn download_cloud_image(
    State(state): State<Arc<AppState>>,
    Json(request): Json<DownloadCloudImageRequest>,
) -> Result<Json<DownloadCloudImageResponse>, (StatusCode, Json<ApiError>)> {
    use tokio::fs;
    
    info!(
        url = %request.url,
        target_dir = %request.target_dir,
        image_id = %request.image_id,
        "Starting cloud image download"
    );
    
    // Validate target directory exists
    if !std::path::Path::new(&request.target_dir).exists() {
        // Try to create it
        if let Err(e) = fs::create_dir_all(&request.target_dir).await {
            error!(target_dir = %request.target_dir, error = %e, "Failed to create target directory");
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiError::new("invalid_target", &format!("Target directory does not exist and cannot be created: {}", e))),
            ));
        }
    }
    
    // Determine filename
    let filename = request.filename.clone().unwrap_or_else(|| {
        // Try to extract filename from URL
        request.url
            .split('/')
            .last()
            .unwrap_or("downloaded-image.qcow2")
            .split('?')
            .next()
            .unwrap_or("downloaded-image.qcow2")
            .to_string()
    });
    
    // Ensure .qcow2 extension for cloud images
    let filename = if filename.ends_with(".img") && !filename.ends_with(".qcow2") {
        // Many cloud images have .img extension but are qcow2 format
        filename.replace(".img", ".qcow2")
    } else if !filename.ends_with(".qcow2") && !filename.ends_with(".img") {
        format!("{}.qcow2", filename)
    } else {
        filename
    };
    
    let target_path = format!("{}/{}", request.target_dir.trim_end_matches('/'), filename);
    
    // Check if file already exists
    if std::path::Path::new(&target_path).exists() {
        return Err((
            StatusCode::CONFLICT,
            Json(ApiError::new("already_exists", &format!("Image already exists at {}", target_path))),
        ));
    }
    
    // Create download job
    let job_id = uuid::Uuid::new_v4().to_string();
    let job = DownloadJob {
        job_id: job_id.clone(),
        image_id: request.image_id.clone(),
        catalog_id: request.catalog_id.clone().unwrap_or_default(),
        url: request.url.clone(),
        target_path: target_path.clone(),
        pool_id: request.pool_id.clone(),
        status: "pending".to_string(),
        progress_percent: 0,
        bytes_downloaded: 0,
        bytes_total: 0,
        error_message: None,
        started_at: chrono::Utc::now().to_rfc3339(),
        completed_at: None,
    };
    
    {
        let mut jobs = get_download_jobs().lock().unwrap();
        jobs.insert(job_id.clone(), job);
    }
    
    // Spawn download task
    let url = request.url.clone();
    let target = target_path.clone();
    let job_id_clone = job_id.clone();
    let checksum = request.checksum.clone();
    let iso_manager = state.iso_manager.clone();
    let pool_id = request.pool_id.clone();
    
    tokio::spawn(async move {
        run_download(job_id_clone, url, target, checksum, iso_manager, pool_id).await;
    });
    
    info!(job_id = %job_id, target_path = %target_path, "Download job created");
    
    Ok(Json(DownloadCloudImageResponse {
        job_id,
        image_id: request.image_id,
        target_path,
        message: "Download started".to_string(),
    }))
}

/// Run the actual download in a background task
async fn run_download(
    job_id: String,
    url: String,
    target_path: String,
    checksum: Option<String>,
    iso_manager: Arc<crate::iso_manager::IsoManager>,
    pool_id: Option<String>,
) {
    use tokio::fs::File;
    
    // Update status to downloading
    {
        let mut jobs = get_download_jobs().lock().unwrap();
        if let Some(job) = jobs.get_mut(&job_id) {
            job.status = "downloading".to_string();
        }
    }
    
    info!(job_id = %job_id, url = %url, target = %target_path, "Starting download");
    
    // Create HTTP client
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600)) // 1 hour timeout for large images
        .build();
    
    let client = match client {
        Ok(c) => c,
        Err(e) => {
            error!(job_id = %job_id, error = %e, "Failed to create HTTP client");
            update_job_failed(&job_id, &format!("Failed to create HTTP client: {}", e));
            return;
        }
    };
    
    // Make request
    let response = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            error!(job_id = %job_id, error = %e, "Failed to start download");
            update_job_failed(&job_id, &format!("Failed to start download: {}", e));
            return;
        }
    };
    
    if !response.status().is_success() {
        let status = response.status();
        error!(job_id = %job_id, status = %status, "HTTP error during download");
        update_job_failed(&job_id, &format!("HTTP error: {}", status));
        return;
    }
    
    // Get content length
    let total_bytes = response.content_length().unwrap_or(0);
    {
        let mut jobs = get_download_jobs().lock().unwrap();
        if let Some(job) = jobs.get_mut(&job_id) {
            job.bytes_total = total_bytes;
        }
    }
    
    // Create target file
    let mut file = match File::create(&target_path).await {
        Ok(f) => f,
        Err(e) => {
            error!(job_id = %job_id, path = %target_path, error = %e, "Failed to create file");
            update_job_failed(&job_id, &format!("Failed to create file: {}", e));
            return;
        }
    };
    
    // Download with progress
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut last_update = std::time::Instant::now();
    
    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                if let Err(e) = file.write_all(&chunk).await {
                    error!(job_id = %job_id, error = %e, "Failed to write chunk");
                    // Clean up partial file
                    let _ = tokio::fs::remove_file(&target_path).await;
                    update_job_failed(&job_id, &format!("Failed to write to file: {}", e));
                    return;
                }
                
                downloaded += chunk.len() as u64;
                
                // Update progress every second
                if last_update.elapsed() >= std::time::Duration::from_secs(1) {
                    let percent = if total_bytes > 0 {
                        (downloaded * 100 / total_bytes) as u32
                    } else {
                        0
                    };
                    
                    {
                        let mut jobs = get_download_jobs().lock().unwrap();
                        if let Some(job) = jobs.get_mut(&job_id) {
                            job.bytes_downloaded = downloaded;
                            job.progress_percent = percent;
                        }
                    }
                    
                    debug!(
                        job_id = %job_id,
                        downloaded = downloaded,
                        total = total_bytes,
                        percent = percent,
                        "Download progress"
                    );
                    
                    last_update = std::time::Instant::now();
                }
            }
            Err(e) => {
                error!(job_id = %job_id, error = %e, "Error reading chunk");
                // Clean up partial file
                let _ = tokio::fs::remove_file(&target_path).await;
                update_job_failed(&job_id, &format!("Download error: {}", e));
                return;
            }
        }
    }
    
    // Flush file
    if let Err(e) = file.flush().await {
        error!(job_id = %job_id, error = %e, "Failed to flush file");
        let _ = tokio::fs::remove_file(&target_path).await;
        update_job_failed(&job_id, &format!("Failed to flush file: {}", e));
        return;
    }
    drop(file);
    
    // Verify checksum if provided
    if let Some(expected_checksum) = checksum {
        info!(job_id = %job_id, "Verifying checksum");
        
        // For now, skip checksum verification (would need sha256 crate)
        // TODO: Implement SHA256 verification
        debug!(job_id = %job_id, expected = %expected_checksum, "Checksum verification skipped");
    }
    
    // Update job as completed
    {
        let mut jobs = get_download_jobs().lock().unwrap();
        if let Some(job) = jobs.get_mut(&job_id) {
            job.status = "completed".to_string();
            job.bytes_downloaded = downloaded;
            job.progress_percent = 100;
            job.completed_at = Some(chrono::Utc::now().to_rfc3339());
        }
    }
    
    // Register the downloaded image with iso_manager for tracking
    let path = std::path::Path::new(&target_path);
    if let Ok(metadata) = crate::iso_manager::IsoMetadata::from_file(path, "/cloud-images", pool_id) {
        iso_manager.upsert(metadata.clone()).await;
        if let Err(e) = iso_manager.save().await {
            warn!(job_id = %job_id, error = %e, "Failed to save image metadata");
        }
        // Notify control plane
        if let Err(e) = iso_manager.notify_change("created", &metadata).await {
            warn!(job_id = %job_id, error = %e, "Failed to notify control plane");
        }
    }
    
    info!(
        job_id = %job_id,
        target = %target_path,
        size = downloaded,
        "Download completed successfully"
    );
}

fn update_job_failed(job_id: &str, message: &str) {
    let mut jobs = get_download_jobs().lock().unwrap();
    if let Some(job) = jobs.get_mut(job_id) {
        job.status = "failed".to_string();
        job.error_message = Some(message.to_string());
        job.completed_at = Some(chrono::Utc::now().to_rfc3339());
    }
}

/// GET /api/v1/images/download/:job_id - Get download job status
async fn get_download_status(
    Path(job_id): Path<String>,
) -> Result<Json<DownloadJob>, (StatusCode, Json<ApiError>)> {
    let jobs = get_download_jobs().lock().unwrap();
    
    match jobs.get(&job_id) {
        Some(job) => Ok(Json(job.clone())),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ApiError::new("job_not_found", "Download job not found")),
        )),
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
    
    // First, check the cluster marker file (written when registration completes)
    let cluster_marker_path = "/quantix/cluster.yaml";
    
    if let Ok(content) = fs::read_to_string(cluster_marker_path).await {
        // Parse the cluster marker file
        let mut control_plane = None;
        let mut node_id = None;
        let mut cluster_name = None;
        
        for line in content.lines() {
            let line = line.trim();
            if line.starts_with("control_plane:") {
                control_plane = Some(
                    line.trim_start_matches("control_plane:")
                        .trim()
                        .trim_matches('"')
                        .to_string()
                );
            } else if line.starts_with("node_id:") {
                node_id = Some(
                    line.trim_start_matches("node_id:")
                        .trim()
                        .trim_matches('"')
                        .to_string()
                );
            } else if line.starts_with("cluster_name:") {
                let name = line.trim_start_matches("cluster_name:")
                    .trim()
                    .trim_matches('"')
                    .to_string();
                if !name.is_empty() {
                    cluster_name = Some(name);
                }
            }
        }
        
        // If we have a control plane address, we're joined
        if control_plane.is_some() {
            return Ok(Json(ClusterStatus {
                joined: true,
                control_plane_address: control_plane,
                node_id,
                last_heartbeat: None, // TODO: Track heartbeats
                status: "connected".to_string(),
                mode: "cluster".to_string(),
                cluster_name,
            }));
        }
    }
    
    // Fallback: check the node config file for control_plane section
    let config_path = "/etc/limiquantix/node.yaml";
    
    if let Ok(content) = fs::read_to_string(config_path).await {
        // Check for control_plane section with a valid address
        let mut in_control_plane = false;
        let mut has_valid_address = false;
        let mut address = None;
        
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed == "control_plane:" {
                in_control_plane = true;
            } else if in_control_plane && trimmed.starts_with("address:") {
                let addr = trimmed.trim_start_matches("address:")
                    .trim()
                    .trim_matches('"')
                    .to_string();
                // Check if it's a valid (non-localhost, non-default) address
                if !addr.is_empty() 
                    && addr != "localhost" 
                    && addr != "http://localhost:8080"
                    && !addr.contains("localhost") 
                {
                    has_valid_address = true;
                    address = Some(addr);
                }
            } else if !line.starts_with(' ') && !line.starts_with('\t') && !trimmed.is_empty() {
                // New section started
                in_control_plane = false;
            }
        }
        
        if has_valid_address {
            return Ok(Json(ClusterStatus {
                joined: true,
                control_plane_address: address,
                node_id: None,
                last_heartbeat: None,
                status: "pending_restart".to_string(),
                mode: "cluster".to_string(),
                cluster_name: None,
            }));
        }
    }
    
    // Not joined to any cluster
    Ok(Json(ClusterStatus {
        joined: false,
        control_plane_address: None,
        node_id: None,
        last_heartbeat: None,
        status: "standalone".to_string(),
        mode: "standalone".to_string(),
        cluster_name: None,
    }))
}

/// Join a Quantix-vDC cluster
#[allow(dead_code)] // Reserved for alternative cluster join flow
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
                mode: "cluster".to_string(),
                cluster_name: None,
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
                        mode: "standalone".to_string(),
                        cluster_name: None,
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

/// Test connectivity to a vDC control plane
/// This allows the host UI to verify the control plane is reachable
async fn test_vdc_connection(
    Json(request): Json<TestConnectionRequest>,
) -> Result<Json<TestConnectionResponse>, (StatusCode, Json<ApiError>)> {
    info!(url = %request.control_plane_url, "Testing connection to vDC control plane");
    
    // Validate URL format
    if request.control_plane_url.is_empty() {
        return Ok(Json(TestConnectionResponse {
            success: false,
            message: "Control plane URL is required".to_string(),
            cluster_name: None,
            cluster_version: None,
        }));
    }
    
    // Try to connect to the control plane's health endpoint
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true) // Allow self-signed certs for testing
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("client_error", &e.to_string())),
            )
        })?;
    
    let health_url = format!("{}/api/v1/health", request.control_plane_url.trim_end_matches('/'));
    
    match client.get(&health_url).send().await {
        Ok(response) => {
            if response.status().is_success() {
                // Try to parse the response for cluster info
                if let Ok(data) = response.json::<serde_json::Value>().await {
                    let cluster_name = data.get("clusterName")
                        .or_else(|| data.get("cluster_name"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let cluster_version = data.get("version")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    
                    info!(url = %request.control_plane_url, "Connection to vDC successful");
                    Ok(Json(TestConnectionResponse {
                        success: true,
                        message: "Connection successful".to_string(),
                        cluster_name,
                        cluster_version,
                    }))
                } else {
                    Ok(Json(TestConnectionResponse {
                        success: true,
                        message: "Connection successful (no cluster info available)".to_string(),
                        cluster_name: None,
                        cluster_version: None,
                    }))
                }
            } else {
                Ok(Json(TestConnectionResponse {
                    success: false,
                    message: format!("Server responded with status: {}", response.status()),
                    cluster_name: None,
                    cluster_version: None,
                }))
            }
        }
        Err(e) => {
            warn!(url = %request.control_plane_url, error = %e, "Failed to connect to vDC");
            Ok(Json(TestConnectionResponse {
                success: false,
                message: format!("Connection failed: {}", e),
                cluster_name: None,
                cluster_version: None,
            }))
        }
    }
}

/// Generate a registration token for vDC to use when adding this host
/// This is the Host UI's endpoint - the token is then used in vDC to complete registration
async fn generate_cluster_registration_token(
    State(state): State<Arc<AppState>>,
) -> Result<Json<GenerateTokenResponse>, (StatusCode, Json<ApiError>)> {
    use rand::Rng;
    
    info!("Generating cluster registration token for vDC");
    
    // Generate a cryptographically secure token
    let mut rng = rand::thread_rng();
    let bytes: [u8; 16] = rng.gen();
    
    // Encode as base32 for human-readable format
    let encoded: String = bytes.iter()
        .map(|b| {
            let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
            alphabet[(b % 32) as usize] as char
        })
        .collect();
    
    // Format as QUANTIX-XXXX-XXXX-XXXX-XXXX
    let token = format!(
        "QUANTIX-{}-{}-{}-{}",
        &encoded[0..4],
        &encoded[4..8],
        &encoded[8..12],
        &encoded[12..16]
    );
    
    // Store the token with its creation time
    let now = std::time::Instant::now();
    {
        let mut storage = get_token_storage().lock().unwrap();
        *storage = Some((token.clone(), now));
    }
    
    // Get node info
    let hostname = gethostname::gethostname()
        .to_string_lossy()
        .to_string();
    
    let management_ip = state.service.get_management_ip();
    let node_id = state.service.get_node_id().to_string();
    
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(1);
    
    info!(
        token = %token,
        node_id = %node_id,
        expires_at = %expires_at,
        "Cluster registration token generated (valid for 1 hour)"
    );
    
    Ok(Json(GenerateTokenResponse {
        token,
        node_id,
        host_name: hostname,
        management_ip,
        expires_at: expires_at.to_rfc3339(),
    }))
}

// ============================================================================
// Registration Token Handlers
// ============================================================================

/// Thread-safe storage for the current registration token
static CURRENT_TOKEN: std::sync::OnceLock<std::sync::Mutex<Option<(String, std::time::Instant)>>> = std::sync::OnceLock::new();

fn get_token_storage() -> &'static std::sync::Mutex<Option<(String, std::time::Instant)>> {
    CURRENT_TOKEN.get_or_init(|| std::sync::Mutex::new(None))
}

/// Diagnostic ping endpoint for registration API (no auth required)
/// Used by vDC to verify the API is reachable before attempting token validation
async fn registration_ping(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    info!("Registration ping received");
    
    let hostname = gethostname::gethostname().to_string_lossy().to_string();
    let management_ip = state.service.get_management_ip();
    
    Json(serde_json::json!({
        "status": "ok",
        "message": "Registration API is reachable",
        "version": env!("CARGO_PKG_VERSION"),
        "apiVersion": "v1",
        "hostname": hostname,
        "managementIp": management_ip,
        "registrationApiSupported": true,
        "buildInfo": {
            "package": env!("CARGO_PKG_NAME"),
            "version": env!("CARGO_PKG_VERSION"),
            "target": std::env::consts::ARCH,
            "os": std::env::consts::OS
        },
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

/// Generate a new registration token (valid for 1 hour)
async fn generate_registration_token(
    State(state): State<Arc<AppState>>,
) -> Result<Json<RegistrationToken>, (StatusCode, Json<ApiError>)> {
    use rand::Rng;
    
    info!("Generating new registration token");
    
    // Generate a cryptographically secure token
    let mut rng = rand::thread_rng();
    let bytes: [u8; 12] = rng.gen();
    
    // Encode as base32 for human-readable format
    let encoded: String = bytes.iter()
        .map(|b| {
            let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
            alphabet[(b % 32) as usize] as char
        })
        .collect();
    
    // Format as QUANTIX-XXXX-XXXX-XXXX
    let token = format!(
        "QUANTIX-{}-{}-{}",
        &encoded[0..4],
        &encoded[4..8],
        &encoded[8..12]
    );
    
    // Store the token with its creation time
    let now = std::time::Instant::now();
    {
        let mut storage = get_token_storage().lock().unwrap();
        *storage = Some((token.clone(), now));
    }
    
    // Get hostname and IP for the response
    let hostname = gethostname::gethostname()
        .to_string_lossy()
        .to_string();
    
    let management_ip = state.service.get_management_ip();
    
    let created_at = chrono::Utc::now();
    let expires_at = created_at + chrono::Duration::hours(1);
    
    info!(
        token = %token,
        expires_at = %expires_at,
        "Registration token generated (valid for 1 hour)"
    );
    
    Ok(Json(RegistrationToken {
        token,
        created_at: created_at.to_rfc3339(),
        expires_at: expires_at.to_rfc3339(),
        expires_in_seconds: 3600,
        hostname,
        management_ip,
    }))
}

/// Get the current registration token (if still valid)
/// Requires valid Authorization: Bearer <token> header
async fn get_current_registration_token(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<RegistrationToken>, (StatusCode, Json<ApiError>)> {
    // Validate the Authorization header token
    validate_auth_header(&headers)?;
    
    let storage = get_token_storage().lock().unwrap();
    
    match &*storage {
        Some((token, created_at)) => {
            let elapsed = created_at.elapsed();
            let expiry_duration = std::time::Duration::from_secs(3600); // 1 hour
            
            if elapsed >= expiry_duration {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(ApiError::new("token_expired", "Registration token has expired. Generate a new one.")),
                ));
            }
            
            let remaining_secs = (expiry_duration - elapsed).as_secs();
            let hostname = gethostname::gethostname().to_string_lossy().to_string();
            let management_ip = state.service.get_management_ip();
            
            let created_chrono = chrono::Utc::now() - chrono::Duration::seconds(elapsed.as_secs() as i64);
            let expires_chrono = created_chrono + chrono::Duration::hours(1);
            
            Ok(Json(RegistrationToken {
                token: token.clone(),
                created_at: created_chrono.to_rfc3339(),
                expires_at: expires_chrono.to_rfc3339(),
                expires_in_seconds: remaining_secs,
                hostname,
                management_ip,
            }))
        }
        None => {
            Err((
                StatusCode::NOT_FOUND,
                Json(ApiError::new("no_token", "No registration token exists. Generate one first.")),
            ))
        }
    }
}

/// Validate a registration token (called by vDC)
pub fn validate_registration_token(token: &str) -> bool {
    let storage = get_token_storage().lock().unwrap();
    
    match &*storage {
        Some((stored_token, created_at)) => {
            let elapsed = created_at.elapsed();
            let expiry_duration = std::time::Duration::from_secs(3600);
            
            if elapsed >= expiry_duration {
                false
            } else {
                stored_token == token
            }
        }
        None => false,
    }
}

/// Extract and validate token from Authorization header
/// Returns the token if valid, or an error response if invalid
fn validate_auth_header(headers: &HeaderMap) -> Result<(), (StatusCode, Json<ApiError>)> {
    // Get Authorization header
    let auth_header = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(ApiError::new("missing_auth", "Authorization header is required")),
            )
        })?;

    // Check Bearer format
    if !auth_header.starts_with("Bearer ") {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ApiError::new("invalid_auth", "Authorization header must use Bearer scheme")),
        ));
    }

    let token = &auth_header[7..]; // Skip "Bearer "

    // Validate the token
    if !validate_registration_token(token) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ApiError::new("invalid_token", "Invalid or expired registration token")),
        ));
    }

    Ok(())
}

/// Request from vDC to complete registration
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteRegistrationRequest {
    token: String,
    control_plane_address: String,
    node_id: String,
    cluster_name: Option<String>,
}

/// Response after registration is completed
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompleteRegistrationResponse {
    success: bool,
    message: String,
    node_id: String,
    hostname: String,
}

/// Complete registration (called by vDC after validating token)
/// This endpoint is called by the vDC control plane to finalize adding this host to the cluster.
async fn complete_registration(
    State(_state): State<Arc<AppState>>,
    Json(request): Json<CompleteRegistrationRequest>,
) -> Result<Json<CompleteRegistrationResponse>, (StatusCode, Json<ApiError>)> {
    info!(
        control_plane = %request.control_plane_address,
        node_id = %request.node_id,
        "Received registration completion from vDC"
    );
    
    // Validate the token
    if !validate_registration_token(&request.token) {
        error!("Invalid or expired registration token provided");
        crate::event_store::emit_event(crate::event_store::Event::new(
            crate::event_store::EventLevel::Error,
            crate::event_store::EventCategory::Cluster,
            "Registration failed: Invalid or expired token".to_string(),
            "registration",
        ));
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ApiError::new("invalid_token", "Invalid or expired registration token")),
        ));
    }
    
    // Write the cluster configuration to the config file
    let config_path = std::path::Path::new("/etc/limiquantix/node.yaml");
    let hostname = gethostname::gethostname().to_string_lossy().to_string();
    
    // Read existing config or create new one
    let mut config_content = if config_path.exists() {
        match tokio::fs::read_to_string(config_path).await {
            Ok(content) => content,
            Err(e) => {
                error!(error = %e, "Failed to read config file");
                String::new()
            }
        }
    } else {
        String::new()
    };
    
    // Update or add control_plane section
    // This is a simple approach - in production, use proper YAML parsing
    if config_content.contains("control_plane:") {
        // Update existing control_plane section
        let updated = config_content
            .lines()
            .map(|line| {
                if line.trim().starts_with("address:") && config_content.contains("control_plane:") {
                    format!("  address: \"{}\"", request.control_plane_address)
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        config_content = updated;
    } else {
        // Add control_plane section
        config_content.push_str(&format!(
            "\ncontrol_plane:\n  address: \"{}\"\n  heartbeat_interval_secs: 30\n",
            request.control_plane_address
        ));
    }
    
    // Try to write the config file
    if let Err(e) = tokio::fs::write(config_path, &config_content).await {
        warn!(error = %e, "Failed to write config file (may need restart with manual config)");
        // Don't fail - the registration is still valid, just needs manual config
    }
    
    // Write cluster marker file for TUI/DCUI to detect cluster status
    let cluster_marker = std::path::Path::new("/quantix/cluster.yaml");
    if let Err(e) = tokio::fs::create_dir_all("/quantix").await {
        warn!(error = %e, "Failed to create /quantix directory");
    }
    let cluster_info = format!(
        "# Quantix Cluster Configuration\n\
         # This file indicates the node is part of a cluster\n\
         cluster_joined: true\n\
         control_plane: \"{}\"\n\
         node_id: \"{}\"\n\
         cluster_name: \"{}\"\n\
         joined_at: \"{}\"\n",
        request.control_plane_address,
        request.node_id,
        request.cluster_name.as_deref().unwrap_or(""),
        chrono::Utc::now().to_rfc3339()
    );
    if let Err(e) = tokio::fs::write(cluster_marker, &cluster_info).await {
        warn!(error = %e, "Failed to write cluster marker file");
    } else {
        info!("Cluster marker file written to /quantix/cluster.yaml");
    }
    
    // Clear the registration token (it's now used)
    {
        let mut storage = get_token_storage().lock().unwrap();
        *storage = None;
    }
    
    // Emit success event
    crate::event_store::emit_event(crate::event_store::Event::new(
        crate::event_store::EventLevel::Info,
        crate::event_store::EventCategory::Cluster,
        format!(
            "Successfully registered with vDC cluster{}",
            request.cluster_name.as_ref().map(|n| format!(" '{}'", n)).unwrap_or_default()
        ),
        "registration",
    ));
    
    info!(
        node_id = %request.node_id,
        control_plane = %request.control_plane_address,
        "Registration completed successfully"
    );
    
    Ok(Json(CompleteRegistrationResponse {
        success: true,
        message: "Registration completed. The node will begin heartbeat communication with the control plane.".to_string(),
        node_id: request.node_id,
        hostname,
    }))
}

/// Get full host discovery information for vDC to display resources
/// Requires valid Authorization: Bearer <token> header
async fn get_host_discovery(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<HostDiscoveryResponse>, (StatusCode, Json<ApiError>)> {
    info!("Host discovery request received");
    
    // Validate the Authorization header token
    validate_auth_header(&headers)?;
    
    let hostname = gethostname::gethostname().to_string_lossy().to_string();
    let management_ip = state.service.get_management_ip();
    
    // Get CPU info
    let cpu = collect_cpu_info();
    
    // Get memory info
    let memory = collect_memory_info();
    
    // Get storage inventory (local + NFS + iSCSI)
    let storage = collect_storage_inventory().await;
    
    // Get network interfaces
    let network = collect_network_info();
    
    // Get GPUs
    let gpus = collect_gpu_info();
    
    info!("Host discovery completed for {}", hostname);
    
    Ok(Json(HostDiscoveryResponse {
        hostname,
        management_ip,
        cpu,
        memory,
        storage,
        network,
        gpus,
    }))
}

// ============================================================================
// System Logs Handlers
// ============================================================================

/// Get system logs with filtering
async fn get_logs(
    State(_state): State<Arc<AppState>>,
    Query(params): Query<LogsQuery>,
) -> Result<Json<LogsResponse>, (StatusCode, Json<ApiError>)> {
    info!("Fetching system logs");
    
    let limit = params.limit.unwrap_or(100).min(1000);
    let offset = params.offset.unwrap_or(0);
    
    // Read logs from journald or log files
    let logs = collect_system_logs(
        params.level.as_deref(),
        params.source.as_deref(),
        params.search.as_deref(),
        params.since.as_deref(),
        params.until.as_deref(),
        limit + 1, // Fetch one extra to check if there are more
        offset,
    ).await;
    
    let has_more = logs.len() > limit;
    let logs: Vec<LogEntry> = logs.into_iter().take(limit).collect();
    let total = logs.len();
    
    Ok(Json(LogsResponse {
        logs,
        total,
        has_more,
    }))
}

/// Get available log sources
async fn get_log_sources(
    State(_state): State<Arc<AppState>>,
) -> Result<Json<Vec<String>>, (StatusCode, Json<ApiError>)> {
    // Return known log sources including UI components
    let sources = vec![
        "limiquantix-node".to_string(),
        "kernel".to_string(),
        "systemd".to_string(),
        "libvirtd".to_string(),
        "qemu".to_string(),
        "network".to_string(),
        "storage".to_string(),
        // UI components
        "ui-vm".to_string(),
        "ui-storage".to_string(),
        "ui-network".to_string(),
        "ui-host".to_string(),
        "ui-settings".to_string(),
        "ui-dashboard".to_string(),
        "ui-console".to_string(),
        "ui-auth".to_string(),
        "ui-logs".to_string(),
        "ui-updates".to_string(),
        "ui-hardware".to_string(),
        "ui-certificates".to_string(),
        "ui-registration".to_string(),
    ];
    
    Ok(Json(sources))
}

/// Submit UI logs from the frontend
async fn submit_ui_logs(
    State(_state): State<Arc<AppState>>,
    Json(request): Json<UILogsRequest>,
) -> Result<Json<UILogsResponse>, (StatusCode, Json<ApiError>)> {
    let mut accepted = 0;
    
    for ui_log in request.logs {
        // Log each UI action using tracing with all fields
        info!(
            timestamp = %ui_log.timestamp,
            level = %ui_log.level,
            action = %ui_log.action,
            component = %ui_log.component,
            target = %ui_log.target,
            message = %ui_log.message,
            metadata = ?ui_log.metadata,
            correlation_id = ?ui_log.correlation_id,
            session_id = ?ui_log.session_id,
            user_id = ?ui_log.user_id,
            user_action = ui_log.user_action,
            "UI action"
        );
        accepted += 1;
    }
    
    Ok(Json(UILogsResponse {
        accepted,
        message: "Logs accepted".to_string(),
    }))
}

/// Stream logs via WebSocket
async fn stream_logs_ws(
    ws: axum::extract::WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl axum::response::IntoResponse {
    ws.on_upgrade(move |socket| handle_log_stream(socket, state))
}

/// Handle WebSocket log streaming
async fn handle_log_stream(
    mut socket: WebSocket,
    _state: Arc<AppState>,
) {
    use tokio::time::{interval, Duration};
    
    info!("Log stream WebSocket connected");
    
    // Send a heartbeat and check for new logs every second
    let mut ticker = interval(Duration::from_secs(1));
    let mut last_timestamp = chrono::Utc::now().to_rfc3339();
    
    loop {
        tokio::select! {
            _ = ticker.tick() => {
                // Fetch new logs since last timestamp
                let new_logs = collect_system_logs(
                    None,
                    None,
                    None,
                    Some(&last_timestamp),
                    None,
                    50,
                    0,
                ).await;
                
                for log in new_logs {
                    last_timestamp = log.timestamp.clone();
                    if let Ok(json) = serde_json::to_string(&log) {
                        if socket.send(Message::Text(json)).await.is_err() {
                            break;
                        }
                    }
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => {
                        info!("Log stream WebSocket closed");
                        break;
                    }
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

/// Collect system logs from various sources
async fn collect_system_logs(
    level: Option<&str>,
    source: Option<&str>,
    search: Option<&str>,
    since: Option<&str>,
    _until: Option<&str>,
    limit: usize,
    _offset: usize,
) -> Vec<LogEntry> {
    let mut logs = Vec::new();
    
    // Try to read from journald first (Linux)
    #[cfg(target_os = "linux")]
    {
        // Build journalctl command with filters for relevant services
        let mut args = vec![
            "-o".to_string(), 
            "json".to_string(),
            "-n".to_string(), 
            limit.to_string(),
            "--no-pager".to_string(),
            // Only show recent logs (last 24 hours by default)
            "--since".to_string(),
            "24 hours ago".to_string(),
        ];
        
        // Filter by source/unit if specified
        if let Some(src) = source {
            // Map source names to journald unit patterns
            let unit_pattern = match src {
                "limiquantix-node" | "qx-node" => "_SYSTEMD_UNIT=limiquantix-node.service",
                "libvirtd" => "_SYSTEMD_UNIT=libvirtd.service",
                "qemu" => "SYSLOG_IDENTIFIER=qemu-system-x86_64",
                "kernel" => "_TRANSPORT=kernel",
                "network" => "SYSLOG_IDENTIFIER=NetworkManager",
                "storage" => "_SYSTEMD_UNIT=iscsid.service",
                _ => &format!("SYSLOG_IDENTIFIER={}", src),
            };
            args.push(unit_pattern.to_string());
        }
        
        // Filter by priority/level
        if let Some(lvl) = level {
            let priority = match lvl.to_lowercase().as_str() {
                "error" => "0..3",
                "warn" | "warning" => "0..4",
                "info" => "0..6",
                "debug" => "0..7",
                _ => "0..6",
            };
            args.push("-p".to_string());
            args.push(priority.to_string());
        }
        
        // Add since filter if provided
        if let Some(since_ts) = since {
            // Override the default since with user-provided value
            args[5] = since_ts.to_string();
        }
        
        debug!(args = ?args, "Running journalctl");
        
        if let Ok(output) = tokio::process::Command::new("journalctl")
            .args(&args)
            .output()
            .await
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if let Ok(entry) = parse_journald_entry(line) {
                        // Apply search filter
                        if let Some(q) = search {
                            let q_lower = q.to_lowercase();
                            if !entry.message.to_lowercase().contains(&q_lower) {
                                continue;
                            }
                        }
                        logs.push(entry);
                        
                        if logs.len() >= limit {
                            break;
                        }
                    }
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                warn!(stderr = %stderr, "journalctl failed");
            }
        }
        
        // Also try to read from log files if journald returned few results
        if logs.len() < limit / 2 {
            // Read from common log files
            let log_files = [
                "/var/log/limiquantix/node.log",
                "/var/log/messages",
                "/var/log/syslog",
            ];
            
            for log_file in &log_files {
                if let Ok(content) = tokio::fs::read_to_string(log_file).await {
                    for line in content.lines().rev().take(limit - logs.len()) {
                        if let Some(entry) = parse_syslog_line(line) {
                            // Apply filters
                            if let Some(lvl) = level {
                                if entry.level.to_lowercase() != lvl.to_lowercase() {
                                    continue;
                                }
                            }
                            if let Some(src) = source {
                                if !entry.source.as_ref().map_or(false, |s| s.contains(src)) {
                                    continue;
                                }
                            }
                            if let Some(q) = search {
                                let q_lower = q.to_lowercase();
                                if !entry.message.to_lowercase().contains(&q_lower) {
                                    continue;
                                }
                            }
                            logs.push(entry);
                        }
                    }
                }
            }
        }
    }
    
    // If no logs from journald or not on Linux, try reading log files
    #[cfg(not(target_os = "linux"))]
    {
        // Try to read from log files on non-Linux systems
        let log_files = [
            "/var/log/limiquantix/node.log",
            "C:\\ProgramData\\limiquantix\\logs\\node.log",
        ];
        
        for log_file in &log_files {
            if let Ok(content) = tokio::fs::read_to_string(log_file).await {
                for line in content.lines().rev().take(limit) {
                    if let Some(entry) = parse_syslog_line(line) {
                        logs.push(entry);
                    }
                }
            }
        }
    }
    
    // If still no logs, generate sample logs for development
    if logs.is_empty() {
        logs = generate_sample_logs(limit, level, source, search);
    }
    
    logs
}

/// Parse a syslog-format log line
fn parse_syslog_line(line: &str) -> Option<LogEntry> {
    // Common syslog format: "Jan  9 10:30:45 hostname service[pid]: message"
    // Or JSON format: {"timestamp": "...", "level": "...", "message": "..."}
    
    // Try JSON first
    if line.starts_with('{') {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            let timestamp = v.get("timestamp")
                .or_else(|| v.get("ts"))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
            
            let level = v.get("level")
                .or_else(|| v.get("lvl"))
                .and_then(|l| l.as_str())
                .unwrap_or("info")
                .to_string();
            
            let message = v.get("message")
                .or_else(|| v.get("msg"))
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .to_string();
            
            let source = v.get("source")
                .or_else(|| v.get("logger"))
                .and_then(|s| s.as_str())
                .map(|s| s.to_string());
            
            return Some(LogEntry {
                timestamp,
                level,
                message,
                source,
                fields: None,
                stack_trace: None,
                request_id: None,
                vm_id: None,
                node_id: None,
                duration_ms: None,
                action: None,
                component: None,
                target: None,
                correlation_id: None,
                user_id: None,
                session_id: None,
                user_action: None,
            });
        }
    }
    
    // Try syslog format
    // Very basic parsing - just extract the message after the first ]: or :
    let parts: Vec<&str> = line.splitn(4, ' ').collect();
    if parts.len() >= 4 {
        let message = parts[3..].join(" ");
        let source = parts.get(2).map(|s| s.trim_end_matches(':').to_string());
        
        // Determine level from message content
        let level = if message.to_lowercase().contains("error") || message.to_lowercase().contains("fail") {
            "error"
        } else if message.to_lowercase().contains("warn") {
            "warn"
        } else if message.to_lowercase().contains("debug") {
            "debug"
        } else {
            "info"
        }.to_string();
        
        return Some(LogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level,
            message,
            source,
            fields: None,
            stack_trace: None,
            request_id: None,
            vm_id: None,
            node_id: None,
            duration_ms: None,
            action: None,
            component: None,
            target: None,
            correlation_id: None,
            user_id: None,
            session_id: None,
            user_action: None,
        });
    }
    
    None
}

/// Parse a journald JSON entry
#[cfg(target_os = "linux")]
fn parse_journald_entry(line: &str) -> Result<LogEntry, serde_json::Error> {
    let v: serde_json::Value = serde_json::from_str(line)?;
    
    let timestamp = v.get("__REALTIME_TIMESTAMP")
        .and_then(|t| t.as_str())
        .and_then(|t| t.parse::<i64>().ok())
        .map(|us| {
            chrono::DateTime::from_timestamp(us / 1_000_000, ((us % 1_000_000) * 1000) as u32)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
        })
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    
    let priority = v.get("PRIORITY")
        .and_then(|p| p.as_str())
        .and_then(|p| p.parse::<u8>().ok())
        .unwrap_or(6);
    
    let level = match priority {
        0..=2 => "error",
        3 => "error",
        4 => "warn",
        5 => "info",
        6 => "info",
        7 => "debug",
        _ => "trace",
    }.to_string();
    
    let message = v.get("MESSAGE")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    
    let source = v.get("SYSLOG_IDENTIFIER")
        .or_else(|| v.get("_COMM"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());
    
    Ok(LogEntry {
        timestamp,
        level,
        message,
        source,
        fields: None,
        stack_trace: None,
        request_id: None,
        vm_id: None,
        node_id: None,
        duration_ms: None,
        action: None,
        component: None,
        target: None,
        correlation_id: None,
        user_id: None,
        session_id: None,
        user_action: None,
    })
}

/// Generate sample logs for development/testing or non-Linux systems
fn generate_sample_logs(
    limit: usize,
    level: Option<&str>,
    source: Option<&str>,
    search: Option<&str>,
) -> Vec<LogEntry> {
    use chrono::{Duration, Utc};
    
    let sample_entries = vec![
        ("info", "limiquantix-node", "HTTP server started on 0.0.0.0:8443"),
        ("info", "limiquantix-node", "TLS certificate loaded successfully"),
        ("debug", "storage", "Scanning storage pools..."),
        ("info", "storage", "Found 2 storage pools"),
        ("info", "network", "Network interfaces enumerated: 3 found"),
        ("warn", "libvirtd", "VM 'test-vm' memory usage at 85%"),
        ("info", "qemu", "VM 'test-vm' started successfully"),
        ("debug", "limiquantix-node", "Health check passed"),
        ("info", "systemd", "Service limiquantix-node.service started"),
        ("error", "storage", "Failed to mount NFS share: connection refused"),
        ("info", "kernel", "USB device connected: /dev/sdb"),
        ("warn", "network", "Interface eth0 link speed degraded to 100Mbps"),
        ("info", "limiquantix-node", "API request: GET /api/v1/host"),
        ("debug", "qemu", "VM 'test-vm' CPU usage: 45%"),
        ("info", "limiquantix-node", "Registration token generated"),
    ];
    
    let now = Utc::now();
    let mut logs = Vec::new();
    
    for (i, (lvl, src, msg)) in sample_entries.iter().cycle().take(limit).enumerate() {
        // Apply filters
        if let Some(filter_level) = level {
            if *lvl != filter_level {
                continue;
            }
        }
        if let Some(filter_source) = source {
            if !src.contains(filter_source) {
                continue;
            }
        }
        if let Some(query) = search {
            if !msg.to_lowercase().contains(&query.to_lowercase()) {
                continue;
            }
        }
        
        let timestamp = now - Duration::seconds((limit - i) as i64 * 5);
        
        logs.push(LogEntry {
            timestamp: timestamp.to_rfc3339(),
            level: lvl.to_string(),
            message: msg.to_string(),
            source: Some(src.to_string()),
            fields: Some(serde_json::json!({
                "request_id": format!("req-{:08x}", rand::random::<u32>()),
            })),
            stack_trace: None,
            request_id: None,
            vm_id: None,
            node_id: None,
            duration_ms: Some(rand::random::<u64>() % 100),
            action: None,
            component: None,
            target: None,
            correlation_id: None,
            user_id: None,
            session_id: None,
            user_action: None,
        });
    }
    
    logs
}

/// Collect CPU information
fn collect_cpu_info() -> CpuInfo {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_cpu_all();
    
    let cpu_count = sys.cpus().len() as u32;
    let cpu_model = sys.cpus().first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    
    CpuInfo {
        model: cpu_model,
        vendor: "Unknown".to_string(),
        cores: cpu_count,
        threads: cpu_count,
        sockets: 1,
        frequency_mhz: 0,
        features: vec![],
        architecture: std::env::consts::ARCH.to_string(),
    }
}

/// Collect memory information
fn collect_memory_info() -> MemoryInfo {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_memory();
    
    MemoryInfo {
        total_bytes: sys.total_memory(),
        available_bytes: sys.available_memory(),
        used_bytes: sys.used_memory(),
        swap_total_bytes: sys.total_swap(),
        swap_used_bytes: sys.used_swap(),
        ecc_enabled: false,
        dimm_count: 0,
    }
}

/// Collect storage inventory including local disks, NFS mounts, and iSCSI targets
async fn collect_storage_inventory() -> StorageInventory {
    let local = collect_local_disks();
    let nfs = collect_nfs_mounts().await;
    let iscsi = collect_iscsi_targets().await;
    
    StorageInventory { local, nfs, iscsi }
}

/// Collect local disk information using lsblk to detect all physical disks
/// This includes unmounted disks that sysinfo::Disks would miss
fn collect_local_disks() -> Vec<DiskInfo> {
    // Use get_physical_storage_devices() which uses lsblk for accurate detection
    // This will show ALL physical disks including unmounted NVMe drives
    let mut devices = get_physical_storage_devices();
    
    // If lsblk failed or returned empty, fall back to sysinfo for mounted disks
    if devices.is_empty() {
    use sysinfo::Disks;
    let disks = Disks::new_with_refreshed_list();
    
    for disk in disks.iter() {
        let name = disk.name().to_string_lossy().to_string();
        let mount_point = disk.mount_point().to_string_lossy().to_string();
        let total = disk.total_space();
        let available = disk.available_space();
        let used = total.saturating_sub(available);
        let fs = disk.file_system().to_string_lossy().to_string();
            
            // Skip virtual/system mounts
            if mount_point.starts_with("/sys") 
                || mount_point.starts_with("/proc")
                || mount_point.starts_with("/dev")
                || mount_point.starts_with("/run")
                || name.starts_with("loop")
                || name.starts_with("tmpfs")
            {
                continue;
            }
        
        // Determine disk type based on name
        let disk_type = if name.contains("nvme") {
            "NVMe"
        } else if name.contains("sd") {
            "SATA"
        } else {
            "Unknown"
        };
        
            devices.push(DiskInfo {
            name: name.clone(),
            model: "".to_string(),
            serial: "".to_string(),
            size_bytes: total,
            disk_type: disk_type.to_string(),
            interface: disk_type.to_string(),
            is_removable: disk.is_removable(),
            smart_status: "OK".to_string(),
            partitions: vec![PartitionInfo {
                name: name,
                mount_point: Some(mount_point),
                size_bytes: total,
                used_bytes: used,
                filesystem: fs,
            }],
        });
        }
    }
    
    devices
}

/// Collect NFS mount information
async fn collect_nfs_mounts() -> Vec<NfsMount> {
    use tokio::fs;
    
    let mut mounts = Vec::new();
    
    // Read /proc/mounts to find NFS mounts
    if let Ok(content) = fs::read_to_string("/proc/mounts").await {
        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 && (parts[2] == "nfs" || parts[2] == "nfs4") {
                let source = parts[0];
                let mount_point = parts[1];
                
                // Parse server:export format
                let (server, export_path) = if let Some(colon_pos) = source.find(':') {
                    (source[..colon_pos].to_string(), source[colon_pos+1..].to_string())
                } else {
                    (source.to_string(), "/".to_string())
                };
                
                // Get size info using statvfs
                let (size, used, available) = get_mount_stats(mount_point);
                
                mounts.push(NfsMount {
                    mount_point: mount_point.to_string(),
                    server,
                    export_path,
                    size_bytes: size,
                    used_bytes: used,
                    available_bytes: available,
                });
            }
        }
    }
    
    mounts
}

/// Collect iSCSI target information
async fn collect_iscsi_targets() -> Vec<IscsiTarget> {
    use tokio::fs;
    use std::path::Path;
    
    let mut targets = Vec::new();
    
    // Read from /sys/class/iscsi_session/
    let iscsi_path = Path::new("/sys/class/iscsi_session");
    if !iscsi_path.exists() {
        return targets;
    }
    
    if let Ok(mut entries) = tokio::fs::read_dir(iscsi_path).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let session_path = entry.path();
            
            // Read target IQN
            let target_iqn = if let Ok(iqn) = fs::read_to_string(session_path.join("targetname")).await {
                iqn.trim().to_string()
            } else {
                continue;
            };
            
            // Try to find the associated block device
            let device_path = find_iscsi_device(&session_path).await;
            let size_bytes = if !device_path.is_empty() {
                get_block_device_size(&device_path).await
            } else {
                0
            };
            
            targets.push(IscsiTarget {
                target_iqn,
                portal: "".to_string(),
                device_path,
                size_bytes,
                lun: 0,
            });
        }
    }
    
    targets
}

/// Find the block device associated with an iSCSI session
async fn find_iscsi_device(_session_path: &std::path::Path) -> String {
    // This is a simplified implementation
    // In production, we'd traverse /sys/class/iscsi_session/sessionN/device/target*/*/block/*
    String::new()
}

/// Get block device size from /sys/block/{device}/size
async fn get_block_device_size(device_path: &str) -> u64 {
    use tokio::fs;
    
    // Extract device name (e.g., "sdb" from "/dev/sdb")
    let device_name = device_path.trim_start_matches("/dev/");
    let size_path = format!("/sys/block/{}/size", device_name);
    
    if let Ok(content) = fs::read_to_string(&size_path).await {
        if let Ok(sectors) = content.trim().parse::<u64>() {
            // Size in /sys/block is in 512-byte sectors
            return sectors * 512;
        }
    }
    
    0
}

/// Get mount point statistics using libc statvfs (Linux only)
#[cfg(target_os = "linux")]
fn get_mount_stats(mount_point: &str) -> (u64, u64, u64) {
    use std::ffi::CString;
    
    let path = match CString::new(mount_point) {
        Ok(p) => p,
        Err(_) => return (0, 0, 0),
    };
    
    unsafe {
        let mut stat: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(path.as_ptr(), &mut stat) == 0 {
            let block_size = stat.f_frsize as u64;
            let total = stat.f_blocks * block_size;
            let available = stat.f_bavail * block_size;
            let used = total.saturating_sub(stat.f_bfree * block_size);
            (total, used, available)
        } else {
            (0, 0, 0)
        }
    }
}

/// Get mount point statistics (non-Linux stub)
#[cfg(not(target_os = "linux"))]
fn get_mount_stats(_mount_point: &str) -> (u64, u64, u64) {
    // statvfs is not available on Windows - return zeros
    // This is only used for disk statistics in the API
    (0, 0, 0)
}

/// Collect network interface information
fn collect_network_info() -> Vec<NicInfo> {
    // Simplified implementation - in production use netlink or similar
    vec![]
}

/// Collect GPU information
fn collect_gpu_info() -> Vec<GpuInfo> {
    // Simplified implementation - in production parse lspci or sysfs
    vec![]
}

// ============================================================================
// Certificate Management Handlers
// ============================================================================

/// Get current certificate information
async fn get_certificate_info(
    State(state): State<Arc<AppState>>,
) -> Result<Json<CertificateInfo>, (StatusCode, Json<ApiError>)> {
    debug!("Getting certificate information");
    
    match state.tls_manager.get_certificate_info() {
        Ok(info) => Ok(Json(info)),
        Err(e) => {
            error!(error = %e, "Failed to get certificate info");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("certificate_error", &e.to_string())),
            ))
        }
    }
}

/// Request body for certificate upload
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadCertificateRequest {
    /// PEM-encoded certificate
    certificate: String,
    /// PEM-encoded private key
    private_key: String,
    /// Optional PEM-encoded CA certificate
    ca_certificate: Option<String>,
}

/// Upload a custom certificate
async fn upload_certificate(
    State(state): State<Arc<AppState>>,
    Json(request): Json<UploadCertificateRequest>,
) -> Result<Json<CertificateInfo>, (StatusCode, Json<ApiError>)> {
    info!("Uploading custom certificate");
    
    match state.tls_manager.upload_certificate(
        &request.certificate,
        &request.private_key,
        request.ca_certificate.as_deref(),
    ).await {
        Ok(()) => {
            // Get updated certificate info
            match state.tls_manager.get_certificate_info() {
                Ok(info) => {
                    info!("Certificate uploaded successfully - restart required");
                    Ok(Json(info))
                }
                Err(e) => Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiError::new("certificate_info_error", &e.to_string())),
                ))
            }
        }
        Err(e) => {
            error!(error = %e, "Failed to upload certificate");
            Err((
                StatusCode::BAD_REQUEST,
                Json(ApiError::new("invalid_certificate", &e.to_string())),
            ))
        }
    }
}

/// Generate a new self-signed certificate
async fn generate_self_signed(
    State(state): State<Arc<AppState>>,
) -> Result<Json<CertificateInfo>, (StatusCode, Json<ApiError>)> {
    info!("Generating self-signed certificate");
    
    match state.tls_manager.generate_self_signed().await {
        Ok(()) => {
            match state.tls_manager.get_certificate_info() {
                Ok(info) => {
                    info!("Self-signed certificate generated - restart required");
                    Ok(Json(info))
                }
                Err(e) => Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ApiError::new("certificate_info_error", &e.to_string())),
                ))
            }
        }
        Err(e) => {
            error!(error = %e, "Failed to generate self-signed certificate");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiError::new("generate_error", &e.to_string())),
            ))
        }
    }
}

/// Reset to self-signed certificate
async fn reset_certificate(
    State(state): State<Arc<AppState>>,
) -> Result<Json<CertificateInfo>, (StatusCode, Json<ApiError>)> {
    info!("Resetting certificate to self-signed");
    
    // Generate a new self-signed certificate
    generate_self_signed(State(state)).await
}

/// Get ACME (Let's Encrypt) account information
async fn get_acme_info(
    State(state): State<Arc<AppState>>,
) -> Result<Json<AcmeAccountInfo>, (StatusCode, Json<ApiError>)> {
    debug!("Getting ACME account information");
    
    let acme_manager = AcmeManager::new(state.tls_config.clone());
    Ok(Json(acme_manager.get_account_info()))
}

/// Request body for ACME account registration
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterAcmeRequest {
    /// Contact email for Let's Encrypt notifications
    email: String,
}

/// Register an ACME account with Let's Encrypt
async fn register_acme_account(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RegisterAcmeRequest>,
) -> Result<Json<AcmeAccountInfo>, (StatusCode, Json<ApiError>)> {
    info!(email = %request.email, "Registering ACME account");
    
    let acme_manager = AcmeManager::new(state.tls_config.clone());
    
    match acme_manager.register_account(&request.email).await {
        Ok(()) => {
            info!("ACME account registered successfully");
            Ok(Json(acme_manager.get_account_info()))
        }
        Err(e) => {
            error!(error = %e, "Failed to register ACME account");
            Err((
                StatusCode::BAD_REQUEST,
                Json(ApiError::new("acme_registration_failed", &e.to_string())),
            ))
        }
    }
}

/// Request body for ACME certificate issuance
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueAcmeCertificateRequest {
    /// List of domains to request certificate for
    domains: Vec<String>,
}

/// Issue a certificate via ACME (Let's Encrypt)
async fn issue_acme_certificate(
    State(state): State<Arc<AppState>>,
    Json(request): Json<IssueAcmeCertificateRequest>,
) -> Result<Json<AcmeChallengeStatus>, (StatusCode, Json<ApiError>)> {
    info!(domains = ?request.domains, "Initiating ACME certificate issuance");
    
    if request.domains.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiError::new("no_domains", "At least one domain is required")),
        ));
    }
    
    let acme_manager = AcmeManager::new(state.tls_config.clone());
    
    match acme_manager.issue_certificate(&request.domains).await {
        Ok(status) => {
            info!(domain = %status.domain, "ACME challenge initiated");
            Ok(Json(status))
        }
        Err(e) => {
            error!(error = %e, "Failed to issue ACME certificate");
            Err((
                StatusCode::BAD_REQUEST,
                Json(ApiError::new("acme_issue_failed", &e.to_string())),
            ))
        }
    }
}

// ============================================================================
// Guest Agent Download Handlers
// ============================================================================
// 
// The node daemon serves guest agent packages to VMs during cloud-init.
// It first tries local files (for offline/air-gapped environments), then
// proxies from the update server if configured.
//
// Local paths checked:
//   /data/share/quantix-agent/  (OTA-deployed)
//   /opt/limiquantix/agent/     (manual install)
//   /var/lib/limiquantix/agent/ (legacy)
//
// Update server proxy: Uses UPDATE_SERVER_URL env var (e.g., http://192.168.0.148:9000)

/// Agent version response
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentVersionResponse {
    version: String,
    download_url: String,
    source: String,  // "local" or "update_server"
}

/// Get update server URL from environment, config file, or default
fn get_update_server_url() -> Option<String> {
    // First check environment variables
    if let Ok(url) = std::env::var("UPDATE_SERVER_URL") {
        return Some(url);
    }
    if let Ok(url) = std::env::var("QUANTIX_UPDATE_SERVER") {
        return Some(url);
    }
    
    // Try to read from update config file
    let config_paths = [
        "/etc/limiquantix/update.yaml",
        "/etc/limiquantix/update.yml",
        "/data/config/update.yaml",
    ];
    
    for path in &config_paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            // Simple YAML parsing for server_url field
            for line in content.lines() {
                let line = line.trim();
                if line.starts_with("server_url:") {
                    let url = line.trim_start_matches("server_url:").trim();
                    let url = url.trim_matches('"').trim_matches('\'');
                    if !url.is_empty() {
                        return Some(url.to_string());
                    }
                }
            }
        }
    }
    
    // Default to HomeLab update server
    Some("http://192.168.0.148:9000".to_string())
}

/// Proxy a request to the update server
async fn proxy_from_update_server(path: &str) -> Option<Vec<u8>> {
    let update_server = get_update_server_url()?;
    let url = format!("{}/api/v1/agent/{}", update_server.trim_end_matches('/'), path);
    
    debug!(url = %url, "Proxying agent request to update server");
    
    match reqwest::get(&url).await {
        Ok(response) if response.status().is_success() => {
            match response.bytes().await {
                Ok(bytes) => {
                    info!(url = %url, size = bytes.len(), "Successfully proxied from update server");
                    Some(bytes.to_vec())
                }
                Err(e) => {
                    warn!(url = %url, error = %e, "Failed to read response body");
                    None
                }
            }
        }
        Ok(response) => {
            warn!(url = %url, status = %response.status(), "Update server returned error");
            None
        }
        Err(e) => {
            warn!(url = %url, error = %e, "Failed to connect to update server");
            None
        }
    }
}

/// GET /api/v1/agent/version - Get current agent version
async fn get_agent_version(
    headers: HeaderMap,
) -> Json<AgentVersionResponse> {
    // Get base URL from request
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost:8443");
    let scheme = if headers.contains_key("x-forwarded-proto") {
        headers.get("x-forwarded-proto")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("https")
    } else {
        "https"
    };
    
    // Try to get version from update server if available
    let (version, source) = if let Some(update_server) = get_update_server_url() {
        // Try to fetch version from update server
        let url = format!("{}/api/v1/agent/version", update_server.trim_end_matches('/'));
        if let Ok(response) = reqwest::get(&url).await {
            if let Ok(json) = response.json::<serde_json::Value>().await {
                if let Some(v) = json.get("version").and_then(|v| v.as_str()) {
                    (v.to_string(), "update_server".to_string())
                } else {
                    ("0.1.0".to_string(), "local".to_string())
                }
            } else {
                ("0.1.0".to_string(), "local".to_string())
            }
        } else {
            ("0.1.0".to_string(), "local".to_string())
        }
    } else {
        ("0.1.0".to_string(), "local".to_string())
    };
    
    Json(AgentVersionResponse {
        version,
        download_url: format!("{}://{}/api/v1/agent/", scheme, host),
        source,
    })
}

/// GET /api/v1/agent/install.sh - Get Linux installer script
async fn get_agent_install_script(
    headers: HeaderMap,
) -> impl IntoResponse {
    // Get base URL from request
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost:8443");
    let scheme = if headers.contains_key("x-forwarded-proto") {
        headers.get("x-forwarded-proto")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("https")
    } else {
        "https"
    };
    let base_url = format!("{}://{}", scheme, host);
    
    let script = format!(r#"#!/bin/bash
# Quantix Guest Agent Installer
# Generated by Quantix Node Daemon
# Usage: curl -sSL {base_url}/api/v1/agent/install.sh | sudo bash

set -e

AGENT_VERSION="0.1.0"
NODE_URL="{base_url}"

echo "[Quantix] Installing Quantix Guest Agent v${{AGENT_VERSION}}..."

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
    x86_64) ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    *) echo "[Quantix] Unsupported architecture: $ARCH"; exit 1 ;;
esac

echo "[Quantix] Detected architecture: $ARCH"

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="${{ID}}"
else
    echo "[Quantix] Cannot detect OS"
    OS_ID="unknown"
fi

echo "[Quantix] Detected OS: $OS_ID"

# Create config directories
mkdir -p /etc/quantix-kvm/pre-freeze.d
mkdir -p /etc/quantix-kvm/post-thaw.d

# Install based on OS
case "${{OS_ID}}" in
    ubuntu|debian)
        echo "[Quantix] Installing via .deb package..."
        TEMP_DEB=$(mktemp)
        curl -fsSL "${{NODE_URL}}/api/v1/agent/linux/deb/${{ARCH}}" -o "$TEMP_DEB"
        dpkg -i "$TEMP_DEB" || apt-get install -f -y
        rm -f "$TEMP_DEB"
        ;;
        
    rhel|centos|fedora|rocky|almalinux)
        echo "[Quantix] Installing via .rpm package..."
        TEMP_RPM=$(mktemp)
        curl -fsSL "${{NODE_URL}}/api/v1/agent/linux/rpm/${{ARCH}}" -o "$TEMP_RPM"
        rpm -ivh "$TEMP_RPM" || yum localinstall -y "$TEMP_RPM" || dnf install -y "$TEMP_RPM"
        rm -f "$TEMP_RPM"
        ;;
        
    *)
        echo "[Quantix] Installing via binary..."
        curl -fsSL "${{NODE_URL}}/api/v1/agent/linux/binary/${{ARCH}}" -o /usr/local/bin/quantix-kvm-agent
        chmod +x /usr/local/bin/quantix-kvm-agent
        
        # Create systemd service
        cat > /etc/systemd/system/quantix-kvm-agent.service << 'EOF'
[Unit]
Description=Quantix Guest Agent
After=network.target
ConditionVirtualization=vm

[Service]
Type=simple
ExecStart=/usr/local/bin/quantix-kvm-agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
        systemctl daemon-reload
        ;;
esac

# Enable and start the service
if command -v systemctl &> /dev/null; then
    systemctl enable quantix-kvm-agent 2>/dev/null || true
    systemctl start quantix-kvm-agent 2>/dev/null || true
fi

echo "[Quantix] Agent installed and running!"
echo "[Quantix] Check status with: systemctl status quantix-kvm-agent"
"#, base_url = base_url);

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/x-shellscript"),
            (header::CONTENT_DISPOSITION, "attachment; filename=install.sh"),
        ],
        script,
    )
}

/// GET /api/v1/agent/linux/:arch - Download agent binary
async fn download_agent_binary(
    Path(arch): Path<String>,
) -> impl IntoResponse {
    // Validate architecture
    if arch != "amd64" && arch != "arm64" {
        return (
            StatusCode::BAD_REQUEST,
            [
                (header::CONTENT_TYPE, "application/json"),
            ],
            format!(r#"{{"error": "invalid_arch", "message": "Unsupported architecture: {}. Use: amd64 or arm64"}}"#, arch),
        ).into_response();
    }
    
    let binary_name = "quantix-kvm-agent";
    
    // Try to find the binary in local locations first
    let locations = [
        format!("/data/share/quantix-agent/quantix-kvm-agent-linux-{}", arch),
        format!("/data/share/quantix-agent/{}", binary_name),
        format!("/opt/quantix-kvm/agent/{}", binary_name),
        format!("/var/lib/limiquantix/agent/{}", binary_name),
        format!("./agent-binaries/{}-{}", binary_name, arch),
    ];
    
    for path in &locations {
        if let Ok(data) = tokio::fs::read(path).await {
            info!(path = %path, size = data.len(), source = "local", "Serving agent binary");
            return (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/octet-stream"),
                    (header::CONTENT_DISPOSITION, &format!("attachment; filename={}", binary_name)),
                ],
                data,
            ).into_response();
        }
    }
    
    // Try to proxy from update server
    if let Some(data) = proxy_from_update_server(&format!("linux/binary/{}", arch)).await {
        info!(arch = %arch, size = data.len(), source = "update_server", "Serving agent binary via proxy");
        return (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "application/octet-stream"),
                (header::CONTENT_DISPOSITION, &format!("attachment; filename={}", binary_name)),
            ],
            data,
        ).into_response();
    }
    
    // Binary not found anywhere
    warn!(arch = %arch, "Agent binary not found locally or on update server");
    (
        StatusCode::NOT_FOUND,
        [
            (header::CONTENT_TYPE, "application/json"),
        ],
        format!(r#"{{
    "error": "not_found",
    "message": "Agent binary for {} not available locally or from update server",
    "hint": "Publish guest-agent with: ./scripts/publish-update.sh --component guest-agent"
}}"#, arch),
    ).into_response()
}

/// GET /api/v1/agent/linux/:arch.deb - Download DEB package
async fn download_agent_deb(
    Path(arch): Path<String>,
) -> impl IntoResponse {
    // Remove .deb suffix if present
    let arch = arch.trim_end_matches(".deb");
    
    // Validate architecture
    if arch != "amd64" && arch != "arm64" {
        return (
            StatusCode::BAD_REQUEST,
            [(header::CONTENT_TYPE, "application/json")],
            format!(r#"{{"error": "invalid_arch", "message": "Unsupported architecture: {}"}}"#, arch),
        ).into_response();
    }
    
    // Try multiple filename patterns
    let filenames = [
        format!("limiquantix-guest-agent_*_{}.deb", arch),
        format!("limiquantix-guest-agent_0.1.0_{}.deb", arch),
    ];
    
    let base_locations = [
        "/data/share/quantix-agent",
        "/opt/limiquantix/agent",
        "/var/lib/limiquantix/agent",
        "./agent-binaries",
    ];
    
    // Try to find matching .deb file
    for base in &base_locations {
        for pattern in &filenames {
            let full_pattern = format!("{}/{}", base, pattern);
            if let Ok(paths) = glob::glob(&full_pattern) {
                for entry in paths.flatten() {
                    if let Ok(data) = tokio::fs::read(&entry).await {
                        let filename = entry.file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| format!("limiquantix-guest-agent_{}.deb", arch));
                        info!(path = %entry.display(), size = data.len(), source = "local", "Serving agent DEB package");
                        return (
                            StatusCode::OK,
                            [
                                (header::CONTENT_TYPE, "application/vnd.debian.binary-package"),
                                (header::CONTENT_DISPOSITION, &format!("attachment; filename={}", filename)),
                            ],
                            data,
                        ).into_response();
                    }
                }
            }
        }
        
        // Also try exact filename without glob
        let exact_path = format!("{}/limiquantix-guest-agent_0.1.0_{}.deb", base, arch);
        if let Ok(data) = tokio::fs::read(&exact_path).await {
            let filename = format!("limiquantix-guest-agent_0.1.0_{}.deb", arch);
            info!(path = %exact_path, size = data.len(), source = "local", "Serving agent DEB package");
            return (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/vnd.debian.binary-package"),
                    (header::CONTENT_DISPOSITION, &format!("attachment; filename={}", filename)),
                ],
                data,
            ).into_response();
        }
    }
    
    // Try to proxy from update server
    if let Some(data) = proxy_from_update_server(&format!("linux/deb/{}", arch)).await {
        let filename = format!("limiquantix-guest-agent_{}.deb", arch);
        info!(arch = %arch, size = data.len(), source = "update_server", "Serving agent DEB package via proxy");
        return (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "application/vnd.debian.binary-package"),
                (header::CONTENT_DISPOSITION, &format!("attachment; filename={}", filename)),
            ],
            data,
        ).into_response();
    }
    
    warn!(arch = %arch, "Agent DEB package not found locally or on update server");
    (
        StatusCode::NOT_FOUND,
        [(header::CONTENT_TYPE, "application/json")],
        format!(r#"{{"error": "not_found", "message": "DEB package for {} not available", "hint": "Publish guest-agent with: ./scripts/publish-update.sh --component guest-agent"}}"#, arch),
    ).into_response()
}

/// GET /api/v1/agent/linux/:arch.rpm - Download RPM package
async fn download_agent_rpm(
    Path(arch): Path<String>,
) -> impl IntoResponse {
    // Remove .rpm suffix if present
    let arch = arch.trim_end_matches(".rpm");
    
    // Validate architecture and convert to RPM naming
    let rpm_arch = match arch {
        "amd64" => "x86_64",
        "arm64" => "aarch64",
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                [(header::CONTENT_TYPE, "application/json")],
                format!(r#"{{"error": "invalid_arch", "message": "Unsupported architecture: {}"}}"#, arch),
            ).into_response();
        }
    };
    
    let base_locations = [
        "/data/share/quantix-agent",
        "/opt/limiquantix/agent",
        "/var/lib/limiquantix/agent",
        "./agent-binaries",
    ];
    
    // Try to find matching .rpm file with various naming patterns
    let patterns = [
        format!("limiquantix-guest-agent-*.{}.rpm", rpm_arch),
        format!("limiquantix-guest-agent-0.1.0-1.{}.rpm", rpm_arch),
    ];
    
    for base in &base_locations {
        for pattern in &patterns {
            let full_pattern = format!("{}/{}", base, pattern);
            if let Ok(paths) = glob::glob(&full_pattern) {
                for entry in paths.flatten() {
                    if let Ok(data) = tokio::fs::read(&entry).await {
                        let filename = entry.file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| format!("limiquantix-guest-agent.{}.rpm", rpm_arch));
                        info!(path = %entry.display(), size = data.len(), source = "local", "Serving agent RPM package");
                        return (
                            StatusCode::OK,
                            [
                                (header::CONTENT_TYPE, "application/x-rpm"),
                                (header::CONTENT_DISPOSITION, &format!("attachment; filename={}", filename)),
                            ],
                            data,
                        ).into_response();
                    }
                }
            }
        }
        
        // Also try exact filename without glob
        let exact_path = format!("{}/limiquantix-guest-agent-0.1.0-1.{}.rpm", base, rpm_arch);
        if let Ok(data) = tokio::fs::read(&exact_path).await {
            let filename = format!("limiquantix-guest-agent-0.1.0-1.{}.rpm", rpm_arch);
            info!(path = %exact_path, size = data.len(), source = "local", "Serving agent RPM package");
            return (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/x-rpm"),
                    (header::CONTENT_DISPOSITION, &format!("attachment; filename={}", filename)),
                ],
                data,
            ).into_response();
        }
    }
    
    // Try to proxy from update server
    if let Some(data) = proxy_from_update_server(&format!("linux/rpm/{}", arch)).await {
        let filename = format!("limiquantix-guest-agent.{}.rpm", rpm_arch);
        info!(arch = %arch, size = data.len(), source = "update_server", "Serving agent RPM package via proxy");
        return (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "application/x-rpm"),
                (header::CONTENT_DISPOSITION, &format!("attachment; filename={}", filename)),
            ],
            data,
        ).into_response();
    }
    
    warn!(arch = %arch, "Agent RPM package not found locally or on update server");
    (
        StatusCode::NOT_FOUND,
        [(header::CONTENT_TYPE, "application/json")],
        format!(r#"{{"error": "not_found", "message": "RPM package for {} not available", "hint": "Publish guest-agent with: ./scripts/publish-update.sh --component guest-agent"}}"#, arch),
    ).into_response()
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
    // Matches node_daemon.proto StoragePoolType enum
    match pool_type {
        0 => "UNSPECIFIED".to_string(),
        1 => "LOCAL_DIR".to_string(),
        2 => "LOCAL_LVM".to_string(),
        3 => "NFS".to_string(),
        4 => "CEPH_RBD".to_string(),
        5 => "CEPH_FS".to_string(),
        6 => "ISCSI".to_string(),
        _ => "UNKNOWN".to_string(),
    }
}

// Helper functions for Enum conversion
fn disk_bus_to_string(bus: i32) -> String {
    match bus {
        0 => "virtio".to_string(), // DISK_BUS_VIRTIO
        1 => "scsi".to_string(),   // DISK_BUS_SCSI
        2 => "sata".to_string(),   // DISK_BUS_SATA
        3 => "ide".to_string(),    // DISK_BUS_IDE
        _ => "unknown".to_string(),
    }
}

fn disk_format_to_string(fmt: i32) -> String {
    match fmt {
        0 => "qcow2".to_string(), // DISK_FORMAT_QCOW2
        1 => "raw".to_string(),   // DISK_FORMAT_RAW
        2 => "vmdk".to_string(),  // DISK_FORMAT_VMDK
        _ => "unknown".to_string(),
    }
}
