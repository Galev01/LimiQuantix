//! Service management handlers.
//!
//! Handles service listing and control operations.
//! Uses systemctl on Linux and sc.exe/Win32 Service API on Windows.

use limiquantix_proto::agent::{
    agent_message, ListServicesRequest, ListServicesResponse, ServiceAction,
    ServiceControlRequest, ServiceControlResponse, ServiceInfo,
};
use std::process::Stdio;
use tokio::process::Command;
use tracing::{debug, error, info};

/// Handle a list services request.
pub async fn handle_list_services(req: ListServicesRequest) -> agent_message::Payload {
    debug!(
        filter = %req.filter,
        running_only = req.running_only,
        "Handling list services request"
    );

    #[cfg(unix)]
    {
        handle_list_services_linux(req).await
    }

    #[cfg(windows)]
    {
        handle_list_services_windows(req).await
    }
}

/// Handle a service control request.
pub async fn handle_service_control(req: ServiceControlRequest) -> agent_message::Payload {
    let action = ServiceAction::try_from(req.action).unwrap_or(ServiceAction::Status);

    info!(
        service = %req.name,
        action = ?action,
        "Handling service control request"
    );

    #[cfg(unix)]
    {
        handle_service_control_linux(req, action).await
    }

    #[cfg(windows)]
    {
        handle_service_control_windows(req, action).await
    }
}

/// List services on Linux using systemctl.
#[cfg(unix)]
async fn handle_list_services_linux(req: ListServicesRequest) -> agent_message::Payload {
    // Get list of all services
    let output = Command::new("systemctl")
        .args([
            "list-units",
            "--type=service",
            "--all",
            "--no-pager",
            "--no-legend",
            "--plain",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            error!(error = %e, "Failed to run systemctl");
            return agent_message::Payload::ListServicesResponse(ListServicesResponse {
                success: false,
                services: Vec::new(),
                error: format!("Failed to run systemctl: {}", e),
            });
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!(error = %stderr, "systemctl failed");
        return agent_message::Payload::ListServicesResponse(ListServicesResponse {
            success: false,
            services: Vec::new(),
            error: format!("systemctl failed: {}", stderr),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut services = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }

        let name = parts[0].trim_end_matches(".service").to_string();
        let _load_state = parts[1];
        let active_state = parts[2];
        let sub_state = parts[3];

        // Apply filter
        if !req.filter.is_empty() && !name.to_lowercase().contains(&req.filter.to_lowercase()) {
            continue;
        }

        // Apply running_only filter
        if req.running_only && active_state != "active" {
            continue;
        }

        let state = if active_state == "active" {
            sub_state.to_string() // e.g., "running", "exited"
        } else {
            active_state.to_string() // e.g., "inactive", "failed"
        };

        // Get more details about the service
        let (description, start_type, pid, memory) =
            get_service_details_linux(&name).await.unwrap_or_default();

        services.push(ServiceInfo {
            name: name.clone(),
            display_name: name,
            state,
            start_type,
            description,
            pid,
            memory_bytes: memory,
        });
    }

    info!(count = services.len(), "Listed services");

    agent_message::Payload::ListServicesResponse(ListServicesResponse {
        success: true,
        services,
        error: String::new(),
    })
}

/// Get detailed service information on Linux.
#[cfg(unix)]
async fn get_service_details_linux(name: &str) -> Option<(String, String, u32, u64)> {
    let output = Command::new("systemctl")
        .args(["show", &format!("{}.service", name), "--no-pager"])
        .stdout(Stdio::piped())
        .output()
        .await
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut description = String::new();
    let mut start_type = String::new();
    let mut pid = 0u32;
    let mut memory = 0u64;

    for line in stdout.lines() {
        if let Some(value) = line.strip_prefix("Description=") {
            description = value.to_string();
        } else if let Some(value) = line.strip_prefix("UnitFileState=") {
            start_type = match value {
                "enabled" => "auto".to_string(),
                "disabled" => "disabled".to_string(),
                "static" => "manual".to_string(),
                _ => value.to_string(),
            };
        } else if let Some(value) = line.strip_prefix("MainPID=") {
            pid = value.parse().unwrap_or(0);
        } else if let Some(value) = line.strip_prefix("MemoryCurrent=") {
            memory = value.parse().unwrap_or(0);
        }
    }

    Some((description, start_type, pid, memory))
}

/// Control a service on Linux using systemctl.
#[cfg(unix)]
async fn handle_service_control_linux(
    req: ServiceControlRequest,
    action: ServiceAction,
) -> agent_message::Payload {
    let service_name = format!("{}.service", req.name);

    let args: Vec<&str> = match action {
        ServiceAction::Start => vec!["start", &service_name],
        ServiceAction::Stop => vec!["stop", &service_name],
        ServiceAction::Restart => vec!["restart", &service_name],
        ServiceAction::Enable => vec!["enable", &service_name],
        ServiceAction::Disable => vec!["disable", &service_name],
        ServiceAction::Status => vec!["is-active", &service_name],
    };

    let output = Command::new("systemctl")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            error!(error = %e, "Failed to run systemctl");
            return agent_message::Payload::ServiceControlResponse(ServiceControlResponse {
                success: false,
                new_state: String::new(),
                error: format!("Failed to run systemctl: {}", e),
            });
        }
    };

    // For status check, success depends on the output
    if action == ServiceAction::Status {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return agent_message::Payload::ServiceControlResponse(ServiceControlResponse {
            success: true,
            new_state: stdout,
            error: String::new(),
        });
    }

    if output.status.success() {
        // Get new state
        let new_state = get_service_state_linux(&req.name).await;

        info!(
            service = %req.name,
            action = ?action,
            new_state = %new_state,
            "Service control successful"
        );

        agent_message::Payload::ServiceControlResponse(ServiceControlResponse {
            success: true,
            new_state,
            error: String::new(),
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!(
            service = %req.name,
            action = ?action,
            error = %stderr,
            "Service control failed"
        );

        agent_message::Payload::ServiceControlResponse(ServiceControlResponse {
            success: false,
            new_state: String::new(),
            error: stderr.to_string(),
        })
    }
}

/// Get current service state on Linux.
#[cfg(unix)]
async fn get_service_state_linux(name: &str) -> String {
    let output = Command::new("systemctl")
        .args(["is-active", &format!("{}.service", name)])
        .stdout(Stdio::piped())
        .output()
        .await;

    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => "unknown".to_string(),
    }
}

/// List services on Windows using sc.exe.
#[cfg(windows)]
async fn handle_list_services_windows(req: ListServicesRequest) -> agent_message::Payload {
    // Use sc.exe for simplicity (Win32 Service API is more complex)
    let output = Command::new("sc")
        .args(["query", "type=", "service", "state=", "all"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            error!(error = %e, "Failed to run sc.exe");
            return agent_message::Payload::ListServicesResponse(ListServicesResponse {
                success: false,
                services: Vec::new(),
                error: format!("Failed to run sc.exe: {}", e),
            });
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut services = Vec::new();
    let mut current_service: Option<ServiceInfo> = None;

    for line in stdout.lines() {
        let line = line.trim();

        if let Some(name) = line.strip_prefix("SERVICE_NAME: ") {
            // Save previous service
            if let Some(svc) = current_service.take() {
                // Apply filters
                if !req.filter.is_empty()
                    && !svc.name.to_lowercase().contains(&req.filter.to_lowercase())
                {
                    continue;
                }
                if req.running_only && svc.state != "RUNNING" {
                    continue;
                }
                services.push(svc);
            }

            current_service = Some(ServiceInfo {
                name: name.to_string(),
                display_name: String::new(),
                state: String::new(),
                start_type: String::new(),
                description: String::new(),
                pid: 0,
                memory_bytes: 0,
            });
        } else if let Some(display_name) = line.strip_prefix("DISPLAY_NAME: ") {
            if let Some(ref mut svc) = current_service {
                svc.display_name = display_name.to_string();
            }
        } else if let Some(state_line) = line.strip_prefix("STATE") {
            if let Some(ref mut svc) = current_service {
                // Parse state like "              : 4  RUNNING"
                let parts: Vec<&str> = state_line.split_whitespace().collect();
                if parts.len() >= 2 {
                    svc.state = parts.last().unwrap_or(&"").to_string();
                }
            }
        } else if let Some(pid_line) = line.strip_prefix("PID") {
            if let Some(ref mut svc) = current_service {
                let parts: Vec<&str> = pid_line.split_whitespace().collect();
                if let Some(pid_str) = parts.last() {
                    svc.pid = pid_str.parse().unwrap_or(0);
                }
            }
        }
    }

    // Don't forget the last service
    if let Some(svc) = current_service {
        if !req.filter.is_empty()
            && !svc.name.to_lowercase().contains(&req.filter.to_lowercase())
        {
            // Skip
        } else if req.running_only && svc.state != "RUNNING" {
            // Skip
        } else {
            services.push(svc);
        }
    }

    info!(count = services.len(), "Listed services");

    agent_message::Payload::ListServicesResponse(ListServicesResponse {
        success: true,
        services,
        error: String::new(),
    })
}

/// Control a service on Windows using sc.exe.
#[cfg(windows)]
async fn handle_service_control_windows(
    req: ServiceControlRequest,
    action: ServiceAction,
) -> agent_message::Payload {
    let (cmd, args): (&str, Vec<&str>) = match action {
        ServiceAction::Start => ("sc", vec!["start", &req.name]),
        ServiceAction::Stop => ("sc", vec!["stop", &req.name]),
        ServiceAction::Restart => {
            // Windows doesn't have a restart command, do stop then start
            let stop_result = Command::new("sc")
                .args(["stop", &req.name])
                .output()
                .await;

            // Wait a bit for the service to stop
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;

            ("sc", vec!["start", &req.name])
        }
        ServiceAction::Enable => ("sc", vec!["config", &req.name, "start=", "auto"]),
        ServiceAction::Disable => ("sc", vec!["config", &req.name, "start=", "disabled"]),
        ServiceAction::Status => ("sc", vec!["query", &req.name]),
    };

    let output = Command::new(cmd)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            error!(error = %e, "Failed to run sc.exe");
            return agent_message::Payload::ServiceControlResponse(ServiceControlResponse {
                success: false,
                new_state: String::new(),
                error: format!("Failed to run sc.exe: {}", e),
            });
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse state from output
    let mut new_state = String::new();
    for line in stdout.lines() {
        if line.contains("STATE") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(state) = parts.last() {
                new_state = state.to_string();
            }
        }
    }

    if output.status.success() || action == ServiceAction::Status {
        info!(
            service = %req.name,
            action = ?action,
            new_state = %new_state,
            "Service control successful"
        );

        agent_message::Payload::ServiceControlResponse(ServiceControlResponse {
            success: true,
            new_state,
            error: String::new(),
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!(
            service = %req.name,
            action = ?action,
            error = %stderr,
            "Service control failed"
        );

        agent_message::Payload::ServiceControlResponse(ServiceControlResponse {
            success: false,
            new_state: String::new(),
            error: format!("{}\n{}", stdout, stderr),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[cfg(unix)]
    async fn test_list_services() {
        let req = ListServicesRequest {
            filter: String::new(),
            running_only: true,
        };

        let response = handle_list_services(req).await;

        if let agent_message::Payload::ListServicesResponse(resp) = response {
            // May fail if systemctl is not available
            println!("Services: {:?}", resp.services.len());
        }
    }
}
