//! Network Configuration Module
//!
//! Handles network interface discovery, configuration, and troubleshooting.

use std::fs;
use std::process::Command;

use anyhow::{Context, Result};
use tracing::{error, info, warn};

/// Network interface information
#[derive(Debug, Clone, Default)]
pub struct NetworkInterface {
    /// Interface name (e.g., "eth0")
    pub name: String,
    /// IP address (if assigned)
    pub ip_address: Option<String>,
    /// MAC address
    pub mac_address: String,
    /// Link state ("up" or "down")
    pub state: String,
    /// Whether using DHCP
    pub dhcp: bool,
    /// Gateway (if this is the default route interface)
    pub gateway: Option<String>,
    /// Speed in Mbps (if available)
    pub speed: Option<u32>,
}

/// Network configuration for an interface
#[derive(Debug, Clone)]
pub struct NetworkConfig {
    pub interface: String,
    pub use_dhcp: bool,
    pub static_ip: Option<String>,      // CIDR notation: "192.168.1.100/24"
    pub gateway: Option<String>,
    pub dns_servers: Vec<String>,
}

/// Network manager for interface configuration
pub struct NetworkManager;

impl NetworkManager {
    /// Discover all network interfaces
    pub fn discover_interfaces() -> Vec<NetworkInterface> {
        let mut interfaces = Vec::new();

        // Parse 'ip link show' for interface list
        let link_output = match Command::new("ip").args(["link", "show"]).output() {
            Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
            Err(e) => {
                error!(error = %e, "Failed to run 'ip link show'");
                return interfaces;
            }
        };

        // Parse interfaces from output
        let mut current_iface: Option<NetworkInterface> = None;

        for line in link_output.lines() {
            if line.starts_with(char::is_numeric) {
                // Save previous interface
                if let Some(iface) = current_iface.take() {
                    if iface.name != "lo" {
                        interfaces.push(iface);
                    }
                }

                // Parse new interface: "2: eth0: <...> state UP ..."
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let name = parts[1].trim_end_matches(':').to_string();
                    let state = if line.contains("state UP") {
                        "up"
                    } else if line.contains("state DOWN") {
                        "down"
                    } else {
                        "unknown"
                    };

                    current_iface = Some(NetworkInterface {
                        name,
                        state: state.to_string(),
                        ..Default::default()
                    });
                }
            } else if line.contains("link/ether") {
                // Parse MAC address
                if let Some(ref mut iface) = current_iface {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        iface.mac_address = parts[1].to_string();
                    }
                }
            }
        }

        // Don't forget the last interface
        if let Some(iface) = current_iface {
            if iface.name != "lo" {
                interfaces.push(iface);
            }
        }

        // Get IP addresses
        Self::populate_ip_addresses(&mut interfaces);

        // Get gateway info
        Self::populate_gateway_info(&mut interfaces);

        // Check for DHCP
        Self::populate_dhcp_status(&mut interfaces);

        // Get link speeds
        Self::populate_link_speeds(&mut interfaces);

        interfaces
    }

    /// Populate IP addresses for interfaces
    fn populate_ip_addresses(interfaces: &mut [NetworkInterface]) {
        let addr_output = match Command::new("ip").args(["addr", "show"]).output() {
            Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
            Err(_) => return,
        };

        let mut current_name = String::new();

        for line in addr_output.lines() {
            if line.starts_with(char::is_numeric) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    current_name = parts[1].trim_end_matches(':').to_string();
                }
            } else if line.contains("inet ") && !line.contains("inet6") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let ip = parts[1].split('/').next().unwrap_or("").to_string();
                    for iface in interfaces.iter_mut() {
                        if iface.name == current_name {
                            iface.ip_address = Some(ip.clone());
                        }
                    }
                }
            }
        }
    }

    /// Populate gateway information
    fn populate_gateway_info(interfaces: &mut [NetworkInterface]) {
        let route_output = match Command::new("ip").args(["route", "show", "default"]).output() {
            Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
            Err(_) => return,
        };

        // Parse: "default via 192.168.1.1 dev eth0"
        for line in route_output.lines() {
            if line.starts_with("default") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                let gateway = parts.get(2).map(|s| s.to_string());
                let dev = parts.iter().position(|&x| x == "dev").and_then(|i| parts.get(i + 1));

                if let Some(dev_name) = dev {
                    for iface in interfaces.iter_mut() {
                        if &iface.name == dev_name {
                            iface.gateway = gateway.clone();
                        }
                    }
                }
            }
        }
    }

    /// Check if interfaces are using DHCP
    fn populate_dhcp_status(interfaces: &mut [NetworkInterface]) {
        // Check for dhclient/udhcpc processes
        let ps_output = Command::new("ps")
            .args(["aux"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();

        for iface in interfaces.iter_mut() {
            // Check if dhclient or udhcpc is running for this interface
            if ps_output.contains(&format!("dhclient {}", iface.name))
                || ps_output.contains(&format!("dhclient.*{}", iface.name))
                || ps_output.contains(&format!("udhcpc.*{}", iface.name))
            {
                iface.dhcp = true;
            }

            // Also check /var/run/dhclient-{iface}.pid
            let dhclient_pid = format!("/var/run/dhclient-{}.pid", iface.name);
            if std::path::Path::new(&dhclient_pid).exists() {
                iface.dhcp = true;
            }
        }
    }

    /// Get link speeds from ethtool
    fn populate_link_speeds(interfaces: &mut [NetworkInterface]) {
        for iface in interfaces.iter_mut() {
            if let Ok(output) = Command::new("ethtool").arg(&iface.name).output() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    if line.contains("Speed:") {
                        // Parse "Speed: 1000Mb/s"
                        if let Some(speed_str) = line.split(':').nth(1) {
                            let speed_str = speed_str.trim().trim_end_matches("Mb/s");
                            if let Ok(speed) = speed_str.parse::<u32>() {
                                iface.speed = Some(speed);
                            }
                        }
                    }
                }
            }
        }
    }

    /// Configure an interface with static IP
    pub fn configure_static(config: &NetworkConfig) -> Result<()> {
        let iface = &config.interface;
        let ip = config.static_ip.as_ref().context("Static IP required")?;

        info!(interface = %iface, ip = %ip, "Configuring static IP");

        // Bring interface down
        let _ = Command::new("ip").args(["link", "set", iface, "down"]).output();

        // Kill any DHCP clients
        let _ = Command::new("pkill").args(["-f", &format!("dhclient.*{}", iface)]).output();
        let _ = Command::new("pkill").args(["-f", &format!("udhcpc.*{}", iface)]).output();

        // Flush existing addresses
        Command::new("ip")
            .args(["addr", "flush", "dev", iface])
            .output()
            .context("Failed to flush addresses")?;

        // Add new address
        Command::new("ip")
            .args(["addr", "add", ip, "dev", iface])
            .output()
            .context("Failed to add IP address")?;

        // Bring interface up
        Command::new("ip")
            .args(["link", "set", iface, "up"])
            .output()
            .context("Failed to bring interface up")?;

        // Configure gateway
        if let Some(gw) = &config.gateway {
            // Delete existing default route
            let _ = Command::new("ip").args(["route", "del", "default"]).output();

            // Add new default route
            Command::new("ip")
                .args(["route", "add", "default", "via", gw])
                .output()
                .context("Failed to add default route")?;
        }

        // Configure DNS
        if !config.dns_servers.is_empty() {
            Self::configure_dns(&config.dns_servers)?;
        }

        // Persist configuration to /etc/network/interfaces (Alpine)
        Self::persist_static_config(config)?;

        info!(interface = %iface, "Static IP configured successfully");
        Ok(())
    }

    /// Configure an interface with DHCP
    pub fn configure_dhcp(interface: &str) -> Result<()> {
        info!(interface = %interface, "Configuring DHCP");

        // Kill existing DHCP clients for this interface
        let _ = Command::new("pkill").args(["-f", &format!("dhclient.*{}", interface)]).output();
        let _ = Command::new("pkill").args(["-f", &format!("udhcpc.*{}", interface)]).output();

        // Flush existing addresses
        let _ = Command::new("ip").args(["addr", "flush", "dev", interface]).output();

        // Bring interface up
        Command::new("ip")
            .args(["link", "set", interface, "up"])
            .output()
            .context("Failed to bring interface up")?;

        // Try udhcpc first (BusyBox, common on Alpine)
        let result = Command::new("udhcpc")
            .args(["-i", interface, "-n", "-q", "-S"])
            .output();

        match result {
            Ok(output) if output.status.success() => {
                info!(interface = %interface, "DHCP lease obtained via udhcpc");
            }
            _ => {
                // Fall back to dhclient
                let result = Command::new("dhclient")
                    .args(["-v", interface])
                    .output();

                match result {
                    Ok(output) if output.status.success() => {
                        info!(interface = %interface, "DHCP lease obtained via dhclient");
                    }
                    Ok(output) => {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        warn!(interface = %interface, stderr = %stderr, "DHCP may have failed");
                    }
                    Err(e) => {
                        error!(interface = %interface, error = %e, "No DHCP client available");
                        return Err(anyhow::anyhow!("No DHCP client available: {}", e));
                    }
                }
            }
        }

        // Persist configuration
        Self::persist_dhcp_config(interface)?;

        Ok(())
    }

    /// Configure DNS servers in /etc/resolv.conf
    fn configure_dns(servers: &[String]) -> Result<()> {
        let mut content = String::new();
        for server in servers {
            content.push_str(&format!("nameserver {}\n", server));
        }

        fs::write("/etc/resolv.conf", content).context("Failed to write /etc/resolv.conf")?;
        Ok(())
    }

    /// Persist static configuration for Alpine Linux
    fn persist_static_config(config: &NetworkConfig) -> Result<()> {
        let iface = &config.interface;
        let ip = config.static_ip.as_ref().context("Static IP required")?;

        // Parse CIDR
        let (address, netmask) = parse_cidr(ip)?;

        let mut iface_config = format!(
            "auto {iface}\niface {iface} inet static\n    address {address}\n    netmask {netmask}\n",
            iface = iface,
            address = address,
            netmask = netmask,
        );

        if let Some(gw) = &config.gateway {
            iface_config.push_str(&format!("    gateway {}\n", gw));
        }

        // Read existing interfaces file and replace/add this interface's config
        let interfaces_path = "/etc/network/interfaces";
        let existing = fs::read_to_string(interfaces_path).unwrap_or_default();

        // Simple approach: append if not present, otherwise user should edit manually
        // For production, parse and modify the file properly
        if !existing.contains(&format!("iface {}", iface)) {
            let new_content = format!("{}\n{}", existing.trim(), iface_config);
            fs::write(interfaces_path, new_content)
                .context("Failed to write /etc/network/interfaces")?;
        }

        Ok(())
    }

    /// Persist DHCP configuration for Alpine Linux
    fn persist_dhcp_config(interface: &str) -> Result<()> {
        let iface_config = format!(
            "auto {}\niface {} inet dhcp\n",
            interface, interface
        );

        let interfaces_path = "/etc/network/interfaces";
        let existing = fs::read_to_string(interfaces_path).unwrap_or_default();

        if !existing.contains(&format!("iface {}", interface)) {
            let new_content = format!("{}\n{}", existing.trim(), iface_config);
            fs::write(interfaces_path, new_content)
                .context("Failed to write /etc/network/interfaces")?;
        }

        Ok(())
    }

    /// Bring interface up
    pub fn bring_up(interface: &str) -> Result<()> {
        Command::new("ip")
            .args(["link", "set", interface, "up"])
            .output()
            .context("Failed to bring interface up")?;
        Ok(())
    }

    /// Bring interface down
    pub fn bring_down(interface: &str) -> Result<()> {
        Command::new("ip")
            .args(["link", "set", interface, "down"])
            .output()
            .context("Failed to bring interface down")?;
        Ok(())
    }

    /// Ping a target
    pub fn ping(target: &str) -> Result<Vec<String>> {
        let output = Command::new("ping")
            .args(["-c", "3", "-W", "2", target])
            .output()
            .context("Failed to run ping")?;

        let mut lines = Vec::new();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);

        for line in stdout.lines() {
            lines.push(line.to_string());
        }
        for line in stderr.lines() {
            lines.push(format!("ERR: {}", line));
        }

        if output.status.success() {
            lines.push("[OK] Ping successful".to_string());
        } else {
            lines.push("[FAIL] Ping failed".to_string());
        }

        Ok(lines)
    }

    /// Check DNS resolution
    pub fn check_dns() -> Result<Vec<String>> {
        let mut lines = Vec::new();
        lines.push("Checking DNS resolution...".to_string());

        let output = Command::new("nslookup")
            .arg("google.com")
            .output()
            .or_else(|_| Command::new("host").arg("google.com").output())
            .context("No DNS lookup tool available")?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines().take(6) {
            lines.push(line.to_string());
        }

        if output.status.success() {
            lines.push("[OK] DNS working".to_string());
        } else {
            lines.push("[FAIL] DNS resolution failed".to_string());
        }

        Ok(lines)
    }

    /// Get default gateway
    pub fn get_default_gateway() -> Option<String> {
        Command::new("ip")
            .args(["route", "show", "default"])
            .output()
            .ok()
            .and_then(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .split_whitespace()
                    .nth(2)
                    .map(|s| s.to_string())
            })
    }

    /// Restart networking service
    pub fn restart_networking() -> Result<String> {
        let result = Command::new("rc-service")
            .args(["networking", "restart"])
            .output()
            .context("Failed to restart networking")?;

        if result.status.success() {
            Ok("[OK] Networking restarted".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&result.stderr);
            Ok(format!("[FAIL] {}", stderr))
        }
    }
}

/// Parse CIDR notation to (address, netmask)
fn parse_cidr(cidr: &str) -> Result<(String, String)> {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return Err(anyhow::anyhow!("Invalid CIDR notation: {}", cidr));
    }

    let address = parts[0].to_string();
    let prefix: u8 = parts[1].parse().context("Invalid prefix length")?;

    let netmask = prefix_to_netmask(prefix);

    Ok((address, netmask))
}

/// Convert prefix length to netmask
fn prefix_to_netmask(prefix: u8) -> String {
    let mask: u32 = if prefix == 0 {
        0
    } else {
        !0u32 << (32 - prefix)
    };

    format!(
        "{}.{}.{}.{}",
        (mask >> 24) & 0xFF,
        (mask >> 16) & 0xFF,
        (mask >> 8) & 0xFF,
        mask & 0xFF
    )
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

    #[test]
    fn test_parse_cidr() {
        let (addr, mask) = parse_cidr("192.168.1.100/24").unwrap();
        assert_eq!(addr, "192.168.1.100");
        assert_eq!(mask, "255.255.255.0");
    }
}
