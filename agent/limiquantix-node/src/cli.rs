//! Command-line argument parsing.

use clap::Parser;

/// LimiQuantix Node Daemon - Hypervisor management agent
#[derive(Parser, Debug)]
#[command(name = "limiquantix-node")]
#[command(about = "LimiQuantix Node Daemon - Hypervisor management agent")]
#[command(version)]
pub struct Args {
    /// Path to configuration file
    #[arg(short, long, default_value = "/etc/limiquantix/node.yaml")]
    pub config: String,
    
    /// Log level (trace, debug, info, warn, error)
    #[arg(short, long, default_value = "info")]
    pub log_level: String,
    
    /// Listen address for gRPC server
    #[arg(long)]
    pub listen: Option<String>,
    
    /// Control plane address to register with
    #[arg(long)]
    pub control_plane: Option<String>,
    
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

