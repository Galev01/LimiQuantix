//! Libvirt hypervisor backend.
//!
//! This module provides the primary hypervisor backend using libvirt/QEMU.
//! It requires the `libvirt` feature to be enabled and the system to have
//! libvirt installed.

#[cfg(feature = "libvirt")]
mod backend;

#[cfg(feature = "libvirt")]
pub use backend::LibvirtBackend;

/// Check if libvirt backend is compiled in.
pub fn is_available() -> bool {
    cfg!(feature = "libvirt")
}
