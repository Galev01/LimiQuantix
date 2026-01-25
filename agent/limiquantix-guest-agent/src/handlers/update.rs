//! Agent self-update handlers.
//!
//! Handles agent binary updates with chunked transfer, checksum verification,
//! and atomic replacement.

use limiquantix_proto::agent::{
    agent_message, AgentUpdateRequest, AgentUpdateResponse, GetCapabilitiesRequest,
    GetCapabilitiesResponse, UpdateState,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tracing::{debug, error, info, warn};

/// Global state for tracking update progress.
static UPDATE_STATE: Mutex<Option<UpdateProgress>> = Mutex::new(None);

/// Tracks the progress of an ongoing update.
struct UpdateProgress {
    target_version: String,
    total_size: u64,
    received_bytes: u64,
    expected_checksum: String,
    temp_file: PathBuf,
    hasher: Sha256,
    chunks_received: u32,
}

/// Handle an agent update request.
pub async fn handle_agent_update(req: AgentUpdateRequest) -> agent_message::Payload {
    info!(
        target_version = %req.target_version,
        chunk = req.chunk_number,
        is_last = req.is_last_chunk,
        data_len = req.binary_data.len(),
        "Handling agent update request"
    );

    // First chunk initializes the update
    if req.chunk_number == 0 {
        return initialize_update(req).await;
    }

    // Subsequent chunks append data
    append_update_chunk(req).await
}

/// Initialize a new update.
async fn initialize_update(req: AgentUpdateRequest) -> agent_message::Payload {
    // Create temp file for the update
    let temp_dir = get_temp_dir();
    if let Err(e) = std::fs::create_dir_all(&temp_dir) {
        error!(error = %e, "Failed to create temp directory");
        return agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
            success: false,
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            error: format!("Failed to create temp directory: {}", e),
            restart_required: false,
            progress_percent: 0,
            state: UpdateState::Failed as i32,
        });
    }

    let temp_file = temp_dir.join(format!("agent-update-{}.tmp", req.target_version));

    // Create/truncate the temp file
    let mut file = match std::fs::File::create(&temp_file) {
        Ok(f) => f,
        Err(e) => {
            error!(error = %e, "Failed to create temp file");
            return agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
                success: false,
                current_version: env!("CARGO_PKG_VERSION").to_string(),
                error: format!("Failed to create temp file: {}", e),
                restart_required: false,
                progress_percent: 0,
                state: UpdateState::Failed as i32,
            });
        }
    };

    // Write first chunk
    if let Err(e) = file.write_all(&req.binary_data) {
        error!(error = %e, "Failed to write first chunk");
        return agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
            success: false,
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            error: format!("Failed to write data: {}", e),
            restart_required: false,
            progress_percent: 0,
            state: UpdateState::Failed as i32,
        });
    }

    // Initialize hasher
    let mut hasher = Sha256::new();
    hasher.update(&req.binary_data);

    let received_bytes = req.binary_data.len() as u64;
    let progress = if req.total_size > 0 {
        ((received_bytes as f64 / req.total_size as f64) * 100.0) as u32
    } else {
        0
    };

    let is_last_chunk = req.is_last_chunk;
    let target_version = req.target_version.clone();

    // Store update state (lock scope)
    {
        let mut state = UPDATE_STATE.lock().unwrap();
        
        // Check if there's already an update in progress
        if state.is_some() {
            warn!("Update already in progress, resetting");
        }

        *state = Some(UpdateProgress {
            target_version: req.target_version.clone(),
            total_size: req.total_size,
            received_bytes,
            expected_checksum: req.checksum_sha256.clone(),
            temp_file: temp_file.clone(),
            hasher,
            chunks_received: 1,
        });
    } // Lock released here

    // If this is also the last chunk, finalize
    if is_last_chunk {
        return finalize_update().await;
    }

    info!(
        target_version = %target_version,
        progress = progress,
        "Update initialized"
    );

    agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
        success: true,
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        error: String::new(),
        restart_required: false,
        progress_percent: progress,
        state: UpdateState::Downloading as i32,
    })
}

/// Append a chunk to an ongoing update.
async fn append_update_chunk(req: AgentUpdateRequest) -> agent_message::Payload {
    let (_temp_file, progress, is_last_chunk) = {
        let mut state_guard = UPDATE_STATE.lock().unwrap();

        let state = match state_guard.as_mut() {
            Some(s) => s,
            None => {
                error!("No update in progress");
                return agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
                    success: false,
                    current_version: env!("CARGO_PKG_VERSION").to_string(),
                    error: "No update in progress".to_string(),
                    restart_required: false,
                    progress_percent: 0,
                    state: UpdateState::Failed as i32,
                });
            }
        };

        // Verify chunk order
        if req.chunk_number != state.chunks_received {
            warn!(
                expected = state.chunks_received,
                received = req.chunk_number,
                "Chunk out of order"
            );
        }

        let temp_file = state.temp_file.clone();

        // Append to temp file
        let mut file = match std::fs::OpenOptions::new()
            .append(true)
            .open(&temp_file)
        {
            Ok(f) => f,
            Err(e) => {
                error!(error = %e, "Failed to open temp file");
                return agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
                    success: false,
                    current_version: env!("CARGO_PKG_VERSION").to_string(),
                    error: format!("Failed to open temp file: {}", e),
                    restart_required: false,
                    progress_percent: 0,
                    state: UpdateState::Failed as i32,
                });
            }
        };

        if let Err(e) = file.write_all(&req.binary_data) {
            error!(error = %e, "Failed to write chunk");
            return agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
                success: false,
                current_version: env!("CARGO_PKG_VERSION").to_string(),
                error: format!("Failed to write data: {}", e),
                restart_required: false,
                progress_percent: 0,
                state: UpdateState::Failed as i32,
            });
        }

        // Update hasher
        state.hasher.update(&req.binary_data);
        state.received_bytes += req.binary_data.len() as u64;
        state.chunks_received += 1;

        let progress = if state.total_size > 0 {
            ((state.received_bytes as f64 / state.total_size as f64) * 100.0) as u32
        } else {
            ((state.chunks_received as f64 / 100.0) * 100.0).min(99.0) as u32
        };

        debug!(
            chunk = req.chunk_number,
            received = state.received_bytes,
            total = state.total_size,
            progress = progress,
            "Chunk received"
        );

        (temp_file, progress, req.is_last_chunk)
    }; // Lock released here

    // If this is the last chunk, finalize
    if is_last_chunk {
        return finalize_update().await;
    }

    agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
        success: true,
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        error: String::new(),
        restart_required: false,
        progress_percent: progress,
        state: UpdateState::Downloading as i32,
    })
}

/// Finalize the update by verifying checksum and replacing the binary.
async fn finalize_update() -> agent_message::Payload {
    let state = {
        let mut guard = UPDATE_STATE.lock().unwrap();
        guard.take()
    };

    let state = match state {
        Some(s) => s,
        None => {
            error!("No update to finalize");
            return agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
                success: false,
                current_version: env!("CARGO_PKG_VERSION").to_string(),
                error: "No update to finalize".to_string(),
                restart_required: false,
                progress_percent: 0,
                state: UpdateState::Failed as i32,
            });
        }
    };

    info!(
        target_version = %state.target_version,
        received_bytes = state.received_bytes,
        "Finalizing update"
    );

    // Verify checksum
    let computed_hash = hex::encode(state.hasher.finalize());
    if !state.expected_checksum.is_empty() && computed_hash != state.expected_checksum.to_lowercase()
    {
        error!(
            expected = %state.expected_checksum,
            computed = %computed_hash,
            "Checksum mismatch"
        );

        // Clean up temp file
        let _ = std::fs::remove_file(&state.temp_file);

        return agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
            success: false,
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            error: format!(
                "Checksum mismatch: expected {}, got {}",
                state.expected_checksum, computed_hash
            ),
            restart_required: false,
            progress_percent: 100,
            state: UpdateState::Failed as i32,
        });
    }

    info!(checksum = %computed_hash, "Checksum verified");

    // Get current binary path
    let current_exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            error!(error = %e, "Failed to get current executable path");
            let _ = std::fs::remove_file(&state.temp_file);
            return agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
                success: false,
                current_version: env!("CARGO_PKG_VERSION").to_string(),
                error: format!("Failed to get executable path: {}", e),
                restart_required: false,
                progress_percent: 100,
                state: UpdateState::Failed as i32,
            });
        }
    };

    // Make temp file executable (Unix)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o755);
        if let Err(e) = std::fs::set_permissions(&state.temp_file, permissions) {
            warn!(error = %e, "Failed to set executable permissions");
        }
    }

    // Atomic replacement strategy
    let backup_path = current_exe.with_extension("bak");

    // On Windows, we can't replace a running executable directly
    // We need to rename the current one first
    #[cfg(windows)]
    {
        // Rename current to backup
        if let Err(e) = std::fs::rename(&current_exe, &backup_path) {
            error!(error = %e, "Failed to backup current executable");
            let _ = std::fs::remove_file(&state.temp_file);
            return agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
                success: false,
                current_version: env!("CARGO_PKG_VERSION").to_string(),
                error: format!("Failed to backup executable: {}", e),
                restart_required: false,
                progress_percent: 100,
                state: UpdateState::Failed as i32,
            });
        }

        // Move new binary to current location
        if let Err(e) = std::fs::rename(&state.temp_file, &current_exe) {
            error!(error = %e, "Failed to install new executable");
            // Try to restore backup
            let _ = std::fs::rename(&backup_path, &current_exe);
            return agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
                success: false,
                current_version: env!("CARGO_PKG_VERSION").to_string(),
                error: format!("Failed to install new executable: {}", e),
                restart_required: false,
                progress_percent: 100,
                state: UpdateState::Failed as i32,
            });
        }
    }

    // On Unix, we can use atomic rename
    #[cfg(unix)]
    {
        // Backup current executable
        if let Err(e) = std::fs::copy(&current_exe, &backup_path) {
            warn!(error = %e, "Failed to create backup (continuing anyway)");
        }

        // Atomic rename
        if let Err(e) = std::fs::rename(&state.temp_file, &current_exe) {
            error!(error = %e, "Failed to install new executable");
            let _ = std::fs::remove_file(&state.temp_file);
            return agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
                success: false,
                current_version: env!("CARGO_PKG_VERSION").to_string(),
                error: format!("Failed to install new executable: {}", e),
                restart_required: false,
                progress_percent: 100,
                state: UpdateState::Failed as i32,
            });
        }
    }

    info!(
        target_version = %state.target_version,
        "Update installed successfully, restart required"
    );

    agent_message::Payload::AgentUpdateResponse(AgentUpdateResponse {
        success: true,
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        error: String::new(),
        restart_required: true,
        progress_percent: 100,
        state: UpdateState::Complete as i32,
    })
}

/// Handle a get capabilities request.
pub async fn handle_get_capabilities(_req: GetCapabilitiesRequest) -> agent_message::Payload {
    debug!("Handling get capabilities request");

    let capabilities = vec![
        "telemetry".to_string(),
        "execute".to_string(),
        "file_read".to_string(),
        "file_write".to_string(),
        "file_list".to_string(),
        "file_delete".to_string(),
        "file_stat".to_string(),
        "directory_create".to_string(),
        "shutdown".to_string(),
        "reboot".to_string(),
        "reset_password".to_string(),
        "configure_network".to_string(),
        "quiesce".to_string(),
        "thaw".to_string(),
        "sync_time".to_string(),
        "display_resize".to_string(),
        "clipboard".to_string(),
        "process_list".to_string(),
        "process_kill".to_string(),
        "service_list".to_string(),
        "service_control".to_string(),
        "hardware_info".to_string(),
        "software_list".to_string(),
        "self_update".to_string(),
    ];

    let mut features = HashMap::new();

    // Platform-specific features
    #[cfg(unix)]
    {
        features.insert("user_context_exec".to_string(), "true".to_string());
        features.insert("fsfreeze".to_string(), "true".to_string());
    }

    #[cfg(windows)]
    {
        features.insert("vss_quiesce".to_string(), "true".to_string());
    }

    // Build info
    let build_time = option_env!("BUILD_TIME").unwrap_or("unknown").to_string();
    let build_commit = option_env!("BUILD_COMMIT").unwrap_or("unknown").to_string();

    agent_message::Payload::GetCapabilitiesResponse(GetCapabilitiesResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        capabilities,
        features,
        build_time,
        build_commit,
    })
}

/// Get the temp directory for updates.
fn get_temp_dir() -> PathBuf {
    #[cfg(unix)]
    {
        PathBuf::from("/tmp/limiquantix")
    }

    #[cfg(windows)]
    {
        std::env::temp_dir().join("limiquantix")
    }
}

// Add hex encoding for checksum
mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes
            .as_ref()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_capabilities() {
        let req = GetCapabilitiesRequest {};
        let response = handle_get_capabilities(req).await;

        if let agent_message::Payload::GetCapabilitiesResponse(resp) = response {
            assert_eq!(resp.version, env!("CARGO_PKG_VERSION"));
            assert!(!resp.capabilities.is_empty());
            assert!(resp.capabilities.contains(&"telemetry".to_string()));
            assert!(resp.capabilities.contains(&"self_update".to_string()));
        } else {
            panic!("Unexpected response type");
        }
    }

    #[test]
    fn test_hex_encode() {
        assert_eq!(hex::encode([0xde, 0xad, 0xbe, 0xef]), "deadbeef");
        assert_eq!(hex::encode([0x00, 0xff]), "00ff");
    }
}
