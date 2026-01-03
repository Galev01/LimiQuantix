//! Network configuration utilities

use anyhow::Result;
use std::process::Command;

/// Network interface information
#[derive(Debug, Clone)]
pub struct NetworkInterface {
    pub name: String,
    pub mac_address: String,
    pub ip_addresses: Vec<String>,
    pub is_up: bool,
    pub speed: Option<u32>, // Mbps
}

/// Get list of available network interfaces
pub fn list_interfaces() -> Result<Vec<NetworkInterface>> {
    let output = Command::new("ip")
        .args(["-j", "link", "show"])
        .output()?;

    if !output.status.success() {
        anyhow::bail!("Failed to list network interfaces");
    }

    // For now, return a simplified list
    // In production, parse the JSON output properly
    let mut interfaces = Vec::new();

    // Parse simple text output as fallback
    let text_output = Command::new("ip")
        .args(["link", "show"])
        .output()?;

    let output_str = String::from_utf8_lossy(&text_output.stdout);

    for line in output_str.lines() {
        if line.contains("state UP") || line.contains("state DOWN") {
            if let Some(name) = line.split(':').nth(1) {
                let name = name.trim().split('@').next().unwrap_or(name.trim());
                if name != "lo" {
                    interfaces.push(NetworkInterface {
                        name: name.to_string(),
                        mac_address: String::new(),
                        ip_addresses: Vec::new(),
                        is_up: line.contains("state UP"),
                        speed: None,
                    });
                }
            }
        }
    }

    Ok(interfaces)
}

/// Configure interface with DHCP
pub fn configure_dhcp(interface: &str) -> Result<()> {
    let status = Command::new("udhcpc")
        .args(["-i", interface, "-n", "-q"])
        .status()?;

    if !status.success() {
        anyhow::bail!("DHCP configuration failed");
    }

    Ok(())
}

/// Configure interface with static IP
pub fn configure_static(
    interface: &str,
    address: &str,
    gateway: &str,
    dns: &[String],
) -> Result<()> {
    // Flush existing configuration
    Command::new("ip")
        .args(["addr", "flush", "dev", interface])
        .status()?;

    // Add new address
    Command::new("ip")
        .args(["addr", "add", address, "dev", interface])
        .status()?;

    // Bring interface up
    Command::new("ip")
        .args(["link", "set", interface, "up"])
        .status()?;

    // Add default route
    Command::new("ip")
        .args(["route", "add", "default", "via", gateway])
        .status()?;

    // Configure DNS
    let mut resolv_contents = String::new();
    for server in dns {
        resolv_contents.push_str(&format!("nameserver {}\n", server));
    }
    std::fs::write("/etc/resolv.conf", resolv_contents)?;

    Ok(())
}

/// Test network connectivity
pub fn test_connectivity(target: &str) -> Result<bool> {
    let status = Command::new("ping")
        .args(["-c", "1", "-W", "5", target])
        .status()?;

    Ok(status.success())
}
