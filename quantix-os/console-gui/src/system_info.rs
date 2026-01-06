//! System information module for Quantix-OS Console
//!
//! Collects CPU, memory, uptime, and other system metrics.

use std::fs;
use sysinfo::{System, SystemExt, CpuExt};

use crate::network;

/// System information
#[derive(Debug, Clone)]
pub struct SystemInfo {
    pub hostname: String,
    pub ip_address: String,
    pub cluster_status: String,
    pub cpu_percent: f32,
    pub memory_percent: f32,
    pub memory_used: String,
    pub memory_total: String,
    pub vm_count: i32,
    pub uptime: String,
    pub version: String,
    pub recent_logs: Vec<LogEntry>,
}

/// Log entry
#[derive(Debug, Clone)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

/// Get system information
pub fn get_system_info() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    SystemInfo {
        hostname: get_hostname(),
        ip_address: network::get_primary_ip(),
        cluster_status: get_cluster_status(),
        cpu_percent: get_cpu_usage(&sys),
        memory_percent: get_memory_percent(&sys),
        memory_used: format_bytes(sys.used_memory()),
        memory_total: format_bytes(sys.total_memory()),
        vm_count: get_vm_count(),
        uptime: format_uptime(sys.uptime()),
        version: get_version(),
        recent_logs: get_recent_logs(),
    }
}

/// Get hostname
fn get_hostname() -> String {
    fs::read_to_string("/etc/hostname")
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| {
            System::new().host_name().unwrap_or_else(|| "quantix".to_string())
        })
}

/// Get cluster status
fn get_cluster_status() -> String {
    // Check if we're part of a cluster
    if fs::metadata("/quantix/cluster.yaml").is_ok() {
        "Cluster Member".to_string()
    } else {
        "Standalone".to_string()
    }
}

/// Get CPU usage percentage
fn get_cpu_usage(sys: &System) -> f32 {
    let cpus = sys.cpus();
    if cpus.is_empty() {
        return 0.0;
    }

    let total: f32 = cpus.iter().map(|cpu| cpu.cpu_usage()).sum();
    total / cpus.len() as f32
}

/// Get memory usage percentage
fn get_memory_percent(sys: &System) -> f32 {
    let total = sys.total_memory();
    if total == 0 {
        return 0.0;
    }

    (sys.used_memory() as f32 / total as f32) * 100.0
}

/// Format bytes to human-readable string
fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    const TB: u64 = GB * 1024;

    if bytes >= TB {
        format!("{:.1} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// Format uptime to human-readable string
fn format_uptime(seconds: u64) -> String {
    let days = seconds / 86400;
    let hours = (seconds % 86400) / 3600;
    let minutes = (seconds % 3600) / 60;

    if days > 0 {
        format!("{} days, {} hours", days, hours)
    } else if hours > 0 {
        format!("{} hours, {} minutes", hours, minutes)
    } else {
        format!("{} minutes", minutes)
    }
}

/// Get VM count from libvirt
fn get_vm_count() -> i32 {
    // Try to get VM count from virsh
    let output = std::process::Command::new("virsh")
        .args(["list", "--all", "--name"])
        .output();

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.lines().filter(|l| !l.trim().is_empty()).count() as i32
        }
        Err(_) => 0,
    }
}

/// Get Quantix-OS version
fn get_version() -> String {
    // Try to read from /etc/quantix-release
    if let Ok(content) = fs::read_to_string("/etc/quantix-release") {
        for line in content.lines() {
            if line.starts_with("QUANTIX_VERSION=") {
                return line
                    .trim_start_matches("QUANTIX_VERSION=")
                    .trim_matches('"')
                    .to_string();
            }
        }
    }

    "1.0.0".to_string()
}

/// Get recent log entries
fn get_recent_logs() -> Vec<LogEntry> {
    let mut logs = Vec::new();

    // Read from quantix-node log
    if let Ok(content) = fs::read_to_string("/var/log/quantix-node.log") {
        for line in content.lines().rev().take(5) {
            if let Some(entry) = parse_log_line(line) {
                logs.push(entry);
            }
        }
    }

    // If no logs, show placeholder
    if logs.is_empty() {
        logs.push(LogEntry {
            timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
            level: "info".to_string(),
            message: "System started".to_string(),
        });
    }

    logs.reverse();
    logs
}

/// Parse a log line into a LogEntry
fn parse_log_line(line: &str) -> Option<LogEntry> {
    // Try to parse common log formats
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    // Simple parsing - look for timestamp and level
    let level = if line.contains("ERROR") || line.contains("❌") {
        "error"
    } else if line.contains("WARN") || line.contains("⚠️") {
        "warn"
    } else {
        "info"
    };

    // Extract timestamp (first 8 chars if it looks like HH:MM:SS)
    let timestamp = if line.len() >= 8 && line.chars().take(8).all(|c| c.is_ascii_digit() || c == ':') {
        line[..8].to_string()
    } else {
        chrono::Local::now().format("%H:%M:%S").to_string()
    };

    // Use the rest as message
    let message = if line.len() > 20 {
        line[20..].trim().to_string()
    } else {
        line.to_string()
    };

    Some(LogEntry {
        timestamp,
        level: level.to_string(),
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_bytes() {
        assert_eq!(format_bytes(500), "500 B");
        assert_eq!(format_bytes(1024), "1.0 KB");
        assert_eq!(format_bytes(1024 * 1024), "1.0 MB");
        assert_eq!(format_bytes(1024 * 1024 * 1024), "1.0 GB");
        assert_eq!(format_bytes(1024 * 1024 * 1024 * 1024), "1.0 TB");
    }

    #[test]
    fn test_format_uptime() {
        assert_eq!(format_uptime(60), "1 minutes");
        assert_eq!(format_uptime(3600), "1 hours, 0 minutes");
        assert_eq!(format_uptime(86400), "1 days, 0 hours");
        assert_eq!(format_uptime(90061), "1 days, 1 hours");
    }
}
