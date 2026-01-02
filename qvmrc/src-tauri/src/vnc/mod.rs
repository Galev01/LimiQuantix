//! VNC (RFB Protocol) Client Implementation
//!
//! This module implements a VNC client following RFC 6143.
//! It provides:
//! - Connection management
//! - Authentication (None, VNC Auth)
//! - Framebuffer handling
//! - Input events (keyboard, mouse)

mod rfb;
mod encodings;

use crate::api;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{State, Window};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex, RwLock};
use tracing::{error, info, warn};

pub use rfb::{PixelFormat, RFBClient, RFBError};

/// Connection status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Authenticating,
    Connected,
    Error,
}

/// VNC connection state
#[derive(Debug)]
pub struct VNCConnection {
    /// Connection ID
    pub id: String,
    /// VM ID in control plane
    pub vm_id: String,
    /// Current status
    pub status: ConnectionStatus,
    /// VNC host
    pub host: String,
    /// VNC port
    pub port: u16,
    /// RFB client
    pub client: Option<Arc<Mutex<RFBClient>>>,
    /// Shutdown signal
    pub shutdown_tx: Option<mpsc::Sender<()>>,
}

impl VNCConnection {
    pub fn new(id: String, vm_id: String) -> Self {
        Self {
            id,
            vm_id,
            status: ConnectionStatus::Disconnected,
            host: String::new(),
            port: 0,
            client: None,
            shutdown_tx: None,
        }
    }
}

/// Connect to a VM's VNC console
#[tauri::command]
pub async fn connect_vnc(
    window: Window,
    state: State<'_, AppState>,
    control_plane_url: String,
    vm_id: String,
    password: Option<String>,
) -> Result<String, String> {
    info!("Connecting to VM {} via {}", vm_id, control_plane_url);

    // Get console info from control plane
    let console_info = api::get_console_info(&control_plane_url, &vm_id)
        .await
        .map_err(|e| format!("Failed to get console info: {}", e))?;

    let host = console_info.host;
    let port = console_info.port as u16;
    let vnc_password = password.or(console_info.password);

    info!("Connecting to VNC at {}:{}", host, port);

    // Create connection ID
    let connection_id = format!("vnc-{}", uuid::Uuid::new_v4());

    // Create RFB client
    let mut client = RFBClient::connect(&host, port)
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    // Perform handshake
    client
        .handshake(vnc_password.as_deref())
        .await
        .map_err(|e| format!("Handshake failed: {}", e))?;

    info!(
        "VNC connected: {}x{} @ {}bpp",
        client.width, client.height, client.pixel_format.bits_per_pixel
    );

    // Emit connection event
    window
        .emit(
            "vnc:connected",
            serde_json::json!({
                "connectionId": connection_id,
                "width": client.width,
                "height": client.height,
            }),
        )
        .ok();

    // Create shutdown channel
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

    // Wrap client in Arc<Mutex>
    let client = Arc::new(Mutex::new(client));
    let client_clone = client.clone();

    // Store connection
    {
        let mut connections = state.connections.write().map_err(|e| e.to_string())?;
        connections.push(VNCConnection {
            id: connection_id.clone(),
            vm_id: vm_id.clone(),
            status: ConnectionStatus::Connected,
            host: host.clone(),
            port,
            client: Some(client),
            shutdown_tx: Some(shutdown_tx),
        });
    }

    // Spawn framebuffer update loop
    let window_clone = window.clone();
    let connection_id_clone = connection_id.clone();
    
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    info!("VNC connection {} shutting down", connection_id_clone);
                    break;
                }
                result = async {
                    let mut client = client_clone.lock().await;
                    client.request_framebuffer_update(true).await
                } => {
                    match result {
                        Ok(updates) => {
                            // Emit framebuffer updates to frontend
                            for update in updates {
                                window_clone.emit("vnc:framebuffer", update).ok();
                            }
                        }
                        Err(e) => {
                            error!("Framebuffer update error: {}", e);
                            window_clone.emit("vnc:error", e.to_string()).ok();
                            break;
                        }
                    }
                }
            }

            // Small delay to prevent busy loop
            tokio::time::sleep(tokio::time::Duration::from_millis(16)).await;
        }

        window_clone.emit("vnc:disconnected", &connection_id_clone).ok();
    });

    Ok(connection_id)
}

/// Disconnect from VNC
#[tauri::command]
pub async fn disconnect_vnc(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    info!("Disconnecting VNC connection {}", connection_id);

    let mut connections = state.connections.write().map_err(|e| e.to_string())?;

    if let Some(conn) = connections.iter_mut().find(|c| c.id == connection_id) {
        // Send shutdown signal
        if let Some(tx) = conn.shutdown_tx.take() {
            tx.send(()).await.ok();
        }
        conn.status = ConnectionStatus::Disconnected;
        conn.client = None;
    }

    // Remove the connection
    connections.retain(|c| c.id != connection_id);

    Ok(())
}

/// Send a key event
#[tauri::command]
pub async fn send_key_event(
    state: State<'_, AppState>,
    connection_id: String,
    key: u32,
    down: bool,
) -> Result<(), String> {
    let connections = state.connections.read().map_err(|e| e.to_string())?;

    if let Some(conn) = connections.iter().find(|c| c.id == connection_id) {
        if let Some(client) = &conn.client {
            let mut client = client.lock().await;
            client
                .send_key_event(key, down)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Send a pointer (mouse) event
#[tauri::command]
pub async fn send_pointer_event(
    state: State<'_, AppState>,
    connection_id: String,
    x: u16,
    y: u16,
    buttons: u8,
) -> Result<(), String> {
    let connections = state.connections.read().map_err(|e| e.to_string())?;

    if let Some(conn) = connections.iter().find(|c| c.id == connection_id) {
        if let Some(client) = &conn.client {
            let mut client = client.lock().await;
            client
                .send_pointer_event(x, y, buttons)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Send Ctrl+Alt+Del
#[tauri::command]
pub async fn send_ctrl_alt_del(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    let connections = state.connections.read().map_err(|e| e.to_string())?;

    if let Some(conn) = connections.iter().find(|c| c.id == connection_id) {
        if let Some(client) = &conn.client {
            let mut client = client.lock().await;
            client
                .send_ctrl_alt_del()
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    info!("Sent Ctrl+Alt+Del to {}", connection_id);
    Ok(())
}

/// Get connection status
#[tauri::command]
pub fn get_connection_status(
    state: State<AppState>,
    connection_id: String,
) -> Result<ConnectionStatus, String> {
    let connections = state.connections.read().map_err(|e| e.to_string())?;

    if let Some(conn) = connections.iter().find(|c| c.id == connection_id) {
        Ok(conn.status.clone())
    } else {
        Ok(ConnectionStatus::Disconnected)
    }
}
