//! Network module for OVS/OVN integration.
//!
//! This module provides:
//! - OVS port management (creating/binding ports on br-int)
//! - OVN integration (iface-id binding for OVN controller)
//! - Libvirt interface XML generation for OVS

mod ovs;
mod types;

pub use ovs::OvsPortManager;
pub use types::*;
