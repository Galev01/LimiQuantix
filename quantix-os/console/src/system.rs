//! System information utilities

use std::process::Command;

/// Get the management IP address
pub fn get_management_ip() -> Option<String> {
    // Try to get the first non-loopback IPv4 address
    let output = Command::new("ip")
        .args(["-4", "addr", "show"])
        .output()
        .ok()?;

    let output_str = String::from_utf8_lossy(&output.stdout);

    for line in output_str.lines() {
        if line.contains("inet ") && !line.contains("127.0.0.1") {
            // Extract IP from "inet 192.168.1.100/24 ..."
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(addr) = parts.get(1) {
                // Remove CIDR notation
                return Some(addr.split('/').next().unwrap_or(addr).to_string());
            }
        }
    }

    None
}

/// Get system uptime as human-readable string
pub fn get_uptime() -> String {
    if let Ok(contents) = std::fs::read_to_string("/proc/uptime") {
        if let Some(seconds_str) = contents.split_whitespace().next() {
            if let Ok(seconds) = seconds_str.parse::<f64>() {
                let seconds = seconds as u64;
                let days = seconds / 86400;
                let hours = (seconds % 86400) / 3600;
                let minutes = (seconds % 3600) / 60;

                if days > 0 {
                    return format!("{}d {}h {}m", days, hours, minutes);
                } else if hours > 0 {
                    return format!("{}h {}m", hours, minutes);
                } else {
                    return format!("{}m", minutes);
                }
            }
        }
    }

    "unknown".to_string()
}

/// Get kernel version
pub fn get_kernel_version() -> String {
    std::fs::read_to_string("/proc/version")
        .ok()
        .and_then(|v| v.split_whitespace().nth(2).map(String::from))
        .unwrap_or_else(|| "unknown".to_string())
}

/// Check if a service is running
pub fn is_service_running(service: &str) -> bool {
    Command::new("rc-service")
        .args([service, "status"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Restart a service
pub fn restart_service(service: &str) -> std::io::Result<bool> {
    let status = Command::new("rc-service")
        .args([service, "restart"])
        .status()?;
    Ok(status.success())
}

/// Get list of running VMs
pub fn get_running_vms() -> Vec<String> {
    Command::new("virsh")
        .args(["list", "--name"])
        .output()
        .ok()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|l| !l.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
}

/// Get total VM count (including stopped)
pub fn get_total_vm_count() -> usize {
    Command::new("virsh")
        .args(["list", "--all", "--name"])
        .output()
        .ok()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|l| !l.is_empty())
                .count()
        })
        .unwrap_or(0)
}

/// Reboot the system
pub fn reboot() -> std::io::Result<()> {
    Command::new("reboot").spawn()?;
    Ok(())
}

/// Shutdown the system
pub fn shutdown() -> std::io::Result<()> {
    Command::new("poweroff").spawn()?;
    Ok(())
}

/// Enable emergency shell access
pub fn enable_emergency_shell() -> std::io::Result<()> {
    // Create marker file that inittab checks
    std::fs::write("/tmp/.emergency_shell", "")?;
    Ok(())
}
