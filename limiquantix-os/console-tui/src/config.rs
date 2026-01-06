//! Configuration module for Quantix-OS Console TUI

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const ADMIN_CONFIG_PATH: &str = "/quantix/admin.yaml";

/// Admin account configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminConfig {
    pub username: String,
    pub password_hash: String,
    pub ssh_enabled: bool,
    pub created_at: DateTime<Utc>,
    pub last_login: Option<DateTime<Utc>>,
    pub failed_attempts: u32,
    pub last_failed_at: Option<DateTime<Utc>>,
}

impl Default for AdminConfig {
    fn default() -> Self {
        Self {
            username: "admin".to_string(),
            password_hash: String::new(),
            ssh_enabled: false,
            created_at: Utc::now(),
            last_login: None,
            failed_attempts: 0,
            last_failed_at: None,
        }
    }
}

/// Load the admin configuration
pub fn load_admin_config() -> Result<AdminConfig> {
    if !Path::new(ADMIN_CONFIG_PATH).exists() {
        return Ok(AdminConfig::default());
    }

    let content = fs::read_to_string(ADMIN_CONFIG_PATH).context("Failed to read admin config")?;
    let config: AdminConfig =
        serde_yaml::from_str(&content).context("Failed to parse admin config")?;
    Ok(config)
}
