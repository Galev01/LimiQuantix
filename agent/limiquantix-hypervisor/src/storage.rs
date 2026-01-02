//! Storage utilities for disk image management.
//!
//! This module provides utilities for creating, resizing, and managing
//! disk images using qemu-img.

use std::path::{Path, PathBuf};
use std::process::Command;
use tracing::{debug, info, instrument, warn};

use crate::error::{HypervisorError, Result};
use crate::types::{DiskConfig, DiskFormat};

/// Default storage base path for disk images.
pub const DEFAULT_STORAGE_PATH: &str = "/var/lib/limiquantix/images";

/// Storage manager for disk images.
pub struct StorageManager {
    /// Base path for storing disk images
    base_path: PathBuf,
    /// qemu-img binary path
    qemu_img_path: String,
}

impl StorageManager {
    /// Create a new storage manager with the default path.
    pub fn new() -> Self {
        Self {
            base_path: PathBuf::from(DEFAULT_STORAGE_PATH),
            qemu_img_path: "qemu-img".to_string(),
        }
    }
    
    /// Create a storage manager with a custom base path.
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
    
    /// Get the base storage path.
    pub fn base_path(&self) -> &Path {
        &self.base_path
    }
    
    /// Ensure the storage directory exists.
    pub fn ensure_storage_dir(&self) -> Result<()> {
        if !self.base_path.exists() {
            std::fs::create_dir_all(&self.base_path)
                .map_err(|e| HypervisorError::Internal(
                    format!("Failed to create storage directory: {}", e)
                ))?;
            info!(path = %self.base_path.display(), "Created storage directory");
        }
        Ok(())
    }
    
    /// Get the full path for a disk image.
    pub fn disk_path(&self, vm_id: &str, disk_id: &str) -> PathBuf {
        self.base_path.join(format!("{}/{}.qcow2", vm_id, disk_id))
    }
    
    /// Create a new disk image.
    /// 
    /// If `disk.backing_file` is set, creates a copy-on-write overlay on top of the backing file.
    /// This is used for cloud images where the base image is shared across VMs.
    #[instrument(skip(self), fields(vm_id = %vm_id, disk_id = %disk.id, size_gib = %disk.size_gib))]
    pub fn create_disk(&self, vm_id: &str, disk: &mut DiskConfig) -> Result<PathBuf> {
        self.ensure_storage_dir()?;
        
        // Create VM-specific directory
        let vm_dir = self.base_path.join(vm_id);
        if !vm_dir.exists() {
            std::fs::create_dir_all(&vm_dir)
                .map_err(|e| HypervisorError::Internal(
                    format!("Failed to create VM directory: {}", e)
                ))?;
        }
        
        // Determine disk path
        let disk_path = if disk.path.is_empty() {
            self.disk_path(vm_id, &disk.id)
        } else {
            PathBuf::from(&disk.path)
        };
        
        // Create the disk image - with or without backing file
        if let Some(ref backing_file) = disk.backing_file {
            // Create copy-on-write overlay on top of cloud image
            info!(backing = %backing_file, "Creating disk from cloud image");
            self.create_from_backing(&disk_path, Path::new(backing_file), disk.format)?;
            
            // Optionally resize the overlay if size is larger than backing
            if disk.size_gib > 0 {
                // Check backing file size
                if let Ok(backing_info) = self.get_disk_info(Path::new(backing_file)) {
                    let backing_size_gib = backing_info.virtual_size_gib();
                    if disk.size_gib > backing_size_gib {
                        info!(
                            current_gib = backing_size_gib,
                            target_gib = disk.size_gib,
                            "Resizing overlay disk"
                        );
                        self.resize_disk(&disk_path, disk.size_gib)?;
                    }
                }
            }
        } else {
            // Create a new empty disk image
            self.create_image(&disk_path, disk.size_gib, disk.format)?;
        }
        
        // Update disk config with the actual path
        disk.path = disk_path.to_string_lossy().to_string();
        
        Ok(disk_path)
    }
    
    /// Create a disk image file using qemu-img.
    #[instrument(skip(self), fields(path = %path.display(), size_gib = %size_gib))]
    pub fn create_image(&self, path: &Path, size_gib: u64, format: DiskFormat) -> Result<()> {
        info!("Creating disk image");
        
        if path.exists() {
            return Err(HypervisorError::InvalidConfig(
                format!("Disk image already exists: {}", path.display())
            ));
        }
        
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| HypervisorError::Internal(
                        format!("Failed to create parent directory: {}", e)
                    ))?;
            }
        }
        
        let size = format!("{}G", size_gib);
        
        let output = Command::new(&self.qemu_img_path)
            .args([
                "create",
                "-f", format.as_str(),
                path.to_str().unwrap_or_default(),
                &size,
            ])
            .output()
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to execute qemu-img: {}", e)
            ))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(
                format!("qemu-img create failed: {}", stderr)
            ));
        }
        
        info!(path = %path.display(), size = %size, format = %format.as_str(), "Disk image created");
        
        Ok(())
    }
    
    /// Create a disk image from a backing file (copy-on-write).
    #[instrument(skip(self), fields(path = %path.display()))]
    pub fn create_from_backing(&self, path: &Path, backing_path: &Path, format: DiskFormat) -> Result<()> {
        info!(backing = %backing_path.display(), "Creating disk image from backing file");
        
        if path.exists() {
            return Err(HypervisorError::InvalidConfig(
                format!("Disk image already exists: {}", path.display())
            ));
        }
        
        if !backing_path.exists() {
            return Err(HypervisorError::InvalidConfig(
                format!("Backing file does not exist: {}", backing_path.display())
            ));
        }
        
        let output = Command::new(&self.qemu_img_path)
            .args([
                "create",
                "-f", format.as_str(),
                "-F", format.as_str(),
                "-b", backing_path.to_str().unwrap_or_default(),
                path.to_str().unwrap_or_default(),
            ])
            .output()
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to execute qemu-img: {}", e)
            ))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(
                format!("qemu-img create failed: {}", stderr)
            ));
        }
        
        info!(path = %path.display(), "Disk image created from backing file");
        
        Ok(())
    }
    
    /// Resize a disk image.
    #[instrument(skip(self), fields(path = %path.display(), new_size_gib = %new_size_gib))]
    pub fn resize_disk(&self, path: &Path, new_size_gib: u64) -> Result<()> {
        info!("Resizing disk image");
        
        if !path.exists() {
            return Err(HypervisorError::InvalidConfig(
                format!("Disk image does not exist: {}", path.display())
            ));
        }
        
        let size = format!("{}G", new_size_gib);
        
        let output = Command::new(&self.qemu_img_path)
            .args([
                "resize",
                path.to_str().unwrap_or_default(),
                &size,
            ])
            .output()
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to execute qemu-img: {}", e)
            ))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(
                format!("qemu-img resize failed: {}", stderr)
            ));
        }
        
        info!(path = %path.display(), size = %size, "Disk image resized");
        
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
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to execute qemu-img: {}", e)
            ))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(
                format!("qemu-img info failed: {}", stderr)
            ));
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let info: serde_json::Value = serde_json::from_str(&stdout)
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to parse qemu-img output: {}", e)
            ))?;
        
        Ok(DiskInfo {
            path: path.to_path_buf(),
            format: info["format"].as_str().unwrap_or("unknown").to_string(),
            virtual_size: info["virtual-size"].as_u64().unwrap_or(0),
            actual_size: info["actual-size"].as_u64().unwrap_or(0),
            backing_file: info["backing-filename"].as_str().map(|s| PathBuf::from(s)),
        })
    }
    
    /// Convert a disk image to a different format.
    #[instrument(skip(self), fields(src = %src_path.display(), dst = %dst_path.display()))]
    pub fn convert_disk(&self, src_path: &Path, dst_path: &Path, dst_format: DiskFormat) -> Result<()> {
        info!(dst_format = %dst_format.as_str(), "Converting disk image");
        
        if !src_path.exists() {
            return Err(HypervisorError::InvalidConfig(
                format!("Source disk image does not exist: {}", src_path.display())
            ));
        }
        
        let output = Command::new(&self.qemu_img_path)
            .args([
                "convert",
                "-O", dst_format.as_str(),
                src_path.to_str().unwrap_or_default(),
                dst_path.to_str().unwrap_or_default(),
            ])
            .output()
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to execute qemu-img: {}", e)
            ))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(
                format!("qemu-img convert failed: {}", stderr)
            ));
        }
        
        info!(src = %src_path.display(), dst = %dst_path.display(), "Disk image converted");
        
        Ok(())
    }
    
    /// Delete a disk image.
    #[instrument(skip(self), fields(path = %path.display()))]
    pub fn delete_disk(&self, path: &Path) -> Result<()> {
        if path.exists() {
            std::fs::remove_file(path)
                .map_err(|e| HypervisorError::Internal(
                    format!("Failed to delete disk image: {}", e)
                ))?;
            info!(path = %path.display(), "Disk image deleted");
        } else {
            warn!(path = %path.display(), "Disk image not found for deletion");
        }
        Ok(())
    }
    
    /// Delete all disk images for a VM.
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    pub fn delete_vm_disks(&self, vm_id: &str) -> Result<()> {
        let vm_dir = self.base_path.join(vm_id);
        
        if vm_dir.exists() {
            std::fs::remove_dir_all(&vm_dir)
                .map_err(|e| HypervisorError::Internal(
                    format!("Failed to delete VM disk directory: {}", e)
                ))?;
            info!(vm_id = %vm_id, "Deleted all disk images for VM");
        }
        
        Ok(())
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
            return Err(HypervisorError::Internal(
                "qemu-img version check failed".to_string()
            ));
        }
        
        let version = String::from_utf8_lossy(&output.stdout);
        let first_line = version.lines().next().unwrap_or("unknown");
        
        Ok(first_line.to_string())
    }
}

impl Default for StorageManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Information about a disk image.
#[derive(Debug, Clone)]
pub struct DiskInfo {
    /// Path to the disk image
    pub path: PathBuf,
    /// Disk format (qcow2, raw, etc.)
    pub format: String,
    /// Virtual size in bytes
    pub virtual_size: u64,
    /// Actual size on disk in bytes
    pub actual_size: u64,
    /// Backing file (for copy-on-write images)
    pub backing_file: Option<PathBuf>,
}

impl DiskInfo {
    /// Get the virtual size in GiB.
    pub fn virtual_size_gib(&self) -> u64 {
        self.virtual_size / 1024 / 1024 / 1024
    }
    
    /// Get the actual size in GiB.
    pub fn actual_size_gib(&self) -> f64 {
        self.actual_size as f64 / 1024.0 / 1024.0 / 1024.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    
    #[test]
    fn test_disk_path() {
        let manager = StorageManager::with_path("/var/lib/limiquantix/images");
        let path = manager.disk_path("vm-123", "disk-456");
        assert_eq!(
            path,
            PathBuf::from("/var/lib/limiquantix/images/vm-123/disk-456.qcow2")
        );
    }
    
    #[test]
    fn test_check_qemu_img() {
        let manager = StorageManager::new();
        
        // This test will fail if qemu-img is not installed
        // That's expected in CI environments without QEMU
        match manager.check_qemu_img() {
            Ok(version) => println!("qemu-img version: {}", version),
            Err(e) => println!("qemu-img not available: {}", e),
        }
    }
}

