//! Node configuration management

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Node configuration from /quantix/node.yaml
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodeConfig {
    /// Node UUID
    #[serde(default)]
    pub node_id: Option<String>,

    /// Node hostname
    #[serde(default)]
    pub hostname: Option<String>,

    /// Description
    #[serde(default)]
    pub description: Option<String>,

    /// Whether node has joined a cluster
    #[serde(default)]
    pub cluster_joined: bool,

    /// Control plane URL
    #[serde(default)]
    pub cluster_url: Option<String>,

    /// Network configuration
    #[serde(default)]
    pub network: NetworkConfig,
}

/// Network configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NetworkConfig {
    /// Management interface name
    #[serde(default)]
    pub interface: Option<String>,

    /// Network mode (dhcp or static)
    #[serde(default = "default_network_mode")]
    pub mode: String,

    /// Static IP address (CIDR notation)
    #[serde(default)]
    pub address: Option<String>,

    /// Gateway
    #[serde(default)]
    pub gateway: Option<String>,

    /// DNS servers
    #[serde(default)]
    pub dns: Vec<String>,

    /// VLAN ID (0 = untagged)
    #[serde(default)]
    pub vlan: u16,
}

fn default_network_mode() -> String {
    "dhcp".to_string()
}

impl NodeConfig {
    /// Load configuration from default path
    pub fn load() -> Result<Self> {
        Self::load_from("/quantix/node.yaml")
    }

    /// Load configuration from a specific path
    pub fn load_from<P: AsRef<Path>>(path: P) -> Result<Self> {
        let contents = std::fs::read_to_string(path.as_ref())?;
        let config: Self = serde_yaml::from_str(&contents)?;
        Ok(config)
    }

    /// Save configuration to default path
    pub fn save(&self) -> Result<()> {
        self.save_to("/quantix/node.yaml")
    }

    /// Save configuration to a specific path
    pub fn save_to<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let contents = serde_yaml::to_string(self)?;
        std::fs::write(path.as_ref(), contents)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = NodeConfig::default();
        assert!(config.node_id.is_none());
        assert!(!config.cluster_joined);
    }

    #[test]
    fn test_parse_yaml() {
        let yaml = r#"
node_id: "test-uuid"
hostname: "quantix-01"
cluster_joined: true
cluster_url: "https://control:6443"
network:
  interface: "eth0"
  mode: "static"
  address: "192.168.1.100/24"
  gateway: "192.168.1.1"
  dns:
    - "8.8.8.8"
"#;
        let config: NodeConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.node_id, Some("test-uuid".to_string()));
        assert_eq!(config.hostname, Some("quantix-01".to_string()));
        assert!(config.cluster_joined);
        assert_eq!(config.network.mode, "static");
    }
}
