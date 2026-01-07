//! Quantix-OS Console TUI
//!
//! Terminal-based fallback console for systems without GPU/KMS support.

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Frame, Terminal,
};
use std::io;
use std::time::Duration;
use sysinfo::System;
use tracing::info;

mod auth;
mod config;

/// Application state
struct App {
    /// Current screen
    screen: Screen,
    /// Selected menu item
    selected_menu: usize,
    /// System information
    system: System,
    /// Whether to quit
    should_quit: bool,
    /// Error message to display
    error_message: Option<String>,
    /// Success message to display
    success_message: Option<String>,
    /// Cached hostname (read once)
    hostname: String,
    /// Cached primary IP (refreshed periodically)
    primary_ip: String,
    /// Cached VM count (refreshed periodically)
    vm_count: i32,
    /// Static IP configuration state
    static_ip_config: StaticIpConfig,
    /// WiFi configuration state
    wifi_config: WiFiConfig,
    /// SSH configuration state
    ssh_config: SshConfig,
    /// Current input field index (for forms)
    input_field_index: usize,
    /// Available network interfaces
    available_interfaces: Vec<String>,
    /// Selected interface index
    selected_interface: usize,
    /// Status message (shown prominently at top)
    status_message: Option<(String, std::time::Instant)>,
    /// Cluster configuration state
    cluster_config: ClusterConfig,
}

/// Static IP configuration
#[derive(Default, Clone)]
struct StaticIpConfig {
    interface: String,
    ip_address: String,
    netmask: String,
    gateway: String,
    dns: String,
}

/// WiFi configuration  
#[derive(Default, Clone)]
struct WiFiConfig {
    ssid: String,
    password: String,
    security: String, // "WPA2", "WPA3", "OPEN"
}

/// SSH configuration with timer
#[derive(Clone)]
struct SshConfig {
    enabled: bool,
    timer_minutes: u32,
    timer_start: Option<std::time::Instant>,
}

impl Default for SshConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            timer_minutes: 30, // Default 30 minutes
            timer_start: None,
        }
    }
}

/// Cluster configuration for joining Quantix-vDC control plane
#[derive(Clone)]
struct ClusterConfig {
    /// Control plane address (e.g., "https://control.example.com:8080")
    control_plane_address: String,
    /// Registration token from control plane
    registration_token: String,
    /// Current cluster status
    status: ClusterStatus,
}

#[derive(Clone, PartialEq)]
enum ClusterStatus {
    Standalone,
    Joining,
    Connected,
    Disconnected,
    Error(String),
}

impl Default for ClusterConfig {
    fn default() -> Self {
        Self {
            control_plane_address: String::new(),
            registration_token: String::new(),
            status: ClusterStatus::Standalone,
        }
    }
}

/// Application screens
#[derive(Clone, Copy, PartialEq, Debug)]
enum Screen {
    Main,
    Network,
    StaticIp,
    WiFi,
    Ssh,
    Cluster,
    Services,
    Diagnostics,
    Power,
    Auth,
}

impl App {
    fn new() -> Self {
        let mut system = System::new();
        system.refresh_all();
        
        // Read hostname once at startup
        let hostname = std::fs::read_to_string("/etc/hostname")
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| "quantix".to_string());

        // Get available network interfaces
        let available_interfaces = get_interface_names();

        // Check current SSH status
        let ssh_enabled = is_ssh_enabled();
        
        Self {
            screen: Screen::Main,
            selected_menu: 0,
            system,
            should_quit: false,
            error_message: None,
            success_message: None,
            hostname,
            primary_ip: get_primary_ip(),
            vm_count: get_vm_count(),
            static_ip_config: StaticIpConfig {
                interface: available_interfaces.first().cloned().unwrap_or_default(),
                ip_address: String::new(),
                netmask: "255.255.255.0".to_string(),
                gateway: String::new(),
                dns: "8.8.8.8".to_string(),
            },
            wifi_config: WiFiConfig {
                ssid: String::new(),
                password: String::new(),
                security: "WPA2".to_string(),
            },
            ssh_config: SshConfig {
                enabled: ssh_enabled,
                timer_minutes: 30,
                timer_start: None,
            },
            input_field_index: 0,
            available_interfaces,
            selected_interface: 0,
            status_message: None,
            cluster_config: ClusterConfig {
                status: get_cluster_status(),
                ..Default::default()
            },
        }
    }

    fn refresh(&mut self) {
        // Only refresh on explicit user request (F5 - Restart Services)
        // CPU/Memory stats removed to eliminate flickering
        self.primary_ip = get_primary_ip();
        self.vm_count = get_vm_count();
    }

    fn menu_items(&self) -> Vec<(&str, &str)> {
        vec![
            ("Configure Management Network", "F2"),
            ("Configure SSH Access", "F3"),
            ("Join/Leave Cluster", "F4"),
            ("Refresh Display", "F5"),
            ("Restart Management Services", "F6"),
            ("View System Logs", "F7"),
            ("Reset to Factory Defaults", "F9"),
            ("Shutdown / Reboot", "F10"),
            ("Exit to Web Console", "F12"),
        ]
    }
    
    fn set_status(&mut self, msg: &str) {
        self.status_message = Some((msg.to_string(), std::time::Instant::now()));
    }
    
    fn check_ssh_timer(&mut self) {
        if let Some(start) = self.ssh_config.timer_start {
            let elapsed = start.elapsed().as_secs() / 60;
            if elapsed >= self.ssh_config.timer_minutes as u64 {
                // Timer expired, disable SSH
                if disable_ssh().is_ok() {
                    self.ssh_config.enabled = false;
                    self.ssh_config.timer_start = None;
                    self.set_status("SSH auto-disabled (timer expired)");
                }
            }
        }
    }
}

fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter("qx_console=info")
        .init();

    info!("🚀 Starting Quantix-OS Console TUI");

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Create app state
    let mut app = App::new();

    // Main loop
    let result = run_app(&mut terminal, &mut app);

    // Restore terminal
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    if let Err(e) = result {
        eprintln!("Error: {}", e);
    }

    info!("👋 Quantix-OS Console TUI shutting down");
    Ok(())
}

fn run_app<B: ratatui::backend::Backend>(
    terminal: &mut Terminal<B>,
    app: &mut App,
) -> Result<()> {
    // Initial draw
    terminal.draw(|f| ui(f, app))?;

    loop {
        // Use poll with timeout to check SSH timer periodically
        // Poll every 5 seconds to check if SSH timer expired
        if event::poll(Duration::from_secs(5))? {
            if let Event::Key(key) = event::read()? {
                handle_input(app, key.code, key.modifiers);
            }
        }
        
        // Check SSH timer on every loop iteration
        app.check_ssh_timer();
        
        // Clear status message after 5 seconds
        if let Some((_, start)) = &app.status_message {
            if start.elapsed().as_secs() > 5 {
                app.status_message = None;
            }
        }

        // Redraw the UI
        terminal.draw(|f| ui(f, app))?;

        if app.should_quit {
            return Ok(());
        }
    }
}

fn handle_input(app: &mut App, key: KeyCode, modifiers: KeyModifiers) {
    // Clear messages on any input
    app.error_message = None;
    app.success_message = None;

    match app.screen {
        Screen::Main => match key {
            KeyCode::Char('q') | KeyCode::Char('Q') => {
                if modifiers.contains(KeyModifiers::CONTROL) {
                    app.should_quit = true;
                }
            }
            KeyCode::Up | KeyCode::Char('k') => {
                if app.selected_menu > 0 {
                    app.selected_menu -= 1;
                }
            }
            KeyCode::Down | KeyCode::Char('j') => {
                let max = app.menu_items().len() - 1;
                if app.selected_menu < max {
                    app.selected_menu += 1;
                }
            }
            KeyCode::Enter => {
                handle_menu_action(app, app.selected_menu);
            }
            KeyCode::F(2) => handle_menu_action(app, 0),  // Network
            KeyCode::F(3) => handle_menu_action(app, 1),  // SSH Config
            KeyCode::F(4) => handle_menu_action(app, 2),  // Cluster
            KeyCode::F(5) => handle_menu_action(app, 3),  // Refresh
            KeyCode::F(6) => handle_menu_action(app, 4),  // Restart Services
            KeyCode::F(7) => handle_menu_action(app, 5),  // Logs
            KeyCode::F(9) => handle_menu_action(app, 6),  // Factory Reset
            KeyCode::F(10) => handle_menu_action(app, 7), // Shutdown
            KeyCode::F(12) => handle_menu_action(app, 8), // Exit to Web
            _ => {}
        },
        Screen::Network => match key {
            KeyCode::Esc | KeyCode::Char('q') => {
                app.screen = Screen::Main;
            }
            KeyCode::Char('d') | KeyCode::Char('D') => {
                app.success_message = Some("Running DHCP on all interfaces...".to_string());
                run_dhcp_all();
            }
            KeyCode::Char('r') | KeyCode::Char('R') => {
                app.success_message = Some("Restarting network service...".to_string());
                restart_network();
            }
            KeyCode::Char('s') | KeyCode::Char('S') => {
                // Go to Static IP configuration screen
                app.input_field_index = 1; // Start at IP Address field, not Interface
                app.available_interfaces = get_interface_names();
                app.selected_interface = 0;
                // Reset the config to clean state
                app.static_ip_config = StaticIpConfig {
                    interface: app.available_interfaces.first().cloned().unwrap_or_else(|| "eth0".to_string()),
                    ip_address: String::new(),
                    netmask: "255.255.255.0".to_string(),
                    gateway: String::new(),
                    dns: "8.8.8.8".to_string(),
                };
                app.screen = Screen::StaticIp;
            }
            KeyCode::Char('w') | KeyCode::Char('W') => {
                // Go to WiFi configuration screen
                app.input_field_index = 0;
                app.wifi_config = WiFiConfig::default();
                app.wifi_config.security = "WPA2".to_string();
                app.screen = Screen::WiFi;
            }
            _ => {}
        },
        Screen::StaticIp => handle_static_ip_input(app, key),
        Screen::WiFi => handle_wifi_input(app, key),
        Screen::Ssh => handle_ssh_input(app, key),
        Screen::Cluster => handle_cluster_input(app, key),
        Screen::Power => match key {
            KeyCode::Esc | KeyCode::Char('q') => {
                app.screen = Screen::Main;
            }
            KeyCode::Char('r') | KeyCode::Char('R') => {
                let _ = std::process::Command::new("reboot").spawn();
            }
            KeyCode::Char('s') | KeyCode::Char('S') => {
                let _ = std::process::Command::new("poweroff").spawn();
            }
            _ => {}
        },
        _ => match key {
            KeyCode::Esc | KeyCode::Char('q') => {
                app.screen = Screen::Main;
            }
            _ => {}
        },
    }
}

fn handle_menu_action(app: &mut App, index: usize) {
    match index {
        0 => app.screen = Screen::Network,
        1 => {
            // Go to SSH configuration screen
            app.input_field_index = 0;
            app.ssh_config.enabled = is_ssh_enabled();
            app.screen = Screen::Ssh;
        }
        2 => {
            // Go to Cluster configuration screen
            app.input_field_index = 0;
            app.cluster_config.status = get_cluster_status();
            app.screen = Screen::Cluster;
        }
        3 => {
            // Refresh display
            app.set_status("Refreshing system information...");
            app.refresh();
            app.success_message = Some("Display refreshed".to_string());
        }
        4 => {
            // Restart management services
            app.set_status("⏳ Restarting management services...");
            restart_management_services();
            app.success_message = Some("Management services restarting...".to_string());
        }
        5 => app.screen = Screen::Diagnostics,
        6 => {
            app.error_message = Some("Factory reset requires confirmation in a future update".to_string());
        }
        7 => app.screen = Screen::Power,
        8 => {
            // Exit to web console (quit TUI so launcher can restart web kiosk)
            app.should_quit = true;
        }
        _ => {}
    }
}

fn restart_management_services() {
    use std::process::Stdio;
    // Redirect all output to null to prevent TUI corruption
    // Use spawn() to avoid blocking the TUI
    let _ = std::process::Command::new("rc-service")
        .args(["quantix-node", "restart"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn();
}

fn handle_static_ip_input(app: &mut App, key: KeyCode) {
    match key {
        KeyCode::Esc => {
            app.screen = Screen::Network;
        }
        KeyCode::Tab | KeyCode::Down => {
            // Move to next field (5 fields: interface, ip, netmask, gateway, dns)
            app.input_field_index = (app.input_field_index + 1) % 5;
        }
        KeyCode::BackTab | KeyCode::Up => {
            // Move to previous field
            if app.input_field_index > 0 {
                app.input_field_index -= 1;
            } else {
                app.input_field_index = 4;
            }
        }
        KeyCode::Left => {
            // For interface selector (field 0), cycle through interfaces
            if app.input_field_index == 0 && !app.available_interfaces.is_empty() {
                if app.selected_interface > 0 {
                    app.selected_interface -= 1;
                } else {
                    app.selected_interface = app.available_interfaces.len() - 1;
                }
                app.static_ip_config.interface = app.available_interfaces[app.selected_interface].clone();
            }
        }
        KeyCode::Right => {
            // For interface selector (field 0), cycle through interfaces
            if app.input_field_index == 0 && !app.available_interfaces.is_empty() {
                app.selected_interface = (app.selected_interface + 1) % app.available_interfaces.len();
                app.static_ip_config.interface = app.available_interfaces[app.selected_interface].clone();
            }
        }
        KeyCode::Char(c) => {
            // Only allow valid IP characters
            if c.is_ascii_digit() || c == '.' {
                match app.input_field_index {
                    1 => app.static_ip_config.ip_address.push(c),
                    2 => app.static_ip_config.netmask.push(c),
                    3 => app.static_ip_config.gateway.push(c),
                    4 => app.static_ip_config.dns.push(c),
                    _ => {}
                }
            }
        }
        KeyCode::Backspace => {
            match app.input_field_index {
                1 => { app.static_ip_config.ip_address.pop(); }
                2 => { app.static_ip_config.netmask.pop(); }
                3 => { app.static_ip_config.gateway.pop(); }
                4 => { app.static_ip_config.dns.pop(); }
                _ => {}
            }
        }
        KeyCode::Enter => {
            // Apply the static IP configuration
            if app.static_ip_config.ip_address.is_empty() {
                app.error_message = Some("IP address is required".to_string());
            } else if !is_valid_ip(&app.static_ip_config.ip_address) {
                app.error_message = Some("Invalid IP address format".to_string());
            } else {
                match apply_static_ip(&app.static_ip_config) {
                    Ok(_) => {
                        app.success_message = Some(format!(
                            "Static IP {} applied to {}",
                            app.static_ip_config.ip_address,
                            app.static_ip_config.interface
                        ));
                        app.primary_ip = app.static_ip_config.ip_address.clone();
                        app.screen = Screen::Network;
                    }
                    Err(e) => {
                        app.error_message = Some(format!("Failed to apply: {}", e));
                    }
                }
            }
        }
        _ => {}
    }
}

fn handle_wifi_input(app: &mut App, key: KeyCode) {
    match key {
        KeyCode::Esc => {
            app.screen = Screen::Network;
        }
        KeyCode::Tab | KeyCode::Down => {
            // Move to next field (3 fields: ssid, password, security)
            app.input_field_index = (app.input_field_index + 1) % 3;
        }
        KeyCode::BackTab | KeyCode::Up => {
            // Move to previous field
            if app.input_field_index > 0 {
                app.input_field_index -= 1;
            } else {
                app.input_field_index = 2;
            }
        }
        KeyCode::Left | KeyCode::Right => {
            // For security selector (field 2), cycle through options
            if app.input_field_index == 2 {
                let options = ["WPA2", "WPA3", "OPEN"];
                let current_idx = options.iter().position(|&s| s == app.wifi_config.security).unwrap_or(0);
                let new_idx = if key == KeyCode::Right {
                    (current_idx + 1) % options.len()
                } else if current_idx > 0 {
                    current_idx - 1
                } else {
                    options.len() - 1
                };
                app.wifi_config.security = options[new_idx].to_string();
            }
        }
        KeyCode::Char(c) => {
            match app.input_field_index {
                0 => app.wifi_config.ssid.push(c),
                1 => app.wifi_config.password.push(c),
                _ => {}
            }
        }
        KeyCode::Backspace => {
            match app.input_field_index {
                0 => { app.wifi_config.ssid.pop(); }
                1 => { app.wifi_config.password.pop(); }
                _ => {}
            }
        }
        KeyCode::Enter => {
            // Apply the WiFi configuration
            if app.wifi_config.ssid.is_empty() {
                app.error_message = Some("SSID is required".to_string());
            } else if app.wifi_config.security != "OPEN" && app.wifi_config.password.len() < 8 {
                app.error_message = Some("Password must be at least 8 characters".to_string());
            } else {
                match apply_wifi_config(&app.wifi_config) {
                    Ok(_) => {
                        app.success_message = Some(format!(
                            "WiFi configured for network: {}",
                            app.wifi_config.ssid
                        ));
                        app.screen = Screen::Network;
                    }
                    Err(e) => {
                        app.error_message = Some(format!("Failed to configure WiFi: {}", e));
                    }
                }
            }
        }
        _ => {}
    }
}

fn is_valid_ip(ip: &str) -> bool {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    for part in parts {
        match part.parse::<u8>() {
            Ok(_) => continue,
            Err(_) => return false,
        }
    }
    true
}

fn apply_static_ip(config: &StaticIpConfig) -> Result<()> {
    use std::process::Stdio;
    
    // First, flush existing IP on interface
    let _ = std::process::Command::new("ip")
        .args(["addr", "flush", "dev", &config.interface])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output();
    
    // Bring interface up
    let _ = std::process::Command::new("ip")
        .args(["link", "set", &config.interface, "up"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output();
    
    // Calculate CIDR prefix from netmask
    let prefix = netmask_to_cidr(&config.netmask);
    let ip_cidr = format!("{}/{}", config.ip_address, prefix);
    
    // Add the IP address
    let result = std::process::Command::new("ip")
        .args(["addr", "add", &ip_cidr, "dev", &config.interface])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()?;
    
    if !result.status.success() {
        return Err(anyhow::anyhow!("Failed to set IP address"));
    }
    
    // Set default gateway if provided
    if !config.gateway.is_empty() {
        // Remove existing default route first
        let _ = std::process::Command::new("ip")
            .args(["route", "del", "default"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output();
        
        let _ = std::process::Command::new("ip")
            .args(["route", "add", "default", "via", &config.gateway])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output();
    }
    
    // Set DNS if provided
    if !config.dns.is_empty() {
        let resolv_content = format!("nameserver {}\n", config.dns);
        let _ = std::fs::write("/etc/resolv.conf", resolv_content);
    }
    
    // Save to /etc/network/interfaces for persistence
    let interfaces_content = format!(
        "auto lo\niface lo inet loopback\n\nauto {}\niface {} inet static\n    address {}\n    netmask {}\n    gateway {}\n",
        config.interface, config.interface, config.ip_address, config.netmask, config.gateway
    );
    let _ = std::fs::write("/etc/network/interfaces", interfaces_content);
    
    Ok(())
}

fn netmask_to_cidr(netmask: &str) -> u8 {
    let parts: Vec<u8> = netmask
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();
    
    if parts.len() != 4 {
        return 24; // Default to /24
    }
    
    let mut bits = 0u8;
    for octet in parts {
        bits += octet.count_ones() as u8;
    }
    bits
}

fn apply_wifi_config(config: &WiFiConfig) -> Result<()> {
    use std::process::Stdio;
    
    // Generate wpa_supplicant.conf content
    let wpa_content = if config.security == "OPEN" {
        format!(
            r#"ctrl_interface=/run/wpa_supplicant
update_config=1

network={{
    ssid="{}"
    key_mgmt=NONE
}}
"#,
            config.ssid
        )
    } else {
        format!(
            r#"ctrl_interface=/run/wpa_supplicant
update_config=1

network={{
    ssid="{}"
    psk="{}"
    key_mgmt=WPA-PSK
}}
"#,
            config.ssid, config.password
        )
    };
    
    // Write wpa_supplicant.conf
    std::fs::write("/etc/wpa_supplicant/wpa_supplicant.conf", wpa_content)?;
    
    // Find wireless interface
    let wireless_iface = find_wireless_interface().unwrap_or_else(|| "wlan0".to_string());
    
    // Stop any existing wpa_supplicant
    let _ = std::process::Command::new("pkill")
        .args(["-9", "wpa_supplicant"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output();
    
    // Bring wireless interface up
    let _ = std::process::Command::new("ip")
        .args(["link", "set", &wireless_iface, "up"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output();
    
    // Start wpa_supplicant
    let _ = std::process::Command::new("wpa_supplicant")
        .args(["-B", "-i", &wireless_iface, "-c", "/etc/wpa_supplicant/wpa_supplicant.conf"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    
    // Wait a moment for connection
    std::thread::sleep(std::time::Duration::from_secs(2));
    
    // Run DHCP on wireless interface
    let _ = std::process::Command::new("udhcpc")
        .args(["-i", &wireless_iface, "-n", "-q"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    
    Ok(())
}

fn find_wireless_interface() -> Option<String> {
    // Look for wireless interfaces in /sys/class/net/*/wireless
    if let Ok(entries) = std::fs::read_dir("/sys/class/net") {
        for entry in entries.flatten() {
            let path = entry.path();
            let wireless_path = path.join("wireless");
            if wireless_path.exists() {
                if let Some(name) = path.file_name() {
                    return Some(name.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

fn get_interface_names() -> Vec<String> {
    let mut interfaces = Vec::new();
    
    if let Ok(output) = std::process::Command::new("ip")
        .args(["-o", "link", "show"])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let iface = parts[1].trim_end_matches(':');
                // Skip loopback
                if iface != "lo" {
                    interfaces.push(iface.to_string());
                }
            }
        }
    }
    
    if interfaces.is_empty() {
        interfaces.push("eth0".to_string());
    }
    
    interfaces
}

fn ui(f: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),  // Header
            Constraint::Min(0),     // Content
            Constraint::Length(3),  // Footer
        ])
        .split(f.area());

    // Header - ESXi-style DCUI branding
    let header = Paragraph::new(vec![
        Line::from(vec![
            Span::styled(
                "QUANTIX-OS",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw(" v1.0.0 - "),
            Span::styled("Direct Console User Interface (DCUI)", Style::default().fg(Color::Gray)),
        ]),
    ])
    .block(Block::default().borders(Borders::ALL).title(" System Console "));
    f.render_widget(header, chunks[0]);

    // Content based on screen
    match app.screen {
        Screen::Main => render_main_screen(f, app, chunks[1]),
        Screen::Network => render_network_screen(f, chunks[1]),
        Screen::StaticIp => render_static_ip_screen(f, app, chunks[1]),
        Screen::WiFi => render_wifi_screen(f, app, chunks[1]),
        Screen::Ssh => render_ssh_screen(f, app, chunks[1]),
        Screen::Cluster => render_cluster_screen(f, app, chunks[1]),
        Screen::Diagnostics => render_diagnostics_screen(f, app, chunks[1]),
        Screen::Power => render_power_screen(f, chunks[1]),
        _ => render_placeholder_screen(f, chunks[1], &format!("{:?}", app.screen)),
    }

    // Footer with messages or help - improved visibility
    let (footer_text, footer_style) = if let Some(ref msg) = app.error_message {
        (
            vec![
                Line::from(vec![
                    Span::styled(" ❌ ERROR: ", Style::default().fg(Color::White).bg(Color::Red).add_modifier(Modifier::BOLD)),
                    Span::styled(format!(" {} ", msg), Style::default().fg(Color::Red).add_modifier(Modifier::BOLD)),
                ]),
            ],
            Style::default().fg(Color::Red),
        )
    } else if let Some(ref msg) = app.success_message {
        (
            vec![
                Line::from(vec![
                    Span::styled(" ✅ ", Style::default().fg(Color::White).bg(Color::Green).add_modifier(Modifier::BOLD)),
                    Span::styled(format!(" {} ", msg), Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
                ]),
            ],
            Style::default().fg(Color::Green),
        )
    } else if let Some((ref msg, _)) = app.status_message {
        (
            vec![
                Line::from(vec![
                    Span::styled(" ⏳ ", Style::default().fg(Color::Black).bg(Color::Yellow).add_modifier(Modifier::BOLD)),
                    Span::styled(format!(" {} ", msg), Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
                ]),
            ],
            Style::default().fg(Color::Yellow),
        )
    } else {
        (
            vec![
                Line::from(vec![
                    Span::styled(" ↑↓ ", Style::default().fg(Color::Cyan)),
                    Span::raw("Navigate  "),
                    Span::styled(" Enter ", Style::default().fg(Color::Cyan)),
                    Span::raw("Select  "),
                    Span::styled(" Esc ", Style::default().fg(Color::Cyan)),
                    Span::raw("Back  "),
                    Span::styled(" F5 ", Style::default().fg(Color::Yellow)),
                    Span::raw("Refresh  "),
                    Span::styled(" Ctrl+Q ", Style::default().fg(Color::Red)),
                    Span::raw("Quit"),
                ]),
            ],
            Style::default(),
        )
    };

    let footer_block = if app.error_message.is_some() {
        Block::default().borders(Borders::ALL).border_style(Style::default().fg(Color::Red)).title(" Message ")
    } else if app.success_message.is_some() {
        Block::default().borders(Borders::ALL).border_style(Style::default().fg(Color::Green)).title(" Message ")
    } else if app.status_message.is_some() {
        Block::default().borders(Borders::ALL).border_style(Style::default().fg(Color::Yellow)).title(" Status ")
    } else {
        Block::default().borders(Borders::ALL).title(" Help ")
    };

    let footer = Paragraph::new(footer_text)
        .block(footer_block)
        .style(footer_style);
    f.render_widget(footer, chunks[2]);
}

fn render_main_screen(f: &mut Frame, app: &App, area: Rect) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(area);

    // Left panel - System info
    let left_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(8),   // System info
            Constraint::Length(6),   // CPU/Memory
            Constraint::Min(0),      // Logs
        ])
        .margin(1)
        .split(chunks[0]);

    // System info - use cached values from app state
    let uptime = format_uptime(System::uptime());

    let info_text = vec![
        Line::from(vec![
            Span::styled("Hostname: ", Style::default().fg(Color::Gray)),
            Span::styled(&app.hostname, Style::default().fg(Color::White)),
        ]),
        Line::from(vec![
            Span::styled("IP:       ", Style::default().fg(Color::Gray)),
            Span::styled(&app.primary_ip, Style::default().fg(Color::Cyan)),
        ]),
        Line::from(vec![
            Span::styled("Status:   ", Style::default().fg(Color::Gray)),
            Span::styled("Standalone", Style::default().fg(Color::Yellow)),
        ]),
        Line::from(vec![
            Span::styled("Uptime:   ", Style::default().fg(Color::Gray)),
            Span::styled(&uptime, Style::default().fg(Color::White)),
        ]),
        Line::from(vec![
            Span::styled("VMs:      ", Style::default().fg(Color::Gray)),
            Span::styled(format!("{}", app.vm_count), Style::default().fg(Color::White)),
        ]),
    ];

    let info = Paragraph::new(info_text)
        .block(Block::default().borders(Borders::ALL).title("System Information"));
    f.render_widget(info, left_chunks[0]);

    // System resources (static display - no real-time updates to avoid flickering)
    let resources_text = vec![
        Line::from(vec![
            Span::styled("Resources: ", Style::default().fg(Color::Gray)),
            Span::styled("Press F5 to refresh", Style::default().fg(Color::DarkGray)),
        ]),
    ];
    let resources = Paragraph::new(resources_text)
        .block(Block::default().borders(Borders::ALL).title("System Status"));
    f.render_widget(resources, left_chunks[1]);

    // Management URL
    let url_text = format!("https://{}:8443", app.primary_ip);
    let url = Paragraph::new(vec![
        Line::from(Span::styled("Management URL:", Style::default().fg(Color::Gray))),
        Line::from(Span::styled(&url_text, Style::default().fg(Color::Cyan))),
    ])
    .block(Block::default().borders(Borders::ALL));
    f.render_widget(url, left_chunks[2]);

    // Right panel - Menu
    let menu_items: Vec<ListItem> = app
        .menu_items()
        .iter()
        .enumerate()
        .map(|(i, (label, shortcut))| {
            let style = if i == app.selected_menu {
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };

            ListItem::new(Line::from(vec![
                Span::styled(
                    if i == app.selected_menu { "▶ " } else { "  " },
                    style,
                ),
                Span::styled(*label, style),
                Span::raw("  "),
                Span::styled(*shortcut, Style::default().fg(Color::DarkGray)),
            ]))
        })
        .collect();

    let menu = List::new(menu_items)
        .block(Block::default().borders(Borders::ALL).title("Menu"));
    f.render_widget(menu, chunks[1]);
}

fn render_network_screen(f: &mut Frame, area: Rect) {
    // Get current network status
    let interfaces = get_network_interfaces();
    
    let mut lines = vec![
        Line::from(Span::styled("Network Configuration", Style::default().add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from(Span::styled("Current Interfaces:", Style::default().fg(Color::Cyan))),
        Line::from(""),
    ];
    
    for (iface, ip, status) in &interfaces {
        let status_color = if status == "UP" { Color::Green } else { Color::Red };
        lines.push(Line::from(vec![
            Span::raw("  "),
            Span::styled(format!("{:<12}", iface), Style::default().fg(Color::White)),
            Span::styled(format!("{:<16}", ip), Style::default().fg(Color::Cyan)),
            Span::styled(status, Style::default().fg(status_color)),
        ]));
    }
    
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("Actions:", Style::default().fg(Color::Cyan))));
    lines.push(Line::from(""));
    lines.push(Line::from("  D - Run DHCP on all interfaces"));
    lines.push(Line::from("  R - Restart network service"));
    lines.push(Line::from("  S - Set static IP (manual entry)"));
    lines.push(Line::from("  W - Configure WiFi"));
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("Press Esc to return", Style::default().fg(Color::Yellow))));

    let text = Paragraph::new(lines)
    .block(Block::default().borders(Borders::ALL).title("Network"))
    .wrap(Wrap { trim: true });
    f.render_widget(text, area);
}

fn render_static_ip_screen(f: &mut Frame, app: &App, area: Rect) {
    let mut lines = vec![
        Line::from(Span::styled("Static IP Configuration", Style::default().add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from(Span::styled("Use Tab/↑↓ to navigate fields, Left/Right to select interface", Style::default().fg(Color::DarkGray))),
        Line::from(Span::styled("Press Enter to apply, Esc to cancel", Style::default().fg(Color::DarkGray))),
        Line::from(""),
    ];
    
    // Field labels and values
    let fields = [
        ("Interface:", &app.static_ip_config.interface, true),  // true = selector
        ("IP Address:", &app.static_ip_config.ip_address, false),
        ("Netmask:", &app.static_ip_config.netmask, false),
        ("Gateway:", &app.static_ip_config.gateway, false),
        ("DNS Server:", &app.static_ip_config.dns, false),
    ];
    
    for (i, (label, value, is_selector)) in fields.iter().enumerate() {
        let is_selected = i == app.input_field_index;
        let label_style = Style::default().fg(Color::Gray);
        let value_style = if is_selected {
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::White)
        };
        
        let cursor = if is_selected { "▶ " } else { "  " };
        
        // Show cursor indicator for text input fields
        let final_value = if *is_selector {
            if is_selected {
                format!("◀ {} ▶", value)
            } else {
                value.to_string()
            }
        } else if is_selected {
            // Show block cursor for selected text field
            if value.is_empty() {
                "█ (type here)".to_string()
            } else {
                format!("{}█", value)
            }
        } else if value.is_empty() {
            "(not set)".to_string()
        } else {
            value.to_string()
        };
        
        lines.push(Line::from(vec![
            Span::styled(cursor, value_style),
            Span::styled(format!("{:<12}", label), label_style),
            Span::styled(final_value, value_style),
        ]));
    }
    
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("Type IP address (numbers and dots only)", Style::default().fg(Color::DarkGray))));
    
    let text = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title("Static IP"))
        .wrap(Wrap { trim: true });
    f.render_widget(text, area);
}

fn render_wifi_screen(f: &mut Frame, app: &App, area: Rect) {
    let mut lines = vec![
        Line::from(Span::styled("WiFi Configuration", Style::default().add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from(Span::styled("Use Tab/↑↓ to navigate, Left/Right for security type", Style::default().fg(Color::DarkGray))),
        Line::from(Span::styled("Press Enter to connect, Esc to cancel", Style::default().fg(Color::DarkGray))),
        Line::from(""),
    ];
    
    // Check for wireless interface
    let wireless_iface = find_wireless_interface();
    if wireless_iface.is_none() {
        lines.push(Line::from(Span::styled("⚠ No wireless interface detected!", Style::default().fg(Color::Red))));
        lines.push(Line::from(""));
    } else {
        lines.push(Line::from(vec![
            Span::styled("Wireless Interface: ", Style::default().fg(Color::Gray)),
            Span::styled(wireless_iface.as_ref().unwrap(), Style::default().fg(Color::Cyan)),
        ]));
        lines.push(Line::from(""));
    }
    
    // Field labels and values
    let fields = [
        ("SSID:", &app.wifi_config.ssid, false),
        ("Password:", &mask_password(&app.wifi_config.password), false),
        ("Security:", &app.wifi_config.security, true), // true = selector
    ];
    
    for (i, (label, value, is_selector)) in fields.iter().enumerate() {
        let is_selected = i == app.input_field_index;
        let label_style = Style::default().fg(Color::Gray);
        let value_style = if is_selected {
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::White)
        };
        
        let cursor = if is_selected { "▶ " } else { "  " };
        
        // Show cursor indicator for text input fields
        let final_value = if *is_selector {
            if is_selected {
                format!("◀ {} ▶", value)
            } else {
                value.to_string()
            }
        } else if is_selected {
            // Show block cursor for selected text field
            if value.is_empty() {
                "█ (type here)".to_string()
            } else {
                format!("{}█", value)
            }
        } else if value.is_empty() {
            "(not set)".to_string()
        } else {
            value.to_string()
        };
        
        lines.push(Line::from(vec![
            Span::styled(cursor, value_style),
            Span::styled(format!("{:<12}", label), label_style),
            Span::styled(final_value, value_style),
        ]));
    }
    
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("Security options: WPA2, WPA3, OPEN", Style::default().fg(Color::DarkGray))));
    
    let text = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title("WiFi"))
        .wrap(Wrap { trim: true });
    f.render_widget(text, area);
}

fn handle_ssh_input(app: &mut App, key: KeyCode) {
    match key {
        KeyCode::Esc => {
            app.screen = Screen::Main;
        }
        KeyCode::Tab | KeyCode::Down => {
            // Move to next field (2 fields: enable/disable toggle, timer)
            app.input_field_index = (app.input_field_index + 1) % 2;
        }
        KeyCode::BackTab | KeyCode::Up => {
            // Move to previous field
            if app.input_field_index > 0 {
                app.input_field_index -= 1;
            } else {
                app.input_field_index = 1;
            }
        }
        KeyCode::Left => {
            if app.input_field_index == 1 {
                // Decrease timer (min 5 minutes)
                if app.ssh_config.timer_minutes > 5 {
                    app.ssh_config.timer_minutes -= 5;
                }
            }
        }
        KeyCode::Right => {
            if app.input_field_index == 1 {
                // Increase timer (max 120 minutes)
                if app.ssh_config.timer_minutes < 120 {
                    app.ssh_config.timer_minutes += 5;
                }
            }
        }
        KeyCode::Char(' ') | KeyCode::Enter => {
            if app.input_field_index == 0 {
                // Toggle SSH
                if app.ssh_config.enabled {
                    // Disable SSH
                    if disable_ssh().is_ok() {
                        app.ssh_config.enabled = false;
                        app.ssh_config.timer_start = None;
                        app.set_status("SSH access disabled");
                        app.success_message = Some("SSH disabled successfully".to_string());
                    } else {
                        app.error_message = Some("Failed to disable SSH".to_string());
                    }
                } else {
                    // Enable SSH with timer
                    if enable_ssh().is_ok() {
                        app.ssh_config.enabled = true;
                        app.ssh_config.timer_start = Some(std::time::Instant::now());
                        app.set_status(&format!("SSH enabled for {} minutes", app.ssh_config.timer_minutes));
                        app.success_message = Some(format!(
                            "SSH enabled - will auto-disable in {} minutes",
                            app.ssh_config.timer_minutes
                        ));
                    } else {
                        app.error_message = Some("Failed to enable SSH".to_string());
                    }
                }
            }
        }
        KeyCode::Char('e') | KeyCode::Char('E') => {
            // Quick enable SSH with timer
            if !app.ssh_config.enabled {
                if enable_ssh().is_ok() {
                    app.ssh_config.enabled = true;
                    app.ssh_config.timer_start = Some(std::time::Instant::now());
                    app.set_status(&format!("SSH enabled for {} minutes", app.ssh_config.timer_minutes));
                    app.success_message = Some(format!(
                        "SSH enabled - will auto-disable in {} minutes",
                        app.ssh_config.timer_minutes
                    ));
                }
            }
        }
        KeyCode::Char('d') | KeyCode::Char('D') => {
            // Quick disable SSH
            if app.ssh_config.enabled {
                if disable_ssh().is_ok() {
                    app.ssh_config.enabled = false;
                    app.ssh_config.timer_start = None;
                    app.set_status("SSH access disabled");
                    app.success_message = Some("SSH disabled".to_string());
                }
            }
        }
        KeyCode::Char('p') | KeyCode::Char('P') => {
            // Make SSH permanent (no timer)
            if app.ssh_config.enabled {
                app.ssh_config.timer_start = None;
                app.set_status("SSH set to permanent (no auto-disable)");
                app.success_message = Some("SSH timer disabled - connection is now permanent".to_string());
            }
        }
        _ => {}
    }
}

fn mask_password(password: &str) -> String {
    "*".repeat(password.len())
}

fn get_network_interfaces() -> Vec<(String, String, String)> {
    let mut interfaces = Vec::new();
    
    // Get list of interfaces
    if let Ok(output) = std::process::Command::new("ip")
        .args(["-o", "link", "show"])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let iface = parts[1].trim_end_matches(':');
                // Skip loopback
                if iface == "lo" {
                    continue;
                }
                
                // Get IP address
                let ip = get_interface_ip(iface);
                
                // Get status (UP/DOWN)
                let status = if line.contains("state UP") { "UP" } else { "DOWN" };
                
                interfaces.push((iface.to_string(), ip, status.to_string()));
            }
        }
    }
    
    if interfaces.is_empty() {
        interfaces.push(("(no interfaces)".to_string(), "-".to_string(), "-".to_string()));
    }
    
    interfaces
}

fn get_interface_ip(iface: &str) -> String {
    if let Ok(output) = std::process::Command::new("ip")
        .args(["-4", "addr", "show", iface])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("inet ") {
                if let Some(ip) = line.split_whitespace().nth(1) {
                    return ip.to_string();
                }
            }
        }
    }
    "No IP".to_string()
}

fn render_ssh_screen(f: &mut Frame, app: &App, area: Rect) {
    let mut lines = vec![
        Line::from(Span::styled("🔐 SSH Access Configuration", Style::default().add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from(Span::styled("Configure secure shell access to this host.", Style::default().fg(Color::DarkGray))),
        Line::from(Span::styled("SSH will auto-disable after timer expires for security.", Style::default().fg(Color::DarkGray))),
        Line::from(""),
    ];
    
    // Current status with prominent display
    let status_style = if app.ssh_config.enabled {
        Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::Red).add_modifier(Modifier::BOLD)
    };
    
    let status_text = if app.ssh_config.enabled {
        "● SSH ENABLED"
    } else {
        "○ SSH DISABLED"
    };
    
    lines.push(Line::from(vec![
        Span::styled("Current Status: ", Style::default().fg(Color::Gray)),
        Span::styled(status_text, status_style),
    ]));
    
    // Show remaining time if timer is active
    if let Some(start) = app.ssh_config.timer_start {
        let elapsed_mins = start.elapsed().as_secs() / 60;
        let remaining = app.ssh_config.timer_minutes.saturating_sub(elapsed_mins as u32);
        lines.push(Line::from(vec![
            Span::styled("Time Remaining: ", Style::default().fg(Color::Gray)),
            Span::styled(format!("{} minutes", remaining), Style::default().fg(Color::Yellow)),
        ]));
    } else if app.ssh_config.enabled {
        lines.push(Line::from(vec![
            Span::styled("Timer: ", Style::default().fg(Color::Gray)),
            Span::styled("Permanent (no auto-disable)", Style::default().fg(Color::Cyan)),
        ]));
    }
    
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("─".repeat(50), Style::default().fg(Color::DarkGray))));
    lines.push(Line::from(""));
    
    // Enable/Disable toggle
    let toggle_selected = app.input_field_index == 0;
    let toggle_style = if toggle_selected {
        Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::White)
    };
    
    let toggle_text = if app.ssh_config.enabled {
        "[  ENABLED  ] - Press Space to disable"
    } else {
        "[ DISABLED ] - Press Space to enable"
    };
    
    lines.push(Line::from(vec![
        Span::styled(if toggle_selected { "▶ " } else { "  " }, toggle_style),
        Span::styled("SSH Access: ", Style::default().fg(Color::Gray)),
        Span::styled(toggle_text, toggle_style),
    ]));
    
    lines.push(Line::from(""));
    
    // Timer setting
    let timer_selected = app.input_field_index == 1;
    let timer_style = if timer_selected {
        Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::White)
    };
    
    lines.push(Line::from(vec![
        Span::styled(if timer_selected { "▶ " } else { "  " }, timer_style),
        Span::styled("Auto-Disable Timer: ", Style::default().fg(Color::Gray)),
        Span::styled(
            format!("◀ {} minutes ▶", app.ssh_config.timer_minutes),
            timer_style,
        ),
    ]));
    
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("─".repeat(50), Style::default().fg(Color::DarkGray))));
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("Quick Actions:", Style::default().fg(Color::Cyan))));
    lines.push(Line::from(""));
    lines.push(Line::from("  E - Enable SSH with timer"));
    lines.push(Line::from("  D - Disable SSH immediately"));
    lines.push(Line::from("  P - Make SSH permanent (disable timer)"));
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("Use ←/→ to adjust timer (5-120 min), Tab to switch fields", Style::default().fg(Color::DarkGray))));
    lines.push(Line::from(Span::styled("Press Esc to return to main menu", Style::default().fg(Color::Yellow))));
    
    let text = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title("SSH Configuration"))
        .wrap(Wrap { trim: true });
    f.render_widget(text, area);
}

fn render_cluster_screen(f: &mut Frame, app: &App, area: Rect) {
    let mut lines = vec![
        Line::from(Span::styled("🔗 Cluster Configuration", Style::default().add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from(Span::styled("Join this host to a Quantix-vDC control plane cluster.", Style::default().fg(Color::DarkGray))),
        Line::from(Span::styled("When joined, the host will be managed centrally.", Style::default().fg(Color::DarkGray))),
        Line::from(""),
    ];
    
    // Current status with prominent display
    let status_style = match &app.cluster_config.status {
        ClusterStatus::Connected => Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
        ClusterStatus::Standalone => Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
        ClusterStatus::Joining => Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        ClusterStatus::Disconnected => Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
        ClusterStatus::Error(_) => Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
    };
    
    let status_text = match &app.cluster_config.status {
        ClusterStatus::Connected => "● CONNECTED TO CLUSTER",
        ClusterStatus::Standalone => "○ STANDALONE MODE",
        ClusterStatus::Joining => "◐ JOINING CLUSTER...",
        ClusterStatus::Disconnected => "◯ DISCONNECTED",
        ClusterStatus::Error(_) => "✖ ERROR",
    };
    
    lines.push(Line::from(vec![
        Span::styled("Current Status: ", Style::default().fg(Color::Gray)),
        Span::styled(status_text, status_style),
    ]));
    
    // Show error details if any
    if let ClusterStatus::Error(ref msg) = app.cluster_config.status {
        lines.push(Line::from(vec![
            Span::styled("  Error: ", Style::default().fg(Color::Red)),
            Span::styled(msg.as_str(), Style::default().fg(Color::Red)),
        ]));
    }
    
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("─".repeat(50), Style::default().fg(Color::DarkGray))));
    lines.push(Line::from(""));
    
    // Show join form only if not connected
    if !matches!(app.cluster_config.status, ClusterStatus::Connected) {
        lines.push(Line::from(Span::styled("Join Cluster:", Style::default().fg(Color::Cyan))));
        lines.push(Line::from(""));
        
        // Control plane address field
        let addr_selected = app.input_field_index == 0;
        let addr_style = if addr_selected {
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::White)
        };
        
        let addr_value = if app.cluster_config.control_plane_address.is_empty() {
            if addr_selected { "█ (e.g., https://control:8080)".to_string() } else { "(not set)".to_string() }
        } else if addr_selected {
            format!("{}█", app.cluster_config.control_plane_address)
        } else {
            app.cluster_config.control_plane_address.clone()
        };
        
        lines.push(Line::from(vec![
            Span::styled(if addr_selected { "▶ " } else { "  " }, addr_style),
            Span::styled("Control Plane: ", Style::default().fg(Color::Gray)),
            Span::styled(addr_value, addr_style),
        ]));
        
        lines.push(Line::from(""));
        
        // Registration token field
        let token_selected = app.input_field_index == 1;
        let token_style = if token_selected {
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::White)
        };
        
        let token_display = if app.cluster_config.registration_token.is_empty() {
            if token_selected { "█ (registration token)".to_string() } else { "(not set)".to_string() }
        } else if token_selected {
            format!("{}█", "*".repeat(app.cluster_config.registration_token.len()))
        } else {
            "*".repeat(app.cluster_config.registration_token.len().min(20))
        };
        
        lines.push(Line::from(vec![
            Span::styled(if token_selected { "▶ " } else { "  " }, token_style),
            Span::styled("Token:         ", Style::default().fg(Color::Gray)),
            Span::styled(token_display, token_style),
        ]));
        
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled("─".repeat(50), Style::default().fg(Color::DarkGray))));
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled("Actions:", Style::default().fg(Color::Cyan))));
        lines.push(Line::from(""));
        lines.push(Line::from("  J - Join Cluster (apply settings)"));
        lines.push(Line::from("  C - Clear form"));
    } else {
        // Connected - show leave option
        lines.push(Line::from(Span::styled("Cluster Actions:", Style::default().fg(Color::Cyan))));
        lines.push(Line::from(""));
        lines.push(Line::from("  L - Leave Cluster (return to standalone)"));
        lines.push(Line::from("  R - Refresh Status"));
    }
    
    lines.push(Line::from(""));
    lines.push(Line::from(Span::styled("Use Tab/↑↓ to navigate, type to enter values", Style::default().fg(Color::DarkGray))));
    lines.push(Line::from(Span::styled("Press Esc to return to main menu", Style::default().fg(Color::Yellow))));
    
    let text = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title("Cluster Management"))
        .wrap(Wrap { trim: true });
    f.render_widget(text, area);
}

fn handle_cluster_input(app: &mut App, key: KeyCode) {
    match key {
        KeyCode::Esc => {
            app.screen = Screen::Main;
        }
        KeyCode::Tab | KeyCode::Down => {
            // Toggle between address and token fields
            app.input_field_index = (app.input_field_index + 1) % 2;
        }
        KeyCode::BackTab | KeyCode::Up => {
            if app.input_field_index > 0 {
                app.input_field_index -= 1;
            } else {
                app.input_field_index = 1;
            }
        }
        KeyCode::Char(c) => {
            // Allow typing in the current field
            match app.input_field_index {
                0 => {
                    // Control plane address - allow URL-safe characters
                    if c.is_ascii_alphanumeric() || ":/.-_".contains(c) {
                        app.cluster_config.control_plane_address.push(c);
                    }
                }
                1 => {
                    // Registration token - allow alphanumeric and common token chars
                    if c.is_ascii_alphanumeric() || "-_".contains(c) {
                        app.cluster_config.registration_token.push(c);
                    }
                }
                _ => {}
            }
        }
        KeyCode::Backspace => {
            match app.input_field_index {
                0 => { app.cluster_config.control_plane_address.pop(); }
                1 => { app.cluster_config.registration_token.pop(); }
                _ => {}
            }
        }
        KeyCode::Enter => {
            // Same as 'J' - join cluster
            if !matches!(app.cluster_config.status, ClusterStatus::Connected) {
                attempt_join_cluster(app);
            }
        }
        _ => {
            // Handle quick action keys
            match key {
                KeyCode::Char('j') | KeyCode::Char('J') => {
                    if !matches!(app.cluster_config.status, ClusterStatus::Connected) {
                        attempt_join_cluster(app);
                    }
                }
                KeyCode::Char('l') | KeyCode::Char('L') => {
                    if matches!(app.cluster_config.status, ClusterStatus::Connected) {
                        attempt_leave_cluster(app);
                    }
                }
                KeyCode::Char('c') | KeyCode::Char('C') => {
                    // Clear form
                    app.cluster_config.control_plane_address.clear();
                    app.cluster_config.registration_token.clear();
                    app.success_message = Some("Form cleared".to_string());
                }
                KeyCode::Char('r') | KeyCode::Char('R') => {
                    // Refresh status
                    app.cluster_config.status = get_cluster_status();
                    app.success_message = Some("Status refreshed".to_string());
                }
                _ => {}
            }
        }
    }
}

fn attempt_join_cluster(app: &mut App) {
    // Validate inputs
    if app.cluster_config.control_plane_address.is_empty() {
        app.error_message = Some("Control plane address is required".to_string());
        return;
    }
    
    if app.cluster_config.registration_token.is_empty() {
        app.error_message = Some("Registration token is required".to_string());
        return;
    }
    
    app.cluster_config.status = ClusterStatus::Joining;
    app.set_status("Joining cluster...");
    
    // Make API call to join cluster
    match join_cluster_api(
        &app.cluster_config.control_plane_address,
        &app.cluster_config.registration_token,
    ) {
        Ok(_) => {
            app.cluster_config.status = ClusterStatus::Connected;
            app.success_message = Some("Successfully joined cluster! Restart may be required.".to_string());
        }
        Err(e) => {
            app.cluster_config.status = ClusterStatus::Error(e.clone());
            app.error_message = Some(format!("Failed to join: {}", e));
        }
    }
}

fn attempt_leave_cluster(app: &mut App) {
    app.set_status("Leaving cluster...");
    
    match leave_cluster_api() {
        Ok(_) => {
            app.cluster_config.status = ClusterStatus::Standalone;
            app.cluster_config.control_plane_address.clear();
            app.cluster_config.registration_token.clear();
            app.success_message = Some("Left cluster. Now in standalone mode.".to_string());
        }
        Err(e) => {
            app.error_message = Some(format!("Failed to leave cluster: {}", e));
        }
    }
}

/// Get current cluster status by calling the local node daemon API
fn get_cluster_status() -> ClusterStatus {
    // Try to call the local node daemon API
    // The node daemon runs on localhost:8443
    match std::process::Command::new("curl")
        .args(["-s", "-k", "--max-time", "2", "https://127.0.0.1:8443/api/v1/cluster/status"])
        .output()
    {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                // Simple JSON parsing - look for "status" field
                if stdout.contains("\"status\":\"connected\"") {
                    ClusterStatus::Connected
                } else if stdout.contains("\"status\":\"disconnected\"") {
                    ClusterStatus::Disconnected
                } else {
                    ClusterStatus::Standalone
                }
            } else {
                ClusterStatus::Standalone
            }
        }
        Err(_) => ClusterStatus::Standalone,
    }
}

/// Call the node daemon API to join a cluster
fn join_cluster_api(control_plane: &str, token: &str) -> Result<(), String> {
    use std::process::Stdio;
    
    // Build JSON payload
    let payload = format!(
        r#"{{"controlPlaneAddress":"{}","registrationToken":"{}"}}"#,
        control_plane, token
    );
    
    // Call the local node daemon API
    let result = std::process::Command::new("curl")
        .args([
            "-s", "-k", "--max-time", "10",
            "-X", "POST",
            "-H", "Content-Type: application/json",
            "-d", &payload,
            "https://127.0.0.1:8443/api/v1/cluster/join"
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    
    match result {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.contains("\"error\"") {
                    // Extract error message
                    Err(stdout.to_string())
                } else {
                    Ok(())
                }
            } else {
                Err("API request failed".to_string())
            }
        }
        Err(e) => Err(format!("Failed to connect to node daemon: {}", e)),
    }
}

/// Call the node daemon API to leave a cluster
fn leave_cluster_api() -> Result<(), String> {
    use std::process::Stdio;
    
    let result = std::process::Command::new("curl")
        .args([
            "-s", "-k", "--max-time", "10",
            "-X", "POST",
            "https://127.0.0.1:8443/api/v1/cluster/leave"
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    
    match result {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.contains("\"error\"") {
                    Err(stdout.to_string())
                } else {
                    Ok(())
                }
            } else {
                Err("API request failed".to_string())
            }
        }
        Err(e) => Err(format!("Failed to connect to node daemon: {}", e)),
    }
}

fn render_diagnostics_screen(f: &mut Frame, app: &App, area: Rect) {
    let cpus = app.system.cpus();
    let cpu_count = cpus.len();
    let total_mem = app.system.total_memory();
    let used_mem = app.system.used_memory();

    let text = vec![
        Line::from(Span::styled("System Diagnostics", Style::default().add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from(format!("CPU Cores: {}", cpu_count)),
        Line::from(format!("Total Memory: {}", format_bytes(total_mem))),
        Line::from(format!("Used Memory: {}", format_bytes(used_mem))),
        Line::from(format!("Free Memory: {}", format_bytes(total_mem - used_mem))),
        Line::from(""),
        Line::from(Span::styled("Press Esc to return", Style::default().fg(Color::Yellow))),
    ];

    let diag = Paragraph::new(text)
        .block(Block::default().borders(Borders::ALL).title("Diagnostics"))
        .wrap(Wrap { trim: true });
    f.render_widget(diag, area);
}

fn render_power_screen(f: &mut Frame, area: Rect) {
    let text = Paragraph::new(vec![
        Line::from(Span::styled("⚠️  Power Options", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))),
        Line::from(""),
        Line::from("This will affect all running VMs!"),
        Line::from(""),
        Line::from("R - Reboot"),
        Line::from("S - Shutdown"),
        Line::from(""),
        Line::from(Span::styled("Press Esc to cancel", Style::default().fg(Color::Yellow))),
    ])
    .block(Block::default().borders(Borders::ALL).title("Shutdown / Reboot"))
    .wrap(Wrap { trim: true });
    f.render_widget(text, area);
}

fn render_placeholder_screen(f: &mut Frame, area: Rect, name: &str) {
    let text = Paragraph::new(vec![
        Line::from(format!("{} Screen", name)),
        Line::from(""),
        Line::from("This feature is not yet implemented."),
        Line::from(""),
        Line::from(Span::styled("Press Esc to return", Style::default().fg(Color::Yellow))),
    ])
    .block(Block::default().borders(Borders::ALL).title(name))
    .wrap(Wrap { trim: true });
    f.render_widget(text, area);
}

// Helper functions

fn get_primary_ip() -> String {
    // Try common interfaces
    for iface in ["eth0", "ens3", "enp0s3"] {
        if let Ok(content) = std::process::Command::new("ip")
            .args(["-4", "addr", "show", iface])
            .output()
        {
            let stdout = String::from_utf8_lossy(&content.stdout);
            for line in stdout.lines() {
                if line.contains("inet ") {
                    if let Some(ip) = line.split_whitespace().nth(1) {
                        return ip.split('/').next().unwrap_or("0.0.0.0").to_string();
                    }
                }
            }
        }
    }
    "0.0.0.0".to_string()
}

fn format_uptime(seconds: u64) -> String {
    let days = seconds / 86400;
    let hours = (seconds % 86400) / 3600;
    if days > 0 {
        format!("{}d {}h", days, hours)
    } else {
        format!("{}h {}m", hours, (seconds % 3600) / 60)
    }
}

fn format_bytes(bytes: u64) -> String {
    const GB: u64 = 1024 * 1024 * 1024;
    const MB: u64 = 1024 * 1024;
    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    }
}

fn get_vm_count() -> i32 {
    std::process::Command::new("virsh")
        .args(["list", "--all", "--name"])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .count() as i32
        })
        .unwrap_or(0)
}

fn is_ssh_enabled() -> bool {
    // Check if sshd process is running instead of using rc-service (faster, non-blocking)
    std::process::Command::new("pgrep")
        .args(["-x", "sshd"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn enable_ssh() -> Result<()> {
    use std::process::Stdio;
    // Use spawn() to avoid blocking the TUI
    std::process::Command::new("rc-service")
        .args(["sshd", "start"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()?;
    Ok(())
}

fn disable_ssh() -> Result<()> {
    use std::process::Stdio;
    // Use spawn() to avoid blocking the TUI
    std::process::Command::new("rc-service")
        .args(["sshd", "stop"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()?;
    Ok(())
}

fn run_dhcp_all() {
    use std::process::Stdio;
    // Get all interfaces and run DHCP
    // Note: This one blocking call is OK - it's fast (just reads interface list)
    if let Ok(output) = std::process::Command::new("ip")
        .args(["-o", "link", "show"])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let iface = parts[1].trim_end_matches(':');
                if iface == "lo" {
                    continue;
                }
                
                // Bring interface up (non-blocking)
                let _ = std::process::Command::new("ip")
                    .args(["link", "set", iface, "up"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .stdin(Stdio::null())
                    .spawn();
                
                // Run DHCP (kill existing first, non-blocking)
                let _ = std::process::Command::new("pkill")
                    .args(["-f", &format!("udhcpc.*{}", iface)])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .stdin(Stdio::null())
                    .spawn();
                
                // Run udhcpc silently in background (non-blocking)
                let _ = std::process::Command::new("udhcpc")
                    .args(["-i", iface, "-n", "-q", "-t", "3"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .stdin(Stdio::null())
                    .spawn();
            }
        }
    }
}

fn restart_network() {
    use std::process::Stdio;
    // Use spawn() instead of output() to avoid blocking the TUI
    // The network restart runs in background
    let _ = std::process::Command::new("rc-service")
        .args(["networking", "restart"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn();
}

fn configure_wifi() {
    use std::process::Stdio;
    // Start wpa_supplicant if not running
    let _ = std::process::Command::new("rc-service")
        .args(["wpa_supplicant", "start"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output();
}
