//! Message handlers for the guest agent.
//!
//! This module contains handlers for different message types received from the host.

use anyhow::{anyhow, Result};
use limiquantix_proto::agent::{agent_message, AgentMessage};
use prost_types::Timestamp;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{debug, error, info, warn};

mod execute;
mod file;
mod lifecycle;

use crate::AgentConfig;

/// Message handler that routes messages to the appropriate handler.
pub struct MessageHandler {
    config: AgentConfig,
}

impl MessageHandler {
    /// Create a new message handler with the given configuration.
    pub fn new(config: AgentConfig) -> Self {
        Self { config }
    }

    /// Handle an incoming message and return an optional response.
    pub async fn handle(&self, message: AgentMessage) -> Result<Option<AgentMessage>> {
        let message_id = message.message_id.clone();

        let payload = message
            .payload
            .ok_or_else(|| anyhow!("Message has no payload"))?;

        let response_payload = match payload {
            // Health check
            agent_message::Payload::Ping(req) => {
                debug!(sequence = req.sequence, "Handling ping request");
                Some(self.handle_ping(req))
            }

            // Command execution
            agent_message::Payload::Execute(req) => {
                info!(command = %req.command, "Handling execute request");
                Some(execute::handle_execute(req, &self.config).await)
            }

            // File operations
            agent_message::Payload::FileWrite(req) => {
                info!(path = %req.path, "Handling file write request");
                Some(file::handle_file_write(req).await)
            }

            agent_message::Payload::FileRead(req) => {
                info!(path = %req.path, "Handling file read request");
                Some(file::handle_file_read(req, &self.config).await)
            }

            // Lifecycle operations
            agent_message::Payload::Shutdown(req) => {
                info!(r#type = ?req.r#type, "Handling shutdown request");
                Some(lifecycle::handle_shutdown(req).await)
            }

            agent_message::Payload::ResetPassword(req) => {
                info!(username = %req.username, "Handling password reset request");
                Some(lifecycle::handle_reset_password(req).await)
            }

            agent_message::Payload::ConfigureNetwork(req) => {
                info!("Handling network configuration request");
                Some(lifecycle::handle_configure_network(req).await)
            }

            // Responses and events (should not be received by agent)
            agent_message::Payload::Pong(_)
            | agent_message::Payload::ExecuteResponse(_)
            | agent_message::Payload::FileWriteResponse(_)
            | agent_message::Payload::FileReadResponse(_)
            | agent_message::Payload::ShutdownResponse(_)
            | agent_message::Payload::ResetPasswordResponse(_)
            | agent_message::Payload::ConfigureNetworkResponse(_)
            | agent_message::Payload::Telemetry(_)
            | agent_message::Payload::AgentReady(_)
            | agent_message::Payload::Error(_) => {
                warn!("Received unexpected message type (response/event)");
                None
            }
        };

        // Wrap the response payload in an AgentMessage
        Ok(response_payload.map(|payload| {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default();

            AgentMessage {
                message_id,
                timestamp: Some(Timestamp {
                    seconds: now.as_secs() as i64,
                    nanos: now.subsec_nanos() as i32,
                }),
                payload: Some(payload),
            }
        }))
    }

    /// Handle a ping request.
    fn handle_ping(
        &self,
        req: limiquantix_proto::agent::PingRequest,
    ) -> agent_message::Payload {
        use limiquantix_proto::agent::PongResponse;
        use sysinfo::System;

        let uptime = System::uptime();

        agent_message::Payload::Pong(PongResponse {
            sequence: req.sequence,
            version: env!("CARGO_PKG_VERSION").to_string(),
            uptime_seconds: uptime,
        })
    }
}
