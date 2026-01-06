//! Network configuration module for Quantix-OS Console
//!
//! Handles network interface detection and configuration.

use anyhow::{Context, Result};
use std::fs;
use std::process::Command;
use tracing::{error, info, warn};

use crate::config::NodeConfig;

/// Network interface information
#[derive(Debug, Clone)]
pub struct InterfaceInfo {
    pub name: String,
    pub mac: String,
    pub ip: String,
    pub status: String,
}

/// Get list of network interfaces
pub fn get_interfaces() -> Vec<InterfaceInfo> {
    let mut interfaces = Vec::new();

    // Read from /sys/class/net
    if let Ok(entries) = fs::read_dir("/sys/class/net") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip loopback and virtual interfaces
            if name == "lo" || name.starts_with("veth") || name.starts_with("docker") {
                continue;
            }

            let iface = InterfaceInfo {
                name: name.clone(),
                mac: get_mac_address(&name).unwrap_or_default(),
                ip: get_ip_address(&name).unwrap_or_default(),
                status: get_interface_status(&name).unwrap_or_else(|| "unknown".to_string()),
            };

            interfaces.push(iface);
        }
    }

    // Sort by name
    interfaces.sort_by(|a, b| a.name.cmp(&b.name));

    interfaces
}

/// Get MAC address for an interface
fn get_mac_address(interface: &str) -> Option<String> {
    let path = format!("/sys/class/net/{}/address", interface);
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

/// Get IP address for an interface
fn get_ip_address(interface: &str) -> Option<String> {
    // Use ip command to get IP address
    let output = Command::new("ip")
        .args(["-4", "addr", "show", interface])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse "inet x.x.x.x/xx" from output
    for line in stdout.lines() {
        let line = line.trim();
        if line.starts_with("inet ") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                // Return IP without CIDR notation
                return Some(parts[1].split('/').next()?.to_string());
            }
        }
    }

    None
}

/// Get interface status (up/down)
fn get_interface_status(interface: &str) -> Option<String> {
    let path = format!("/sys/class/net/{}/operstate", interface);
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

/// Apply network configuration
pub fn apply_config(config: &NodeConfig) -> Result<()> {
    if config.network_interface.is_empty() {
        warn!("⚠️ No network interface specified");
        return Ok(());
    }

    info!(
        "🌐 Applying network configuration for interface: {}",
        config.network_interface
    );

    if config.use_dhcp {
        apply_dhcp(&config.network_interface)?;
    } else {
        apply_static(
            &config.network_interface,
            &config.static_ip,
            &config.gateway,
            &config.dns,
        )?;
    }

    Ok(())
}

/// Apply DHCP configuration
fn apply_dhcp(interface: &str) -> Result<()> {
    info!("🌐 Configuring {} with DHCP", interface);

    // Create interfaces file for Alpine
    let config = format!(
        r#"auto lo
iface lo inet loopback

auto {interface}
iface {interface} inet dhcp
"#
    );

    fs::write("/etc/network/interfaces", config).context("Failed to write network interfaces")?;

    // Restart networking
    restart_networking()?;

    Ok(())
}

/// Apply static IP configuration
fn apply_static(interface: &str, ip: &str, gateway: &str, dns: &str) -> Result<()> {
    info!(
        "🌐 Configuring {} with static IP: {}",
        interface,
        ip
    );

    // Parse IP and netmask
    let (address, netmask) = if ip.contains('/') {
        let parts: Vec<&str> = ip.split('/').collect();
        let prefix: u8 = parts.get(1).unwrap_or(&"24").parse().unwrap_or(24);
        let netmask = prefix_to_netmask(prefix);
        (parts[0].to_string(), netmask)
    } else {
        (ip.to_string(), "255.255.255.0".to_string())
    };

    // Create interfaces file for Alpine
    let config = format!(
        r#"auto lo
iface lo inet loopback

auto {interface}
iface {interface} inet static
    address {address}
    netmask {netmask}
    gateway {gateway}
"#
    );

    fs::write("/etc/network/interfaces", config).context("Failed to write network interfaces")?;

    // Configure DNS
    let resolv_conf = format!("nameserver {}\n", dns);
    fs::write("/etc/resolv.conf", resolv_conf).context("Failed to write resolv.conf")?;

    // Restart networking
    restart_networking()?;

    Ok(())
}

/// Convert CIDR prefix to netmask
fn prefix_to_netmask(prefix: u8) -> String {
    let mask: u32 = if prefix == 0 {
        0
    } else {
        !((1u32 << (32 - prefix)) - 1)
    };

    format!(
        "{}.{}.{}.{}",
        (mask >> 24) & 0xFF,
        (mask >> 16) & 0xFF,
        (mask >> 8) & 0xFF,
        mask & 0xFF
    )
}

/// Restart networking service
fn restart_networking() -> Result<()> {
    info!("🔄 Restarting networking...");

    // Try OpenRC first
    let output = Command::new("rc-service")
        .args(["networking", "restart"])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            info!("✅ Networking restarted successfully");
        }
        _ => {
            // Fallback to ifdown/ifup
            warn!("⚠️ rc-service failed, trying ifdown/ifup");

            Command::new("ifdown").arg("-a").output().ok();
            Command::new("ifup").arg("-a").output().ok();
        }
    }

    Ok(())
}

/// Get the primary IP address of the system
pub fn get_primary_ip() -> String {
    // Try to get IP from common interfaces
    for iface in ["eth0", "ens3", "enp0s3", "ens192"] {
        if let Some(ip) = get_ip_address(iface) {
            return ip;
        }
    }

    // Fall back to any interface with an IP
    for iface in get_interfaces() {
        if !iface.ip.is_empty() && !iface.ip.starts_with("127.") {
            return iface.ip;
        }
    }

    "0.0.0.0".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prefix_to_netmask() {
        assert_eq!(prefix_to_netmask(24), "255.255.255.0");
        assert_eq!(prefix_to_netmask(16), "255.255.0.0");
        assert_eq!(prefix_to_netmask(8), "255.0.0.0");
        assert_eq!(prefix_to_netmask(32), "255.255.255.255");
        assert_eq!(prefix_to_netmask(0), "0.0.0.0");
    }
}
