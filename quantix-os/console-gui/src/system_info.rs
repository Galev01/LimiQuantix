//! System information utilities for Quantix Console

use std::fs;
use std::net::IpAddr;
use std::time::Duration;

/// Get the management IP address
pub fn get_management_ip() -> Option<String> {
    // Try to read from our config first
    if let Ok(ip) = fs::read_to_string("/quantix/management_ip") {
        let ip = ip.trim();
        if !ip.is_empty() {
            return Some(ip.to_string());
        }
    }

    // Otherwise, try to detect from network interfaces
    get_first_non_loopback_ip()
}

/// Get the first non-loopback IPv4 address
fn get_first_non_loopback_ip() -> Option<String> {
    // Read from /proc/net/fib_trie or use nix
    if let Ok(addrs) = nix::ifaddrs::getifaddrs() {
        for ifaddr in addrs {
            // Skip loopback
            if ifaddr.interface_name == "lo" {
                continue;
            }

            // Get IPv4 address
            if let Some(addr) = ifaddr.address {
                if let Some(sockaddr) = addr.as_sockaddr_in() {
                    let ip = IpAddr::V4(sockaddr.ip());
                    if !ip.is_loopback() {
                        return Some(ip.to_string());
                    }
                }
            }
        }
    }

    None
}

/// Get system uptime as a human-readable string
pub fn get_uptime() -> String {
    if let Ok(content) = fs::read_to_string("/proc/uptime") {
        if let Some(seconds_str) = content.split_whitespace().next() {
            if let Ok(seconds) = seconds_str.parse::<f64>() {
                return format_duration(Duration::from_secs_f64(seconds));
            }
        }
    }
    "Unknown".to_string()
}

/// Format a duration as a human-readable string
fn format_duration(duration: Duration) -> String {
    let total_secs = duration.as_secs();
    let days = total_secs / 86400;
    let hours = (total_secs % 86400) / 3600;
    let mins = (total_secs % 3600) / 60;

    if days > 0 {
        format!("{}d {}h {}m", days, hours, mins)
    } else if hours > 0 {
        format!("{}h {}m", hours, mins)
    } else {
        format!("{}m", mins)
    }
}

/// Get kernel version
pub fn get_kernel_version() -> String {
    fs::read_to_string("/proc/version")
        .ok()
        .and_then(|v| v.split_whitespace().nth(2).map(String::from))
        .unwrap_or_else(|| "Unknown".to_string())
}
