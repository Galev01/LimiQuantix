//! Quantix-OS Console (DCUI)
//!
//! Minimal console interface showing connection info with network troubleshooting.
//! Primary management is done via the web UI.

use std::io::{self, Stdout};
use std::process::Command;
use std::time::Duration;

use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph},
    Frame, Terminal,
};
use sysinfo::System;

mod config;
mod logs;
mod network;
mod system;

use config::NodeConfig;

// =============================================================================
// Application State
// =============================================================================

#[derive(Clone, Copy, PartialEq)]
enum Screen {
    Main,
    NetworkMenu,
    NetworkConfig,
    NetworkDiag,
    ServiceMenu,
    ShellConfirm,
}

struct App {
    config: NodeConfig,
    system: System,
    screen: Screen,
    menu_state: ListState,
    should_exit: bool,
    last_refresh: std::time::Instant,
    // Network config state
    interfaces: Vec<NetworkInterface>,
    selected_interface: usize,
    // Diagnostic output
    diag_output: Vec<String>,
    diag_running: bool,
}

#[derive(Clone)]
struct NetworkInterface {
    name: String,
    ip: Option<String>,
    mac: String,
    state: String,
}

impl App {
    fn new() -> Result<Self> {
        let config = NodeConfig::load().unwrap_or_default();
        let mut system = System::new_all();
        system.refresh_all();

        let mut menu_state = ListState::default();
        menu_state.select(Some(0));

        Ok(Self {
            config,
            system,
            screen: Screen::Main,
            menu_state,
            should_exit: false,
            last_refresh: std::time::Instant::now(),
            interfaces: Vec::new(),
            selected_interface: 0,
            diag_output: Vec::new(),
            diag_running: false,
        })
    }

    fn refresh(&mut self) {
        if self.last_refresh.elapsed() > Duration::from_secs(5) {
            self.system.refresh_all();
            self.last_refresh = std::time::Instant::now();
        }
    }

    fn load_interfaces(&mut self) {
        self.interfaces.clear();
        
        // Parse ip link show output
        if let Ok(output) = Command::new("ip").args(["link", "show"]).output() {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut current_iface: Option<NetworkInterface> = None;
            
            for line in text.lines() {
                if line.starts_with(char::is_numeric) {
                    // Save previous interface
                    if let Some(iface) = current_iface.take() {
                        if iface.name != "lo" {
                            self.interfaces.push(iface);
                        }
                    }
                    
                    // Parse new interface line: "2: eth0: <...> state UP ..."
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        let name = parts[1].trim_end_matches(':').to_string();
                        let state = if line.contains("state UP") {
                            "UP".to_string()
                        } else if line.contains("state DOWN") {
                            "DOWN".to_string()
                        } else {
                            "UNKNOWN".to_string()
                        };
                        
                        current_iface = Some(NetworkInterface {
                            name,
                            ip: None,
                            mac: String::new(),
                            state,
                        });
                    }
                } else if line.contains("link/ether") {
                    // Parse MAC address
                    if let Some(ref mut iface) = current_iface {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 2 {
                            iface.mac = parts[1].to_string();
                        }
                    }
                }
            }
            
            // Don't forget the last interface
            if let Some(iface) = current_iface {
                if iface.name != "lo" {
                    self.interfaces.push(iface);
                }
            }
        }
        
        // Get IP addresses
        if let Ok(output) = Command::new("ip").args(["addr", "show"]).output() {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut current_name = String::new();
            
            for line in text.lines() {
                if line.starts_with(char::is_numeric) {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        current_name = parts[1].trim_end_matches(':').to_string();
                    }
                } else if line.contains("inet ") && !line.contains("inet6") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        let ip = parts[1].split('/').next().unwrap_or("").to_string();
                        for iface in &mut self.interfaces {
                            if iface.name == current_name {
                                iface.ip = Some(ip.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    fn run_ping(&mut self, target: &str) {
        self.diag_output.clear();
        self.diag_output.push(format!("Pinging {}...", target));
        self.diag_running = true;
        
        match Command::new("ping").args(["-c", "3", "-W", "2", target]).output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                
                for line in stdout.lines() {
                    self.diag_output.push(line.to_string());
                }
                for line in stderr.lines() {
                    self.diag_output.push(format!("ERR: {}", line));
                }
                
                if output.status.success() {
                    self.diag_output.push("".to_string());
                    self.diag_output.push("[OK] Ping successful".to_string());
                } else {
                    self.diag_output.push("".to_string());
                    self.diag_output.push("[FAIL] Ping failed".to_string());
                }
            }
            Err(e) => {
                self.diag_output.push(format!("[ERROR] {}", e));
            }
        }
        
        self.diag_running = false;
    }

    fn check_dns(&mut self) {
        self.diag_output.clear();
        self.diag_output.push("Checking DNS resolution...".to_string());
        
        match Command::new("nslookup").arg("google.com").output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines().take(6) {
                    self.diag_output.push(line.to_string());
                }
                
                if output.status.success() {
                    self.diag_output.push("".to_string());
                    self.diag_output.push("[OK] DNS working".to_string());
                } else {
                    self.diag_output.push("".to_string());
                    self.diag_output.push("[FAIL] DNS resolution failed".to_string());
                }
            }
            Err(_) => {
                // Try with host command instead
                match Command::new("host").arg("google.com").output() {
                    Ok(output) => {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        for line in stdout.lines().take(3) {
                            self.diag_output.push(line.to_string());
                        }
                        if output.status.success() {
                            self.diag_output.push("[OK] DNS working".to_string());
                        }
                    }
                    Err(e) => {
                        self.diag_output.push(format!("[ERROR] {}", e));
                    }
                }
            }
        }
    }

    fn restart_networking(&mut self) {
        self.diag_output.clear();
        self.diag_output.push("Restarting networking service...".to_string());
        
        let result = Command::new("rc-service")
            .args(["networking", "restart"])
            .output();
        
        match result {
            Ok(output) => {
                if output.status.success() {
                    self.diag_output.push("[OK] Networking restarted".to_string());
                } else {
                    self.diag_output.push("[FAIL] Failed to restart networking".to_string());
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    for line in stderr.lines() {
                        self.diag_output.push(line.to_string());
                    }
                }
            }
            Err(e) => {
                self.diag_output.push(format!("[ERROR] {}", e));
            }
        }
    }

    fn request_dhcp(&mut self, iface: &str) {
        self.diag_output.clear();
        self.diag_output.push(format!("Requesting DHCP on {}...", iface));
        
        // Release old lease
        let _ = Command::new("dhclient").args(["-r", iface]).output();
        
        // Request new lease
        match Command::new("dhclient").args(["-v", iface]).output() {
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                for line in stderr.lines().take(5) {
                    self.diag_output.push(line.to_string());
                }
                
                if output.status.success() {
                    self.diag_output.push("".to_string());
                    self.diag_output.push("[OK] DHCP lease obtained".to_string());
                } else {
                    // Try udhcpc (BusyBox)
                    match Command::new("udhcpc").args(["-i", iface, "-n", "-q"]).output() {
                        Ok(output2) => {
                            if output2.status.success() {
                                self.diag_output.push("[OK] DHCP lease obtained".to_string());
                            } else {
                                self.diag_output.push("[FAIL] DHCP failed".to_string());
                            }
                        }
                        Err(_) => {
                            self.diag_output.push("[FAIL] DHCP client not available".to_string());
                        }
                    }
                }
            }
            Err(_) => {
                // Try udhcpc as fallback
                match Command::new("udhcpc").args(["-i", iface, "-n", "-q"]).output() {
                    Ok(output) => {
                        if output.status.success() {
                            self.diag_output.push("[OK] DHCP lease obtained".to_string());
                        } else {
                            self.diag_output.push("[FAIL] DHCP failed".to_string());
                        }
                    }
                    Err(e) => {
                        self.diag_output.push(format!("[ERROR] {}", e));
                    }
                }
            }
        }
    }

    fn bring_interface_up(&mut self, iface: &str) {
        self.diag_output.clear();
        self.diag_output.push(format!("Bringing up {}...", iface));
        
        match Command::new("ip").args(["link", "set", iface, "up"]).output() {
            Ok(output) => {
                if output.status.success() {
                    self.diag_output.push("[OK] Interface is now UP".to_string());
                } else {
                    self.diag_output.push("[FAIL] Failed to bring up interface".to_string());
                }
            }
            Err(e) => {
                self.diag_output.push(format!("[ERROR] {}", e));
            }
        }
    }
}

// =============================================================================
// UI Rendering
// =============================================================================

fn ui(frame: &mut Frame, app: &mut App) {
    let size = frame.area();

    // Dark background
    let bg = Block::default().style(Style::default().bg(Color::Rgb(10, 15, 20)));
    frame.render_widget(bg, size);

    // Main layout with margins
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(0),
            Constraint::Length(1),
        ])
        .split(size);

    let inner = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Length(2),
            Constraint::Min(0),
            Constraint::Length(2),
        ])
        .split(outer[1]);

    match app.screen {
        Screen::Main => render_main_screen(frame, inner[1], app),
        Screen::NetworkMenu => render_network_menu(frame, inner[1], app),
        Screen::NetworkConfig => render_network_config(frame, inner[1], app),
        Screen::NetworkDiag => render_network_diag(frame, inner[1], app),
        Screen::ServiceMenu => render_service_menu(frame, inner[1], app),
        Screen::ShellConfirm => {
            render_main_screen(frame, inner[1], app);
            render_shell_dialog(frame, size);
        }
    }

    render_footer(frame, outer[2], app);
}

fn render_main_screen(frame: &mut Frame, area: Rect, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(5),   // Header
            Constraint::Length(9),   // Connection Info
            Constraint::Length(1),   // Spacer
            Constraint::Min(6),      // System Status
        ])
        .split(area);

    render_header(frame, chunks[0], app);
    render_connection_info(frame, chunks[1], app);
    render_system_status(frame, chunks[3], app);
}

fn render_header(frame: &mut Frame, area: Rect, app: &App) {
    let hostname = app.config.hostname.as_deref().unwrap_or("quantix");
    let status = if app.config.cluster_joined { "Clustered" } else { "Standalone" };

    let lines = vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("QUANTIX-OS ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
            Span::styled("v1.0.0", Style::default().fg(Color::DarkGray)),
            Span::styled("   |   ", Style::default().fg(Color::Rgb(40, 50, 60))),
            Span::styled(hostname, Style::default().fg(Color::White)),
            Span::styled("   |   ", Style::default().fg(Color::Rgb(40, 50, 60))),
            Span::styled(status, Style::default().fg(Color::Yellow)),
        ]),
        Line::from(""),
    ];

    let header = Paragraph::new(lines)
        .alignment(Alignment::Center)
        .block(Block::default().borders(Borders::BOTTOM).border_style(Style::default().fg(Color::Rgb(40, 50, 60))));

    frame.render_widget(header, area);
}

fn render_connection_info(frame: &mut Frame, area: Rect, app: &App) {
    let ip = system::get_management_ip().unwrap_or_else(|| "Not configured".to_string());
    let has_ip = ip != "Not configured";
    let url = if has_ip { format!("https://{}:8443", ip) } else { "Network not configured".to_string() };
    let url_color = if has_ip { Color::Cyan } else { Color::Red };

    let lines = vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("Management URL: ", Style::default().fg(Color::DarkGray)),
            Span::styled(&url, Style::default().fg(url_color).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("IP Address:     ", Style::default().fg(Color::DarkGray)),
            Span::styled(&ip, Style::default().fg(Color::White)),
        ]),
        Line::from(""),
        if !has_ip {
            Line::from(vec![
                Span::styled("Press ", Style::default().fg(Color::Yellow)),
                Span::styled("[F2]", Style::default().fg(Color::White).add_modifier(Modifier::BOLD)),
                Span::styled(" to configure network", Style::default().fg(Color::Yellow)),
            ])
        } else {
            Line::from("")
        },
    ];

    let panel = Paragraph::new(lines)
        .block(
            Block::default()
                .title(" Connection ")
                .title_style(Style::default().fg(Color::White))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Rgb(50, 60, 80))),
        );

    frame.render_widget(panel, area);
}

fn render_system_status(frame: &mut Frame, area: Rect, app: &App) {
    let cpu_usage = app.system.global_cpu_usage();
    let total_mem = app.system.total_memory();
    let used_mem = app.system.used_memory();
    let mem_percent = if total_mem > 0 { (used_mem as f64 / total_mem as f64) * 100.0 } else { 0.0 };
    let uptime = system::get_uptime();
    let vm_count = get_vm_count();

    let cpu_color = status_color(cpu_usage as f64, 70.0, 90.0);
    let mem_color = status_color(mem_percent, 70.0, 90.0);

    let lines = vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("  CPU:    ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{:>5.1}%  ", cpu_usage), Style::default().fg(cpu_color)),
            Span::styled(create_bar(cpu_usage as f64, 100.0, 20), Style::default().fg(cpu_color)),
        ]),
        Line::from(vec![
            Span::styled("  Memory: ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{:>5.1}%  ", mem_percent), Style::default().fg(mem_color)),
            Span::styled(create_bar(mem_percent, 100.0, 20), Style::default().fg(mem_color)),
            Span::styled(format!("  {} / {}", 
                humansize::format_size(used_mem, humansize::BINARY),
                humansize::format_size(total_mem, humansize::BINARY)
            ), Style::default().fg(Color::DarkGray)),
        ]),
        Line::from(vec![
            Span::styled("  VMs:    ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{} running", vm_count), Style::default().fg(Color::White)),
            Span::styled("     Uptime: ", Style::default().fg(Color::DarkGray)),
            Span::styled(uptime, Style::default().fg(Color::White)),
        ]),
    ];

    let panel = Paragraph::new(lines)
        .block(
            Block::default()
                .title(" System ")
                .title_style(Style::default().fg(Color::White))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Rgb(50, 60, 80))),
        );

    frame.render_widget(panel, area);
}

fn render_network_menu(frame: &mut Frame, area: Rect, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(10),
        ])
        .split(area);

    // Title
    let title = Paragraph::new(vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("Network Troubleshooting", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        ]),
    ])
    .alignment(Alignment::Center);
    frame.render_widget(title, chunks[0]);

    // Menu items
    let items: Vec<ListItem> = vec![
        ListItem::new(Line::from(vec![
            Span::styled("  [1]  ", Style::default().fg(Color::Yellow)),
            Span::styled("View Network Interfaces", Style::default().fg(Color::White)),
        ])),
        ListItem::new(Line::from(vec![
            Span::styled("  [2]  ", Style::default().fg(Color::Yellow)),
            Span::styled("Request DHCP Lease", Style::default().fg(Color::White)),
        ])),
        ListItem::new(Line::from(vec![
            Span::styled("  [3]  ", Style::default().fg(Color::Yellow)),
            Span::styled("Ping Gateway", Style::default().fg(Color::White)),
        ])),
        ListItem::new(Line::from(vec![
            Span::styled("  [4]  ", Style::default().fg(Color::Yellow)),
            Span::styled("Ping Internet (8.8.8.8)", Style::default().fg(Color::White)),
        ])),
        ListItem::new(Line::from(vec![
            Span::styled("  [5]  ", Style::default().fg(Color::Yellow)),
            Span::styled("Test DNS Resolution", Style::default().fg(Color::White)),
        ])),
        ListItem::new(Line::from(vec![
            Span::styled("  [6]  ", Style::default().fg(Color::Yellow)),
            Span::styled("Restart Networking Service", Style::default().fg(Color::White)),
        ])),
        ListItem::new(Line::from("")),
        ListItem::new(Line::from(vec![
            Span::styled("  [Esc]", Style::default().fg(Color::DarkGray)),
            Span::styled("  Back to main screen", Style::default().fg(Color::DarkGray)),
        ])),
    ];

    let menu = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Rgb(50, 60, 80))),
        )
        .highlight_style(Style::default().bg(Color::Rgb(40, 60, 80)))
        .highlight_symbol(" > ");

    frame.render_stateful_widget(menu, chunks[1], &mut app.menu_state);
}

fn render_network_config(frame: &mut Frame, area: Rect, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(8),
        ])
        .split(area);

    // Title
    let title = Paragraph::new(vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("Network Interfaces", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        ]),
    ])
    .alignment(Alignment::Center);
    frame.render_widget(title, chunks[0]);

    // Interface list
    let mut lines = vec![Line::from("")];
    
    if app.interfaces.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("  No network interfaces found", Style::default().fg(Color::Yellow)),
        ]));
    } else {
        for (i, iface) in app.interfaces.iter().enumerate() {
            let state_color = if iface.state == "UP" { Color::Green } else { Color::Red };
            let ip_str = iface.ip.clone().unwrap_or_else(|| "No IP".to_string());
            let ip_color = if iface.ip.is_some() { Color::Cyan } else { Color::DarkGray };
            
            let marker = if i == app.selected_interface { "> " } else { "  " };
            
            lines.push(Line::from(vec![
                Span::styled(marker, Style::default().fg(Color::Yellow)),
                Span::styled(format!("{:<12}", iface.name), Style::default().fg(Color::White).add_modifier(Modifier::BOLD)),
                Span::styled(format!("{:<6}", iface.state), Style::default().fg(state_color)),
                Span::styled(format!("{:<18}", ip_str), Style::default().fg(ip_color)),
                Span::styled(&iface.mac, Style::default().fg(Color::DarkGray)),
            ]));
        }
    }
    
    lines.push(Line::from(""));
    lines.push(Line::from(vec![
        Span::styled("  [D] Request DHCP   [U] Bring UP   [Esc] Back", Style::default().fg(Color::DarkGray)),
    ]));

    let panel = Paragraph::new(lines)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Rgb(50, 60, 80))),
        );

    frame.render_widget(panel, chunks[1]);
}

fn render_network_diag(frame: &mut Frame, area: Rect, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(8),
        ])
        .split(area);

    // Title
    let title = Paragraph::new(vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("Diagnostic Output", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        ]),
    ])
    .alignment(Alignment::Center);
    frame.render_widget(title, chunks[0]);

    // Output
    let lines: Vec<Line> = app.diag_output.iter().map(|s| {
        let color = if s.starts_with("[OK]") {
            Color::Green
        } else if s.starts_with("[FAIL]") || s.starts_with("[ERROR]") || s.starts_with("ERR:") {
            Color::Red
        } else {
            Color::White
        };
        Line::from(vec![Span::styled(format!("  {}", s), Style::default().fg(color))])
    }).collect();

    let panel = Paragraph::new(lines)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Rgb(50, 60, 80))),
        );

    frame.render_widget(panel, chunks[1]);
}

fn render_service_menu(frame: &mut Frame, area: Rect, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(10),
        ])
        .split(area);

    let title = Paragraph::new(vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("Service Management", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        ]),
    ])
    .alignment(Alignment::Center);
    frame.render_widget(title, chunks[0]);

    let items: Vec<ListItem> = vec![
        ListItem::new(Line::from(vec![
            Span::styled("  [1]  ", Style::default().fg(Color::Yellow)),
            Span::styled("Restart Networking", Style::default().fg(Color::White)),
        ])),
        ListItem::new(Line::from(vec![
            Span::styled("  [2]  ", Style::default().fg(Color::Yellow)),
            Span::styled("Restart Quantix Node Daemon", Style::default().fg(Color::White)),
        ])),
        ListItem::new(Line::from(vec![
            Span::styled("  [3]  ", Style::default().fg(Color::Yellow)),
            Span::styled("Restart Libvirt", Style::default().fg(Color::White)),
        ])),
        ListItem::new(Line::from(vec![
            Span::styled("  [4]  ", Style::default().fg(Color::Yellow)),
            Span::styled("Restart Open vSwitch", Style::default().fg(Color::White)),
        ])),
        ListItem::new(Line::from("")),
        ListItem::new(Line::from(vec![
            Span::styled("  [Esc]", Style::default().fg(Color::DarkGray)),
            Span::styled("  Back", Style::default().fg(Color::DarkGray)),
        ])),
    ];

    let menu = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Rgb(50, 60, 80))),
        )
        .highlight_style(Style::default().bg(Color::Rgb(40, 60, 80)))
        .highlight_symbol(" > ");

    frame.render_stateful_widget(menu, chunks[1], &mut app.menu_state);
}

fn render_footer(frame: &mut Frame, area: Rect, app: &App) {
    let text = match app.screen {
        Screen::Main => "[F2] Network  [F5] Services  [F12] Shell  [F10] Reboot",
        Screen::NetworkMenu | Screen::NetworkConfig | Screen::NetworkDiag => "[Esc] Back  [1-6] Select option",
        Screen::ServiceMenu => "[Esc] Back  [1-4] Restart service",
        Screen::ShellConfirm => "[Y] Confirm  [N] Cancel",
    };

    let footer = Paragraph::new(text)
        .style(Style::default().fg(Color::DarkGray))
        .alignment(Alignment::Center);

    frame.render_widget(footer, area);
}

fn render_shell_dialog(frame: &mut Frame, area: Rect) {
    let dialog_width = 50;
    let dialog_height = 8;
    let x = (area.width.saturating_sub(dialog_width)) / 2;
    let y = (area.height.saturating_sub(dialog_height)) / 2;
    let dialog_area = Rect::new(x, y, dialog_width, dialog_height);

    frame.render_widget(Clear, dialog_area);

    let lines = vec![
        Line::from(""),
        Line::from(vec![Span::styled("  WARNING: Emergency Shell  ", Style::default().fg(Color::Red).add_modifier(Modifier::BOLD))]),
        Line::from(""),
        Line::from("  This bypasses normal security."),
        Line::from("  All activity is logged."),
        Line::from(""),
        Line::from(vec![
            Span::styled("  [Y] Confirm  ", Style::default().fg(Color::Green)),
            Span::styled("  [N] Cancel", Style::default().fg(Color::Red)),
        ]),
    ];

    let dialog = Paragraph::new(lines)
        .alignment(Alignment::Center)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Red))
                .style(Style::default().bg(Color::Rgb(40, 20, 20))),
        );

    frame.render_widget(dialog, dialog_area);
}

// =============================================================================
// Helpers
// =============================================================================

fn status_color(value: f64, warn: f64, error: f64) -> Color {
    if value >= error { Color::Red } else if value >= warn { Color::Yellow } else { Color::Green }
}

fn create_bar(value: f64, max: f64, width: usize) -> String {
    let filled = ((value / max) * width as f64) as usize;
    let empty = width.saturating_sub(filled);
    format!("[{}{}]", "█".repeat(filled), "░".repeat(empty))
}

fn get_vm_count() -> usize {
    Command::new("virsh")
        .args(["list", "--state-running"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().filter(|l| l.trim().starts_with(char::is_numeric)).count())
        .unwrap_or(0)
}

fn get_default_gateway() -> Option<String> {
    Command::new("ip")
        .args(["route", "show", "default"])
        .output()
        .ok()
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .split_whitespace()
                .nth(2)
                .map(|s| s.to_string())
        })
}

fn restart_service(name: &str) -> String {
    match Command::new("rc-service").args([name, "restart"]).output() {
        Ok(o) if o.status.success() => format!("[OK] {} restarted", name),
        Ok(_) => format!("[FAIL] Failed to restart {}", name),
        Err(e) => format!("[ERROR] {}", e),
    }
}

// =============================================================================
// Main
// =============================================================================

fn main() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new()?;

    loop {
        app.refresh();
        terminal.draw(|f| ui(f, &mut app))?;

        if event::poll(Duration::from_millis(500))? {
            if let Event::Key(key) = event::read()? {
                match app.screen {
                    Screen::Main => match key.code {
                        KeyCode::F(2) => {
                            app.screen = Screen::NetworkMenu;
                            app.menu_state.select(Some(0));
                        }
                        KeyCode::F(5) => {
                            app.screen = Screen::ServiceMenu;
                            app.menu_state.select(Some(0));
                        }
                        KeyCode::F(12) => app.screen = Screen::ShellConfirm,
                        KeyCode::F(10) => {
                            let _ = Command::new("reboot").spawn();
                        }
                        KeyCode::Char('q') => app.should_exit = true,
                        _ => {}
                    },
                    Screen::NetworkMenu => match key.code {
                        KeyCode::Esc => app.screen = Screen::Main,
                        KeyCode::Char('1') => {
                            app.load_interfaces();
                            app.screen = Screen::NetworkConfig;
                        }
                        KeyCode::Char('2') => {
                            app.load_interfaces();
                            if let Some(iface) = app.interfaces.first() {
                                let name = iface.name.clone();
                                app.request_dhcp(&name);
                            }
                            app.screen = Screen::NetworkDiag;
                        }
                        KeyCode::Char('3') => {
                            if let Some(gw) = get_default_gateway() {
                                app.run_ping(&gw);
                            } else {
                                app.diag_output = vec!["[ERROR] No default gateway found".to_string()];
                            }
                            app.screen = Screen::NetworkDiag;
                        }
                        KeyCode::Char('4') => {
                            app.run_ping("8.8.8.8");
                            app.screen = Screen::NetworkDiag;
                        }
                        KeyCode::Char('5') => {
                            app.check_dns();
                            app.screen = Screen::NetworkDiag;
                        }
                        KeyCode::Char('6') => {
                            app.restart_networking();
                            app.screen = Screen::NetworkDiag;
                        }
                        KeyCode::Up => {
                            let i = app.menu_state.selected().unwrap_or(0);
                            app.menu_state.select(Some(i.saturating_sub(1)));
                        }
                        KeyCode::Down => {
                            let i = app.menu_state.selected().unwrap_or(0);
                            app.menu_state.select(Some((i + 1).min(5)));
                        }
                        _ => {}
                    },
                    Screen::NetworkConfig => match key.code {
                        KeyCode::Esc => app.screen = Screen::NetworkMenu,
                        KeyCode::Up => {
                            app.selected_interface = app.selected_interface.saturating_sub(1);
                        }
                        KeyCode::Down => {
                            if !app.interfaces.is_empty() {
                                app.selected_interface = (app.selected_interface + 1).min(app.interfaces.len() - 1);
                            }
                        }
                        KeyCode::Char('d') | KeyCode::Char('D') => {
                            if let Some(iface) = app.interfaces.get(app.selected_interface) {
                                let name = iface.name.clone();
                                app.request_dhcp(&name);
                                app.screen = Screen::NetworkDiag;
                            }
                        }
                        KeyCode::Char('u') | KeyCode::Char('U') => {
                            if let Some(iface) = app.interfaces.get(app.selected_interface) {
                                let name = iface.name.clone();
                                app.bring_interface_up(&name);
                                app.screen = Screen::NetworkDiag;
                            }
                        }
                        _ => {}
                    },
                    Screen::NetworkDiag => match key.code {
                        KeyCode::Esc | KeyCode::Enter => app.screen = Screen::NetworkMenu,
                        _ => {}
                    },
                    Screen::ServiceMenu => match key.code {
                        KeyCode::Esc => app.screen = Screen::Main,
                        KeyCode::Char('1') => {
                            app.diag_output = vec![restart_service("networking")];
                            app.screen = Screen::NetworkDiag;
                        }
                        KeyCode::Char('2') => {
                            app.diag_output = vec![restart_service("quantix-node")];
                            app.screen = Screen::NetworkDiag;
                        }
                        KeyCode::Char('3') => {
                            app.diag_output = vec![restart_service("libvirtd")];
                            app.screen = Screen::NetworkDiag;
                        }
                        KeyCode::Char('4') => {
                            app.diag_output = vec![
                                restart_service("ovsdb-server"),
                                restart_service("ovs-vswitchd"),
                            ];
                            app.screen = Screen::NetworkDiag;
                        }
                        _ => {}
                    },
                    Screen::ShellConfirm => match key.code {
                        KeyCode::Char('y') | KeyCode::Char('Y') => app.should_exit = true,
                        KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => app.screen = Screen::Main,
                        _ => {}
                    },
                }
            }
        }

        if app.should_exit {
            break;
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    Ok(())
}
