// QVMRC - Quantix Virtual Machine Remote Console
// Main entry point for the Tauri application

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod api;
mod config;
mod vnc;

use config::SavedConnection;
use tauri::{Manager, AppHandle};
use tracing::{info, warn, error, Level};
use tracing_subscriber::FmtSubscriber;

/// Application state shared across commands
pub struct AppState {
    /// Configuration
    pub config: std::sync::RwLock<config::Config>,
    /// Active VNC connections
    pub connections: std::sync::RwLock<Vec<vnc::VNCConnection>>,
    /// Pending connection from deep link (to be picked up by frontend)
    pub pending_connection: std::sync::RwLock<Option<PendingConnection>>,
}

/// Pending connection info from deep link
#[derive(Debug, Clone, serde::Serialize)]
pub struct PendingConnection {
    pub control_plane_url: String,
    pub vm_id: String,
    pub vm_name: String,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            config: std::sync::RwLock::new(config::Config::load().unwrap_or_default()),
            connections: std::sync::RwLock::new(Vec::new()),
            pending_connection: std::sync::RwLock::new(None),
        }
    }
}

/// Parse a qvmrc:// URL into connection parameters
fn parse_qvmrc_url(url: &str) -> Option<PendingConnection> {
    // Format: qvmrc://connect?url=<encoded>&vmId=<id>&vmName=<name>
    let url = url.strip_prefix("qvmrc://connect?")?;
    
    let mut control_plane_url = None;
    let mut vm_id = None;
    let mut vm_name = None;
    
    for part in url.split('&') {
        let mut kv = part.splitn(2, '=');
        let key = kv.next()?;
        let value = kv.next().unwrap_or("");
        let decoded = urlencoding::decode(value).ok()?.into_owned();
        
        match key {
            "url" => control_plane_url = Some(decoded),
            "vmId" => vm_id = Some(decoded),
            "vmName" => vm_name = Some(decoded),
            _ => {}
        }
    }
    
    Some(PendingConnection {
        control_plane_url: control_plane_url?,
        vm_id: vm_id?,
        vm_name: vm_name.unwrap_or_else(|| "Unknown VM".to_string()),
    })
}

/// Get pending connection (called by frontend on startup)
/// This will consume the pending connection to prevent double-processing
#[tauri::command]
fn get_pending_connection(state: tauri::State<AppState>) -> Option<PendingConnection> {
    info!("get_pending_connection called");
    let mut pending = state.pending_connection.write().ok()?;
    let result = pending.take();
    if let Some(ref conn) = result {
        info!("Returning pending connection: {:?}", conn);
    } else {
        info!("No pending connection found");
    }
    result
}

/// Save connection and mark as pending for immediate connect
#[tauri::command]
fn add_and_connect(
    state: tauri::State<AppState>,
    control_plane_url: String,
    vm_id: String,
    vm_name: String,
) -> Result<String, String> {
    // Check if connection with same vm_id already exists
    let mut config = state.config.write().map_err(|e| e.to_string())?;
    
    let connection_id = if let Some(existing) = config.connections.iter().find(|c| c.vm_id == vm_id) {
        existing.id.clone()
    } else {
        format!("conn-{}", uuid::Uuid::new_v4())
    };
    
    let connection = SavedConnection {
        id: connection_id.clone(),
        name: vm_name.clone(),
        control_plane_url,
        vm_id,
        last_connected: Some(chrono::Utc::now().to_rfc3339()),
        thumbnail: None,
    };
    
    // Save connection (will update if exists with same id)
    config.upsert_connection(connection);
    config.save().map_err(|e| e.to_string())?;
    
    info!("Added/updated connection: {} ({})", vm_name, connection_id);
    Ok(connection_id)
}

/// Handle incoming deep link URL and emit event to frontend
fn handle_deep_link(app: &AppHandle, url: &str) {
    info!("Processing deep link: {}", url);
    
    if let Some(conn) = parse_qvmrc_url(url) {
        info!("Parsed connection from deep link: {:?}", conn);
        
        // Emit event to frontend to handle the connection
        if let Err(e) = app.emit_all("deep-link-received", conn) {
            error!("Failed to emit deep link event: {}", e);
        }
        
        // Focus the window
        if let Some(window) = app.get_window("main") {
            let _ = window.set_focus();
            let _ = window.unminimize();
        }
    } else {
        warn!("Failed to parse deep link URL: {}", url);
    }
}

fn main() {
    // Initialize logging
    let _subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(false)
        .pretty()
        .init();

    info!("Starting QVMRC v{}", env!("CARGO_PKG_VERSION"));

    // Check for deep link URL in command line args
    let args: Vec<String> = std::env::args().collect();
    let mut pending_conn: Option<PendingConnection> = None;
    
    for arg in &args[1..] {
        if arg.starts_with("qvmrc://") {
            info!("Deep link detected in args: {}", arg);
            if let Some(conn) = parse_qvmrc_url(arg) {
                info!("Parsed connection: {:?}", conn);
                pending_conn = Some(conn);
            } else {
                warn!("Failed to parse deep link URL: {}", arg);
            }
            break;
        }
    }

    let app_state = AppState {
        pending_connection: std::sync::RwLock::new(pending_conn.clone()),
        ..Default::default()
    };

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // API commands
            api::get_saved_connections,
            api::save_connection,
            api::delete_connection,
            api::get_config,
            api::save_config,
            // VNC commands
            vnc::connect_vnc,
            vnc::disconnect_vnc,
            vnc::send_key_event,
            vnc::send_pointer_event,
            vnc::send_ctrl_alt_del,
            vnc::get_connection_status,
            // Deep link commands
            get_pending_connection,
            add_and_connect,
        ])
        .setup(move |app| {
            let window = app.get_window("main").unwrap();
            
            #[cfg(debug_assertions)]
            {
                // Open devtools in debug mode
                window.open_devtools();
            }
            
            // DON'T emit event here - the frontend will call get_pending_connection
            // The event system has a race condition where the listener isn't ready yet
            if let Some(ref conn) = pending_conn {
                info!("Pending connection will be picked up by frontend: {:?}", conn);
            }
            
            info!("QVMRC initialized successfully");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error running QVMRC");
}
