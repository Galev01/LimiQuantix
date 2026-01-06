//! SSH management module for Quantix-OS Console
//!
//! Handles enabling/disabling SSH and managing SSH sessions.

use anyhow::{Context, Result};
use std::fs;
use std::process::Command;
use tracing::{error, info, warn};

/// Check if SSH is enabled
pub fn is_enabled() -> bool {
    // Check if sshd service is running
    let output = Command::new("rc-service")
        .args(["sshd", "status"])
        .output();

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.contains("started") || stdout.contains("running")
        }
        Err(_) => {
            // Fallback: check if sshd process is running
            Command::new("pgrep")
                .arg("sshd")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        }
    }
}

/// Enable SSH service
pub fn enable_ssh() -> Result<()> {
    info!("🔐 Enabling SSH...");

    // Generate host keys if they don't exist
    generate_host_keys()?;

    // Enable sshd service
    let output = Command::new("rc-update")
        .args(["add", "sshd", "default"])
        .output()
        .context("Failed to enable sshd service")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!("⚠️ rc-update output: {}", stderr);
    }

    // Start sshd service
    let output = Command::new("rc-service")
        .args(["sshd", "start"])
        .output()
        .context("Failed to start sshd service")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("❌ Failed to start sshd: {}", stderr);
        return Err(anyhow::anyhow!("Failed to start sshd"));
    }

    // Update admin config
    if let Ok(mut config) = crate::config::load_admin_config() {
        config.ssh_enabled = true;
        crate::config::save_admin_config(&config).ok();
    }

    // Log the action
    log_ssh_action("SSH_ENABLED");

    info!("✅ SSH enabled successfully");
    Ok(())
}

/// Disable SSH service
pub fn disable_ssh() -> Result<()> {
    info!("🔐 Disabling SSH...");

    // Stop sshd service
    let output = Command::new("rc-service")
        .args(["sshd", "stop"])
        .output()
        .context("Failed to stop sshd service")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!("⚠️ Failed to stop sshd: {}", stderr);
    }

    // Disable sshd service from starting at boot
    Command::new("rc-update")
        .args(["del", "sshd", "default"])
        .output()
        .ok();

    // Update admin config
    if let Ok(mut config) = crate::config::load_admin_config() {
        config.ssh_enabled = false;
        crate::config::save_admin_config(&config).ok();
    }

    // Log the action
    log_ssh_action("SSH_DISABLED");

    info!("✅ SSH disabled successfully");
    Ok(())
}

/// Generate SSH host keys if they don't exist
fn generate_host_keys() -> Result<()> {
    let key_types = [
        ("rsa", "/etc/ssh/ssh_host_rsa_key"),
        ("ecdsa", "/etc/ssh/ssh_host_ecdsa_key"),
        ("ed25519", "/etc/ssh/ssh_host_ed25519_key"),
    ];

    for (key_type, path) in key_types {
        if !std::path::Path::new(path).exists() {
            info!("🔑 Generating {} host key...", key_type);

            let output = Command::new("ssh-keygen")
                .args(["-t", key_type, "-f", path, "-N", "", "-q"])
                .output()
                .context(format!("Failed to generate {} host key", key_type))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                warn!("⚠️ Failed to generate {} key: {}", key_type, stderr);
            }
        }
    }

    Ok(())
}

/// Get the number of active SSH sessions
pub fn get_session_count() -> usize {
    // Count SSH sessions from who or w command
    let output = Command::new("who").output();

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout
                .lines()
                .filter(|line| line.contains("pts/") || line.contains("ssh"))
                .count()
        }
        Err(_) => 0,
    }
}

/// Get list of active SSH sessions
pub fn get_sessions() -> Vec<SshSession> {
    let mut sessions = Vec::new();

    let output = Command::new("who").output();

    if let Ok(o) = output {
        let stdout = String::from_utf8_lossy(&o.stdout);

        for line in stdout.lines() {
            if line.contains("pts/") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    sessions.push(SshSession {
                        user: parts[0].to_string(),
                        tty: parts[1].to_string(),
                        from: parts.get(4).unwrap_or(&"").trim_matches(|c| c == '(' || c == ')').to_string(),
                        login_time: format!("{} {}", parts.get(2).unwrap_or(&""), parts.get(3).unwrap_or(&"")),
                    });
                }
            }
        }
    }

    sessions
}

/// SSH session information
#[derive(Debug, Clone)]
pub struct SshSession {
    pub user: String,
    pub tty: String,
    pub from: String,
    pub login_time: String,
}

/// Log SSH action to audit log
fn log_ssh_action(action: &str) {
    let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC");
    let message = format!("[{}] {} user=console", timestamp, action);

    if let Err(e) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/var/log/quantix-console.log")
        .and_then(|mut file| {
            use std::io::Write;
            writeln!(file, "{}", message)
        })
    {
        error!("❌ Failed to write audit log: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_count() {
        // This test just ensures the function doesn't panic
        let count = get_session_count();
        assert!(count >= 0);
    }
}
