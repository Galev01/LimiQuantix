//! CPU information collection.

use serde::{Deserialize, Serialize};
use sysinfo::System;

/// CPU information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuInfo {
    /// CPU model name
    pub model: String,
    /// Number of physical cores
    pub physical_cores: usize,
    /// Number of logical cores (threads)
    pub logical_cores: usize,
    /// CPU frequency in MHz
    pub frequency_mhz: u64,
    /// Overall CPU usage percentage
    pub usage_percent: f32,
    /// Per-core usage percentages
    pub per_core_usage: Vec<f32>,
}

/// Collect CPU information from the system.
pub fn collect_cpu_info(system: &System) -> CpuInfo {
    let cpus = system.cpus();
    
    let model = cpus.first()
        .map(|cpu| cpu.brand().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    
    let frequency_mhz = cpus.first()
        .map(|cpu| cpu.frequency())
        .unwrap_or(0);
    
    let per_core_usage: Vec<f32> = cpus.iter()
        .map(|cpu| cpu.cpu_usage())
        .collect();
    
    let usage_percent = if per_core_usage.is_empty() {
        0.0
    } else {
        per_core_usage.iter().sum::<f32>() / per_core_usage.len() as f32
    };
    
    CpuInfo {
        model,
        physical_cores: system.physical_core_count().unwrap_or(0),
        logical_cores: cpus.len(),
        frequency_mhz,
        usage_percent,
        per_core_usage,
    }
}

