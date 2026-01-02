//! Disk information collection.

use serde::{Deserialize, Serialize};
use sysinfo::Disks;

/// Disk information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskInfo {
    /// Device name
    pub device: String,
    /// Mount point
    pub mount_point: String,
    /// Filesystem type
    pub filesystem: String,
    /// Total space in bytes
    pub total_bytes: u64,
    /// Available space in bytes
    pub available_bytes: u64,
    /// Used space in bytes
    pub used_bytes: u64,
    /// Usage percentage
    pub usage_percent: f32,
    /// Is the disk removable
    pub removable: bool,
}

/// Collect disk information from the system.
pub fn collect_disk_info(disks: &Disks) -> Vec<DiskInfo> {
    disks.list().iter().map(|disk| {
        let total = disk.total_space();
        let available = disk.available_space();
        let used = total.saturating_sub(available);
        
        let usage_percent = if total > 0 {
            (used as f32 / total as f32) * 100.0
        } else {
            0.0
        };
        
        DiskInfo {
            device: disk.name().to_string_lossy().to_string(),
            mount_point: disk.mount_point().to_string_lossy().to_string(),
            filesystem: disk.file_system().to_string_lossy().to_string(),
            total_bytes: total,
            available_bytes: available,
            used_bytes: used,
            usage_percent,
            removable: disk.is_removable(),
        }
    }).collect()
}

