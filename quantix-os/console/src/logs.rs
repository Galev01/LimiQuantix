//! Log Viewer Module for Quantix Console
//!
//! Provides beautiful, filterable log viewing with emoji support.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};

use anyhow::Result;
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Tabs, Wrap},
    Frame,
};

// ============================================================================
// Log Entry Types
// ============================================================================

/// Log severity level
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub fn from_str(s: &str) -> Self {
        let s = s.to_lowercase();
        if s.contains("error") || s.contains("❌") {
            LogLevel::Error
        } else if s.contains("warn") || s.contains("⚠️") {
            LogLevel::Warn
        } else if s.contains("debug") || s.contains("🔍") {
            LogLevel::Debug
        } else if s.contains("trace") || s.contains("📍") {
            LogLevel::Trace
        } else {
            LogLevel::Info
        }
    }

    pub fn emoji(&self) -> &'static str {
        match self {
            LogLevel::Trace => "📍",
            LogLevel::Debug => "🔍",
            LogLevel::Info => "ℹ️",
            LogLevel::Warn => "⚠️",
            LogLevel::Error => "❌",
        }
    }

    pub fn color(&self) -> Color {
        match self {
            LogLevel::Trace => Color::DarkGray,
            LogLevel::Debug => Color::Cyan,
            LogLevel::Info => Color::White,
            LogLevel::Warn => Color::Yellow,
            LogLevel::Error => Color::Red,
        }
    }
}

/// A parsed log entry
#[derive(Debug, Clone)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: LogLevel,
    pub component: Option<String>,
    pub message: String,
    pub raw: String,
}

impl LogEntry {
    /// Parse a log line into a LogEntry
    pub fn parse(line: &str) -> Self {
        let level = LogLevel::from_str(line);
        
        // Try to extract timestamp (assumes format: "2024-01-03 12:34:56.789 ...")
        let timestamp = if line.len() > 23 && line.chars().nth(4) == Some('-') {
            line[..23].to_string()
        } else {
            String::new()
        };

        // Try to extract component
        let component = if line.contains("component=") {
            line.split("component=")
                .nth(1)
                .and_then(|s| s.split_whitespace().next())
                .map(|s| s.trim_matches('"').to_string())
        } else if line.contains("[vm]") || line.contains("🖥️") {
            Some("vm".to_string())
        } else if line.contains("[network]") || line.contains("🌐") {
            Some("network".to_string())
        } else if line.contains("[storage]") || line.contains("💾") {
            Some("storage".to_string())
        } else {
            None
        };

        LogEntry {
            timestamp,
            level,
            component,
            message: line.to_string(),
            raw: line.to_string(),
        }
    }

    /// Convert to a ratatui ListItem with colors
    pub fn to_list_item(&self) -> ListItem<'static> {
        let style = Style::default().fg(self.level.color());
        
        let spans = vec![
            Span::styled(
                format!("{} ", self.level.emoji()),
                style.add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                if !self.timestamp.is_empty() {
                    format!("[{}] ", &self.timestamp[11..19]) // Just time
                } else {
                    String::new()
                },
                Style::default().fg(Color::DarkGray),
            ),
            Span::styled(self.message.clone(), style),
        ];

        ListItem::new(Line::from(spans))
    }
}

// ============================================================================
// Log Viewer State
// ============================================================================

/// Viewer filter options
#[derive(Debug, Clone, Default)]
pub struct LogFilter {
    pub min_level: Option<LogLevel>,
    pub component: Option<String>,
    pub search: Option<String>,
    pub errors_only: bool,
}

impl LogFilter {
    pub fn matches(&self, entry: &LogEntry) -> bool {
        // Level filter
        if let Some(min_level) = self.min_level {
            let level_ord = |l: LogLevel| -> u8 {
                match l {
                    LogLevel::Trace => 0,
                    LogLevel::Debug => 1,
                    LogLevel::Info => 2,
                    LogLevel::Warn => 3,
                    LogLevel::Error => 4,
                }
            };
            if level_ord(entry.level) < level_ord(min_level) {
                return false;
            }
        }

        // Errors only
        if self.errors_only && entry.level != LogLevel::Error {
            return false;
        }

        // Component filter
        if let Some(ref comp) = self.component {
            if entry.component.as_ref() != Some(comp) {
                return false;
            }
        }

        // Search filter
        if let Some(ref search) = self.search {
            if !entry.raw.to_lowercase().contains(&search.to_lowercase()) {
                return false;
            }
        }

        true
    }
}

/// The log viewer state
pub struct LogViewer {
    /// All loaded log entries
    pub entries: VecDeque<LogEntry>,
    /// Filtered entries (indices into entries)
    pub filtered_indices: Vec<usize>,
    /// Current filter
    pub filter: LogFilter,
    /// List selection state
    pub list_state: ListState,
    /// Maximum entries to keep
    pub max_entries: usize,
    /// Log file path
    pub log_path: String,
    /// Last file position for tailing
    last_position: u64,
    /// Currently selected tab
    pub current_tab: usize,
    /// Available log files
    pub log_files: Vec<(&'static str, &'static str)>,
    /// Is paused (for live viewing)
    pub paused: bool,
    /// Stats
    pub stats: LogStats,
}

/// Log statistics
#[derive(Debug, Default, Clone)]
pub struct LogStats {
    pub total: usize,
    pub errors: usize,
    pub warnings: usize,
    pub last_error: Option<String>,
    pub last_error_time: Option<String>,
}

impl LogViewer {
    pub fn new() -> Self {
        let log_files = vec![
            ("Node", "/var/log/quantix-node.log"),
            ("Errors", "/var/log/quantix-node.err.log"),
            ("System", "/var/log/messages"),
            ("Libvirt", "/var/log/libvirt/libvirtd.log"),
        ];

        let mut viewer = Self {
            entries: VecDeque::new(),
            filtered_indices: Vec::new(),
            filter: LogFilter::default(),
            list_state: ListState::default(),
            max_entries: 1000,
            log_path: log_files[0].1.to_string(),
            last_position: 0,
            current_tab: 0,
            log_files,
            paused: false,
            stats: LogStats::default(),
        };

        viewer.load_logs();
        viewer
    }

    /// Load or reload logs from the current file
    pub fn load_logs(&mut self) {
        self.entries.clear();
        self.last_position = 0;

        if let Ok(file) = File::open(&self.log_path) {
            let reader = BufReader::new(file);
            
            for line in reader.lines().flatten() {
                if !line.is_empty() {
                    self.add_entry(LogEntry::parse(&line));
                }
            }
        }

        self.apply_filter();
        self.update_stats();
        
        // Scroll to bottom
        if !self.filtered_indices.is_empty() {
            self.list_state.select(Some(self.filtered_indices.len() - 1));
        }
    }

    /// Add a new log entry
    fn add_entry(&mut self, entry: LogEntry) {
        self.entries.push_back(entry);
        
        // Trim if over max
        while self.entries.len() > self.max_entries {
            self.entries.pop_front();
        }
    }

    /// Tail the log file for new entries
    pub fn tail(&mut self) -> Result<usize> {
        if self.paused {
            return Ok(0);
        }

        let mut file = File::open(&self.log_path)?;
        let current_len = file.metadata()?.len();

        if current_len < self.last_position {
            // File was truncated, reload
            self.load_logs();
            return Ok(self.entries.len());
        }

        if current_len == self.last_position {
            return Ok(0);
        }

        file.seek(SeekFrom::Start(self.last_position))?;
        let reader = BufReader::new(file);
        let mut new_count = 0;

        for line in reader.lines().flatten() {
            if !line.is_empty() {
                self.add_entry(LogEntry::parse(&line));
                new_count += 1;
            }
        }

        self.last_position = current_len;
        
        if new_count > 0 {
            self.apply_filter();
            self.update_stats();
            
            // Auto-scroll if not paused and at bottom
            if !self.filtered_indices.is_empty() {
                if let Some(selected) = self.list_state.selected() {
                    if selected >= self.filtered_indices.len().saturating_sub(2) {
                        self.list_state.select(Some(self.filtered_indices.len() - 1));
                    }
                }
            }
        }

        Ok(new_count)
    }

    /// Apply the current filter
    pub fn apply_filter(&mut self) {
        self.filtered_indices = self
            .entries
            .iter()
            .enumerate()
            .filter(|(_, e)| self.filter.matches(e))
            .map(|(i, _)| i)
            .collect();
    }

    /// Update statistics
    fn update_stats(&mut self) {
        self.stats.total = self.entries.len();
        self.stats.errors = self.entries.iter().filter(|e| e.level == LogLevel::Error).count();
        self.stats.warnings = self.entries.iter().filter(|e| e.level == LogLevel::Warn).count();
        
        // Find last error
        if let Some(last_err) = self.entries.iter().rev().find(|e| e.level == LogLevel::Error) {
            self.stats.last_error = Some(last_err.message.clone());
            self.stats.last_error_time = Some(last_err.timestamp.clone());
        }
    }

    /// Switch to a different log file
    pub fn switch_log(&mut self, index: usize) {
        if index < self.log_files.len() {
            self.current_tab = index;
            self.log_path = self.log_files[index].1.to_string();
            self.load_logs();
        }
    }

    /// Toggle errors-only filter
    pub fn toggle_errors_only(&mut self) {
        self.filter.errors_only = !self.filter.errors_only;
        self.apply_filter();
    }

    /// Set search filter
    pub fn set_search(&mut self, search: Option<String>) {
        self.filter.search = search;
        self.apply_filter();
    }

    /// Navigate selection
    pub fn select_next(&mut self) {
        if self.filtered_indices.is_empty() {
            return;
        }
        let i = self.list_state.selected().unwrap_or(0);
        let next = if i >= self.filtered_indices.len() - 1 { 0 } else { i + 1 };
        self.list_state.select(Some(next));
    }

    pub fn select_prev(&mut self) {
        if self.filtered_indices.is_empty() {
            return;
        }
        let i = self.list_state.selected().unwrap_or(0);
        let prev = if i == 0 { self.filtered_indices.len() - 1 } else { i - 1 };
        self.list_state.select(Some(prev));
    }

    pub fn select_first(&mut self) {
        if !self.filtered_indices.is_empty() {
            self.list_state.select(Some(0));
        }
    }

    pub fn select_last(&mut self) {
        if !self.filtered_indices.is_empty() {
            self.list_state.select(Some(self.filtered_indices.len() - 1));
        }
    }

    /// Get filtered entries for display
    pub fn get_display_entries(&self) -> Vec<ListItem<'static>> {
        self.filtered_indices
            .iter()
            .filter_map(|&i| self.entries.get(i))
            .map(|e| e.to_list_item())
            .collect()
    }
}

// ============================================================================
// UI Rendering
// ============================================================================

/// Render the log viewer
pub fn render_log_viewer(frame: &mut Frame, area: Rect, viewer: &mut LogViewer) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),  // Tabs
            Constraint::Length(3),  // Stats/Filter bar
            Constraint::Min(10),    // Log list
            Constraint::Length(3),  // Help
        ])
        .split(area);

    // Tabs
    let tab_titles: Vec<Line> = viewer
        .log_files
        .iter()
        .enumerate()
        .map(|(i, (name, _))| {
            if i == viewer.current_tab {
                Line::from(Span::styled(
                    format!(" {} ", name),
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
                ))
            } else {
                Line::from(format!(" {} ", name))
            }
        })
        .collect();

    let tabs = Tabs::new(tab_titles)
        .block(Block::default().borders(Borders::ALL).title(" 📁 Log Files "))
        .select(viewer.current_tab)
        .highlight_style(Style::default().fg(Color::Yellow));

    frame.render_widget(tabs, chunks[0]);

    // Stats bar
    let stats_text = format!(
        " 📊 Total: {} | ❌ Errors: {} | ⚠️ Warnings: {} | {} {} ",
        viewer.stats.total,
        viewer.stats.errors,
        viewer.stats.warnings,
        if viewer.filter.errors_only { "🔴 ERRORS ONLY" } else { "" },
        if viewer.paused { "⏸️ PAUSED" } else { "▶️ LIVE" },
    );

    let stats_style = if viewer.stats.errors > 0 {
        Style::default().fg(Color::Red)
    } else {
        Style::default().fg(Color::Green)
    };

    let stats = Paragraph::new(stats_text)
        .style(stats_style)
        .block(Block::default().borders(Borders::ALL));

    frame.render_widget(stats, chunks[1]);

    // Log list
    let entries = viewer.get_display_entries();
    let log_list = List::new(entries)
        .block(
            Block::default()
                .title(format!(" 📜 {} ", viewer.log_path))
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan)),
        )
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▶ ");

    frame.render_stateful_widget(log_list, chunks[2], &mut viewer.list_state);

    // Help bar
    let help_text = " [Tab] Switch Log | [E] Errors Only | [P] Pause | [Home/End] Jump | [/] Search | [Esc] Back ";
    let help = Paragraph::new(help_text)
        .style(Style::default().fg(Color::DarkGray))
        .block(Block::default().borders(Borders::ALL));

    frame.render_widget(help, chunks[3]);
}

/// Render a compact log summary (for main dashboard)
pub fn render_log_summary(frame: &mut Frame, area: Rect, viewer: &LogViewer) {
    let content = if viewer.stats.errors > 0 {
        format!(
            "❌ {} errors | ⚠️ {} warnings\n\nLast error:\n{}",
            viewer.stats.errors,
            viewer.stats.warnings,
            viewer.stats.last_error.as_deref().unwrap_or("None").chars().take(60).collect::<String>()
        )
    } else {
        format!(
            "✅ No errors | ⚠️ {} warnings\n\n📊 {} total log entries",
            viewer.stats.warnings,
            viewer.stats.total
        )
    };

    let style = if viewer.stats.errors > 0 {
        Style::default().fg(Color::Red)
    } else {
        Style::default().fg(Color::Green)
    };

    let widget = Paragraph::new(content)
        .style(style)
        .block(
            Block::default()
                .title(" 📋 Log Summary ")
                .borders(Borders::ALL)
                .border_style(if viewer.stats.errors > 0 {
                    Style::default().fg(Color::Red)
                } else {
                    Style::default().fg(Color::Green)
                }),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(widget, area);
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_level_parsing() {
        assert_eq!(LogLevel::from_str("ERROR: something failed"), LogLevel::Error);
        assert_eq!(LogLevel::from_str("❌ VM crashed"), LogLevel::Error);
        assert_eq!(LogLevel::from_str("⚠️ Low memory"), LogLevel::Warn);
        assert_eq!(LogLevel::from_str("INFO: Started"), LogLevel::Info);
    }

    #[test]
    fn test_filter() {
        let entry = LogEntry {
            timestamp: "2024-01-03 12:00:00".to_string(),
            level: LogLevel::Error,
            component: Some("vm".to_string()),
            message: "VM failed".to_string(),
            raw: "ERROR vm: VM failed".to_string(),
        };

        let mut filter = LogFilter::default();
        assert!(filter.matches(&entry));

        filter.errors_only = true;
        assert!(filter.matches(&entry));

        filter.component = Some("network".to_string());
        assert!(!filter.matches(&entry));
    }
}
