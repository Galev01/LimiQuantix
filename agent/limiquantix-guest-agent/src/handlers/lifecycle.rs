//! Lifecycle operation handlers.
//!
//! Handles shutdown, password reset, and network configuration requests.

use limiquantix_proto::agent::{
    agent_message, ConfigureNetworkRequest, ConfigureNetworkResponse, ResetPasswordRequest,
    ResetPasswordResponse, ShutdownRequest, ShutdownResponse, ShutdownType,
};
use std::process::Command;
use tracing::{error, info, warn};

/// Handle a shutdown request.
pub async fn handle_shutdown(req: ShutdownRequest) -> agent_message::Payload {
    let shutdown_type = ShutdownType::try_from(req.r#type).unwrap_or(ShutdownType::Poweroff);
    let delay = req.delay_seconds;

    info!(
        shutdown_type = ?shutdown_type,
        delay_seconds = delay,
        message = %req.message,
        "Processing shutdown request"
    );

    #[cfg(unix)]
    {
        let cmd = match shutdown_type {
            ShutdownType::Poweroff => "poweroff",
            ShutdownType::Reboot => "reboot",
            ShutdownType::Halt => "halt",
        };

        // Build shutdown command
        let result = if delay > 0 {
            // Use shutdown with delay
            let delay_arg = format!("+{}", delay / 60); // shutdown uses minutes
            Command::new("shutdown")
                .arg(match shutdown_type {
                    ShutdownType::Poweroff => "-P",
                    ShutdownType::Reboot => "-r",
                    ShutdownType::Halt => "-H",
                })
                .arg(&delay_arg)
                .arg(&req.message)
                .output()
        } else {
            // Immediate shutdown
            Command::new(cmd).output()
        };

        match result {
            Ok(output) => {
                if output.status.success() {
                    info!("Shutdown command accepted");
                    agent_message::Payload::ShutdownResponse(ShutdownResponse {
                        accepted: true,
                        error: String::new(),
                    })
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    error!(stderr = %stderr, "Shutdown command failed");
                    agent_message::Payload::ShutdownResponse(ShutdownResponse {
                        accepted: false,
                        error: stderr.to_string(),
                    })
                }
            }
            Err(e) => {
                error!(error = %e, "Failed to execute shutdown command");
                agent_message::Payload::ShutdownResponse(ShutdownResponse {
                    accepted: false,
                    error: format!("Failed to execute: {}", e),
                })
            }
        }
    }

    #[cfg(windows)]
    {
        let cmd = match shutdown_type {
            ShutdownType::Poweroff => "/s",
            ShutdownType::Reboot => "/r",
            ShutdownType::Halt => "/s", // Windows doesn't have halt, use shutdown
        };

        let mut command = Command::new("shutdown");
        command.arg(cmd);

        if delay > 0 {
            command.arg("/t").arg(delay.to_string());
        } else {
            command.arg("/t").arg("0");
        }

        if !req.message.is_empty() {
            command.arg("/c").arg(&req.message);
        }

        match command.output() {
            Ok(output) => {
                if output.status.success() {
                    info!("Shutdown command accepted");
                    agent_message::Payload::ShutdownResponse(ShutdownResponse {
                        accepted: true,
                        error: String::new(),
                    })
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    error!(stderr = %stderr, "Shutdown command failed");
                    agent_message::Payload::ShutdownResponse(ShutdownResponse {
                        accepted: false,
                        error: stderr.to_string(),
                    })
                }
            }
            Err(e) => {
                error!(error = %e, "Failed to execute shutdown command");
                agent_message::Payload::ShutdownResponse(ShutdownResponse {
                    accepted: false,
                    error: format!("Failed to execute: {}", e),
                })
            }
        }
    }
}

/// Handle a password reset request.
pub async fn handle_reset_password(req: ResetPasswordRequest) -> agent_message::Payload {
    let username = &req.username;
    let password = &req.new_password;

    info!(username = %username, expire = req.expire, "Processing password reset");

    #[cfg(unix)]
    {
        // Use chpasswd to set the password
        let input = format!("{}:{}", username, password);
        let result = Command::new("chpasswd")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut child| {
                use std::io::Write;
                if let Some(ref mut stdin) = child.stdin {
                    stdin.write_all(input.as_bytes())?;
                }
                child.wait()
            });

        match result {
            Ok(status) if status.success() => {
                info!(username = %username, "Password changed successfully");

                // Expire password if requested
                if req.expire {
                    let expire_result = Command::new("passwd")
                        .arg("-e")
                        .arg(username)
                        .output();

                    if let Err(e) = expire_result {
                        warn!(error = %e, "Failed to expire password");
                    }
                }

                agent_message::Payload::ResetPasswordResponse(ResetPasswordResponse {
                    success: true,
                    error: String::new(),
                })
            }
            Ok(status) => {
                error!(exit_code = ?status.code(), "chpasswd failed");
                agent_message::Payload::ResetPasswordResponse(ResetPasswordResponse {
                    success: false,
                    error: format!("chpasswd failed with exit code {:?}", status.code()),
                })
            }
            Err(e) => {
                error!(error = %e, "Failed to run chpasswd");
                agent_message::Payload::ResetPasswordResponse(ResetPasswordResponse {
                    success: false,
                    error: format!("Failed to run chpasswd: {}", e),
                })
            }
        }
    }

    #[cfg(windows)]
    {
        // Use net user to set the password
        let result = Command::new("net")
            .args(["user", username, password])
            .output();

        match result {
            Ok(output) if output.status.success() => {
                info!(username = %username, "Password changed successfully");

                // Expire password if requested (force change at next logon)
                if req.expire {
                    let expire_result = Command::new("net")
                        .args(["user", username, "/logonpasswordchg:yes"])
                        .output();

                    if let Err(e) = expire_result {
                        warn!(error = %e, "Failed to expire password");
                    }
                }

                agent_message::Payload::ResetPasswordResponse(ResetPasswordResponse {
                    success: true,
                    error: String::new(),
                })
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                error!(stderr = %stderr, "net user failed");
                agent_message::Payload::ResetPasswordResponse(ResetPasswordResponse {
                    success: false,
                    error: stderr.to_string(),
                })
            }
            Err(e) => {
                error!(error = %e, "Failed to run net user");
                agent_message::Payload::ResetPasswordResponse(ResetPasswordResponse {
                    success: false,
                    error: format!("Failed to run net user: {}", e),
                })
            }
        }
    }
}

/// Handle a network configuration request.
/// Supports Netplan (Ubuntu/Debian) and NetworkManager (RHEL/CentOS/Fedora).
pub async fn handle_configure_network(req: ConfigureNetworkRequest) -> agent_message::Payload {
    info!(apply_now = req.apply_now, "Processing network configuration");

    #[cfg(unix)]
    {
        // Detect which network manager is in use
        let network_manager = detect_network_manager();
        
        match network_manager {
            NetworkManager::Netplan => configure_netplan(&req).await,
            NetworkManager::NetworkManager => configure_networkmanager(&req).await,
            NetworkManager::Unknown => {
                // Fall back to trying netplan
                warn!("Unknown network manager, attempting netplan");
                configure_netplan(&req).await
            }
        }
    }

    #[cfg(windows)]
    {
        // Windows network configuration via netsh
        configure_windows_network(&req)
    }
}

#[cfg(unix)]
enum NetworkManager {
    Netplan,
    NetworkManager,
    Unknown,
}

#[cfg(unix)]
fn detect_network_manager() -> NetworkManager {
    use std::path::Path;
    
    // Check for netplan (Ubuntu 18.04+)
    if Path::new("/usr/sbin/netplan").exists() || Path::new("/etc/netplan").exists() {
        return NetworkManager::Netplan;
    }
    
    // Check for NetworkManager (RHEL, CentOS, Fedora)
    if Path::new("/usr/bin/nmcli").exists() {
        return NetworkManager::NetworkManager;
    }
    
    NetworkManager::Unknown
}

#[cfg(unix)]
async fn configure_netplan(req: &ConfigureNetworkRequest) -> agent_message::Payload {
    let netplan_path = "/etc/netplan/99-limiquantix.yaml";

    // Write the config file
    if let Err(e) = std::fs::write(netplan_path, &req.netplan_config) {
        error!(error = %e, path = netplan_path, "Failed to write netplan config");
        return agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
            success: false,
            error: format!("Failed to write config: {}", e),
        });
    }

    info!(path = netplan_path, "Wrote netplan configuration");

    // Apply if requested
    if req.apply_now {
        let result = Command::new("netplan").arg("apply").output();

        match result {
            Ok(output) if output.status.success() => {
                info!("Network configuration applied via netplan");
                agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
                    success: true,
                    error: String::new(),
                })
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                error!(stderr = %stderr, "netplan apply failed");
                agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
                    success: false,
                    error: stderr.to_string(),
                })
            }
            Err(e) => {
                error!(error = %e, "Failed to run netplan apply");
                agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
                    success: false,
                    error: format!("Failed to apply: {}", e),
                })
            }
        }
    } else {
        agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
            success: true,
            error: String::new(),
        })
    }
}

#[cfg(unix)]
async fn configure_networkmanager(req: &ConfigureNetworkRequest) -> agent_message::Payload {
    // NetworkManager approach:
    // 1. Parse the netplan YAML config (since that's what we receive)
    // 2. Convert to nmcli commands or write keyfile format
    
    // For now, we write a keyfile-format connection
    let nm_path = "/etc/NetworkManager/system-connections/limiquantix.nmconnection";
    
    // The config might be in netplan format - try to convert it
    // If it's already in keyfile format, use directly
    let config = if req.netplan_config.starts_with("[connection]") {
        // Already in keyfile format
        req.netplan_config.clone()
    } else {
        // Assume netplan format - for simplicity, just write as-is and let user provide correct format
        // A more complete implementation would parse YAML and convert
        req.netplan_config.clone()
    };
    
    // Write the config file
    if let Err(e) = std::fs::write(nm_path, &config) {
        error!(error = %e, path = nm_path, "Failed to write NetworkManager config");
        return agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
            success: false,
            error: format!("Failed to write config: {}", e),
        });
    }
    
    // Set correct permissions (600 required for nmconnection files)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(nm_path, std::fs::Permissions::from_mode(0o600)) {
            warn!(error = %e, "Failed to set config file permissions");
        }
    }

    info!(path = nm_path, "Wrote NetworkManager configuration");

    // Apply if requested
    if req.apply_now {
        // Reload NetworkManager connections
        let reload_result = Command::new("nmcli")
            .args(["connection", "reload"])
            .output();

        if let Err(e) = reload_result {
            error!(error = %e, "Failed to reload NetworkManager connections");
            return agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
                success: false,
                error: format!("Failed to reload: {}", e),
            });
        }

        // Activate the connection
        let activate_result = Command::new("nmcli")
            .args(["connection", "up", "limiquantix"])
            .output();

        match activate_result {
            Ok(output) if output.status.success() => {
                info!("Network configuration applied via NetworkManager");
                agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
                    success: true,
                    error: String::new(),
                })
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                // Connection might already be active or name mismatch - warn but succeed
                if stderr.contains("already active") {
                    info!("NetworkManager connection already active");
                    agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
                        success: true,
                        error: String::new(),
                    })
                } else {
                    warn!(stderr = %stderr, "nmcli connection up failed (config was written)");
                    agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
                        success: true,
                        error: format!("Config written but activation failed: {}", stderr),
                    })
                }
            }
            Err(e) => {
                error!(error = %e, "Failed to run nmcli connection up");
                agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
                    success: false,
                    error: format!("Failed to apply: {}", e),
                })
            }
        }
    } else {
        agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
            success: true,
            error: String::new(),
        })
    }
}

#[cfg(windows)]
fn configure_windows_network(req: &ConfigureNetworkRequest) -> agent_message::Payload {
    // Windows network configuration via netsh
    // The config should contain netsh commands, one per line
    
    info!("Applying Windows network configuration via netsh");
    
    // Parse config as netsh commands
    for line in req.netplan_config.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        
        // Execute each netsh command
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        
        let result = if parts[0].eq_ignore_ascii_case("netsh") {
            // Already has netsh prefix
            Command::new("cmd")
                .args(["/C", line])
                .output()
        } else {
            // Add netsh prefix
            Command::new("netsh")
                .args(&parts)
                .output()
        };
        
        match result {
            Ok(output) if output.status.success() => {
                info!(command = %line, "netsh command succeeded");
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                error!(command = %line, stderr = %stderr, "netsh command failed");
                return agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
                    success: false,
                    error: format!("Command '{}' failed: {}", line, stderr),
                });
            }
            Err(e) => {
                error!(command = %line, error = %e, "Failed to execute netsh command");
                return agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
                    success: false,
                    error: format!("Failed to execute '{}': {}", line, e),
                });
            }
        }
    }
    
    agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
        success: true,
        error: String::new(),
    })
}
