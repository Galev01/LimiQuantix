//! Application Logic for Framebuffer Console
//!
//! Manages the application state and event loop for the framebuffer-based console.
//! Provides the same functionality as the Slint GUI but with raw framebuffer rendering.

use std::process::Command;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use sysinfo::System;
use tracing::{error, info, warn};

use super::fb::Framebuffer;
use super::input::{InputHandler, KeyEvent};
use super::ui::{colors, SystemStatus, UiRenderer};

use crate::auth::{audit_power_action, audit_service_restart, audit_shell_end, audit_shell_start, AuthManager};
use crate::network::NetworkManager;
use crate::ssh::SshManager;
use crate::system_info;

/// Application screens/states
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Screen {
    Main,
    ConfirmReboot,
    ConfirmShutdown,
    AuthRequired(PendingAction),
}

/// Actions that require authentication
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingAction {
    NetworkConfig,
    SshToggle,
    RestartServices,
    EmergencyShell,
    Reboot,
    Shutdown,
}

/// Application state
struct AppState {
    system: System,
    auth_manager: AuthManager,
    screen: Screen,
    /// For auth dialog
    username: String,
    password: String,
    active_field: u8, // 0 = username, 1 = password
    auth_error: bool,
    /// Authenticated user (for audit)
    authenticated_user: Option<String>,
}

impl AppState {
    fn new() -> Self {
        let mut system = System::new_all();
        system.refresh_all();

        Self {
            system,
            auth_manager: AuthManager::new(),
            screen: Screen::Main,
            username: String::new(),
            password: String::new(),
            active_field: 0,
            auth_error: false,
            authenticated_user: None,
        }
    }

    fn refresh(&mut self) {
        self.system.refresh_all();
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
            hostname: get_hostname(),
            ip_address: system_info::get_management_ip().unwrap_or_else(|| "Not configured".to_string()),
            cluster_status: "Standalone".to_string(),
            cpu_percent: cpu_usage,
            memory_percent: mem_percent as f32,
            memory_used: humansize::format_size(used_mem, humansize::BINARY),
            memory_total: humansize::format_size(total_mem, humansize::BINARY),
            vm_count: get_vm_count() as i32,
            uptime: system_info::get_uptime(),
            version: "1.0.0".to_string(),
            ssh_enabled: ssh_status.running && ssh_status.enabled,
        }
    }

    fn reset_auth_fields(&mut self) {
        self.username.clear();
        self.password.clear();
        self.active_field = 0;
        self.auth_error = false;
    }
}

/// Get the system hostname
fn get_hostname() -> String {
    nix::unistd::gethostname()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "quantix-node".to_string())
}

/// Get the count of running VMs
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

/// Restart a system service
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

/// Execute system reboot
fn do_reboot() {
    let _ = Command::new("reboot").spawn();
}

/// Execute system shutdown
fn do_shutdown() {
    let _ = Command::new("poweroff").spawn();
}

/// Spawn an emergency shell
fn spawn_shell(username: &str) {
    audit_shell_start(username);
    info!(username = %username, "Spawning emergency shell");

    let _ = Command::new("/bin/sh")
        .spawn()
        .and_then(|mut child| child.wait());

    audit_shell_end(username);
    info!(username = %username, "Emergency shell session ended");
}

/// Main entry point for the framebuffer console
pub fn run() -> Result<()> {
    info!("Starting Quantix-OS Framebuffer Console");

    // Open framebuffer
    let mut fb = Framebuffer::new("/dev/fb0").context("Failed to open framebuffer")?;
    let (width, height) = fb.size();
    info!(width = width, height = height, "Framebuffer initialized");

    // Create UI renderer
    let ui = UiRenderer::new(width, height);

    // Initialize input handler
    let input = InputHandler::new().context("Failed to initialize input")?;

    // Application state
    let mut state = AppState::new();

    // Timing for refresh
    let mut last_refresh = Instant::now();
    let refresh_interval = Duration::from_secs(5);

    // Main event loop
    info!("Entering framebuffer event loop");
    loop {
        // Check for input events
        if let Some(event) = input.try_recv() {
            match handle_input(&mut state, event) {
                LoopAction::Continue => {}
                LoopAction::Quit => {
                    info!("Quit requested");
                    break;
                }
                LoopAction::Reboot => {
                    do_reboot();
                    break;
                }
                LoopAction::Shutdown => {
                    do_shutdown();
                    break;
                }
                LoopAction::Shell(username) => {
                    // Exit to shell temporarily
                    // Clear screen first
                    fb.clear(colors::BG_DARK);
                    fb.present();

                    spawn_shell(&username);

                    // Refresh state after shell exits
                    state.refresh();
                }
            }
        }

        // Periodic refresh
        if last_refresh.elapsed() >= refresh_interval {
            state.refresh();
            last_refresh = Instant::now();
        }

        // Render current screen
        let status = state.get_status();

        match state.screen {
            Screen::Main => {
                ui.render(&mut fb, &status)?;
            }
            Screen::ConfirmReboot => {
                ui.render(&mut fb, &status)?;
                ui.render_confirm_dialog(
                    &mut fb,
                    "Reboot System",
                    "Are you sure you want to reboot? Running VMs will be stopped.",
                    true,
                )?;
            }
            Screen::ConfirmShutdown => {
                ui.render(&mut fb, &status)?;
                ui.render_confirm_dialog(
                    &mut fb,
                    "Shutdown System",
                    "Are you sure you want to shut down? Running VMs will be stopped.",
                    true,
                )?;
            }
            Screen::AuthRequired(_) => {
                ui.render(&mut fb, &status)?;
                ui.render_auth_dialog(
                    &mut fb,
                    &state.username,
                    state.password.len(),
                    state.auth_error,
                    state.active_field,
                )?;
            }
        }

        fb.present();

        // Small sleep to avoid busy-looping
        std::thread::sleep(Duration::from_millis(16)); // ~60fps
    }

    info!("Framebuffer console exiting");
    Ok(())
}

/// Result of handling input
enum LoopAction {
    Continue,
    Quit,
    Reboot,
    Shutdown,
    Shell(String),
}

/// Handle a key event
fn handle_input(state: &mut AppState, event: KeyEvent) -> LoopAction {
    match state.screen {
        Screen::Main => handle_main_input(state, event),
        Screen::ConfirmReboot => handle_confirm_input(state, event, true),
        Screen::ConfirmShutdown => handle_confirm_input(state, event, false),
        Screen::AuthRequired(action) => handle_auth_input(state, event, action),
    }
}

/// Handle input on the main screen
fn handle_main_input(state: &mut AppState, event: KeyEvent) -> LoopAction {
    match event {
        KeyEvent::Quit => LoopAction::Quit,

        // F2 - Network Configuration
        KeyEvent::F2 => {
            state.screen = Screen::AuthRequired(PendingAction::NetworkConfig);
            state.reset_auth_fields();
            LoopAction::Continue
        }

        // F3 - SSH Toggle
        KeyEvent::F3 => {
            state.screen = Screen::AuthRequired(PendingAction::SshToggle);
            state.reset_auth_fields();
            LoopAction::Continue
        }

        // F5 - Restart Services
        KeyEvent::F5 => {
            state.screen = Screen::AuthRequired(PendingAction::RestartServices);
            state.reset_auth_fields();
            LoopAction::Continue
        }

        // F7 - Diagnostics (no auth needed for now)
        KeyEvent::F7 => {
            info!("Running diagnostics");
            // TODO: Show diagnostics screen
            LoopAction::Continue
        }

        // F10 - Reboot
        KeyEvent::F10 => {
            state.screen = Screen::AuthRequired(PendingAction::Reboot);
            state.reset_auth_fields();
            LoopAction::Continue
        }

        // F12 - Emergency Shell
        KeyEvent::F12 => {
            state.screen = Screen::AuthRequired(PendingAction::EmergencyShell);
            state.reset_auth_fields();
            LoopAction::Continue
        }

        _ => LoopAction::Continue,
    }
}

/// Handle input on confirmation dialogs
fn handle_confirm_input(state: &mut AppState, event: KeyEvent, is_reboot: bool) -> LoopAction {
    match event {
        KeyEvent::Enter => {
            if is_reboot {
                if let Some(ref user) = state.authenticated_user {
                    audit_power_action(user, "reboot");
                }
                LoopAction::Reboot
            } else {
                if let Some(ref user) = state.authenticated_user {
                    audit_power_action(user, "shutdown");
                }
                LoopAction::Shutdown
            }
        }
        KeyEvent::Escape => {
            state.screen = Screen::Main;
            LoopAction::Continue
        }
        KeyEvent::Quit => LoopAction::Quit,
        _ => LoopAction::Continue,
    }
}

/// Handle input on authentication dialog
fn handle_auth_input(state: &mut AppState, event: KeyEvent, action: PendingAction) -> LoopAction {
    match event {
        KeyEvent::Tab => {
            state.active_field = if state.active_field == 0 { 1 } else { 0 };
            LoopAction::Continue
        }

        KeyEvent::Char(c) => {
            if state.active_field == 0 {
                if state.username.len() < 32 {
                    state.username.push(c);
                }
            } else {
                if state.password.len() < 64 {
                    state.password.push(c);
                }
            }
            state.auth_error = false;
            LoopAction::Continue
        }

        KeyEvent::Backspace => {
            if state.active_field == 0 {
                state.username.pop();
            } else {
                state.password.pop();
            }
            state.auth_error = false;
            LoopAction::Continue
        }

        KeyEvent::Enter => {
            // Try to authenticate
            match state.auth_manager.authenticate(&state.username, &state.password) {
                Ok(()) => {
                    info!(username = %state.username, "Authentication successful");
                    state.authenticated_user = Some(state.username.clone());
                    state.reset_auth_fields();

                    // Execute the pending action
                    execute_action(state, action)
                }
                Err(e) => {
                    warn!(username = %state.username, error = %e, "Authentication failed");
                    state.auth_error = true;
                    state.password.clear();
                    LoopAction::Continue
                }
            }
        }

        KeyEvent::Escape => {
            state.screen = Screen::Main;
            state.reset_auth_fields();
            LoopAction::Continue
        }

        KeyEvent::Quit => LoopAction::Quit,

        _ => LoopAction::Continue,
    }
}

/// Execute an authenticated action
fn execute_action(state: &mut AppState, action: PendingAction) -> LoopAction {
    let username = state.authenticated_user.clone().unwrap_or_default();

    match action {
        PendingAction::NetworkConfig => {
            info!("Opening network configuration");
            // TODO: Implement network config screen
            state.screen = Screen::Main;
            LoopAction::Continue
        }

        PendingAction::SshToggle => {
            let status = SshManager::status();
            let new_state = !status.enabled;

            info!(new_state = new_state, "Toggling SSH");

            if new_state {
                if let Err(e) = SshManager::enable() {
                    error!(error = %e, "Failed to enable SSH");
                }
            } else {
                if let Err(e) = SshManager::disable() {
                    error!(error = %e, "Failed to disable SSH");
                }
            }

            let _ = state.auth_manager.set_ssh_enabled(new_state);
            state.screen = Screen::Main;
            LoopAction::Continue
        }

        PendingAction::RestartServices => {
            info!("Restarting services");
            audit_service_restart(&username, "quantix-node");

            match restart_service("quantix-node") {
                Ok(msg) => info!(result = %msg, "Service restart result"),
                Err(e) => error!(error = %e, "Failed to restart service"),
            }

            state.screen = Screen::Main;
            LoopAction::Continue
        }

        PendingAction::EmergencyShell => {
            state.screen = Screen::Main;
            LoopAction::Shell(username)
        }

        PendingAction::Reboot => {
            state.screen = Screen::ConfirmReboot;
            LoopAction::Continue
        }

        PendingAction::Shutdown => {
            state.screen = Screen::ConfirmShutdown;
            LoopAction::Continue
        }
    }
}
