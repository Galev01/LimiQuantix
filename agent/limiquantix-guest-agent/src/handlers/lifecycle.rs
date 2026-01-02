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
pub async fn handle_configure_network(req: ConfigureNetworkRequest) -> agent_message::Payload {
    info!(apply_now = req.apply_now, "Processing network configuration");

    #[cfg(unix)]
    {
        // Write netplan configuration
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
                    info!("Network configuration applied");
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

    #[cfg(windows)]
    {
        // Windows network configuration is more complex
        // For now, just report unsupported
        warn!("Network configuration via Netplan not supported on Windows");
        agent_message::Payload::ConfigureNetworkResponse(ConfigureNetworkResponse {
            success: false,
            error: "Network configuration via Netplan not supported on Windows".to_string(),
        })
    }
}
