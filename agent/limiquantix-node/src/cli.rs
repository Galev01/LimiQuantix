//! Command-line argument parsing.

use clap::Parser;

/// limiquantix Node Daemon - Hypervisor management agent
#[derive(Parser, Debug)]
#[command(name = "limiquantix-node")]
#[command(about = "limiquantix Node Daemon - Hypervisor management agent")]
#[command(version)]
pub struct Args {
    /// Path to configuration file (optional, defaults used if not found)
    #[arg(short, long)]
    pub config: Option<String>,
    
    /// Log level (trace, debug, info, warn, error)
    #[arg(short, long, default_value = "info")]
    pub log_level: String,
    
    /// Listen address for gRPC server
    #[arg(long, default_value = "0.0.0.0:9090")]
    pub listen: String,
    
    /// Listen address for HTTP server (Web UI + REST API)
    #[arg(long, default_value = "0.0.0.0:8080")]
    pub http_listen: String,
    
    /// Path to Web UI static files
    #[arg(long, default_value = "/usr/share/quantix-host-ui")]
    pub webui_path: String,
    
    /// Disable HTTP server (port 8080)
    #[arg(long)]
    pub no_http: bool,
    
    /// Control plane address to register with
    #[arg(long)]
    pub control_plane: Option<String>,
    
    /// Libvirt connection URI (e.g., qemu+unix:///system?socket=/var/run/libvirt/libvirt-sock)
    #[arg(long, default_value = "qemu+unix:///system?socket=/var/run/libvirt/libvirt-sock")]
    pub libvirt_uri: String,
    
    /// Node ID (auto-generated if not provided)
    #[arg(long)]
    pub node_id: Option<String>,
    
    /// Enable development mode (mock hypervisor)
    #[arg(long)]
    pub dev: bool,
    
    /// Enable automatic registration with control plane
    #[arg(long)]
    pub register: bool,
    
    // ========================================================================
    // HTTPS/TLS Configuration
    // ========================================================================
    
    /// Enable HTTPS server (port 8443 by default)
    #[arg(long)]
    pub enable_https: bool,
    
    /// Listen address for HTTPS server
    #[arg(long, default_value = "0.0.0.0:8443")]
    pub https_listen: String,
    
    /// Path to TLS certificate file
    #[arg(long, default_value = "/etc/limiquantix/certs/server.crt")]
    pub tls_cert: String,
    
    /// Path to TLS private key file
    #[arg(long, default_value = "/etc/limiquantix/certs/server.key")]
    pub tls_key: String,
    
    /// Enable HTTP (port 80) to HTTPS redirect
    #[arg(long)]
    pub redirect_http: bool,
    
    /// Port for HTTP→HTTPS redirect server (default: 80)
    #[arg(long, default_value = "80")]
    pub redirect_port: u16,
}
