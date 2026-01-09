//! Progress Tracking for File Transfers
//!
//! Provides progress events that are emitted to the Tauri frontend.

use serde::{Deserialize, Serialize};
use tauri::Window;
use tracing::debug;

/// Progress update event payload
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    /// Transfer ID
    pub transfer_id: String,
    /// VM ID
    pub vm_id: String,
    /// Bytes transferred so far
    pub transferred_bytes: u64,
    /// Total bytes to transfer
    pub total_bytes: u64,
    /// Progress percentage (0-100)
    pub percent: f64,
    /// Transfer speed in bytes per second (if available)
    pub speed_bps: Option<u64>,
    /// Estimated time remaining in seconds (if available)
    pub eta_seconds: Option<u64>,
}

impl ProgressEvent {
    pub fn new(
        transfer_id: String,
        vm_id: String,
        transferred: u64,
        total: u64,
    ) -> Self {
        let percent = if total > 0 {
            (transferred as f64 / total as f64) * 100.0
        } else {
            0.0
        };

        Self {
            transfer_id,
            vm_id,
            transferred_bytes: transferred,
            total_bytes: total,
            percent,
            speed_bps: None,
            eta_seconds: None,
        }
    }

    pub fn with_speed(mut self, speed_bps: u64) -> Self {
        self.speed_bps = Some(speed_bps);
        
        // Calculate ETA
        if speed_bps > 0 && self.total_bytes > self.transferred_bytes {
            let remaining = self.total_bytes - self.transferred_bytes;
            self.eta_seconds = Some(remaining / speed_bps);
        }
        
        self
    }
}

/// Transfer completion event
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferCompleteEvent {
    pub transfer_id: String,
    pub vm_id: String,
    pub success: bool,
    pub local_path: String,
    pub remote_path: String,
    pub total_bytes: u64,
    pub duration_ms: u64,
    pub error: Option<String>,
}

/// Transfer error event
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferErrorEvent {
    pub transfer_id: String,
    pub vm_id: String,
    pub error: String,
    pub recoverable: bool,
}

/// Progress tracker that emits events to Tauri
pub struct ProgressTracker {
    transfer_id: String,
    vm_id: String,
    total_bytes: u64,
    transferred_bytes: u64,
    start_time: std::time::Instant,
    last_update: std::time::Instant,
    last_bytes: u64,
}

impl ProgressTracker {
    pub fn new(transfer_id: String, vm_id: String, total_bytes: u64) -> Self {
        let now = std::time::Instant::now();
        Self {
            transfer_id,
            vm_id,
            total_bytes,
            transferred_bytes: 0,
            start_time: now,
            last_update: now,
            last_bytes: 0,
        }
    }

    /// Update progress and optionally emit event
    pub fn update(&mut self, bytes_transferred: u64, window: &Window) {
        self.transferred_bytes = bytes_transferred;
        
        let now = std::time::Instant::now();
        let elapsed = now.duration_since(self.last_update);
        
        // Only emit events every 100ms to avoid flooding
        if elapsed.as_millis() >= 100 || bytes_transferred >= self.total_bytes {
            let bytes_since_last = self.transferred_bytes.saturating_sub(self.last_bytes);
            let speed_bps = if elapsed.as_secs_f64() > 0.0 {
                (bytes_since_last as f64 / elapsed.as_secs_f64()) as u64
            } else {
                0
            };

            let event = ProgressEvent::new(
                self.transfer_id.clone(),
                self.vm_id.clone(),
                self.transferred_bytes,
                self.total_bytes,
            )
            .with_speed(speed_bps);

            debug!(
                "Transfer progress: {:.1}% ({}/{} bytes)",
                event.percent, self.transferred_bytes, self.total_bytes
            );

            if let Err(e) = window.emit("file-transfer:progress", &event) {
                tracing::warn!("Failed to emit progress event: {}", e);
            }

            self.last_update = now;
            self.last_bytes = self.transferred_bytes;
        }
    }

    /// Mark transfer as complete
    pub fn complete(&self, window: &Window, local_path: &str, remote_path: &str) {
        let duration_ms = self.start_time.elapsed().as_millis() as u64;
        
        let event = TransferCompleteEvent {
            transfer_id: self.transfer_id.clone(),
            vm_id: self.vm_id.clone(),
            success: true,
            local_path: local_path.to_string(),
            remote_path: remote_path.to_string(),
            total_bytes: self.total_bytes,
            duration_ms,
            error: None,
        };

        if let Err(e) = window.emit("file-transfer:complete", &event) {
            tracing::warn!("Failed to emit complete event: {}", e);
        }
    }

    /// Mark transfer as failed
    pub fn fail(&self, window: &Window, local_path: &str, remote_path: &str, error: &str) {
        let duration_ms = self.start_time.elapsed().as_millis() as u64;
        
        let event = TransferCompleteEvent {
            transfer_id: self.transfer_id.clone(),
            vm_id: self.vm_id.clone(),
            success: false,
            local_path: local_path.to_string(),
            remote_path: remote_path.to_string(),
            total_bytes: self.transferred_bytes,
            duration_ms,
            error: Some(error.to_string()),
        };

        if let Err(e) = window.emit("file-transfer:complete", &event) {
            tracing::warn!("Failed to emit complete event: {}", e);
        }
    }
}
