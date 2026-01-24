//! iSCSI storage backend.
//!
//! This backend connects to iSCSI targets and uses LVM for volume management.
//! It's suitable for enterprise SAN environments.
//!
//! ## Features
//! - iSCSI initiator management via `iscsiadm`
//! - CHAP authentication support
//! - LVM thin provisioning for efficient storage
//! - Block device volumes (no filesystem overhead)
//!
//! ## Prerequisites
//! - `open-iscsi` package installed
//! - `lvm2` package installed
//! - iSCSI target accessible from the node
//!
//! ## Example
//!
//! ```rust,ignore
//! use limiquantix_hypervisor::storage::{IscsiBackend, PoolConfig, StorageBackend};
//!
//! let backend = IscsiBackend::new();
//! let mut config = PoolConfig::default();
//! config.iscsi = Some(IscsiConfig {
//!     portal: "192.168.1.50:3260".into(),
//!     target: "iqn.2023-01.com.storage:ssd-pool".into(),
//!     chap_enabled: false,
//!     ..Default::default()
//! });
//!
//! backend.init_pool("pool-123", &config).await?;
//! backend.create_volume("pool-123", "vol-456", 50 * 1024 * 1024 * 1024, None).await?;
//! ```

use std::collections::HashMap;
use std::process::Command;
use std::sync::Arc;
use async_trait::async_trait;
use tokio::sync::RwLock;
use tracing::{debug, error, info, instrument, warn};

use crate::error::{HypervisorError, Result};
use super::types::{PoolConfig, PoolInfo, PoolType, VolumeAttachInfo, VolumeSource, VolumeInfo};
use super::traits::StorageBackend;

/// Cached iSCSI pool state.
#[derive(Debug, Clone)]
struct IscsiPoolState {
    /// iSCSI portal address (e.g., "192.168.1.50:3260")
    portal: String,
    /// Target IQN
    target: String,
    /// CHAP authentication enabled
    chap_enabled: bool,
    /// CHAP username
    chap_user: String,
    /// LUN to use
    lun: u32,
    /// LVM Volume Group name
    volume_group: String,
    /// Device path (e.g., /dev/sdb)
    device_path: Option<String>,
}

/// iSCSI storage backend.
///
/// Provides block storage using iSCSI targets with LVM for volume management.
/// This is the recommended backend for enterprise SAN environments.
pub struct IscsiBackend {
    /// Cached pool configurations keyed by pool_id
    pools: Arc<RwLock<HashMap<String, IscsiPoolState>>>,
    /// iscsiadm binary path
    iscsiadm_path: String,
}

impl IscsiBackend {
    /// Create a new iSCSI backend with default settings.
    pub fn new() -> Self {
        Self {
            pools: Arc::new(RwLock::new(HashMap::new())),
            iscsiadm_path: "iscsiadm".to_string(),
        }
    }
    
    /// Get the LVM logical volume path.
    fn lv_path(&self, state: &IscsiPoolState, volume_id: &str) -> String {
        format!("/dev/{}/{}", state.volume_group, volume_id)
    }
    
    /// Get the LVM thin pool name for a volume group.
    fn thin_pool_name(&self, pool_id: &str) -> String {
        format!("thin_{}", pool_id.replace('-', "_"))
    }
    
    /// Run a command and return output.
    fn run_cmd(&self, cmd: &str, args: &[&str]) -> Result<String> {
        debug!(command = %cmd, args = ?args, "Executing command");
        
        let output = Command::new(cmd)
            .args(args)
            .output()
            .map_err(|e| HypervisorError::Internal(format!("Failed to execute {}: {}", cmd, e)))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!(command = %cmd, stderr = %stderr, "Command failed");
            return Err(HypervisorError::Internal(format!("{} failed: {}", cmd, stderr)));
        }
        
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
    
    /// Get pool state from cache.
    async fn get_pool_state(&self, pool_id: &str) -> Result<IscsiPoolState> {
        let pools = self.pools.read().await;
        pools.get(pool_id)
            .cloned()
            .ok_or_else(|| HypervisorError::Internal(format!("iSCSI pool {} not found in cache", pool_id)))
    }
    
    /// Discover iSCSI targets on a portal.
    #[instrument(skip(self), fields(portal = %portal))]
    fn discover_targets(&self, portal: &str) -> Result<Vec<String>> {
        info!("Discovering iSCSI targets");
        
        let output = self.run_cmd(
            &self.iscsiadm_path,
            &["-m", "discovery", "-t", "st", "-p", portal],
        )?;
        
        // Parse output: "192.168.1.50:3260,1 iqn.2023-01.com.storage:ssd-pool"
        let targets: Vec<String> = output
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                parts.get(1).map(|s| s.to_string())
            })
            .collect();
        
        info!(count = targets.len(), "Discovered targets");
        Ok(targets)
    }
    
    /// Login to an iSCSI target.
    #[instrument(skip(self, state), fields(portal = %state.portal, target = %state.target))]
    fn login(&self, state: &IscsiPoolState) -> Result<()> {
        info!("Logging into iSCSI target");
        
        // Set CHAP authentication if enabled
        if state.chap_enabled && !state.chap_user.is_empty() {
            self.run_cmd(
                &self.iscsiadm_path,
                &[
                    "-m", "node",
                    "-T", &state.target,
                    "-p", &state.portal,
                    "-o", "update",
                    "-n", "node.session.auth.authmethod",
                    "-v", "CHAP",
                ],
            )?;
            
            self.run_cmd(
                &self.iscsiadm_path,
                &[
                    "-m", "node",
                    "-T", &state.target,
                    "-p", &state.portal,
                    "-o", "update",
                    "-n", "node.session.auth.username",
                    "-v", &state.chap_user,
                ],
            )?;
        }
        
        // Login
        self.run_cmd(
            &self.iscsiadm_path,
            &["-m", "node", "-T", &state.target, "-p", &state.portal, "-l"],
        )?;
        
        info!("iSCSI login successful");
        Ok(())
    }
    
    /// Logout from an iSCSI target.
    #[instrument(skip(self, state), fields(target = %state.target))]
    fn logout(&self, state: &IscsiPoolState) -> Result<()> {
        info!("Logging out from iSCSI target");
        
        let result = self.run_cmd(
            &self.iscsiadm_path,
            &["-m", "node", "-T", &state.target, "-p", &state.portal, "-u"],
        );
        
        if let Err(e) = result {
            warn!(error = %e, "Logout failed (may not be logged in)");
        }
        
        Ok(())
    }
    
    /// Find the device path for an iSCSI session.
    #[instrument(skip(self, state), fields(target = %state.target))]
    fn find_device(&self, state: &IscsiPoolState) -> Result<String> {
        // Wait a moment for device to appear
        std::thread::sleep(std::time::Duration::from_secs(2));
        
        // Look for device in /dev/disk/by-path/
        let pattern = format!(
            "/dev/disk/by-path/ip-{}-iscsi-{}-lun-{}",
            state.portal, state.target, state.lun
        );
        
        debug!(pattern = %pattern, "Looking for iSCSI device");
        
        // Resolve symlink to actual device
        if let Ok(resolved) = std::fs::read_link(&pattern) {
            let device = resolved.to_string_lossy().to_string();
            // Convert relative path to absolute
            let actual_device = if device.starts_with("../../") {
                format!("/dev/{}", device.trim_start_matches("../../"))
            } else {
                device
            };
            info!(device = %actual_device, "Found iSCSI device");
            return Ok(actual_device);
        }
        
        // Fallback: scan /sys for iSCSI devices
        let output = self.run_cmd("lsblk", &["-d", "-n", "-o", "NAME,TRAN"])?;
        for line in output.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 && parts[1] == "iscsi" {
                let device = format!("/dev/{}", parts[0]);
                info!(device = %device, "Found iSCSI device via lsblk");
                return Ok(device);
            }
        }
        
        Err(HypervisorError::Internal("iSCSI device not found".into()))
    }
    
    /// Initialize LVM on the iSCSI device.
    #[instrument(skip(self, state), fields(device = ?state.device_path, vg = %state.volume_group))]
    fn init_lvm(&self, state: &IscsiPoolState, pool_id: &str) -> Result<()> {
        let device = state.device_path.as_ref()
            .ok_or_else(|| HypervisorError::Internal("No device path".into()))?;
        
        // Check if VG already exists
        let vg_check = self.run_cmd("vgs", &["--noheadings", "-o", "vg_name", &state.volume_group]);
        if vg_check.is_ok() {
            info!(vg = %state.volume_group, "Volume group already exists");
            return Ok(());
        }
        
        info!("Initializing LVM on iSCSI device");
        
        // Create physical volume
        self.run_cmd("pvcreate", &["-f", device])?;
        
        // Create volume group
        self.run_cmd("vgcreate", &[&state.volume_group, device])?;
        
        // Create thin pool for efficient thin provisioning
        let thin_pool = self.thin_pool_name(pool_id);
        
        // Get VG size
        let vg_info = self.run_cmd("vgs", &["--noheadings", "-o", "vg_free", "--units", "b", &state.volume_group])?;
        let vg_free: u64 = vg_info.trim().trim_end_matches('B').parse().unwrap_or(0);
        
        // Create thin pool using 90% of available space
        let thin_size = (vg_free as f64 * 0.9) as u64;
        let thin_size_str = format!("{}B", thin_size);
        
        self.run_cmd("lvcreate", &[
            "-T",
            "-L", &thin_size_str,
            &format!("{}/{}", state.volume_group, thin_pool),
        ])?;
        
        info!(vg = %state.volume_group, thin_pool = %thin_pool, "LVM initialized");
        Ok(())
    }
    
    /// Get VG capacity.
    fn get_vg_capacity(&self, vg_name: &str) -> Result<(u64, u64)> {
        let output = self.run_cmd("vgs", &[
            "--noheadings",
            "-o", "vg_size,vg_free",
            "--units", "b",
            vg_name,
        ])?;
        
        let parts: Vec<&str> = output.trim().split_whitespace().collect();
        if parts.len() < 2 {
            return Err(HypervisorError::Internal("Failed to parse vgs output".into()));
        }
        
        let total: u64 = parts[0].trim_end_matches('B').parse().unwrap_or(0);
        let available: u64 = parts[1].trim_end_matches('B').parse().unwrap_or(0);
        
        Ok((total, available))
    }
    
    /// Create a thin LV.
    #[instrument(skip(self, state), fields(volume_id = %volume_id, size = %size_bytes))]
    fn create_thin_lv(&self, state: &IscsiPoolState, pool_id: &str, volume_id: &str, size_bytes: u64) -> Result<String> {
        let thin_pool = self.thin_pool_name(pool_id);
        let size_str = format!("{}B", size_bytes);
        
        info!("Creating thin LV");
        
        self.run_cmd("lvcreate", &[
            "-T",
            &format!("{}/{}", state.volume_group, thin_pool),
            "-n", volume_id,
            "-V", &size_str,
        ])?;
        
        let lv_path = self.lv_path(state, volume_id);
        info!(path = %lv_path, "Thin LV created");
        
        Ok(lv_path)
    }
    
    /// Create a snapshot LV.
    fn create_snapshot_lv(&self, state: &IscsiPoolState, source_lv: &str, snapshot_name: &str) -> Result<String> {
        let size_str = "1G"; // Snapshot initially small, grows as needed
        
        info!(source = %source_lv, snapshot = %snapshot_name, "Creating snapshot LV");
        
        self.run_cmd("lvcreate", &[
            "-s",
            "-n", snapshot_name,
            "-L", size_str,
            &format!("{}/{}", state.volume_group, source_lv),
        ])?;
        
        let snap_path = self.lv_path(state, snapshot_name);
        info!(path = %snap_path, "Snapshot LV created");
        
        Ok(snap_path)
    }
}

impl Default for IscsiBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl StorageBackend for IscsiBackend {
    #[instrument(skip(self, config), fields(pool_id = %pool_id))]
    async fn init_pool(&self, pool_id: &str, config: &PoolConfig) -> Result<PoolInfo> {
        let iscsi_config = config.iscsi.as_ref()
            .ok_or_else(|| HypervisorError::InvalidConfig("iSCSI config required".into()))?;
        
        // Validate configuration
        if iscsi_config.portal.is_empty() {
            return Err(HypervisorError::InvalidConfig("iSCSI portal is required".into()));
        }
        if iscsi_config.target.is_empty() {
            return Err(HypervisorError::InvalidConfig("iSCSI target is required".into()));
        }
        
        // Generate VG name if not provided
        let vg_name = if let Some(ref vg) = iscsi_config.volume_group {
            if !vg.is_empty() {
                vg.clone()
            } else {
                format!("vg_{}", pool_id.replace('-', "_"))
            }
        } else {
            format!("vg_{}", pool_id.replace('-', "_"))
        };
        
        // Create pool state
        let mut state = IscsiPoolState {
            portal: iscsi_config.portal.clone(),
            target: iscsi_config.target.clone(),
            chap_enabled: iscsi_config.chap_enabled,
            chap_user: iscsi_config.chap_user.clone(),
            lun: iscsi_config.lun,
            volume_group: vg_name.clone(),
            device_path: None,
        };
        
        info!(
            pool_id = %pool_id,
            portal = %state.portal,
            target = %state.target,
            "Initializing iSCSI pool"
        );
        
        // Discover and verify target exists
        let targets = self.discover_targets(&state.portal)?;
        if !targets.contains(&state.target) {
            return Err(HypervisorError::Internal(format!(
                "Target {} not found on portal {}. Available: {:?}",
                state.target, state.portal, targets
            )));
        }
        
        // Login to target
        self.login(&state)?;
        
        // Find device path
        let device_path = self.find_device(&state)?;
        state.device_path = Some(device_path.clone());
        
        // Initialize LVM
        self.init_lvm(&state, pool_id)?;
        
        // Get capacity
        let (total_bytes, available_bytes) = self.get_vg_capacity(&state.volume_group)?;
        
        // Cache state
        {
            let mut pools = self.pools.write().await;
            pools.insert(pool_id.to_string(), state.clone());
        }
        
        info!(
            pool_id = %pool_id,
            device = %device_path,
            vg = %vg_name,
            total_gb = total_bytes / 1024 / 1024 / 1024,
            "iSCSI pool initialized"
        );
        
        Ok(PoolInfo {
            pool_id: pool_id.to_string(),
            name: config.name.clone(),
            pool_type: PoolType::Iscsi,
            mount_path: None,
            device_path: Some(device_path),
            rbd_pool: None,
            total_bytes,
            available_bytes,
            volume_count: 0, // Will be updated by list_volumes
        })
    }
    
    async fn destroy_pool(&self, pool_id: &str) -> Result<()> {
        let state = {
            let pools = self.pools.read().await;
            pools.get(pool_id).cloned()
        };
        
        if let Some(state) = state {
            // Logout from iSCSI (leaves VG/LVs intact)
            self.logout(&state)?;
            
            // Remove from cache
            let mut pools = self.pools.write().await;
            pools.remove(pool_id);
            
            info!(pool_id = %pool_id, "iSCSI pool destroyed");
        } else {
            warn!(pool_id = %pool_id, "Pool not found in cache");
        }
        
        Ok(())
    }
    
    async fn get_pool_info(&self, pool_id: &str) -> Result<PoolInfo> {
        let state = self.get_pool_state(pool_id).await?;
        let (total_bytes, available_bytes) = self.get_vg_capacity(&state.volume_group)?;
        
        Ok(PoolInfo {
            pool_id: pool_id.to_string(),
            name: None, // Name is preserved from init via refresh_pool_info
            pool_type: PoolType::Iscsi,
            mount_path: None,
            device_path: state.device_path.clone(),
            rbd_pool: None,
            total_bytes,
            available_bytes,
            volume_count: 0, // Will be updated by list_volumes
        })
    }
    
    async fn list_volumes(&self, pool_id: &str) -> Result<Vec<VolumeInfo>> {
        let state = self.get_pool_state(pool_id).await?;
        
        // Use lvs to list logical volumes in the VG
        let output = Command::new("lvs")
            .args(&[
                "--noheadings",
                "--units", "b",
                "--separator", ",",
                "-o", "lv_name,lv_size,lv_path",
                &state.volume_group,
            ])
            .output()
            .map_err(|e| HypervisorError::Internal(format!("lvs command failed: {}", e)))?;
        
        if !output.status.success() {
            return Ok(Vec::new());
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut volumes = Vec::new();
        
        for line in stdout.lines() {
            let parts: Vec<&str> = line.trim().split(',').collect();
            if parts.len() >= 3 {
                let name = parts[0].trim().to_string();
                let size_str = parts[1].trim().trim_end_matches('B');
                let capacity: u64 = size_str.parse().unwrap_or(0);
                let path = parts[2].trim().to_string();
                
                volumes.push(VolumeInfo {
                    name,
                    path,
                    capacity,
                    allocation: capacity, // LVM thin provisioning would need separate tracking
                    format: Some("lvm".to_string()),
                });
            }
        }
        
        Ok(volumes)
    }
    
    #[instrument(skip(self, source), fields(pool_id = %pool_id, volume_id = %volume_id, size_bytes = %size_bytes))]
    async fn create_volume(
        &self,
        pool_id: &str,
        volume_id: &str,
        size_bytes: u64,
        source: Option<&VolumeSource>,
    ) -> Result<()> {
        let state = self.get_pool_state(pool_id).await?;
        
        match source {
            Some(VolumeSource::Clone(source_id)) => {
                // Create LVM snapshot for cloning
                self.create_snapshot_lv(&state, source_id, volume_id)?;
            }
            Some(VolumeSource::Image(image_path)) => {
                // Create LV and dd the image
                let lv_path = self.create_thin_lv(&state, pool_id, volume_id, size_bytes)?;
                
                info!(image = %image_path, lv = %lv_path, "Copying image to LV");
                
                // Use qemu-img to convert image to raw and write to LV
                self.run_cmd("qemu-img", &[
                    "convert",
                    "-O", "raw",
                    image_path,
                    &lv_path,
                ])?;
                
                info!("Image copied to LV");
            }
            Some(VolumeSource::Snapshot(snapshot_id)) => {
                // Create from snapshot
                self.create_snapshot_lv(&state, snapshot_id, volume_id)?;
            }
            None => {
                // Create empty thin LV
                if size_bytes == 0 {
                    return Err(HypervisorError::InvalidConfig(
                        "Volume size must be greater than 0".into()
                    ));
                }
                self.create_thin_lv(&state, pool_id, volume_id, size_bytes)?;
            }
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, "iSCSI volume created");
        Ok(())
    }
    
    async fn delete_volume(&self, pool_id: &str, volume_id: &str) -> Result<()> {
        let state = self.get_pool_state(pool_id).await?;
        let lv_path = format!("{}/{}", state.volume_group, volume_id);
        
        info!(lv = %lv_path, "Deleting LV");
        
        // Remove LV
        self.run_cmd("lvremove", &["-f", &lv_path])?;
        
        info!(pool_id = %pool_id, volume_id = %volume_id, "iSCSI volume deleted");
        Ok(())
    }
    
    async fn resize_volume(&self, pool_id: &str, volume_id: &str, new_size_bytes: u64) -> Result<()> {
        let state = self.get_pool_state(pool_id).await?;
        let lv_path = format!("{}/{}", state.volume_group, volume_id);
        let size_str = format!("{}B", new_size_bytes);
        
        info!(lv = %lv_path, new_size = %size_str, "Resizing LV");
        
        self.run_cmd("lvresize", &["-L", &size_str, "-f", &lv_path])?;
        
        info!(pool_id = %pool_id, volume_id = %volume_id, "iSCSI volume resized");
        Ok(())
    }
    
    async fn get_attach_info(&self, pool_id: &str, volume_id: &str) -> Result<VolumeAttachInfo> {
        let state = self.get_pool_state(pool_id).await?;
        let lv_path = self.lv_path(&state, volume_id);
        
        // Verify LV exists
        let lv_check = self.run_cmd("lvs", &["--noheadings", "-o", "lv_name", &format!("{}/{}", state.volume_group, volume_id)]);
        if lv_check.is_err() {
            return Err(HypervisorError::InvalidConfig(format!("Volume {} not found", volume_id)));
        }
        
        // iSCSI uses block device XML
        let disk_xml = format!(
            r#"    <disk type='block' device='disk'>
      <driver name='qemu' type='raw' cache='none' io='native'/>
      <source dev='{}'/>
      <target dev='vdX' bus='virtio'/>
    </disk>"#,
            lv_path
        );
        
        Ok(VolumeAttachInfo {
            volume_id: volume_id.to_string(),
            disk_xml,
            path: lv_path,
        })
    }
    
    async fn clone_volume(
        &self,
        pool_id: &str,
        source_volume_id: &str,
        dest_volume_id: &str,
    ) -> Result<()> {
        self.create_volume(
            pool_id,
            dest_volume_id,
            0,
            Some(&VolumeSource::Clone(source_volume_id.to_string())),
        ).await
    }
    
    async fn create_snapshot(
        &self,
        pool_id: &str,
        volume_id: &str,
        snapshot_id: &str,
    ) -> Result<()> {
        let state = self.get_pool_state(pool_id).await?;
        
        // Create LVM snapshot
        let snapshot_name = format!("{}_{}", volume_id, snapshot_id);
        self.create_snapshot_lv(&state, volume_id, &snapshot_name)?;
        
        info!(
            pool_id = %pool_id,
            volume_id = %volume_id,
            snapshot_id = %snapshot_id,
            "iSCSI snapshot created"
        );
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_lv_path() {
        let backend = IscsiBackend::new();
        let state = IscsiPoolState {
            portal: "192.168.1.50:3260".to_string(),
            target: "iqn.2023-01.com.storage:pool".to_string(),
            chap_enabled: false,
            chap_user: String::new(),
            lun: 0,
            volume_group: "vg_pool1".to_string(),
            device_path: Some("/dev/sdb".to_string()),
        };
        
        assert_eq!(backend.lv_path(&state, "vol-123"), "/dev/vg_pool1/vol-123");
    }
    
    #[test]
    fn test_thin_pool_name() {
        let backend = IscsiBackend::new();
        assert_eq!(backend.thin_pool_name("pool-123-abc"), "thin_pool_123_abc");
    }
}
