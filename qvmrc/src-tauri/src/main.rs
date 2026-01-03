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
    debug_log("get_pending_connection called by frontend");
    info!("get_pending_connection called");
    
    let mut pending = match state.pending_connection.write() {
        Ok(guard) => guard,
        Err(e) => {
            debug_log(&format!("Failed to acquire write lock: {:?}", e));
            return None;
        }
    };
    
    debug_log(&format!("Current pending value: {:?}", *pending));
    
    let result = pending.take();
    if let Some(ref conn) = result {
        info!("Returning pending connection: {:?}", conn);
        debug_log(&format!("Returning pending connection: {:?}", conn));
    } else {
        info!("No pending connection found");
        debug_log("No pending connection found - returning None");
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

/// Write debug info to a log file for troubleshooting
fn debug_log(msg: &str) {
    use std::io::Write;
    if let Some(home) = dirs::home_dir() {
        let log_path = home.join("qvmrc-debug.log");
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let _ = writeln!(file, "[{}] {}", timestamp, msg);
        }
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
    debug_log(&format!("Starting QVMRC v{}", env!("CARGO_PKG_VERSION")));

    // Check for deep link URL in command line args
    let args: Vec<String> = std::env::args().collect();
    debug_log(&format!("Command line args: {:?}", args));
    
    let mut pending_conn: Option<PendingConnection> = None;
    
    for arg in &args[1..] {
        debug_log(&format!("Checking arg: {}", arg));
        if arg.starts_with("qvmrc://") {
            info!("Deep link detected in args: {}", arg);
            debug_log(&format!("Deep link detected: {}", arg));
            if let Some(conn) = parse_qvmrc_url(arg) {
                info!("Parsed connection: {:?}", conn);
                debug_log(&format!("Parsed connection: {:?}", conn));
                pending_conn = Some(conn);
            } else {
                warn!("Failed to parse deep link URL: {}", arg);
                debug_log(&format!("FAILED to parse deep link URL: {}", arg));
            }
            break;
        }
    }

    debug_log(&format!("pending_conn before AppState: {:?}", pending_conn));

    // Build AppState with the pending connection
    let app_state = AppState {
        config: std::sync::RwLock::new(config::Config::load().unwrap_or_default()),
        connections: std::sync::RwLock::new(Vec::new()),
        pending_connection: std::sync::RwLock::new(pending_conn),
    };

    // Verify it was set
    if let Ok(guard) = app_state.pending_connection.read() {
        debug_log(&format!("AppState pending_connection after creation: {:?}", *guard));
    }

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
            debug_log("Tauri setup running");
            
            let window = app.get_window("main").unwrap();
            
            #[cfg(debug_assertions)]
            {
                // Open devtools in debug mode
                window.open_devtools();
            }
            
            debug_log("QVMRC initialized successfully");
            info!("QVMRC initialized successfully");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error running QVMRC");
}
