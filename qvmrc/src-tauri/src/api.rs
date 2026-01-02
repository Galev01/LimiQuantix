//! Tauri API commands for configuration and Control Plane communication

use crate::config::{Config, DisplaySettings, SavedConnection};
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;
use tracing::{error, info};

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
