//! Tauri API commands for configuration and Control Plane communication

use crate::config::{Config, DisplaySettings, SavedConnection};
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::{error, info, warn};

/// Response for connection list
#[derive(Debug, Serialize)]
pub struct ConnectionListResponse {
    pub connections: Vec<SavedConnection>,
}

/// Get saved connections
#[tauri::command]
pub fn get_saved_connections(state: State<AppState>) -> Result<ConnectionListResponse, String> {
    let config = state.config.read().map_err(|e| e.to_string())?;
    
    Ok(ConnectionListResponse {
        connections: config.connections.clone(),
    })
}

/// Save a connection
#[tauri::command]
pub fn save_connection(
    state: State<AppState>,
    connection: SavedConnection,
) -> Result<(), String> {
    let mut config = state.config.write().map_err(|e| e.to_string())?;
    
    config.upsert_connection(connection.clone());
    config.save().map_err(|e| e.to_string())?;
    
    info!("Saved connection: {} ({})", connection.name, connection.id);
    Ok(())
}

/// Delete a connection
#[tauri::command]
pub fn delete_connection(state: State<AppState>, id: String) -> Result<(), String> {
    let mut config = state.config.write().map_err(|e| e.to_string())?;
    
    config.remove_connection(&id);
    config.save().map_err(|e| e.to_string())?;
    
    info!("Deleted connection: {}", id);
    Ok(())
}

/// Get current configuration
#[tauri::command]
pub fn get_config(state: State<AppState>) -> Result<Config, String> {
    let config = state.config.read().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

/// Save configuration
#[tauri::command]
pub fn save_config(state: State<AppState>, config: Config) -> Result<(), String> {
    let mut current = state.config.write().map_err(|e| e.to_string())?;
    *current = config;
    current.save().map_err(|e| e.to_string())?;
    
    info!("Configuration saved");
    Ok(())
}

/// Console info from Control Plane
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleInfoResponse {
    pub console_type: Option<String>,
    pub host: String,
    pub port: u32,
    pub password: Option<String>,
    pub websocket_url: Option<String>,
}

/// Get console info from the Control Plane
pub async fn get_console_info(
    control_plane_url: &str,
    vm_id: &str,
) -> Result<ConsoleInfoResponse, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!(
        "{}/limiquantix.compute.v1.VMService/GetConsole",
        control_plane_url.trim_end_matches('/')
    );

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "vmId": vm_id }))
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error ({}): {}", status, body).into());
    }

    let info: ConsoleInfoResponse = response.json().await?;
    Ok(info)
}

/// VM info from Control Plane
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VMInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub status: Option<VMStatus>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VMStatus {
    pub state: Option<String>,
    pub node_id: Option<String>,
}

/// Get VM info from the Control Plane
pub async fn get_vm_info(
    control_plane_url: &str,
    vm_id: &str,
) -> Result<VMInfo, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!(
        "{}/limiquantix.compute.v1.VMService/GetVM",
        control_plane_url.trim_end_matches('/')
    );

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "id": vm_id }))
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error ({}): {}", status, body).into());
    }

    let info: VMInfo = response.json().await?;
    Ok(info)
}

/// List VMs from the Control Plane
pub async fn list_vms(
    control_plane_url: &str,
) -> Result<Vec<VMInfo>, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!(
        "{}/limiquantix.compute.v1.VMService/ListVMs",
        control_plane_url.trim_end_matches('/')
    );

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({}))
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error ({}): {}", status, body).into());
    }

    #[derive(Deserialize)]
    struct ListResponse {
        vms: Option<Vec<VMInfo>>,
    }

    let list: ListResponse = response.json().await?;
    Ok(list.vms.unwrap_or_default())
}

// ============================================
// VM Power Actions
// ============================================

/// Execute a power action on a VM (start, stop, reboot, force_stop)
/// Actions match the backend REST API at /api/vms/{id}/{action}
#[tauri::command]
pub async fn vm_power_action(
    control_plane_url: String,
    vm_id: String,
    action: String,
) -> Result<(), String> {
    info!("Executing VM power action: {} on {}", action, vm_id);
    
    // Map action to gRPC endpoint
    let endpoint = match action.as_str() {
        "start" => "StartVM",
        "stop" => "StopVM",       // Graceful shutdown (ACPI)
        "reboot" => "RebootVM",
        "force_stop" => "StopVM", // Force power off (like pulling the plug)
        _ => return Err(format!("Unknown action: {}. Supported: start, stop, reboot, force_stop", action)),
    };
    
    let url = format!(
        "{}/limiquantix.compute.v1.VMService/{}",
        control_plane_url.trim_end_matches('/'),
        endpoint
    );
    
    // Build request body based on action
    let body = match action.as_str() {
        "stop" => serde_json::json!({ "id": vm_id, "force": false }),      // Graceful
        "force_stop" => serde_json::json!({ "id": vm_id, "force": true }), // Force
        _ => serde_json::json!({ "id": vm_id }),
    };
    
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("API error ({}): {}", status, error_body));
    }
    
    info!("VM {} action completed: {}", action, vm_id);
    Ok(())
}

// ============================================
// ISO Mount
// ============================================

/// Mount an ISO image to a VM
#[tauri::command]
pub async fn vm_mount_iso(
    control_plane_url: String,
    vm_id: String,
    iso_path: String,
) -> Result<(), String> {
    info!("Mounting ISO {} to VM {}", iso_path, vm_id);
    
    // This calls a custom endpoint - in a real implementation,
    // this would attach a CDROM device with the ISO
    let url = format!(
        "{}/limiquantix.compute.v1.VMService/AttachDevice",
        control_plane_url.trim_end_matches('/')
    );
    
    let body = serde_json::json!({
        "vmId": vm_id,
        "device": {
            "cdrom": {
                "path": iso_path
            }
        }
    });
    
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("API error ({}): {}", status, error_body));
    }
    
    info!("ISO mounted successfully");
    Ok(())
}

// ============================================
// File Browser (for local ISO selection)
// ============================================

/// Browse for a file using native dialog
#[tauri::command]
pub async fn browse_file(
    title: String,
    filters: Vec<FileFilter>,
) -> Result<Option<String>, String> {
    use tauri::api::dialog::FileDialogBuilder;
    use std::sync::mpsc;
    
    let (tx, rx) = mpsc::channel();
    
    let mut builder = FileDialogBuilder::new().set_title(&title);
    
    for filter in filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(|s| s.as_str()).collect();
        builder = builder.add_filter(&filter.name, &extensions);
    }
    
    builder.pick_file(move |path| {
        let _ = tx.send(path.map(|p| p.to_string_lossy().to_string()));
    });
    
    match rx.recv() {
        Ok(path) => Ok(path),
        Err(e) => {
            warn!("File dialog error: {}", e);
            Ok(None)
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

// ============================================
// Local ISO Server
// ============================================

use crate::iso_server::{IsoServerManager, NetworkInterface};
use std::path::PathBuf;

/// Start serving a local ISO file via HTTP
/// Returns the URL that the hypervisor can use to mount the ISO
#[tauri::command]
pub async fn start_iso_server(
    state: State<'_, IsoServerState>,
    iso_path: String,
) -> Result<IsoServerInfo, String> {
    let path = PathBuf::from(&iso_path);
    
    // Verify file exists and is an ISO
    if !path.exists() {
        return Err(format!("File not found: {}", iso_path));
    }
    
    if path.extension().and_then(|e| e.to_str()) != Some("iso") {
        warn!("File may not be an ISO: {}", iso_path);
    }
    
    let url = state.manager.start_serving(path.clone()).await?;
    
    info!("ISO server started: {} -> {}", iso_path, url);
    
    Ok(IsoServerInfo {
        url,
        local_path: iso_path,
        is_serving: true,
    })
}

/// Stop the ISO server
#[tauri::command]
pub async fn stop_iso_server(
    state: State<'_, IsoServerState>,
) -> Result<(), String> {
    state.manager.stop_serving().await;
    info!("ISO server stopped");
    Ok(())
}

/// Get current ISO server status
#[tauri::command]
pub async fn get_iso_server_status(
    state: State<'_, IsoServerState>,
) -> Result<Option<IsoServerInfo>, String> {
    let url = state.manager.get_current_url().await;
    
    Ok(url.map(|url| IsoServerInfo {
        url,
        local_path: String::new(), // Could store this in state if needed
        is_serving: true,
    }))
}

/// Get available network interfaces
#[tauri::command]
pub fn get_network_interfaces() -> Vec<NetworkInterface> {
    crate::iso_server::get_network_interfaces()
}

/// ISO server info returned to frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct IsoServerInfo {
    pub url: String,
    pub local_path: String,
    pub is_serving: bool,
}

/// State wrapper for ISO server manager
pub struct IsoServerState {
    pub manager: IsoServerManager,
}

impl IsoServerState {
    pub fn new() -> Self {
        Self {
            manager: IsoServerManager::new(),
        }
    }
}
