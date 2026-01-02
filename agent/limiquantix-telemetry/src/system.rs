//! System information collection.

use serde::{Deserialize, Serialize};
use sysinfo::System;

/// System information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    /// Hostname
    pub hostname: String,
    /// Operating system name
    pub os_name: String,
    /// Operating system version
    pub os_version: String,
    /// Kernel version
    pub kernel_version: String,
    /// System uptime in seconds
    pub uptime_seconds: u64,
    /// System boot time (Unix timestamp)
    pub boot_time: u64,
}

/// Collect system information.
pub fn collect_system_info(_system: &System) -> SystemInfo {
    SystemInfo {
        hostname: System::host_name().unwrap_or_else(|| "unknown".to_string()),
        os_name: System::name().unwrap_or_else(|| "unknown".to_string()),
        os_version: System::os_version().unwrap_or_else(|| "unknown".to_string()),
        kernel_version: System::kernel_version().unwrap_or_else(|| "unknown".to_string()),
        uptime_seconds: System::uptime(),
        boot_time: System::boot_time(),
    }
}

