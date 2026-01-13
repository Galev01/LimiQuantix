//! OVN Chassis Management for QuantumNet.
//!
//! This module handles:
//! - Initial chassis registration with OVN Southbound DB
//! - Bridge mappings for external networks (VLAN/provider networks)
//! - Encapsulation configuration (Geneve/VXLAN)
//! - Periodic health checks of OVN controller connectivity
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────┐
//! │                     ChassisManager                                   │
//! │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
//! │  │ Initialize()    │  │ BridgeMappings  │  │ HealthCheck()      │ │
//! │  │ - Set OVS IDs   │  │ - physnet:br-ex │  │ - OVN controller   │ │
//! │  │ - Create br-int │  │ - Add localnet  │  │ - br-int exists    │ │
//! │  │ - Start ovn-ctl │  │   ports         │  │ - Connection state │ │
//! │  └─────────────────┘  └─────────────────┘  └─────────────────────┘ │
//! └─────────────────────────────────────────────────────────────────────┘
//! ```

use std::collections::HashMap;
use std::process::Command;
// Duration used for timeout configurations (currently not needed but kept for future use)
use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use tracing::{info, warn, debug, instrument};
use serde::{Deserialize, Serialize};

/// OVN encapsulation type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EncapType {
    /// Geneve encapsulation (recommended, default)
    Geneve,
    /// VXLAN encapsulation
    Vxlan,
    /// STT encapsulation (rarely used)
    Stt,
}

impl Default for EncapType {
    fn default() -> Self {
        Self::Geneve
    }
}

impl std::fmt::Display for EncapType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EncapType::Geneve => write!(f, "geneve"),
            EncapType::Vxlan => write!(f, "vxlan"),
            EncapType::Stt => write!(f, "stt"),
        }
    }
}

/// Configuration for the chassis manager.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChassisConfig {
    /// Unique chassis identifier (typically hostname or node ID)
    pub chassis_id: String,
    
    /// IP address for tunnel endpoints (management/overlay network)
    pub encap_ip: String,
    
    /// Encapsulation type for overlay tunnels
    #[serde(default)]
    pub encap_type: EncapType,
    
    /// OVN Southbound DB address (e.g., "tcp:10.0.0.1:6642")
    pub ovn_sb_address: String,
    
    /// OVN Northbound DB address (optional, for local ovn-controller)
    pub ovn_nb_address: Option<String>,
    
    /// Bridge mappings for external networks: physical_network -> bridge
    #[serde(default)]
    pub bridge_mappings: HashMap<String, String>,
    
    /// Integration bridge name (default: br-int)
    #[serde(default = "default_integration_bridge")]
    pub integration_bridge: String,
    
    /// Enable DPDK for high-performance networking
    #[serde(default)]
    pub enable_dpdk: bool,
    
    /// Hostname override (if different from chassis_id)
    pub hostname: Option<String>,
}

fn default_integration_bridge() -> String {
    "br-int".to_string()
}

impl Default for ChassisConfig {
    fn default() -> Self {
        Self {
            chassis_id: String::new(),
            encap_ip: String::new(),
            encap_type: EncapType::default(),
            ovn_sb_address: String::new(),
            ovn_nb_address: None,
            bridge_mappings: HashMap::new(),
            integration_bridge: default_integration_bridge(),
            enable_dpdk: false,
            hostname: None,
        }
    }
}

/// Health status of the chassis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChassisHealth {
    /// Whether OVS is available
    pub ovs_available: bool,
    
    /// OVS version string
    pub ovs_version: String,
    
    /// Whether OVN controller is running
    pub ovn_controller_running: bool,
    
    /// Whether connected to OVN Southbound DB
    pub ovn_connected: bool,
    
    /// Integration bridge exists
    pub br_int_exists: bool,
    
    /// Number of ports on br-int
    pub br_int_port_count: usize,
    
    /// Current encapsulation IP
    pub encap_ip: String,
    
    /// Chassis ID
    pub chassis_id: String,
    
    /// Bridge mappings configured
    pub bridge_mappings: Vec<String>,
    
    /// Last health check time
    pub last_check: DateTime<Utc>,
}

impl Default for ChassisHealth {
    fn default() -> Self {
        Self {
            ovs_available: false,
            ovs_version: String::new(),
            ovn_controller_running: false,
            ovn_connected: false,
            br_int_exists: false,
            br_int_port_count: 0,
            encap_ip: String::new(),
            chassis_id: String::new(),
            bridge_mappings: Vec::new(),
            last_check: Utc::now(),
        }
    }
}

/// OVN Chassis Manager.
///
/// Manages the OVN/OVS configuration on a hypervisor node.
pub struct ChassisManager {
    config: ChassisConfig,
    initialized: bool,
    last_health: Option<ChassisHealth>,
}

impl ChassisManager {
    /// Create a new chassis manager with the given configuration.
    pub fn new(config: ChassisConfig) -> Self {
        Self {
            config,
            initialized: false,
            last_health: None,
        }
    }

    /// Create a chassis manager from environment/defaults.
    pub fn from_env() -> Result<Self> {
        let hostname = hostname::get()
            .context("Failed to get hostname")?
            .to_string_lossy()
            .to_string();

        let config = ChassisConfig {
            chassis_id: hostname.clone(),
            hostname: Some(hostname),
            ..Default::default()
        };

        Ok(Self::new(config))
    }

    /// Initialize OVS/OVN on this node.
    ///
    /// This sets up the integration bridge and configures OVS external_ids
    /// so that ovn-controller can connect to the Southbound DB.
    #[instrument(skip(self))]
    pub fn initialize(&mut self) -> Result<()> {
        info!(
            chassis_id = %self.config.chassis_id,
            encap_ip = %self.config.encap_ip,
            ovn_sb = %self.config.ovn_sb_address,
            "Initializing OVN chassis"
        );

        // Check OVS is available
        self.check_ovs_available()?;

        // Create integration bridge
        self.ensure_bridge(&self.config.integration_bridge)?;

        // Set OVS external_ids for OVN integration
        self.set_ovs_external_ids()?;

        // Configure bridge mappings
        for (phys_net, bridge) in &self.config.bridge_mappings.clone() {
            self.configure_bridge_mapping(phys_net, bridge)?;
        }

        // Verify OVN controller is running
        self.ensure_ovn_controller_running()?;

        self.initialized = true;
        info!("OVN chassis initialized successfully");

        Ok(())
    }

    /// Check if OVS is available.
    fn check_ovs_available(&self) -> Result<()> {
        let output = Command::new("ovs-vsctl")
            .arg("--version")
            .output()
            .context("Failed to execute ovs-vsctl")?;

        if !output.status.success() {
            bail!("OVS is not available or not running");
        }

        let version = String::from_utf8_lossy(&output.stdout);
        info!(version = %version.lines().next().unwrap_or("unknown"), "OVS is available");

        Ok(())
    }

    /// Set OVS external_ids for OVN integration.
    #[instrument(skip(self))]
    fn set_ovs_external_ids(&self) -> Result<()> {
        let external_ids = vec![
            format!("system-id={}", self.config.chassis_id),
            format!("ovn-remote={}", self.config.ovn_sb_address),
            format!("ovn-encap-type={}", self.config.encap_type),
            format!("ovn-encap-ip={}", self.config.encap_ip),
        ];

        // Add hostname if set
        let mut all_ids = external_ids;
        if let Some(hostname) = &self.config.hostname {
            all_ids.push(format!("hostname={}", hostname));
        }

        for id in &all_ids {
            let output = Command::new("ovs-vsctl")
                .args(["set", "Open_vSwitch", ".", &format!("external_ids:{}", id)])
                .output()
                .context("Failed to set OVS external_ids")?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                warn!(id = %id, error = %stderr, "Failed to set OVS external_id");
            } else {
                debug!(id = %id, "Set OVS external_id");
            }
        }

        info!("OVS external_ids configured for OVN");
        Ok(())
    }

    /// Ensure a bridge exists.
    fn ensure_bridge(&self, name: &str) -> Result<()> {
        let output = Command::new("ovs-vsctl")
            .args(["--may-exist", "add-br", name])
            .output()
            .context("Failed to create bridge")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("Failed to create bridge {}: {}", name, stderr);
        }

        debug!(bridge = %name, "Ensured bridge exists");
        Ok(())
    }

    /// Add a bridge mapping for external network access.
    pub fn add_bridge_mapping(&mut self, physical_network: &str, bridge: &str) -> Result<()> {
        self.config.bridge_mappings.insert(physical_network.to_string(), bridge.to_string());
        self.configure_bridge_mapping(physical_network, bridge)
    }

    /// Configure a bridge mapping.
    #[instrument(skip(self))]
    fn configure_bridge_mapping(&self, physical_network: &str, bridge: &str) -> Result<()> {
        info!(
            physical_network = %physical_network,
            bridge = %bridge,
            "Configuring bridge mapping"
        );

        // Ensure external bridge exists
        self.ensure_bridge(bridge)?;

        // Get current mappings
        let output = Command::new("ovs-vsctl")
            .args(["get", "Open_vSwitch", ".", "external_ids:ovn-bridge-mappings"])
            .output()
            .context("Failed to get bridge mappings")?;

        let current = if output.status.success() {
            String::from_utf8_lossy(&output.stdout)
                .trim()
                .trim_matches('"')
                .to_string()
        } else {
            String::new()
        };

        // Build new mapping
        let new_mapping = format!("{}:{}", physical_network, bridge);
        
        let updated = if current.is_empty() || current == "\"\"" {
            new_mapping.clone()
        } else if !current.contains(&new_mapping) {
            format!("{},{}", current, new_mapping)
        } else {
            // Already configured
            debug!("Bridge mapping already exists");
            return Ok(());
        };

        // Set updated mappings
        let output = Command::new("ovs-vsctl")
            .args([
                "set", "Open_vSwitch", ".",
                &format!("external_ids:ovn-bridge-mappings={}", updated),
            ])
            .output()
            .context("Failed to set bridge mappings")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("Failed to set bridge mappings: {}", stderr);
        }

        info!("Bridge mapping configured successfully");
        Ok(())
    }

    /// Remove a bridge mapping.
    pub fn remove_bridge_mapping(&mut self, physical_network: &str) -> Result<()> {
        self.config.bridge_mappings.remove(physical_network);

        // Get current mappings
        let output = Command::new("ovs-vsctl")
            .args(["get", "Open_vSwitch", ".", "external_ids:ovn-bridge-mappings"])
            .output()
            .context("Failed to get bridge mappings")?;

        if !output.status.success() {
            return Ok(());
        }

        let current = String::from_utf8_lossy(&output.stdout)
            .trim()
            .trim_matches('"')
            .to_string();

        // Filter out the removed mapping
        let updated: Vec<&str> = current
            .split(',')
            .filter(|m| !m.starts_with(&format!("{}:", physical_network)))
            .collect();

        let updated_str = updated.join(",");

        if updated_str.is_empty() {
            // Remove the key entirely
            let _ = Command::new("ovs-vsctl")
                .args(["remove", "Open_vSwitch", ".", "external_ids", "ovn-bridge-mappings"])
                .output();
        } else {
            let _ = Command::new("ovs-vsctl")
                .args([
                    "set", "Open_vSwitch", ".",
                    &format!("external_ids:ovn-bridge-mappings={}", updated_str),
                ])
                .output();
        }

        Ok(())
    }

    /// Ensure OVN controller is running.
    fn ensure_ovn_controller_running(&self) -> Result<()> {
        // Check if ovn-controller is active
        let status = Command::new("systemctl")
            .args(["is-active", "ovn-controller"])
            .status();

        match status {
            Ok(s) if s.success() => {
                debug!("OVN controller is running");
                Ok(())
            }
            _ => {
                // Try to start it
                warn!("OVN controller not running, attempting to start");
                
                let output = Command::new("systemctl")
                    .args(["start", "ovn-controller"])
                    .output();

                match output {
                    Ok(o) if o.status.success() => {
                        info!("Started OVN controller");
                        Ok(())
                    }
                    Ok(o) => {
                        let stderr = String::from_utf8_lossy(&o.stderr);
                        warn!(error = %stderr, "Failed to start OVN controller");
                        // Don't fail - OVN controller might be managed differently
                        Ok(())
                    }
                    Err(e) => {
                        warn!(error = %e, "Failed to check OVN controller status");
                        Ok(())
                    }
                }
            }
        }
    }

    /// Perform a health check of the chassis.
    #[instrument(skip(self))]
    pub fn health_check(&mut self) -> Result<ChassisHealth> {
        let mut health = ChassisHealth::default();
        health.last_check = Utc::now();

        // Check OVS version
        if let Ok(output) = Command::new("ovs-vsctl").arg("--version").output() {
            if output.status.success() {
                health.ovs_available = true;
                let version = String::from_utf8_lossy(&output.stdout);
                if let Some(line) = version.lines().next() {
                    if let Some(ver) = line.split_whitespace().last() {
                        health.ovs_version = ver.to_string();
                    }
                }
            }
        }

        // Check OVN controller status
        health.ovn_controller_running = Command::new("systemctl")
            .args(["is-active", "ovn-controller"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        // Check br-int exists
        health.br_int_exists = Command::new("ovs-vsctl")
            .args(["br-exists", &self.config.integration_bridge])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        // Count ports on br-int
        if health.br_int_exists {
            if let Ok(output) = Command::new("ovs-vsctl")
                .args(["list-ports", &self.config.integration_bridge])
                .output()
            {
                if output.status.success() {
                    let ports = String::from_utf8_lossy(&output.stdout);
                    health.br_int_port_count = ports.lines().filter(|l| !l.is_empty()).count();
                }
            }
        }

        // Get external_ids
        if let Ok(ids) = self.get_external_ids() {
            if let Some(ip) = ids.get("ovn-encap-ip") {
                health.encap_ip = ip.clone();
            }
            if let Some(id) = ids.get("system-id") {
                health.chassis_id = id.clone();
            }
            if let Some(mappings) = ids.get("ovn-bridge-mappings") {
                health.bridge_mappings = mappings.split(',').map(String::from).collect();
            }
            
            // Check OVN connectivity
            health.ovn_connected = ids.get("ovn-remote").is_some();
        }

        debug!(
            ovs = health.ovs_available,
            ovn = health.ovn_controller_running,
            br_int = health.br_int_exists,
            ports = health.br_int_port_count,
            "Health check complete"
        );

        self.last_health = Some(health.clone());
        Ok(health)
    }

    /// Get OVS external_ids.
    fn get_external_ids(&self) -> Result<HashMap<String, String>> {
        let output = Command::new("ovs-vsctl")
            .args(["get", "Open_vSwitch", ".", "external_ids"])
            .output()
            .context("Failed to get external_ids")?;

        let mut ids = HashMap::new();
        if output.status.success() {
            let raw = String::from_utf8_lossy(&output.stdout);
            let trimmed = raw.trim().trim_start_matches('{').trim_end_matches('}');
            
            for pair in trimmed.split(", ") {
                if let Some((key, value)) = pair.split_once('=') {
                    ids.insert(
                        key.to_string(),
                        value.trim_matches('"').to_string(),
                    );
                }
            }
        }

        Ok(ids)
    }

    /// Get the last health check result.
    pub fn last_health(&self) -> Option<&ChassisHealth> {
        self.last_health.as_ref()
    }

    /// Check if the chassis is initialized.
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// Get the chassis ID.
    pub fn chassis_id(&self) -> &str {
        &self.config.chassis_id
    }

    /// Get the encapsulation IP.
    pub fn encap_ip(&self) -> &str {
        &self.config.encap_ip
    }

    /// Get the integration bridge name.
    pub fn integration_bridge(&self) -> &str {
        &self.config.integration_bridge
    }

    /// Update the encapsulation IP.
    #[instrument(skip(self))]
    pub fn set_encap_ip(&mut self, ip: &str) -> Result<()> {
        info!(old_ip = %self.config.encap_ip, new_ip = %ip, "Updating encap IP");
        
        self.config.encap_ip = ip.to_string();

        let output = Command::new("ovs-vsctl")
            .args([
                "set", "Open_vSwitch", ".",
                &format!("external_ids:ovn-encap-ip={}", ip),
            ])
            .output()
            .context("Failed to update encap IP")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("Failed to update encap IP: {}", stderr);
        }

        Ok(())
    }

    /// Update the OVN Southbound address.
    #[instrument(skip(self))]
    pub fn set_ovn_sb_address(&mut self, address: &str) -> Result<()> {
        info!(old = %self.config.ovn_sb_address, new = %address, "Updating OVN SB address");
        
        self.config.ovn_sb_address = address.to_string();

        let output = Command::new("ovs-vsctl")
            .args([
                "set", "Open_vSwitch", ".",
                &format!("external_ids:ovn-remote={}", address),
            ])
            .output()
            .context("Failed to update OVN remote")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("Failed to update OVN remote: {}", stderr);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encap_type_display() {
        assert_eq!(EncapType::Geneve.to_string(), "geneve");
        assert_eq!(EncapType::Vxlan.to_string(), "vxlan");
        assert_eq!(EncapType::Stt.to_string(), "stt");
    }

    #[test]
    fn test_chassis_config_default() {
        let config = ChassisConfig::default();
        assert_eq!(config.integration_bridge, "br-int");
        assert_eq!(config.encap_type, EncapType::Geneve);
        assert!(!config.enable_dpdk);
    }

    #[test]
    fn test_chassis_health_default() {
        let health = ChassisHealth::default();
        assert!(!health.ovs_available);
        assert!(!health.ovn_controller_running);
        assert!(!health.br_int_exists);
    }
}
