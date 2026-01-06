//! Configuration management for Quantix-OS Console
//!
//! Handles reading and writing configuration files in /quantix/

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tracing::{error, info};

/// Path to the setup complete marker
const SETUP_COMPLETE_MARKER: &str = "/quantix/.setup_complete";

/// Path to the node configuration
const NODE_CONFIG_PATH: &str = "/quantix/node.yaml";

/// Path to the admin configuration
const ADMIN_CONFIG_PATH: &str = "/quantix/admin.yaml";

/// Node configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeConfig {
    pub hostname: String,
    pub admin_username: String,
    #[serde(skip_serializing)]
    pub admin_password_hash: String,
    pub network_interface: String,
    pub use_dhcp: bool,
    pub static_ip: String,
    pub gateway: String,
    pub dns: String,
    pub ssh_enabled: bool,
}

impl Default for NodeConfig {
    fn default() -> Self {
        Self {
            hostname: "quantix".to_string(),
            admin_username: "admin".to_string(),
            admin_password_hash: String::new(),
            network_interface: String::new(),
            use_dhcp: true,
            static_ip: String::new(),
            gateway: String::new(),
            dns: "8.8.8.8".to_string(),
            ssh_enabled: false,
        }
    }
}

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

/// Check if the initial setup has been completed
pub fn is_setup_complete() -> bool {
    Path::new(SETUP_COMPLETE_MARKER).exists()
}

/// Mark the setup as complete
pub fn mark_setup_complete() -> Result<()> {
    // Ensure /quantix directory exists
    fs::create_dir_all("/quantix").context("Failed to create /quantix directory")?;

    // Create marker file
    fs::write(SETUP_COMPLETE_MARKER, Utc::now().to_rfc3339())
        .context("Failed to create setup complete marker")?;

    info!("✅ Setup marked as complete");
    Ok(())
}

/// Save the node configuration
pub fn save_config(config: &NodeConfig) -> Result<()> {
    // Ensure /quantix directory exists
    fs::create_dir_all("/quantix").context("Failed to create /quantix directory")?;

    // Save node config (without password hash)
    let node_yaml = serde_yaml::to_string(config).context("Failed to serialize node config")?;
    fs::write(NODE_CONFIG_PATH, node_yaml).context("Failed to write node config")?;

    // Save admin config (with password hash)
    let admin_config = AdminConfig {
        username: config.admin_username.clone(),
        password_hash: config.admin_password_hash.clone(),
        ssh_enabled: config.ssh_enabled,
        created_at: Utc::now(),
        last_login: None,
        failed_attempts: 0,
        last_failed_at: None,
    };
    save_admin_config(&admin_config)?;

    // Set hostname
    if let Err(e) = fs::write("/etc/hostname", &config.hostname) {
        error!("❌ Failed to write hostname: {}", e);
    }

    info!("✅ Configuration saved");
    Ok(())
}

/// Load the node configuration
pub fn load_config() -> Result<NodeConfig> {
    if !Path::new(NODE_CONFIG_PATH).exists() {
        return Ok(NodeConfig::default());
    }

    let content = fs::read_to_string(NODE_CONFIG_PATH).context("Failed to read node config")?;

    let config: NodeConfig =
        serde_yaml::from_str(&content).context("Failed to parse node config")?;

    Ok(config)
}

/// Save the admin configuration
pub fn save_admin_config(config: &AdminConfig) -> Result<()> {
    // Ensure /quantix directory exists
    fs::create_dir_all("/quantix").context("Failed to create /quantix directory")?;

    let yaml = serde_yaml::to_string(config).context("Failed to serialize admin config")?;

    fs::write(ADMIN_CONFIG_PATH, yaml).context("Failed to write admin config")?;

    // Set restrictive permissions
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(ADMIN_CONFIG_PATH, perms).ok();
    }

    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = NodeConfig::default();
        assert_eq!(config.hostname, "quantix");
        assert_eq!(config.admin_username, "admin");
        assert!(config.use_dhcp);
        assert!(!config.ssh_enabled);
    }

    #[test]
    fn test_admin_config_serialization() {
        let config = AdminConfig {
            username: "testuser".to_string(),
            password_hash: "$argon2id$v=19$m=19456,t=2,p=1$test".to_string(),
            ssh_enabled: true,
            created_at: Utc::now(),
            last_login: None,
            failed_attempts: 0,
            last_failed_at: None,
        };

        let yaml = serde_yaml::to_string(&config).unwrap();
        assert!(yaml.contains("testuser"));

        let parsed: AdminConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.username, "testuser");
    }
}
