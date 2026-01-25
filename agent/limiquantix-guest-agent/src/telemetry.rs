//! Telemetry collection for the guest agent.
//!
//! Collects system metrics including CPU, memory, disk, and network information.

use limiquantix_proto::agent::{DiskUsage, InterfaceInfo, InterfaceState, TelemetryReport};
use sysinfo::{Disks, Networks, System};
use tracing::debug;

/// System information snapshot
#[derive(Debug, Clone)]
pub struct SystemInfo {
    pub os_name: String,
    pub os_version: String,
    pub kernel_version: String,
    pub architecture: String,
    pub hostname: String,
}

/// Telemetry collector that gathers system metrics
pub struct TelemetryCollector {
    system: System,
    disks: Disks,
    networks: Networks,
}

impl TelemetryCollector {
    /// Create a new telemetry collector
    pub fn new() -> Self {
        Self {
            system: System::new_all(),
            disks: Disks::new_with_refreshed_list(),
            networks: Networks::new_with_refreshed_list(),
        }
    }

    /// Get system information (OS, kernel, architecture)
    pub fn get_system_info(&self) -> SystemInfo {
        SystemInfo {
            os_name: System::name().unwrap_or_else(|| "Unknown".to_string()),
            os_version: System::os_version().unwrap_or_else(|| "Unknown".to_string()),
            kernel_version: System::kernel_version().unwrap_or_else(|| "Unknown".to_string()),
            architecture: std::env::consts::ARCH.to_string(),
            hostname: System::host_name().unwrap_or_else(|| "Unknown".to_string()),
        }
    }

    /// Get all IP addresses (filtering out loopback)
    pub fn get_ip_addresses(&self) -> Vec<String> {
        let mut ips = Vec::new();

        #[cfg(unix)]
        {
            // Use the network interfaces from sysinfo
            // Note: sysinfo doesn't directly provide IP addresses, so we use a fallback
            if let Ok(hostname) = hostname::get() {
                if let Ok(name) = hostname.into_string() {
                    // Try to resolve hostname to IP
                    if let Ok(addrs) = std::net::ToSocketAddrs::to_socket_addrs(&(name.as_str(), 0))
                    {
                        for addr in addrs {
                            let ip = addr.ip();
                            if !ip.is_loopback() {
                                ips.push(ip.to_string());
                            }
                        }
                    }
                }
            }

            // Also try to get from /proc/net/fib_trie or similar
            if let Ok(output) = std::process::Command::new("hostname").arg("-I").output() {
                if output.status.success() {
                    let output_str = String::from_utf8_lossy(&output.stdout);
                    for ip in output_str.split_whitespace() {
                        if !ips.contains(&ip.to_string()) {
                            ips.push(ip.to_string());
                        }
                    }
                }
            }
        }

        #[cfg(windows)]
        {
            // On Windows, use ipconfig or WMI
            if let Ok(output) = std::process::Command::new("powershell")
                .args([
                    "-Command",
                    "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' }).IPAddress"
                ])
                .output()
            {
                if output.status.success() {
                    let output_str = String::from_utf8_lossy(&output.stdout);
                    for line in output_str.lines() {
                        let ip = line.trim();
                        if !ip.is_empty() && !ips.contains(&ip.to_string()) {
                            ips.push(ip.to_string());
                        }
                    }
                }
            }
        }

        ips
    }

    /// Collect a full telemetry report
    pub fn collect(&self) -> TelemetryReport {
        // Refresh system data
        let mut system = System::new_all();
        system.refresh_all();

        let disks = Disks::new_with_refreshed_list();
        let mut networks = Networks::new_with_refreshed_list();
        networks.refresh();

        // Calculate CPU usage
        let cpu_usage = system.global_cpu_usage() as f64;

        // Memory statistics
        let memory_total = system.total_memory();
        let memory_used = system.used_memory();
        let memory_available = system.available_memory();

        // Swap statistics
        let swap_total = system.total_swap();
        let swap_used = system.used_swap();

        // Collect disk usage
        let disk_usage: Vec<DiskUsage> = disks
            .list()
            .iter()
            .map(|disk| {
                let total = disk.total_space();
                let available = disk.available_space();
                let used = total.saturating_sub(available);
                let usage_percent = if total > 0 {
                    (used as f64 / total as f64) * 100.0
                } else {
                    0.0
                };

                DiskUsage {
                    mount_point: disk.mount_point().to_string_lossy().to_string(),
                    filesystem: disk.file_system().to_string_lossy().to_string(),
                    device: disk.name().to_string_lossy().to_string(),
                    total_bytes: total,
                    used_bytes: used,
                    available_bytes: available,
                    usage_percent,
                }
            })
            .collect();

        // Collect network interfaces
        let interfaces: Vec<InterfaceInfo> = networks
            .list()
            .iter()
            .filter(|(name, _)| {
                // Filter out loopback and docker interfaces
                !name.starts_with("lo")
                    && !name.starts_with("docker")
                    && !name.starts_with("br-")
                    && !name.starts_with("veth")
            })
            .map(|(name, data)| {
                InterfaceInfo {
                    name: name.to_string(),
                    mac_address: data.mac_address().to_string(),
                    ipv4_addresses: Vec::new(), // sysinfo doesn't provide IPs directly
                    ipv6_addresses: Vec::new(),
                    state: InterfaceState::Up as i32,
                    mtu: 0, // sysinfo doesn't provide MTU
                    rx_bytes: data.total_received(),
                    tx_bytes: data.total_transmitted(),
                    rx_packets: data.total_packets_received(),
                    tx_packets: data.total_packets_transmitted(),
                }
            })
            .collect();

        // Load averages (Unix only)
        let (load_1, load_5, load_15) = Self::get_load_averages();

        // Process count
        let process_count = system.processes().len() as u32;

        // System uptime
        let uptime = System::uptime();

        // Hostname
        let hostname = System::host_name().unwrap_or_else(|| "unknown".to_string());

        debug!(
            cpu_usage = cpu_usage,
            memory_used = memory_used,
            memory_total = memory_total,
            disk_count = disk_usage.len(),
            interface_count = interfaces.len(),
            "Collected telemetry"
        );

        TelemetryReport {
            cpu_usage_percent: cpu_usage,
            memory_total_bytes: memory_total,
            memory_used_bytes: memory_used,
            memory_available_bytes: memory_available,
            swap_total_bytes: swap_total,
            swap_used_bytes: swap_used,
            disks: disk_usage,
            interfaces,
            load_avg_1: load_1,
            load_avg_5: load_5,
            load_avg_15: load_15,
            process_count,
            uptime_seconds: uptime,
            hostname,
        }
    }

    /// Get system load averages
    #[cfg(unix)]
    fn get_load_averages() -> (f64, f64, f64) {
        let load_avg = System::load_average();
        (load_avg.one, load_avg.five, load_avg.fifteen)
    }

    #[cfg(windows)]
    fn get_load_averages() -> (f64, f64, f64) {
        // Windows doesn't have load averages in the Unix sense
        // Return CPU usage as a rough approximation
        (0.0, 0.0, 0.0)
    }
}

impl Default for TelemetryCollector {
    fn default() -> Self {
        Self::new()
    }
}
