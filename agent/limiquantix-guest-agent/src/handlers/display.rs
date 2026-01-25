//! Display operation handlers.
//!
//! Handles display resize requests for desktop integration.
//! Supports X11, Wayland (Linux), and Windows display APIs.

use crate::config::AgentConfig;
use limiquantix_proto::agent::{agent_message, DisplayResizeRequest, DisplayResizeResponse};
use tracing::{error, info};

#[cfg(unix)]
use std::process::Stdio;
#[cfg(unix)]
use tokio::process::Command;
#[cfg(test)]
use tracing::debug;

/// Handle a display resize request.
pub async fn handle_display_resize(
    req: DisplayResizeRequest,
    _config: &AgentConfig,
) -> agent_message::Payload {
    info!(
        width = req.width,
        height = req.height,
        dpi = req.dpi,
        display_id = %req.display_id,
        "Processing display resize request"
    );

    #[cfg(unix)]
    let result = resize_display_unix(req.width, req.height, &req.display_id).await;

    #[cfg(windows)]
    let result = resize_display_windows(req.width, req.height).await;

    match result {
        Ok((actual_width, actual_height)) => {
            info!(
                actual_width = actual_width,
                actual_height = actual_height,
                "Display resized successfully"
            );
            agent_message::Payload::DisplayResizeResponse(DisplayResizeResponse {
                success: true,
                actual_width,
                actual_height,
                error: String::new(),
            })
        }
        Err(e) => {
            error!(error = %e, "Failed to resize display");
            agent_message::Payload::DisplayResizeResponse(DisplayResizeResponse {
                success: false,
                actual_width: 0,
                actual_height: 0,
                error: e,
            })
        }
    }
}

/// Resize display on Unix systems (X11 or Wayland).
#[cfg(unix)]
async fn resize_display_unix(
    width: u32,
    height: u32,
    display_id: &str,
) -> Result<(u32, u32), String> {
    // Detect display server
    let display_server = detect_display_server().await;

    match display_server {
        DisplayServer::X11 => resize_x11(width, height, display_id).await,
        DisplayServer::Wayland => resize_wayland(width, height, display_id).await,
        DisplayServer::Headless => {
            Err("No display server detected (headless mode)".to_string())
        }
    }
}

#[cfg(unix)]
#[derive(Debug)]
enum DisplayServer {
    X11,
    Wayland,
    Headless,
}

#[cfg(unix)]
async fn detect_display_server() -> DisplayServer {
    // Check for Wayland first
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        return DisplayServer::Wayland;
    }

    // Check for X11
    if std::env::var("DISPLAY").is_ok() {
        return DisplayServer::X11;
    }

    DisplayServer::Headless
}

/// Resize display using xrandr (X11).
#[cfg(unix)]
async fn resize_x11(width: u32, height: u32, display_id: &str) -> Result<(u32, u32), String> {
    let output = if display_id.is_empty() {
        // Auto-detect primary output
        get_primary_x11_output().await?
    } else {
        display_id.to_string()
    };

    let mode = format!("{}x{}", width, height);

    // First, try to add the mode if it doesn't exist
    let _ = add_x11_mode(width, height, &output).await;

    // Set the mode
    let result = Command::new("xrandr")
        .args(["--output", &output, "--mode", &mode])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run xrandr: {}", e))?;

    if result.status.success() {
        Ok((width, height))
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr);
        
        // Try with --auto and then set mode
        let auto_result = Command::new("xrandr")
            .args(["--output", &output, "--auto"])
            .output()
            .await;

        if auto_result.is_ok() {
            // Retry setting the mode
            let retry = Command::new("xrandr")
                .args(["--output", &output, "--mode", &mode])
                .output()
                .await;

            if let Ok(r) = retry {
                if r.status.success() {
                    return Ok((width, height));
                }
            }
        }

        Err(format!("xrandr failed: {}", stderr.trim()))
    }
}

/// Get the primary X11 output name.
#[cfg(unix)]
async fn get_primary_x11_output() -> Result<String, String> {
    let output = Command::new("xrandr")
        .args(["--query"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run xrandr: {}", e))?;

    if !output.status.success() {
        return Err("xrandr query failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Look for connected outputs
    for line in stdout.lines() {
        if line.contains(" connected") {
            // Format: "Virtual-1 connected primary 1920x1080+0+0 ..."
            if let Some(output_name) = line.split_whitespace().next() {
                return Ok(output_name.to_string());
            }
        }
    }

    // Common virtual display names
    let common_outputs = ["Virtual-1", "Virtual1", "VGA-1", "HDMI-1", "eDP-1"];
    for name in common_outputs {
        if stdout.contains(name) {
            return Ok(name.to_string());
        }
    }

    Err("No connected output found".to_string())
}

/// Add a new mode to X11 if it doesn't exist.
#[cfg(unix)]
async fn add_x11_mode(width: u32, height: u32, output: &str) -> Result<(), String> {
    let mode_name = format!("{}x{}", width, height);

    // Generate modeline using cvt
    let cvt_output = Command::new("cvt")
        .args([&width.to_string(), &height.to_string()])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    let modeline = if let Ok(cvt) = cvt_output {
        if cvt.status.success() {
            let stdout = String::from_utf8_lossy(&cvt.stdout);
            // Parse modeline from cvt output
            // Format: "Modeline "1920x1080_60.00"  173.00  1920 2048 2248 2576  1080 1083 1088 1120 -hsync +vsync"
            stdout
                .lines()
                .find(|l| l.starts_with("Modeline"))
                .map(|l| {
                    l.trim_start_matches("Modeline ")
                        .trim()
                        .to_string()
                })
        } else {
            None
        }
    } else {
        None
    };

    if let Some(modeline) = modeline {
        // Parse modeline parts
        let parts: Vec<&str> = modeline.split_whitespace().collect();
        if parts.len() >= 2 {
            // Add new mode
            let mode_args: Vec<&str> = parts[1..].to_vec();
            let _ = Command::new("xrandr")
                .arg("--newmode")
                .arg(&mode_name)
                .args(&mode_args)
                .output()
                .await;

            // Add mode to output
            let _ = Command::new("xrandr")
                .args(["--addmode", output, &mode_name])
                .output()
                .await;
        }
    }

    Ok(())
}

/// Resize display using wlr-randr (Wayland).
#[cfg(unix)]
async fn resize_wayland(width: u32, height: u32, display_id: &str) -> Result<(u32, u32), String> {
    // Try wlr-randr first (wlroots-based compositors)
    let output = if display_id.is_empty() {
        get_primary_wayland_output().await.unwrap_or_else(|_| "".to_string())
    } else {
        display_id.to_string()
    };

    let mode = format!("{}x{}", width, height);

    let result = if output.is_empty() {
        Command::new("wlr-randr")
            .args(["--mode", &mode])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
    } else {
        Command::new("wlr-randr")
            .args(["--output", &output, "--mode", &mode])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
    };

    match result {
        Ok(output) if output.status.success() => Ok((width, height)),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("wlr-randr failed: {}", stderr.trim()))
        }
        Err(_) => {
            // Try gnome-randr or other tools
            Err("Wayland display resize not supported (wlr-randr not found)".to_string())
        }
    }
}

/// Get the primary Wayland output name.
#[cfg(unix)]
async fn get_primary_wayland_output() -> Result<String, String> {
    let output = Command::new("wlr-randr")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run wlr-randr: {}", e))?;

    if !output.status.success() {
        return Err("wlr-randr query failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse wlr-randr output to find first output
    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() && !trimmed.starts_with(' ') && !trimmed.starts_with('\t') {
            // This is an output name line
            if let Some(name) = trimmed.split_whitespace().next() {
                return Ok(name.to_string());
            }
        }
    }

    Err("No Wayland output found".to_string())
}

/// Resize display on Windows using ChangeDisplaySettingsEx.
#[cfg(windows)]
async fn resize_display_windows(width: u32, height: u32) -> Result<(u32, u32), String> {
    use std::mem::zeroed;
    use windows::Win32::Graphics::Gdi::{
        ChangeDisplaySettingsW, EnumDisplaySettingsW, DEVMODEW, CDS_UPDATEREGISTRY,
        DISP_CHANGE_SUCCESSFUL, ENUM_CURRENT_SETTINGS, DM_PELSWIDTH, DM_PELSHEIGHT,
    };

    unsafe {
        // Get current display settings
        let mut devmode: DEVMODEW = zeroed();
        devmode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;

        if !EnumDisplaySettingsW(None, ENUM_CURRENT_SETTINGS, &mut devmode).as_bool() {
            return Err("Failed to get current display settings".to_string());
        }

        // Set new resolution
        devmode.dmPelsWidth = width;
        devmode.dmPelsHeight = height;
        devmode.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT;

        // Apply the change
        let result = ChangeDisplaySettingsW(Some(&devmode), CDS_UPDATEREGISTRY);

        if result == DISP_CHANGE_SUCCESSFUL {
            Ok((width, height))
        } else {
            Err(format!("ChangeDisplaySettings failed with code: {:?}", result))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[cfg(unix)]
    async fn test_detect_display_server() {
        // This test will return Headless in CI environments
        let server = detect_display_server().await;
        // Just verify it doesn't panic
        debug!("Detected display server: {:?}", server);
    }
}
