//! Configuration management for the Quantix KVM Guest Agent.
//!
//! Supports loading configuration from YAML files with sensible defaults.
//! Configuration is loaded from platform-specific paths:
//! - Linux: `/etc/quantix-kvm/agent.yaml`
//! - Windows: `C:\ProgramData\Quantix-KVM\agent.yaml`

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{debug, info, warn};

/// Default configuration file paths
#[cfg(unix)]
pub const DEFAULT_CONFIG_PATH: &str = "/etc/quantix-kvm/agent.yaml";

#[cfg(windows)]
pub const DEFAULT_CONFIG_PATH: &str = r"C:\ProgramData\Quantix-KVM\agent.yaml";

/// Default log file paths
#[cfg(unix)]
pub const DEFAULT_LOG_PATH: &str = "/var/log/quantix-kvm/agent.log";

#[cfg(windows)]
pub const DEFAULT_LOG_PATH: &str = r"C:\ProgramData\Quantix-KVM\Logs\agent.log";

/// Default pre-freeze script directory
#[cfg(unix)]
pub const DEFAULT_PRE_FREEZE_DIR: &str = "/etc/quantix-kvm/pre-freeze.d";

#[cfg(windows)]
pub const DEFAULT_PRE_FREEZE_DIR: &str = r"C:\ProgramData\Quantix-KVM\pre-freeze.d";

/// Default post-thaw script directory
#[cfg(unix)]
pub const DEFAULT_POST_THAW_DIR: &str = "/etc/quantix-kvm/post-thaw.d";

#[cfg(windows)]
pub const DEFAULT_POST_THAW_DIR: &str = r"C:\ProgramData\Quantix-KVM\post-thaw.d";

/// Agent configuration loaded from YAML file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AgentConfig {
    /// Telemetry reporting interval in seconds
    pub telemetry_interval_secs: u64,

    /// Maximum command execution timeout in seconds
    pub max_exec_timeout_secs: u32,

    /// Maximum file chunk size in bytes
    pub max_chunk_size: usize,

    /// Log level (trace, debug, info, warn, error)
    pub log_level: String,

    /// Log format (json, pretty)
    pub log_format: LogFormat,

    /// Path to log file (empty = stdout only)
    pub log_file: String,

    /// Maximum log file size in bytes before rotation
    pub log_max_size_bytes: u64,

    /// Number of rotated log files to keep
    pub log_max_files: u32,

    /// Device path for virtio-serial (auto = auto-detect)
    pub device_path: String,

    /// Directory containing pre-freeze scripts
    pub pre_freeze_script_dir: String,

    /// Directory containing post-thaw scripts
    pub post_thaw_script_dir: String,

    /// Security configuration
    pub security: SecurityConfig,

    /// Health check configuration
    pub health: HealthConfig,
}

/// Log format options
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogFormat {
    Json,
    Pretty,
}

impl Default for LogFormat {
    fn default() -> Self {
        Self::Json
    }
}

/// Security configuration for command and file restrictions
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SecurityConfig {
    /// Commands that are explicitly allowed (empty = all allowed)
    pub command_allowlist: Vec<String>,

    /// Commands that are explicitly blocked
    pub command_blocklist: Vec<String>,

    /// Paths where file writes are allowed (empty = all allowed)
    pub allow_file_write_paths: Vec<String>,

    /// Paths where file reads are denied
    pub deny_file_read_paths: Vec<String>,

    /// Maximum commands per minute (0 = unlimited)
    pub max_commands_per_minute: u32,

    /// Maximum file operations per second (0 = unlimited)
    pub max_file_ops_per_second: u32,

    /// Enable audit logging for all operations
    pub audit_logging: bool,
}

/// Health check configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HealthConfig {
    /// Enable internal health monitoring
    pub enabled: bool,

    /// Health check interval in seconds
    pub interval_secs: u64,

    /// Maximum time without successful telemetry before unhealthy
    pub telemetry_timeout_secs: u64,
}

impl Default for HealthConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_secs: 30,
            telemetry_timeout_secs: 60,
        }
    }
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            telemetry_interval_secs: 5,
            max_exec_timeout_secs: 300,
            max_chunk_size: 65536,
            log_level: "info".to_string(),
            log_format: LogFormat::Json,
            log_file: String::new(), // Empty = stdout only
            log_max_size_bytes: 10 * 1024 * 1024, // 10MB
            log_max_files: 5,
            device_path: "auto".to_string(),
            pre_freeze_script_dir: DEFAULT_PRE_FREEZE_DIR.to_string(),
            post_thaw_script_dir: DEFAULT_POST_THAW_DIR.to_string(),
            security: SecurityConfig::default(),
            health: HealthConfig::default(),
        }
    }
}

impl AgentConfig {
    /// Load configuration from the default path or create default config
    pub fn load() -> Self {
        Self::load_from_path(DEFAULT_CONFIG_PATH)
    }

    /// Load configuration from a specific path
    pub fn load_from_path(path: &str) -> Self {
        let path = PathBuf::from(path);

        if !path.exists() {
            info!(
                path = %path.display(),
                "Config file not found, using defaults"
            );
            return Self::default();
        }

        match std::fs::read_to_string(&path) {
            Ok(contents) => match serde_yaml::from_str(&contents) {
                Ok(config) => {
                    info!(path = %path.display(), "Loaded configuration");
                    config
                }
                Err(e) => {
                    warn!(
                        path = %path.display(),
                        error = %e,
                        "Failed to parse config file, using defaults"
                    );
                    Self::default()
                }
            },
            Err(e) => {
                warn!(
                    path = %path.display(),
                    error = %e,
                    "Failed to read config file, using defaults"
                );
                Self::default()
            }
        }
    }

    /// Save configuration to a file (useful for generating default config)
    pub fn save_to_path(&self, path: &str) -> Result<(), std::io::Error> {
        let path = PathBuf::from(path);

        // Create parent directories if needed
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let yaml = serde_yaml::to_string(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

        std::fs::write(&path, yaml)?;
        info!(path = %path.display(), "Saved configuration");
        Ok(())
    }

    /// Validate the configuration
    pub fn validate(&self) -> Result<(), ConfigError> {
        // Validate telemetry interval
        if self.telemetry_interval_secs == 0 {
            return Err(ConfigError::InvalidValue {
                field: "telemetry_interval_secs".to_string(),
                message: "must be greater than 0".to_string(),
            });
        }

        // Validate max exec timeout
        if self.max_exec_timeout_secs == 0 {
            return Err(ConfigError::InvalidValue {
                field: "max_exec_timeout_secs".to_string(),
                message: "must be greater than 0".to_string(),
            });
        }

        // Validate chunk size
        if self.max_chunk_size == 0 || self.max_chunk_size > 10 * 1024 * 1024 {
            return Err(ConfigError::InvalidValue {
                field: "max_chunk_size".to_string(),
                message: "must be between 1 and 10MB".to_string(),
            });
        }

        // Validate log level
        let valid_levels = ["trace", "debug", "info", "warn", "error"];
        if !valid_levels.contains(&self.log_level.to_lowercase().as_str()) {
            return Err(ConfigError::InvalidValue {
                field: "log_level".to_string(),
                message: format!("must be one of: {:?}", valid_levels),
            });
        }

        Ok(())
    }

    /// Get the effective device path (resolve "auto" to actual path)
    pub fn get_device_path(&self) -> String {
        if self.device_path == "auto" {
            #[cfg(unix)]
            {
                "/dev/virtio-ports/org.quantix.agent.0".to_string()
            }
            #[cfg(windows)]
            {
                r"\\.\Global\org.quantix.agent.0".to_string()
            }
        } else {
            self.device_path.clone()
        }
    }

    /// Check if a command is allowed based on security config
    pub fn is_command_allowed(&self, command: &str) -> bool {
        // Check blocklist first
        for blocked in &self.security.command_blocklist {
            if command.contains(blocked) || command.starts_with(blocked) {
                debug!(command = %command, blocked = %blocked, "Command blocked");
                return false;
            }
        }

        // If allowlist is empty, all non-blocked commands are allowed
        if self.security.command_allowlist.is_empty() {
            return true;
        }

        // Check allowlist
        for allowed in &self.security.command_allowlist {
            if command.starts_with(allowed) {
                return true;
            }
        }

        debug!(command = %command, "Command not in allowlist");
        false
    }

    /// Check if a file path is allowed for reading
    pub fn is_file_read_allowed(&self, path: &str) -> bool {
        for denied in &self.security.deny_file_read_paths {
            if path.starts_with(denied) {
                debug!(path = %path, denied = %denied, "File read denied");
                return false;
            }
        }
        true
    }

    /// Check if a file path is allowed for writing
    pub fn is_file_write_allowed(&self, path: &str) -> bool {
        // If allowlist is empty, all paths are allowed
        if self.security.allow_file_write_paths.is_empty() {
            return true;
        }

        for allowed in &self.security.allow_file_write_paths {
            if path.starts_with(allowed) {
                return true;
            }
        }

        debug!(path = %path, "File write path not in allowlist");
        false
    }
}

/// Configuration errors
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("Invalid value for {field}: {message}")]
    InvalidValue { field: String, message: String },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AgentConfig::default();
        assert_eq!(config.telemetry_interval_secs, 5);
        assert_eq!(config.max_exec_timeout_secs, 300);
        assert_eq!(config.max_chunk_size, 65536);
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_config_validation() {
        let mut config = AgentConfig::default();

        // Invalid telemetry interval
        config.telemetry_interval_secs = 0;
        assert!(config.validate().is_err());
        config.telemetry_interval_secs = 5;

        // Invalid log level
        config.log_level = "invalid".to_string();
        assert!(config.validate().is_err());
        config.log_level = "info".to_string();

        // Valid config
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_command_allowlist() {
        let mut config = AgentConfig::default();

        // No restrictions by default
        assert!(config.is_command_allowed("any command"));

        // Add blocklist
        config.security.command_blocklist = vec!["/bin/rm".to_string()];
        assert!(!config.is_command_allowed("/bin/rm -rf /"));
        assert!(config.is_command_allowed("/bin/ls"));

        // Add allowlist
        config.security.command_allowlist = vec!["/usr/bin/".to_string()];
        assert!(config.is_command_allowed("/usr/bin/systemctl"));
        assert!(!config.is_command_allowed("/bin/ls")); // Not in allowlist
    }

    #[test]
    fn test_yaml_serialization() {
        let config = AgentConfig::default();
        let yaml = serde_yaml::to_string(&config).unwrap();
        let parsed: AgentConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(config.telemetry_interval_secs, parsed.telemetry_interval_secs);
    }
}
