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
use tauri::Manager;
use tracing::{info, warn, Level};
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
#[tauri::command]
fn get_pending_connection(state: tauri::State<AppState>) -> Option<PendingConnection> {
    let mut pending = state.pending_connection.write().ok()?;
    pending.take()
}

/// Save connection and mark as pending for immediate connect
#[tauri::command]
fn add_and_connect(
    state: tauri::State<AppState>,
    control_plane_url: String,
    vm_id: String,
    vm_name: String,
) -> Result<String, String> {
    let connection_id = format!("conn-{}", uuid::Uuid::new_v4());
    
    let connection = SavedConnection {
        id: connection_id.clone(),
        name: vm_name.clone(),
        control_plane_url,
        vm_id,
        last_connected: Some(chrono::Utc::now().to_rfc3339()),
        thumbnail: None,
    };
    
    // Save connection
    {
        let mut config = state.config.write().map_err(|e| e.to_string())?;
        config.upsert_connection(connection);
        config.save().map_err(|e| e.to_string())?;
    }
    
    info!("Added connection: {} ({})", vm_name, connection_id);
    Ok(connection_id)
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
            info!("Deep link detected: {}", arg);
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
        pending_connection: std::sync::RwLock::new(pending_conn),
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
        .setup(|app| {
            let _window = app.get_window("main").unwrap();
            
            #[cfg(debug_assertions)]
            {
                // Open devtools in debug mode
                _window.open_devtools();
            }
            
            info!("QVMRC initialized successfully");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error running QVMRC");
}
