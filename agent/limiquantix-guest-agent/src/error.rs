//! # Guest Agent Error Codes
//!
//! This module defines comprehensive error codes for the Quantix Guest Agent.
//! All errors follow the format: QXGA-XXXX where:
//! - QX = Quantix
//! - GA = Guest Agent
//! - XXXX = 4-digit error code
//!
//! ## Error Code Ranges
//!
//! | Range     | Category                    |
//! |-----------|----------------------------|
//! | 1000-1999 | Transport/Connection Errors |
//! | 2000-2999 | Protocol/Message Errors     |
//! | 3000-3999 | Execution Errors            |
//! | 4000-4999 | File Operation Errors       |
//! | 5000-5999 | Lifecycle Errors            |
//! | 6000-6999 | Desktop Integration Errors  |
//! | 7000-7999 | Process/Service Errors      |
//! | 8000-8999 | Security Errors             |
//! | 9000-9999 | Internal Errors             |

use serde::{Deserialize, Serialize};
use std::fmt;

/// Error code type alias
pub type ErrorCode = u16;

/// Agent error with structured error code
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentError {
    /// Error code (QXGA-XXXX format)
    pub code: ErrorCode,
    /// Error category
    pub category: ErrorCategory,
    /// Human-readable error name
    pub name: String,
    /// Detailed error message
    pub message: String,
    /// Optional additional context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    /// Suggested resolution
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
}

impl fmt::Display for AgentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "QXGA-{:04}: {} - {}", self.code, self.name, self.message)
    }
}

impl std::error::Error for AgentError {}

/// Error category for grouping
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategory {
    Transport,
    Protocol,
    Execution,
    FileOperation,
    Lifecycle,
    Desktop,
    ProcessService,
    Security,
    Internal,
}

impl fmt::Display for ErrorCategory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErrorCategory::Transport => write!(f, "Transport"),
            ErrorCategory::Protocol => write!(f, "Protocol"),
            ErrorCategory::Execution => write!(f, "Execution"),
            ErrorCategory::FileOperation => write!(f, "File Operation"),
            ErrorCategory::Lifecycle => write!(f, "Lifecycle"),
            ErrorCategory::Desktop => write!(f, "Desktop"),
            ErrorCategory::ProcessService => write!(f, "Process/Service"),
            ErrorCategory::Security => write!(f, "Security"),
            ErrorCategory::Internal => write!(f, "Internal"),
        }
    }
}

// ============================================================================
// Error Code Constants
// ============================================================================

/// Transport/Connection Errors (1000-1999)
pub mod transport {
    use super::*;

    pub const DEVICE_NOT_FOUND: ErrorCode = 1001;
    pub const DEVICE_OPEN_FAILED: ErrorCode = 1002;
    pub const CONNECTION_LOST: ErrorCode = 1003;
    pub const WRITE_FAILED: ErrorCode = 1004;
    pub const READ_FAILED: ErrorCode = 1005;
    pub const DEVICE_BUSY: ErrorCode = 1006;
    pub const VSOCK_UNAVAILABLE: ErrorCode = 1007;
    pub const CONNECTION_TIMEOUT: ErrorCode = 1008;
    pub const INVALID_DEVICE_PATH: ErrorCode = 1009;
}

/// Protocol/Message Errors (2000-2999)
pub mod protocol {
    use super::*;

    pub const INVALID_MESSAGE: ErrorCode = 2001;
    pub const UNKNOWN_MESSAGE_TYPE: ErrorCode = 2002;
    pub const MESSAGE_TOO_LARGE: ErrorCode = 2003;
    pub const MISSING_PAYLOAD: ErrorCode = 2004;
    pub const INVALID_MESSAGE_ID: ErrorCode = 2005;
    pub const ENCODING_ERROR: ErrorCode = 2006;
    pub const DECODING_ERROR: ErrorCode = 2007;
    pub const CHECKSUM_MISMATCH: ErrorCode = 2008;
}

/// Execution Errors (3000-3999)
pub mod execution {
    use super::*;

    pub const COMMAND_NOT_FOUND: ErrorCode = 3001;
    pub const PERMISSION_DENIED: ErrorCode = 3002;
    pub const EXECUTION_TIMEOUT: ErrorCode = 3003;
    pub const COMMAND_BLOCKED: ErrorCode = 3004;
    pub const USER_NOT_FOUND: ErrorCode = 3005;
    pub const GROUP_NOT_FOUND: ErrorCode = 3006;
    pub const SETUID_FAILED: ErrorCode = 3007;
    pub const WORKING_DIR_NOT_FOUND: ErrorCode = 3008;
    pub const SPAWN_FAILED: ErrorCode = 3009;
    pub const OUTPUT_TOO_LARGE: ErrorCode = 3010;
}

/// File Operation Errors (4000-4999)
pub mod file_ops {
    use super::*;

    pub const FILE_NOT_FOUND: ErrorCode = 4001;
    pub const FILE_ACCESS_DENIED: ErrorCode = 4002;
    pub const FILE_ALREADY_EXISTS: ErrorCode = 4003;
    pub const DIRECTORY_NOT_FOUND: ErrorCode = 4004;
    pub const NOT_A_DIRECTORY: ErrorCode = 4005;
    pub const NOT_A_FILE: ErrorCode = 4006;
    pub const PATH_TRAVERSAL_BLOCKED: ErrorCode = 4007;
    pub const WRITE_PATH_BLOCKED: ErrorCode = 4008;
    pub const READ_PATH_BLOCKED: ErrorCode = 4009;
    pub const DISK_FULL: ErrorCode = 4010;
    pub const FILE_TOO_LARGE: ErrorCode = 4011;
    pub const INVALID_OFFSET: ErrorCode = 4012;
    pub const DELETE_FAILED: ErrorCode = 4013;
    pub const MKDIR_FAILED: ErrorCode = 4014;
    pub const RENAME_FAILED: ErrorCode = 4015;
    pub const SYMLINK_LOOP: ErrorCode = 4016;
}

/// Lifecycle Errors (5000-5999)
pub mod lifecycle {
    use super::*;

    pub const SHUTDOWN_FAILED: ErrorCode = 5001;
    pub const REBOOT_FAILED: ErrorCode = 5002;
    pub const PASSWORD_RESET_FAILED: ErrorCode = 5003;
    pub const NETWORK_CONFIG_FAILED: ErrorCode = 5004;
    pub const QUIESCE_FAILED: ErrorCode = 5005;
    pub const THAW_FAILED: ErrorCode = 5006;
    pub const ALREADY_QUIESCED: ErrorCode = 5007;
    pub const NOT_QUIESCED: ErrorCode = 5008;
    pub const TIME_SYNC_FAILED: ErrorCode = 5009;
    pub const INVALID_MOUNT_POINT: ErrorCode = 5010;
    pub const SCRIPT_EXECUTION_FAILED: ErrorCode = 5011;
}

/// Desktop Integration Errors (6000-6999)
pub mod desktop {
    use super::*;

    pub const DISPLAY_NOT_FOUND: ErrorCode = 6001;
    pub const RESOLUTION_NOT_SUPPORTED: ErrorCode = 6002;
    pub const DISPLAY_RESIZE_FAILED: ErrorCode = 6003;
    pub const CLIPBOARD_ACCESS_FAILED: ErrorCode = 6004;
    pub const CLIPBOARD_EMPTY: ErrorCode = 6005;
    pub const CLIPBOARD_TYPE_UNSUPPORTED: ErrorCode = 6006;
    pub const NO_DISPLAY_SERVER: ErrorCode = 6007;
    pub const XRANDR_NOT_FOUND: ErrorCode = 6008;
    pub const WAYLAND_NOT_SUPPORTED: ErrorCode = 6009;
    pub const IMAGE_ENCODING_FAILED: ErrorCode = 6010;
}

/// Process/Service Errors (7000-7999)
pub mod process_service {
    use super::*;

    pub const PROCESS_NOT_FOUND: ErrorCode = 7001;
    pub const KILL_FAILED: ErrorCode = 7002;
    pub const SERVICE_NOT_FOUND: ErrorCode = 7003;
    pub const SERVICE_START_FAILED: ErrorCode = 7004;
    pub const SERVICE_STOP_FAILED: ErrorCode = 7005;
    pub const SERVICE_ALREADY_RUNNING: ErrorCode = 7006;
    pub const SERVICE_NOT_RUNNING: ErrorCode = 7007;
    pub const SYSTEMCTL_NOT_FOUND: ErrorCode = 7008;
    pub const INVALID_SIGNAL: ErrorCode = 7009;
    pub const SERVICE_ENABLE_FAILED: ErrorCode = 7010;
}

/// Security Errors (8000-8999)
pub mod security {
    use super::*;

    pub const RATE_LIMIT_EXCEEDED: ErrorCode = 8001;
    pub const COMMAND_NOT_ALLOWED: ErrorCode = 8002;
    pub const PATH_NOT_ALLOWED: ErrorCode = 8003;
    pub const AUDIT_LOG_FAILED: ErrorCode = 8004;
    pub const AUTHENTICATION_FAILED: ErrorCode = 8005;
    pub const AUTHORIZATION_FAILED: ErrorCode = 8006;
}

/// Internal Errors (9000-9999)
pub mod internal {
    use super::*;

    pub const CONFIG_LOAD_FAILED: ErrorCode = 9001;
    pub const CONFIG_INVALID: ErrorCode = 9002;
    pub const INTERNAL_ERROR: ErrorCode = 9003;
    pub const UPDATE_FAILED: ErrorCode = 9004;
    pub const UPDATE_CHECKSUM_MISMATCH: ErrorCode = 9005;
    pub const ROLLBACK_FAILED: ErrorCode = 9006;
    pub const TELEMETRY_FAILED: ErrorCode = 9007;
    pub const HEALTH_CHECK_FAILED: ErrorCode = 9008;
}

// ============================================================================
// Error Builder
// ============================================================================

impl AgentError {
    /// Create a new error with the given code and message
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        let (category, name) = Self::code_info(code);
        Self {
            code,
            category,
            name,
            message: message.into(),
            context: None,
            resolution: None,
        }
    }

    /// Add context to the error
    pub fn with_context(mut self, context: impl Into<String>) -> Self {
        self.context = Some(context.into());
        self
    }

    /// Add resolution suggestion to the error
    pub fn with_resolution(mut self, resolution: impl Into<String>) -> Self {
        self.resolution = Some(resolution.into());
        self
    }

    /// Get category and name for an error code
    fn code_info(code: ErrorCode) -> (ErrorCategory, String) {
        match code {
            // Transport errors
            1001 => (ErrorCategory::Transport, "DEVICE_NOT_FOUND".into()),
            1002 => (ErrorCategory::Transport, "DEVICE_OPEN_FAILED".into()),
            1003 => (ErrorCategory::Transport, "CONNECTION_LOST".into()),
            1004 => (ErrorCategory::Transport, "WRITE_FAILED".into()),
            1005 => (ErrorCategory::Transport, "READ_FAILED".into()),
            1006 => (ErrorCategory::Transport, "DEVICE_BUSY".into()),
            1007 => (ErrorCategory::Transport, "VSOCK_UNAVAILABLE".into()),
            1008 => (ErrorCategory::Transport, "CONNECTION_TIMEOUT".into()),
            1009 => (ErrorCategory::Transport, "INVALID_DEVICE_PATH".into()),

            // Protocol errors
            2001 => (ErrorCategory::Protocol, "INVALID_MESSAGE".into()),
            2002 => (ErrorCategory::Protocol, "UNKNOWN_MESSAGE_TYPE".into()),
            2003 => (ErrorCategory::Protocol, "MESSAGE_TOO_LARGE".into()),
            2004 => (ErrorCategory::Protocol, "MISSING_PAYLOAD".into()),
            2005 => (ErrorCategory::Protocol, "INVALID_MESSAGE_ID".into()),
            2006 => (ErrorCategory::Protocol, "ENCODING_ERROR".into()),
            2007 => (ErrorCategory::Protocol, "DECODING_ERROR".into()),
            2008 => (ErrorCategory::Protocol, "CHECKSUM_MISMATCH".into()),

            // Execution errors
            3001 => (ErrorCategory::Execution, "COMMAND_NOT_FOUND".into()),
            3002 => (ErrorCategory::Execution, "PERMISSION_DENIED".into()),
            3003 => (ErrorCategory::Execution, "EXECUTION_TIMEOUT".into()),
            3004 => (ErrorCategory::Execution, "COMMAND_BLOCKED".into()),
            3005 => (ErrorCategory::Execution, "USER_NOT_FOUND".into()),
            3006 => (ErrorCategory::Execution, "GROUP_NOT_FOUND".into()),
            3007 => (ErrorCategory::Execution, "SETUID_FAILED".into()),
            3008 => (ErrorCategory::Execution, "WORKING_DIR_NOT_FOUND".into()),
            3009 => (ErrorCategory::Execution, "SPAWN_FAILED".into()),
            3010 => (ErrorCategory::Execution, "OUTPUT_TOO_LARGE".into()),

            // File operation errors
            4001 => (ErrorCategory::FileOperation, "FILE_NOT_FOUND".into()),
            4002 => (ErrorCategory::FileOperation, "FILE_ACCESS_DENIED".into()),
            4003 => (ErrorCategory::FileOperation, "FILE_ALREADY_EXISTS".into()),
            4004 => (ErrorCategory::FileOperation, "DIRECTORY_NOT_FOUND".into()),
            4005 => (ErrorCategory::FileOperation, "NOT_A_DIRECTORY".into()),
            4006 => (ErrorCategory::FileOperation, "NOT_A_FILE".into()),
            4007 => (ErrorCategory::FileOperation, "PATH_TRAVERSAL_BLOCKED".into()),
            4008 => (ErrorCategory::FileOperation, "WRITE_PATH_BLOCKED".into()),
            4009 => (ErrorCategory::FileOperation, "READ_PATH_BLOCKED".into()),
            4010 => (ErrorCategory::FileOperation, "DISK_FULL".into()),
            4011 => (ErrorCategory::FileOperation, "FILE_TOO_LARGE".into()),
            4012 => (ErrorCategory::FileOperation, "INVALID_OFFSET".into()),
            4013 => (ErrorCategory::FileOperation, "DELETE_FAILED".into()),
            4014 => (ErrorCategory::FileOperation, "MKDIR_FAILED".into()),
            4015 => (ErrorCategory::FileOperation, "RENAME_FAILED".into()),
            4016 => (ErrorCategory::FileOperation, "SYMLINK_LOOP".into()),

            // Lifecycle errors
            5001 => (ErrorCategory::Lifecycle, "SHUTDOWN_FAILED".into()),
            5002 => (ErrorCategory::Lifecycle, "REBOOT_FAILED".into()),
            5003 => (ErrorCategory::Lifecycle, "PASSWORD_RESET_FAILED".into()),
            5004 => (ErrorCategory::Lifecycle, "NETWORK_CONFIG_FAILED".into()),
            5005 => (ErrorCategory::Lifecycle, "QUIESCE_FAILED".into()),
            5006 => (ErrorCategory::Lifecycle, "THAW_FAILED".into()),
            5007 => (ErrorCategory::Lifecycle, "ALREADY_QUIESCED".into()),
            5008 => (ErrorCategory::Lifecycle, "NOT_QUIESCED".into()),
            5009 => (ErrorCategory::Lifecycle, "TIME_SYNC_FAILED".into()),
            5010 => (ErrorCategory::Lifecycle, "INVALID_MOUNT_POINT".into()),
            5011 => (ErrorCategory::Lifecycle, "SCRIPT_EXECUTION_FAILED".into()),

            // Desktop errors
            6001 => (ErrorCategory::Desktop, "DISPLAY_NOT_FOUND".into()),
            6002 => (ErrorCategory::Desktop, "RESOLUTION_NOT_SUPPORTED".into()),
            6003 => (ErrorCategory::Desktop, "DISPLAY_RESIZE_FAILED".into()),
            6004 => (ErrorCategory::Desktop, "CLIPBOARD_ACCESS_FAILED".into()),
            6005 => (ErrorCategory::Desktop, "CLIPBOARD_EMPTY".into()),
            6006 => (ErrorCategory::Desktop, "CLIPBOARD_TYPE_UNSUPPORTED".into()),
            6007 => (ErrorCategory::Desktop, "NO_DISPLAY_SERVER".into()),
            6008 => (ErrorCategory::Desktop, "XRANDR_NOT_FOUND".into()),
            6009 => (ErrorCategory::Desktop, "WAYLAND_NOT_SUPPORTED".into()),
            6010 => (ErrorCategory::Desktop, "IMAGE_ENCODING_FAILED".into()),

            // Process/Service errors
            7001 => (ErrorCategory::ProcessService, "PROCESS_NOT_FOUND".into()),
            7002 => (ErrorCategory::ProcessService, "KILL_FAILED".into()),
            7003 => (ErrorCategory::ProcessService, "SERVICE_NOT_FOUND".into()),
            7004 => (ErrorCategory::ProcessService, "SERVICE_START_FAILED".into()),
            7005 => (ErrorCategory::ProcessService, "SERVICE_STOP_FAILED".into()),
            7006 => (ErrorCategory::ProcessService, "SERVICE_ALREADY_RUNNING".into()),
            7007 => (ErrorCategory::ProcessService, "SERVICE_NOT_RUNNING".into()),
            7008 => (ErrorCategory::ProcessService, "SYSTEMCTL_NOT_FOUND".into()),
            7009 => (ErrorCategory::ProcessService, "INVALID_SIGNAL".into()),
            7010 => (ErrorCategory::ProcessService, "SERVICE_ENABLE_FAILED".into()),

            // Security errors
            8001 => (ErrorCategory::Security, "RATE_LIMIT_EXCEEDED".into()),
            8002 => (ErrorCategory::Security, "COMMAND_NOT_ALLOWED".into()),
            8003 => (ErrorCategory::Security, "PATH_NOT_ALLOWED".into()),
            8004 => (ErrorCategory::Security, "AUDIT_LOG_FAILED".into()),
            8005 => (ErrorCategory::Security, "AUTHENTICATION_FAILED".into()),
            8006 => (ErrorCategory::Security, "AUTHORIZATION_FAILED".into()),

            // Internal errors
            9001 => (ErrorCategory::Internal, "CONFIG_LOAD_FAILED".into()),
            9002 => (ErrorCategory::Internal, "CONFIG_INVALID".into()),
            9003 => (ErrorCategory::Internal, "INTERNAL_ERROR".into()),
            9004 => (ErrorCategory::Internal, "UPDATE_FAILED".into()),
            9005 => (ErrorCategory::Internal, "UPDATE_CHECKSUM_MISMATCH".into()),
            9006 => (ErrorCategory::Internal, "ROLLBACK_FAILED".into()),
            9007 => (ErrorCategory::Internal, "TELEMETRY_FAILED".into()),
            9008 => (ErrorCategory::Internal, "HEALTH_CHECK_FAILED".into()),

            // Unknown
            _ => (ErrorCategory::Internal, "UNKNOWN_ERROR".into()),
        }
    }

    /// Convert to JSON string
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            format!(r#"{{"code":{},"message":"{}"}}"#, self.code, self.message)
        })
    }

    /// Get the full error code string (QXGA-XXXX)
    pub fn code_string(&self) -> String {
        format!("QXGA-{:04}", self.code)
    }
}

// ============================================================================
// Convenience Constructors
// ============================================================================

/// Transport errors
impl AgentError {
    pub fn device_not_found(path: &str) -> Self {
        Self::new(transport::DEVICE_NOT_FOUND, format!("Virtio-serial device not found: {}", path))
            .with_resolution("Ensure VM has virtio-serial channel configured")
    }

    pub fn device_open_failed(path: &str, err: &str) -> Self {
        Self::new(transport::DEVICE_OPEN_FAILED, format!("Failed to open device {}: {}", path, err))
            .with_resolution("Check device permissions and ensure no other process is using it")
    }

    pub fn connection_lost() -> Self {
        Self::new(transport::CONNECTION_LOST, "Connection to host lost")
            .with_resolution("Agent will auto-reconnect")
    }
}

/// Execution errors
impl AgentError {
    pub fn command_not_found(cmd: &str) -> Self {
        Self::new(execution::COMMAND_NOT_FOUND, format!("Command not found: {}", cmd))
            .with_resolution("Check command path and ensure it's installed")
    }

    pub fn command_blocked(cmd: &str) -> Self {
        Self::new(execution::COMMAND_BLOCKED, format!("Command blocked by security policy: {}", cmd))
            .with_resolution("Check security.command_blocklist in agent.yaml")
    }

    pub fn execution_timeout(cmd: &str, timeout_secs: u32) -> Self {
        Self::new(execution::EXECUTION_TIMEOUT, format!("Command timed out after {}s: {}", timeout_secs, cmd))
            .with_resolution("Increase timeout or optimize command")
    }

    pub fn user_not_found(user: &str) -> Self {
        Self::new(execution::USER_NOT_FOUND, format!("User not found: {}", user))
            .with_resolution("Check run_as_user value")
    }
}

/// File operation errors
impl AgentError {
    pub fn file_not_found(path: &str) -> Self {
        Self::new(file_ops::FILE_NOT_FOUND, format!("File not found: {}", path))
    }

    pub fn file_access_denied(path: &str) -> Self {
        Self::new(file_ops::FILE_ACCESS_DENIED, format!("Access denied: {}", path))
            .with_resolution("Check file permissions")
    }

    pub fn path_traversal_blocked(path: &str) -> Self {
        Self::new(file_ops::PATH_TRAVERSAL_BLOCKED, format!("Path traversal detected: {}", path))
            .with_resolution("Remove ../ from path")
    }

    pub fn write_path_blocked(path: &str) -> Self {
        Self::new(file_ops::WRITE_PATH_BLOCKED, format!("Write to path blocked: {}", path))
            .with_resolution("Check security.allow_file_write_paths in agent.yaml")
    }

    pub fn read_path_blocked(path: &str) -> Self {
        Self::new(file_ops::READ_PATH_BLOCKED, format!("Read from path blocked: {}", path))
            .with_resolution("Check security.deny_file_read_paths in agent.yaml")
    }

    pub fn disk_full(path: &str) -> Self {
        Self::new(file_ops::DISK_FULL, format!("Disk full while writing: {}", path))
            .with_resolution("Free up disk space")
    }
}

/// Lifecycle errors
impl AgentError {
    pub fn quiesce_failed(mount_point: &str, err: &str) -> Self {
        Self::new(lifecycle::QUIESCE_FAILED, format!("Failed to quiesce {}: {}", mount_point, err))
    }

    pub fn thaw_failed(mount_point: &str, err: &str) -> Self {
        Self::new(lifecycle::THAW_FAILED, format!("Failed to thaw {}: {}", mount_point, err))
            .with_resolution("May need manual intervention with fsfreeze -u")
    }

    pub fn password_reset_failed(user: &str, err: &str) -> Self {
        Self::new(lifecycle::PASSWORD_RESET_FAILED, format!("Failed to reset password for {}: {}", user, err))
    }
}

/// Desktop errors
impl AgentError {
    pub fn display_not_found(display_id: &str) -> Self {
        Self::new(desktop::DISPLAY_NOT_FOUND, format!("Display not found: {}", display_id))
    }

    pub fn display_resize_failed(width: u32, height: u32, err: &str) -> Self {
        Self::new(desktop::DISPLAY_RESIZE_FAILED, format!("Failed to resize to {}x{}: {}", width, height, err))
    }

    pub fn clipboard_access_failed(err: &str) -> Self {
        Self::new(desktop::CLIPBOARD_ACCESS_FAILED, format!("Clipboard access failed: {}", err))
            .with_resolution("Check display server is running")
    }

    pub fn no_display_server() -> Self {
        Self::new(desktop::NO_DISPLAY_SERVER, "No display server running")
            .with_resolution("Start X11 or Wayland session")
    }
}

/// Process/Service errors
impl AgentError {
    pub fn process_not_found(pid: u32) -> Self {
        Self::new(process_service::PROCESS_NOT_FOUND, format!("Process not found: PID {}", pid))
    }

    pub fn kill_failed(pid: u32, err: &str) -> Self {
        Self::new(process_service::KILL_FAILED, format!("Failed to kill PID {}: {}", pid, err))
            .with_resolution("Check permissions")
    }

    pub fn service_not_found(name: &str) -> Self {
        Self::new(process_service::SERVICE_NOT_FOUND, format!("Service not found: {}", name))
    }

    pub fn service_control_failed(name: &str, action: &str, err: &str) -> Self {
        Self::new(process_service::SERVICE_START_FAILED, format!("Failed to {} service {}: {}", action, name, err))
    }
}

/// Security errors
impl AgentError {
    pub fn rate_limit_exceeded(operation: &str) -> Self {
        Self::new(security::RATE_LIMIT_EXCEEDED, format!("Rate limit exceeded for: {}", operation))
            .with_resolution("Wait and retry")
    }

    pub fn command_not_allowed(cmd: &str) -> Self {
        Self::new(security::COMMAND_NOT_ALLOWED, format!("Command not in allowlist: {}", cmd))
            .with_resolution("Add to security.command_allowlist in agent.yaml")
    }
}

/// Internal errors
impl AgentError {
    pub fn config_load_failed(path: &str, err: &str) -> Self {
        Self::new(internal::CONFIG_LOAD_FAILED, format!("Failed to load config from {}: {}", path, err))
    }

    pub fn config_invalid(field: &str, err: &str) -> Self {
        Self::new(internal::CONFIG_INVALID, format!("Invalid config field '{}': {}", field, err))
    }

    pub fn internal(msg: &str) -> Self {
        Self::new(internal::INTERNAL_ERROR, msg.to_string())
    }

    pub fn update_checksum_mismatch(expected: &str, actual: &str) -> Self {
        Self::new(internal::UPDATE_CHECKSUM_MISMATCH, format!("Checksum mismatch: expected {}, got {}", expected, actual))
    }
}

// ============================================================================
// Result Type Alias
// ============================================================================

/// Result type for agent operations
pub type AgentResult<T> = Result<T, AgentError>;

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = AgentError::file_not_found("/etc/hosts");
        assert_eq!(err.code_string(), "QXGA-4001");
        assert!(err.to_string().contains("FILE_NOT_FOUND"));
    }

    #[test]
    fn test_error_with_context() {
        let err = AgentError::command_blocked("rm -rf /")
            .with_context("Attempted by user root")
            .with_resolution("Remove from blocklist if needed");
        
        assert_eq!(err.code, execution::COMMAND_BLOCKED);
        assert!(err.context.is_some());
        assert!(err.resolution.is_some());
    }

    #[test]
    fn test_error_json() {
        let err = AgentError::device_not_found("/dev/virtio-ports/test");
        let json = err.to_json();
        assert!(json.contains("1001"));
        assert!(json.contains("DEVICE_NOT_FOUND"));
    }

    #[test]
    fn test_error_categories() {
        assert_eq!(AgentError::new(1001, "test").category, ErrorCategory::Transport);
        assert_eq!(AgentError::new(3001, "test").category, ErrorCategory::Execution);
        assert_eq!(AgentError::new(4001, "test").category, ErrorCategory::FileOperation);
        assert_eq!(AgentError::new(8001, "test").category, ErrorCategory::Security);
    }
}
