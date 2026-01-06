//! Quantix-OS Console GUI
//!
//! This is the main entry point for the Quantix-OS console (DCUI).
//! It provides local management of the hypervisor node.

use anyhow::{Context, Result};
use slint::SharedString;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info, warn};

mod auth;
mod config;
mod network;
mod ssh;
mod system_info;

slint::include_modules!();

/// Application state
struct AppState {
    /// Whether the setup wizard has been completed
    setup_complete: bool,
    /// Current authenticated user (if any)
    authenticated_user: Option<String>,
    /// Pending action requiring authentication
    pending_action: Option<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            setup_complete: config::is_setup_complete(),
            authenticated_user: None,
            pending_action: None,
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("qx_console_gui=info".parse().unwrap()),
        )
        .init();

    info!("🚀 Starting Quantix-OS Console GUI");

    // Create the main window
    let app = AppWindow::new().context("Failed to create application window")?;

    // Initialize application state
    let state = Arc::new(Mutex::new(AppState::default()));

    // Check if first boot (wizard needed)
    let show_wizard = !config::is_setup_complete();
    app.set_show_wizard(show_wizard);

    if show_wizard {
        info!("📋 First boot detected, showing installation wizard");
        setup_wizard_callbacks(&app, state.clone());
    } else {
        info!("✅ Setup complete, showing main dashboard");
        setup_main_callbacks(&app, state.clone());
    }

    // Load initial data
    load_network_interfaces(&app);
    update_system_status(&app);

    // Start background refresh task
    let app_weak = app.as_weak();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            interval.tick().await;
            if let Some(app) = app_weak.upgrade() {
                update_system_status(&app);
            } else {
                break;
            }
        }
    });

    // Run the application
    app.run().context("Application error")?;

    info!("👋 Quantix-OS Console GUI shutting down");
    Ok(())
}

/// Setup callbacks for the installation wizard
fn setup_wizard_callbacks(app: &AppWindow, state: Arc<Mutex<AppState>>) {
    // Wizard navigation
    let app_weak = app.as_weak();
    app.on_wizard_next(move || {
        if let Some(app) = app_weak.upgrade() {
            let current = app.get_wizard_step();
            if current < 4 {
                app.set_wizard_step(current + 1);
            }
        }
    });

    let app_weak = app.as_weak();
    app.on_wizard_prev(move || {
        if let Some(app) = app_weak.upgrade() {
            let current = app.get_wizard_step();
            if current > 1 {
                app.set_wizard_step(current - 1);
            }
        }
    });

    // Wizard completion
    let app_weak = app.as_weak();
    let state_clone = state.clone();
    app.on_wizard_complete(move |config| {
        info!("📝 Installation wizard completed");

        // Validate configuration
        if config.hostname.is_empty() {
            warn!("⚠️ Hostname is required");
            return;
        }
        if config.admin_username.is_empty() {
            warn!("⚠️ Admin username is required");
            return;
        }
        if config.admin_password.is_empty() {
            warn!("⚠️ Admin password is required");
            return;
        }
        if config.admin_password != config.confirm_password {
            warn!("⚠️ Passwords do not match");
            return;
        }

        // Save configuration
        let cfg = config::NodeConfig {
            hostname: config.hostname.to_string(),
            admin_username: config.admin_username.to_string(),
            admin_password_hash: auth::hash_password(&config.admin_password).unwrap_or_default(),
            network_interface: config.network_interface.to_string(),
            use_dhcp: config.use_dhcp,
            static_ip: config.static_ip.to_string(),
            gateway: config.gateway.to_string(),
            dns: config.dns.to_string(),
            ssh_enabled: config.enable_ssh,
        };

        if let Err(e) = config::save_config(&cfg) {
            error!("❌ Failed to save configuration: {}", e);
            return;
        }

        // Apply network configuration
        if let Err(e) = network::apply_config(&cfg) {
            warn!("⚠️ Failed to apply network configuration: {}", e);
        }

        // Enable/disable SSH
        if cfg.ssh_enabled {
            if let Err(e) = ssh::enable_ssh() {
                warn!("⚠️ Failed to enable SSH: {}", e);
            }
        }

        // Mark setup as complete
        if let Err(e) = config::mark_setup_complete() {
            error!("❌ Failed to mark setup complete: {}", e);
            return;
        }

        // Update state
        let state = state_clone.clone();
        tokio::spawn(async move {
            let mut state = state.lock().await;
            state.setup_complete = true;
        });

        // Switch to main screen
        if let Some(app) = app_weak.upgrade() {
            app.set_show_wizard(false);
            update_system_status(&app);
            info!("✅ Setup complete, switching to main dashboard");
        }
    });
}

/// Setup callbacks for the main dashboard
fn setup_main_callbacks(app: &AppWindow, state: Arc<Mutex<AppState>>) {
    // Menu action handler
    let app_weak = app.as_weak();
    let state_clone = state.clone();
    app.on_menu_action(move |action| {
        let action_str = action.to_string();
        info!("📋 Menu action: {}", action_str);

        let state = state_clone.clone();
        let app_weak = app_weak.clone();

        tokio::spawn(async move {
            let state_guard = state.lock().await;
            let is_authenticated = state_guard.authenticated_user.is_some();
            drop(state_guard);

            // Actions that require authentication
            let requires_auth = matches!(
                action_str.as_str(),
                "network" | "ssh" | "cluster" | "services" | "power" | "shell"
            );

            if requires_auth && !is_authenticated {
                // Show auth dialog
                if let Some(app) = app_weak.upgrade() {
                    let mut state = state.lock().await;
                    state.pending_action = Some(action_str.clone());
                    drop(state);

                    app.set_auth_dialog_title(SharedString::from(format!(
                        "Authentication Required: {}",
                        action_str
                    )));
                    app.set_show_auth_dialog(true);
                }
                return;
            }

            // Execute action
            handle_action(&action_str, &app_weak).await;
        });
    });

    // Authentication callbacks
    let app_weak = app.as_weak();
    let state_clone = state.clone();
    app.on_auth_submit(move |username, password| {
        let username = username.to_string();
        let password = password.to_string();
        let state = state_clone.clone();
        let app_weak = app_weak.clone();

        tokio::spawn(async move {
            // Verify credentials
            match auth::verify_password(&username, &password) {
                Ok(true) => {
                    info!("✅ Authentication successful for user: {}", username);

                    let mut state_guard = state.lock().await;
                    state_guard.authenticated_user = Some(username);
                    let pending = state_guard.pending_action.take();
                    drop(state_guard);

                    if let Some(app) = app_weak.upgrade() {
                        app.set_show_auth_dialog(false);
                        app.set_auth_error(SharedString::default());
                    }

                    // Execute pending action
                    if let Some(action) = pending {
                        handle_action(&action, &app_weak).await;
                    }
                }
                Ok(false) => {
                    warn!("⚠️ Authentication failed for user: {}", username);
                    if let Some(app) = app_weak.upgrade() {
                        app.set_auth_error(SharedString::from("Invalid username or password"));
                    }
                }
                Err(e) => {
                    error!("❌ Authentication error: {}", e);
                    if let Some(app) = app_weak.upgrade() {
                        app.set_auth_error(SharedString::from("Authentication error"));
                    }
                }
            }
        });
    });

    let app_weak = app.as_weak();
    let state_clone = state.clone();
    app.on_auth_cancel(move || {
        if let Some(app) = app_weak.upgrade() {
            app.set_show_auth_dialog(false);
            app.set_auth_error(SharedString::default());
        }

        let state = state_clone.clone();
        tokio::spawn(async move {
            let mut state = state.lock().await;
            state.pending_action = None;
        });
    });

    // Confirm dialog callbacks
    let app_weak = app.as_weak();
    app.on_confirm_action(move || {
        if let Some(app) = app_weak.upgrade() {
            app.set_show_confirm_dialog(false);
        }
        // Action is handled by the specific menu action
    });

    let app_weak = app.as_weak();
    app.on_confirm_cancel(move || {
        if let Some(app) = app_weak.upgrade() {
            app.set_show_confirm_dialog(false);
        }
    });
}

/// Handle menu actions
async fn handle_action(action: &str, app_weak: &slint::Weak<AppWindow>) {
    match action {
        "network" => {
            info!("🌐 Opening network configuration...");
            // TODO: Implement network configuration dialog
        }
        "ssh" => {
            info!("🔐 Toggling SSH...");
            let ssh_enabled = ssh::is_enabled();
            if ssh_enabled {
                if let Err(e) = ssh::disable_ssh() {
                    error!("❌ Failed to disable SSH: {}", e);
                } else {
                    info!("✅ SSH disabled");
                }
            } else {
                if let Err(e) = ssh::enable_ssh() {
                    error!("❌ Failed to enable SSH: {}", e);
                } else {
                    info!("✅ SSH enabled");
                }
            }
            if let Some(app) = app_weak.upgrade() {
                update_system_status(&app);
            }
        }
        "cluster" => {
            info!("🔗 Opening cluster join dialog...");
            // TODO: Implement cluster join dialog
        }
        "services" => {
            info!("🔄 Restarting services...");
            // TODO: Implement service restart
        }
        "diagnostics" => {
            info!("📊 Opening diagnostics...");
            // TODO: Implement diagnostics view
        }
        "power" => {
            info!("⚡ Opening power menu...");
            if let Some(app) = app_weak.upgrade() {
                app.set_confirm_title(SharedString::from("Shutdown / Reboot"));
                app.set_confirm_message(SharedString::from(
                    "Are you sure you want to shutdown or reboot this node?",
                ));
                app.set_confirm_danger(true);
                app.set_show_confirm_dialog(true);
            }
        }
        "shell" => {
            info!("🐚 Opening emergency shell...");
            // TODO: Implement emergency shell
            warn!("⚠️ Emergency shell not yet implemented");
        }
        _ => {
            warn!("⚠️ Unknown action: {}", action);
        }
    }
}

/// Load network interfaces into the UI
fn load_network_interfaces(app: &AppWindow) {
    let interfaces = network::get_interfaces();
    let model: Vec<NetworkInterface> = interfaces
        .into_iter()
        .map(|iface| NetworkInterface {
            name: SharedString::from(iface.name),
            mac: SharedString::from(iface.mac),
            ip: SharedString::from(iface.ip),
            status: SharedString::from(iface.status),
        })
        .collect();

    let model = std::rc::Rc::new(slint::VecModel::from(model));
    app.set_interfaces(model.into());
}

/// Update system status in the UI
fn update_system_status(app: &AppWindow) {
    let info = system_info::get_system_info();

    let status = SystemStatus {
        hostname: SharedString::from(info.hostname),
        ip_address: SharedString::from(info.ip_address),
        cluster_status: SharedString::from(info.cluster_status),
        cpu_percent: info.cpu_percent,
        memory_percent: info.memory_percent,
        memory_used: SharedString::from(info.memory_used),
        memory_total: SharedString::from(info.memory_total),
        vm_count: info.vm_count,
        uptime: SharedString::from(info.uptime),
        version: SharedString::from(info.version),
        ssh_enabled: ssh::is_enabled(),
        ssh_sessions: ssh::get_session_count() as i32,
    };

    app.set_system_status(status);

    // Update logs
    let logs: Vec<LogEntry> = info
        .recent_logs
        .into_iter()
        .map(|log| LogEntry {
            timestamp: SharedString::from(log.timestamp),
            level: SharedString::from(log.level),
            message: SharedString::from(log.message),
        })
        .collect();

    let model = std::rc::Rc::new(slint::VecModel::from(logs));
    app.set_log_entries(model.into());
}
