#![allow(dead_code)]
//! File Upload Implementation

//!
//! Uploads files from the host to VM guests via the Control Plane API.

use super::{FileTransfer, FileWriteResponse, ProgressTracker, TransferStatus};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::path::Path;
use tauri::Window;
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use tracing::{error, info};

/// Default chunk size for uploads (64KB)
const UPLOAD_CHUNK_SIZE: usize = 64 * 1024;

/// Upload a file to a VM guest
///
/// # Arguments
/// * `window` - Tauri window for emitting progress events
/// * `control_plane_url` - Base URL of the control plane
/// * `vm_id` - Target VM ID
/// * `local_path` - Local file path to upload
/// * `remote_path` - Destination path in the guest filesystem
///
/// # Returns
/// The completed FileTransfer on success
#[tauri::command]
pub async fn upload_file_to_vm(
    window: Window,
    control_plane_url: String,
    vm_id: String,
    local_path: String,
    remote_path: String,
) -> Result<FileTransfer, String> {
    info!(
        "Uploading file to VM {}: {} -> {}",
        vm_id, local_path, remote_path
    );

    // Validate local file exists
    let path = Path::new(&local_path);
    if !path.exists() {
        return Err(format!("Local file not found: {}", local_path));
    }

    let metadata = tokio::fs::metadata(&local_path)
        .await
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

    if metadata.is_dir() {
        return Err("Cannot upload directories. Please upload files individually.".to_string());
    }

    let file_size = metadata.len();

    // Create transfer record
    let mut transfer = FileTransfer::new_upload(
        vm_id.clone(),
        local_path.clone(),
        remote_path.clone(),
        file_size,
    );
    transfer.status = TransferStatus::InProgress;
    transfer.started_at = Some(chrono::Utc::now().to_rfc3339());

    // Initialize progress tracker
    let mut tracker = ProgressTracker::new(
        transfer.id.clone(),
        vm_id.clone(),
        file_size,
    );

    // Read file and upload
    let result = do_upload(
        &window,
        &control_plane_url,
        &vm_id,
        &local_path,
        &remote_path,
        &mut tracker,
    )
    .await;

    match result {
        Ok(_) => {
            transfer.status = TransferStatus::Completed;
            transfer.transferred_bytes = file_size;
            transfer.completed_at = Some(chrono::Utc::now().to_rfc3339());
            tracker.complete(&window, &local_path, &remote_path);
            
            info!(
                "Upload complete: {} -> {} ({})",
                local_path, remote_path, transfer.id
            );
            
            Ok(transfer)
        }
        Err(e) => {
            transfer.status = TransferStatus::Failed;
            transfer.error = Some(e.clone());
            transfer.completed_at = Some(chrono::Utc::now().to_rfc3339());
            tracker.fail(&window, &local_path, &remote_path, &e);
            
            error!("Upload failed: {} - {}", transfer.id, e);
            
            Err(e)
        }
    }
}

/// Internal upload implementation
async fn do_upload(
    window: &Window,
    control_plane_url: &str,
    vm_id: &str,
    local_path: &str,
    remote_path: &str,
    tracker: &mut ProgressTracker,
) -> Result<(), String> {
    // Open local file
    let mut file = File::open(local_path)
        .await
        .map_err(|e| format!("Failed to open file: {}", e))?;

    // Read entire file (for small files)
    // For large files, chunked upload would be implemented here
    let mut content = Vec::new();
    file.read_to_end(&mut content)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let total_size = content.len() as u64;
    tracker.update(total_size / 2, window); // 50% - read complete

    // Base64 encode
    let encoded = BASE64.encode(&content);

    // Build API URL
    let url = format!(
        "{}/api/vms/{}/files/write",
        control_plane_url.trim_end_matches('/'),
        vm_id
    );

    // Create request body
    let body = serde_json::json!({
        "path": remote_path,
        "content": encoded,
        "mode": 0o644
    });

    // Send request
    let client = crate::api::create_insecure_client().map_err(|e| e.to_string())?;
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    tracker.update(total_size, window); // 100% - upload complete

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Upload failed ({}): {}", status, text));
    }

    // Parse response
    let write_response: FileWriteResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if !write_response.success {
        return Err(write_response.error.unwrap_or_else(|| "Unknown error".to_string()));
    }

    Ok(())
}

/// Upload multiple files to a VM
#[tauri::command]
pub async fn upload_files_to_vm(
    window: Window,
    control_plane_url: String,
    vm_id: String,
    files: Vec<(String, String)>, // (local_path, remote_path)
) -> Result<Vec<FileTransfer>, String> {
    let mut transfers = Vec::new();
    let mut errors = Vec::new();

    for (local_path, remote_path) in files {
        match upload_file_to_vm(
            window.clone(),
            control_plane_url.clone(),
            vm_id.clone(),
            local_path.clone(),
            remote_path.clone(),
        )
        .await
        {
            Ok(transfer) => transfers.push(transfer),
            Err(e) => errors.push(format!("{}: {}", local_path, e)),
        }
    }

    if !errors.is_empty() && transfers.is_empty() {
        return Err(errors.join("\n"));
    }

    Ok(transfers)
}
