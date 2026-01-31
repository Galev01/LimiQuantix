//! # limiquantix Node Daemon
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

mod agent_client;
mod chassis;
mod cli;
mod config;
mod event_store;
pub mod frr;
pub mod health_check;
mod http_server;
mod iso_manager;
mod registration;
mod server;
mod service;
mod state_watcher;
mod tls;
pub mod update;
pub mod wireguard;

pub use chassis::{ChassisConfig, ChassisHealth, ChassisManager};

pub use agent_client::{AgentClient, AgentManager};

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
        "Starting limiquantix Node Daemon"
    );
    
    // Load configuration
    let config = match &args.config {
        Some(config_path) => {
            // Explicit config file provided
            match Config::load(config_path) {
                Ok(cfg) => {
                    info!(config_path = %config_path, "Configuration loaded");
                    cfg.with_cli_overrides(&args)
                }
                Err(e) => {
                    error!(error = %e, path = %config_path, "Failed to load configuration");
                    return Err(e);
                }
            }
        }
        None => {
            // Try default location, fall back to CLI-only config
            let default_path = "/etc/limiquantix/node.yaml";
            match Config::load(default_path) {
                Ok(cfg) => {
                    info!(config_path = %default_path, "Configuration loaded from default location");
                    cfg.with_cli_overrides(&args)
                }
                Err(_) => {
                    info!("No config file found, using CLI arguments and defaults");
                    Config::default_with_cli(&args)
                }
            }
        }
    };
    
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

