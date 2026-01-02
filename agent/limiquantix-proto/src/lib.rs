//! # limiquantix Proto
//!
//! Generated Rust code from protobuf definitions for the Node Daemon and Guest Agent.
//!
//! This crate contains the gRPC service definitions and message types
//! for communication between:
//! - Node Daemon <-> Control Plane (gRPC)
//! - Node Daemon <-> Guest Agent (virtio-serial with length-prefixed protobuf)

// Include generated code
pub mod generated {
    pub mod limiquantix {
        pub mod node {
            pub mod v1 {
                include!("generated/limiquantix.node.v1.rs");
            }
        }
        pub mod agent {
            pub mod v1 {
                include!("generated/limiquantix.agent.v1.rs");
            }
        }
    }
}

// =============================================================================
// Node Daemon Protocol Re-exports
// =============================================================================

/// Node daemon types and service definitions
pub mod node {
    pub use crate::generated::limiquantix::node::v1::*;
    pub use crate::generated::limiquantix::node::v1::node_daemon_service_server::{
        NodeDaemonService, NodeDaemonServiceServer,
    };
    pub use crate::generated::limiquantix::node::v1::node_daemon_service_client::NodeDaemonServiceClient;
}

// =============================================================================
// Guest Agent Protocol Re-exports
// =============================================================================

/// Guest agent types for virtio-serial communication
pub mod agent {
    pub use crate::generated::limiquantix::agent::v1::*;
}

// Backward compatibility: re-export node types at crate root
pub use generated::limiquantix::node::v1::*;
pub use generated::limiquantix::node::v1::node_daemon_service_server::{
    NodeDaemonService, NodeDaemonServiceServer,
};
pub use generated::limiquantix::node::v1::node_daemon_service_client::NodeDaemonServiceClient;
