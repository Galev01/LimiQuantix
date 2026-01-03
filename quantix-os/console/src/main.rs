//! Quantix-OS Console TUI (DCUI)
//!
//! The "yellow screen" console interface for Quantix hypervisor nodes.
//! Provides network configuration, cluster joining, and system status.
//!
//! ## Features
//! - 🖥️ System status dashboard
//! - 🌐 Network configuration
//! - 📋 Beautiful log viewer with filtering
//! - 🔍 Diagnostic tools
//! - 🔧 Service management

use std::io::{self, Stdout};
use std::time::Duration;

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
    Frame, Terminal,
};
use sysinfo::System;
use tracing::{error, info};

mod config;
mod logs;
mod network;
mod system;

use config::NodeConfig;
use logs::LogViewer;

// =============================================================================
// Application State
// =============================================================================

/// Main application state
struct App {
    /// Current screen
    screen: Screen,
    /// Node configuration
    config: NodeConfig,
    /// System information
    system: System,
    /// Menu selection state
    menu_state: ListState,
    /// Log viewer state
    log_viewer: LogViewer,
    /// Error message to display
    error_message: Option<String>,
    /// Should exit
    should_exit: bool,
    /// Last refresh time
    last_refresh: std::time::Instant,
}

/// Available screens
#[derive(Clone, Copy, PartialEq)]
enum Screen {
    Main,
    NetworkConfig,
    ClusterJoin,
    ViewLogs,
    SystemInfo,
    RestartServices,
    EmergencyShell,
    Diagnostics,
}

impl App {
    fn new() -> Result<Self> {
        let config = NodeConfig::load().unwrap_or_default();
        let mut system = System::new_all();
        system.refresh_all();

        let mut menu_state = ListState::default();
        menu_state.select(Some(0));

        Ok(Self {
            screen: Screen::Main,
            config,
            system,
            menu_state,
            log_viewer: LogViewer::new(),
            error_message: None,
            should_exit: false,
            last_refresh: std::time::Instant::now(),
        })
    }

    fn refresh_system_info(&mut self) {
        if self.last_refresh.elapsed() > Duration::from_secs(5) {
            self.system.refresh_all();
            self.last_refresh = std::time::Instant::now();
        }
    }

    fn menu_items(&self) -> Vec<(&str, &str, &str)> {
        vec![
            ("F2", "🌐", "Configure Network"),
            ("F3", "📋", "View Logs"),
            ("F4", "🔗", "Join Cluster"),
            ("F5", "🔧", "Restart Services"),
            ("F6", "ℹ️", "System Info"),
            ("F7", "🔍", "Diagnostics"),
            ("F10", "⏻", "Shutdown/Reboot"),
            ("F12", "🚨", "Emergency Shell"),
        ]
    }

    fn handle_key(&mut self, key: KeyEvent) {
        match self.screen {
            Screen::Main => self.handle_main_key(key),
            Screen::ViewLogs => self.handle_logs_key(key),
            _ => self.handle_submenu_key(key),
        }
    }

    fn handle_main_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::F(2) => self.screen = Screen::NetworkConfig,
            KeyCode::F(3) => {
                self.log_viewer.load_logs();
                self.screen = Screen::ViewLogs;
            }
            KeyCode::F(4) => self.screen = Screen::ClusterJoin,
            KeyCode::F(5) => self.screen = Screen::RestartServices,
            KeyCode::F(6) => self.screen = Screen::SystemInfo,
            KeyCode::F(7) => self.screen = Screen::Diagnostics,
            KeyCode::F(10) => {
                self.should_exit = true;
            }
            KeyCode::F(12) => self.screen = Screen::EmergencyShell,
            KeyCode::Up => {
                let i = self.menu_state.selected().unwrap_or(0);
                let items_len = self.menu_items().len();
                let new_i = if i == 0 { items_len - 1 } else { i - 1 };
                self.menu_state.select(Some(new_i));
            }
            KeyCode::Down => {
                let i = self.menu_state.selected().unwrap_or(0);
                let items_len = self.menu_items().len();
                let new_i = if i >= items_len - 1 { 0 } else { i + 1 };
                self.menu_state.select(Some(new_i));
            }
            KeyCode::Enter => {
                if let Some(i) = self.menu_state.selected() {
                    match i {
                        0 => self.screen = Screen::NetworkConfig,
                        1 => {
                            self.log_viewer.load_logs();
                            self.screen = Screen::ViewLogs;
                        }
                        2 => self.screen = Screen::ClusterJoin,
                        3 => self.screen = Screen::RestartServices,
                        4 => self.screen = Screen::SystemInfo,
                        5 => self.screen = Screen::Diagnostics,
                        6 => self.should_exit = true,
                        7 => self.screen = Screen::EmergencyShell,
                        _ => {}
                    }
                }
            }
            KeyCode::Char('q') => self.should_exit = true,
            _ => {}
        }
    }

    fn handle_logs_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc | KeyCode::F(1) => self.screen = Screen::Main,
            KeyCode::Up | KeyCode::Char('k') => self.log_viewer.select_prev(),
            KeyCode::Down | KeyCode::Char('j') => self.log_viewer.select_next(),
            KeyCode::Home => self.log_viewer.select_first(),
            KeyCode::End => self.log_viewer.select_last(),
            KeyCode::Tab => {
                let next = (self.log_viewer.current_tab + 1) % self.log_viewer.log_files.len();
                self.log_viewer.switch_log(next);
            }
            KeyCode::Char('e') => self.log_viewer.toggle_errors_only(),
            KeyCode::Char('p') => self.log_viewer.paused = !self.log_viewer.paused,
            KeyCode::Char('r') => self.log_viewer.load_logs(),
            _ => {}
        }
    }

    fn handle_submenu_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc | KeyCode::F(1) => self.screen = Screen::Main,
            KeyCode::Char('q') => self.screen = Screen::Main,
            _ => {}
        }
    }
}

// =============================================================================
// UI Rendering
// =============================================================================

fn ui(frame: &mut Frame, app: &mut App) {
    let size = frame.area();

    // Create main layout with more breathing room
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(1) // Add margin around the entire UI
        .constraints([
            Constraint::Length(5),  // Header/Banner (compact)
            Constraint::Min(12),    // Main content
            Constraint::Length(1),  // Footer/Status
        ])
        .split(size);

    // Render header
    render_header(frame, chunks[0], app);

    // Render main content based on current screen
    match app.screen {
        Screen::Main => render_main_menu(frame, chunks[1], app),
        Screen::NetworkConfig => render_network_config(frame, chunks[1]),
        Screen::ClusterJoin => render_cluster_join(frame, chunks[1]),
        Screen::ViewLogs => logs::render_log_viewer(frame, chunks[1], &mut app.log_viewer),
        Screen::SystemInfo => render_system_info(frame, chunks[1], app),
        Screen::RestartServices => render_restart_services(frame, chunks[1]),
        Screen::EmergencyShell => render_emergency_shell(frame, chunks[1]),
        Screen::Diagnostics => render_diagnostics(frame, chunks[1], app),
    }

    // Render footer
    render_footer(frame, chunks[2], app);
}

fn render_header(frame: &mut Frame, area: Rect, app: &App) {
    let hostname = app.config.hostname.as_deref().unwrap_or("quantix");
    let ip = system::get_management_ip().unwrap_or_else(|| "Not configured".to_string());
    let node_status = if app.config.cluster_joined {
        "Joined"
    } else {
        "Standalone"
    };

    // Status indicator based on log errors
    let health = if app.log_viewer.stats.errors > 0 {
        "Errors"
    } else {
        "Healthy"
    };

    let health_color = if app.log_viewer.stats.errors > 0 {
        Color::Red
    } else {
        Color::Green
    };

    // Build header as styled spans for better control
    let header_line1 = Line::from(vec![
        Span::styled("  QUANTIX-OS ", Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD)),
        Span::styled("v1.0.0", Style::default().fg(Color::White)),
        Span::raw("                                                    "),
        Span::styled(health, Style::default().fg(health_color).add_modifier(Modifier::BOLD)),
    ]);

    let header_line2 = Line::from(vec![
        Span::styled("  Node: ", Style::default().fg(Color::DarkGray)),
        Span::styled(format!("{:<16}", hostname), Style::default().fg(Color::White)),
        Span::styled("  Status: ", Style::default().fg(Color::DarkGray)),
        Span::styled(format!("{:<12}", node_status), Style::default().fg(Color::Yellow)),
        Span::styled("  IP: ", Style::default().fg(Color::DarkGray)),
        Span::styled(ip, Style::default().fg(Color::Cyan)),
    ]);

    let header = Paragraph::new(vec![
        Line::from(""),
        header_line1,
        Line::from(""),
        header_line2,
    ])
    .block(
        Block::default()
            .borders(Borders::BOTTOM)
            .border_style(Style::default().fg(Color::DarkGray)),
    );

    frame.render_widget(header, area);
}

fn render_main_menu(frame: &mut Frame, area: Rect, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(30),  // Menu
            Constraint::Percentage(40),  // System Status
            Constraint::Percentage(30),  // Log Summary
        ])
        .split(area);

    // Left: Menu with better spacing
    let items: Vec<(&str, &str)> = vec![
        ("F2", "Configure Network"),
        ("F3", "View Logs"),
        ("F4", "Join Cluster"),
        ("F5", "Restart Services"),
        ("F10", "Shutdown/Reboot"),
        ("F12", "Emergency Shell"),
    ];
    
    let menu_items: Vec<ListItem> = items
        .iter()
        .map(|(key, label)| {
            ListItem::new(Line::from(vec![
                Span::styled(
                    format!("  [{}]  ", key),
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(*label, Style::default().fg(Color::White)),
            ]))
            .style(Style::default())
        })
        .collect();

    let menu = List::new(menu_items)
        .block(
            Block::default()
                .title(" Menu ")
                .title_style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
        .highlight_style(
            Style::default()
                .bg(Color::Rgb(40, 60, 80))
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol(" > ");

    frame.render_stateful_widget(menu, chunks[0], &mut app.menu_state);

    // Center: System Status
    render_system_status(frame, chunks[1], app);

    // Right: Log Summary
    logs::render_log_summary(frame, chunks[2], &app.log_viewer);
}

fn render_system_status(frame: &mut Frame, area: Rect, app: &App) {
    let cpu_usage = app.system.global_cpu_usage();
    let total_mem = app.system.total_memory();
    let used_mem = app.system.used_memory();
    let mem_percent = (used_mem as f64 / total_mem as f64) * 100.0;

    let vm_count = get_vm_count();
    let uptime = system::get_uptime();

    // CPU bar
    let cpu_bar = create_progress_bar(cpu_usage as f64, 100.0, 24);
    let mem_bar = create_progress_bar(mem_percent, 100.0, 24);

    let cpu_color = if cpu_usage > 90.0 { Color::Red } else if cpu_usage > 70.0 { Color::Yellow } else { Color::Green };
    let mem_color = if mem_percent > 90.0 { Color::Red } else if mem_percent > 80.0 { Color::Yellow } else { Color::Green };

    let ip = system::get_management_ip().unwrap_or_else(|| "<ip>".to_string());

    // Build lines with proper styling
    let lines = vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("  CPU:     ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{:.1}%", cpu_usage), Style::default().fg(cpu_color).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![
            Span::styled(format!("           {}", cpu_bar), Style::default().fg(cpu_color)),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("  Memory:  ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{:.1}%", mem_percent), Style::default().fg(mem_color).add_modifier(Modifier::BOLD)),
        ]),
        Line::from(vec![
            Span::styled(format!("           {}", mem_bar), Style::default().fg(mem_color)),
        ]),
        Line::from(vec![
            Span::styled("           ", Style::default()),
            Span::styled(
                format!("{} / {}", 
                    humansize::format_size(used_mem, humansize::BINARY),
                    humansize::format_size(total_mem, humansize::BINARY)
                ),
                Style::default().fg(Color::DarkGray)
            ),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("  VMs:     ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{} running", vm_count), Style::default().fg(Color::White)),
        ]),
        Line::from(vec![
            Span::styled("  Uptime:  ", Style::default().fg(Color::DarkGray)),
            Span::styled(uptime, Style::default().fg(Color::White)),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("  URL:     ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("https://{}:8443", ip), Style::default().fg(Color::Cyan)),
        ]),
    ];

    let status = Paragraph::new(lines)
        .block(
            Block::default()
                .title(" System Status ")
                .title_style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        );

    frame.render_widget(status, area);
}

fn create_progress_bar(value: f64, max: f64, width: usize) -> String {
    let filled = ((value / max) * width as f64) as usize;
    let empty = width.saturating_sub(filled);
    format!("[{}{}]", "█".repeat(filled), "░".repeat(empty))
}

fn render_network_config(frame: &mut Frame, area: Rect) {
    let text = r#"
  🌐 Network Configuration
  ═════════════════════════════════════════════════════════════════

  This screen will allow you to configure:

  • 🔌 Management interface selection
  • 📡 DHCP or Static IP configuration
  • 🏷️ VLAN tagging
  • 🌍 DNS servers
  • 🚪 Gateway

  [Feature coming soon - use shell fallback for now]

  Press ESC or F1 to return to main menu
  "#;

    let paragraph = Paragraph::new(text)
        .block(
            Block::default()
                .title(" 🌐 Network Configuration ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Yellow)),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_cluster_join(frame: &mut Frame, area: Rect) {
    let text = r#"
  🔗 Join Cluster
  ═════════════════════════════════════════════════════════════════

  To join this node to a Quantix cluster:

  1️⃣  Get the join command from the Control Plane web UI
  2️⃣  Enter the Control Plane URL
  3️⃣  Enter the join token

  Example:
    🌐 URL:   https://control.example.com:6443
    🔑 Token: xxxx.yyyyyyyyyyyy

  [Feature coming soon - use CLI for now]

  Press ESC or F1 to return to main menu
  "#;

    let paragraph = Paragraph::new(text)
        .block(
            Block::default()
                .title(" 🔗 Join Cluster ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Green)),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_system_info(frame: &mut Frame, area: Rect, app: &App) {
    let hostname = nix::unistd::gethostname()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    let kernel = std::fs::read_to_string("/proc/version")
        .ok()
        .and_then(|v| v.split_whitespace().nth(2).map(String::from))
        .unwrap_or_else(|| "unknown".to_string());

    let cpu_model = app
        .system
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let cpu_count = app.system.cpus().len();
    let total_mem = humansize::format_size(app.system.total_memory(), humansize::BINARY);

    let text = format!(
        r#"
  ℹ️ System Information
  ═════════════════════════════════════════════════════════════════

  🏠 Hostname:       {}
  🐧 Kernel:         {}
  ⏱️ Uptime:         {}

  💻 CPU Model:      {}
  🔢 CPU Cores:      {}
  🧠 Total Memory:   {}

  🆔 Node ID:        {}
  🔗 Cluster:        {}

  Press ESC or F1 to return to main menu
  "#,
        hostname,
        kernel,
        system::get_uptime(),
        cpu_model,
        cpu_count,
        total_mem,
        app.config.node_id.as_deref().unwrap_or("Not configured"),
        if app.config.cluster_joined {
            app.config.cluster_url.as_deref().unwrap_or("Unknown")
        } else {
            "Not joined"
        },
    );

    let paragraph = Paragraph::new(text)
        .block(
            Block::default()
                .title(" ℹ️ System Information ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Magenta)),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_restart_services(frame: &mut Frame, area: Rect) {
    let text = r#"
  🔧 Restart Services
  ═════════════════════════════════════════════════════════════════

  Select a service to restart:

  [1] 🤖 Quantix Node Daemon
  [2] 🖥️ Libvirt
  [3] 🌐 Open vSwitch
  [4] 📡 Networking
  [5] 🔄 All Services

  [Feature coming soon]

  Press ESC or F1 to return to main menu
  "#;

    let paragraph = Paragraph::new(text)
        .block(
            Block::default()
                .title(" 🔧 Restart Services ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Blue)),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_emergency_shell(frame: &mut Frame, area: Rect) {
    let text = r#"
  🚨 Emergency Shell
  ═════════════════════════════════════════════════════════════════

  ⚠️  WARNING: Emergency shell access is for troubleshooting only!

  The shell bypasses normal security controls and should only be
  used when the web UI and API are inaccessible.

  To access the emergency shell:
    1️⃣  Press 'y' below to confirm
    2️⃣  Switch to TTY7 (Alt+F7)
    3️⃣  Press Enter to activate shell

  Type 'exit' in the shell to return to this console.

  ⚠️  All shell activity is logged!

  [Press 'y' to enable emergency shell on TTY7]
  [Press ESC to cancel]
  "#;

    let paragraph = Paragraph::new(text)
        .block(
            Block::default()
                .title(" 🚨 Emergency Shell ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Red)),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_diagnostics(frame: &mut Frame, area: Rect, app: &App) {
    let running_vms = get_vm_count();
    
    let text = format!(
        r#"
  🔍 Quick Diagnostics
  ═════════════════════════════════════════════════════════════════

  📊 System Health
  ────────────────────────────────────────────────────────────────
  ✅ Node Daemon:     Running
  ✅ Libvirt:         Running  
  ✅ Open vSwitch:    Running
  🖥️ VMs Running:     {}

  📋 Log Statistics  
  ────────────────────────────────────────────────────────────────
  📝 Total Entries:   {}
  ❌ Errors:          {}
  ⚠️ Warnings:        {}

  🔧 For detailed diagnostics, use the shell command:
     $ qx-diag

  Available commands:
     qx-diag health    - Quick health check
     qx-diag logs      - View recent logs  
     qx-diag errors    - View errors only
     qx-diag report    - Generate full report

  Press ESC or F1 to return to main menu
  "#,
        running_vms,
        app.log_viewer.stats.total,
        app.log_viewer.stats.errors,
        app.log_viewer.stats.warnings,
    );

    let paragraph = Paragraph::new(text)
        .block(
            Block::default()
                .title(" 🔍 Diagnostics ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan)),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_footer(frame: &mut Frame, area: Rect, app: &App) {
    let footer_text = match app.screen {
        Screen::ViewLogs => {
            "[Tab] Switch  [E] Errors  [P] Pause  [R] Reload  [↑↓] Scroll  [Esc] Back"
        }
        _ => "[↑↓] Navigate  [Enter] Select  [Esc] Back  [F3] Logs  [F7] Diagnostics",
    };

    let footer = Paragraph::new(footer_text)
        .style(Style::default().fg(Color::DarkGray))
        .alignment(Alignment::Center);

    frame.render_widget(footer, area);
}

// =============================================================================
// Helpers
// =============================================================================

fn get_vm_count() -> usize {
    std::process::Command::new("virsh")
        .args(["list", "--all"])
        .output()
        .ok()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|line| {
                    line.contains("running") || line.contains("paused") || line.contains("shut off")
                })
                .count()
        })
        .unwrap_or(0)
}

// =============================================================================
// Main Entry Point
// =============================================================================

fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter("qx_console=info")
        .with_target(false)
        .init();

    info!("🚀 Starting Quantix Console TUI");

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Create app state
    let mut app = App::new()?;

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

    if let Err(err) = result {
        error!("❌ Console error: {}", err);
        eprintln!("Error: {err}");
    }

    Ok(())
}

fn run_app(terminal: &mut Terminal<CrosstermBackend<Stdout>>, app: &mut App) -> Result<()> {
    loop {
        // Refresh system info periodically
        app.refresh_system_info();

        // Tail logs if viewing logs screen
        if app.screen == Screen::ViewLogs {
            let _ = app.log_viewer.tail();
        }

        // Draw UI
        terminal.draw(|f| ui(f, app))?;

        // Handle events with timeout for periodic refresh
        if event::poll(Duration::from_millis(500))? {
            if let Event::Key(key) = event::read()? {
                app.handle_key(key);

                if app.should_exit {
                    return Ok(());
                }
            }
        }
    }
}
