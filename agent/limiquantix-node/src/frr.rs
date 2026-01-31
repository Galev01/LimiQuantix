//! FRRouting (FRR) Module for Quantix-KVM Node Daemon.
//!
//! This module manages FRRouting configuration for BGP peering with
//! Top-of-Rack (ToR) switches. It provides:
//! - frr.conf generation and management
//! - FRR daemon control (start/stop/reload)
//! - BGP peer and route advertisement configuration
//! - Status monitoring via vtysh

use std::path::PathBuf;
use std::process::Stdio;

use tokio::fs;
use tokio::process::Command;
use tracing::{debug, error, info, warn};

// =============================================================================
// FRR CONFIGURATION
// =============================================================================

/// FRR configuration for BGP speaker.
#[derive(Debug, Clone)]
pub struct FrrConfig {
    /// Hostname for FRR
    pub hostname: String,
    /// Local ASN
    pub local_asn: u32,
    /// Router ID (IPv4 address)
    pub router_id: String,
    /// BGP peers
    pub peers: Vec<FrrPeer>,
    /// Network prefixes to advertise
    pub networks: Vec<FrrNetwork>,
    /// Log level
    pub log_level: String,
}

impl Default for FrrConfig {
    fn default() -> Self {
        Self {
            hostname: "quantix-bgp".to_string(),
            local_asn: 0,
            router_id: String::new(),
            peers: Vec::new(),
            networks: Vec::new(),
            log_level: "informational".to_string(),
        }
    }
}

/// FRR BGP peer configuration.
#[derive(Debug, Clone)]
pub struct FrrPeer {
    /// Peer IP address
    pub peer_ip: String,
    /// Remote ASN
    pub remote_asn: u32,
    /// Description (optional)
    pub description: Option<String>,
    /// MD5 password (optional)
    pub password: Option<String>,
    /// Hold time (seconds)
    pub hold_time: Option<u32>,
    /// Keepalive interval (seconds)
    pub keepalive_interval: Option<u32>,
    /// Enable BFD
    pub bfd_enabled: bool,
}

/// FRR network advertisement.
#[derive(Debug, Clone)]
pub struct FrrNetwork {
    /// Network prefix (CIDR)
    pub prefix: String,
    /// Route-map (optional)
    pub route_map: Option<String>,
}

/// FRR daemon status.
#[derive(Debug, Clone)]
pub struct FrrStatus {
    /// Is FRR running?
    pub is_running: bool,
    /// BGP daemon status
    pub bgpd_running: bool,
    /// Number of established peers
    pub established_peers: u32,
    /// Total peers
    pub total_peers: u32,
    /// Routes advertised
    pub routes_advertised: u32,
    /// Routes received
    pub routes_received: u32,
}

/// FRR peer status.
#[derive(Debug, Clone)]
pub struct FrrPeerStatus {
    /// Peer IP
    pub peer_ip: String,
    /// Remote ASN
    pub remote_asn: u32,
    /// State (Idle, Connect, Active, OpenSent, OpenConfirm, Established)
    pub state: String,
    /// Prefixes received
    pub prefixes_received: u32,
    /// Prefixes sent
    pub prefixes_sent: u32,
    /// Uptime (seconds)
    pub uptime_seconds: u64,
}

// =============================================================================
// FRR MANAGER
// =============================================================================

/// Manages FRRouting on the node.
pub struct FrrManager {
    /// Path to FRR config directory
    config_dir: PathBuf,
    /// Path to vtysh binary
    vtysh_path: PathBuf,
}

impl FrrManager {
    /// Create a new FRR manager.
    pub fn new(config_dir: PathBuf) -> Self {
        Self {
            config_dir,
            vtysh_path: PathBuf::from("/usr/bin/vtysh"),
        }
    }

    /// Apply FRR configuration.
    pub async fn apply_config(&self, config: &FrrConfig) -> Result<(), FrrError> {
        info!(
            hostname = %config.hostname,
            asn = config.local_asn,
            "Applying FRR configuration"
        );

        // Ensure config directory exists
        if let Err(e) = fs::create_dir_all(&self.config_dir).await {
            warn!(error = %e, "Failed to create config directory");
        }

        // Generate frr.conf
        let frr_conf = self.generate_frr_conf(config);
        let frr_path = self.config_dir.join("frr.conf");

        fs::write(&frr_path, &frr_conf)
            .await
            .map_err(|e| FrrError::ConfigWrite(e.to_string()))?;

        info!(path = %frr_path.display(), "FRR config written");

        // Generate daemons file
        let daemons_conf = self.generate_daemons_conf();
        let daemons_path = self.config_dir.join("daemons");

        fs::write(&daemons_path, &daemons_conf)
            .await
            .map_err(|e| FrrError::ConfigWrite(e.to_string()))?;

        // Reload FRR
        self.reload_frr().await?;

        Ok(())
    }

    /// Remove FRR configuration and stop daemon.
    pub async fn remove_config(&self) -> Result<(), FrrError> {
        info!("Removing FRR configuration");

        // Stop FRR
        self.stop_frr().await?;

        // Remove config files
        let frr_path = self.config_dir.join("frr.conf");
        if frr_path.exists() {
            let _ = fs::remove_file(&frr_path).await;
        }

        Ok(())
    }

    /// Get FRR status.
    pub async fn get_status(&self) -> Result<FrrStatus, FrrError> {
        // Check if FRR is running
        let is_running = self.is_frr_running().await;

        if !is_running {
            return Ok(FrrStatus {
                is_running: false,
                bgpd_running: false,
                established_peers: 0,
                total_peers: 0,
                routes_advertised: 0,
                routes_received: 0,
            });
        }

        // Get BGP summary
        let summary = self.run_vtysh_command("show bgp summary json").await?;
        let status = self.parse_bgp_summary(&summary);

        Ok(status)
    }

    /// Get peer status.
    pub async fn get_peer_status(&self) -> Result<Vec<FrrPeerStatus>, FrrError> {
        if !self.is_frr_running().await {
            return Ok(Vec::new());
        }

        let output = self.run_vtysh_command("show bgp neighbors json").await?;
        let peers = self.parse_bgp_neighbors(&output);

        Ok(peers)
    }

    // =============================================================================
    // PRIVATE HELPERS
    // =============================================================================

    /// Generate frr.conf content.
    fn generate_frr_conf(&self, config: &FrrConfig) -> String {
        let mut conf = String::new();

        // Header
        conf.push_str("!\n");
        conf.push_str("! Quantix-KVM FRRouting Configuration\n");
        conf.push_str("! Auto-generated - do not edit manually\n");
        conf.push_str("!\n");
        conf.push_str(&format!("hostname {}\n", config.hostname));
        conf.push_str(&format!("log syslog {}\n", config.log_level));
        conf.push_str("!\n");

        // BGP configuration
        if config.local_asn > 0 {
            conf.push_str(&format!("router bgp {}\n", config.local_asn));
            conf.push_str(&format!(" bgp router-id {}\n", config.router_id));
            conf.push_str(" bgp log-neighbor-changes\n");
            conf.push_str(" no bgp default ipv4-unicast\n");
            conf.push_str(" !\n");

            // Peer configurations
            for peer in &config.peers {
                conf.push_str(&format!(
                    " neighbor {} remote-as {}\n",
                    peer.peer_ip, peer.remote_asn
                ));

                if let Some(desc) = &peer.description {
                    conf.push_str(&format!(" neighbor {} description {}\n", peer.peer_ip, desc));
                }

                if let Some(pwd) = &peer.password {
                    conf.push_str(&format!(" neighbor {} password {}\n", peer.peer_ip, pwd));
                }

                if let Some(hold) = peer.hold_time {
                    conf.push_str(&format!(
                        " neighbor {} timers {} {}\n",
                        peer.peer_ip,
                        peer.keepalive_interval.unwrap_or(hold / 3),
                        hold
                    ));
                }

                if peer.bfd_enabled {
                    conf.push_str(&format!(" neighbor {} bfd\n", peer.peer_ip));
                }
            }

            conf.push_str(" !\n");

            // Address family IPv4
            conf.push_str(" address-family ipv4 unicast\n");

            // Networks
            for network in &config.networks {
                if let Some(route_map) = &network.route_map {
                    conf.push_str(&format!(
                        "  network {} route-map {}\n",
                        network.prefix, route_map
                    ));
                } else {
                    conf.push_str(&format!("  network {}\n", network.prefix));
                }
            }

            // Activate peers
            for peer in &config.peers {
                conf.push_str(&format!("  neighbor {} activate\n", peer.peer_ip));
                conf.push_str(&format!(
                    "  neighbor {} soft-reconfiguration inbound\n",
                    peer.peer_ip
                ));
            }

            conf.push_str(" exit-address-family\n");
            conf.push_str("exit\n");
        }

        conf.push_str("!\n");
        conf.push_str("line vty\n");
        conf.push_str("!\n");
        conf.push_str("end\n");

        conf
    }

    /// Generate daemons file content.
    fn generate_daemons_conf(&self) -> String {
        r#"# FRRouting daemons configuration
# Auto-generated by Quantix-KVM

zebra=yes
bgpd=yes
ospfd=no
ospf6d=no
ripd=no
ripngd=no
isisd=no
pimd=no
ldpd=no
nhrpd=no
eigrpd=no
babeld=no
sharpd=no
staticd=no
pbrd=no
bfdd=no
fabricd=no

vtysh_enable=yes
zebra_options="  -A 127.0.0.1 -s 90000000"
bgpd_options="   -A 127.0.0.1"
"#
        .to_string()
    }

    /// Check if FRR is running.
    async fn is_frr_running(&self) -> bool {
        let output = Command::new("systemctl")
            .args(["is-active", "frr"])
            .output()
            .await;

        match output {
            Ok(o) => o.status.success(),
            Err(_) => {
                // Try pgrep for non-systemd systems
                let output = Command::new("pgrep").arg("bgpd").output().await;
                output.map(|o| o.status.success()).unwrap_or(false)
            }
        }
    }

    /// Reload FRR configuration.
    async fn reload_frr(&self) -> Result<(), FrrError> {
        info!("Reloading FRR");

        // Try systemctl first
        let output = Command::new("systemctl")
            .args(["reload", "frr"])
            .output()
            .await;

        if let Ok(o) = output {
            if o.status.success() {
                info!("FRR reloaded via systemctl");
                return Ok(());
            }
        }

        // Try rc-service for OpenRC
        let output = Command::new("rc-service")
            .args(["frr", "reload"])
            .output()
            .await;

        if let Ok(o) = output {
            if o.status.success() {
                info!("FRR reloaded via rc-service");
                return Ok(());
            }
        }

        // Last resort - restart
        warn!("Reload failed, attempting restart");
        self.start_frr().await
    }

    /// Start FRR daemon.
    async fn start_frr(&self) -> Result<(), FrrError> {
        info!("Starting FRR");

        // Try systemctl first
        let output = Command::new("systemctl")
            .args(["start", "frr"])
            .output()
            .await;

        if let Ok(o) = output {
            if o.status.success() {
                info!("FRR started via systemctl");
                return Ok(());
            }
        }

        // Try rc-service for OpenRC
        let output = Command::new("rc-service")
            .args(["frr", "start"])
            .output()
            .await;

        if let Ok(o) = output {
            if o.status.success() {
                info!("FRR started via rc-service");
                return Ok(());
            }
            let stderr = String::from_utf8_lossy(&o.stderr);
            error!(stderr = %stderr, "Failed to start FRR");
            return Err(FrrError::DaemonControl(stderr.to_string()));
        }

        Err(FrrError::DaemonControl("Failed to start FRR".to_string()))
    }

    /// Stop FRR daemon.
    async fn stop_frr(&self) -> Result<(), FrrError> {
        info!("Stopping FRR");

        // Try systemctl first
        let output = Command::new("systemctl")
            .args(["stop", "frr"])
            .output()
            .await;

        if let Ok(o) = output {
            if o.status.success() {
                info!("FRR stopped via systemctl");
                return Ok(());
            }
        }

        // Try rc-service for OpenRC
        let output = Command::new("rc-service")
            .args(["frr", "stop"])
            .output()
            .await;

        if let Ok(o) = output {
            if o.status.success() {
                info!("FRR stopped via rc-service");
                return Ok(());
            }
        }

        warn!("FRR may already be stopped");
        Ok(())
    }

    /// Run a vtysh command and return output.
    async fn run_vtysh_command(&self, cmd: &str) -> Result<String, FrrError> {
        let output = Command::new(&self.vtysh_path)
            .args(["-c", cmd])
            .output()
            .await
            .map_err(|e| FrrError::VtyshError(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(FrrError::VtyshError(stderr.to_string()));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Parse BGP summary JSON output.
    fn parse_bgp_summary(&self, json_output: &str) -> FrrStatus {
        // Basic parsing - in production would use serde_json
        let mut status = FrrStatus {
            is_running: true,
            bgpd_running: true,
            established_peers: 0,
            total_peers: 0,
            routes_advertised: 0,
            routes_received: 0,
        };

        // Count "Established" occurrences
        status.established_peers = json_output.matches("\"state\":\"Established\"").count() as u32;
        status.total_peers = json_output.matches("\"peerCount\":").count() as u32;

        status
    }

    /// Parse BGP neighbors JSON output.
    fn parse_bgp_neighbors(&self, _json_output: &str) -> Vec<FrrPeerStatus> {
        // Basic implementation - would parse JSON properly in production
        Vec::new()
    }
}

// =============================================================================
// ERROR TYPES
// =============================================================================

/// FRR module errors.
#[derive(Debug, thiserror::Error)]
pub enum FrrError {
    #[error("Failed to write config file: {0}")]
    ConfigWrite(String),

    #[error("Daemon control failed: {0}")]
    DaemonControl(String),

    #[error("vtysh command failed: {0}")]
    VtyshError(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_frr_conf() {
        let manager = FrrManager::new(PathBuf::from("/etc/frr"));
        let config = FrrConfig {
            hostname: "test-router".to_string(),
            local_asn: 65000,
            router_id: "10.0.0.1".to_string(),
            peers: vec![FrrPeer {
                peer_ip: "10.0.0.254".to_string(),
                remote_asn: 65001,
                description: Some("ToR Switch".to_string()),
                password: None,
                hold_time: Some(90),
                keepalive_interval: Some(30),
                bfd_enabled: false,
            }],
            networks: vec![FrrNetwork {
                prefix: "192.168.100.0/24".to_string(),
                route_map: None,
            }],
            log_level: "informational".to_string(),
        };

        let conf = manager.generate_frr_conf(&config);
        assert!(conf.contains("router bgp 65000"));
        assert!(conf.contains("neighbor 10.0.0.254"));
        assert!(conf.contains("network 192.168.100.0/24"));
    }
}
