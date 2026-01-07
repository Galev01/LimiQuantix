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
}

/// Application screens
#[derive(Clone, Copy, PartialEq, Debug)]
enum Screen {
    Main,
    Network,
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
            ("Enable/Disable SSH", "F3"),
            ("Join/Leave Cluster", "F4"),
            ("Restart Management Services", "F5"),
            ("View System Logs", "F7"),
            ("Reset to Factory Defaults", "F9"),
            ("Shutdown / Reboot", "F10"),
            ("Exit to Web Console", "F12"),
        ]
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
        // Block waiting for input - no polling, no flickering!
        // This uses zero CPU while waiting for user input
        if let Event::Key(key) = event::read()? {
            handle_input(app, key.code, key.modifiers);
            
            // Only redraw after user input
            terminal.draw(|f| ui(f, app))?;
        }

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
            KeyCode::F(3) => handle_menu_action(app, 1),  // SSH
            KeyCode::F(4) => handle_menu_action(app, 2),  // Cluster
            KeyCode::F(5) => handle_menu_action(app, 3),  // Restart Services
            KeyCode::F(7) => handle_menu_action(app, 4),  // Logs
            KeyCode::F(9) => handle_menu_action(app, 5),  // Factory Reset
            KeyCode::F(10) => handle_menu_action(app, 6), // Shutdown
            KeyCode::F(12) => handle_menu_action(app, 7), // Exit to Web
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
            _ => {}
        },
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
            // Toggle SSH
            let ssh_enabled = is_ssh_enabled();
            if ssh_enabled {
                if disable_ssh().is_ok() {
                    app.success_message = Some("SSH disabled".to_string());
                } else {
                    app.error_message = Some("Failed to disable SSH".to_string());
                }
            } else {
                if enable_ssh().is_ok() {
                    app.success_message = Some("SSH enabled".to_string());
                } else {
                    app.error_message = Some("Failed to enable SSH".to_string());
                }
            }
        }
        2 => app.screen = Screen::Cluster,
        3 => {
            app.success_message = Some("Restarting management services...".to_string());
            restart_management_services();
        }
        4 => app.screen = Screen::Diagnostics,
        5 => {
            app.error_message = Some("Factory reset requires confirmation in a future update".to_string());
        }
        6 => app.screen = Screen::Power,
        7 => {
            // Exit to web console (quit TUI so launcher can restart web kiosk)
            app.should_quit = true;
        }
        _ => {}
    }
}

fn restart_management_services() {
    use std::process::Stdio;
    // Redirect all output to null to prevent TUI corruption
    let _ = std::process::Command::new("rc-service")
        .args(["quantix-node", "restart"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    let _ = std::process::Command::new("rc-service")
        .args(["quantix-network", "restart"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
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
        Screen::Diagnostics => render_diagnostics_screen(f, app, chunks[1]),
        Screen::Power => render_power_screen(f, chunks[1]),
        _ => render_placeholder_screen(f, chunks[1], &format!("{:?}", app.screen)),
    }

    // Footer with messages or help
    let footer_text = if let Some(ref msg) = app.error_message {
        Line::from(Span::styled(
            format!("❌ {}", msg),
            Style::default().fg(Color::Red),
        ))
    } else if let Some(ref msg) = app.success_message {
        Line::from(Span::styled(
            format!("✅ {}", msg),
            Style::default().fg(Color::Green),
        ))
    } else {
        Line::from(vec![
            Span::raw("↑↓ Navigate | "),
            Span::raw("Enter Select | "),
            Span::raw("Esc Back | "),
            Span::styled("Ctrl+Q", Style::default().fg(Color::Yellow)),
            Span::raw(" Quit"),
        ])
    };

    let footer = Paragraph::new(footer_text)
        .block(Block::default().borders(Borders::ALL));
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
    std::process::Command::new("rc-service")
        .args(["sshd", "status"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("started"))
        .unwrap_or(false)
}

fn enable_ssh() -> Result<()> {
    use std::process::Stdio;
    std::process::Command::new("rc-service")
        .args(["sshd", "start"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()?;
    Ok(())
}

fn disable_ssh() -> Result<()> {
    use std::process::Stdio;
    std::process::Command::new("rc-service")
        .args(["sshd", "stop"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()?;
    Ok(())
}

fn run_dhcp_all() {
    use std::process::Stdio;
    // Get all interfaces and run DHCP
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
                
                // Bring interface up (silent)
                let _ = std::process::Command::new("ip")
                    .args(["link", "set", iface, "up"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .output();
                
                // Run DHCP (kill existing first, silent)
                let _ = std::process::Command::new("pkill")
                    .args(["-f", &format!("udhcpc.*{}", iface)])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .output();
                
                // Run udhcpc silently in background
                let _ = std::process::Command::new("udhcpc")
                    .args(["-i", iface, "-n", "-q"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn();
            }
        }
    }
}

fn restart_network() {
    use std::process::Stdio;
    let _ = std::process::Command::new("rc-service")
        .args(["quantix-network", "restart"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output();
}
