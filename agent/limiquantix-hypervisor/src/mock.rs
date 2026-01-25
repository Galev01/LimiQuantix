//! Mock hypervisor backend for testing and development.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::Duration;
use tracing::{debug, info, instrument};

use crate::error::{HypervisorError, Result};
use crate::traits::{Hypervisor, HypervisorCapabilities};
use crate::types::*;

/// Mock hypervisor backend for testing.
///
/// This backend simulates VM operations in memory without requiring
/// an actual hypervisor. Useful for:
/// - Unit and integration testing
/// - Development without libvirt installed
/// - Demo environments
pub struct MockBackend {
    vms: RwLock<HashMap<String, MockVm>>,
    snapshots: RwLock<HashMap<String, Vec<SnapshotInfo>>>,
}

struct MockVm {
    config: VmConfig,
    state: VmState,
    cpu_time_ns: u64,
    memory_rss_bytes: u64,
}

impl MockBackend {
    /// Create a new mock backend.
    pub fn new() -> Self {
        info!("Creating mock hypervisor backend");
        Self {
            vms: RwLock::new(HashMap::new()),
            snapshots: RwLock::new(HashMap::new()),
        }
    }
}

impl Default for MockBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Hypervisor for MockBackend {
    async fn capabilities(&self) -> Result<HypervisorCapabilities> {
        Ok(HypervisorCapabilities {
            name: "mock".to_string(),
            version: "1.0.0".to_string(),
            supports_live_migration: true,
            supports_snapshots: true,
            supports_hotplug: true,
            supports_gpu_passthrough: false,
            supports_nested_virtualization: false,
            max_vcpus: 256,
            max_memory_bytes: 1024 * 1024 * 1024 * 1024, // 1TB
        })
    }
    
    async fn health_check(&self) -> Result<bool> {
        Ok(true)
    }
    
    #[instrument(skip(self, config), fields(vm_id = %config.id, vm_name = %config.name))]
    async fn create_vm(&self, config: VmConfig) -> Result<String> {
        info!("Creating mock VM");
        
        let vm_id = config.id.clone();
        let mut vms = self.vms.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        if vms.contains_key(&vm_id) {
            return Err(HypervisorError::CreateFailed(
                format!("VM {} already exists", vm_id)
            ));
        }
        
        vms.insert(vm_id.clone(), MockVm {
            config,
            state: VmState::Stopped,
            cpu_time_ns: 0,
            memory_rss_bytes: 0,
        });
        
        info!(vm_id = %vm_id, "Mock VM created");
        Ok(vm_id)
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn start_vm(&self, vm_id: &str) -> Result<()> {
        info!("Starting mock VM");
        
        let mut vms = self.vms.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get_mut(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        if vm.state == VmState::Running {
            return Err(HypervisorError::InvalidState("VM is already running".to_string()));
        }
        
        vm.state = VmState::Running;
        vm.memory_rss_bytes = vm.config.memory.size_mib * 1024 * 1024;
        
        info!("Mock VM started");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id, timeout_secs = timeout.as_secs()))]
    async fn stop_vm(&self, vm_id: &str, timeout: Duration) -> Result<()> {
        info!("Stopping mock VM gracefully");
        
        // Simulate graceful shutdown delay
        tokio::time::sleep(Duration::from_millis(100).min(timeout)).await;
        
        let mut vms = self.vms.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get_mut(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        vm.state = VmState::Stopped;
        vm.memory_rss_bytes = 0;
        
        info!("Mock VM stopped");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn force_stop_vm(&self, vm_id: &str) -> Result<()> {
        info!("Force stopping mock VM");
        
        let mut vms = self.vms.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get_mut(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        vm.state = VmState::Stopped;
        vm.memory_rss_bytes = 0;
        
        info!("Mock VM force stopped");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn reboot_vm(&self, vm_id: &str) -> Result<()> {
        info!("Rebooting mock VM");
        
        // Check if VM exists (release lock before await)
        {
            let vms = self.vms.read().map_err(|_| {
                HypervisorError::Internal("Lock poisoned".to_string())
            })?;
            
            if !vms.contains_key(vm_id) {
                return Err(HypervisorError::VmNotFound(vm_id.to_string()));
            }
        }
        
        // Simulate reboot delay
        tokio::time::sleep(Duration::from_millis(100)).await;
        
        info!("Mock VM rebooted");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn pause_vm(&self, vm_id: &str) -> Result<()> {
        info!("Pausing mock VM");
        
        let mut vms = self.vms.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get_mut(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        if vm.state != VmState::Running {
            return Err(HypervisorError::InvalidState("VM is not running".to_string()));
        }
        
        vm.state = VmState::Paused;
        info!("Mock VM paused");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn resume_vm(&self, vm_id: &str) -> Result<()> {
        info!("Resuming mock VM");
        
        let mut vms = self.vms.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get_mut(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        if vm.state != VmState::Paused {
            return Err(HypervisorError::InvalidState("VM is not paused".to_string()));
        }
        
        vm.state = VmState::Running;
        info!("Mock VM resumed");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn delete_vm(&self, vm_id: &str) -> Result<()> {
        info!("Deleting mock VM");
        
        let mut vms = self.vms.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        if vm.state == VmState::Running {
            return Err(HypervisorError::InvalidState(
                "VM must be stopped before deletion".to_string()
            ));
        }
        
        vms.remove(vm_id);
        
        // Also remove snapshots
        let mut snapshots = self.snapshots.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        snapshots.remove(vm_id);
        
        info!("Mock VM deleted");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn get_vm_status(&self, vm_id: &str) -> Result<VmStatus> {
        let vms = self.vms.read().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        Ok(VmStatus {
            id: vm_id.to_string(),
            name: vm.config.name.clone(),
            state: vm.state,
            cpu_time_ns: vm.cpu_time_ns,
            memory_rss_bytes: vm.memory_rss_bytes,
            memory_max_bytes: vm.config.memory.size_mib * 1024 * 1024,
            disks: vm.config.disks.clone(),
        })
    }
    
    async fn list_vms(&self) -> Result<Vec<VmInfo>> {
        let vms = self.vms.read().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let result: Vec<VmInfo> = vms.iter().map(|(id, vm)| {
            VmInfo {
                id: id.clone(),
                name: vm.config.name.clone(),
                state: vm.state,
            }
        }).collect();
        
        debug!(count = result.len(), "Listed VMs");
        Ok(result)
    }
    
    async fn vm_exists(&self, vm_id: &str) -> Result<bool> {
        let vms = self.vms.read().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        Ok(vms.contains_key(vm_id))
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn get_console(&self, vm_id: &str) -> Result<ConsoleInfo> {
        let vms = self.vms.read().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        Ok(ConsoleInfo {
            console_type: ConsoleType::Vnc,
            host: "127.0.0.1".to_string(),
            port: vm.config.console.vnc_port.unwrap_or(5900),
            password: vm.config.console.vnc_password.clone(),
            websocket_path: Some(format!("/websockify?token={}", vm_id)),
        })
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id, snapshot_name = %name, disk_only = %disk_only))]
    async fn create_snapshot(
        &self,
        vm_id: &str,
        name: &str,
        description: &str,
        disk_only: bool,
    ) -> Result<SnapshotInfo> {
        info!("Creating snapshot (disk_only={})", disk_only);
        
        let vms = self.vms.read().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        let snapshot = SnapshotInfo {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            description: description.to_string(),
            created_at: chrono::Utc::now(),
            vm_state: vm.state,
            parent_id: None,
        };
        
        drop(vms);
        
        let mut snapshots = self.snapshots.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        snapshots.entry(vm_id.to_string())
            .or_default()
            .push(snapshot.clone());
        
        info!(snapshot_id = %snapshot.id, disk_only = %disk_only, "Snapshot created");
        Ok(snapshot)
    }
    
    async fn revert_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()> {
        info!(vm_id = %vm_id, snapshot_id = %snapshot_id, "Reverting to snapshot");
        
        // Get snapshot state (release lock before acquiring vms lock)
        let snapshot_state = {
            let snapshots = self.snapshots.read().map_err(|_| {
                HypervisorError::Internal("Lock poisoned".to_string())
            })?;
            
            let vm_snapshots = snapshots.get(vm_id)
                .ok_or_else(|| HypervisorError::SnapshotFailed(
                    format!("No snapshots for VM {}", vm_id)
                ))?;
            
            let snapshot = vm_snapshots.iter()
                .find(|s| s.id == snapshot_id)
                .ok_or_else(|| HypervisorError::SnapshotFailed(
                    format!("Snapshot {} not found", snapshot_id)
                ))?;
            
            snapshot.vm_state
        };
        
        let mut vms = self.vms.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get_mut(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        vm.state = snapshot_state;
        
        info!("Reverted to snapshot");
        Ok(())
    }
    
    async fn delete_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()> {
        info!(vm_id = %vm_id, snapshot_id = %snapshot_id, "Deleting snapshot");
        
        let mut snapshots = self.snapshots.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm_snapshots = snapshots.get_mut(vm_id)
            .ok_or_else(|| HypervisorError::SnapshotFailed(
                format!("No snapshots for VM {}", vm_id)
            ))?;
        
        let idx = vm_snapshots.iter()
            .position(|s| s.id == snapshot_id)
            .ok_or_else(|| HypervisorError::SnapshotFailed(
                format!("Snapshot {} not found", snapshot_id)
            ))?;
        
        vm_snapshots.remove(idx);
        
        info!("Snapshot deleted");
        Ok(())
    }
    
    async fn list_snapshots(&self, vm_id: &str) -> Result<Vec<SnapshotInfo>> {
        let snapshots = self.snapshots.read().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        Ok(snapshots.get(vm_id).cloned().unwrap_or_default())
    }
    
    async fn attach_disk(&self, vm_id: &str, disk: DiskConfig) -> Result<()> {
        info!(vm_id = %vm_id, disk_id = %disk.id, "Attaching disk");
        
        let mut vms = self.vms.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get_mut(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        vm.config.disks.push(disk);
        
        info!("Disk attached");
        Ok(())
    }
    
    async fn detach_disk(&self, vm_id: &str, disk_id: &str) -> Result<()> {
        info!(vm_id = %vm_id, disk_id = %disk_id, "Detaching disk");
        
        let mut vms = self.vms.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get_mut(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        vm.config.disks.retain(|d| d.id != disk_id);
        
        info!("Disk detached");
        Ok(())
    }
    
    async fn attach_nic(&self, vm_id: &str, nic: NicConfig) -> Result<()> {
        info!(vm_id = %vm_id, nic_id = %nic.id, "Attaching NIC");
        
        let mut vms = self.vms.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get_mut(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        vm.config.nics.push(nic);
        
        info!("NIC attached");
        Ok(())
    }
    
    async fn detach_nic(&self, vm_id: &str, nic_id: &str) -> Result<()> {
        info!(vm_id = %vm_id, nic_id = %nic_id, "Detaching NIC");
        
        let mut vms = self.vms.write().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get_mut(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        vm.config.nics.retain(|n| n.id != nic_id);
        
        info!("NIC detached");
        Ok(())
    }
    
    async fn change_media(&self, vm_id: &str, device: &str, iso_path: Option<&str>) -> Result<()> {
        info!(
            vm_id = %vm_id,
            device = %device,
            iso_path = ?iso_path,
            "Changing CD-ROM media"
        );
        
        let vms = self.vms.read().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        // Just verify VM exists
        if !vms.contains_key(vm_id) {
            return Err(HypervisorError::VmNotFound(vm_id.to_string()));
        }
        
        if iso_path.is_some() {
            info!("ISO mounted (mock)");
        } else {
            info!("CD-ROM ejected (mock)");
        }
        
        Ok(())
    }
    
    async fn migrate_vm(&self, vm_id: &str, target_uri: &str, live: bool) -> Result<()> {
        info!(
            vm_id = %vm_id, 
            target = %target_uri, 
            live = %live, 
            "Simulating VM migration"
        );
        
        // Simulate migration delay
        tokio::time::sleep(Duration::from_millis(500)).await;
        
        info!("Mock migration complete");
        Ok(())
    }
    
    async fn get_vm_metrics(&self, vm_id: &str) -> Result<VmMetrics> {
        let vms = self.vms.read().map_err(|_| {
            HypervisorError::Internal("Lock poisoned".to_string())
        })?;
        
        let vm = vms.get(vm_id)
            .ok_or_else(|| HypervisorError::VmNotFound(vm_id.to_string()))?;
        
        // Generate mock metrics
        Ok(VmMetrics {
            vm_id: vm_id.to_string(),
            cpu_usage_percent: if vm.state == VmState::Running { 15.5 } else { 0.0 },
            memory_used_bytes: vm.memory_rss_bytes,
            memory_total_bytes: vm.config.memory.size_mib * 1024 * 1024,
            disk_read_bytes: 1024 * 1024 * 100,
            disk_write_bytes: 1024 * 1024 * 50,
            network_rx_bytes: 1024 * 1024 * 10,
            network_tx_bytes: 1024 * 1024 * 5,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_create_vm() {
        let backend = MockBackend::new();
        let config = VmConfig::new("test-vm");
        
        let vm_id = backend.create_vm(config).await.unwrap();
        assert!(!vm_id.is_empty());
        
        let exists = backend.vm_exists(&vm_id).await.unwrap();
        assert!(exists);
    }
    
    #[tokio::test]
    async fn test_vm_lifecycle() {
        let backend = MockBackend::new();
        let config = VmConfig::new("lifecycle-test");
        
        // Create
        let vm_id = backend.create_vm(config).await.unwrap();
        let status = backend.get_vm_status(&vm_id).await.unwrap();
        assert_eq!(status.state, VmState::Stopped);
        
        // Start
        backend.start_vm(&vm_id).await.unwrap();
        let status = backend.get_vm_status(&vm_id).await.unwrap();
        assert_eq!(status.state, VmState::Running);
        
        // Pause
        backend.pause_vm(&vm_id).await.unwrap();
        let status = backend.get_vm_status(&vm_id).await.unwrap();
        assert_eq!(status.state, VmState::Paused);
        
        // Resume
        backend.resume_vm(&vm_id).await.unwrap();
        let status = backend.get_vm_status(&vm_id).await.unwrap();
        assert_eq!(status.state, VmState::Running);
        
        // Stop
        backend.stop_vm(&vm_id, Duration::from_secs(5)).await.unwrap();
        let status = backend.get_vm_status(&vm_id).await.unwrap();
        assert_eq!(status.state, VmState::Stopped);
        
        // Delete
        backend.delete_vm(&vm_id).await.unwrap();
        let exists = backend.vm_exists(&vm_id).await.unwrap();
        assert!(!exists);
    }
    
    #[tokio::test]
    async fn test_snapshots() {
        let backend = MockBackend::new();
        let config = VmConfig::new("snapshot-test");
        
        let vm_id = backend.create_vm(config).await.unwrap();
        backend.start_vm(&vm_id).await.unwrap();
        
        // Create snapshot (disk_only = false for full snapshot)
        let snapshot = backend.create_snapshot(&vm_id, "snap1", "Test snapshot", false).await.unwrap();
        assert_eq!(snapshot.name, "snap1");
        assert_eq!(snapshot.vm_state, VmState::Running);
        
        // List snapshots
        let snapshots = backend.list_snapshots(&vm_id).await.unwrap();
        assert_eq!(snapshots.len(), 1);
        
        // Stop VM
        backend.stop_vm(&vm_id, Duration::from_secs(5)).await.unwrap();
        
        // Revert to snapshot
        backend.revert_snapshot(&vm_id, &snapshot.id).await.unwrap();
        let status = backend.get_vm_status(&vm_id).await.unwrap();
        assert_eq!(status.state, VmState::Running);
        
        // Delete snapshot
        backend.delete_snapshot(&vm_id, &snapshot.id).await.unwrap();
        let snapshots = backend.list_snapshots(&vm_id).await.unwrap();
        assert!(snapshots.is_empty());
    }
}

