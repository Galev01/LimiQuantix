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

// ============================================================================
// Request Types
// ============================================================================

#[derive(Deserialize)]
struct StopVmRequest {
    timeout_seconds: Option<u32>,
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
    // Call the local health check method (not gRPC)
    match state.service.health_check().await {
        Ok(health) => {
            Ok(Json(HostInfo {
                node_id: "node-1".to_string(),
                hostname: hostname::get()
                    .map(|h| h.to_string_lossy().to_string())
                    .unwrap_or_else(|_| "unknown".to_string()),
                management_ip: local_ip_address::local_ip()
                    .map(|ip| ip.to_string())
                    .unwrap_or_else(|_| "127.0.0.1".to_string()),
                cpu_model: "Unknown".to_string(),
                cpu_cores: num_cpus::get() as u32,
                memory_total_bytes: 0,
                memory_available_bytes: 0,
                os_name: std::env::consts::OS.to_string(),
                os_version: "".to_string(),
                kernel_version: "".to_string(),
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
