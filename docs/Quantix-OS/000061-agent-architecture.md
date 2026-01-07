# 000061 - Agent Crates Architecture

**Document Type:** Technical Architecture  
**Created:** 2026-01-07  
**Last Updated:** 2026-01-07  
**Status:** Active

## Overview

The Quantix platform is built from several Rust crates (libraries and binaries) located in the `agent/` directory. This document provides comprehensive documentation for each crate, their responsibilities, and how they interact.

## Crate Overview

```
agent/
├── Cargo.toml                 # Workspace manifest
├── Cargo.lock                 # Dependency lock file
├── README.md                  # Agent overview
│
├── limiquantix-common/        # Shared utilities and logging
├── limiquantix-guest-agent/   # Runs inside VMs
├── limiquantix-hypervisor/    # Hypervisor abstraction (libvirt, OVS)
├── limiquantix-node/          # Node daemon (main service)
├── limiquantix-proto/         # gRPC protocol definitions
└── limiquantix-telemetry/     # System metrics collection
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           QUANTIX-OS NODE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      limiquantix-node                                   │ │
│  │                    (Main Node Daemon)                                   │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │ │
│  │  │ HTTP Server │  │ gRPC Server │  │ TLS Manager │  │  Agent Mgr  │   │ │
│  │  │ (port 8443) │  │ (port 9443) │  │ (certs)     │  │ (VM agents) │   │ │
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────┘  └──────┬──────┘   │ │
│  └─────────┼────────────────┼────────────────────────────────┼───────────┘ │
│            │                │                                │             │
│  ┌─────────┴────────────────┴────────────────────────────────┴───────────┐ │
│  │                     limiquantix-hypervisor                             │ │
│  │                   (Hypervisor Abstraction)                             │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │ │
│  │  │  Libvirt    │  │   OVS/OVN   │  │   Storage   │  │  Cloud-Init │   │ │
│  │  │  Backend    │  │   Manager   │  │   Manager   │  │  Generator  │   │ │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────────────┘   │ │
│  └─────────┼────────────────┼────────────────┼───────────────────────────┘ │
│            │                │                │                             │
│            ▼                ▼                ▼                             │
│       ┌─────────┐      ┌─────────┐      ┌─────────┐                       │
│       │libvirtd │      │ovs-vsctl│      │ qemu-img│                       │
│       └─────────┘      └─────────┘      └─────────┘                       │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                     limiquantix-telemetry                             │ │
│  │  ┌───────┐  ┌────────┐  ┌──────┐  ┌─────────┐  ┌────────┐            │ │
│  │  │  CPU  │  │ Memory │  │ Disk │  │ Network │  │ System │            │ │
│  │  └───────┘  └────────┘  └──────┘  └─────────┘  └────────┘            │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                      limiquantix-proto                                │ │
│  │              (gRPC Protocol Definitions)                              │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                      limiquantix-common                               │ │
│  │              (Shared Utilities & Logging)                             │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘

                              ▲
                              │ virtio-serial
                              ▼

┌─────────────────────────────────────────────────────────────────────────────┐
│                              GUEST VM                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    limiquantix-guest-agent                            │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │   │
│  │  │Telemetry │  │ Execute  │  │  File    │  │ Quiesce  │              │   │
│  │  │ Handler  │  │ Handler  │  │ Handler  │  │ Handler  │              │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. limiquantix-common

**Purpose:** Shared utilities used across all crates.

### Location

```
agent/limiquantix-common/
├── Cargo.toml
└── src/
    ├── lib.rs          # Module exports
    └── logging.rs      # Structured logging setup
```

### Dependencies

```toml
[dependencies]
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }
```

### Key Components

#### Logging Setup

```rust
// logging.rs
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

pub fn init_logging() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().json())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();
}
```

### Usage

```rust
use limiquantix_common::logging;

fn main() {
    logging::init_logging();
    tracing::info!("Application started");
}
```

---

## 2. limiquantix-telemetry

**Purpose:** System metrics collection for the host.

### Location

```
agent/limiquantix-telemetry/
├── Cargo.toml
└── src/
    ├── lib.rs          # TelemetryCollector main struct
    ├── cpu.rs          # CPU model, cores, usage
    ├── memory.rs       # RAM total, available, swap
    ├── disk.rs         # Disk info, partitions, usage
    ├── network.rs      # NIC info, traffic stats
    └── system.rs       # Hostname, OS, kernel, uptime
```

### Dependencies

```toml
[dependencies]
sysinfo = "0.31"
serde = { version = "1.0", features = ["derive"] }
```

### Key Components

#### TelemetryCollector

```rust
// lib.rs
pub struct TelemetryCollector {
    system: Mutex<System>,
    disks: Mutex<Disks>,
    networks: Mutex<Networks>,
}

impl TelemetryCollector {
    pub fn new() -> Self;
    pub fn refresh(&self);
    pub fn collect(&self) -> NodeTelemetry;
}

pub struct NodeTelemetry {
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub disks: Vec<DiskInfo>,
    pub networks: Vec<NetworkInfo>,
    pub system: SystemInfo,
}
```

#### CPU Information

```rust
// cpu.rs
pub struct CpuInfo {
    pub model: String,
    pub vendor: String,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub frequency_mhz: u64,
    pub usage_percent: f32,
}

pub fn collect_cpu_info(system: &System) -> CpuInfo;
```

#### Memory Information

```rust
// memory.rs
pub struct MemoryInfo {
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
}

pub fn collect_memory_info(system: &System) -> MemoryInfo;
```

#### Disk Information

```rust
// disk.rs
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub filesystem: String,
    pub is_removable: bool,
}

pub fn collect_disk_info(disks: &Disks) -> Vec<DiskInfo>;
```

#### Network Information

```rust
// network.rs
pub struct NetworkInfo {
    pub name: String,
    pub mac_address: String,
    pub received_bytes: u64,
    pub transmitted_bytes: u64,
}

pub fn collect_network_info(networks: &Networks) -> Vec<NetworkInfo>;
```

#### System Information

```rust
// system.rs
pub struct SystemInfo {
    pub hostname: String,
    pub os_name: String,
    pub os_version: String,
    pub kernel_version: String,
    pub uptime_seconds: u64,
}

pub fn collect_system_info(system: &System) -> SystemInfo;
```

---

## 3. limiquantix-proto

**Purpose:** gRPC protocol definitions and generated code.

### Location

```
agent/limiquantix-proto/
├── Cargo.toml
├── build.rs              # Protobuf code generation
├── proto/
│   ├── node_daemon.proto # Node daemon service
│   └── agent.proto       # Guest agent protocol
└── src/
    ├── lib.rs            # Re-exports
    └── generated/
        ├── limiquantix.node.v1.rs
        └── limiquantix.agent.v1.rs
```

### Dependencies

```toml
[dependencies]
prost = "0.13"
tonic = "0.12"

[build-dependencies]
tonic-build = "0.12"
```

### Node Daemon Service

```protobuf
// proto/node_daemon.proto
syntax = "proto3";
package limiquantix.node.v1;

service NodeDaemonService {
  // Health
  rpc HealthCheck(google.protobuf.Empty) returns (HealthResponse);
  
  // VM Lifecycle
  rpc CreateVM(CreateVMRequest) returns (CreateVMResponse);
  rpc StartVM(VMIdRequest) returns (google.protobuf.Empty);
  rpc StopVM(StopVMRequest) returns (google.protobuf.Empty);
  rpc ForceStopVM(VMIdRequest) returns (google.protobuf.Empty);
  rpc RebootVM(VMIdRequest) returns (google.protobuf.Empty);
  rpc DeleteVM(VMIdRequest) returns (google.protobuf.Empty);
  
  // VM Status
  rpc GetVMStatus(VMIdRequest) returns (VMStatusResponse);
  rpc ListVMs(google.protobuf.Empty) returns (ListVMsResponse);
  
  // Console
  rpc GetConsole(VMIdRequest) returns (ConsoleInfoResponse);
  
  // Snapshots
  rpc CreateSnapshot(CreateSnapshotRequest) returns (SnapshotResponse);
  rpc ListSnapshots(VMIdRequest) returns (ListSnapshotsResponse);
  rpc RevertSnapshot(RevertSnapshotRequest) returns (google.protobuf.Empty);
  rpc DeleteSnapshot(DeleteSnapshotRequest) returns (google.protobuf.Empty);
  
  // Hot-plug
  rpc AttachDisk(AttachDiskRequest) returns (google.protobuf.Empty);
  rpc DetachDisk(DetachDiskRequest) returns (google.protobuf.Empty);
  
  // Telemetry
  rpc GetNodeInfo(google.protobuf.Empty) returns (NodeInfoResponse);
  rpc StreamMetrics(StreamMetricsRequest) returns (stream NodeMetrics);
}
```

### Guest Agent Protocol

```protobuf
// proto/agent.proto
syntax = "proto3";
package limiquantix.agent.v1;

message AgentRequest {
  oneof request {
    PingRequest ping = 1;
    GetTelemetryRequest get_telemetry = 2;
    ExecuteCommandRequest execute_command = 3;
    QuiesceFilesystemsRequest quiesce_filesystems = 4;
    ThawFilesystemsRequest thaw_filesystems = 5;
    ShutdownRequest shutdown = 6;
    RebootRequest reboot = 7;
    SyncTimeRequest sync_time = 8;
    FileTransferRequest file_transfer = 9;
  }
}

message AgentResponse {
  oneof response {
    PingResponse ping = 1;
    GetTelemetryResponse get_telemetry = 2;
    ExecuteCommandResponse execute_command = 3;
    QuiesceFilesystemsResponse quiesce_filesystems = 4;
    ThawFilesystemsResponse thaw_filesystems = 5;
    ShutdownResponse shutdown = 6;
    RebootResponse reboot = 7;
    SyncTimeResponse sync_time = 8;
    FileTransferResponse file_transfer = 9;
    ErrorResponse error = 100;
  }
}
```

---

## 4. limiquantix-hypervisor

**Purpose:** Abstraction layer for hypervisor operations.

### Location

```
agent/limiquantix-hypervisor/
├── Cargo.toml
└── src/
    ├── lib.rs            # Public API
    ├── traits.rs         # HypervisorBackend trait
    ├── types.rs          # VM, Disk, NIC types
    ├── error.rs          # Error types
    ├── xml.rs            # Libvirt XML generation
    ├── cloudinit.rs      # Cloud-init ISO generation
    ├── mock.rs           # Mock backend for testing
    │
    ├── libvirt/
    │   ├── mod.rs        # Module exports
    │   └── backend.rs    # Libvirt implementation
    │
    ├── network/
    │   ├── mod.rs        # Module exports
    │   ├── ovs.rs        # Open vSwitch management
    │   └── types.rs      # Network types
    │
    └── storage/
        ├── mod.rs        # Module exports
        ├── manager.rs    # Storage pool management
        ├── local.rs      # Local directory backend
        ├── nfs.rs        # NFS backend
        ├── ceph.rs       # Ceph RBD backend
        ├── iscsi.rs      # iSCSI backend
        └── volume.rs     # Volume operations
```

### Dependencies

```toml
[dependencies]
virt = "0.4"              # Libvirt bindings
tokio = { version = "1", features = ["full"] }
uuid = { version = "1", features = ["v4"] }
serde = { version = "1", features = ["derive"] }
thiserror = "1"
```

### Key Components

#### HypervisorBackend Trait

```rust
// traits.rs
#[async_trait]
pub trait HypervisorBackend: Send + Sync {
    // VM Lifecycle
    async fn create_vm(&self, config: VmConfig) -> Result<VmInfo, HypervisorError>;
    async fn start_vm(&self, vm_id: &str) -> Result<(), HypervisorError>;
    async fn stop_vm(&self, vm_id: &str, force: bool) -> Result<(), HypervisorError>;
    async fn reboot_vm(&self, vm_id: &str) -> Result<(), HypervisorError>;
    async fn delete_vm(&self, vm_id: &str) -> Result<(), HypervisorError>;
    
    // Status
    async fn get_vm_status(&self, vm_id: &str) -> Result<VmStatus, HypervisorError>;
    async fn list_vms(&self) -> Result<Vec<VmInfo>, HypervisorError>;
    
    // Console
    async fn get_console(&self, vm_id: &str) -> Result<ConsoleInfo, HypervisorError>;
    
    // Snapshots
    async fn create_snapshot(&self, vm_id: &str, name: &str) -> Result<SnapshotInfo, HypervisorError>;
    async fn revert_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<(), HypervisorError>;
}
```

#### VM Types

```rust
// types.rs
pub struct VmConfig {
    pub name: String,
    pub cpu_cores: u32,
    pub cpu_sockets: u32,
    pub memory_mib: u64,
    pub disks: Vec<DiskConfig>,
    pub nics: Vec<NicConfig>,
    pub cloud_init: Option<CloudInitConfig>,
}

pub struct DiskConfig {
    pub id: String,
    pub size_bytes: u64,
    pub bus: DiskBus,
    pub format: DiskFormat,
    pub backing_file: Option<String>,
    pub bootable: bool,
}

pub struct NicConfig {
    pub id: String,
    pub bridge: String,
    pub mac_address: Option<String>,
    pub model: NicModel,
}

pub enum VmState {
    Running,
    Stopped,
    Paused,
    Suspended,
    Crashed,
    Unknown,
}
```

#### Libvirt Backend

```rust
// libvirt/backend.rs
pub struct LibvirtBackend {
    conn: Arc<Mutex<Connect>>,
    storage_manager: StorageManager,
}

impl LibvirtBackend {
    pub fn new(uri: &str) -> Result<Self, HypervisorError>;
}

#[async_trait]
impl HypervisorBackend for LibvirtBackend {
    async fn create_vm(&self, config: VmConfig) -> Result<VmInfo, HypervisorError> {
        // Generate libvirt XML
        let xml = generate_domain_xml(&config)?;
        
        // Define and start domain
        let conn = self.conn.lock().unwrap();
        let domain = Domain::define_xml(&conn, &xml)?;
        domain.create()?;
        
        Ok(VmInfo { ... })
    }
    // ... other implementations
}
```

#### OVS Manager

```rust
// network/ovs.rs
pub struct OvsManager {
    ovs_vsctl_path: PathBuf,
}

impl OvsManager {
    pub fn new() -> Self;
    
    // Bridge operations
    pub fn create_bridge(&self, name: &str) -> Result<(), OvsError>;
    pub fn delete_bridge(&self, name: &str) -> Result<(), OvsError>;
    pub fn list_bridges(&self) -> Result<Vec<String>, OvsError>;
    
    // Port operations
    pub fn add_port(&self, bridge: &str, port: &str) -> Result<(), OvsError>;
    pub fn delete_port(&self, bridge: &str, port: &str) -> Result<(), OvsError>;
    pub fn set_port_vlan(&self, port: &str, vlan_id: u16) -> Result<(), OvsError>;
    
    // Status
    pub fn get_status(&self) -> Result<OvsStatus, OvsError>;
}

pub struct OvsStatus {
    pub version: String,
    pub bridges: Vec<BridgeInfo>,
    pub ports: Vec<PortInfo>,
}
```

#### Storage Manager

```rust
// storage/manager.rs
pub struct StorageManager {
    pools: HashMap<String, Box<dyn StorageBackend>>,
}

impl StorageManager {
    pub fn new() -> Self;
    
    // Pool operations
    pub fn add_pool(&mut self, id: &str, backend: Box<dyn StorageBackend>);
    pub fn get_pool(&self, id: &str) -> Option<&dyn StorageBackend>;
    pub fn list_pools(&self) -> Vec<PoolInfo>;
    
    // Volume operations
    pub fn create_volume(&self, pool_id: &str, spec: VolumeSpec) -> Result<Volume, StorageError>;
    pub fn delete_volume(&self, pool_id: &str, volume_id: &str) -> Result<(), StorageError>;
    pub fn resize_volume(&self, pool_id: &str, volume_id: &str, new_size: u64) -> Result<(), StorageError>;
}

pub trait StorageBackend: Send + Sync {
    fn pool_info(&self) -> PoolInfo;
    fn create_volume(&self, spec: VolumeSpec) -> Result<Volume, StorageError>;
    fn delete_volume(&self, volume_id: &str) -> Result<(), StorageError>;
    fn list_volumes(&self) -> Result<Vec<Volume>, StorageError>;
}
```

---

## 5. limiquantix-node

**Purpose:** The main node daemon that runs on each hypervisor host.

### Location

```
agent/limiquantix-node/
├── Cargo.toml
└── src/
    ├── main.rs           # Entry point
    ├── cli.rs            # Command-line arguments
    ├── config.rs         # Configuration loading
    ├── service.rs        # Core service implementation
    ├── server.rs         # gRPC server
    ├── http_server.rs    # HTTP/HTTPS server + REST API
    ├── tls.rs            # TLS certificate management
    ├── agent_client.rs   # Guest agent communication
    └── registration.rs   # Cluster registration
```

### Dependencies

```toml
[dependencies]
limiquantix-common = { path = "../limiquantix-common" }
limiquantix-hypervisor = { path = "../limiquantix-hypervisor" }
limiquantix-telemetry = { path = "../limiquantix-telemetry" }
limiquantix-proto = { path = "../limiquantix-proto" }

tokio = { version = "1", features = ["full"] }
tonic = "0.12"
axum = "0.7"
axum-server = { version = "0.7", features = ["tls-rustls"] }
tower-http = { version = "0.5", features = ["cors", "trace", "fs"] }
serde = { version = "1", features = ["derive"] }
serde_yaml = "0.9"
clap = { version = "4", features = ["derive"] }
tracing = "0.1"
```

### Key Components

#### Main Entry Point

```rust
// main.rs
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    limiquantix_common::logging::init_logging();
    
    // Parse CLI arguments
    let args = cli::Args::parse();
    
    // Load configuration
    let config = config::load_config(&args.config)?;
    
    // Create service
    let service = Arc::new(NodeDaemonServiceImpl::new(config.clone())?);
    
    // Start HTTP server
    let http_handle = tokio::spawn(http_server::run_http_server(
        config.http_listen,
        service.clone(),
        config.webui_path.clone(),
        config.tls.clone(),
    ));
    
    // Start gRPC server
    let grpc_handle = tokio::spawn(server::run_grpc_server(
        config.grpc_listen,
        service.clone(),
    ));
    
    // Wait for both servers
    tokio::try_join!(http_handle, grpc_handle)?;
    
    Ok(())
}
```

#### Configuration

```rust
// config.rs
#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub node_name: String,
    pub node_id: String,
    pub grpc_listen: SocketAddr,
    pub http_listen: SocketAddr,
    pub webui_path: PathBuf,
    pub storage: StorageConfig,
    pub network: NetworkConfig,
    pub tls: TlsConfig,
    pub cluster: Option<ClusterConfig>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TlsConfig {
    pub enabled: bool,
    pub cert_path: String,
    pub key_path: String,
    pub acme_enabled: bool,
    pub acme_email: Option<String>,
}

pub fn load_config(path: &Path) -> Result<Config, ConfigError>;
```

#### Core Service

```rust
// service.rs
pub struct NodeDaemonServiceImpl {
    config: Config,
    hypervisor: Arc<dyn HypervisorBackend>,
    telemetry: TelemetryCollector,
    storage_manager: StorageManager,
    ovs_manager: OvsManager,
    agent_clients: RwLock<HashMap<String, AgentClient>>,
}

impl NodeDaemonServiceImpl {
    pub fn new(config: Config) -> Result<Self, ServiceError>;
    
    // Health
    pub async fn health_check(&self) -> Result<HealthInfo, ServiceError>;
    
    // Telemetry
    pub fn get_telemetry(&self) -> NodeTelemetry;
    
    // VM operations (delegated to hypervisor)
    pub async fn create_vm(&self, config: VmConfig) -> Result<VmInfo, ServiceError>;
    pub async fn start_vm(&self, vm_id: &str) -> Result<(), ServiceError>;
    // ... etc
    
    // Storage operations
    pub fn list_storage_pools(&self) -> Vec<PoolInfo>;
    pub fn create_volume(&self, pool_id: &str, spec: VolumeSpec) -> Result<Volume, ServiceError>;
    
    // Network operations
    pub fn get_ovs_status(&self) -> Result<OvsStatus, ServiceError>;
}
```

#### HTTP Server

```rust
// http_server.rs
pub async fn run_http_server(
    addr: SocketAddr,
    service: Arc<NodeDaemonServiceImpl>,
    webui_path: PathBuf,
    tls_config: TlsConfig,
) -> Result<(), anyhow::Error> {
    let state = Arc::new(AppState {
        service,
        webui_path: webui_path.clone(),
        tls_manager: Arc::new(TlsManager::new(tls_config.clone())),
        tls_config,
    });
    
    let app = build_app_router(state, &webui_path);
    
    // Start HTTPS server
    let rustls_config = RustlsConfig::from_pem_file(
        &tls_config.cert_path,
        &tls_config.key_path,
    ).await?;
    
    axum_server::bind_rustls(addr, rustls_config)
        .serve(app.into_make_service())
        .await?;
    
    Ok(())
}

fn build_app_router(state: Arc<AppState>, webui_path: &PathBuf) -> Router {
    Router::new()
        // Host endpoints
        .route("/api/v1/host", get(get_host_info))
        .route("/api/v1/host/health", get(get_host_health))
        .route("/api/v1/host/metrics", get(get_host_metrics))
        .route("/api/v1/host/hardware", get(get_hardware_inventory))
        
        // VM endpoints
        .route("/api/v1/vms", get(list_vms))
        .route("/api/v1/vms", post(create_vm))
        .route("/api/v1/vms/:vm_id", get(get_vm))
        .route("/api/v1/vms/:vm_id", delete(delete_vm))
        .route("/api/v1/vms/:vm_id/start", post(start_vm))
        .route("/api/v1/vms/:vm_id/stop", post(stop_vm))
        .route("/api/v1/vms/:vm_id/console", get(get_console))
        
        // Storage endpoints
        .route("/api/v1/storage/pools", get(list_storage_pools))
        .route("/api/v1/storage/pools/:pool_id/volumes", get(list_volumes))
        
        // Cluster endpoints
        .route("/api/v1/cluster/status", get(get_cluster_status))
        .route("/api/v1/cluster/join", post(join_cluster))
        
        // Certificate management
        .route("/api/v1/settings/certificates", get(get_certificate_info))
        .route("/api/v1/settings/certificates/upload", post(upload_certificate))
        .route("/api/v1/settings/certificates/generate", post(generate_self_signed))
        
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}
```

#### TLS Management

```rust
// tls.rs
pub struct TlsManager {
    config: TlsConfig,
}

impl TlsManager {
    pub fn new(config: TlsConfig) -> Self;
    
    // Initialize certificates (generate self-signed if needed)
    pub async fn initialize(&self) -> Result<(), TlsError>;
    
    // Get certificate info
    pub fn get_certificate_info(&self) -> Result<CertificateInfo, TlsError>;
    
    // Upload custom certificate
    pub async fn upload_certificate(
        &self,
        cert: &str,
        key: &str,
        ca: Option<&str>,
    ) -> Result<(), TlsError>;
    
    // Generate self-signed certificate
    pub async fn generate_self_signed(&self) -> Result<(), TlsError>;
}

pub struct CertificateInfo {
    pub mode: CertificateMode,
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub valid_until: String,
    pub fingerprint: String,
}

pub enum CertificateMode {
    SelfSigned,
    Custom,
    Acme,
}
```

---

## 6. limiquantix-guest-agent

**Purpose:** Runs inside VMs to provide deep guest integration.

### Location

```
agent/limiquantix-guest-agent/
├── Cargo.toml
├── README.md
├── packaging/
│   ├── build-packages.sh       # Build .deb, .rpm, .msi
│   ├── debian/                 # Debian packaging
│   ├── systemd/                # Linux service
│   ├── windows/                # Windows installer
│   └── cloud-init/             # Auto-installation
└── src/
    ├── main.rs                 # Entry point
    ├── protocol.rs             # Length-prefixed protobuf
    ├── telemetry.rs            # Guest OS metrics
    ├── transport.rs            # Virtio-serial transport
    └── handlers/
        ├── mod.rs              # Handler exports
        ├── execute.rs          # Run commands
        ├── file.rs             # File transfer
        ├── lifecycle.rs        # Shutdown, reboot
        ├── quiesce.rs          # Filesystem freeze
        └── timesync.rs         # NTP sync
```

### Dependencies

```toml
[dependencies]
limiquantix-proto = { path = "../limiquantix-proto" }
tokio = { version = "1", features = ["full"] }
prost = "0.13"
sysinfo = "0.31"
tracing = "0.1"
```

### Key Components

#### Main Entry Point

```rust
// main.rs
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Find virtio-serial device
    let device_path = find_virtio_device()?;
    
    // Open transport
    let transport = VirtioSerialTransport::open(&device_path)?;
    
    // Create handlers
    let handlers = Handlers::new();
    
    // Main loop
    loop {
        let request = transport.receive().await?;
        let response = handlers.handle(request).await;
        transport.send(response).await?;
    }
}

fn find_virtio_device() -> Result<PathBuf, AgentError> {
    #[cfg(target_os = "linux")]
    {
        let path = PathBuf::from("/dev/virtio-ports/org.limiquantix.agent.0");
        if path.exists() {
            return Ok(path);
        }
    }
    
    #[cfg(target_os = "windows")]
    {
        // Windows named pipe
        return Ok(PathBuf::from(r"\\.\Global\org.limiquantix.agent.0"));
    }
    
    Err(AgentError::DeviceNotFound)
}
```

#### Protocol

```rust
// protocol.rs
// Length-prefixed protobuf over virtio-serial

pub async fn read_message<R: AsyncRead + Unpin>(reader: &mut R) -> Result<AgentRequest, ProtocolError> {
    // Read 4-byte length prefix (big-endian)
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    
    // Read message body
    let mut msg_buf = vec![0u8; len];
    reader.read_exact(&mut msg_buf).await?;
    
    // Decode protobuf
    AgentRequest::decode(&msg_buf[..])
        .map_err(ProtocolError::DecodeError)
}

pub async fn write_message<W: AsyncWrite + Unpin>(writer: &mut W, msg: &AgentResponse) -> Result<(), ProtocolError> {
    // Encode protobuf
    let mut buf = Vec::new();
    msg.encode(&mut buf)?;
    
    // Write length prefix
    let len = buf.len() as u32;
    writer.write_all(&len.to_be_bytes()).await?;
    
    // Write message body
    writer.write_all(&buf).await?;
    writer.flush().await?;
    
    Ok(())
}
```

#### Telemetry Handler

```rust
// handlers/telemetry.rs
pub async fn handle_get_telemetry() -> GetTelemetryResponse {
    let mut sys = System::new_all();
    sys.refresh_all();
    
    GetTelemetryResponse {
        hostname: System::host_name().unwrap_or_default(),
        os_name: System::name().unwrap_or_default(),
        os_version: System::os_version().unwrap_or_default(),
        kernel_version: System::kernel_version().unwrap_or_default(),
        cpu_usage_percent: sys.global_cpu_usage(),
        memory_total_bytes: sys.total_memory(),
        memory_used_bytes: sys.used_memory(),
        memory_available_bytes: sys.available_memory(),
        uptime_seconds: System::uptime(),
        ip_addresses: get_ip_addresses(),
    }
}
```

#### Execute Handler

```rust
// handlers/execute.rs
pub async fn handle_execute_command(req: ExecuteCommandRequest) -> ExecuteCommandResponse {
    let output = Command::new(&req.command)
        .args(&req.args)
        .output()
        .await;
    
    match output {
        Ok(output) => ExecuteCommandResponse {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        },
        Err(e) => ExecuteCommandResponse {
            exit_code: -1,
            stdout: String::new(),
            stderr: e.to_string(),
        },
    }
}
```

#### Quiesce Handler

```rust
// handlers/quiesce.rs
pub async fn handle_quiesce_filesystems() -> QuiesceFilesystemsResponse {
    #[cfg(target_os = "linux")]
    {
        // Sync all filesystems
        unsafe { libc::sync(); }
        
        // Freeze filesystems (requires root)
        let result = Command::new("fsfreeze")
            .arg("--freeze")
            .arg("/")
            .output()
            .await;
        
        match result {
            Ok(_) => QuiesceFilesystemsResponse { success: true, error: None },
            Err(e) => QuiesceFilesystemsResponse { success: false, error: Some(e.to_string()) },
        }
    }
    
    #[cfg(target_os = "windows")]
    {
        // Use VSS (Volume Shadow Copy Service)
        // ... Windows-specific implementation
    }
}

pub async fn handle_thaw_filesystems() -> ThawFilesystemsResponse {
    #[cfg(target_os = "linux")]
    {
        let result = Command::new("fsfreeze")
            .arg("--unfreeze")
            .arg("/")
            .output()
            .await;
        
        match result {
            Ok(_) => ThawFilesystemsResponse { success: true, error: None },
            Err(e) => ThawFilesystemsResponse { success: false, error: Some(e.to_string()) },
        }
    }
}
```

### Packaging

#### Linux (systemd service)

```ini
# packaging/systemd/limiquantix-agent.service
[Unit]
Description=Limiquantix Guest Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/limiquantix-agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

#### Cloud-Init Installation

```yaml
# packaging/cloud-init/install-agent.yaml
#cloud-config
packages:
  - curl

runcmd:
  - curl -sSL https://get.quantix.io/agent | bash
```

---

## Building All Crates

### From Workspace Root

```bash
cd agent

# Build all crates
cargo build --release

# Build specific crate
cargo build --release -p limiquantix-node

# Run tests
cargo test --all

# Generate documentation
cargo doc --no-deps --open
```

### For Alpine Linux (musl)

```bash
# Add musl target
rustup target add x86_64-unknown-linux-musl

# Build with musl
cargo build --release --target x86_64-unknown-linux-musl

# Or use Docker (recommended for Quantix-OS)
cd Quantix-OS
make node-daemon
make tui
```

---

## Related Documents

- [000052 - Quantix-OS Architecture](./000052-quantix-os-architecture.md)
- [000058 - Complete Vision](./000058-quantix-os-complete-vision.md)
- [000059 - Build Guide](./000059-quantix-os-build-guide.md)
- [000044 - Guest Agent Architecture](../Agent/000044-guest-agent-architecture.md)
