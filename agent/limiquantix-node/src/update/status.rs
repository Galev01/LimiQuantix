//! Update status tracking
//!
//! Provides types for tracking the current state of the update system.

use serde::{Deserialize, Serialize};

/// Current status of the update system
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum UpdateStatus {
    /// No update operation in progress
    Idle,
    
    /// Checking for available updates
    Checking,
    
    /// System is up to date
    UpToDate,
    
    /// Update available but not yet downloaded
    Available(String), // version
    
    /// Downloading update artifacts
    Downloading(UpdateProgress),
    
    /// Applying downloaded updates
    Applying(String), // current step description
    
    /// Update completed successfully
    Complete(String), // new version
    
    /// Update failed
    Error(String), // error message
    
    /// Reboot required to complete update
    RebootRequired,
}

/// Progress information for an ongoing download
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgress {
    /// Name of the component currently being downloaded
    pub current_component: String,
    
    /// Bytes downloaded so far (across all components)
    pub downloaded_bytes: u64,
    
    /// Total bytes to download
    pub total_bytes: u64,
    
    /// Overall percentage complete (0-100)
    pub percentage: u8,
}

impl UpdateProgress {
    /// Create a new progress tracker
    pub fn new(component: String, downloaded: u64, total: u64) -> Self {
        let percentage = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0) as u8
        } else {
            0
        };
        
        Self {
            current_component: component,
            downloaded_bytes: downloaded,
            total_bytes: total,
            percentage,
        }
    }
}

/// Status of a single component during update
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentStatus {
    /// Waiting to be processed
    Pending,
    
    /// Currently downloading
    Downloading {
        downloaded: u64,
        total: u64,
    },
    
    /// Download complete, verifying checksum
    Verifying,
    
    /// Applying update (extracting, installing)
    Applying,
    
    /// Update applied successfully
    Complete,
    
    /// Update failed
    Failed(String),
    
    /// Rolled back after failure
    RolledBack,
}

impl ComponentStatus {
    /// Check if this status represents a final state
    pub fn is_final(&self) -> bool {
        matches!(self, 
            ComponentStatus::Complete | 
            ComponentStatus::Failed(_) | 
            ComponentStatus::RolledBack
        )
    }
    
    /// Check if this status represents an error
    pub fn is_error(&self) -> bool {
        matches!(self, ComponentStatus::Failed(_) | ComponentStatus::RolledBack)
    }
}
