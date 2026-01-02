# Node Daemon Implementation Plan

**Document ID:** 000031  
**Date:** 2026-01-02  
**Status:** In Progress  
**Related ADR:** [000007-hypervisor-integration.md](adr/000007-hypervisor-integration.md)  

---

## Executive Summary

This document provides a detailed implementation plan for the **limiquantix Node Daemon** - a Rust-based service that runs on each hypervisor node, manages VM lifecycle via libvirt/QEMU, and communicates with the Go control plane.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Control Plane (Go)                                │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ VM Service  │  │Node Service │  │  Scheduler  │  │  HA Manager │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │               │
└─────────┼────────────────┼────────────────┼────────────────┼───────────────┘
          │                │                │                │
          └────────────────┴────────────────┴────────────────┘
                                    │
                                    │ gRPC (TLS)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Node Daemon (Rust)                                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         gRPC Server                                  │   │
│  │              (NodeDaemonService implementation)                      │   │
│  └─────────────────────────────────┬───────────────────────────────────┘   │
│                                    │                                        │
│  ┌─────────────────────────────────┴───────────────────────────────────┐   │
│  │                      Core Engine                                     │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐            │   │
│  │  │  VM Manager   │  │Node Telemetry │  │ Event Stream  │            │   │
│  │  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘            │   │
│  └──────────┼──────────────────┼──────────────────┼────────────────────┘   │
│             │                  │                  │                         │
│  ┌──────────┴──────────────────┴──────────────────┴────────────────────┐   │
│  │                  Hypervisor Abstraction Layer                        │   │
│  │                                                                      │   │
│  │  ┌────────────────────────┐    ┌────────────────────────────┐       │   │
│  │  │    LibvirtBackend      │    │  CloudHypervisorBackend    │       │   │
│  │  │  (Primary - QEMU/KVM)  │    │    (Future - Linux only)   │       │   │
│  │  └───────────┬────────────┘    └─────────────┬──────────────┘       │   │
│  └──────────────┼───────────────────────────────┼──────────────────────┘   │
│                 │                               │                          │
└─────────────────┼───────────────────────────────┼──────────────────────────┘
                  │                               │
                  ▼                               ▼
         ┌────────────────┐             ┌─────────────────────┐
         │    libvirtd    │             │  cloud-hypervisor   │
         └────────────────┘             └─────────────────────┘
                  │                               │
                  └───────────────┬───────────────┘
                                  ▼
                        ┌─────────────────┐
                        │    Linux KVM    │
                        └─────────────────┘
```

---

## Project Structure

```
agent/
├── Cargo.toml                    # Workspace manifest
├── Cargo.lock
├── README.md
│
├── limiquantix-node/             # Node Daemon binary
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs               # Entry point
│       ├── config.rs             # Configuration management
│       ├── server.rs             # gRPC server setup
│       └── cli.rs                # CLI argument parsing
│
├── limiquantix-hypervisor/       # Hypervisor abstraction library
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── traits.rs             # Hypervisor trait definition
│       ├── types.rs              # Shared types (VmConfig, etc.)
│       ├── error.rs              # Error types
│       ├── libvirt/              # Libvirt backend
│       │   ├── mod.rs
│       │   ├── backend.rs        # LibvirtBackend implementation
│       │   ├── xml.rs            # XML generation for domains
│       │   └── convert.rs        # Type conversions
│       └── cloud_hypervisor/     # Cloud Hypervisor backend (future)
│           ├── mod.rs
│           └── backend.rs
│
├── limiquantix-telemetry/        # Node telemetry collection
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── cpu.rs                # CPU metrics
│       ├── memory.rs             # Memory metrics
│       ├── disk.rs               # Disk metrics
│       ├── network.rs            # Network metrics
│       └── system.rs             # System info (OS, kernel, etc.)
│
├── limiquantix-proto/            # Generated protobuf code
│   ├── Cargo.toml
│   ├── build.rs                  # Tonic code generation
│   └── src/
│       └── lib.rs
│
└── limiquantix-common/           # Shared utilities
    ├── Cargo.toml
    └── src/
        ├── lib.rs
        └── logging.rs            # Tracing setup
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal:** Basic project setup with working gRPC server skeleton.

#### 1.1 Project Initialization

```toml
# agent/Cargo.toml (workspace)
[workspace]
resolver = "2"
members = [
    "limiquantix-node",
    "limiquantix-hypervisor",
    "limiquantix-telemetry",
    "limiquantix-proto",
    "limiquantix-common",
]

[workspace.dependencies]
tokio = { version = "1.35", features = ["full"] }
tonic = "0.11"
prost = "0.12"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1.0"
anyhow = "1.0"
uuid = { version = "1.6", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
config = "0.14"
clap = { version = "4.4", features = ["derive"] }
```

#### 1.2 Proto Definitions for Node Daemon

Create new proto file for node daemon communication:

```protobuf
// proto/limiquantix/node/v1/node_daemon.proto

syntax = "proto3";

package limiquantix.node.v1;

import "google/protobuf/empty.proto";
import "google/protobuf/timestamp.proto";
import "limiquantix/compute/v1/vm.proto";
import "limiquantix/compute/v1/node.proto";

// NodeDaemonService - RPC interface for node daemon
// This is called by the control plane to manage VMs on this node.
service NodeDaemonService {
  // Health check
  rpc HealthCheck(HealthCheckRequest) returns (HealthCheckResponse);
  
  // VM Lifecycle
  rpc CreateVM(CreateVMOnNodeRequest) returns (CreateVMOnNodeResponse);
  rpc StartVM(VMIdRequest) returns (google.protobuf.Empty);
  rpc StopVM(StopVMRequest) returns (google.protobuf.Empty);
  rpc ForceStopVM(VMIdRequest) returns (google.protobuf.Empty);
  rpc RebootVM(VMIdRequest) returns (google.protobuf.Empty);
  rpc PauseVM(VMIdRequest) returns (google.protobuf.Empty);
  rpc ResumeVM(VMIdRequest) returns (google.protobuf.Empty);
  rpc DeleteVM(VMIdRequest) returns (google.protobuf.Empty);
  
  // VM Status
  rpc GetVMStatus(VMIdRequest) returns (VMStatusResponse);
  rpc ListVMs(google.protobuf.Empty) returns (ListVMsOnNodeResponse);
  
  // Console
  rpc GetConsole(VMIdRequest) returns (ConsoleInfoResponse);
  
  // Snapshots
  rpc CreateSnapshot(CreateSnapshotRequest) returns (SnapshotResponse);
  rpc RevertSnapshot(RevertSnapshotRequest) returns (google.protobuf.Empty);
  rpc DeleteSnapshot(DeleteSnapshotRequest) returns (google.protobuf.Empty);
  rpc ListSnapshots(VMIdRequest) returns (ListSnapshotsResponse);
  
  // Hot-plug operations
  rpc AttachDisk(AttachDiskRequest) returns (google.protobuf.Empty);
  rpc DetachDisk(DetachDiskRequest) returns (google.protobuf.Empty);
  rpc AttachNIC(AttachNICRequest) returns (google.protobuf.Empty);
  rpc DetachNIC(DetachNICRequest) returns (google.protobuf.Empty);
  
  // Migration
  rpc PrepareMigration(PrepareMigrationRequest) returns (MigrationToken);
  rpc ReceiveMigration(MigrationToken) returns (google.protobuf.Empty);
  rpc MigrateVM(MigrateVMRequest) returns (stream MigrationProgress);
  
  // Node Telemetry
  rpc GetNodeInfo(google.protobuf.Empty) returns (compute.v1.Node);
  rpc StreamMetrics(StreamMetricsRequest) returns (stream NodeMetrics);
  
  // Events
  rpc StreamEvents(google.protobuf.Empty) returns (stream NodeEvent);
}

// Request/Response Messages

message HealthCheckRequest {}

message HealthCheckResponse {
  bool healthy = 1;
  string version = 2;
  string hypervisor = 3;
  uint64 uptime_seconds = 4;
}

message VMIdRequest {
  string vm_id = 1;
}

message CreateVMOnNodeRequest {
  string vm_id = 1;
  string name = 2;
  compute.v1.VmSpec spec = 3;
  map<string, string> labels = 4;
}

message CreateVMOnNodeResponse {
  string vm_id = 1;
  bool created = 2;
}

message StopVMRequest {
  string vm_id = 1;
  uint32 timeout_seconds = 2;  // Graceful shutdown timeout
}

message VMStatusResponse {
  string vm_id = 1;
  compute.v1.PowerState state = 2;
  compute.v1.ResourceUsage resource_usage = 3;
}

message ListVMsOnNodeResponse {
  repeated VMStatusResponse vms = 1;
}

message ConsoleInfoResponse {
  string type = 1;  // "vnc" or "spice"
  string host = 2;
  uint32 port = 3;
  string password = 4;  // VNC password if set
  string websocket_path = 5;
}

message CreateSnapshotRequest {
  string vm_id = 1;
  string name = 2;
  string description = 3;
  bool quiesce = 4;  // Request guest agent to freeze filesystems
}

message SnapshotResponse {
  string snapshot_id = 1;
  string name = 2;
  google.protobuf.Timestamp created_at = 3;
}

message RevertSnapshotRequest {
  string vm_id = 1;
  string snapshot_id = 2;
}

message DeleteSnapshotRequest {
  string vm_id = 1;
  string snapshot_id = 2;
}

message ListSnapshotsResponse {
  repeated SnapshotResponse snapshots = 1;
}

message AttachDiskRequest {
  string vm_id = 1;
  compute.v1.DiskDevice disk = 2;
}

message DetachDiskRequest {
  string vm_id = 1;
  string disk_id = 2;
}

message AttachNICRequest {
  string vm_id = 1;
  compute.v1.NetworkInterface nic = 2;
}

message DetachNICRequest {
  string vm_id = 1;
  string nic_id = 2;
}

message PrepareMigrationRequest {
  string vm_id = 1;
  string target_node_uri = 2;
}

message MigrationToken {
  string token = 1;
  string vm_id = 2;
  google.protobuf.Timestamp expires_at = 3;
}

message MigrateVMRequest {
  string vm_id = 1;
  string target_node_uri = 2;
  bool live = 3;  // Live migration vs. cold migration
  bool storage = 4;  // Migrate storage too
}

message MigrationProgress {
  string vm_id = 1;
  uint32 percent_complete = 2;
  uint64 data_transferred_bytes = 3;
  uint64 data_remaining_bytes = 4;
  string phase = 5;  // "preparing", "transferring", "switching", "complete"
  string error = 6;
}

message StreamMetricsRequest {
  uint32 interval_seconds = 1;
}

message NodeMetrics {
  google.protobuf.Timestamp timestamp = 1;
  double cpu_usage_percent = 2;
  uint64 memory_used_bytes = 3;
  uint64 memory_total_bytes = 4;
  repeated DiskMetrics disks = 5;
  repeated NetworkMetrics networks = 6;
  repeated VMMetrics vms = 7;
}

message DiskMetrics {
  string device = 1;
  uint64 read_bytes = 2;
  uint64 write_bytes = 3;
  uint64 read_iops = 4;
  uint64 write_iops = 5;
}

message NetworkMetrics {
  string interface = 1;
  uint64 rx_bytes = 2;
  uint64 tx_bytes = 3;
  uint64 rx_packets = 4;
  uint64 tx_packets = 5;
}

message VMMetrics {
  string vm_id = 1;
  double cpu_usage_percent = 2;
  uint64 memory_used_bytes = 3;
  uint64 disk_read_bytes = 4;
  uint64 disk_write_bytes = 5;
  uint64 network_rx_bytes = 6;
  uint64 network_tx_bytes = 7;
}

message NodeEvent {
  string id = 1;
  google.protobuf.Timestamp timestamp = 2;
  
  enum EventType {
    VM_STARTED = 0;
    VM_STOPPED = 1;
    VM_CRASHED = 2;
    VM_MIGRATED = 3;
    SNAPSHOT_CREATED = 4;
    SNAPSHOT_REVERTED = 5;
    DISK_ATTACHED = 6;
    DISK_DETACHED = 7;
    NODE_OVERLOADED = 8;
    NODE_RECOVERED = 9;
  }
  EventType type = 3;
  
  string vm_id = 4;  // If event is VM-related
  string message = 5;
  map<string, string> metadata = 6;
}
```

#### 1.3 Rust Project Files

##### Main Entry Point

```rust
// agent/limiquantix-node/src/main.rs

use anyhow::Result;
use clap::Parser;
use tracing::{info, error};

mod cli;
mod config;
mod server;

use cli::Args;
use config::Config;

#[tokio::main]
async fn main() -> Result<()> {
    // Parse CLI arguments
    let args = Args::parse();
    
    // Initialize logging
    limiquantix_common::logging::init(&args.log_level)?;
    
    info!(
        version = env!("CARGO_PKG_VERSION"),
        "Starting limiquantix Node Daemon"
    );
    
    // Load configuration
    let config = Config::load(&args.config)?;
    info!(config_path = %args.config, "Configuration loaded");
    
    // Start gRPC server
    if let Err(e) = server::run(config).await {
        error!(error = %e, "Server failed");
        return Err(e);
    }
    
    Ok(())
}
```

##### CLI Arguments

```rust
// agent/limiquantix-node/src/cli.rs

use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "limiquantix-node")]
#[command(about = "limiquantix Node Daemon - Hypervisor management agent")]
#[command(version)]
pub struct Args {
    /// Path to configuration file
    #[arg(short, long, default_value = "/etc/limiquantix/node.yaml")]
    pub config: String,
    
    /// Log level (trace, debug, info, warn, error)
    #[arg(short, long, default_value = "info")]
    pub log_level: String,
    
    /// Listen address for gRPC server
    #[arg(long, default_value = "0.0.0.0:9090")]
    pub listen: String,
    
    /// Control plane address to register with
    #[arg(long)]
    pub control_plane: Option<String>,
    
    /// Node ID (auto-generated if not provided)
    #[arg(long)]
    pub node_id: Option<String>,
}
```

##### Configuration

```rust
// agent/limiquantix-node/src/config.rs

use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct Config {
    pub node: NodeConfig,
    pub server: ServerConfig,
    pub hypervisor: HypervisorConfig,
    pub control_plane: ControlPlaneConfig,
    pub tls: Option<TlsConfig>,
}

#[derive(Debug, Deserialize)]
pub struct NodeConfig {
    pub id: Option<String>,
    pub hostname: Option<String>,
    pub labels: std::collections::HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct ServerConfig {
    pub listen_address: String,
    pub metrics_port: u16,
}

#[derive(Debug, Deserialize)]
pub struct HypervisorConfig {
    pub backend: HypervisorBackend,
    pub libvirt_uri: Option<String>,
    pub storage_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HypervisorBackend {
    Libvirt,
    CloudHypervisor,
}

#[derive(Debug, Deserialize)]
pub struct ControlPlaneConfig {
    pub address: String,
    pub registration_enabled: bool,
    pub heartbeat_interval_secs: u64,
}

#[derive(Debug, Deserialize)]
pub struct TlsConfig {
    pub enabled: bool,
    pub cert_path: String,
    pub key_path: String,
    pub ca_path: Option<String>,
}

impl Config {
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self> {
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("Failed to read config file: {:?}", path.as_ref()))?;
        
        let config: Config = serde_yaml::from_str(&content)
            .with_context(|| "Failed to parse config file")?;
        
        Ok(config)
    }
}
```

##### gRPC Server

```rust
// agent/limiquantix-node/src/server.rs

use anyhow::Result;
use std::sync::Arc;
use tonic::transport::Server;
use tracing::info;

use limiquantix_hypervisor::{Hypervisor, LibvirtBackend};
use limiquantix_proto::node::v1::node_daemon_service_server::NodeDaemonServiceServer;

use crate::config::Config;

mod service;
use service::NodeDaemonServiceImpl;

pub async fn run(config: Config) -> Result<()> {
    // Initialize hypervisor backend
    let hypervisor: Arc<dyn Hypervisor> = match config.hypervisor.backend {
        crate::config::HypervisorBackend::Libvirt => {
            let uri = config.hypervisor.libvirt_uri.as_deref()
                .unwrap_or("qemu:///system");
            Arc::new(LibvirtBackend::new(uri).await?)
        }
        crate::config::HypervisorBackend::CloudHypervisor => {
            todo!("Cloud Hypervisor backend not yet implemented")
        }
    };
    
    // Create service implementation
    let service = NodeDaemonServiceImpl::new(hypervisor);
    
    // Build server
    let addr = config.server.listen_address.parse()?;
    
    info!(address = %addr, "Starting gRPC server");
    
    Server::builder()
        .add_service(NodeDaemonServiceServer::new(service))
        .serve(addr)
        .await?;
    
    Ok(())
}
```

---

### Phase 2: Hypervisor Abstraction (Week 2)

**Goal:** Working libvirt backend with basic VM lifecycle.

#### 2.1 Hypervisor Trait

```rust
// agent/limiquantix-hypervisor/src/traits.rs

use async_trait::async_trait;
use std::time::Duration;

use crate::error::HypervisorError;
use crate::types::*;

pub type Result<T> = std::result::Result<T, HypervisorError>;

/// Capabilities supported by a hypervisor backend
#[derive(Debug, Clone)]
pub struct HypervisorCapabilities {
    pub name: String,
    pub version: String,
    pub supports_live_migration: bool,
    pub supports_snapshots: bool,
    pub supports_hotplug: bool,
    pub supports_gpu_passthrough: bool,
    pub supports_nested_virtualization: bool,
    pub max_vcpus: u32,
    pub max_memory_bytes: u64,
}

/// Core hypervisor abstraction trait
#[async_trait]
pub trait Hypervisor: Send + Sync {
    // =========================================================================
    // Capabilities
    // =========================================================================
    
    /// Get hypervisor capabilities
    async fn capabilities(&self) -> Result<HypervisorCapabilities>;
    
    /// Check if hypervisor is healthy and connected
    async fn health_check(&self) -> Result<bool>;
    
    // =========================================================================
    // VM Lifecycle
    // =========================================================================
    
    /// Create a new VM (does not start it)
    async fn create_vm(&self, config: VmConfig) -> Result<String>;
    
    /// Start a VM
    async fn start_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Stop a VM with graceful shutdown
    async fn stop_vm(&self, vm_id: &str, timeout: Duration) -> Result<()>;
    
    /// Force stop a VM (power off)
    async fn force_stop_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Reboot a VM
    async fn reboot_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Pause a VM (freeze execution)
    async fn pause_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Resume a paused VM
    async fn resume_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Delete a VM (must be stopped first)
    async fn delete_vm(&self, vm_id: &str) -> Result<()>;
    
    // =========================================================================
    // VM Status
    // =========================================================================
    
    /// Get current VM status
    async fn get_vm_status(&self, vm_id: &str) -> Result<VmStatus>;
    
    /// List all VMs on this node
    async fn list_vms(&self) -> Result<Vec<VmInfo>>;
    
    /// Check if VM exists
    async fn vm_exists(&self, vm_id: &str) -> Result<bool>;
    
    // =========================================================================
    // Console
    // =========================================================================
    
    /// Get console connection information
    async fn get_console(&self, vm_id: &str) -> Result<ConsoleInfo>;
    
    // =========================================================================
    // Snapshots
    // =========================================================================
    
    /// Create a snapshot
    async fn create_snapshot(&self, vm_id: &str, name: &str, description: &str) -> Result<SnapshotInfo>;
    
    /// Revert to a snapshot
    async fn revert_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()>;
    
    /// Delete a snapshot
    async fn delete_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()>;
    
    /// List snapshots for a VM
    async fn list_snapshots(&self, vm_id: &str) -> Result<Vec<SnapshotInfo>>;
    
    // =========================================================================
    // Hot-plug Operations
    // =========================================================================
    
    /// Attach a disk to a running VM
    async fn attach_disk(&self, vm_id: &str, disk: DiskConfig) -> Result<()>;
    
    /// Detach a disk from a running VM
    async fn detach_disk(&self, vm_id: &str, disk_id: &str) -> Result<()>;
    
    /// Attach a network interface to a running VM
    async fn attach_nic(&self, vm_id: &str, nic: NicConfig) -> Result<()>;
    
    /// Detach a network interface from a running VM
    async fn detach_nic(&self, vm_id: &str, nic_id: &str) -> Result<()>;
    
    // =========================================================================
    // Migration
    // =========================================================================
    
    /// Migrate a VM to another host
    async fn migrate_vm(&self, vm_id: &str, target_uri: &str, live: bool) -> Result<()>;
    
    // =========================================================================
    // Metrics
    // =========================================================================
    
    /// Get VM resource usage metrics
    async fn get_vm_metrics(&self, vm_id: &str) -> Result<VmMetrics>;
}
```

#### 2.2 Types

```rust
// agent/limiquantix-hypervisor/src/types.rs

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// VM configuration for creation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmConfig {
    pub id: String,
    pub name: String,
    pub cpu: CpuConfig,
    pub memory: MemoryConfig,
    pub disks: Vec<DiskConfig>,
    pub nics: Vec<NicConfig>,
    pub boot: BootConfig,
    pub console: ConsoleConfig,
}

impl VmConfig {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            cpu: CpuConfig::default(),
            memory: MemoryConfig::default(),
            disks: Vec::new(),
            nics: Vec::new(),
            boot: BootConfig::default(),
            console: ConsoleConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuConfig {
    pub cores: u32,
    pub sockets: u32,
    pub threads_per_core: u32,
}

impl Default for CpuConfig {
    fn default() -> Self {
        Self {
            cores: 2,
            sockets: 1,
            threads_per_core: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryConfig {
    pub size_mib: u64,
    pub hugepages: bool,
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            size_mib: 2048,
            hugepages: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskConfig {
    pub id: String,
    pub path: String,
    pub size_gib: u64,
    pub bus: DiskBus,
    pub format: DiskFormat,
    pub readonly: bool,
    pub bootable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiskBus {
    Virtio,
    Scsi,
    Sata,
    Ide,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiskFormat {
    Qcow2,
    Raw,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NicConfig {
    pub id: String,
    pub mac_address: Option<String>,
    pub bridge: Option<String>,
    pub network: Option<String>,
    pub model: NicModel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NicModel {
    Virtio,
    E1000,
    Rtl8139,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootConfig {
    pub order: Vec<BootDevice>,
    pub firmware: Firmware,
}

impl Default for BootConfig {
    fn default() -> Self {
        Self {
            order: vec![BootDevice::Disk, BootDevice::Cdrom, BootDevice::Network],
            firmware: Firmware::Bios,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BootDevice {
    Disk,
    Cdrom,
    Network,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Firmware {
    Bios,
    Uefi,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleConfig {
    pub vnc_enabled: bool,
    pub vnc_port: Option<u16>,
    pub vnc_password: Option<String>,
    pub spice_enabled: bool,
}

impl Default for ConsoleConfig {
    fn default() -> Self {
        Self {
            vnc_enabled: true,
            vnc_port: None, // Auto-assign
            vnc_password: None,
            spice_enabled: false,
        }
    }
}

// =========================================================================
// Status Types
// =========================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmInfo {
    pub id: String,
    pub name: String,
    pub state: VmState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum VmState {
    Running,
    Stopped,
    Paused,
    Suspended,
    Crashed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmStatus {
    pub id: String,
    pub name: String,
    pub state: VmState,
    pub cpu_time_ns: u64,
    pub memory_rss_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleInfo {
    pub console_type: ConsoleType,
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConsoleType {
    Vnc,
    Spice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub state: VmState,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmMetrics {
    pub vm_id: String,
    pub cpu_usage_percent: f64,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub disk_read_bytes: u64,
    pub disk_write_bytes: u64,
    pub network_rx_bytes: u64,
    pub network_tx_bytes: u64,
}
```

#### 2.3 Libvirt Backend

```rust
// agent/limiquantix-hypervisor/src/libvirt/backend.rs

use async_trait::async_trait;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, info, warn, instrument};
use virt::connect::Connect;
use virt::domain::Domain;

use crate::error::HypervisorError;
use crate::traits::{Hypervisor, HypervisorCapabilities, Result};
use crate::types::*;

use super::xml::DomainXmlBuilder;

pub struct LibvirtBackend {
    uri: String,
    conn: Arc<RwLock<Connect>>,
}

impl LibvirtBackend {
    pub async fn new(uri: &str) -> Result<Self> {
        info!(uri = %uri, "Connecting to libvirt");
        
        let conn = Connect::open(uri)
            .map_err(|e| HypervisorError::ConnectionFailed(e.to_string()))?;
        
        let version = conn.get_lib_version()
            .map_err(|e| HypervisorError::ConnectionFailed(e.to_string()))?;
        
        info!(
            uri = %uri,
            version = %version,
            "Connected to libvirt"
        );
        
        Ok(Self {
            uri: uri.to_string(),
            conn: Arc::new(RwLock::new(conn)),
        })
    }
    
    async fn get_domain(&self, vm_id: &str) -> Result<Domain> {
        let conn = self.conn.read().await;
        Domain::lookup_by_uuid_string(&conn, vm_id)
            .map_err(|_| HypervisorError::VmNotFound(vm_id.to_string()))
    }
    
    fn map_domain_state(state: virt::domain::DomainState) -> VmState {
        use virt::domain::DomainState;
        match state {
            DomainState::VIR_DOMAIN_RUNNING => VmState::Running,
            DomainState::VIR_DOMAIN_PAUSED => VmState::Paused,
            DomainState::VIR_DOMAIN_SHUTDOWN | 
            DomainState::VIR_DOMAIN_SHUTOFF => VmState::Stopped,
            DomainState::VIR_DOMAIN_CRASHED => VmState::Crashed,
            DomainState::VIR_DOMAIN_PMSUSPENDED => VmState::Suspended,
            _ => VmState::Unknown,
        }
    }
}

#[async_trait]
impl Hypervisor for LibvirtBackend {
    #[instrument(skip(self))]
    async fn capabilities(&self) -> Result<HypervisorCapabilities> {
        let conn = self.conn.read().await;
        
        let caps_xml = conn.get_capabilities()
            .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
        
        let version = conn.get_lib_version()
            .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
        
        Ok(HypervisorCapabilities {
            name: "libvirt".to_string(),
            version: format!("{}.{}.{}", 
                version / 1_000_000,
                (version / 1_000) % 1_000,
                version % 1_000
            ),
            supports_live_migration: true,
            supports_snapshots: true,
            supports_hotplug: true,
            supports_gpu_passthrough: true,
            supports_nested_virtualization: true,
            max_vcpus: 512,
            max_memory_bytes: 16 * 1024 * 1024 * 1024 * 1024, // 16TB
        })
    }
    
    async fn health_check(&self) -> Result<bool> {
        let conn = self.conn.read().await;
        conn.get_lib_version()
            .map(|_| true)
            .map_err(|e| HypervisorError::ConnectionFailed(e.to_string()))
    }
    
    #[instrument(skip(self, config), fields(vm_id = %config.id, vm_name = %config.name))]
    async fn create_vm(&self, config: VmConfig) -> Result<String> {
        info!("Creating VM");
        
        // Generate libvirt domain XML
        let xml = DomainXmlBuilder::new(&config).build()?;
        debug!(xml = %xml, "Generated domain XML");
        
        // Define the domain
        let conn = self.conn.read().await;
        let domain = Domain::define_xml(&conn, &xml)
            .map_err(|e| HypervisorError::CreateFailed(e.to_string()))?;
        
        let uuid = domain.get_uuid_string()
            .map_err(|e| HypervisorError::CreateFailed(e.to_string()))?;
        
        info!(uuid = %uuid, "VM created successfully");
        
        Ok(uuid)
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn start_vm(&self, vm_id: &str) -> Result<()> {
        info!("Starting VM");
        
        let domain = self.get_domain(vm_id).await?;
        domain.create()
            .map_err(|e| HypervisorError::StartFailed(e.to_string()))?;
        
        info!("VM started successfully");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id, timeout_secs = timeout.as_secs()))]
    async fn stop_vm(&self, vm_id: &str, timeout: Duration) -> Result<()> {
        info!("Stopping VM gracefully");
        
        let domain = self.get_domain(vm_id).await?;
        
        // Try graceful shutdown first
        domain.shutdown()
            .map_err(|e| HypervisorError::StopFailed(e.to_string()))?;
        
        // Wait for shutdown
        let start = std::time::Instant::now();
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            
            let (state, _) = domain.get_state()
                .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
            
            if state == virt::domain::DomainState::VIR_DOMAIN_SHUTOFF {
                info!("VM stopped successfully");
                return Ok(());
            }
            
            if start.elapsed() > timeout {
                warn!("Graceful shutdown timed out, forcing stop");
                return self.force_stop_vm(vm_id).await;
            }
        }
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn force_stop_vm(&self, vm_id: &str) -> Result<()> {
        info!("Force stopping VM");
        
        let domain = self.get_domain(vm_id).await?;
        domain.destroy()
            .map_err(|e| HypervisorError::StopFailed(e.to_string()))?;
        
        info!("VM force stopped");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn reboot_vm(&self, vm_id: &str) -> Result<()> {
        info!("Rebooting VM");
        
        let domain = self.get_domain(vm_id).await?;
        domain.reboot(0)
            .map_err(|e| HypervisorError::OperationFailed(e.to_string()))?;
        
        info!("VM reboot initiated");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn pause_vm(&self, vm_id: &str) -> Result<()> {
        info!("Pausing VM");
        
        let domain = self.get_domain(vm_id).await?;
        domain.suspend()
            .map_err(|e| HypervisorError::OperationFailed(e.to_string()))?;
        
        info!("VM paused");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn resume_vm(&self, vm_id: &str) -> Result<()> {
        info!("Resuming VM");
        
        let domain = self.get_domain(vm_id).await?;
        domain.resume()
            .map_err(|e| HypervisorError::OperationFailed(e.to_string()))?;
        
        info!("VM resumed");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn delete_vm(&self, vm_id: &str) -> Result<()> {
        info!("Deleting VM");
        
        let domain = self.get_domain(vm_id).await?;
        
        // Check if running
        let (state, _) = domain.get_state()
            .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
        
        if state != virt::domain::DomainState::VIR_DOMAIN_SHUTOFF {
            return Err(HypervisorError::OperationFailed(
                "VM must be stopped before deletion".to_string()
            ));
        }
        
        // Undefine (delete) the domain
        domain.undefine()
            .map_err(|e| HypervisorError::DeleteFailed(e.to_string()))?;
        
        info!("VM deleted");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn get_vm_status(&self, vm_id: &str) -> Result<VmStatus> {
        let domain = self.get_domain(vm_id).await?;
        
        let (state, _) = domain.get_state()
            .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
        
        let name = domain.get_name()
            .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
        
        let info = domain.get_info()
            .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
        
        Ok(VmStatus {
            id: vm_id.to_string(),
            name,
            state: Self::map_domain_state(state),
            cpu_time_ns: info.cpu_time,
            memory_rss_bytes: info.memory * 1024, // libvirt reports in KB
        })
    }
    
    async fn list_vms(&self) -> Result<Vec<VmInfo>> {
        let conn = self.conn.read().await;
        
        // Get all domains (running and stopped)
        let flags = virt::connect::VIR_CONNECT_LIST_DOMAINS_ACTIVE
            | virt::connect::VIR_CONNECT_LIST_DOMAINS_INACTIVE;
        
        let domains = conn.list_all_domains(flags)
            .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
        
        let mut vms = Vec::with_capacity(domains.len());
        
        for domain in domains {
            let id = domain.get_uuid_string()
                .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
            let name = domain.get_name()
                .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
            let (state, _) = domain.get_state()
                .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
            
            vms.push(VmInfo {
                id,
                name,
                state: Self::map_domain_state(state),
            });
        }
        
        Ok(vms)
    }
    
    async fn vm_exists(&self, vm_id: &str) -> Result<bool> {
        match self.get_domain(vm_id).await {
            Ok(_) => Ok(true),
            Err(HypervisorError::VmNotFound(_)) => Ok(false),
            Err(e) => Err(e),
        }
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn get_console(&self, vm_id: &str) -> Result<ConsoleInfo> {
        let domain = self.get_domain(vm_id).await?;
        
        let xml = domain.get_xml_desc(0)
            .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
        
        // Parse XML to find VNC port
        // This is simplified - real implementation would use proper XML parsing
        if let Some(port_start) = xml.find("port='") {
            let port_str = &xml[port_start + 6..];
            if let Some(port_end) = port_str.find("'") {
                let port: u16 = port_str[..port_end].parse().unwrap_or(5900);
                return Ok(ConsoleInfo {
                    console_type: ConsoleType::Vnc,
                    host: "127.0.0.1".to_string(),
                    port,
                    password: None,
                });
            }
        }
        
        Err(HypervisorError::QueryFailed("Console not found".to_string()))
    }
    
    async fn create_snapshot(&self, vm_id: &str, name: &str, description: &str) -> Result<SnapshotInfo> {
        let domain = self.get_domain(vm_id).await?;
        
        let xml = format!(
            r#"<domainsnapshot>
                <name>{}</name>
                <description>{}</description>
            </domainsnapshot>"#,
            name, description
        );
        
        let snapshot = domain.snapshot_create_xml(&xml, 0)
            .map_err(|e| HypervisorError::SnapshotFailed(e.to_string()))?;
        
        let snap_name = snapshot.get_name()
            .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
        
        Ok(SnapshotInfo {
            id: snap_name.clone(),
            name: snap_name,
            description: description.to_string(),
            created_at: chrono::Utc::now(),
            state: VmState::Unknown,
            parent_id: None,
        })
    }
    
    async fn revert_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()> {
        let domain = self.get_domain(vm_id).await?;
        
        let snapshot = domain.snapshot_lookup_by_name(snapshot_id, 0)
            .map_err(|e| HypervisorError::SnapshotFailed(e.to_string()))?;
        
        snapshot.revert_to_snapshot(0)
            .map_err(|e| HypervisorError::SnapshotFailed(e.to_string()))?;
        
        Ok(())
    }
    
    async fn delete_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()> {
        let domain = self.get_domain(vm_id).await?;
        
        let snapshot = domain.snapshot_lookup_by_name(snapshot_id, 0)
            .map_err(|e| HypervisorError::SnapshotFailed(e.to_string()))?;
        
        snapshot.delete(0)
            .map_err(|e| HypervisorError::SnapshotFailed(e.to_string()))?;
        
        Ok(())
    }
    
    async fn list_snapshots(&self, vm_id: &str) -> Result<Vec<SnapshotInfo>> {
        let domain = self.get_domain(vm_id).await?;
        
        let snapshots = domain.list_all_snapshots(0)
            .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
        
        let mut result = Vec::with_capacity(snapshots.len());
        
        for snap in snapshots {
            let name = snap.get_name()
                .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
            
            result.push(SnapshotInfo {
                id: name.clone(),
                name,
                description: String::new(),
                created_at: chrono::Utc::now(), // Would parse from XML
                state: VmState::Unknown,
                parent_id: None,
            });
        }
        
        Ok(result)
    }
    
    async fn attach_disk(&self, vm_id: &str, disk: DiskConfig) -> Result<()> {
        let domain = self.get_domain(vm_id).await?;
        
        let xml = format!(
            r#"<disk type='file' device='disk'>
                <driver name='qemu' type='{}'/>
                <source file='{}'/>
                <target dev='vd{}' bus='virtio'/>
            </disk>"#,
            match disk.format {
                DiskFormat::Qcow2 => "qcow2",
                DiskFormat::Raw => "raw",
            },
            disk.path,
            (b'a' + domain.get_info().unwrap().nr_virt_cpu as u8) as char // Simplified
        );
        
        domain.attach_device(&xml)
            .map_err(|e| HypervisorError::OperationFailed(e.to_string()))?;
        
        Ok(())
    }
    
    async fn detach_disk(&self, vm_id: &str, disk_id: &str) -> Result<()> {
        let domain = self.get_domain(vm_id).await?;
        
        let xml = format!(
            r#"<disk type='file' device='disk'>
                <target dev='{}' bus='virtio'/>
            </disk>"#,
            disk_id
        );
        
        domain.detach_device(&xml)
            .map_err(|e| HypervisorError::OperationFailed(e.to_string()))?;
        
        Ok(())
    }
    
    async fn attach_nic(&self, vm_id: &str, nic: NicConfig) -> Result<()> {
        let domain = self.get_domain(vm_id).await?;
        
        let xml = format!(
            r#"<interface type='bridge'>
                <source bridge='{}'/>
                <model type='virtio'/>
                {}
            </interface>"#,
            nic.bridge.unwrap_or_else(|| "virbr0".to_string()),
            nic.mac_address.map(|m| format!("<mac address='{}'/>", m)).unwrap_or_default()
        );
        
        domain.attach_device(&xml)
            .map_err(|e| HypervisorError::OperationFailed(e.to_string()))?;
        
        Ok(())
    }
    
    async fn detach_nic(&self, vm_id: &str, nic_id: &str) -> Result<()> {
        let domain = self.get_domain(vm_id).await?;
        
        let xml = format!(
            r#"<interface type='bridge'>
                <mac address='{}'/>
            </interface>"#,
            nic_id
        );
        
        domain.detach_device(&xml)
            .map_err(|e| HypervisorError::OperationFailed(e.to_string()))?;
        
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id, target = %target_uri, live = %live))]
    async fn migrate_vm(&self, vm_id: &str, target_uri: &str, live: bool) -> Result<()> {
        info!("Starting migration");
        
        let domain = self.get_domain(vm_id).await?;
        
        // Connect to destination
        let dest_conn = Connect::open(target_uri)
            .map_err(|e| HypervisorError::MigrationFailed(e.to_string()))?;
        
        let flags = if live {
            virt::domain::VIR_MIGRATE_LIVE | virt::domain::VIR_MIGRATE_PERSIST_DEST
        } else {
            virt::domain::VIR_MIGRATE_PERSIST_DEST
        };
        
        domain.migrate(&dest_conn, flags, None, None, 0)
            .map_err(|e| HypervisorError::MigrationFailed(e.to_string()))?;
        
        info!("Migration completed successfully");
        Ok(())
    }
    
    async fn get_vm_metrics(&self, vm_id: &str) -> Result<VmMetrics> {
        let domain = self.get_domain(vm_id).await?;
        
        let info = domain.get_info()
            .map_err(|e| HypervisorError::QueryFailed(e.to_string()))?;
        
        // Get block stats
        let (disk_read, disk_write) = domain.block_stats("")
            .map(|stats| (stats.rd_bytes, stats.wr_bytes))
            .unwrap_or((0, 0));
        
        // Get network stats
        let (net_rx, net_tx) = domain.interface_stats("")
            .map(|stats| (stats.rx_bytes, stats.tx_bytes))
            .unwrap_or((0, 0));
        
        Ok(VmMetrics {
            vm_id: vm_id.to_string(),
            cpu_usage_percent: 0.0, // Would need sampling
            memory_used_bytes: info.memory * 1024,
            memory_total_bytes: info.max_mem * 1024,
            disk_read_bytes: disk_read as u64,
            disk_write_bytes: disk_write as u64,
            network_rx_bytes: net_rx as u64,
            network_tx_bytes: net_tx as u64,
        })
    }
}
```

---

### Phase 3: Integration with Control Plane (Weeks 3-4)

**Goal:** Connect Node Daemon to Go control plane.

#### 3.1 Update Backend to Call Node Daemon

The Go control plane's `VMService` will be updated to delegate actual VM operations to the Node Daemon via gRPC.

#### 3.2 Registration & Heartbeat

```rust
// agent/limiquantix-node/src/registration.rs

use std::time::Duration;
use tokio::time;
use tonic::transport::Channel;
use tracing::{info, warn, error};

use limiquantix_proto::compute::v1::node_service_client::NodeServiceClient;
use limiquantix_proto::compute::v1::{RegisterNodeRequest, NodeHeartbeatRequest};

pub struct RegistrationManager {
    control_plane_address: String,
    node_id: String,
    heartbeat_interval: Duration,
}

impl RegistrationManager {
    pub fn new(
        control_plane_address: String,
        node_id: String,
        heartbeat_interval: Duration,
    ) -> Self {
        Self {
            control_plane_address,
            node_id,
            heartbeat_interval,
        }
    }
    
    pub async fn start(&self) -> anyhow::Result<()> {
        // Connect to control plane
        let channel = Channel::from_shared(self.control_plane_address.clone())?
            .connect()
            .await?;
        
        let mut client = NodeServiceClient::new(channel);
        
        // Register this node
        info!(node_id = %self.node_id, "Registering with control plane");
        
        let request = RegisterNodeRequest {
            node_id: self.node_id.clone(),
            hostname: hostname::get()?.to_string_lossy().to_string(),
            management_ip: get_management_ip()?,
            // ... other fields
        };
        
        client.register_node(request).await?;
        info!("Node registered successfully");
        
        // Start heartbeat loop
        let mut interval = time::interval(self.heartbeat_interval);
        
        loop {
            interval.tick().await;
            
            let request = NodeHeartbeatRequest {
                node_id: self.node_id.clone(),
                // ... metrics
            };
            
            match client.heartbeat(request).await {
                Ok(_) => {
                    info!("Heartbeat sent");
                }
                Err(e) => {
                    warn!(error = %e, "Heartbeat failed");
                }
            }
        }
    }
}

fn get_management_ip() -> anyhow::Result<String> {
    // Get primary IP address
    // Simplified - real implementation would be more robust
    Ok("192.168.1.100".to_string())
}
```

---

## Dependencies

### Rust Crates

```toml
# Core async runtime
tokio = { version = "1.35", features = ["full"] }

# gRPC
tonic = "0.11"
prost = "0.12"
tonic-build = "0.11"

# Libvirt bindings
virt = "0.4"

# Logging/Tracing
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }

# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
serde_yaml = "0.9"

# Error handling
thiserror = "1.0"
anyhow = "1.0"

# Utilities
uuid = { version = "1.6", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
hostname = "0.3"

# Configuration
config = "0.14"

# CLI
clap = { version = "4.4", features = ["derive"] }

# Async utilities
async-trait = "0.1"
futures = "0.3"
```

### System Dependencies

```bash
# Ubuntu/Debian
apt install libvirt-dev pkg-config

# RHEL/CentOS
dnf install libvirt-devel pkgconfig

# macOS (for development only)
brew install libvirt
```

---

## Testing Strategy

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_vm_config_builder() {
        let config = VmConfig::new("test-vm")
            .with_cpu(4)
            .with_memory(4096)
            .with_disk("/var/lib/vms/test.qcow2", 50);
        
        assert_eq!(config.cpu.cores, 4);
        assert_eq!(config.memory.size_mib, 4096);
    }
}
```

### Integration Tests

```rust
#[cfg(test)]
mod integration_tests {
    use super::*;
    
    #[tokio::test]
    #[ignore] // Requires libvirt
    async fn test_libvirt_connection() {
        let backend = LibvirtBackend::new("qemu:///system").await.unwrap();
        let caps = backend.capabilities().await.unwrap();
        assert!(caps.supports_snapshots);
    }
    
    #[tokio::test]
    #[ignore] // Requires libvirt
    async fn test_vm_lifecycle() {
        let backend = LibvirtBackend::new("qemu:///system").await.unwrap();
        
        // Create VM
        let config = VmConfig::new("integration-test-vm");
        let vm_id = backend.create_vm(config).await.unwrap();
        
        // Start
        backend.start_vm(&vm_id).await.unwrap();
        
        // Verify running
        let status = backend.get_vm_status(&vm_id).await.unwrap();
        assert_eq!(status.state, VmState::Running);
        
        // Stop
        backend.stop_vm(&vm_id, Duration::from_secs(30)).await.unwrap();
        
        // Delete
        backend.delete_vm(&vm_id).await.unwrap();
    }
}
```

---

## Deployment

### Systemd Service

```ini
# /etc/systemd/system/limiquantix-node.service

[Unit]
Description=limiquantix Node Daemon
After=libvirtd.service
Requires=libvirtd.service

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/limiquantix-node --config /etc/limiquantix/node.yaml
Restart=always
RestartSec=5
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
```

### Configuration File

```yaml
# /etc/limiquantix/node.yaml

node:
  id: null  # Auto-generated
  hostname: null  # Auto-detected
  labels:
    rack: "A1"
    zone: "us-east-1a"

server:
  listen_address: "0.0.0.0:9090"
  metrics_port: 9091

hypervisor:
  backend: libvirt
  libvirt_uri: "qemu:///system"
  storage_path: "/var/lib/limiquantix/vms"

control_plane:
  address: "https://controlplane.limiquantix.local:8080"
  registration_enabled: true
  heartbeat_interval_secs: 30

tls:
  enabled: true
  cert_path: "/etc/limiquantix/certs/node.crt"
  key_path: "/etc/limiquantix/certs/node.key"
  ca_path: "/etc/limiquantix/certs/ca.crt"
```

---

## Milestones

| Week | Milestone | Deliverables |
|------|-----------|--------------|
| 1 | Foundation | Project structure, proto definitions, gRPC skeleton |
| 2 | Hypervisor | Libvirt backend, VM create/start/stop |
| 3 | Full Lifecycle | All VM operations, console, snapshots |
| 4 | Integration | Control plane integration, registration, heartbeat |
| 5 | Hot-plug | Disk/NIC attach/detach, live migration |
| 6 | Production | Telemetry, monitoring, hardening |

---

## Success Criteria

1. ✅ Can create a VM via gRPC call from control plane
2. ✅ Can start/stop/reboot VMs
3. ✅ Can get VNC console connection info
4. ✅ Can create/revert snapshots
5. ✅ Can live migrate VMs between nodes
6. ✅ Node registers with control plane
7. ✅ Heartbeat keeps node status updated
8. ✅ Metrics are streamed to control plane

---

## References

- [libvirt-rs documentation](https://docs.rs/virt/latest/virt/)
- [tonic gRPC framework](https://github.com/hyperium/tonic)
- [libvirt domain XML format](https://libvirt.org/formatdomain.html)
- [ADR-000007: Hypervisor Integration](adr/000007-hypervisor-integration.md)

