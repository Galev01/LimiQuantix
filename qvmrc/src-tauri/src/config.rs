//! Configuration management for QVMRC

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tracing::{info, warn};

/// Saved VM connection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    /// Unique identifier
    pub id: String,
    /// Display name
    pub name: String,
    /// Control plane URL (e.g., http://localhost:8080)
    pub control_plane_url: String,
    /// VM ID in the control plane
    pub vm_id: String,
    /// Last connected timestamp
    pub last_connected: Option<String>,
    /// Thumbnail image (base64)
    pub thumbnail: Option<String>,
}

/// Display settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplaySettings {
    /// Scale viewport to window size
    pub scale_viewport: bool,
    /// Show remote cursor
    pub show_remote_cursor: bool,
    /// Preferred encoding (tight, zrle, raw)
    pub preferred_encoding: String,
    /// Quality level (0-9)
    pub quality: u8,
    /// Compression level (0-9)
    pub compression: u8,
}

impl Default for DisplaySettings {
    fn default() -> Self {
        Self {
            scale_viewport: true,
            show_remote_cursor: true,
            preferred_encoding: "tight".to_string(),
            quality: 6,
            compression: 6,
        }
    }
}

/// Application configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Saved connections
    pub connections: Vec<SavedConnection>,
    /// Display settings
    pub display: DisplaySettings,
    /// Last used control plane URL
    pub last_control_plane_url: Option<String>,
    /// Window state
    pub window_width: Option<u32>,
    pub window_height: Option<u32>,
    pub window_maximized: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            connections: Vec::new(),
            display: DisplaySettings::default(),
            last_control_plane_url: None,
            window_width: Some(1024),
            window_height: Some(768),
            window_maximized: false,
        }
    }
}

impl Config {
    /// Get the config file path
    fn config_path() -> Option<PathBuf> {
        ProjectDirs::from("com", "limiquantix", "qvmrc")
            .map(|dirs| dirs.config_dir().join("config.toml"))
    }

    /// Load configuration from disk
    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let path = Self::config_path().ok_or("Could not determine config directory")?;
        
        if !path.exists() {
            info!("Config file not found, using defaults");
            return Ok(Self::default());
        }

        let content = fs::read_to_string(&path)?;
        let config: Config = toml::from_str(&content)?;
        
        info!("Loaded config from {:?}", path);
        Ok(config)
    }

    /// Save configuration to disk
    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let path = Self::config_path().ok_or("Could not determine config directory")?;
        
        // Create parent directories if needed
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let content = toml::to_string_pretty(self)?;
        fs::write(&path, content)?;
        
        info!("Saved config to {:?}", path);
        Ok(())
    }

    /// Add or update a saved connection
    /// Matches by id first, then by vm_id to avoid duplicates
    pub fn upsert_connection(&mut self, connection: SavedConnection) {
        // First check by ID
        if let Some(existing) = self.connections.iter_mut().find(|c| c.id == connection.id) {
            *existing = connection;
            return;
        }
        
        // Then check by vm_id to avoid duplicate VMs
        if let Some(existing) = self.connections.iter_mut().find(|c| c.vm_id == connection.vm_id) {
            *existing = connection;
            return;
        }
        
        // Otherwise add as new
        self.connections.push(connection);
    }

    /// Remove a saved connection
    pub fn remove_connection(&mut self, id: &str) {
        self.connections.retain(|c| c.id != id);
    }

    /// Get a saved connection by ID
    pub fn get_connection(&self, id: &str) -> Option<&SavedConnection> {
        self.connections.iter().find(|c| c.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert!(config.connections.is_empty());
        assert!(config.display.scale_viewport);
    }

    #[test]
    fn test_serialization() {
        let config = Config::default();
        let toml_str = toml::to_string(&config).unwrap();
        let parsed: Config = toml::from_str(&toml_str).unwrap();
        assert_eq!(parsed.display.quality, config.display.quality);
    }
}
