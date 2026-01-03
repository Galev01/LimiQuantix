//! Time synchronization handler.
//!
//! This module handles time synchronization requests, which are critical
//! after VM resume from suspend/pause operations. When a VM is paused,
//! the guest OS clock stops, causing time drift.
//!
//! ## Time Sync Methods
//!
//! **Linux:**
//! - `chronyc makestep` - Force immediate sync with Chrony
//! - `ntpdate` - One-shot NTP sync (legacy)
//! - `timedatectl set-time` - Manual time set
//!
//! **Windows:**
//! - `w32tm /resync /force` - Force Windows Time service sync

use crate::AgentConfig;
use limiquantix_proto::agent::{agent_message, SyncTimeRequest, SyncTimeResponse};
use prost_types::Timestamp;
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tracing::{debug, error, info, warn};

/// Handle a time sync request.
pub async fn handle_sync_time(
    req: SyncTimeRequest,
    _config: &AgentConfig,
) -> agent_message::Payload {
    info!(force = req.force, "Synchronizing time");

    // If a specific time was provided, set it manually
    if let Some(ref set_time) = req.set_time {
        return handle_manual_time_set(set_time).await;
    }

    // Otherwise, use the system's time sync mechanism
    #[cfg(unix)]
    let result = sync_time_unix(req.force).await;

    #[cfg(windows)]
    let result = sync_time_windows(req.force).await;

    match result {
        Ok((offset, source)) => {
            let current_time = get_current_timestamp();
            info!(
                offset_seconds = offset,
                source = %source,
                "Time synchronized successfully"
            );
            agent_message::Payload::SyncTimeResponse(SyncTimeResponse {
                success: true,
                offset_seconds: offset,
                current_time: Some(current_time),
                time_source: source,
                error: String::new(),
            })
        }
        Err(e) => {
            error!(error = %e, "Time synchronization failed");
            let current_time = get_current_timestamp();
            agent_message::Payload::SyncTimeResponse(SyncTimeResponse {
                success: false,
                offset_seconds: 0.0,
                current_time: Some(current_time),
                time_source: String::new(),
                error: e,
            })
        }
    }
}

/// Handle manual time set from provided timestamp.
async fn handle_manual_time_set(set_time: &Timestamp) -> agent_message::Payload {
    let target_secs = set_time.seconds;
    let target_nanos = set_time.nanos;

    // Calculate offset from current time
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let offset = (target_secs as f64 + target_nanos as f64 / 1_000_000_000.0) - now.as_secs_f64();

    #[cfg(unix)]
    let result = set_time_unix(target_secs, target_nanos).await;

    #[cfg(windows)]
    let result = set_time_windows(target_secs, target_nanos).await;

    match result {
        Ok(()) => {
            info!(offset_seconds = offset, "Time set manually");
            let current_time = get_current_timestamp();
            agent_message::Payload::SyncTimeResponse(SyncTimeResponse {
                success: true,
                offset_seconds: offset,
                current_time: Some(current_time),
                time_source: "manual".to_string(),
                error: String::new(),
            })
        }
        Err(e) => {
            error!(error = %e, "Failed to set time manually");
            let current_time = get_current_timestamp();
            agent_message::Payload::SyncTimeResponse(SyncTimeResponse {
                success: false,
                offset_seconds: 0.0,
                current_time: Some(current_time),
                time_source: String::new(),
                error: e,
            })
        }
    }
}

/// Sync time on Unix systems.
#[cfg(unix)]
async fn sync_time_unix(force: bool) -> Result<(f64, String), String> {
    // Try Chrony first (most common on modern systems)
    if let Ok(result) = try_chrony_sync(force).await {
        return Ok(result);
    }

    // Try systemd-timesyncd
    if let Ok(result) = try_systemd_timesync(force).await {
        return Ok(result);
    }

    // Try ntpd
    if let Ok(result) = try_ntpd_sync(force).await {
        return Ok(result);
    }

    // Last resort: try ntpdate
    if let Ok(result) = try_ntpdate_sync().await {
        return Ok(result);
    }

    Err("No supported time sync service found".to_string())
}

/// Sync time on Windows systems.
#[cfg(windows)]
async fn sync_time_windows(force: bool) -> Result<(f64, String), String> {
    let args = if force {
        vec!["/resync", "/force"]
    } else {
        vec!["/resync"]
    };

    let output = Command::new("w32tm")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run w32tm: {}", e))?;

    if output.status.success() {
        // Try to parse offset from output
        let stdout = String::from_utf8_lossy(&output.stdout);
        let offset = parse_w32tm_offset(&stdout).unwrap_or(0.0);
        Ok((offset, "w32tm".to_string()))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("w32tm failed: {}", stderr.trim()))
    }
}

/// Try to sync with Chrony.
#[cfg(unix)]
async fn try_chrony_sync(force: bool) -> Result<(f64, String), String> {
    // Check if chronyc is available
    if !command_exists("chronyc").await {
        return Err("chronyc not found".to_string());
    }

    // Get current offset before sync
    let offset_before = get_chrony_offset().await.unwrap_or(0.0);

    if force {
        // Force immediate step
        let output = Command::new("chronyc")
            .arg("makestep")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to run chronyc makestep: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("chronyc makestep failed: {}", stderr.trim()));
        }
    } else {
        // Trigger a sync burst
        let output = Command::new("chronyc")
            .args(["burst", "4/4"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to run chronyc burst: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("chronyc burst failed: {}", stderr.trim()));
        }
    }

    Ok((offset_before, "chrony".to_string()))
}

/// Get current time offset from Chrony.
#[cfg(unix)]
async fn get_chrony_offset() -> Result<f64, String> {
    let output = Command::new("chronyc")
        .arg("tracking")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run chronyc tracking: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.starts_with("System time") {
                // Parse "System time     : 0.000000123 seconds fast of NTP time"
                if let Some(offset_str) = line.split(':').nth(1) {
                    let parts: Vec<&str> = offset_str.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(offset) = parts[0].parse::<f64>() {
                            let sign = if parts.get(2) == Some(&"slow") { -1.0 } else { 1.0 };
                            return Ok(offset * sign);
                        }
                    }
                }
            }
        }
    }

    Err("Could not parse chrony offset".to_string())
}

/// Try to sync with systemd-timesyncd.
#[cfg(unix)]
async fn try_systemd_timesync(force: bool) -> Result<(f64, String), String> {
    // Check if timedatectl is available
    if !command_exists("timedatectl").await {
        return Err("timedatectl not found".to_string());
    }

    if force {
        // Restart timesyncd to force resync
        let _ = Command::new("systemctl")
            .args(["restart", "systemd-timesyncd"])
            .output()
            .await;
    }

    // Set NTP to true to ensure sync is happening
    let output = Command::new("timedatectl")
        .args(["set-ntp", "true"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run timedatectl: {}", e))?;

    if output.status.success() {
        Ok((0.0, "systemd-timesyncd".to_string()))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("timedatectl failed: {}", stderr.trim()))
    }
}

/// Try to sync with ntpd.
#[cfg(unix)]
async fn try_ntpd_sync(force: bool) -> Result<(f64, String), String> {
    // Check if ntpq is available (indicates ntpd is installed)
    if !command_exists("ntpq").await {
        return Err("ntpq not found".to_string());
    }

    if force {
        // Restart ntpd to force resync
        let _ = Command::new("systemctl")
            .args(["restart", "ntpd"])
            .output()
            .await;
        
        // Or try with service command
        let _ = Command::new("service")
            .args(["ntpd", "restart"])
            .output()
            .await;
    }

    Ok((0.0, "ntpd".to_string()))
}

/// Try one-shot sync with ntpdate.
#[cfg(unix)]
async fn try_ntpdate_sync() -> Result<(f64, String), String> {
    if !command_exists("ntpdate").await {
        return Err("ntpdate not found".to_string());
    }

    // Use pool.ntp.org
    let output = Command::new("ntpdate")
        .args(["-u", "pool.ntp.org"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run ntpdate: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // Try to parse offset from output
        let offset = parse_ntpdate_offset(&stdout).unwrap_or(0.0);
        Ok((offset, "ntpdate".to_string()))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("ntpdate failed: {}", stderr.trim()))
    }
}

/// Parse offset from ntpdate output.
#[cfg(unix)]
fn parse_ntpdate_offset(output: &str) -> Option<f64> {
    // Output like: "adjust time server 1.2.3.4 offset 0.123456 sec"
    for word in output.split_whitespace() {
        if word.starts_with('-') || word.starts_with('0') || word.chars().next()?.is_ascii_digit() {
            if let Ok(offset) = word.parse::<f64>() {
                return Some(offset);
            }
        }
    }
    None
}

/// Parse offset from w32tm output.
#[cfg(windows)]
fn parse_w32tm_offset(output: &str) -> Option<f64> {
    // Try to find offset in output
    for line in output.lines() {
        if line.contains("offset") || line.contains("Offset") {
            for word in line.split_whitespace() {
                if let Ok(offset) = word.replace("s", "").parse::<f64>() {
                    return Some(offset);
                }
            }
        }
    }
    None
}

/// Set time manually on Unix.
#[cfg(unix)]
async fn set_time_unix(secs: i64, nanos: i32) -> Result<(), String> {
    use std::time::Duration;
    
    // Convert to datetime string
    let timestamp = UNIX_EPOCH + Duration::new(secs as u64, nanos as u32);
    let datetime = chrono::DateTime::<chrono::Utc>::from(timestamp);
    let time_str = datetime.format("%Y-%m-%d %H:%M:%S").to_string();

    // Try timedatectl first
    let output = Command::new("timedatectl")
        .args(["set-time", &time_str])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await;

    if let Ok(out) = output {
        if out.status.success() {
            return Ok(());
        }
    }

    // Fall back to date command
    let output = Command::new("date")
        .args(["-s", &time_str])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run date: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("date command failed: {}", stderr.trim()))
    }
}

/// Set time manually on Windows.
#[cfg(windows)]
async fn set_time_windows(secs: i64, nanos: i32) -> Result<(), String> {
    use std::time::Duration;
    
    let timestamp = UNIX_EPOCH + Duration::new(secs as u64, nanos as u32);
    let datetime = chrono::DateTime::<chrono::Utc>::from(timestamp);
    
    // Set date
    let date_str = datetime.format("%m-%d-%Y").to_string();
    let output = Command::new("cmd")
        .args(["/C", "date", &date_str])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to set date: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to set date: {}", stderr.trim()));
    }

    // Set time
    let time_str = datetime.format("%H:%M:%S").to_string();
    let output = Command::new("cmd")
        .args(["/C", "time", &time_str])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to set time: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Failed to set time: {}", stderr.trim()))
    }
}

/// Check if a command exists.
async fn command_exists(cmd: &str) -> bool {
    #[cfg(unix)]
    {
        Command::new("which")
            .arg(cmd)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false)
    }

    #[cfg(windows)]
    {
        Command::new("where")
            .arg(cmd)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

/// Get current system time as a protobuf Timestamp.
fn get_current_timestamp() -> Timestamp {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();

    Timestamp {
        seconds: now.as_secs() as i64,
        nanos: now.subsec_nanos() as i32,
    }
}
