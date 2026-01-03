//! # limiquantix Common
//!
//! Shared utilities for the limiquantix agent components.
//!
//! ## Logging
//!
//! Beautiful, emoji-rich logging for easy debugging:
//!
//! ```rust
//! use limiquantix_common::{init_logging, log_success, log_error, log_vm};
//!
//! // Initialize with level
//! init_logging("info").unwrap();
//!
//! // Use macros for consistent formatting
//! log_success!("vm", "VM created successfully");
//! log_vm!("start", "vm-123", "Starting VM with 4GB RAM");
//! ```

pub mod logging;

// Re-export logging functions
pub use logging::{
    init_logging,
    init_logging_json,
    init_logging_production,
    log_system_diagnostics,
    emoji,
    Loggable,
    LogEntry,
    LogStats,
    TimedOperation,
};
