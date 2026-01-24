//! Core hypervisor abstraction trait.

use async_trait::async_trait;
use std::time::Duration;

use crate::error::Result;
use crate::types::*;

/// Capabilities supported by a hypervisor backend.
#[derive(Debug, Clone)]
pub struct HypervisorCapabilities {
    /// Name of the hypervisor (e.g., "libvirt", "cloud-hypervisor")
    pub name: String,
    /// Version string
    pub version: String,
    /// Supports live migration
    pub supports_live_migration: bool,
    /// Supports snapshots
    pub supports_snapshots: bool,
    /// Supports hot-plug of devices
    pub supports_hotplug: bool,
    /// Supports GPU passthrough
    pub supports_gpu_passthrough: bool,
    /// Supports nested virtualization
    pub supports_nested_virtualization: bool,
    /// Maximum vCPUs per VM
    pub max_vcpus: u32,
    /// Maximum memory per VM in bytes
    pub max_memory_bytes: u64,
}

/// Core hypervisor abstraction trait.
///
/// This trait defines the interface that all hypervisor backends must implement.
/// It provides a unified API for managing virtual machines regardless of the
/// underlying hypervisor technology (libvirt/QEMU, Cloud Hypervisor, etc.).
#[async_trait]
pub trait Hypervisor: Send + Sync {
    // =========================================================================
    // Capabilities & Health
    // =========================================================================
    
    /// Get hypervisor capabilities.
    async fn capabilities(&self) -> Result<HypervisorCapabilities>;
    
    /// Check if the hypervisor connection is healthy.
    async fn health_check(&self) -> Result<bool>;
    
    // =========================================================================
    // VM Lifecycle
    // =========================================================================
    
    /// Create a new VM (does not start it).
    ///
    /// Returns the VM ID (UUID) on success.
    async fn create_vm(&self, config: VmConfig) -> Result<String>;
    
    /// Start a VM.
    async fn start_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Stop a VM with graceful shutdown.
    ///
    /// Sends ACPI shutdown signal and waits up to `timeout` for the VM to stop.
    /// If the VM doesn't stop within the timeout, returns an error.
    async fn stop_vm(&self, vm_id: &str, timeout: Duration) -> Result<()>;
    
    /// Force stop a VM (power off).
    ///
    /// Immediately terminates the VM without graceful shutdown.
    async fn force_stop_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Reboot a VM.
    async fn reboot_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Pause a VM (freeze execution).
    async fn pause_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Resume a paused VM.
    async fn resume_vm(&self, vm_id: &str) -> Result<()>;
    
    /// Delete a VM (must be stopped first).
    async fn delete_vm(&self, vm_id: &str) -> Result<()>;
    
    // =========================================================================
    // VM Status
    // =========================================================================
    
    /// Get current VM status.
    async fn get_vm_status(&self, vm_id: &str) -> Result<VmStatus>;
    
    /// List all VMs on this node.
    async fn list_vms(&self) -> Result<Vec<VmInfo>>;
    
    /// Check if a VM exists.
    async fn vm_exists(&self, vm_id: &str) -> Result<bool>;
    
    // =========================================================================
    // Console
    // =========================================================================
    
    /// Get console connection information (VNC/SPICE).
    async fn get_console(&self, vm_id: &str) -> Result<ConsoleInfo>;
    
    // =========================================================================
    // Snapshots
    // =========================================================================
    
    /// Create a snapshot.
    async fn create_snapshot(
        &self, 
        vm_id: &str, 
        name: &str, 
        description: &str
    ) -> Result<SnapshotInfo>;
    
    /// Revert to a snapshot.
    async fn revert_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()>;
    
    /// Delete a snapshot.
    async fn delete_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()>;
    
    /// List all snapshots for a VM.
    async fn list_snapshots(&self, vm_id: &str) -> Result<Vec<SnapshotInfo>>;
    
    // =========================================================================
    // Hot-plug Operations
    // =========================================================================
    
    /// Attach a disk to a running VM.
    async fn attach_disk(&self, vm_id: &str, disk: DiskConfig) -> Result<()>;
    
    /// Detach a disk from a running VM.
    async fn detach_disk(&self, vm_id: &str, disk_id: &str) -> Result<()>;
    
    /// Attach a network interface to a running VM.
    async fn attach_nic(&self, vm_id: &str, nic: NicConfig) -> Result<()>;
    
    /// Detach a network interface from a running VM.
    async fn detach_nic(&self, vm_id: &str, nic_id: &str) -> Result<()>;
    
    /// Change CD-ROM media (mount/eject ISO).
    ///
    /// If `iso_path` is Some, mounts the ISO to the CD-ROM device.
    /// If `iso_path` is None, ejects the current media.
    async fn change_media(&self, vm_id: &str, device: &str, iso_path: Option<&str>) -> Result<()>;
    
    // =========================================================================
    // Migration
    // =========================================================================
    
    /// Migrate a VM to another host.
    async fn migrate_vm(&self, vm_id: &str, target_uri: &str, live: bool) -> Result<()>;
    
    // =========================================================================
    // Metrics
    // =========================================================================
    
    /// Get VM resource usage metrics.
    async fn get_vm_metrics(&self, vm_id: &str) -> Result<VmMetrics>;
}

