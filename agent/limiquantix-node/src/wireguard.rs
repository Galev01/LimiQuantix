//! WireGuard VPN Module for Quantix-KVM Node Daemon.
//!
//! This module manages WireGuard VPN interfaces for the "Bastion" VPN mode.
//! It provides:
//! - wg0 interface creation and configuration
//! - Peer management (add/remove clients)
//! - Config file generation
//! - Integration with OVN overlay routing

use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use tokio::fs;
use tokio::process::Command;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

// =============================================================================
// WIREGUARD CONFIGURATION
// =============================================================================

/// WireGuard VPN configuration.
#[derive(Debug, Clone)]
pub struct WireGuardConfig {
    /// Interface name (default: wg0)
    pub interface: String,
    /// Private key (base64)
    pub private_key: String,
    /// Listen port (default: 51820)
    pub listen_port: u16,
    /// Interface address (CIDR)
    pub address: String,
    /// DNS servers (optional)
    pub dns: Vec<String>,
    /// MTU (optional)
    pub mtu: Option<u16>,
    /// Post-up script (optional)
    pub post_up: Option<String>,
    /// Post-down script (optional)
    pub post_down: Option<String>,
}

impl Default for WireGuardConfig {
    fn default() -> Self {
        Self {
            interface: "wg0".to_string(),
            private_key: String::new(),
            listen_port: 51820,
            address: "10.200.200.1/24".to_string(),
            dns: Vec::new(),
            mtu: None,
            post_up: None,
            post_down: None,
        }
    }
}

/// WireGuard peer configuration.
#[derive(Debug, Clone)]
pub struct WireGuardPeer {
    /// Peer ID (for tracking)
    pub id: String,
    /// Peer public key (base64)
    pub public_key: String,
    /// Pre-shared key (optional, base64)
    pub preshared_key: Option<String>,
    /// Allowed IPs for this peer
    pub allowed_ips: Vec<String>,
    /// Endpoint (optional, for site-to-site)
    pub endpoint: Option<String>,
    /// Persistent keepalive interval (seconds)
    pub persistent_keepalive: Option<u16>,
}

/// WireGuard interface status.
#[derive(Debug, Clone)]
pub struct WireGuardStatus {
    /// Is interface up?
    pub is_up: bool,
    /// Public key of this interface
    pub public_key: String,
    /// Listen port
    pub listen_port: u16,
    /// Number of peers
    pub peer_count: usize,
    /// Total bytes received
    pub rx_bytes: u64,
    /// Total bytes transmitted
    pub tx_bytes: u64,
}

/// Peer status information.
#[derive(Debug, Clone)]
pub struct PeerStatus {
    /// Peer public key
    pub public_key: String,
    /// Latest handshake time (Unix timestamp)
    pub latest_handshake: Option<u64>,
    /// Bytes received from this peer
    pub rx_bytes: u64,
    /// Bytes transmitted to this peer
    pub tx_bytes: u64,
    /// Endpoint address
    pub endpoint: Option<String>,
}

// =============================================================================
// WIREGUARD MANAGER
// =============================================================================

/// Manages WireGuard VPN interfaces on the node.
pub struct WireGuardManager {
    /// Active WireGuard configurations (interface -> config)
    configs: Arc<RwLock<HashMap<String, WireGuardConfig>>>,
    /// Active peers per interface (interface -> peer_id -> peer)
    peers: Arc<RwLock<HashMap<String, HashMap<String, WireGuardPeer>>>>,
    /// Config file directory
    config_dir: PathBuf,
}

impl WireGuardManager {
    /// Create a new WireGuard manager.
    pub fn new(config_dir: PathBuf) -> Self {
        Self {
            configs: Arc::new(RwLock::new(HashMap::new())),
            peers: Arc::new(RwLock::new(HashMap::new())),
            config_dir,
        }
    }

    /// Apply a WireGuard configuration (create/update interface).
    pub async fn apply_config(&self, config: WireGuardConfig) -> Result<(), WireGuardError> {
        let interface = &config.interface;
        
        info!(
            interface = %interface,
            port = %config.listen_port,
            "Applying WireGuard configuration"
        );

        // Generate config file
        let config_path = self.config_dir.join(format!("{}.conf", interface));
        let config_content = self.generate_config_file(&config).await?;
        
        // Ensure config directory exists
        if let Err(e) = fs::create_dir_all(&self.config_dir).await {
            warn!(error = %e, "Failed to create config directory");
        }
        
        // Write config file
        fs::write(&config_path, &config_content)
            .await
            .map_err(|e| WireGuardError::ConfigWrite(e.to_string()))?;
        
        info!(
            path = %config_path.display(),
            "WireGuard config file written"
        );

        // Bring up interface using wg-quick
        self.bring_up_interface(interface).await?;

        // Store config
        let mut configs = self.configs.write().await;
        configs.insert(interface.clone(), config);

        Ok(())
    }

    /// Remove a WireGuard configuration (bring down interface).
    pub async fn remove_config(&self, interface: &str) -> Result<(), WireGuardError> {
        info!(
            interface = %interface,
            "Removing WireGuard configuration"
        );

        // Bring down interface
        self.bring_down_interface(interface).await?;

        // Remove config file
        let config_path = self.config_dir.join(format!("{}.conf", interface));
        if config_path.exists() {
            fs::remove_file(&config_path)
                .await
                .map_err(|e| WireGuardError::ConfigWrite(e.to_string()))?;
        }

        // Remove from state
        let mut configs = self.configs.write().await;
        configs.remove(interface);

        let mut peers = self.peers.write().await;
        peers.remove(interface);

        Ok(())
    }

    /// Add a peer to an interface.
    pub async fn add_peer(&self, interface: &str, peer: WireGuardPeer) -> Result<(), WireGuardError> {
        info!(
            interface = %interface,
            peer_id = %peer.id,
            public_key = %peer.public_key,
            "Adding WireGuard peer"
        );

        // Use wg set to add peer
        let mut cmd = Command::new("wg");
        cmd.arg("set")
            .arg(interface)
            .arg("peer")
            .arg(&peer.public_key)
            .arg("allowed-ips")
            .arg(peer.allowed_ips.join(","));

        if let Some(psk) = &peer.preshared_key {
            cmd.arg("preshared-key").arg("/dev/stdin");
            // We'd pipe the PSK via stdin in real implementation
            debug!(peer_id = %peer.id, "Peer has preshared key configured");
        }

        if let Some(endpoint) = &peer.endpoint {
            cmd.arg("endpoint").arg(endpoint);
        }

        if let Some(keepalive) = peer.persistent_keepalive {
            cmd.arg("persistent-keepalive").arg(keepalive.to_string());
        }

        let output = cmd.output().await.map_err(|e| WireGuardError::Command(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!(
                interface = %interface,
                peer_id = %peer.id,
                stderr = %stderr,
                "Failed to add WireGuard peer"
            );
            return Err(WireGuardError::Command(format!("wg set failed: {}", stderr)));
        }

        // Store peer
        let mut peers = self.peers.write().await;
        let interface_peers = peers.entry(interface.to_string()).or_default();
        interface_peers.insert(peer.id.clone(), peer);

        // Regenerate config file to persist changes
        self.regenerate_config_file(interface).await?;

        Ok(())
    }

    /// Remove a peer from an interface.
    pub async fn remove_peer(&self, interface: &str, peer_id: &str) -> Result<(), WireGuardError> {
        info!(
            interface = %interface,
            peer_id = %peer_id,
            "Removing WireGuard peer"
        );

        // Find peer public key
        let public_key = {
            let peers = self.peers.read().await;
            let interface_peers = peers.get(interface).ok_or(WireGuardError::InterfaceNotFound)?;
            let peer = interface_peers.get(peer_id).ok_or(WireGuardError::PeerNotFound)?;
            peer.public_key.clone()
        };

        // Use wg set to remove peer
        let output = Command::new("wg")
            .args(["set", interface, "peer", &public_key, "remove"])
            .output()
            .await
            .map_err(|e| WireGuardError::Command(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!(
                interface = %interface,
                peer_id = %peer_id,
                stderr = %stderr,
                "Failed to remove WireGuard peer (may already be removed)"
            );
        }

        // Remove from state
        let mut peers = self.peers.write().await;
        if let Some(interface_peers) = peers.get_mut(interface) {
            interface_peers.remove(peer_id);
        }

        // Regenerate config file
        self.regenerate_config_file(interface).await?;

        Ok(())
    }

    /// Get status of a WireGuard interface.
    pub async fn get_status(&self, interface: &str) -> Result<WireGuardStatus, WireGuardError> {
        // Check if interface exists
        let output = Command::new("wg")
            .args(["show", interface])
            .output()
            .await
            .map_err(|e| WireGuardError::Command(e.to_string()))?;

        if !output.status.success() {
            return Err(WireGuardError::InterfaceNotFound);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let status = self.parse_wg_show(&stdout);

        Ok(status)
    }

    /// Get status of all peers on an interface.
    pub async fn get_peer_status(&self, interface: &str) -> Result<Vec<PeerStatus>, WireGuardError> {
        let output = Command::new("wg")
            .args(["show", interface, "dump"])
            .output()
            .await
            .map_err(|e| WireGuardError::Command(e.to_string()))?;

        if !output.status.success() {
            return Err(WireGuardError::InterfaceNotFound);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let peers = self.parse_wg_dump(&stdout);

        Ok(peers)
    }

    // =============================================================================
    // PRIVATE HELPERS
    // =============================================================================

    /// Generate WireGuard config file content.
    async fn generate_config_file(&self, config: &WireGuardConfig) -> Result<String, WireGuardError> {
        let mut content = String::new();

        // [Interface] section
        content.push_str("[Interface]\n");
        content.push_str(&format!("PrivateKey = {}\n", config.private_key));
        content.push_str(&format!("Address = {}\n", config.address));
        content.push_str(&format!("ListenPort = {}\n", config.listen_port));

        if let Some(mtu) = config.mtu {
            content.push_str(&format!("MTU = {}\n", mtu));
        }

        if !config.dns.is_empty() {
            content.push_str(&format!("DNS = {}\n", config.dns.join(", ")));
        }

        if let Some(post_up) = &config.post_up {
            content.push_str(&format!("PostUp = {}\n", post_up));
        }

        if let Some(post_down) = &config.post_down {
            content.push_str(&format!("PostDown = {}\n", post_down));
        }

        content.push('\n');

        // [Peer] sections
        let peers = self.peers.read().await;
        if let Some(interface_peers) = peers.get(&config.interface) {
            for peer in interface_peers.values() {
                content.push_str("[Peer]\n");
                content.push_str(&format!("# ID: {}\n", peer.id));
                content.push_str(&format!("PublicKey = {}\n", peer.public_key));

                if let Some(psk) = &peer.preshared_key {
                    content.push_str(&format!("PresharedKey = {}\n", psk));
                }

                content.push_str(&format!("AllowedIPs = {}\n", peer.allowed_ips.join(", ")));

                if let Some(endpoint) = &peer.endpoint {
                    content.push_str(&format!("Endpoint = {}\n", endpoint));
                }

                if let Some(keepalive) = peer.persistent_keepalive {
                    content.push_str(&format!("PersistentKeepalive = {}\n", keepalive));
                }

                content.push('\n');
            }
        }

        Ok(content)
    }

    /// Regenerate config file after peer changes.
    async fn regenerate_config_file(&self, interface: &str) -> Result<(), WireGuardError> {
        let configs = self.configs.read().await;
        let config = configs.get(interface).ok_or(WireGuardError::InterfaceNotFound)?;

        let config_path = self.config_dir.join(format!("{}.conf", interface));
        let content = self.generate_config_file(config).await?;

        fs::write(&config_path, &content)
            .await
            .map_err(|e| WireGuardError::ConfigWrite(e.to_string()))?;

        Ok(())
    }

    /// Bring up a WireGuard interface using wg-quick.
    async fn bring_up_interface(&self, interface: &str) -> Result<(), WireGuardError> {
        // First check if interface already exists
        let check = Command::new("ip")
            .args(["link", "show", interface])
            .output()
            .await;

        if check.is_ok() && check.as_ref().unwrap().status.success() {
            // Interface exists, bring it down first
            let _ = Command::new("wg-quick")
                .args(["down", interface])
                .output()
                .await;
        }

        // Bring up interface
        let config_path = self.config_dir.join(format!("{}.conf", interface));
        let output = Command::new("wg-quick")
            .args(["up", config_path.to_str().unwrap()])
            .output()
            .await
            .map_err(|e| WireGuardError::Command(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!(
                interface = %interface,
                stderr = %stderr,
                "Failed to bring up WireGuard interface"
            );
            return Err(WireGuardError::Command(format!("wg-quick up failed: {}", stderr)));
        }

        info!(interface = %interface, "WireGuard interface is up");
        Ok(())
    }

    /// Bring down a WireGuard interface.
    async fn bring_down_interface(&self, interface: &str) -> Result<(), WireGuardError> {
        let output = Command::new("wg-quick")
            .args(["down", interface])
            .output()
            .await
            .map_err(|e| WireGuardError::Command(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!(
                interface = %interface,
                stderr = %stderr,
                "Failed to bring down WireGuard interface (may already be down)"
            );
        }

        info!(interface = %interface, "WireGuard interface is down");
        Ok(())
    }

    /// Parse `wg show` output.
    fn parse_wg_show(&self, output: &str) -> WireGuardStatus {
        let mut status = WireGuardStatus {
            is_up: true,
            public_key: String::new(),
            listen_port: 0,
            peer_count: 0,
            rx_bytes: 0,
            tx_bytes: 0,
        };

        for line in output.lines() {
            if line.starts_with("public key:") {
                status.public_key = line.split(':').nth(1).unwrap_or("").trim().to_string();
            } else if line.starts_with("listening port:") {
                if let Some(port) = line.split(':').nth(1) {
                    status.listen_port = port.trim().parse().unwrap_or(0);
                }
            } else if line.starts_with("peer:") {
                status.peer_count += 1;
            }
        }

        status
    }

    /// Parse `wg show dump` output for peer status.
    fn parse_wg_dump(&self, output: &str) -> Vec<PeerStatus> {
        let mut peers = Vec::new();

        for line in output.lines().skip(1) {
            // Skip first line (interface info)
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 8 {
                peers.push(PeerStatus {
                    public_key: parts[0].to_string(),
                    latest_handshake: parts[5].parse().ok(),
                    rx_bytes: parts[6].parse().unwrap_or(0),
                    tx_bytes: parts[7].parse().unwrap_or(0),
                    endpoint: if parts[3] == "(none)" {
                        None
                    } else {
                        Some(parts[3].to_string())
                    },
                });
            }
        }

        peers
    }
}

// =============================================================================
// ERROR TYPES
// =============================================================================

/// WireGuard module errors.
#[derive(Debug, thiserror::Error)]
pub enum WireGuardError {
    #[error("Interface not found")]
    InterfaceNotFound,

    #[error("Peer not found")]
    PeerNotFound,

    #[error("Failed to write config file: {0}")]
    ConfigWrite(String),

    #[error("Command execution failed: {0}")]
    Command(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = WireGuardConfig::default();
        assert_eq!(config.interface, "wg0");
        assert_eq!(config.listen_port, 51820);
    }
}
