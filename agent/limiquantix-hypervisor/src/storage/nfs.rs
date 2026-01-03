//! NFS storage backend.
//!
//! This backend mounts NFS shares and stores disk images as QCOW2 files.
//! It's suitable for enterprise shared storage environments.
//!
//! ## Features
//! - Supports NFS v3, v4, v4.1, v4.2
//! - Automatic mount/unmount lifecycle
//! - QCOW2 disk images with copy-on-write cloning
//! - Configurable mount options for performance tuning
//!
//! ## Example
//!
//! ```rust,ignore
//! use limiquantix_hypervisor::storage::{NfsBackend, PoolConfig, StorageBackend};
//!
//! let backend = NfsBackend::new();
//! let config = PoolConfig::nfs("192.168.1.50", "/mnt/ssd-pool");
//!
//! backend.init_pool("pool-123", &config).await?;
//! backend.create_volume("pool-123", "vol-456", 50 * 1024 * 1024 * 1024, None).await?;
//! ```

use std::path::{Path, PathBuf};
use std::process::Command;
use async_trait::async_trait;
use tracing::{debug, info, instrument, warn};

use crate::error::{HypervisorError, Result};
use super::types::{PoolConfig, PoolInfo, PoolType, VolumeAttachInfo, VolumeSource};
use super::traits::StorageBackend;

/// Base path for NFS mount points.
const NFS_MOUNT_BASE: &str = "/var/lib/limiquantix/pools";

/// NFS storage backend.
///
/// Mounts NFS shares and uses them for storing QCOW2 disk images.
pub struct NfsBackend {
    /// Base path for mount points
    mount_base: PathBuf,
    /// qemu-img binary path
    qemu_img_path: String,
}

impl NfsBackend {
    /// Create a new NFS backend with default paths.
    pub fn new() -> Self {
        Self {
            mount_base: PathBuf::from(NFS_MOUNT_BASE),
            qemu_img_path: "qemu-img".to_string(),
        }
    }
    
    /// Create an NFS backend with a custom mount base path.
    pub fn with_mount_base(mount_base: impl Into<PathBuf>) -> Self {
        Self {
            mount_base: mount_base.into(),
            qemu_img_path: "qemu-img".to_string(),
        }
    }
    
    /// Get the mount point for a pool.
    fn mount_point(&self, pool_id: &str) -> PathBuf {
        self.mount_base.join(pool_id)
    }
    
    /// Get the volume path within a mounted pool.
    fn volume_path(&self, pool_id: &str, volume_id: &str) -> PathBuf {
        self.mount_point(pool_id).join(format!("{}.qcow2", volume_id))
    }
    
    /// Mount an NFS share.
    #[instrument(skip(self), fields(pool_id = %pool_id, server = %server, export = %export_path))]
    fn mount_nfs(
        &self,
        pool_id: &str,
        server: &str,
        export_path: &str,
        version: &str,
        options: &str,
    ) -> Result<PathBuf> {
        let mount_point = self.mount_point(pool_id);
        
        // Create mount point directory
        std::fs::create_dir_all(&mount_point)
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to create mount point: {}", e)
            ))?;
        
        // Check if already mounted
        if self.is_mounted(&mount_point)? {
            info!(pool_id = %pool_id, "NFS already mounted");
            return Ok(mount_point);
        }
        
        // Build mount options
        let mut mount_opts = vec![format!("vers={}", version)];
        if !options.is_empty() {
            mount_opts.push(options.to_string());
        }
        let opts_str = mount_opts.join(",");
        
        // Build source string
        let source = format!("{}:{}", server, export_path);
        
        info!(
            source = %source,
            mount_point = %mount_point.display(),
            options = %opts_str,
            "Mounting NFS share"
        );
        
        // Execute mount command
        let output = Command::new("mount")
            .arg("-t").arg("nfs")
            .arg("-o").arg(&opts_str)
            .arg(&source)
            .arg(&mount_point)
            .output()
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to execute mount: {}", e)
            ))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(
                format!("NFS mount failed: {}", stderr)
            ));
        }
        
        info!(
            pool_id = %pool_id,
            source = %source,
            mount_point = %mount_point.display(),
            "NFS mounted successfully"
        );
        
        Ok(mount_point)
    }
    
    /// Unmount an NFS share.
    #[instrument(skip(self), fields(pool_id = %pool_id))]
    fn unmount_nfs(&self, pool_id: &str) -> Result<()> {
        let mount_point = self.mount_point(pool_id);
        
        if !self.is_mounted(&mount_point)? {
            debug!(pool_id = %pool_id, "NFS not mounted, nothing to unmount");
            return Ok(());
        }
        
        info!(mount_point = %mount_point.display(), "Unmounting NFS share");
        
        let output = Command::new("umount")
            .arg(&mount_point)
            .output()
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to execute umount: {}", e)
            ))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(
                format!("NFS unmount failed: {}", stderr)
            ));
        }
        
        // Remove mount point directory
        if let Err(e) = std::fs::remove_dir(&mount_point) {
            warn!(error = %e, "Failed to remove mount point directory");
        }
        
        info!(pool_id = %pool_id, "NFS unmounted successfully");
        Ok(())
    }
    
    /// Check if a path is a mount point.
    fn is_mounted(&self, path: &Path) -> Result<bool> {
        if !path.exists() {
            return Ok(false);
        }
        
        let output = Command::new("mountpoint")
            .arg("-q")
            .arg(path)
            .status()
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to check mount: {}", e)
            ))?;
        
        Ok(output.success())
    }
    
    /// Get filesystem stats for a path.
    fn get_fs_stats(&self, path: &Path) -> Result<(u64, u64)> {
        let output = Command::new("df")
            .arg("--output=size,avail")
            .arg("-B1")
            .arg(path)
            .output()
            .map_err(|e| HypervisorError::Internal(format!("df command failed: {}", e)))?;
        
        if !output.status.success() {
            return Err(HypervisorError::Internal("df command failed".into()));
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout.lines().collect();
        if lines.len() < 2 {
            return Err(HypervisorError::Internal("Unexpected df output".into()));
        }
        
        let parts: Vec<&str> = lines[1].split_whitespace().collect();
        if parts.len() < 2 {
            return Err(HypervisorError::Internal("Unexpected df output format".into()));
        }
        
        let total: u64 = parts[0].parse().unwrap_or(0);
        let available: u64 = parts[1].parse().unwrap_or(0);
        
        Ok((total, available))
    }
    
    /// Create a QCOW2 disk image.
    #[instrument(skip(self), fields(path = %path.display(), size_bytes = %size_bytes))]
    fn create_qcow2(&self, path: &Path, size_bytes: u64) -> Result<()> {
        info!("Creating QCOW2 disk image");
        
        let output = Command::new(&self.qemu_img_path)
            .args([
                "create",
                "-f", "qcow2",
                path.to_str().unwrap_or_default(),
                &size_bytes.to_string(),
            ])
            .output()
            .map_err(|e| HypervisorError::Internal(format!("qemu-img failed: {}", e)))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(format!("qemu-img create failed: {}", stderr)));
        }
        
        Ok(())
    }
    
    /// Create a QCOW2 disk image with a backing file.
    #[instrument(skip(self), fields(path = %path.display(), backing = %backing_path.display()))]
    fn create_qcow2_with_backing(&self, path: &Path, backing_path: &Path) -> Result<()> {
        info!("Creating QCOW2 disk image with backing file");
        
        let output = Command::new(&self.qemu_img_path)
            .args([
                "create",
                "-f", "qcow2",
                "-F", "qcow2",
                "-b", backing_path.to_str().unwrap_or_default(),
                path.to_str().unwrap_or_default(),
            ])
            .output()
            .map_err(|e| HypervisorError::Internal(format!("qemu-img failed: {}", e)))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(format!("qemu-img create failed: {}", stderr)));
        }
        
        Ok(())
    }
}

impl Default for NfsBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl StorageBackend for NfsBackend {
    #[instrument(skip(self, config), fields(pool_id = %pool_id))]
    async fn init_pool(&self, pool_id: &str, config: &PoolConfig) -> Result<PoolInfo> {
        let nfs_config = config.nfs.as_ref()
            .ok_or_else(|| HypervisorError::InvalidConfig("NFS config required".into()))?;
        
        // Validate configuration
        if nfs_config.server.is_empty() {
            return Err(HypervisorError::InvalidConfig("NFS server address is required".into()));
        }
        if nfs_config.export_path.is_empty() {
            return Err(HypervisorError::InvalidConfig("NFS export path is required".into()));
        }
        
        // Use custom mount point or default
        let mount_path = if let Some(ref custom_mount) = nfs_config.mount_point {
            std::fs::create_dir_all(custom_mount)
                .map_err(|e| HypervisorError::Internal(format!("Failed to create mount point: {}", e)))?;
            PathBuf::from(custom_mount)
        } else {
            self.mount_nfs(
                pool_id,
                &nfs_config.server,
                &nfs_config.export_path,
                &nfs_config.version,
                &nfs_config.options,
            )?
        };
        
        // Get filesystem stats
        let (total, available) = self.get_fs_stats(&mount_path)?;
        
        info!(
            pool_id = %pool_id,
            server = %nfs_config.server,
            export = %nfs_config.export_path,
            total_gb = total / 1024 / 1024 / 1024,
            available_gb = available / 1024 / 1024 / 1024,
            "NFS pool initialized"
        );
        
        Ok(PoolInfo {
            pool_id: pool_id.to_string(),
            pool_type: PoolType::Nfs,
            mount_path: Some(mount_path.to_string_lossy().to_string()),
            device_path: None,
            rbd_pool: None,
            total_bytes: total,
            available_bytes: available,
        })
    }
    
    async fn destroy_pool(&self, pool_id: &str) -> Result<()> {
        self.unmount_nfs(pool_id)
    }
    
    async fn get_pool_info(&self, pool_id: &str) -> Result<PoolInfo> {
        let mount_path = self.mount_point(pool_id);
        
        if !self.is_mounted(&mount_path)? {
            return Err(HypervisorError::Internal(
                format!("Pool {} is not mounted", pool_id)
            ));
        }
        
        let (total, available) = self.get_fs_stats(&mount_path)?;
        
        Ok(PoolInfo {
            pool_id: pool_id.to_string(),
            pool_type: PoolType::Nfs,
            mount_path: Some(mount_path.to_string_lossy().to_string()),
            device_path: None,
            rbd_pool: None,
            total_bytes: total,
            available_bytes: available,
        })
    }
    
    #[instrument(skip(self, source), fields(pool_id = %pool_id, volume_id = %volume_id, size_bytes = %size_bytes))]
    async fn create_volume(
        &self,
        pool_id: &str,
        volume_id: &str,
        size_bytes: u64,
        source: Option<&VolumeSource>,
    ) -> Result<()> {
        let mount_path = self.mount_point(pool_id);
        
        // Verify pool is mounted
        if !self.is_mounted(&mount_path)? {
            return Err(HypervisorError::Internal(
                format!("Pool {} is not mounted", pool_id)
            ));
        }
        
        let volume_path = self.volume_path(pool_id, volume_id);
        
        if volume_path.exists() {
            return Err(HypervisorError::InvalidConfig(
                format!("Volume {} already exists", volume_id)
            ));
        }
        
        match source {
            Some(VolumeSource::Clone(source_id)) => {
                // Clone from existing volume using copy-on-write
                let source_path = self.volume_path(pool_id, source_id);
                if !source_path.exists() {
                    return Err(HypervisorError::InvalidConfig(
                        format!("Source volume {} not found", source_id)
                    ));
                }
                self.create_qcow2_with_backing(&volume_path, &source_path)?;
            }
            Some(VolumeSource::Image(image_path)) => {
                // Create overlay on cloud image
                let backing = Path::new(image_path);
                if !backing.exists() {
                    return Err(HypervisorError::InvalidConfig(
                        format!("Backing image {} not found", image_path)
                    ));
                }
                self.create_qcow2_with_backing(&volume_path, backing)?;
                
                // Resize if needed
                if size_bytes > 0 {
                    let _ = Command::new(&self.qemu_img_path)
                        .arg("resize")
                        .arg(&volume_path)
                        .arg(size_bytes.to_string())
                        .status();
                }
            }
            Some(VolumeSource::Snapshot(snapshot_id)) => {
                // For snapshots, we use the snapshot as backing file
                // This creates a new overlay on top of the snapshot state
                let source_path = self.volume_path(pool_id, snapshot_id);
                self.create_qcow2_with_backing(&volume_path, &source_path)?;
            }
            None => {
                // Create empty volume
                if size_bytes == 0 {
                    return Err(HypervisorError::InvalidConfig(
                        "Volume size must be greater than 0".into()
                    ));
                }
                self.create_qcow2(&volume_path, size_bytes)?;
            }
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, "NFS volume created");
        Ok(())
    }
    
    async fn delete_volume(&self, pool_id: &str, volume_id: &str) -> Result<()> {
        let volume_path = self.volume_path(pool_id, volume_id);
        
        if volume_path.exists() {
            std::fs::remove_file(&volume_path)
                .map_err(|e| HypervisorError::Internal(format!("Failed to delete volume: {}", e)))?;
            info!(pool_id = %pool_id, volume_id = %volume_id, "NFS volume deleted");
        } else {
            warn!(pool_id = %pool_id, volume_id = %volume_id, "Volume not found");
        }
        
        Ok(())
    }
    
    async fn resize_volume(&self, pool_id: &str, volume_id: &str, new_size_bytes: u64) -> Result<()> {
        let volume_path = self.volume_path(pool_id, volume_id);
        
        if !volume_path.exists() {
            return Err(HypervisorError::InvalidConfig(format!("Volume {} not found", volume_id)));
        }
        
        let output = Command::new(&self.qemu_img_path)
            .arg("resize")
            .arg(&volume_path)
            .arg(new_size_bytes.to_string())
            .output()
            .map_err(|e| HypervisorError::Internal(format!("qemu-img resize failed: {}", e)))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(format!("qemu-img resize failed: {}", stderr)));
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, new_size = %new_size_bytes, "NFS volume resized");
        Ok(())
    }
    
    async fn get_attach_info(&self, pool_id: &str, volume_id: &str) -> Result<VolumeAttachInfo> {
        let volume_path = self.volume_path(pool_id, volume_id);
        
        if !volume_path.exists() {
            return Err(HypervisorError::InvalidConfig(format!("Volume {} not found", volume_id)));
        }
        
        // NFS uses standard file-based disk XML
        // Note: cache=writeback is good for NFS as the server handles durability
        let disk_xml = format!(
            r#"    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2' cache='writeback'/>
      <source file='{}'/>
      <target dev='vdX' bus='virtio'/>
    </disk>"#,
            volume_path.display()
        );
        
        Ok(VolumeAttachInfo {
            volume_id: volume_id.to_string(),
            disk_xml,
            path: volume_path.to_string_lossy().to_string(),
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
        let volume_path = self.volume_path(pool_id, volume_id);
        
        if !volume_path.exists() {
            return Err(HypervisorError::InvalidConfig(format!("Volume {} not found", volume_id)));
        }
        
        // Create internal QCOW2 snapshot
        let output = Command::new(&self.qemu_img_path)
            .arg("snapshot")
            .arg("-c")
            .arg(snapshot_id)
            .arg(&volume_path)
            .output()
            .map_err(|e| HypervisorError::Internal(format!("qemu-img snapshot failed: {}", e)))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(format!("qemu-img snapshot failed: {}", stderr)));
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, snapshot_id = %snapshot_id, "NFS snapshot created");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_mount_point() {
        let backend = NfsBackend::new();
        let path = backend.mount_point("pool-123");
        assert!(path.to_string_lossy().contains("pool-123"));
        assert!(path.to_string_lossy().contains("limiquantix/pools"));
    }
    
    #[test]
    fn test_volume_path() {
        let backend = NfsBackend::new();
        let path = backend.volume_path("pool-123", "vol-456");
        assert!(path.to_string_lossy().contains("pool-123"));
        assert!(path.to_string_lossy().contains("vol-456.qcow2"));
    }
    
    #[test]
    fn test_pool_config_nfs() {
        let config = PoolConfig::nfs("192.168.1.50", "/mnt/pool");
        assert!(config.nfs.is_some());
        let nfs = config.nfs.unwrap();
        assert_eq!(nfs.server, "192.168.1.50");
        assert_eq!(nfs.export_path, "/mnt/pool");
        assert_eq!(nfs.version, "4.1");
    }
}
