//! # limiquantix Proto
//!
//! Generated Rust code from protobuf definitions for the Node Daemon.
//!
//! This crate contains the gRPC service definitions and message types
//! for communication between the Node Daemon and the Control Plane.

// Include generated code
pub mod generated {
    pub mod limiquantix {
        pub mod node {
            pub mod v1 {
                include!("generated/limiquantix.node.v1.rs");
            }
        }
    }
}

// Re-export for convenience
pub use generated::limiquantix::node::v1::*;
pub use generated::limiquantix::node::v1::node_daemon_service_server::{
    NodeDaemonService, NodeDaemonServiceServer,
};
pub use generated::limiquantix::node::v1::node_daemon_service_client::NodeDaemonServiceClient;
