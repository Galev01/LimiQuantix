//! SSH Management Module
//!
//! Handles SSH service enable/disable and status monitoring.

use std::process::Command;

use anyhow::{Context, Result};
use tracing::{error, info, warn};

/// SSH service status
#[derive(Debug, Clone)]
pub struct SshStatus {
    /// Is the SSH service running
    pub running: bool,
    /// Is SSH enabled to start on boot
    pub enabled: bool,
    /// Number of active SSH sessions
    pub active_sessions: u32,
    /// Error message if status check failed
    pub error: Option<String>,
}

impl Default for SshStatus {
    fn default() -> Self {
        Self {
            running: false,
            enabled: false,
            active_sessions: 0,
            error: None,
        }
    }
}

/// SSH Manager for controlling the SSH service
pub struct SshManager;

impl SshManager {
    /// Get current SSH status
    pub fn status() -> SshStatus {
        let mut status = SshStatus::default();

        // Check if sshd is running
        status.running = Self::is_service_running("sshd");

        // Check if sshd is enabled on boot
        status.enabled = Self::is_service_enabled("sshd");

        // Count active sessions
        status.active_sessions = Self::count_ssh_sessions();

        status
    }

    /// Enable SSH service (start now and enable on boot)
    pub fn enable() -> Result<()> {
        info!("Enabling SSH service");

        // Add to default runlevel
        let enable_result = Command::new("rc-update")
            .args(["add", "sshd", "default"])
            .output()
            .context("Failed to enable sshd on boot")?;

        if !enable_result.status.success() {
            let stderr = String::from_utf8_lossy(&enable_result.stderr);
            // Ignore "already in runlevel" errors
            if !stderr.contains("already") {
                warn!(stderr = %stderr, "rc-update add sshd warning");
            }
        }

        // Start the service
        let start_result = Command::new("rc-service")
            .args(["sshd", "start"])
            .output()
            .context("Failed to start sshd")?;

        if !start_result.status.success() {
            let stderr = String::from_utf8_lossy(&start_result.stderr);
            // Ignore "already started" errors
            if !stderr.contains("already") {
                error!(stderr = %stderr, "Failed to start sshd");
                return Err(anyhow::anyhow!("Failed to start SSH: {}", stderr));
            }
        }

        info!("SSH service enabled and started");
        Ok(())
    }

    /// Disable SSH service (stop now and disable on boot)
    pub fn disable() -> Result<()> {
        info!("Disabling SSH service");

        // Stop the service first
        let stop_result = Command::new("rc-service")
            .args(["sshd", "stop"])
            .output()
            .context("Failed to stop sshd")?;

        if !stop_result.status.success() {
            let stderr = String::from_utf8_lossy(&stop_result.stderr);
            // Ignore "already stopped" errors
            if !stderr.contains("stopped") && !stderr.contains("not running") {
                warn!(stderr = %stderr, "rc-service stop sshd warning");
            }
        }

        // Remove from default runlevel
        let disable_result = Command::new("rc-update")
            .args(["del", "sshd", "default"])
            .output()
            .context("Failed to disable sshd on boot")?;

        if !disable_result.status.success() {
            let stderr = String::from_utf8_lossy(&disable_result.stderr);
            // Ignore "not in runlevel" errors
            if !stderr.contains("not in") {
                warn!(stderr = %stderr, "rc-update del sshd warning");
            }
        }

        info!("SSH service disabled and stopped");
        Ok(())
    }

    /// Restart SSH service
    pub fn restart() -> Result<()> {
        info!("Restarting SSH service");

        let result = Command::new("rc-service")
            .args(["sshd", "restart"])
            .output()
            .context("Failed to restart sshd")?;

        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            error!(stderr = %stderr, "Failed to restart sshd");
            return Err(anyhow::anyhow!("Failed to restart SSH: {}", stderr));
        }

        info!("SSH service restarted");
        Ok(())
    }

    /// Check if a service is running
    fn is_service_running(service: &str) -> bool {
        Command::new("rc-service")
            .args([service, "status"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Check if a service is enabled on boot
    fn is_service_enabled(service: &str) -> bool {
        Command::new("rc-update")
            .arg("show")
            .output()
            .map(|o| {
                let output = String::from_utf8_lossy(&o.stdout);
                output.lines().any(|line| {
                    line.contains(service) && line.contains("default")
                })
            })
            .unwrap_or(false)
    }

    /// Count active SSH sessions
    fn count_ssh_sessions() -> u32 {
        // Method 1: Check /var/run/sshd.pid and count sshd child processes
        // Method 2: Use 'who' command
        // Method 3: Parse 'ss' or 'netstat' for SSH connections

        // Using 'who' is the most reliable for counting logged-in users
        let who_count = Command::new("who")
            .output()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .filter(|line| line.contains("pts/"))
                    .count() as u32
            })
            .unwrap_or(0);

        // Also check for direct SSH connections via netstat/ss
        let ss_count = Command::new("ss")
            .args(["-tn", "state", "established", "sport", "=", ":22"])
            .output()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .filter(|line| !line.is_empty() && !line.starts_with("State"))
                    .count() as u32
            })
            .unwrap_or(0);

        // Return the max of both counts (they measure slightly different things)
        who_count.max(ss_count)
    }
}

/// Generate SSH host keys if they don't exist
pub fn ensure_host_keys() -> Result<()> {
    let key_types = ["rsa", "ecdsa", "ed25519"];
    let key_dir = "/etc/ssh";

    for key_type in &key_types {
        let key_path = format!("{}/ssh_host_{}_key", key_dir, key_type);
        if !std::path::Path::new(&key_path).exists() {
            info!(key_type = %key_type, "Generating SSH host key");

            let result = Command::new("ssh-keygen")
                .args([
                    "-t", key_type,
                    "-f", &key_path,
                    "-N", "",  // No passphrase
                    "-q",      // Quiet
                ])
                .output()
                .context(format!("Failed to generate {} host key", key_type))?;

            if !result.status.success() {
                let stderr = String::from_utf8_lossy(&result.stderr);
                error!(key_type = %key_type, stderr = %stderr, "Failed to generate host key");
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ssh_status_default() {
        let status = SshStatus::default();
        assert!(!status.running);
        assert!(!status.enabled);
        assert_eq!(status.active_sessions, 0);
        assert!(status.error.is_none());
    }
}
