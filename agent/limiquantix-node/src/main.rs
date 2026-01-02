//! # LimiQuantix Node Daemon
//!
//! The Node Daemon runs on each hypervisor host and manages virtual machines
//! through the hypervisor abstraction layer. It communicates with the control
//! plane via gRPC.
//!
//! ## Features
//! - VM lifecycle management (create, start, stop, delete)
//! - Snapshots and live migration
//! - Node telemetry collection
//! - Event streaming to control plane
//!
//! ## Usage
//! ```bash
//! limiquantix-node --config /etc/limiquantix/node.yaml
//! ```

use anyhow::Result;
use clap::Parser;
use tracing::{info, error};

mod cli;
mod config;
mod registration;
mod server;
mod service;

use cli::Args;
use config::Config;

#[tokio::main]
async fn main() -> Result<()> {
    // Parse CLI arguments
    let args = Args::parse();
    
    // Initialize logging
    limiquantix_common::init_logging(&args.log_level)?;
    
    info!(
        version = env!("CARGO_PKG_VERSION"),
        "Starting LimiQuantix Node Daemon"
    );
    
    // Load configuration
    let config = match Config::load(&args.config) {
        Ok(cfg) => {
            info!(config_path = %args.config, "Configuration loaded");
            cfg
        }
        Err(e) if args.config == "/etc/limiquantix/node.yaml" => {
            info!("No config file found, using defaults");
            Config::default()
        }
        Err(e) => {
            error!(error = %e, path = %args.config, "Failed to load configuration");
            return Err(e);
        }
    };
    
    // Override config with CLI args
    let config = config.with_cli_overrides(&args);
    
    info!(
        listen = %config.server.listen_address,
        hypervisor = ?config.hypervisor.backend,
        "Node daemon configured"
    );
    
    // Start gRPC server
    if let Err(e) = server::run(config).await {
        error!(error = %e, "Server failed");
        return Err(e);
    }
    
    Ok(())
}

