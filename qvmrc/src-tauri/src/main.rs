// QVMRC - Quantix Virtual Machine Remote Console
// Main entry point for the Tauri application

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod api;
mod config;
mod vnc;

use tauri::Manager;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

/// Application state shared across commands
pub struct AppState {
    /// Configuration
    pub config: std::sync::RwLock<config::Config>,
    /// Active VNC connections
    pub connections: std::sync::RwLock<Vec<vnc::VNCConnection>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            config: std::sync::RwLock::new(config::Config::load().unwrap_or_default()),
            connections: std::sync::RwLock::new(Vec::new()),
        }
    }
}

fn main() {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(false)
        .pretty()
        .init();

    info!("Starting QVMRC v{}", env!("CARGO_PKG_VERSION"));

    tauri::Builder::default()
        .manage(AppState::default())
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
        ])
        .setup(|app| {
            let window = app.get_window("main").unwrap();
            
            #[cfg(debug_assertions)]
            {
                // Open devtools in debug mode
                window.open_devtools();
            }
            
            info!("QVMRC initialized successfully");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error running QVMRC");
}
