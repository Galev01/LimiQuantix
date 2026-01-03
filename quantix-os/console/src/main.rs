//! Quantix-OS Console TUI (DCUI)
//!
//! The "yellow screen" console interface for Quantix hypervisor nodes.
//! Provides network configuration, cluster joining, and system status.

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
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph, Wrap},
    Frame, Terminal,
};
use sysinfo::System;
use tracing::{error, info};

mod config;
mod network;
mod system;

use config::NodeConfig;

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

    fn menu_items(&self) -> Vec<(&str, &str)> {
        vec![
            ("F2", "Configure Network"),
            ("F3", "View Logs"),
            ("F4", "Join Cluster"),
            ("F5", "Restart Services"),
            ("F6", "System Info"),
            ("F10", "Shutdown/Reboot"),
            ("F12", "Emergency Shell"),
        ]
    }

    fn handle_key(&mut self, key: KeyEvent) {
        match self.screen {
            Screen::Main => self.handle_main_key(key),
            _ => self.handle_submenu_key(key),
        }
    }

    fn handle_main_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::F(2) => self.screen = Screen::NetworkConfig,
            KeyCode::F(3) => self.screen = Screen::ViewLogs,
            KeyCode::F(4) => self.screen = Screen::ClusterJoin,
            KeyCode::F(5) => self.screen = Screen::RestartServices,
            KeyCode::F(6) => self.screen = Screen::SystemInfo,
            KeyCode::F(10) => {
                // Show shutdown menu
                self.should_exit = true; // For now, just exit
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
                        1 => self.screen = Screen::ViewLogs,
                        2 => self.screen = Screen::ClusterJoin,
                        3 => self.screen = Screen::RestartServices,
                        4 => self.screen = Screen::SystemInfo,
                        5 => self.should_exit = true,
                        6 => self.screen = Screen::EmergencyShell,
                        _ => {}
                    }
                }
            }
            KeyCode::Char('q') => self.should_exit = true,
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

    // Create main layout
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(8),  // Header/Banner
            Constraint::Min(10),    // Main content
            Constraint::Length(3),  // Footer/Status
        ])
        .split(size);

    // Render header
    render_header(frame, chunks[0], app);

    // Render main content based on current screen
    match app.screen {
        Screen::Main => render_main_menu(frame, chunks[1], app),
        Screen::NetworkConfig => render_network_config(frame, chunks[1], app),
        Screen::ClusterJoin => render_cluster_join(frame, chunks[1], app),
        Screen::ViewLogs => render_view_logs(frame, chunks[1], app),
        Screen::SystemInfo => render_system_info(frame, chunks[1], app),
        Screen::RestartServices => render_restart_services(frame, chunks[1], app),
        Screen::EmergencyShell => render_emergency_shell(frame, chunks[1], app),
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

    let header_text = format!(
        r#"
╔═══════════════════════════════════════════════════════════════════════════════╗
║                          QUANTIX-OS v1.0.0                                    ║
║                         The VMware Killer                                     ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Node: {:<20}  Status: {:<15}  IP: {:<15}  ║
╚═══════════════════════════════════════════════════════════════════════════════╝"#,
        hostname, node_status, ip
    );

    let header = Paragraph::new(header_text)
        .style(Style::default().fg(Color::Cyan))
        .alignment(Alignment::Left);

    frame.render_widget(header, area);
}

fn render_main_menu(frame: &mut Frame, area: Rect, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
        .split(area);

    // Left side: Menu
    let menu_items: Vec<ListItem> = app
        .menu_items()
        .iter()
        .map(|(key, label)| {
            ListItem::new(Line::from(vec![
                Span::styled(
                    format!(" [{key}] "),
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(*label),
            ]))
        })
        .collect();

    let menu = List::new(menu_items)
        .block(
            Block::default()
                .title(" Menu ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan)),
        )
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▶ ");

    frame.render_stateful_widget(menu, chunks[0], &mut app.menu_state);

    // Right side: System Status
    render_system_status(frame, chunks[1], app);
}

fn render_system_status(frame: &mut Frame, area: Rect, app: &App) {
    app.system.refresh_all();

    let cpu_usage = app.system.global_cpu_usage();
    let total_mem = app.system.total_memory();
    let used_mem = app.system.used_memory();
    let mem_percent = (used_mem as f64 / total_mem as f64) * 100.0;

    let vm_count = get_vm_count();
    let uptime = system::get_uptime();

    let status_text = format!(
        r#"
  System Status
  ─────────────────────────────────────
  
  CPU Usage:     {:.1}%
  Memory:        {:.1}% ({} / {})
  
  VMs Running:   {}
  Uptime:        {}
  
  ─────────────────────────────────────
  
  Management URL:
  https://{}:8443
  
  "#,
        cpu_usage,
        mem_percent,
        humansize::format_size(used_mem, humansize::BINARY),
        humansize::format_size(total_mem, humansize::BINARY),
        vm_count,
        uptime,
        system::get_management_ip().unwrap_or_else(|| "<ip>".to_string()),
    );

    let status = Paragraph::new(status_text)
        .block(
            Block::default()
                .title(" System Status ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan)),
        )
        .style(Style::default().fg(Color::White));

    frame.render_widget(status, area);
}

fn render_network_config(frame: &mut Frame, area: Rect, _app: &App) {
    let text = r#"
  Network Configuration
  ═════════════════════════════════════════════════════════════════

  This screen will allow you to configure:

  • Management interface selection
  • DHCP or Static IP configuration
  • VLAN tagging
  • DNS servers
  • Gateway

  [Feature coming soon - use shell fallback for now]

  Press ESC or F1 to return to main menu
  "#;

    let paragraph = Paragraph::new(text)
        .block(
            Block::default()
                .title(" Network Configuration ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Yellow)),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_cluster_join(frame: &mut Frame, area: Rect, _app: &App) {
    let text = r#"
  Join Cluster
  ═════════════════════════════════════════════════════════════════

  To join this node to a Quantix cluster:

  1. Get the join command from the Control Plane web UI
  2. Enter the Control Plane URL
  3. Enter the join token

  Example:
    URL:   https://control.example.com:6443
    Token: xxxx.yyyyyyyyyyyy

  [Feature coming soon - use CLI for now]

  Press ESC or F1 to return to main menu
  "#;

    let paragraph = Paragraph::new(text)
        .block(
            Block::default()
                .title(" Join Cluster ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Green)),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_view_logs(frame: &mut Frame, area: Rect, _app: &App) {
    // Read last 20 lines of log
    let log_content = std::fs::read_to_string("/var/log/quantix-node.log")
        .unwrap_or_else(|_| "No logs available".to_string());

    let lines: Vec<&str> = log_content.lines().rev().take(20).collect();
    let display_text = lines.into_iter().rev().collect::<Vec<_>>().join("\n");

    let paragraph = Paragraph::new(display_text)
        .block(
            Block::default()
                .title(" Node Daemon Logs (last 20 lines) ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Blue)),
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
  System Information
  ═════════════════════════════════════════════════════════════════

  Hostname:       {}
  Kernel:         {}
  Uptime:         {}

  CPU Model:      {}
  CPU Cores:      {}
  Total Memory:   {}

  Node ID:        {}
  Cluster:        {}

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
                .title(" System Information ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Magenta)),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_restart_services(frame: &mut Frame, area: Rect, _app: &App) {
    let text = r#"
  Restart Services
  ═════════════════════════════════════════════════════════════════

  Select a service to restart:

  [1] Quantix Node Daemon
  [2] Libvirt
  [3] Open vSwitch
  [4] Networking
  [5] All Services

  [Feature coming soon]

  Press ESC or F1 to return to main menu
  "#;

    let paragraph = Paragraph::new(text)
        .block(
            Block::default()
                .title(" Restart Services ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Red)),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_emergency_shell(frame: &mut Frame, area: Rect, _app: &App) {
    let text = r#"
  Emergency Shell
  ═════════════════════════════════════════════════════════════════

  ⚠️  WARNING: Emergency shell access is for troubleshooting only!

  The shell bypasses normal security controls and should only be
  used when the web UI and API are inaccessible.

  To access the emergency shell:
    1. Press CONFIRM below
    2. Switch to TTY7 (Alt+F7)
    3. Press Enter to activate shell

  Type 'exit' in the shell to return to this console.

  [Press 'y' to enable emergency shell on TTY7]
  [Press ESC to cancel]
  "#;

    let paragraph = Paragraph::new(text)
        .block(
            Block::default()
                .title(" ⚠️  Emergency Shell ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Red)),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_footer(frame: &mut Frame, area: Rect, _app: &App) {
    let footer_text = " [F1] Main Menu  |  [↑↓] Navigate  |  [Enter] Select  |  [ESC] Back ";

    let footer = Paragraph::new(footer_text)
        .style(Style::default().fg(Color::White).bg(Color::DarkGray))
        .alignment(Alignment::Center);

    frame.render_widget(footer, area);
}

// =============================================================================
// Helpers
// =============================================================================

fn get_vm_count() -> usize {
    // Try to get VM count from libvirt
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

    info!("Starting Quantix Console TUI");

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
        error!("Console error: {}", err);
        eprintln!("Error: {err}");
    }

    Ok(())
}

fn run_app(terminal: &mut Terminal<CrosstermBackend<Stdout>>, app: &mut App) -> Result<()> {
    loop {
        // Refresh system info periodically
        app.refresh_system_info();

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
