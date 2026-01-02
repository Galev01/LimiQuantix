//! Message handlers for the guest agent.
//!
//! This module contains handlers for all incoming messages from the host.

mod execute;
mod file;
mod lifecycle;

use crate::AgentConfig;
use anyhow::{anyhow, Result};
use limiquantix_proto::agent::{agent_message, AgentMessage, PongResponse};
use prost_types::Timestamp;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{debug, info, warn};

pub use execute::ExecuteHandler;
pub use file::FileHandler;
pub use lifecycle::LifecycleHandler;

/// Central message handler that dispatches to specific handlers
pub struct MessageHandler {
    config: AgentConfig,
    execute_handler: ExecuteHandler,
    file_handler: FileHandler,
    lifecycle_handler: LifecycleHandler,
}

impl MessageHandler {
    /// Create a new message handler with the given configuration
    pub fn new(config: AgentConfig) -> Self {
        Self {
            execute_handler: ExecuteHandler::new(config.max_exec_timeout_secs),
            file_handler: FileHandler::new(config.max_chunk_size),
            lifecycle_handler: LifecycleHandler::new(),
            config,
        }
    }

    /// Handle an incoming message and return an optional response
    pub async fn handle(&self, message: AgentMessage) -> Result<Option<AgentMessage>> {
        let message_id = message.message_id.clone();

        let payload = message
            .payload
            .ok_or_else(|| anyhow!("Message has no payload"))?;

        let response_payload = match payload {
            // Health check - respond with pong
            agent_message::Payload::Ping(ping) => {
                info!(sequence = ping.sequence, "Received ping");
                let uptime = get_uptime();
                Some(agent_message::Payload::Pong(PongResponse {
                    sequence: ping.sequence,
                    version: env!("CARGO_PKG_VERSION").to_string(),
                    uptime_seconds: uptime,
                }))
            }

            // Command execution
            agent_message::Payload::Execute(req) => {
                debug!(command = %req.command, "Executing command");
                let response = self.execute_handler.handle(req).await;
                Some(agent_message::Payload::ExecuteResponse(response))
            }

            // File write
            agent_message::Payload::FileWrite(req) => {
                debug!(path = %req.path, "Writing file");
                let response = self.file_handler.handle_write(req).await;
                Some(agent_message::Payload::FileWriteResponse(response))
            }

            // File read
            agent_message::Payload::FileRead(req) => {
                debug!(path = %req.path, "Reading file");
                let response = self.file_handler.handle_read(req).await;
                Some(agent_message::Payload::FileReadResponse(response))
            }

            // Shutdown
            agent_message::Payload::Shutdown(req) => {
                info!(shutdown_type = ?req.r#type, "Shutdown requested");
                let response = self.lifecycle_handler.handle_shutdown(req).await;
                Some(agent_message::Payload::ShutdownResponse(response))
            }

            // Password reset
            agent_message::Payload::ResetPassword(req) => {
                info!(username = %req.username, "Password reset requested");
                let response = self.lifecycle_handler.handle_reset_password(req).await;
                Some(agent_message::Payload::ResetPasswordResponse(response))
            }

            // Network configuration
            agent_message::Payload::ConfigureNetwork(req) => {
                info!("Network configuration requested");
                let response = self.lifecycle_handler.handle_configure_network(req).await;
                Some(agent_message::Payload::ConfigureNetworkResponse(response))
            }

            // Response messages - should not be received by the agent
            agent_message::Payload::Pong(_)
            | agent_message::Payload::ExecuteResponse(_)
            | agent_message::Payload::FileWriteResponse(_)
            | agent_message::Payload::FileReadResponse(_)
            | agent_message::Payload::ShutdownResponse(_)
            | agent_message::Payload::ResetPasswordResponse(_)
            | agent_message::Payload::ConfigureNetworkResponse(_) => {
                warn!(message_id = %message_id, "Received response message - ignoring");
                None
            }

            // Events - should not be received by the agent
            agent_message::Payload::Telemetry(_)
            | agent_message::Payload::AgentReady(_)
            | agent_message::Payload::Error(_) => {
                warn!(message_id = %message_id, "Received event message - ignoring");
                None
            }
        };

        // Wrap the response payload in an AgentMessage
        Ok(response_payload.map(|payload| {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default();

            AgentMessage {
                message_id: format!("{}-response", message_id),
                timestamp: Some(Timestamp {
                    seconds: now.as_secs() as i64,
                    nanos: now.subsec_nanos() as i32,
                }),
                payload: Some(payload),
            }
        }))
    }
}

/// Get system uptime in seconds
fn get_uptime() -> u64 {
    sysinfo::System::uptime()
}
