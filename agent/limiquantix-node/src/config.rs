//! Configuration management for the Node Daemon.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

use crate::cli::Args;

/// Main configuration structure.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Config {
    /// Node-specific configuration
    pub node: NodeConfig,
    /// gRPC server configuration
    pub server: ServerConfig,
    /// Hypervisor backend configuration
    pub hypervisor: HypervisorConfig,
    /// Control plane connection configuration
    pub control_plane: ControlPlaneConfig,
    /// TLS configuration
    pub tls: Option<TlsConfig>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            node: NodeConfig::default(),
            server: ServerConfig::default(),
            hypervisor: HypervisorConfig::default(),
            control_plane: ControlPlaneConfig::default(),
            tls: None,
        }
    }
}

impl Config {
    /// Load configuration from a YAML file.
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self> {
        let path = path.as_ref();
        
        if !path.exists() {
            return Err(anyhow::anyhow!("Config file not found: {}", path.display()));
        }
        
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read config file: {}", path.display()))?;
        
        let config: Config = serde_yaml::from_str(&content)
            .with_context(|| "Failed to parse config file")?;
        
        Ok(config)
    }
    
    /// Apply CLI argument overrides to the configuration.
    pub fn with_cli_overrides(mut self, args: &Args) -> Self {
        if let Some(ref listen) = args.listen {
            self.server.listen_address = listen.clone();
        }
        
        if let Some(ref control_plane) = args.control_plane {
            self.control_plane.address = control_plane.clone();
        }
        
        if let Some(ref node_id) = args.node_id {
            self.node.id = Some(node_id.clone());
        }
        
        if args.dev {
            self.hypervisor.backend = HypervisorBackend::Mock;
        }
        
        if args.register {
            self.control_plane.registration_enabled = true;
        }
        
        self
    }
}

/// Node-specific configuration.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct NodeConfig {
    /// Unique node ID (auto-generated if not set)
    pub id: Option<String>,
    /// Hostname (auto-detected if not set)
    pub hostname: Option<String>,
    /// Labels for node selection/affinity
    pub labels: HashMap<String, String>,
}

impl Default for NodeConfig {
    fn default() -> Self {
        Self {
            id: None,
            hostname: None,
            labels: HashMap::new(),
        }
    }
}

impl NodeConfig {
    /// Get the node ID, generating one if not set.
    pub fn get_id(&self) -> String {
        self.id.clone().unwrap_or_else(|| {
            uuid::Uuid::new_v4().to_string()
        })
    }
    
    /// Get the hostname, detecting it if not set.
    pub fn get_hostname(&self) -> String {
        self.hostname.clone().unwrap_or_else(|| {
            hostname::get()
                .map(|h| h.to_string_lossy().to_string())
                .unwrap_or_else(|_| "unknown".to_string())
        })
    }
}

/// Server configuration.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct ServerConfig {
    /// Address to listen on for gRPC
    pub listen_address: String,
    /// Port for Prometheus metrics
    pub metrics_port: u16,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            listen_address: "0.0.0.0:9090".to_string(),
            metrics_port: 9091,
        }
    }
}

/// Hypervisor backend configuration.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct HypervisorConfig {
    /// Backend type
    pub backend: HypervisorBackend,
    /// Libvirt connection URI
    pub libvirt_uri: Option<String>,
    /// Path for VM storage
    pub storage_path: String,
}

impl Default for HypervisorConfig {
    fn default() -> Self {
        Self {
            backend: HypervisorBackend::Mock,
            libvirt_uri: Some("qemu:///system".to_string()),
            storage_path: "/var/lib/limiquantix/vms".to_string(),
        }
    }
}

/// Hypervisor backend type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HypervisorBackend {
    /// Mock backend for testing/development
    Mock,
    /// Libvirt/QEMU backend
    Libvirt,
    /// Cloud Hypervisor backend (future)
    CloudHypervisor,
}

impl Default for HypervisorBackend {
    fn default() -> Self {
        Self::Mock
    }
}

/// Control plane connection configuration.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct ControlPlaneConfig {
    /// Control plane address
    pub address: String,
    /// Enable automatic registration
    pub registration_enabled: bool,
    /// Heartbeat interval in seconds
    pub heartbeat_interval_secs: u64,
}

impl Default for ControlPlaneConfig {
    fn default() -> Self {
        Self {
            address: "http://localhost:8080".to_string(),
            registration_enabled: false,
            heartbeat_interval_secs: 30,
        }
    }
}

/// TLS configuration.
#[derive(Debug, Clone, Deserialize)]
pub struct TlsConfig {
    /// Enable TLS
    pub enabled: bool,
    /// Path to certificate file
    pub cert_path: String,
    /// Path to private key file
    pub key_path: String,
    /// Path to CA certificate (for mutual TLS)
    pub ca_path: Option<String>,
}

