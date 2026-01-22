//! Update configuration
//!
//! Configuration for the OTA update system, typically loaded from
//! /etc/limiquantix/node.yaml under the `updates` section.

use std::path::PathBuf;
use serde::{Deserialize, Serialize};

/// Storage location for update downloads
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StorageLocation {
    /// Use local /data partition (default)
    #[default]
    Local,
    /// Use a dedicated storage volume
    Volume,
}

impl std::fmt::Display for StorageLocation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StorageLocation::Local => write!(f, "local"),
            StorageLocation::Volume => write!(f, "volume"),
        }
    }
}

impl std::str::FromStr for StorageLocation {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "local" => Ok(StorageLocation::Local),
            "volume" => Ok(StorageLocation::Volume),
            _ => Err(format!("Invalid storage location: '{}'. Must be 'local' or 'volume'", s)),
        }
    }
}

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

    /// Storage location for downloaded updates (local or volume)
    #[serde(default)]
    pub storage_location: StorageLocation,

    /// Path to dedicated volume for updates (when storage_location = volume)
    /// This is the mount path of the volume, e.g., "/mnt/updates-storage"
    #[serde(default)]
    pub volume_path: Option<String>,

    /// Directory to stage downloaded updates before applying
    /// When storage_location = volume, this is relative to volume_path
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
    // Default to HomeLab update server
    "http://192.168.0.251:9000".to_string()
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
            storage_location: StorageLocation::default(),
            volume_path: None,
            staging_dir: default_staging_dir(),
            backup_dir: default_backup_dir(),
            max_backups: default_max_backups(),
        }
    }
}

impl UpdateConfig {
    /// Get the effective staging directory based on storage location
    pub fn effective_staging_dir(&self) -> PathBuf {
        match self.storage_location {
            StorageLocation::Local => self.staging_dir.clone(),
            StorageLocation::Volume => {
                if let Some(ref vol_path) = self.volume_path {
                    PathBuf::from(vol_path).join("staging")
                } else {
                    // Fallback to local if volume path not set
                    self.staging_dir.clone()
                }
            }
        }
    }

    /// Get the effective backup directory based on storage location
    pub fn effective_backup_dir(&self) -> PathBuf {
        match self.storage_location {
            StorageLocation::Local => self.backup_dir.clone(),
            StorageLocation::Volume => {
                if let Some(ref vol_path) = self.volume_path {
                    PathBuf::from(vol_path).join("backup")
                } else {
                    // Fallback to local if volume path not set
                    self.backup_dir.clone()
                }
            }
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

        // Validate volume path if storage location is volume
        if self.storage_location == StorageLocation::Volume {
            if self.volume_path.is_none() || self.volume_path.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
                return Err("Volume path must be set when storage location is 'volume'".to_string());
            }
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
