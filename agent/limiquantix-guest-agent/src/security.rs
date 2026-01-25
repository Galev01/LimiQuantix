//! Security module for the guest agent.
//!
//! Provides:
//! - Command allowlisting/blocklisting
//! - File path restrictions
//! - Audit logging
//! - Rate limiting

use crate::config::AgentConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tracing::{info, warn};

/// Rate limiter for operations
pub struct RateLimiter {
    /// Command execution counter
    command_count: AtomicU64,
    /// File operation counter
    file_op_count: AtomicU64,
    /// Last reset time for commands (minute window)
    command_window_start: Mutex<Instant>,
    /// Last reset time for file ops (second window)
    file_op_window_start: Mutex<Instant>,
}

impl RateLimiter {
    /// Create a new rate limiter.
    pub fn new() -> Self {
        Self {
            command_count: AtomicU64::new(0),
            file_op_count: AtomicU64::new(0),
            command_window_start: Mutex::new(Instant::now()),
            file_op_window_start: Mutex::new(Instant::now()),
        }
    }

    /// Check if a command execution is allowed.
    pub fn check_command(&self, config: &AgentConfig) -> bool {
        let max_per_minute = config.security.max_commands_per_minute;
        if max_per_minute == 0 {
            return true; // Unlimited
        }

        let mut window_start = self.command_window_start.lock().unwrap();
        let now = Instant::now();

        // Reset window if a minute has passed
        if now.duration_since(*window_start) >= Duration::from_secs(60) {
            *window_start = now;
            self.command_count.store(0, Ordering::SeqCst);
        }

        let count = self.command_count.fetch_add(1, Ordering::SeqCst);
        if count >= max_per_minute as u64 {
            warn!(
                count = count,
                max = max_per_minute,
                "Command rate limit exceeded"
            );
            return false;
        }

        true
    }

    /// Check if a file operation is allowed.
    pub fn check_file_op(&self, config: &AgentConfig) -> bool {
        let max_per_second = config.security.max_file_ops_per_second;
        if max_per_second == 0 {
            return true; // Unlimited
        }

        let mut window_start = self.file_op_window_start.lock().unwrap();
        let now = Instant::now();

        // Reset window if a second has passed
        if now.duration_since(*window_start) >= Duration::from_secs(1) {
            *window_start = now;
            self.file_op_count.store(0, Ordering::SeqCst);
        }

        let count = self.file_op_count.fetch_add(1, Ordering::SeqCst);
        if count >= max_per_second as u64 {
            warn!(
                count = count,
                max = max_per_second,
                "File operation rate limit exceeded"
            );
            return false;
        }

        true
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

/// Audit log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    /// Timestamp of the operation
    pub timestamp: String,
    /// Operation type
    pub operation: String,
    /// Details of the operation
    pub details: HashMap<String, String>,
    /// Whether the operation was allowed
    pub allowed: bool,
    /// User context (if applicable)
    pub user: Option<String>,
    /// Exit code (for command execution)
    pub exit_code: Option<i32>,
    /// Duration in milliseconds
    pub duration_ms: Option<u64>,
    /// Source of the request
    pub source: String,
    /// Request ID for correlation
    pub request_id: String,
}

impl AuditLogEntry {
    /// Create a new audit log entry.
    pub fn new(operation: &str, request_id: &str) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();

        Self {
            timestamp: format!(
                "{}.{:03}Z",
                chrono::DateTime::from_timestamp(now.as_secs() as i64, 0)
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string())
                    .unwrap_or_else(|| "unknown".to_string()),
                now.subsec_millis()
            ),
            operation: operation.to_string(),
            details: HashMap::new(),
            allowed: true,
            user: None,
            exit_code: None,
            duration_ms: None,
            source: "control_plane".to_string(),
            request_id: request_id.to_string(),
        }
    }

    /// Add a detail to the entry.
    pub fn with_detail(mut self, key: &str, value: &str) -> Self {
        self.details.insert(key.to_string(), value.to_string());
        self
    }

    /// Set the allowed status.
    pub fn with_allowed(mut self, allowed: bool) -> Self {
        self.allowed = allowed;
        self
    }

    /// Set the user context.
    pub fn with_user(mut self, user: &str) -> Self {
        self.user = Some(user.to_string());
        self
    }

    /// Set the exit code.
    pub fn with_exit_code(mut self, code: i32) -> Self {
        self.exit_code = Some(code);
        self
    }

    /// Set the duration.
    pub fn with_duration(mut self, duration_ms: u64) -> Self {
        self.duration_ms = Some(duration_ms);
        self
    }

    /// Log this entry.
    pub fn log(&self) {
        let json = serde_json::to_string(self).unwrap_or_else(|_| format!("{:?}", self));

        if self.allowed {
            info!(audit = true, entry = %json, "Audit log");
        } else {
            warn!(audit = true, entry = %json, "Audit log (denied)");
        }
    }
}

/// Audit logger that writes to a file or stdout.
pub struct AuditLogger {
    /// Whether audit logging is enabled
    enabled: bool,
}

impl AuditLogger {
    /// Create a new audit logger.
    pub fn new(enabled: bool) -> Self {
        Self { enabled }
    }

    /// Log a command execution.
    pub fn log_execute(
        &self,
        request_id: &str,
        command: &str,
        user: Option<&str>,
        allowed: bool,
        exit_code: Option<i32>,
        duration_ms: Option<u64>,
    ) {
        if !self.enabled {
            return;
        }

        let mut entry = AuditLogEntry::new("execute", request_id)
            .with_detail("command", command)
            .with_allowed(allowed);

        if let Some(u) = user {
            entry = entry.with_user(u);
        }
        if let Some(code) = exit_code {
            entry = entry.with_exit_code(code);
        }
        if let Some(dur) = duration_ms {
            entry = entry.with_duration(dur);
        }

        entry.log();
    }

    /// Log a file operation.
    pub fn log_file_op(
        &self,
        request_id: &str,
        operation: &str,
        path: &str,
        allowed: bool,
        bytes: Option<u64>,
    ) {
        if !self.enabled {
            return;
        }

        let mut entry = AuditLogEntry::new(operation, request_id)
            .with_detail("path", path)
            .with_allowed(allowed);

        if let Some(b) = bytes {
            entry = entry.with_detail("bytes", &b.to_string());
        }

        entry.log();
    }

    /// Log a lifecycle operation.
    pub fn log_lifecycle(&self, request_id: &str, operation: &str, allowed: bool) {
        if !self.enabled {
            return;
        }

        AuditLogEntry::new(operation, request_id)
            .with_allowed(allowed)
            .log();
    }

    /// Log a service operation.
    pub fn log_service_op(
        &self,
        request_id: &str,
        service: &str,
        action: &str,
        allowed: bool,
        result: Option<&str>,
    ) {
        if !self.enabled {
            return;
        }

        let mut entry = AuditLogEntry::new("service_control", request_id)
            .with_detail("service", service)
            .with_detail("action", action)
            .with_allowed(allowed);

        if let Some(r) = result {
            entry = entry.with_detail("result", r);
        }

        entry.log();
    }

    /// Log a process operation.
    pub fn log_process_op(
        &self,
        request_id: &str,
        operation: &str,
        pid: Option<u32>,
        allowed: bool,
    ) {
        if !self.enabled {
            return;
        }

        let mut entry = AuditLogEntry::new(operation, request_id).with_allowed(allowed);

        if let Some(p) = pid {
            entry = entry.with_detail("pid", &p.to_string());
        }

        entry.log();
    }
}

/// Security context for request handling.
pub struct SecurityContext {
    /// Rate limiter
    pub rate_limiter: RateLimiter,
    /// Audit logger
    pub audit_logger: AuditLogger,
}

impl SecurityContext {
    /// Create a new security context from configuration.
    pub fn from_config(config: &AgentConfig) -> Self {
        Self {
            rate_limiter: RateLimiter::new(),
            audit_logger: AuditLogger::new(config.security.audit_logging),
        }
    }

    /// Check if a command is allowed.
    pub fn check_command(&self, config: &AgentConfig, command: &str) -> Result<(), String> {
        // Check rate limit
        if !self.rate_limiter.check_command(config) {
            return Err("Rate limit exceeded for command execution".to_string());
        }

        // Check allowlist/blocklist
        if !config.is_command_allowed(command) {
            return Err("Command not allowed by security policy".to_string());
        }

        Ok(())
    }

    /// Check if a file read is allowed.
    pub fn check_file_read(&self, config: &AgentConfig, path: &str) -> Result<(), String> {
        // Check rate limit
        if !self.rate_limiter.check_file_op(config) {
            return Err("Rate limit exceeded for file operations".to_string());
        }

        // Check path restrictions
        if !config.is_file_read_allowed(path) {
            return Err("File read not allowed by security policy".to_string());
        }

        Ok(())
    }

    /// Check if a file write is allowed.
    pub fn check_file_write(&self, config: &AgentConfig, path: &str) -> Result<(), String> {
        // Check rate limit
        if !self.rate_limiter.check_file_op(config) {
            return Err("Rate limit exceeded for file operations".to_string());
        }

        // Check path restrictions
        if !config.is_file_write_allowed(path) {
            return Err("File write not allowed by security policy".to_string());
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter() {
        let limiter = RateLimiter::new();
        let mut config = AgentConfig::default();

        // Unlimited by default
        assert!(limiter.check_command(&config));
        assert!(limiter.check_file_op(&config));

        // Set limits
        config.security.max_commands_per_minute = 2;
        config.security.max_file_ops_per_second = 2;

        // Should allow first two
        assert!(limiter.check_command(&config));
        assert!(limiter.check_command(&config));

        // Should deny third
        assert!(!limiter.check_command(&config));
    }

    #[test]
    fn test_audit_log_entry() {
        let entry = AuditLogEntry::new("execute", "test-123")
            .with_detail("command", "ls -la")
            .with_user("root")
            .with_exit_code(0)
            .with_duration(150);

        assert_eq!(entry.operation, "execute");
        assert_eq!(entry.request_id, "test-123");
        assert_eq!(entry.exit_code, Some(0));
        assert!(entry.allowed);
    }

    #[test]
    fn test_security_context() {
        let config = AgentConfig::default();
        let ctx = SecurityContext::from_config(&config);

        // Should allow by default
        assert!(ctx.check_command(&config, "ls").is_ok());
        assert!(ctx.check_file_read(&config, "/etc/passwd").is_ok());
        assert!(ctx.check_file_write(&config, "/tmp/test").is_ok());
    }
}
