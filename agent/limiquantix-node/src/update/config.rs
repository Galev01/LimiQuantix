//! Update configuration
//!
//! Configuration for the OTA update system, typically loaded from
//! /etc/limiquantix/node.yaml under the `updates` section.

use std::path::PathBuf;
use serde::{Deserialize, Serialize};

/// Update system configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateConfig {
    /// Whether updates are enabled
    #[serde(default = "default_enabled")]
    pub enabled: bool,

    /// URL of the update server
    #[serde(default = "default_server_url")]
    pub server_url: String,

    /// Update channel (dev, beta, stable)
    #[serde(default = "default_channel")]
    pub channel: String,

    /// How often to check for updates (e.g., "1h", "30m")
    #[serde(default = "default_check_interval")]
    pub check_interval: String,

    /// Whether to automatically apply updates without user confirmation
    #[serde(default)]
    pub auto_apply: bool,

    /// Whether to automatically reboot after updates that require it
    #[serde(default)]
    pub auto_reboot: bool,

    /// Directory to stage downloaded updates before applying
    #[serde(default = "default_staging_dir")]
    pub staging_dir: PathBuf,

    /// Directory for component backups
    #[serde(default = "default_backup_dir")]
    pub backup_dir: PathBuf,

    /// Maximum number of backups to keep per component
    #[serde(default = "default_max_backups")]
    pub max_backups: usize,
}

fn default_enabled() -> bool {
    true
}

fn default_server_url() -> String {
    // Default to local network for development
    "http://192.168.0.95:9000".to_string()
}

fn default_channel() -> String {
    "dev".to_string()
}

fn default_check_interval() -> String {
    "1h".to_string()
}

fn default_staging_dir() -> PathBuf {
    PathBuf::from("/data/updates/staging")
}

fn default_backup_dir() -> PathBuf {
    PathBuf::from("/data/updates/backup")
}

fn default_max_backups() -> usize {
    3
}

impl Default for UpdateConfig {
    fn default() -> Self {
        Self {
            enabled: default_enabled(),
            server_url: default_server_url(),
            channel: default_channel(),
            check_interval: default_check_interval(),
            auto_apply: false,
            auto_reboot: false,
            staging_dir: default_staging_dir(),
            backup_dir: default_backup_dir(),
            max_backups: default_max_backups(),
        }
    }
}

impl UpdateConfig {
    /// Parse check interval string to duration
    pub fn check_interval_duration(&self) -> std::time::Duration {
        parse_duration(&self.check_interval)
            .unwrap_or(std::time::Duration::from_secs(3600))
    }

    /// Validate configuration
    pub fn validate(&self) -> Result<(), String> {
        if self.server_url.is_empty() {
            return Err("Update server URL cannot be empty".to_string());
        }

        if !["dev", "beta", "stable"].contains(&self.channel.as_str()) {
            return Err(format!("Invalid channel '{}'. Must be dev, beta, or stable", self.channel));
        }

        if parse_duration(&self.check_interval).is_none() {
            return Err(format!("Invalid check interval '{}'. Use format like '1h', '30m', '1d'", self.check_interval));
        }

        Ok(())
    }
}

/// Parse a duration string like "1h", "30m", "1d"
fn parse_duration(s: &str) -> Option<std::time::Duration> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    let (num, unit) = s.split_at(s.len() - 1);
    let num: u64 = num.parse().ok()?;

    let seconds = match unit {
        "s" => num,
        "m" => num * 60,
        "h" => num * 3600,
        "d" => num * 86400,
        _ => return None,
    };

    Some(std::time::Duration::from_secs(seconds))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_duration() {
        assert_eq!(parse_duration("30s"), Some(std::time::Duration::from_secs(30)));
        assert_eq!(parse_duration("5m"), Some(std::time::Duration::from_secs(300)));
        assert_eq!(parse_duration("1h"), Some(std::time::Duration::from_secs(3600)));
        assert_eq!(parse_duration("1d"), Some(std::time::Duration::from_secs(86400)));
        assert_eq!(parse_duration("invalid"), None);
    }

    #[test]
    fn test_config_validation() {
        let mut config = UpdateConfig::default();
        assert!(config.validate().is_ok());

        config.channel = "invalid".to_string();
        assert!(config.validate().is_err());

        config.channel = "dev".to_string();
        config.check_interval = "invalid".to_string();
        assert!(config.validate().is_err());
    }
}
