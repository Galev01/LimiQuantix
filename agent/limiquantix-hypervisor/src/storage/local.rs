//! Local directory storage backend.
//!
//! This backend uses a local directory for storing disk images as QCOW2 files.
//! It's suitable for development, testing, and single-node deployments.

use std::path::{Path, PathBuf};
use std::process::Command;
use async_trait::async_trait;
use tracing::{debug, info, instrument, warn};

use crate::error::{HypervisorError, Result};
use super::types::{DiskInfo, PoolConfig, PoolInfo, PoolType, VolumeAttachInfo, VolumeSource};
use super::traits::StorageBackend;

/// Default storage base path for disk images.
pub const DEFAULT_STORAGE_PATH: &str = "/var/lib/limiquantix/images";

/// Local directory storage backend.
///
/// Uses a local filesystem directory for storing QCOW2 disk images.
pub struct LocalBackend {
    /// Base path for storage
    base_path: PathBuf,
    /// qemu-img binary path
    qemu_img_path: String,
}

impl LocalBackend {
    /// Create a new local backend with the default path.
    pub fn new() -> Self {
        Self {
            base_path: PathBuf::from(DEFAULT_STORAGE_PATH),
            qemu_img_path: "qemu-img".to_string(),
        }
    }
    
    /// Create a local backend with a custom base path.
    pub fn with_path(base_path: impl Into<PathBuf>) -> Self {
        Self {
            base_path: base_path.into(),
            qemu_img_path: "qemu-img".to_string(),
        }
    }
    
    /// Set the qemu-img binary path.
    pub fn with_qemu_img(mut self, path: impl Into<String>) -> Self {
        self.qemu_img_path = path.into();
        self
    }
    
    /// Get the pool directory.
    fn pool_path(&self, pool_id: &str) -> PathBuf {
        self.base_path.join(pool_id)
    }
    
    /// Get the volume path.
    fn volume_path(&self, pool_id: &str, volume_id: &str) -> PathBuf {
        self.pool_path(pool_id).join(format!("{}.qcow2", volume_id))
    }
    
    /// Ensure a directory exists.
    fn ensure_dir(&self, path: &Path) -> Result<()> {
        if !path.exists() {
            std::fs::create_dir_all(path)
                .map_err(|e| HypervisorError::Internal(
                    format!("Failed to create directory {}: {}", path.display(), e)
                ))?;
        }
        Ok(())
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
        
        let status = Command::new(&self.qemu_img_path)
            .args([
                "create",
                "-f", "qcow2",
                path.to_str().unwrap_or_default(),
                &size_bytes.to_string(),
            ])
            .status()
            .map_err(|e| HypervisorError::Internal(format!("qemu-img failed: {}", e)))?;
        
        if !status.success() {
            return Err(HypervisorError::Internal("qemu-img create failed".into()));
        }
        
        Ok(())
    }
    
    /// Create a QCOW2 disk image with a backing file.
    #[instrument(skip(self), fields(path = %path.display(), backing = %backing_path.display()))]
    fn create_qcow2_with_backing(&self, path: &Path, backing_path: &Path) -> Result<()> {
        info!("Creating QCOW2 disk image with backing file");
        
        let status = Command::new(&self.qemu_img_path)
            .args([
                "create",
                "-f", "qcow2",
                "-F", "qcow2",
                "-b", backing_path.to_str().unwrap_or_default(),
                path.to_str().unwrap_or_default(),
            ])
            .status()
            .map_err(|e| HypervisorError::Internal(format!("qemu-img failed: {}", e)))?;
        
        if !status.success() {
            return Err(HypervisorError::Internal("qemu-img create with backing failed".into()));
        }
        
        Ok(())
    }
    
    /// Get information about a disk image.
    #[instrument(skip(self), fields(path = %path.display()))]
    pub fn get_disk_info(&self, path: &Path) -> Result<DiskInfo> {
        debug!("Getting disk info");
        
        if !path.exists() {
            return Err(HypervisorError::InvalidConfig(
                format!("Disk image does not exist: {}", path.display())
            ));
        }
        
        let output = Command::new(&self.qemu_img_path)
            .args([
                "info",
                "--output=json",
                path.to_str().unwrap_or_default(),
            ])
            .output()
            .map_err(|e| HypervisorError::Internal(format!("qemu-img info failed: {}", e)))?;
        
        if !output.status.success() {
            return Err(HypervisorError::Internal("qemu-img info failed".into()));
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let info: serde_json::Value = serde_json::from_str(&stdout)
            .map_err(|e| HypervisorError::Internal(format!("Failed to parse qemu-img output: {}", e)))?;
        
        Ok(DiskInfo {
            path: path.to_path_buf(),
            format: info["format"].as_str().unwrap_or("unknown").to_string(),
            virtual_size: info["virtual-size"].as_u64().unwrap_or(0),
            actual_size: info["actual-size"].as_u64().unwrap_or(0),
            backing_file: info["backing-filename"].as_str().map(PathBuf::from),
        })
    }
    
    /// Check if qemu-img is available.
    pub fn check_qemu_img(&self) -> Result<String> {
        let output = Command::new(&self.qemu_img_path)
            .args(["--version"])
            .output()
            .map_err(|e| HypervisorError::Internal(
                format!("qemu-img not found or not executable: {}", e)
            ))?;
        
        if !output.status.success() {
            return Err(HypervisorError::Internal("qemu-img version check failed".into()));
        }
        
        let version = String::from_utf8_lossy(&output.stdout);
        let first_line = version.lines().next().unwrap_or("unknown");
        
        Ok(first_line.to_string())
    }
}

impl Default for LocalBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl StorageBackend for LocalBackend {
    async fn init_pool(&self, pool_id: &str, config: &PoolConfig) -> Result<PoolInfo> {
        let pool_path = if let Some(local) = &config.local {
            PathBuf::from(&local.path)
        } else {
            self.pool_path(pool_id)
        };
        
        self.ensure_dir(&pool_path)?;
        
        let (total, available) = self.get_fs_stats(&pool_path)?;
        
        info!(
            pool_id = %pool_id,
            path = %pool_path.display(),
            "Local storage pool initialized"
        );
        
        Ok(PoolInfo {
            pool_id: pool_id.to_string(),
            pool_type: PoolType::LocalDir,
            mount_path: Some(pool_path.to_string_lossy().to_string()),
            device_path: None,
            rbd_pool: None,
            total_bytes: total,
            available_bytes: available,
        })
    }
    
    async fn destroy_pool(&self, pool_id: &str) -> Result<()> {
        let pool_path = self.pool_path(pool_id);
        
        if pool_path.exists() {
            // Only remove if empty
            let is_empty = pool_path.read_dir()
                .map(|mut i| i.next().is_none())
                .unwrap_or(true);
            
            if is_empty {
                std::fs::remove_dir(&pool_path)
                    .map_err(|e| HypervisorError::Internal(format!("Failed to remove pool dir: {}", e)))?;
                info!(pool_id = %pool_id, "Local storage pool removed");
            } else {
                warn!(pool_id = %pool_id, "Pool directory not empty, not removing");
            }
        }
        
        Ok(())
    }
    
    async fn get_pool_info(&self, pool_id: &str) -> Result<PoolInfo> {
        let pool_path = self.pool_path(pool_id);
        
        if !pool_path.exists() {
            return Err(HypervisorError::Internal(format!("Pool {} not found", pool_id)));
        }
        
        let (total, available) = self.get_fs_stats(&pool_path)?;
        
        Ok(PoolInfo {
            pool_id: pool_id.to_string(),
            pool_type: PoolType::LocalDir,
            mount_path: Some(pool_path.to_string_lossy().to_string()),
            device_path: None,
            rbd_pool: None,
            total_bytes: total,
            available_bytes: available,
        })
    }
    
    async fn create_volume(
        &self,
        pool_id: &str,
        volume_id: &str,
        size_bytes: u64,
        source: Option<&VolumeSource>,
    ) -> Result<()> {
        let pool_path = self.pool_path(pool_id);
        self.ensure_dir(&pool_path)?;
        
        let volume_path = self.volume_path(pool_id, volume_id);
        
        if volume_path.exists() {
            return Err(HypervisorError::InvalidConfig(
                format!("Volume {} already exists", volume_id)
            ));
        }
        
        match source {
            Some(VolumeSource::Clone(source_id)) => {
                let source_path = self.volume_path(pool_id, source_id);
                self.create_qcow2_with_backing(&volume_path, &source_path)?;
            }
            Some(VolumeSource::Image(image_path)) => {
                self.create_qcow2_with_backing(&volume_path, Path::new(image_path))?;
                
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
                // For snapshots, we revert by cloning the snapshot state
                let source_path = self.volume_path(pool_id, snapshot_id);
                self.create_qcow2_with_backing(&volume_path, &source_path)?;
            }
            None => {
                self.create_qcow2(&volume_path, size_bytes)?;
            }
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, "Volume created");
        Ok(())
    }
    
    async fn delete_volume(&self, pool_id: &str, volume_id: &str) -> Result<()> {
        let volume_path = self.volume_path(pool_id, volume_id);
        
        if volume_path.exists() {
            std::fs::remove_file(&volume_path)
                .map_err(|e| HypervisorError::Internal(format!("Failed to delete volume: {}", e)))?;
            info!(pool_id = %pool_id, volume_id = %volume_id, "Volume deleted");
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
        
        let status = Command::new(&self.qemu_img_path)
            .arg("resize")
            .arg(&volume_path)
            .arg(new_size_bytes.to_string())
            .status()
            .map_err(|e| HypervisorError::Internal(format!("qemu-img resize failed: {}", e)))?;
        
        if !status.success() {
            return Err(HypervisorError::Internal("qemu-img resize failed".into()));
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, new_size = %new_size_bytes, "Volume resized");
        Ok(())
    }
    
    async fn get_attach_info(&self, pool_id: &str, volume_id: &str) -> Result<VolumeAttachInfo> {
        let volume_path = self.volume_path(pool_id, volume_id);
        
        if !volume_path.exists() {
            return Err(HypervisorError::InvalidConfig(format!("Volume {} not found", volume_id)));
        }
        
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
        
        let status = Command::new(&self.qemu_img_path)
            .arg("snapshot")
            .arg("-c")
            .arg(snapshot_id)
            .arg(&volume_path)
            .status()
            .map_err(|e| HypervisorError::Internal(format!("qemu-img snapshot failed: {}", e)))?;
        
        if !status.success() {
            return Err(HypervisorError::Internal("qemu-img snapshot create failed".into()));
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, snapshot_id = %snapshot_id, "Snapshot created");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_volume_path() {
        let backend = LocalBackend::new();
        let path = backend.volume_path("pool-123", "vol-456");
        assert!(path.to_string_lossy().contains("pool-123"));
        assert!(path.to_string_lossy().contains("vol-456.qcow2"));
    }
    
    #[test]
    fn test_check_qemu_img() {
        let backend = LocalBackend::new();
        
        // This test will fail if qemu-img is not installed
        match backend.check_qemu_img() {
            Ok(version) => println!("qemu-img version: {}", version),
            Err(e) => println!("qemu-img not available: {}", e),
        }
    }
}
