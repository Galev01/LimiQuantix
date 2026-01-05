//! VNC (RFB Protocol) Client Implementation
//!
//! This module implements a VNC client following RFC 6143.
//! It provides:
//! - Connection management
//! - Authentication (None, VNC Auth)
//! - Framebuffer handling
//! - Input events (keyboard, mouse)

mod encodings;
pub mod keysym;
mod rfb;

use crate::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{State, Window};
use tokio::sync::{mpsc, Mutex};
use tracing::{error, info};

pub use rfb::RFBClient;

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

/// Connect to a VM's VNC console via WebSocket proxy
/// 
/// This connects through the Control Plane's WebSocket proxy which handles
/// the actual VNC connection server-side. This allows QVMRC to work even
/// when the VNC server is not directly accessible (e.g., bound to localhost).
#[tauri::command]
pub async fn connect_vnc(
    window: Window,
    state: State<'_, AppState>,
    control_plane_url: String,
    vm_id: String,
    password: Option<String>,
) -> Result<String, String> {
    info!("Connecting to VM {} via {}", vm_id, control_plane_url);

    // Build WebSocket URL for the control plane's console proxy
    // The proxy handles the VNC connection server-side and forwards raw RFB data
    let ws_url = build_websocket_url(&control_plane_url, &vm_id)?;
    
    info!("Connecting to VNC via WebSocket proxy: {}", ws_url);

    // Create connection ID
    let connection_id = format!("vnc-{}", uuid::Uuid::new_v4());

    // Create RFB client via WebSocket
    let mut client = RFBClient::connect_websocket(&ws_url)
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    // Perform VNC handshake (the proxy transparently passes RFB protocol)
    // Note: Authentication is handled by the VNC server, not the proxy
    client
        .handshake(password.as_deref())
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
            host: control_plane_url.clone(),
            port: 0, // Not used for WebSocket connections
            client: Some(client),
            shutdown_tx: Some(shutdown_tx),
        });
    }

    // Spawn framebuffer update loop
    let window_clone = window.clone();
    let connection_id_clone = connection_id.clone();
    
    tokio::spawn(async move {
        // First request should be non-incremental (full screen refresh)
        let mut is_first_request = true;
        
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    info!("VNC connection {} shutting down", connection_id_clone);
                    break;
                }
                result = async {
                    let mut client = client_clone.lock().await;
                    // First request is non-incremental to get the full framebuffer
                    let incremental = !is_first_request;
                    let updates = client.request_framebuffer_update(incremental).await;
                    
                    // Check for clipboard updates from server
                    let clipboard = client.take_server_clipboard();
                    
                    (updates, clipboard)
                } => {
                    let (updates_result, clipboard) = result;
                    
                    // Emit clipboard if server sent new text
                    if let Some(text) = clipboard {
                        window_clone.emit("vnc:clipboard", serde_json::json!({
                            "connectionId": connection_id_clone,
                            "text": text,
                        })).ok();
                    }
                    
                    match updates_result {
                        Ok(updates) => {
                            if !updates.is_empty() {
                                // Calculate non-zero pixels for first update
                                let non_zero = updates[0].data.iter().filter(|&&b| b != 0).count();
                                info!(
                                    "Received {} framebuffer updates, first: {}x{} at ({},{}), {} bytes, {} non-zero bytes",
                                    updates.len(),
                                    updates[0].width,
                                    updates[0].height,
                                    updates[0].x,
                                    updates[0].y,
                                    updates[0].data.len(),
                                    non_zero
                                );
                                
                                // Log first few bytes for debugging
                                if updates[0].data.len() >= 16 {
                                    info!(
                                        "First 16 bytes: {:?}",
                                        &updates[0].data[0..16]
                                    );
                                }
                            } else {
                                info!("Received empty framebuffer update (0 rects)");
                            }
                            // Emit framebuffer updates to frontend
                            for update in updates {
                                if let Err(e) = window_clone.emit("vnc:framebuffer", &update) {
                                    error!("Failed to emit framebuffer update: {}", e);
                                }
                            }
                            // After first successful update, switch to incremental
                            is_first_request = false;
                        }
                        Err(e) => {
                            error!("Framebuffer update error: {}", e);
                            window_clone.emit("vnc:error", e.to_string()).ok();
                            break;
                        }
                    }
                }
            }

            // Small delay to prevent busy loop (60fps = ~16ms)
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

    // Extract the shutdown_tx before awaiting (to avoid holding lock across await)
    let shutdown_tx = {
        let mut connections = state.connections.write().map_err(|e| e.to_string())?;
        if let Some(conn) = connections.iter_mut().find(|c| c.id == connection_id) {
            conn.status = ConnectionStatus::Disconnected;
            conn.client = None;
            conn.shutdown_tx.take()
        } else {
            None
        }
    };

    // Send shutdown signal (outside the lock)
    if let Some(tx) = shutdown_tx {
        tx.send(()).await.ok();
    }

    // Remove the connection
    {
        let mut connections = state.connections.write().map_err(|e| e.to_string())?;
        connections.retain(|c| c.id != connection_id);
    }

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
    // Clone the client Arc outside the lock
    let client = {
        let connections = state.connections.read().map_err(|e| e.to_string())?;
        connections
            .iter()
            .find(|c| c.id == connection_id)
            .and_then(|c| c.client.clone())
    };

    if let Some(client) = client {
        let mut client = client.lock().await;
        client
            .send_key_event(key, down)
            .await
            .map_err(|e| e.to_string())?;
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
    // Clone the client Arc outside the lock
    let client = {
        let connections = state.connections.read().map_err(|e| e.to_string())?;
        connections
            .iter()
            .find(|c| c.id == connection_id)
            .and_then(|c| c.client.clone())
    };

    if let Some(client) = client {
        let mut client = client.lock().await;
        client
            .send_pointer_event(x, y, buttons)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Send Ctrl+Alt+Del
#[tauri::command]
pub async fn send_ctrl_alt_del(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    // Clone the client Arc outside the lock
    let client = {
        let connections = state.connections.read().map_err(|e| e.to_string())?;
        connections
            .iter()
            .find(|c| c.id == connection_id)
            .and_then(|c| c.client.clone())
    };

    if let Some(client) = client {
        let mut client = client.lock().await;
        client
            .send_ctrl_alt_del()
            .await
            .map_err(|e| e.to_string())?;
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

/// Connection info including resolution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub id: String,
    pub vm_id: String,
    pub status: ConnectionStatus,
    pub width: u16,
    pub height: u16,
}

/// Get connection info including resolution
#[tauri::command]
pub async fn get_connection_info(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Option<ConnectionInfo>, String> {
    // First get basic info from connections
    let (vm_id, status, client) = {
        let connections = state.connections.read().map_err(|e| e.to_string())?;
        if let Some(conn) = connections.iter().find(|c| c.id == connection_id) {
            (conn.vm_id.clone(), conn.status.clone(), conn.client.clone())
        } else {
            return Ok(None);
        }
    };

    // Get resolution from client if available
    let (width, height) = if let Some(client) = client {
        let client = client.lock().await;
        (client.width, client.height)
    } else {
        (0, 0)
    };

    Ok(Some(ConnectionInfo {
        id: connection_id,
        vm_id,
        status,
        width,
        height,
    }))
}

/// Send clipboard text to the VM
#[tauri::command]
pub async fn send_clipboard(
    state: State<'_, AppState>,
    connection_id: String,
    text: String,
) -> Result<(), String> {
    // Clone the client Arc outside the lock
    let client = {
        let connections = state.connections.read().map_err(|e| e.to_string())?;
        connections
            .iter()
            .find(|c| c.id == connection_id)
            .and_then(|c| c.client.clone())
    };

    if let Some(client) = client {
        let mut client = client.lock().await;
        client
            .send_clipboard(&text)
            .await
            .map_err(|e| e.to_string())?;
        info!("Sent clipboard to VM: {} chars", text.len());
    }

    Ok(())
}

/// Get clipboard text from the VM (if any new text received)
#[tauri::command]
pub async fn get_vm_clipboard(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Option<String>, String> {
    // Clone the client Arc outside the lock
    let client = {
        let connections = state.connections.read().map_err(|e| e.to_string())?;
        connections
            .iter()
            .find(|c| c.id == connection_id)
            .and_then(|c| c.client.clone())
    };

    if let Some(client) = client {
        let mut client = client.lock().await;
        let text = client.take_server_clipboard();
        if text.is_some() {
            info!("Got clipboard from VM");
        }
        return Ok(text);
    }

    Ok(None)
}

/// Build WebSocket URL for the control plane's console proxy
/// 
/// Converts HTTP/HTTPS URL to WS/WSS and appends the console path
/// Example: http://localhost:8080 -> ws://localhost:8080/api/console/{vmId}/ws
fn build_websocket_url(control_plane_url: &str, vm_id: &str) -> Result<String, String> {
    let base = control_plane_url.trim_end_matches('/');
    
    // Convert HTTP scheme to WebSocket scheme
    let ws_base = if base.starts_with("https://") {
        base.replacen("https://", "wss://", 1)
    } else if base.starts_with("http://") {
        base.replacen("http://", "ws://", 1)
    } else if base.starts_with("wss://") || base.starts_with("ws://") {
        base.to_string()
    } else {
        // Assume http if no scheme provided
        format!("ws://{}", base)
    };
    
    // Append console proxy path
    let ws_url = format!("{}/api/console/{}/ws", ws_base, vm_id);
    
    Ok(ws_url)
}
