//! File Download Implementation
//!
//! Downloads files from VM guests to the host via the Control Plane API.

use super::{
    FileEntry, FileListResponse, FileReadResponse, FileStatResponse, FileTransfer,
    ProgressTracker, TransferStatus,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::path::Path;
use tauri::Window;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tracing::{error, info};

/// Download a file from a VM guest
///
/// # Arguments
/// * `window` - Tauri window for emitting progress events
/// * `control_plane_url` - Base URL of the control plane
/// * `vm_id` - Source VM ID
/// * `remote_path` - Source path in the guest filesystem
/// * `local_path` - Destination path on the host
///
/// # Returns
/// The completed FileTransfer on success
#[tauri::command]
pub async fn download_file_from_vm(
    window: Window,
    control_plane_url: String,
    vm_id: String,
    remote_path: String,
    local_path: String,
) -> Result<FileTransfer, String> {
    info!(
        "Downloading file from VM {}: {} -> {}",
        vm_id, remote_path, local_path
    );

    // Create transfer record
    let mut transfer = FileTransfer::new_download(
        vm_id.clone(),
        remote_path.clone(),
        local_path.clone(),
    );
    transfer.status = TransferStatus::InProgress;
    transfer.started_at = Some(chrono::Utc::now().to_rfc3339());

    // Get file size first
    let stat = stat_remote_file(&control_plane_url, &vm_id, &remote_path).await?;
    
    if !stat.exists {
        return Err(format!("Remote file not found: {}", remote_path));
    }
    
    if stat.is_dir {
        return Err("Cannot download directories. Please download files individually.".to_string());
    }

    transfer.total_bytes = stat.size as u64;

    // Initialize progress tracker
    let mut tracker = ProgressTracker::new(
        transfer.id.clone(),
        vm_id.clone(),
        transfer.total_bytes,
    );

    // Download file
    let result = do_download(
        &window,
        &control_plane_url,
        &vm_id,
        &remote_path,
        &local_path,
        &mut tracker,
        transfer.total_bytes,
    )
    .await;

    match result {
        Ok(bytes_downloaded) => {
            transfer.status = TransferStatus::Completed;
            transfer.transferred_bytes = bytes_downloaded;
            transfer.completed_at = Some(chrono::Utc::now().to_rfc3339());
            tracker.complete(&window, &local_path, &remote_path);
            
            info!(
                "Download complete: {} -> {} ({} bytes)",
                remote_path, local_path, bytes_downloaded
            );
            
            Ok(transfer)
        }
        Err(e) => {
            transfer.status = TransferStatus::Failed;
            transfer.error = Some(e.clone());
            transfer.completed_at = Some(chrono::Utc::now().to_rfc3339());
            tracker.fail(&window, &local_path, &remote_path, &e);
            
            error!("Download failed: {} - {}", transfer.id, e);
            
            Err(e)
        }
    }
}

/// Internal download implementation
async fn do_download(
    window: &Window,
    control_plane_url: &str,
    vm_id: &str,
    remote_path: &str,
    local_path: &str,
    tracker: &mut ProgressTracker,
    total_size: u64,
) -> Result<u64, String> {
    // Build API URL
    let url = format!(
        "{}/api/vms/{}/files/read",
        control_plane_url.trim_end_matches('/'),
        vm_id
    );

    // Create request body
    let body = serde_json::json!({
        "path": remote_path,
        "offset": 0,
        "length": 0  // 0 means entire file
    });

    tracker.update(0, window);

    // Send request
    let client = crate::api::create_insecure_client().map_err(|e| e.to_string())?;
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    tracker.update(total_size / 2, window); // 50% - download complete

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Download failed ({}): {}", status, text));
    }

    // Parse response
    let read_response: FileReadResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Decode base64 content
    let content = BASE64
        .decode(&read_response.content)
        .map_err(|e| format!("Failed to decode content: {}", e))?;

    let bytes_written = content.len() as u64;

    // Ensure parent directory exists
    if let Some(parent) = Path::new(local_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Write to local file
    let mut file = File::create(local_path)
        .await
        .map_err(|e| format!("Failed to create local file: {}", e))?;

    file.write_all(&content)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush file: {}", e))?;

    tracker.update(total_size, window); // 100% - write complete

    Ok(bytes_written)
}

/// Get file information from a VM
#[tauri::command]
pub async fn stat_file_in_vm(
    control_plane_url: String,
    vm_id: String,
    path: String,
) -> Result<FileStatResponse, String> {
    stat_remote_file(&control_plane_url, &vm_id, &path).await
}

/// Internal helper to stat a remote file
async fn stat_remote_file(
    control_plane_url: &str,
    vm_id: &str,
    path: &str,
) -> Result<FileStatResponse, String> {
    let url = format!(
        "{}/api/vms/{}/files/stat?path={}",
        control_plane_url.trim_end_matches('/'),
        vm_id,
        urlencoding::encode(path)
    );

    let client = crate::api::create_insecure_client().map_err(|e| e.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Stat failed ({}): {}", status, text));
    }

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// List files in a VM directory
#[tauri::command]
pub async fn list_files_in_vm(
    control_plane_url: String,
    vm_id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    let url = format!(
        "{}/api/vms/{}/files/list?path={}",
        control_plane_url.trim_end_matches('/'),
        vm_id,
        urlencoding::encode(&path)
    );

    let client = crate::api::create_insecure_client().map_err(|e| e.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("List failed ({}): {}", status, text));
    }

    let list_response: FileListResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(list_response.entries)
}

/// Delete a file in a VM
#[tauri::command]
pub async fn delete_file_in_vm(
    control_plane_url: String,
    vm_id: String,
    path: String,
) -> Result<(), String> {
    let url = format!(
        "{}/api/vms/{}/files/delete?path={}",
        control_plane_url.trim_end_matches('/'),
        vm_id,
        urlencoding::encode(&path)
    );

    let client = crate::api::create_insecure_client().map_err(|e| e.to_string())?;
    let response = client
        .delete(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Delete failed ({}): {}", status, text));
    }

    Ok(())
}
