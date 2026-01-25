//! Message handlers for the guest agent.
//!
//! This module contains handlers for different message types received from the host.

use anyhow::{anyhow, Result};
use limiquantix_proto::agent::{agent_message, AgentMessage};
use prost_types::Timestamp;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{debug, info, warn};

mod clipboard;
mod directory;
mod display;
mod execute;
mod file;
mod inventory;
mod lifecycle;
mod process;
mod quiesce;
mod service;
mod timesync;
mod update;

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
            // =========================================================================
            // Health Check
            // =========================================================================
            agent_message::Payload::Ping(req) => {
                debug!(sequence = req.sequence, "Handling ping request");
                Some(self.handle_ping(req))
            }

            // =========================================================================
            // Command Execution
            // =========================================================================
            agent_message::Payload::Execute(req) => {
                info!(command = %req.command, "Handling execute request");
                Some(execute::handle_execute(req, &self.config).await)
            }

            // =========================================================================
            // File Operations
            // =========================================================================
            agent_message::Payload::FileWrite(req) => {
                info!(path = %req.path, "Handling file write request");
                Some(file::handle_file_write(req, &self.config).await)
            }

            agent_message::Payload::FileRead(req) => {
                info!(path = %req.path, "Handling file read request");
                Some(file::handle_file_read(req, &self.config).await)
            }

            // =========================================================================
            // Directory Operations (Phase 2)
            // =========================================================================
            agent_message::Payload::ListDirectory(req) => {
                info!(path = %req.path, "Handling list directory request");
                Some(directory::handle_list_directory(req, &self.config).await)
            }

            agent_message::Payload::CreateDirectory(req) => {
                info!(path = %req.path, "Handling create directory request");
                Some(directory::handle_create_directory(req).await)
            }

            agent_message::Payload::FileDelete(req) => {
                info!(path = %req.path, "Handling file delete request");
                Some(directory::handle_file_delete(req).await)
            }

            agent_message::Payload::FileStat(req) => {
                info!(path = %req.path, "Handling file stat request");
                Some(directory::handle_file_stat(req).await)
            }

            // =========================================================================
            // Lifecycle Operations
            // =========================================================================
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

            // =========================================================================
            // Filesystem Quiescing (for safe snapshots)
            // =========================================================================
            agent_message::Payload::Quiesce(req) => {
                info!(mount_points = ?req.mount_points, "Handling quiesce request");
                Some(quiesce::handle_quiesce(req, &self.config).await)
            }

            agent_message::Payload::Thaw(req) => {
                info!(token = %req.quiesce_token, "Handling thaw request");
                Some(quiesce::handle_thaw(req, &self.config).await)
            }

            // =========================================================================
            // Time Synchronization
            // =========================================================================
            agent_message::Payload::SyncTime(req) => {
                info!(force = req.force, "Handling time sync request");
                Some(timesync::handle_sync_time(req, &self.config).await)
            }

            // =========================================================================
            // Display Operations (Phase 3 - Desktop Integration)
            // =========================================================================
            agent_message::Payload::DisplayResize(req) => {
                info!(
                    width = req.width,
                    height = req.height,
                    "Handling display resize request"
                );
                Some(display::handle_display_resize(req, &self.config).await)
            }

            // =========================================================================
            // Clipboard Operations (Phase 3 - Desktop Integration)
            // =========================================================================
            agent_message::Payload::ClipboardUpdate(req) => {
                info!("Handling clipboard update request");
                Some(clipboard::handle_clipboard_update(req).await)
            }

            agent_message::Payload::ClipboardGet(req) => {
                info!("Handling clipboard get request");
                Some(clipboard::handle_clipboard_get(req).await)
            }

            // =========================================================================
            // Process Management (Phase 4)
            // =========================================================================
            agent_message::Payload::ListProcesses(req) => {
                info!(filter = %req.filter, "Handling list processes request");
                Some(process::handle_list_processes(req).await)
            }

            agent_message::Payload::KillProcess(req) => {
                info!(pid = req.pid, signal = req.signal, "Handling kill process request");
                Some(process::handle_kill_process(req).await)
            }

            // =========================================================================
            // Service Management (Phase 4)
            // =========================================================================
            agent_message::Payload::ListServices(req) => {
                info!(filter = %req.filter, "Handling list services request");
                Some(service::handle_list_services(req).await)
            }

            agent_message::Payload::ServiceControl(req) => {
                info!(name = %req.name, action = req.action, "Handling service control request");
                Some(service::handle_service_control(req).await)
            }

            // =========================================================================
            // System Inventory (Phase 5)
            // =========================================================================
            agent_message::Payload::GetHardwareInfo(req) => {
                info!("Handling get hardware info request");
                Some(inventory::handle_get_hardware_info(req).await)
            }

            agent_message::Payload::ListInstalledSoftware(req) => {
                info!(filter = %req.filter, "Handling list installed software request");
                Some(inventory::handle_list_installed_software(req).await)
            }

            // =========================================================================
            // Agent Self-Management (Phase 6)
            // =========================================================================
            agent_message::Payload::AgentUpdate(req) => {
                info!(
                    target_version = %req.target_version,
                    chunk = req.chunk_number,
                    "Handling agent update request"
                );
                Some(update::handle_agent_update(req).await)
            }

            agent_message::Payload::GetCapabilities(req) => {
                info!("Handling get capabilities request");
                Some(update::handle_get_capabilities(req).await)
            }

            // =========================================================================
            // Responses and Events (should not be received by agent)
            // =========================================================================
            agent_message::Payload::Pong(_)
            | agent_message::Payload::ExecuteResponse(_)
            | agent_message::Payload::FileWriteResponse(_)
            | agent_message::Payload::FileReadResponse(_)
            | agent_message::Payload::ShutdownResponse(_)
            | agent_message::Payload::ResetPasswordResponse(_)
            | agent_message::Payload::ConfigureNetworkResponse(_)
            | agent_message::Payload::QuiesceResponse(_)
            | agent_message::Payload::ThawResponse(_)
            | agent_message::Payload::SyncTimeResponse(_)
            | agent_message::Payload::ListDirectoryResponse(_)
            | agent_message::Payload::CreateDirectoryResponse(_)
            | agent_message::Payload::FileDeleteResponse(_)
            | agent_message::Payload::FileStatResponse(_)
            | agent_message::Payload::DisplayResizeResponse(_)
            | agent_message::Payload::ClipboardUpdateResponse(_)
            | agent_message::Payload::ClipboardGetResponse(_)
            | agent_message::Payload::ListProcessesResponse(_)
            | agent_message::Payload::KillProcessResponse(_)
            | agent_message::Payload::ListServicesResponse(_)
            | agent_message::Payload::ServiceControlResponse(_)
            | agent_message::Payload::HardwareInfoResponse(_)
            | agent_message::Payload::ListInstalledSoftwareResponse(_)
            | agent_message::Payload::AgentUpdateResponse(_)
            | agent_message::Payload::GetCapabilitiesResponse(_)
            | agent_message::Payload::Telemetry(_)
            | agent_message::Payload::AgentReady(_)
            | agent_message::Payload::Error(_)
            | agent_message::Payload::ClipboardChanged(_) => {
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
