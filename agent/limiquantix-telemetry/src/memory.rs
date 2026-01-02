//! Memory information collection.

use serde::{Deserialize, Serialize};
use sysinfo::System;

/// Memory information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryInfo {
    /// Total physical memory in bytes
    pub total_bytes: u64,
    /// Used memory in bytes
    pub used_bytes: u64,
    /// Available memory in bytes
    pub available_bytes: u64,
    /// Memory usage percentage
    pub usage_percent: f32,
    /// Total swap in bytes
    pub swap_total_bytes: u64,
    /// Used swap in bytes
    pub swap_used_bytes: u64,
}

/// Collect memory information from the system.
pub fn collect_memory_info(system: &System) -> MemoryInfo {
    let total = system.total_memory();
    let used = system.used_memory();
    let available = system.available_memory();
    
    let usage_percent = if total > 0 {
        (used as f32 / total as f32) * 100.0
    } else {
        0.0
    };
    
    MemoryInfo {
        total_bytes: total,
        used_bytes: used,
        available_bytes: available,
        usage_percent,
        swap_total_bytes: system.total_swap(),
        swap_used_bytes: system.used_swap(),
    }
}

