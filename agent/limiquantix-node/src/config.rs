//! Configuration management for the Node Daemon.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use crate::cli::Args;
use crate::tls::CertificateMode;

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
}

impl Default for Config {
    fn default() -> Self {
        Self {
            node: NodeConfig::default(),
            server: ServerConfig::default(),
            hypervisor: HypervisorConfig::default(),
            control_plane: ControlPlaneConfig::default(),
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
        // Always apply listen address from CLI
        self.server.listen_address = args.listen.clone();
        
        // HTTP server settings
        self.server.http.listen_address = args.http_listen.clone();
        self.server.http.webui_path = args.webui_path.clone();
        self.server.http.enabled = !args.no_http;
        
        // TLS/HTTPS settings
        if args.enable_https {
            self.server.http.tls.enabled = true;
        }
        self.server.http.tls.listen_address = args.https_listen.clone();
        self.server.http.tls.cert_path = args.tls_cert.clone();
        self.server.http.tls.key_path = args.tls_key.clone();
        
        // HTTP→HTTPS redirect (only when explicitly enabled)
        if args.redirect_http {
            self.server.http.tls.redirect_http = true;
        }
        self.server.http.tls.redirect_port = args.redirect_port;
        
        if let Some(ref control_plane) = args.control_plane {
            self.control_plane.address = control_plane.clone();
        }
        
        if let Some(ref node_id) = args.node_id {
            self.node.id = Some(node_id.clone());
        }
        
        // Apply libvirt URI
        self.hypervisor.libvirt_uri = Some(args.libvirt_uri.clone());
        
        if args.dev {
            self.hypervisor.backend = HypervisorBackend::Mock;
        } else {
            // If not dev mode, use libvirt backend
            self.hypervisor.backend = HypervisorBackend::Libvirt;
        }
        
        if args.register {
            self.control_plane.registration_enabled = true;
        }
        
        self
    }
    
    /// Create a default config (used when no config file is provided).
    pub fn default_with_cli(args: &Args) -> Self {
        Self::default().with_cli_overrides(args)
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
    /// HTTP server configuration (for Web UI)
    pub http: HttpServerConfig,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            listen_address: "0.0.0.0:9090".to_string(),
            metrics_port: 9091,
            http: HttpServerConfig::default(),
        }
    }
}

/// HTTP server configuration for Web UI.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct HttpServerConfig {
    /// Enable HTTP server for Web UI (port 8080 by default)
    pub enabled: bool,
    /// Address to listen on for HTTP (Web UI + REST API)
    pub listen_address: String,
    /// Path to static files for Web UI
    pub webui_path: String,
    /// TLS/HTTPS configuration (optional, runs on separate port)
    pub tls: TlsConfig,
}

impl Default for HttpServerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            listen_address: "0.0.0.0:8080".to_string(),
            webui_path: "/usr/share/quantix-host-ui".to_string(),
            tls: TlsConfig::default(),
        }
    }
}

/// TLS configuration for HTTPS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TlsConfig {
    /// Enable HTTPS server (runs on separate port from HTTP)
    pub enabled: bool,
    /// Address to listen on for HTTPS (default: 0.0.0.0:8443)
    pub listen_address: String,
    /// Redirect HTTP (port 80) to HTTPS - requires separate redirect server
    pub redirect_http: bool,
    /// Port for HTTP→HTTPS redirect server (default: 80)
    pub redirect_port: u16,
    /// Path to certificate file
    pub cert_path: String,
    /// Path to private key file
    pub key_path: String,
    /// Path to CA certificate (for mutual TLS)
    pub ca_path: Option<String>,
    /// Certificate mode
    pub mode: CertificateMode,
    /// Self-signed certificate configuration
    pub self_signed: SelfSignedConfig,
    /// ACME (Let's Encrypt) configuration
    pub acme: AcmeConfig,
}

impl Default for TlsConfig {
    fn default() -> Self {
        Self {
            enabled: false,  // HTTPS disabled by default, HTTP on 8080 is default
            listen_address: "0.0.0.0:8443".to_string(),
            redirect_http: false,  // Redirect disabled by default
            redirect_port: 80,
            cert_path: "/etc/limiquantix/certs/server.crt".to_string(),
            key_path: "/etc/limiquantix/certs/server.key".to_string(),
            ca_path: None,
            mode: CertificateMode::SelfSigned,
            self_signed: SelfSignedConfig::default(),
            acme: AcmeConfig::default(),
        }
    }
}

/// Self-signed certificate configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SelfSignedConfig {
    /// Common name for the certificate (defaults to hostname)
    pub common_name: Option<String>,
    /// Certificate validity in days
    pub validity_days: u32,
}

impl Default for SelfSignedConfig {
    fn default() -> Self {
        Self {
            common_name: None,
            validity_days: 365,
        }
    }
}

/// ACME (Let's Encrypt) configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AcmeConfig {
    /// Enable ACME certificate provisioning
    pub enabled: bool,
    /// Contact email for Let's Encrypt notifications
    pub email: Option<String>,
    /// ACME directory URL (defaults to Let's Encrypt production)
    pub directory_url: String,
    /// Domains to request certificates for
    pub domains: Vec<String>,
    /// Challenge type: "http-01" or "dns-01"
    pub challenge_type: String,
    /// Path to store ACME account credentials
    pub account_path: String,
    /// Enable automatic certificate renewal
    pub auto_renew: bool,
    /// Days before expiry to trigger renewal
    pub renew_before_days: u32,
}

impl Default for AcmeConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            email: None,
            directory_url: "https://acme-v02.api.letsencrypt.org/directory".to_string(),
            domains: Vec::new(),
            challenge_type: "http-01".to_string(),
            account_path: "/etc/limiquantix/certs/acme/account.json".to_string(),
            auto_renew: true,
            renew_before_days: 30,
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
    /// Path for cloud images
    pub images_path: String,
}

impl Default for HypervisorConfig {
    fn default() -> Self {
        Self {
            backend: HypervisorBackend::Mock,
            libvirt_uri: Some("qemu:///system".to_string()),
            storage_path: "/var/lib/limiquantix/vms".to_string(),
            images_path: "/var/lib/limiquantix/cloud-images".to_string(),
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
