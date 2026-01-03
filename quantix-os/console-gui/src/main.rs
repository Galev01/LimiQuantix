//! Quantix-OS Graphical Console (DCUI)
//!
//! A framebuffer-based GUI for hypervisor management.
//! Renders directly to /dev/fb0 using Slint with the LinuxKMS backend.
//!
//! Features:
//! - Installation wizard for first-time setup
//! - Admin authentication for sensitive operations
//! - SSH management (enable/disable)
//! - Network configuration
//! - System status monitoring
//! - Emergency shell access (logged)

use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::process::Command;

use anyhow::Result;
use slint::ModelRc;
use slint::VecModel;
use sysinfo::System;
use tracing::{error, info, warn};

slint::include_modules!();

mod auth;
mod network;
mod ssh;
mod system_info;

use auth::{AuthManager, audit_shell_start, audit_shell_end, audit_service_restart, audit_power_action};
use network::NetworkManager;
use ssh::SshManager;

// ============================================================================
// Application State
// ============================================================================

struct AppState {
    system: System,
    auth_manager: AuthManager,
    logs: Vec<LogEntry>,
    error_count: i32,
    warning_count: i32,
    pending_action: Option<PendingAction>,
    authenticated_user: Option<String>,
}

/// Actions that require authentication
#[derive(Debug, Clone)]
enum PendingAction {
    NetworkConfig,
    SshManagement,
    RestartService(String),
    EmergencyShell,
    Reboot,
    Shutdown,
}

impl AppState {
    fn new() -> Self {
        let mut system = System::new_all();
        system.refresh_all();

        let auth_manager = AuthManager::new();

        Self {
            system,
            auth_manager,
            logs: Vec::new(),
            error_count: 0,
            warning_count: 0,
            pending_action: None,
            authenticated_user: None,
        }
    }

    fn refresh(&mut self) {
        self.system.refresh_all();
        self.load_recent_logs();
    }

    fn get_status(&self) -> SystemStatus {
        let cpu_usage = self.system.global_cpu_usage();
        let total_mem = self.system.total_memory();
        let used_mem = self.system.used_memory();
        let mem_percent = if total_mem > 0 {
            (used_mem as f64 / total_mem as f64) * 100.0
        } else {
            0.0
        };

        let ssh_status = SshManager::status();

        SystemStatus {
            hostname: get_hostname().into(),
            ip_address: system_info::get_management_ip()
                .unwrap_or_else(|| "Not configured".to_string())
                .into(),
            cluster_status: "Standalone".into(),
            cpu_percent: cpu_usage as f32,
            memory_percent: mem_percent as f32,
            memory_used: humansize::format_size(used_mem, humansize::BINARY).into(),
            memory_total: humansize::format_size(total_mem, humansize::BINARY).into(),
            vm_count: get_vm_count() as i32,
            uptime: system_info::get_uptime().into(),
            version: "1.0.0".into(),
            ssh_enabled: ssh_status.running && ssh_status.enabled,
            ssh_sessions: ssh_status.active_sessions as i32,
        }
    }

    fn get_interfaces(&self) -> Vec<NetworkInterface> {
        NetworkManager::discover_interfaces()
            .into_iter()
            .map(|iface| NetworkInterface {
                name: iface.name.into(),
                ip_address: iface.ip_address.unwrap_or_default().into(),
                mac_address: iface.mac_address.into(),
                state: iface.state.into(),
                dhcp: iface.dhcp,
            })
            .collect()
    }

    fn load_recent_logs(&mut self) {
        self.logs.clear();
        self.error_count = 0;
        self.warning_count = 0;

        let log_paths = [
            "/var/log/messages",
            "/var/log/quantix-node.log",
            "/var/log/quantix-console.log",
        ];

        for path in log_paths {
            if let Ok(content) = std::fs::read_to_string(path) {
                for line in content.lines().rev().take(50) {
                    let level = if line.to_lowercase().contains("error") {
                        self.error_count += 1;
                        "error"
                    } else if line.to_lowercase().contains("warn") {
                        self.warning_count += 1;
                        "warn"
                    } else {
                        "info"
                    };

                    let timestamp = if line.len() > 15 {
                        &line[..15]
                    } else {
                        ""
                    };

                    let message = if line.len() > 80 {
                        format!("{}...", &line[..77])
                    } else {
                        line.to_string()
                    };

                    self.logs.push(LogEntry {
                        timestamp: timestamp.to_string().into(),
                        level: level.to_string().into(),
                        message: message.into(),
                    });

                    if self.logs.len() >= 10 {
                        break;
                    }
                }
            }
            if self.logs.len() >= 10 {
                break;
            }
        }

        self.logs.reverse();
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn get_hostname() -> String {
    nix::unistd::gethostname()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "quantix-node".to_string())
}

fn get_vm_count() -> usize {
    Command::new("virsh")
        .args(["list", "--state-running"])
        .output()
        .ok()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|line| line.contains("running"))
                .count()
        })
        .unwrap_or(0)
}

fn set_hostname(hostname: &str) -> Result<()> {
    // Set hostname immediately
    Command::new("hostname")
        .arg(hostname)
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to set hostname: {}", e))?;

    // Persist to /etc/hostname
    std::fs::write("/etc/hostname", format!("{}\n", hostname))?;

    // Update /etc/hosts
    let hosts = std::fs::read_to_string("/etc/hosts").unwrap_or_default();
    if !hosts.contains(hostname) {
        let new_hosts = format!("127.0.0.1 {} localhost\n{}", hostname, hosts);
        std::fs::write("/etc/hosts", new_hosts)?;
    }

    Ok(())
}

fn restart_service(service: &str) -> Result<String> {
    let result = Command::new("rc-service")
        .args([service, "restart"])
        .output()?;

    if result.status.success() {
        Ok(format!("[OK] {} restarted", service))
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr);
        Ok(format!("[FAIL] Failed to restart {}: {}", service, stderr))
    }
}

fn do_reboot() {
    let _ = Command::new("reboot").spawn();
}

fn do_shutdown() {
    let _ = Command::new("poweroff").spawn();
}

fn spawn_shell(username: &str) {
    audit_shell_start(username);

    // Drop to a shell
    // This will exit the console temporarily
    info!(username = %username, "Spawning emergency shell");

    let _ = Command::new("/bin/sh")
        .spawn()
        .and_then(|mut child| child.wait());

    audit_shell_end(username);
    info!(username = %username, "Emergency shell session ended");
}

// ============================================================================
// Main Entry Point
// ============================================================================

fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter("qx_console_gui=info")
        .with_target(false)
        .init();

    info!("Starting Quantix-OS Graphical Console");

    // Create the Slint window
    let ui = MainWindow::new()?;

    // Shared state
    let state = Arc::new(Mutex::new(AppState::new()));

    // Determine if we need to show the installation wizard
    let needs_setup = {
        let s = state.lock().unwrap();
        s.auth_manager.needs_setup()
    };

    if needs_setup {
        info!("First boot detected - showing installation wizard");
        ui.set_current_screen("install".into());

        // Load interfaces for network configuration
        let interfaces: Vec<NetworkInterface> = {
            let s = state.lock().unwrap();
            s.get_interfaces()
        };
        ui.set_interfaces(interfaces.as_slice().into());
    } else {
        ui.set_current_screen("main".into());

        // Initial update
        {
            let mut s = state.lock().unwrap();
            s.refresh();
            ui.set_status(s.get_status());
            ui.set_logs(ModelRc::new(VecModel::from(s.logs.clone())));
            ui.set_error_count(s.error_count);
            ui.set_warning_count(s.warning_count);
        }
    }

    // ========================================================================
    // Installation wizard callback
    // ========================================================================
    {
        let ui_weak = ui.as_weak();
        let state_clone = state.clone();
        ui.on_install_complete(move |config| {
            info!("Installation wizard completed");

            let hostname = config.hostname.to_string();
            let username = config.admin_username.to_string();
            let password = config.admin_password.to_string();
            let interface = config.network_interface.to_string();
            let use_dhcp = config.use_dhcp;
            let enable_ssh = config.enable_ssh;

            // Set hostname
            if let Err(e) = set_hostname(&hostname) {
                error!(error = %e, "Failed to set hostname");
            }

            // Configure admin account
            {
                let mut s = state_clone.lock().unwrap();
                if let Err(e) = s.auth_manager.setup(&username, &password) {
                    error!(error = %e, "Failed to setup admin account");
                }
            }

            // Configure network
            if use_dhcp {
                if let Err(e) = NetworkManager::configure_dhcp(&interface) {
                    error!(error = %e, "Failed to configure DHCP");
                }
            } else {
                let net_config = network::NetworkConfig {
                    interface: interface.clone(),
                    use_dhcp: false,
                    static_ip: Some(config.static_ip.to_string()),
                    gateway: Some(config.gateway.to_string()),
                    dns_servers: vec![config.dns.to_string()],
                };
                if let Err(e) = NetworkManager::configure_static(&net_config) {
                    error!(error = %e, "Failed to configure static IP");
                }
            }

            // Configure SSH
            if enable_ssh {
                let mut s = state_clone.lock().unwrap();
                let _ = s.auth_manager.set_ssh_enabled(true);
                if let Err(e) = SshManager::enable() {
                    error!(error = %e, "Failed to enable SSH");
                }
            }

            // Mark first boot complete
            let _ = std::fs::write("/quantix/.setup_complete", "1");

            // Switch to main screen
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_current_screen("main".into());

                // Refresh state
                let mut s = state_clone.lock().unwrap();
                s.refresh();
                ui.set_status(s.get_status());
                ui.set_logs(ModelRc::new(VecModel::from(s.logs.clone())));
                ui.set_error_count(s.error_count);
                ui.set_warning_count(s.warning_count);
            }

            info!("Installation complete - switching to main console");
        });
    }

    // ========================================================================
    // Menu selection callback
    // ========================================================================
    {
        let ui_weak = ui.as_weak();
        let state_clone = state.clone();
        ui.on_menu_selected(move |index| {
            let mut s = state_clone.lock().unwrap();
            let ui = match ui_weak.upgrade() {
                Some(u) => u,
                None => return,
            };

            info!(menu_index = index, "Menu item selected");

            match index {
                0 => {
                    // Configure Network - requires auth
                    s.pending_action = Some(PendingAction::NetworkConfig);
                    ui.set_show_auth_dialog(true);
                }
                1 => {
                    // SSH Management - requires auth
                    s.pending_action = Some(PendingAction::SshManagement);
                    ui.set_show_auth_dialog(true);
                }
                2 => {
                    // Join Cluster - TODO
                    info!("Join Cluster - not yet implemented");
                }
                3 => {
                    // Restart Services - requires auth
                    s.pending_action = Some(PendingAction::RestartService("quantix-node".to_string()));
                    ui.set_show_auth_dialog(true);
                }
                4 => {
                    // Diagnostics - no auth needed
                    info!("Running diagnostics");
                    // TODO: Show diagnostics screen
                }
                5 => {
                    // Shutdown/Reboot - requires auth
                    s.pending_action = Some(PendingAction::Reboot);
                    ui.set_show_auth_dialog(true);
                }
                6 => {
                    // Emergency Shell - requires auth (dangerous!)
                    s.pending_action = Some(PendingAction::EmergencyShell);
                    ui.set_show_auth_dialog(true);
                }
                _ => {}
            }
        });
    }

    // ========================================================================
    // Authentication callback
    // ========================================================================
    {
        let ui_weak = ui.as_weak();
        let state_clone = state.clone();
        ui.on_authenticate(move |username, password| {
            let mut s = state_clone.lock().unwrap();
            let ui = match ui_weak.upgrade() {
                Some(u) => u,
                None => return,
            };

            let username_str = username.to_string();
            let password_str = password.to_string();

            match s.auth_manager.authenticate(&username_str, &password_str) {
                Ok(()) => {
                    info!(username = %username_str, "Authentication successful");
                    s.authenticated_user = Some(username_str.clone());
                    ui.set_show_auth_dialog(false);
                    ui.invoke_reset_auth();

                    // Execute pending action
                    if let Some(action) = s.pending_action.take() {
                        drop(s); // Release lock before executing action

                        match action {
                            PendingAction::NetworkConfig => {
                                info!("Opening network configuration");
                                // TODO: Show network config dialog
                            }
                            PendingAction::SshManagement => {
                                info!("Opening SSH management");
                                let status = SshManager::status();
                                let new_state = !status.enabled;

                                if new_state {
                                    if let Err(e) = SshManager::enable() {
                                        error!(error = %e, "Failed to enable SSH");
                                    }
                                } else {
                                    if let Err(e) = SshManager::disable() {
                                        error!(error = %e, "Failed to disable SSH");
                                    }
                                }

                                // Update auth manager's SSH state
                                let mut s = state_clone.lock().unwrap();
                                let _ = s.auth_manager.set_ssh_enabled(new_state);
                                s.refresh();
                                ui.set_status(s.get_status());
                            }
                            PendingAction::RestartService(service) => {
                                info!(service = %service, "Restarting service");
                                audit_service_restart(&username_str, &service);
                                match restart_service(&service) {
                                    Ok(msg) => info!(result = %msg, "Service restart result"),
                                    Err(e) => error!(error = %e, "Failed to restart service"),
                                }
                            }
                            PendingAction::EmergencyShell => {
                                info!("Spawning emergency shell");
                                // This will block until shell exits
                                spawn_shell(&username_str);
                                // Refresh status after shell exit
                                let mut s = state_clone.lock().unwrap();
                                s.refresh();
                                ui.set_status(s.get_status());
                            }
                            PendingAction::Reboot => {
                                // Show confirmation dialog
                                ui.set_confirm_title("Reboot System".into());
                                ui.set_confirm_message("Are you sure you want to reboot this node? Running VMs will be stopped.".into());
                                ui.set_confirm_danger(true);
                                ui.set_show_confirm_dialog(true);
                            }
                            PendingAction::Shutdown => {
                                ui.set_confirm_title("Shutdown System".into());
                                ui.set_confirm_message("Are you sure you want to shut down this node? Running VMs will be stopped.".into());
                                ui.set_confirm_danger(true);
                                ui.set_show_confirm_dialog(true);
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!(username = %username_str, error = %e, "Authentication failed");
                    ui.invoke_show_auth_error();
                }
            }
        });
    }

    // ========================================================================
    // Auth cancelled callback
    // ========================================================================
    {
        let ui_weak = ui.as_weak();
        let state_clone = state.clone();
        ui.on_auth_cancelled(move || {
            let mut s = state_clone.lock().unwrap();
            s.pending_action = None;

            if let Some(ui) = ui_weak.upgrade() {
                ui.set_show_auth_dialog(false);
                ui.invoke_reset_auth();
            }
        });
    }

    // ========================================================================
    // Confirm action callback
    // ========================================================================
    {
        let ui_weak = ui.as_weak();
        let state_clone = state.clone();
        ui.on_confirm_action(move || {
            let s = state_clone.lock().unwrap();
            let username = s.authenticated_user.clone().unwrap_or_default();
            drop(s);

            if let Some(ui) = ui_weak.upgrade() {
                ui.set_show_confirm_dialog(false);

                // Execute the confirmed action
                let title = ui.get_confirm_title().to_string();
                if title.contains("Reboot") {
                    audit_power_action(&username, "reboot");
                    info!("Executing system reboot");
                    do_reboot();
                } else if title.contains("Shutdown") {
                    audit_power_action(&username, "shutdown");
                    info!("Executing system shutdown");
                    do_shutdown();
                }
            }
        });
    }

    // ========================================================================
    // Cancel action callback
    // ========================================================================
    {
        let ui_weak = ui.as_weak();
        ui.on_cancel_action(move || {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_show_confirm_dialog(false);
            }
        });
    }

    // ========================================================================
    // Periodic refresh timer
    // ========================================================================
    {
        let ui_weak = ui.as_weak();
        let state_clone = state.clone();
        let timer = slint::Timer::default();
        timer.start(
            slint::TimerMode::Repeated,
            Duration::from_secs(5),
            move || {
                if let Some(ui) = ui_weak.upgrade() {
                    // Only refresh if on main screen
                    if ui.get_current_screen() == "main" {
                        let mut s = state_clone.lock().unwrap();
                        s.refresh();
                        ui.set_status(s.get_status());
                        ui.set_logs(ModelRc::new(VecModel::from(s.logs.clone())));
                        ui.set_error_count(s.error_count);
                        ui.set_warning_count(s.warning_count);
                    }
                }
            },
        );
    }

    // Run the event loop
    info!("Console GUI started - entering event loop");
    ui.run()?;

    info!("Console GUI exiting");
    Ok(())
}
