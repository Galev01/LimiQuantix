//! # limiquantix Telemetry
//!
//! System telemetry collection for the Node Daemon.
//! Collects CPU, memory, disk, and network metrics from the host.

pub mod cpu;
pub mod memory;
pub mod disk;
pub mod network;
pub mod system;

use serde::{Deserialize, Serialize};
use sysinfo::{System, Disks, Networks};
use std::sync::Mutex;

/// Telemetry collector for gathering system metrics.
pub struct TelemetryCollector {
    system: Mutex<System>,
    disks: Mutex<Disks>,
    networks: Mutex<Networks>,
}

impl TelemetryCollector {
    /// Create a new telemetry collector.
    pub fn new() -> Self {
        Self {
            system: Mutex::new(System::new_all()),
            disks: Mutex::new(Disks::new_with_refreshed_list()),
            networks: Mutex::new(Networks::new_with_refreshed_list()),
        }
    }
    
    /// Refresh all system information.
    pub fn refresh(&self) {
        if let Ok(mut system) = self.system.lock() {
            system.refresh_all();
        }
        if let Ok(mut disks) = self.disks.lock() {
            disks.refresh();
        }
        if let Ok(mut networks) = self.networks.lock() {
            networks.refresh();
        }
    }
    
    /// Collect all node metrics.
    pub fn collect(&self) -> NodeTelemetry {
        self.refresh();
        
        let system = self.system.lock().unwrap();
        let disks = self.disks.lock().unwrap();
        let networks = self.networks.lock().unwrap();
        
        NodeTelemetry {
            cpu: cpu::collect_cpu_info(&system),
            memory: memory::collect_memory_info(&system),
            disks: disk::collect_disk_info(&disks),
            networks: network::collect_network_info(&networks),
            system: system::collect_system_info(&system),
        }
    }
}

impl Default for TelemetryCollector {
    fn default() -> Self {
        Self::new()
    }
}

/// Complete node telemetry snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeTelemetry {
    pub cpu: cpu::CpuInfo,
    pub memory: memory::MemoryInfo,
    pub disks: Vec<disk::DiskInfo>,
    pub networks: Vec<network::NetworkInfo>,
    pub system: system::SystemInfo,
}

