//! # Quantix Logging System
//!
//! Beautiful, emoji-rich, structured logging for Quantix-OS.
//!
//! ## Features
//! - 🎨 Colorful console output with emojis
//! - 📁 JSON file logging for analysis
//! - 🔍 Easy error tracking with context
//! - ⏱️ Performance timing built-in
//! - 🏷️ Component-based categorization

use std::io;
use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use tracing::{Level, Subscriber};
use tracing_subscriber::{
    fmt::{self, format::FmtSpan, time::ChronoLocal, MakeWriter},
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter, Layer,
};

// ============================================================================
// Log Category Emojis
// ============================================================================

/// Emoji prefixes for different log categories
pub mod emoji {
    // Status
    pub const SUCCESS: &str = "✅";
    pub const ERROR: &str = "❌";
    pub const WARNING: &str = "⚠️";
    pub const INFO: &str = "ℹ️";
    pub const DEBUG: &str = "🔍";
    pub const TRACE: &str = "📍";

    // Components
    pub const VM: &str = "🖥️";
    pub const NETWORK: &str = "🌐";
    pub const STORAGE: &str = "💾";
    pub const SECURITY: &str = "🔒";
    pub const CLUSTER: &str = "🔗";
    pub const AGENT: &str = "🤖";
    pub const CONSOLE: &str = "🖵";
    pub const API: &str = "📡";
    pub const GRPC: &str = "📞";

    // Actions
    pub const START: &str = "🚀";
    pub const STOP: &str = "🛑";
    pub const CREATE: &str = "➕";
    pub const DELETE: &str = "🗑️";
    pub const UPDATE: &str = "✏️";
    pub const MIGRATE: &str = "🚚";
    pub const SNAPSHOT: &str = "📸";
    pub const BACKUP: &str = "💿";
    pub const RESTORE: &str = "♻️";
    pub const CONNECT: &str = "🔌";
    pub const DISCONNECT: &str = "🔌❌";

    // States
    pub const RUNNING: &str = "🟢";
    pub const STOPPED: &str = "🔴";
    pub const PAUSED: &str = "🟡";
    pub const PENDING: &str = "🟠";
    pub const HEALTHY: &str = "💚";
    pub const UNHEALTHY: &str = "💔";

    // Performance
    pub const TIMER: &str = "⏱️";
    pub const FAST: &str = "⚡";
    pub const SLOW: &str = "🐢";
    pub const MEMORY: &str = "🧠";
    pub const CPU: &str = "💻";
    pub const DISK: &str = "📀";

    // Events
    pub const EVENT: &str = "📣";
    pub const ALERT: &str = "🚨";
    pub const HEARTBEAT: &str = "💓";
    pub const SYNC: &str = "🔄";
    pub const BOOT: &str = "🌅";
    pub const SHUTDOWN: &str = "🌙";
}

// ============================================================================
// Logging Macros
// ============================================================================

/// Log a successful operation
#[macro_export]
macro_rules! log_success {
    ($component:expr, $($arg:tt)*) => {
        tracing::info!(component = $component, status = "success", "✅ {}", format!($($arg)*))
    };
}

/// Log an error with context
#[macro_export]
macro_rules! log_error {
    ($component:expr, $err:expr, $($arg:tt)*) => {
        tracing::error!(
            component = $component,
            error = %$err,
            error_type = std::any::type_name_of_val(&$err),
            "❌ {} | Error: {}",
            format!($($arg)*),
            $err
        )
    };
}

/// Log a warning
#[macro_export]
macro_rules! log_warn {
    ($component:expr, $($arg:tt)*) => {
        tracing::warn!(component = $component, "⚠️ {}", format!($($arg)*))
    };
}

/// Log VM lifecycle event
#[macro_export]
macro_rules! log_vm {
    ($action:expr, $vm_id:expr, $($arg:tt)*) => {
        tracing::info!(
            component = "vm",
            vm_id = $vm_id,
            action = $action,
            "🖥️ [{}] {} | {}",
            $action.to_uppercase(),
            $vm_id,
            format!($($arg)*)
        )
    };
}

/// Log network event
#[macro_export]
macro_rules! log_network {
    ($action:expr, $($arg:tt)*) => {
        tracing::info!(
            component = "network",
            action = $action,
            "🌐 [{}] {}",
            $action.to_uppercase(),
            format!($($arg)*)
        )
    };
}

/// Log storage event
#[macro_export]
macro_rules! log_storage {
    ($action:expr, $($arg:tt)*) => {
        tracing::info!(
            component = "storage",
            action = $action,
            "💾 [{}] {}",
            $action.to_uppercase(),
            format!($($arg)*)
        )
    };
}

/// Log performance timing
#[macro_export]
macro_rules! log_timing {
    ($operation:expr, $duration_ms:expr) => {
        let emoji = if $duration_ms < 100 { "⚡" } else if $duration_ms < 1000 { "⏱️" } else { "🐢" };
        tracing::info!(
            component = "perf",
            operation = $operation,
            duration_ms = $duration_ms,
            "{} {} completed in {}ms",
            emoji,
            $operation,
            $duration_ms
        )
    };
}

/// Log with a timer that automatically logs duration on drop
#[macro_export]
macro_rules! timed_operation {
    ($operation:expr) => {
        $crate::TimedOperation::new($operation)
    };
}

// ============================================================================
// Timed Operation Helper
// ============================================================================

/// A helper struct that logs operation duration when dropped
pub struct TimedOperation {
    operation: String,
    start: std::time::Instant,
}

impl TimedOperation {
    pub fn new(operation: impl Into<String>) -> Self {
        let operation = operation.into();
        tracing::debug!("⏱️ Starting: {}", operation);
        Self {
            operation,
            start: std::time::Instant::now(),
        }
    }

    pub fn success(self) {
        let duration = self.start.elapsed();
        let ms = duration.as_millis();
        let emoji = if ms < 100 { "⚡" } else if ms < 1000 { "✅" } else { "⚠️" };
        tracing::info!(
            component = "perf",
            operation = %self.operation,
            duration_ms = %ms,
            "{} {} completed in {}ms",
            emoji,
            self.operation,
            ms
        );
        std::mem::forget(self); // Don't run Drop
    }

    pub fn failure(self, error: &str) {
        let duration = self.start.elapsed();
        tracing::error!(
            component = "perf",
            operation = %self.operation,
            duration_ms = %duration.as_millis(),
            error = error,
            "❌ {} failed after {}ms: {}",
            self.operation,
            duration.as_millis(),
            error
        );
        std::mem::forget(self); // Don't run Drop
    }
}

impl Drop for TimedOperation {
    fn drop(&mut self) {
        // If not explicitly finished, log as warning
        let duration = self.start.elapsed();
        tracing::warn!(
            component = "perf",
            operation = %self.operation,
            duration_ms = %duration.as_millis(),
            "⚠️ {} ended without explicit success/failure after {}ms",
            self.operation,
            duration.as_millis()
        );
    }
}

// ============================================================================
// Console Formatter (Emoji + Color)
// ============================================================================

/// Custom log formatter with emojis and colors
pub struct QuantixFormatter;

// ============================================================================
// Initialization Functions
// ============================================================================

/// Initialize logging with beautiful console output.
///
/// Features:
/// - Colorful output with emojis
/// - Timestamps in local time
/// - Target and span information
/// - Thread IDs for debugging
///
/// # Example
/// ```
/// limiquantix_common::init_logging("info").unwrap();
/// ```
pub fn init_logging(level: &str) -> Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(level));

    let subscriber = tracing_subscriber::registry()
        .with(filter)
        .with(
            fmt::layer()
                .with_ansi(true)
                .with_target(true)
                .with_thread_ids(true)
                .with_file(true)
                .with_line_number(true)
                .with_timer(ChronoLocal::new("%Y-%m-%d %H:%M:%S%.3f".to_string()))
                .with_span_events(FmtSpan::CLOSE)
        );

    subscriber.init();

    // Log startup banner
    tracing::info!("🌅 ═══════════════════════════════════════════════════════════");
    tracing::info!("🌅  QUANTIX NODE DAEMON STARTING");
    tracing::info!("🌅  Log Level: {}", level);
    tracing::info!("🌅 ═══════════════════════════════════════════════════════════");

    Ok(())
}

/// Initialize logging with JSON output format.
/// Suitable for production environments with log aggregation.
///
/// Outputs structured JSON logs that can be parsed by tools like:
/// - Elasticsearch/Logstash/Kibana (ELK)
/// - Grafana Loki
/// - Datadog
pub fn init_logging_json(level: &str) -> Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(level));

    let subscriber = tracing_subscriber::registry()
        .with(filter)
        .with(
            fmt::layer()
                .json()
                .with_target(true)
                .with_thread_ids(true)
                .with_span_events(FmtSpan::CLOSE)
                .with_current_span(true)
        );

    subscriber.init();

    Ok(())
}

/// Initialize production logging with both console and file output.
///
/// # Arguments
/// * `level` - Log level for console output
/// * `log_dir` - Directory for log files
/// * `json_file` - Enable JSON format for file logs
///
/// Creates these log files:
/// - `quantix-node.log` - Main log file
/// - `quantix-node.err.log` - Errors only
pub fn init_logging_production(
    level: &str,
    log_dir: &Path,
    json_file: bool,
) -> Result<()> {
    use std::fs::{self, OpenOptions};

    // Ensure log directory exists
    fs::create_dir_all(log_dir)?;

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(level));

    let error_filter = EnvFilter::new("error");

    // Console layer (colorful)
    let console_layer = fmt::layer()
        .with_ansi(true)
        .with_target(true)
        .with_timer(ChronoLocal::new("%H:%M:%S%.3f".to_string()))
        .with_filter(filter.clone());

    // Main file layer
    let main_log_path = log_dir.join("quantix-node.log");
    let main_log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&main_log_path)?;

    let file_layer = if json_file {
        fmt::layer()
            .json()
            .with_writer(move || main_log_file.try_clone().unwrap())
            .with_ansi(false)
            .with_filter(filter)
            .boxed()
    } else {
        fmt::layer()
            .with_writer(move || main_log_file.try_clone().unwrap())
            .with_ansi(false)
            .with_timer(ChronoLocal::new("%Y-%m-%d %H:%M:%S%.3f".to_string()))
            .with_filter(filter)
            .boxed()
    };

    // Error-only file layer
    let error_log_path = log_dir.join("quantix-node.err.log");
    let error_log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&error_log_path)?;

    let error_layer = fmt::layer()
        .with_writer(move || error_log_file.try_clone().unwrap())
        .with_ansi(false)
        .with_timer(ChronoLocal::new("%Y-%m-%d %H:%M:%S%.3f".to_string()))
        .with_filter(error_filter);

    let subscriber = tracing_subscriber::registry()
        .with(console_layer)
        .with(file_layer)
        .with(error_layer);

    subscriber.init();

    // Log startup
    tracing::info!("🌅 ═══════════════════════════════════════════════════════════");
    tracing::info!("🌅  QUANTIX NODE DAEMON v{}", env!("CARGO_PKG_VERSION"));
    tracing::info!("🌅  Log Level: {} | Log Dir: {}", level, log_dir.display());
    tracing::info!("🌅 ═══════════════════════════════════════════════════════════");

    Ok(())
}

// ============================================================================
// Log Analysis Helpers
// ============================================================================

/// Parsed log entry for analysis
#[derive(Debug, Clone)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: Level,
    pub component: Option<String>,
    pub message: String,
    pub fields: std::collections::HashMap<String, String>,
}

/// Log statistics for quick overview
#[derive(Debug, Default)]
pub struct LogStats {
    pub total: usize,
    pub errors: usize,
    pub warnings: usize,
    pub info: usize,
    pub debug: usize,
    pub by_component: std::collections::HashMap<String, usize>,
    pub recent_errors: Vec<String>,
}

impl LogStats {
    /// Get a summary string with emojis
    pub fn summary(&self) -> String {
        format!(
            r#"
╔════════════════════════════════════════════════════════════════╗
║                    📊 LOG STATISTICS                            ║
╠════════════════════════════════════════════════════════════════╣
║  Total Entries:  {:>6}                                         ║
║  ❌ Errors:      {:>6}  {}                                       
║  ⚠️ Warnings:    {:>6}                                         ║
║  ℹ️ Info:        {:>6}                                         ║
║  🔍 Debug:       {:>6}                                         ║
╠════════════════════════════════════════════════════════════════╣
║  By Component:                                                  ║
{}
╚════════════════════════════════════════════════════════════════╝"#,
            self.total,
            self.errors,
            if self.errors > 0 { "⚠️ CHECK ERRORS!" } else { "" },
            self.warnings,
            self.info,
            self.debug,
            self.by_component
                .iter()
                .map(|(k, v)| format!("║    {:<15} {:>6}                                          ║", k, v))
                .collect::<Vec<_>>()
                .join("\n")
        )
    }
}

// ============================================================================
// Component-specific Logging Traits
// ============================================================================

/// Trait for components that need standardized logging
pub trait Loggable {
    /// Get the component name for logging
    fn log_component(&self) -> &'static str;

    /// Log a debug message
    fn log_debug(&self, msg: &str) {
        tracing::debug!(component = self.log_component(), "🔍 {}", msg);
    }

    /// Log an info message
    fn log_info(&self, msg: &str) {
        tracing::info!(component = self.log_component(), "ℹ️ {}", msg);
    }

    /// Log a warning
    fn log_warn(&self, msg: &str) {
        tracing::warn!(component = self.log_component(), "⚠️ {}", msg);
    }

    /// Log an error
    fn log_error(&self, msg: &str, err: &dyn std::error::Error) {
        tracing::error!(
            component = self.log_component(),
            error = %err,
            "❌ {} | {}", msg, err
        );
    }

    /// Log a success
    fn log_success(&self, msg: &str) {
        tracing::info!(component = self.log_component(), "✅ {}", msg);
    }
}

// ============================================================================
// Quick Diagnostic Logging
// ============================================================================

/// Quick system diagnostic info (call on startup)
pub fn log_system_diagnostics() {
    use std::process::Command;

    tracing::info!("🔍 ═══════════════════════════════════════════════════════════");
    tracing::info!("🔍  SYSTEM DIAGNOSTICS");
    tracing::info!("🔍 ═══════════════════════════════════════════════════════════");

    // Hostname
    if let Ok(hostname) = std::fs::read_to_string("/etc/hostname") {
        tracing::info!("🏠 Hostname: {}", hostname.trim());
    }

    // Kernel
    if let Ok(output) = Command::new("uname").arg("-r").output() {
        let kernel = String::from_utf8_lossy(&output.stdout);
        tracing::info!("🐧 Kernel: {}", kernel.trim());
    }

    // Memory
    if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
        for line in meminfo.lines().take(3) {
            tracing::info!("🧠 {}", line);
        }
    }

    // CPU
    if let Ok(cpuinfo) = std::fs::read_to_string("/proc/cpuinfo") {
        if let Some(model_line) = cpuinfo.lines().find(|l| l.starts_with("model name")) {
            tracing::info!("💻 {}", model_line);
        }
    }

    // Libvirt status
    if let Ok(output) = Command::new("virsh").args(["--version"]).output() {
        let version = String::from_utf8_lossy(&output.stdout);
        tracing::info!("🔧 Libvirt: {}", version.trim());
    } else {
        tracing::warn!("⚠️ Libvirt not found or not accessible");
    }

    // OVS status
    if let Ok(output) = Command::new("ovs-vsctl").args(["--version"]).output() {
        let version = String::from_utf8_lossy(&output.stdout);
        if let Some(first_line) = version.lines().next() {
            tracing::info!("🌐 OVS: {}", first_line);
        }
    } else {
        tracing::warn!("⚠️ Open vSwitch not found");
    }

    tracing::info!("🔍 ═══════════════════════════════════════════════════════════");
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timed_operation() {
        // Just ensure it compiles and doesn't panic
        let op = TimedOperation::new("test_operation");
        op.success();
    }

    #[test]
    fn test_log_stats_summary() {
        let mut stats = LogStats::default();
        stats.total = 100;
        stats.errors = 5;
        stats.warnings = 10;
        stats.info = 80;
        stats.debug = 5;
        stats.by_component.insert("vm".to_string(), 50);
        stats.by_component.insert("network".to_string(), 30);

        let summary = stats.summary();
        assert!(summary.contains("100"));
        assert!(summary.contains("vm"));
    }
}
