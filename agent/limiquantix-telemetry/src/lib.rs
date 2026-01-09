//! # limiquantix Telemetry
//!
//! System telemetry collection for the Node Daemon.
//! Collects CPU, memory, disk, and network metrics from the host.
//!
//! ## Important: CPU Usage Measurement
//!
//! CPU usage requires at least two refresh cycles to calculate delta.
//! The `TelemetryCollector` handles this by maintaining state and
//! providing a background refresh task that should be started on init.

pub mod cpu;
pub mod memory;
pub mod disk;
pub mod network;
pub mod system;

use serde::{Deserialize, Serialize};
use sysinfo::{System, Disks, Networks, CpuRefreshKind, RefreshKind, MemoryRefreshKind};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tracing::{debug, trace};

/// Cached telemetry data with timestamp
#[derive(Debug, Clone)]
struct CachedTelemetry {
    data: NodeTelemetry,
    timestamp: Instant,
}

/// Telemetry collector for gathering system metrics.
/// 
/// This collector maintains background state for accurate CPU measurements.
/// Call `start_background_refresh()` after creation to enable automatic
/// periodic refreshes for accurate CPU usage data.
pub struct TelemetryCollector {
    system: Mutex<System>,
    disks: Mutex<Disks>,
    networks: Mutex<Networks>,
    /// Cached telemetry for fast access
    cache: RwLock<Option<CachedTelemetry>>,
    /// Track if we've done at least one refresh cycle
    initialized: RwLock<bool>,
    /// Previous network stats for rate calculation
    prev_network_stats: Mutex<Vec<(String, u64, u64, Instant)>>,
    /// Previous disk I/O stats for rate calculation  
    prev_disk_io: Mutex<Option<DiskIoSnapshot>>,
}

/// Snapshot of disk I/O counters for rate calculation
#[derive(Debug, Clone)]
struct DiskIoSnapshot {
    read_bytes: u64,
    write_bytes: u64,
    timestamp: Instant,
}

impl TelemetryCollector {
    /// Create a new telemetry collector.
    /// 
    /// After creation, call `start_background_refresh()` to enable
    /// accurate CPU usage measurements.
    pub fn new() -> Self {
        // Create system with specific refresh kinds for better performance
        let mut system = System::new();
        
        // Do initial refresh to populate data
        system.refresh_specifics(
            RefreshKind::new()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything())
        );
        
        let collector = Self {
            system: Mutex::new(system),
            disks: Mutex::new(Disks::new_with_refreshed_list()),
            networks: Mutex::new(Networks::new_with_refreshed_list()),
            cache: RwLock::new(None),
            initialized: RwLock::new(false),
            prev_network_stats: Mutex::new(Vec::new()),
            prev_disk_io: Mutex::new(None),
        };
        
        // Do a second refresh after a short delay to initialize CPU usage
        std::thread::sleep(Duration::from_millis(200));
        collector.refresh();
        
        // Mark as initialized after second refresh
        if let Ok(mut init) = collector.initialized.write() {
            *init = true;
        }
        
        debug!("TelemetryCollector initialized with CPU baseline");
        
        collector
    }
    
    /// Refresh all system information.
    /// 
    /// This should be called periodically (every 1-5 seconds) for accurate
    /// CPU usage data. Consider using `start_background_refresh()` instead.
    pub fn refresh(&self) {
        let refresh_start = Instant::now();
        
        if let Ok(mut system) = self.system.lock() {
            // Refresh CPU and memory
            system.refresh_specifics(
                RefreshKind::new()
                    .with_cpu(CpuRefreshKind::everything())
                    .with_memory(MemoryRefreshKind::everything())
            );
        }
        
        if let Ok(mut disks) = self.disks.lock() {
            disks.refresh();
        }
        
        if let Ok(mut networks) = self.networks.lock() {
            networks.refresh();
        }
        
        // Update cache
        if let (Ok(system), Ok(disks), Ok(networks)) = (
            self.system.lock(),
            self.disks.lock(),
            self.networks.lock(),
        ) {
            let telemetry = NodeTelemetry {
                cpu: cpu::collect_cpu_info(&system),
                memory: memory::collect_memory_info(&system),
                disks: disk::collect_disk_info(&disks),
                networks: network::collect_network_info(&networks),
                system: system::collect_system_info(&system),
            };
            
            if let Ok(mut cache) = self.cache.write() {
                *cache = Some(CachedTelemetry {
                    data: telemetry,
                    timestamp: Instant::now(),
                });
            }
        }
        
        trace!(duration_ms = refresh_start.elapsed().as_millis(), "Telemetry refresh complete");
    }
    
    /// Collect all node metrics.
    /// 
    /// Returns cached data if available and fresh (< 2 seconds old),
    /// otherwise performs a refresh first.
    pub fn collect(&self) -> NodeTelemetry {
        // Check cache first
        if let Ok(cache) = self.cache.read() {
            if let Some(ref cached) = *cache {
                // Return cached data if less than 2 seconds old
                if cached.timestamp.elapsed() < Duration::from_secs(2) {
                    trace!("Returning cached telemetry");
                    return cached.data.clone();
                }
            }
        }
        
        // Cache miss or stale - refresh and collect
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
    
    /// Check if the collector has been initialized with baseline CPU data.
    pub fn is_initialized(&self) -> bool {
        self.initialized.read().map(|v| *v).unwrap_or(false)
    }
    
    /// Start a background task that periodically refreshes telemetry data.
    /// 
    /// This is essential for accurate CPU usage measurements.
    /// Returns a handle that can be used to stop the background task.
    pub fn start_background_refresh(self: &Arc<Self>, interval: Duration) -> tokio::task::JoinHandle<()> {
        let collector = Arc::clone(self);
        
        tokio::spawn(async move {
            let mut interval_timer = tokio::time::interval(interval);
            
            loop {
                interval_timer.tick().await;
                collector.refresh();
                trace!("Background telemetry refresh completed");
            }
        })
    }
    
    /// Get disk I/O rates (bytes per second).
    /// 
    /// Returns (read_bytes_per_sec, write_bytes_per_sec).
    /// This reads from /proc/diskstats on Linux.
    pub fn get_disk_io_rates(&self) -> (u64, u64) {
        #[cfg(target_os = "linux")]
        {
            // Read current disk I/O from /proc/diskstats
            if let Ok(content) = std::fs::read_to_string("/proc/diskstats") {
                let mut total_read_sectors: u64 = 0;
                let mut total_write_sectors: u64 = 0;
                
                for line in content.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 14 {
                        let device_name = parts[2];
                        // Only count physical devices (sd*, nvme*, vd*), not partitions
                        if (device_name.starts_with("sd") || 
                            device_name.starts_with("nvme") || 
                            device_name.starts_with("vd")) &&
                           !device_name.chars().last().map(|c| c.is_numeric()).unwrap_or(false) {
                            // For nvme devices, check for 'n' followed by number (e.g., nvme0n1)
                            let is_partition = if device_name.starts_with("nvme") {
                                device_name.contains("p") // nvme0n1p1 is a partition
                            } else {
                                device_name.chars().last().map(|c| c.is_numeric()).unwrap_or(false)
                            };
                            
                            if !is_partition {
                                if let (Ok(read_sectors), Ok(write_sectors)) = 
                                    (parts[5].parse::<u64>(), parts[9].parse::<u64>()) {
                                    total_read_sectors += read_sectors;
                                    total_write_sectors += write_sectors;
                                }
                            }
                        }
                    }
                }
                
                // Sector size is typically 512 bytes
                let read_bytes = total_read_sectors * 512;
                let write_bytes = total_write_sectors * 512;
                let now = Instant::now();
                
                let mut prev_io = self.prev_disk_io.lock().unwrap();
                
                if let Some(ref prev) = *prev_io {
                    let duration_secs = prev.timestamp.elapsed().as_secs_f64();
                    if duration_secs > 0.0 {
                        let read_rate = ((read_bytes.saturating_sub(prev.read_bytes)) as f64 / duration_secs) as u64;
                        let write_rate = ((write_bytes.saturating_sub(prev.write_bytes)) as f64 / duration_secs) as u64;
                        
                        // Update prev stats
                        *prev_io = Some(DiskIoSnapshot {
                            read_bytes,
                            write_bytes,
                            timestamp: now,
                        });
                        
                        return (read_rate, write_rate);
                    }
                }
                
                // First call - save baseline
                *prev_io = Some(DiskIoSnapshot {
                    read_bytes,
                    write_bytes,
                    timestamp: now,
                });
            }
        }
        
        (0, 0)
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

