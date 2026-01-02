//! Error types for the hypervisor abstraction layer.

use thiserror::Error;

/// Errors that can occur during hypervisor operations.
#[derive(Error, Debug)]
pub enum HypervisorError {
    /// Failed to connect to the hypervisor.
    #[error("Failed to connect to hypervisor: {0}")]
    ConnectionFailed(String),
    
    /// VM was not found (simple variant).
    #[error("VM not found: {0}")]
    VmNotFound(String),
    
    /// Failed to create a VM (simple variant).
    #[error("Failed to create VM: {0}")]
    CreateFailed(String),
    
    /// Failed to start a VM (simple variant).
    #[error("Failed to start VM: {0}")]
    StartFailed(String),
    
    /// Failed to stop a VM (simple variant).
    #[error("Failed to stop VM: {0}")]
    StopFailed(String),
    
    /// Failed to delete a VM (simple variant).
    #[error("Failed to delete VM: {0}")]
    DeleteFailed(String),
    
    /// General operation failed.
    #[error("Operation failed: {0}")]
    OperationFailed(String),
    
    /// Snapshot operation failed (simple variant).
    #[error("Snapshot operation failed: {0}")]
    SnapshotFailed(String),
    
    /// Snapshot not found.
    #[error("Snapshot not found: {0}")]
    SnapshotNotFound(String),
    
    /// Migration failed (simple variant).
    #[error("Migration failed: {0}")]
    MigrationFailed(String),
    
    /// Query failed.
    #[error("Failed to query: {0}")]
    QueryFailed(String),
    
    /// Invalid configuration.
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
    
    /// VM is in an invalid state for the requested operation.
    #[error("Invalid VM state for operation: {0}")]
    InvalidState(String),
    
    /// XML generation/parsing error.
    #[error("XML error: {0}")]
    XmlError(String),
    
    /// Internal error.
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type alias for hypervisor operations.
pub type Result<T> = std::result::Result<T, HypervisorError>;
