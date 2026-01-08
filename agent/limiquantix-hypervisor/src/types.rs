//! Type definitions for VM configuration and status.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// =============================================================================
// VM CONFIGURATION
// =============================================================================

/// VM configuration for creation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmConfig {
    /// Unique identifier (UUID v4)
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// CPU configuration
    pub cpu: CpuConfig,
    /// Memory configuration
    pub memory: MemoryConfig,
    /// Disk devices
    pub disks: Vec<DiskConfig>,
    /// Network interfaces
    pub nics: Vec<NicConfig>,
    /// CD-ROM devices
    pub cdroms: Vec<CdromConfig>,
    /// Boot configuration
    pub boot: BootConfig,
    /// Console configuration
    pub console: ConsoleConfig,
}

impl VmConfig {
    /// Create a new VM configuration with default values.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            cpu: CpuConfig::default(),
            memory: MemoryConfig::default(),
            disks: Vec::new(),
            nics: Vec::new(),
            cdroms: Vec::new(),
            boot: BootConfig::default(),
            console: ConsoleConfig::default(),
        }
    }
    
    /// Set the VM ID.
    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = id.into();
        self
    }
    
    /// Set the number of CPU cores.
    pub fn with_cpu(mut self, cores: u32) -> Self {
        self.cpu.cores = cores;
        self
    }
    
    /// Set the memory size in MiB.
    pub fn with_memory(mut self, size_mib: u64) -> Self {
        self.memory.size_mib = size_mib;
        self
    }
    
    /// Add a disk.
    pub fn with_disk(mut self, disk: DiskConfig) -> Self {
        self.disks.push(disk);
        self
    }
    
    /// Add a network interface.
    pub fn with_nic(mut self, nic: NicConfig) -> Self {
        self.nics.push(nic);
        self
    }
    
    /// Add a CD-ROM device.
    pub fn with_cdrom(mut self, cdrom: CdromConfig) -> Self {
        self.cdroms.push(cdrom);
        self
    }
}

/// CPU configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuConfig {
    /// Number of CPU cores
    pub cores: u32,
    /// Number of CPU sockets
    pub sockets: u32,
    /// Threads per core
    pub threads_per_core: u32,
    /// CPU model (optional, e.g., "host-passthrough")
    pub model: Option<String>,
}

impl Default for CpuConfig {
    fn default() -> Self {
        Self {
            cores: 2,
            sockets: 1,
            threads_per_core: 1,
            model: None,
        }
    }
}

impl CpuConfig {
    /// Get total vCPUs.
    pub fn total_vcpus(&self) -> u32 {
        self.cores * self.sockets * self.threads_per_core
    }
}

/// Memory configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryConfig {
    /// Memory size in MiB
    pub size_mib: u64,
    /// Use huge pages
    pub hugepages: bool,
    /// Enable memory ballooning
    pub ballooning: bool,
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            size_mib: 2048,
            hugepages: false,
            ballooning: true,
        }
    }
}

/// Disk configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskConfig {
    /// Unique identifier for this disk
    pub id: String,
    /// Path to disk image file
    pub path: String,
    /// Disk size in GiB (for creation)
    pub size_gib: u64,
    /// Bus type
    pub bus: DiskBus,
    /// Disk format
    pub format: DiskFormat,
    /// Read-only flag
    pub readonly: bool,
    /// Is this a boot disk
    pub bootable: bool,
    /// Caching mode
    pub cache: DiskCache,
    /// IO mode
    pub io_mode: DiskIoMode,
    /// Backing file path (for copy-on-write cloud images)
    pub backing_file: Option<String>,
}

impl Default for DiskConfig {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            path: String::new(),
            size_gib: 20,
            bus: DiskBus::Virtio,
            format: DiskFormat::Qcow2,
            readonly: false,
            bootable: true,
            cache: DiskCache::None,
            io_mode: DiskIoMode::Native,
            backing_file: None,
        }
    }
}

impl DiskConfig {
    /// Create a new disk configuration.
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            ..Default::default()
        }
    }
}

/// Disk bus type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiskBus {
    Virtio,
    Scsi,
    Sata,
    Ide,
}

impl DiskBus {
    /// Get the libvirt bus name.
    pub fn as_str(&self) -> &'static str {
        match self {
            DiskBus::Virtio => "virtio",
            DiskBus::Scsi => "scsi",
            DiskBus::Sata => "sata",
            DiskBus::Ide => "ide",
        }
    }
    
    /// Get the device prefix.
    pub fn device_prefix(&self) -> &'static str {
        match self {
            DiskBus::Virtio => "vd",
            DiskBus::Scsi => "sd",
            DiskBus::Sata => "sd",
            DiskBus::Ide => "hd",
        }
    }
}

/// Disk format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiskFormat {
    Qcow2,
    Raw,
    Vmdk,
}

impl DiskFormat {
    /// Get the format string.
    pub fn as_str(&self) -> &'static str {
        match self {
            DiskFormat::Qcow2 => "qcow2",
            DiskFormat::Raw => "raw",
            DiskFormat::Vmdk => "vmdk",
        }
    }
}

/// Disk caching mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiskCache {
    None,
    Writeback,
    Writethrough,
    Directsync,
    Unsafe,
}

impl DiskCache {
    pub fn as_str(&self) -> &'static str {
        match self {
            DiskCache::None => "none",
            DiskCache::Writeback => "writeback",
            DiskCache::Writethrough => "writethrough",
            DiskCache::Directsync => "directsync",
            DiskCache::Unsafe => "unsafe",
        }
    }
}

/// Disk IO mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiskIoMode {
    Native,
    Threads,
}

impl DiskIoMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            DiskIoMode::Native => "native",
            DiskIoMode::Threads => "threads",
        }
    }
}

/// CD-ROM configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CdromConfig {
    /// Unique identifier
    pub id: String,
    /// Path to ISO file (empty for empty drive)
    pub iso_path: Option<String>,
    /// Is this a boot device
    pub bootable: bool,
}

impl Default for CdromConfig {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            iso_path: None,
            bootable: false,
        }
    }
}

/// Network interface configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NicConfig {
    /// Unique identifier
    pub id: String,
    /// MAC address (auto-generated if None)
    pub mac_address: Option<String>,
    /// Bridge name to connect to
    pub bridge: Option<String>,
    /// Virtual network name
    pub network: Option<String>,
    /// NIC model
    pub model: NicModel,
    /// OVN logical switch port name (for OVS/OVN integration)
    /// When set, this creates an OVS virtualport interface
    #[serde(default)]
    pub ovn_port_name: Option<String>,
    /// OVS integration bridge (default: br-int)
    #[serde(default)]
    pub ovs_bridge: Option<String>,
}

impl Default for NicConfig {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            mac_address: None,
            bridge: Some("virbr0".to_string()),
            network: None,
            model: NicModel::Virtio,
            ovn_port_name: None,
            ovs_bridge: None,
        }
    }
}

/// Network interface model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NicModel {
    Virtio,
    E1000,
    E1000e,
    Rtl8139,
}

impl NicModel {
    pub fn as_str(&self) -> &'static str {
        match self {
            NicModel::Virtio => "virtio",
            NicModel::E1000 => "e1000",
            NicModel::E1000e => "e1000e",
            NicModel::Rtl8139 => "rtl8139",
        }
    }
}

/// Boot configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootConfig {
    /// Boot order
    pub order: Vec<BootDevice>,
    /// Firmware type
    pub firmware: Firmware,
    /// Enable secure boot (UEFI only)
    pub secure_boot: bool,
}

impl Default for BootConfig {
    fn default() -> Self {
        Self {
            order: vec![BootDevice::Disk, BootDevice::Cdrom, BootDevice::Network],
            firmware: Firmware::Bios,
            secure_boot: false,
        }
    }
}

/// Boot device type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BootDevice {
    Disk,
    Cdrom,
    Network,
}

impl BootDevice {
    pub fn as_str(&self) -> &'static str {
        match self {
            BootDevice::Disk => "hd",
            BootDevice::Cdrom => "cdrom",
            BootDevice::Network => "network",
        }
    }
}

/// Firmware type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Firmware {
    Bios,
    Uefi,
}

/// Console configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleConfig {
    /// Enable VNC console
    pub vnc_enabled: bool,
    /// VNC port (0 = auto-assign)
    pub vnc_port: Option<u16>,
    /// VNC password
    pub vnc_password: Option<String>,
    /// VNC listen address
    pub vnc_listen: String,
    /// Enable SPICE console
    pub spice_enabled: bool,
    /// SPICE port
    pub spice_port: Option<u16>,
}

impl Default for ConsoleConfig {
    fn default() -> Self {
        Self {
            vnc_enabled: true,
            vnc_port: None,
            vnc_password: None,
            vnc_listen: "0.0.0.0".to_string(),
            spice_enabled: false,
            spice_port: None,
        }
    }
}

// =============================================================================
// VM STATUS
// =============================================================================

/// Basic VM information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmInfo {
    /// VM UUID
    pub id: String,
    /// VM name
    pub name: String,
    /// Current power state
    pub state: VmState,
}

/// VM power state.
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

impl Default for VmState {
    fn default() -> Self {
        Self::Unknown
    }
}

/// Detailed VM status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmStatus {
    /// VM UUID
    pub id: String,
    /// VM name
    pub name: String,
    /// Current power state
    pub state: VmState,
    /// Total CPU time consumed (nanoseconds)
    pub cpu_time_ns: u64,
    /// Current memory RSS (bytes)
    pub memory_rss_bytes: u64,
    /// Maximum memory (bytes)
    pub memory_max_bytes: u64,
    /// Disks attached to the VM
    pub disks: Vec<DiskConfig>,
}

/// Console connection information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleInfo {
    /// Console type
    pub console_type: ConsoleType,
    /// Host to connect to
    pub host: String,
    /// Port to connect to
    pub port: u16,
    /// Password (if required)
    pub password: Option<String>,
    /// WebSocket path (for noVNC)
    pub websocket_path: Option<String>,
}

/// Console type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConsoleType {
    Vnc,
    Spice,
}

/// Snapshot information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotInfo {
    /// Snapshot ID
    pub id: String,
    /// Snapshot name
    pub name: String,
    /// Description
    pub description: String,
    /// Creation time
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// VM state at snapshot time
    pub vm_state: VmState,
    /// Parent snapshot ID (for tree structure)
    pub parent_id: Option<String>,
}

/// VM resource usage metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VmMetrics {
    /// VM UUID
    pub vm_id: String,
    /// CPU usage percentage
    pub cpu_usage_percent: f64,
    /// Memory used (bytes)
    pub memory_used_bytes: u64,
    /// Memory total (bytes)
    pub memory_total_bytes: u64,
    /// Disk read bytes
    pub disk_read_bytes: u64,
    /// Disk write bytes
    pub disk_write_bytes: u64,
    /// Network receive bytes
    pub network_rx_bytes: u64,
    /// Network transmit bytes
    pub network_tx_bytes: u64,
}

