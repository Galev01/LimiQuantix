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
    
    /// Control plane address to register with
    #[arg(long)]
    pub control_plane: Option<String>,
    
    /// Libvirt connection URI (e.g., qemu:///system)
    #[arg(long, default_value = "qemu:///system")]
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
}

