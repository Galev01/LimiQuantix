//! # limiquantix Hypervisor
//!
//! Hypervisor abstraction layer for managing virtual machines.
//!
//! This crate provides a unified interface for different hypervisor backends:
//! - **Libvirt/QEMU** (primary) - Full-featured, enterprise-ready
//! - **Cloud Hypervisor** (future) - Modern, Rust-based, performance-focused
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────┐
//! │          Hypervisor Trait               │
//! │  (create_vm, start_vm, stop_vm, etc.)   │
//! └─────────────────────┬───────────────────┘
//!                       │
//!         ┌─────────────┴─────────────┐
//!         ▼                           ▼
//! ┌───────────────────┐     ┌───────────────────┐
//! │  LibvirtBackend   │     │  CloudHypervisor  │
//! │   (via libvirt)   │     │   Backend (REST)  │
//! └───────────────────┘     └───────────────────┘
//! ```
//!
//! ## Usage
//!
//! ```rust,ignore
//! use limiquantix_hypervisor::{Hypervisor, MockBackend, VmConfig};
//!
//! #[tokio::main]
//! async fn main() {
//!     let backend = MockBackend::new();
//!     
//!     let config = VmConfig::new("my-vm")
//!         .with_cpu(4)
//!         .with_memory(4096);
//!     
//!     let vm_id = backend.create_vm(config).await.unwrap();
//!     backend.start_vm(&vm_id).await.unwrap();
//! }
//! ```

pub mod error;
pub mod traits;
pub mod types;
pub mod mock;
pub mod libvirt;
pub mod storage;
pub mod network;
pub mod cloudinit;
mod xml;

pub use error::HypervisorError;
pub use traits::{Hypervisor, HypervisorCapabilities};
pub use types::*;
pub use mock::MockBackend;
pub use storage::{
    StorageManager, 
    StorageBackend,
    LocalBackend,
    NfsBackend,
    CephBackend,
    IscsiBackend,
    PoolType,
    PoolConfig,
    PoolInfo,
    VolumeAttachInfo,
    VolumeSource,
    DiskInfo,
    LocalConfig,
    DEFAULT_STORAGE_PATH,
};
pub use network::{
    OvsPortManager,
    NetworkPortConfig,
    NetworkPortInfo,
    NetworkPortPhase,
    NetworkPortBindingType,
    NetworkPortQoS,
    OvsStatus,
};
pub use cloudinit::{CloudInitConfig, CloudInitGenerator};

// Re-export libvirt backend when available
#[cfg(feature = "libvirt")]
pub use libvirt::LibvirtBackend;

