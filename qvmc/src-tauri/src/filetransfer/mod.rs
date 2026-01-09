//! File Transfer Module for qvmc
//!
//! This module provides file upload/download capabilities between the host
//! and VM guests via the Control Plane's file transfer REST API.
//!
//! Features:
//! - Upload files to VM guest filesystem
//! - Download files from VM guest filesystem  
//! - Progress tracking with Tauri events
//! - Directory listing support

mod upload;
mod download;
mod progress;

pub use upload::*;
pub use download::*;
pub use progress::*;

use serde::{Deserialize, Serialize};

/// File transfer direction
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferDirection {
    Upload,
    Download,
}

/// File transfer status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

/// A file transfer operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransfer {
    /// Unique transfer ID
    pub id: String,
    /// VM ID
    pub vm_id: String,
    /// Transfer direction
    pub direction: TransferDirection,
    /// Local file path (host filesystem)
    pub local_path: String,
    /// Remote file path (guest filesystem)
    pub remote_path: String,
    /// Total file size in bytes
    pub total_bytes: u64,
    /// Bytes transferred so far
    pub transferred_bytes: u64,
    /// Current status
    pub status: TransferStatus,
    /// Error message if failed
    pub error: Option<String>,
    /// Transfer start time (ISO 8601)
    pub started_at: Option<String>,
    /// Transfer completion time (ISO 8601)
    pub completed_at: Option<String>,
}

impl FileTransfer {
    /// Create a new upload transfer
    pub fn new_upload(vm_id: String, local_path: String, remote_path: String, size: u64) -> Self {
        Self {
            id: format!("transfer-{}", uuid::Uuid::new_v4()),
            vm_id,
            direction: TransferDirection::Upload,
            local_path,
            remote_path,
            total_bytes: size,
            transferred_bytes: 0,
            status: TransferStatus::Pending,
            error: None,
            started_at: None,
            completed_at: None,
        }
    }

    /// Create a new download transfer
    pub fn new_download(vm_id: String, remote_path: String, local_path: String) -> Self {
        Self {
            id: format!("transfer-{}", uuid::Uuid::new_v4()),
            vm_id,
            direction: TransferDirection::Download,
            local_path,
            remote_path,
            total_bytes: 0, // Unknown until we start
            transferred_bytes: 0,
            status: TransferStatus::Pending,
            error: None,
            started_at: None,
            completed_at: None,
        }
    }

    /// Calculate progress percentage (0-100)
    pub fn progress_percent(&self) -> f64 {
        if self.total_bytes == 0 {
            return 0.0;
        }
        (self.transferred_bytes as f64 / self.total_bytes as f64) * 100.0
    }
}

/// File entry from directory listing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: i64,
    pub mode: i32,
    pub mod_time: String,
}

/// Response from file write operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteResponse {
    pub success: bool,
    pub path: String,
    pub vm_id: String,
    #[serde(default)]
    pub error: Option<String>,
}

/// Response from file read operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadResponse {
    pub path: String,
    pub content: String, // Base64 encoded
    pub size: i64,
    pub read_bytes: i64,
    pub eof: bool,
}

/// Response from directory listing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileListResponse {
    pub path: String,
    pub entries: Vec<FileEntry>,
}

/// Response from file stat
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatResponse {
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
    pub size: i64,
    pub mode: i32,
    pub mod_time: String,
}
