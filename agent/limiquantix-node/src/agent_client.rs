//! Guest Agent Client
//!
//! This module provides a client for communicating with the LimiQuantix Guest Agent
//! running inside VMs via virtio-serial (Unix sockets on the host).
//!
//! ## Platform Support
//!
//! - **Unix**: Full implementation using Unix sockets for virtio-serial communication.
//! - **Windows**: Stub implementation (returns errors). See TODO below.
//!
//! ## TODO: Windows Support (Enterprise Priority)
//!
//! VMware vSphere dominance relies heavily on Windows guest support. To achieve
//! enterprise parity as a "vSphere Killer", Windows host-side agent communication
//! must be implemented.
//!
//! **Required Changes:**
//! 1. Implement Windows Named Pipes version of `AgentClient`
//!    - Named Pipes are the Windows equivalent of Unix sockets for virtio-serial
//!    - Use `tokio::net::windows::named_pipe::NamedPipeClient`
//! 2. The guest agent (`limiquantix-guest-agent`) already has Windows builds
//! 3. Only the host-side connection logic in this file needs Windows support
//!
//! **Reference:**
//! - QEMU on Windows uses `\\.\pipe\{name}` for virtio-serial channels
//! - Example: `\\.\pipe\org.quantix.agent.{vm_id}`

use anyhow::{anyhow, Result};
use limiquantix_proto::agent::{AgentReadyEvent, ExecuteRequest, ExecuteResponse, TelemetryReport};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};

// ============================================================================
// COMMON TYPES (All platforms)
// ============================================================================

/// Base path for VM agent sockets
const SOCKET_BASE_PATH: &str = "/var/run/quantix-kvm/vms";

/// Default timeout for agent operations
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

// ============================================================================
// UNIX IMPLEMENTATION
// ============================================================================

#[cfg(unix)]
mod unix_impl {
    use super::*;
    use anyhow::Context;
    use limiquantix_proto::agent::{
        agent_message, AgentMessage, FileReadRequest, FileWriteRequest, PingRequest, PongResponse,
        QuiesceFilesystemsRequest, QuiesceFilesystemsResponse, ShutdownRequest, ShutdownResponse,
        SyncTimeRequest, SyncTimeResponse, ThawFilesystemsRequest, ThawFilesystemsResponse,
        ListDirectoryRequest, ListDirectoryResponse,
    };
    use prost::Message;
    use prost_types::Timestamp;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::UnixStream;
    use tokio::sync::oneshot;
    use tracing::{debug, error, info, warn};
    use uuid::Uuid;

    /// Maximum message size (16 MB)
    const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;

    /// Pending request waiting for a response
    struct PendingRequest {
        response_tx: oneshot::Sender<AgentMessage>,
    }

    use tokio::io::{ReadHalf, WriteHalf};
    
    /// Guest Agent Client for communicating with a specific VM's agent.
    /// 
    /// The client maintains a connection to the guest agent via virtio-serial.
    /// It tracks both the writer (for sending) and whether the response handler
    /// task is still alive (for receiving).
    pub struct AgentClient {
        vm_id: String,
        socket_path: PathBuf,
        /// Writer half of the stream - used for sending requests
        writer: Option<Arc<Mutex<WriteHalf<UnixStream>>>>,
        pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
        telemetry_tx: Option<mpsc::Sender<TelemetryReport>>,
        /// Channel for forwarding AgentReadyEvent to the service
        agent_ready_tx: Option<mpsc::Sender<AgentReadyEvent>>,
        /// Tracks if the response handler task is still alive
        /// This is crucial for detecting zombie connections where the writer
        /// exists but the reader has died.
        response_handler_alive: Arc<AtomicBool>,
    }

    impl AgentClient {
        /// Create a new agent client for the given VM.
        /// Tries multiple possible socket paths and uses the first one found.
        pub fn new(vm_id: impl Into<String>) -> Self {
            let vm_id = vm_id.into();
            
            // Try multiple possible socket paths
            let socket_path = Self::find_socket_path(&vm_id)
                .unwrap_or_else(|| PathBuf::from(format!("{}/{}.agent.sock", SOCKET_BASE_PATH, vm_id)));

            Self {
                vm_id,
                socket_path,
                writer: None,
                pending: Arc::new(Mutex::new(HashMap::new())),
                telemetry_tx: None,
                agent_ready_tx: None,
                response_handler_alive: Arc::new(AtomicBool::new(false)),
            }
        }
        
        /// Find the agent socket path by checking multiple possible locations.
        /// 
        /// CRITICAL: This function MUST verify that the directory name contains the VM ID
        /// to prevent socket hijacking where we connect to the wrong VM's socket.
        fn find_socket_path(vm_id: &str) -> Option<PathBuf> {
            // Primary path: Our custom socket path (already includes VM ID in filename)
            let primary = PathBuf::from(format!("{}/{}.agent.sock", SOCKET_BASE_PATH, vm_id));
            if primary.exists() {
                debug!(vm_id = %vm_id, path = %primary.display(), "Found agent socket at primary path");
                return Some(primary);
            }
            
            // Fallback: Check libvirt's standard channel paths
            // libvirt creates sockets like /run/libvirt/qemu/channel/{domain-id}-{vm_name}/org.quantix.agent.0
            // We need to find the right directory that MATCHES our VM ID.
            // Check both new name (org.quantix) and legacy name (org.limiquantix)
            let channel_names = ["org.quantix.agent.0", "org.limiquantix.agent.0"];
            
            // Helper function to check a libvirt channel directory
            let check_libvirt_channel_dir = |base_path: &std::path::Path| -> Option<PathBuf> {
                if !base_path.exists() {
                    return None;
                }
                
                let entries = std::fs::read_dir(base_path).ok()?;
                
                for entry in entries.flatten() {
                    let dir_name = entry.file_name();
                    let dir_str = dir_name.to_string_lossy();
                    
                    // ✅ CRITICAL FIX: Verify this directory belongs to our VM!
                    // Libvirt directories are usually "{domain-id}-{vm_name}" format.
                    // We MUST check if the VM ID is present in the directory name.
                    // This prevents connecting to the wrong VM's socket (socket hijacking).
                    if !dir_str.contains(vm_id) {
                        debug!(
                            vm_id = %vm_id, 
                            dir = %dir_str, 
                            "Skipping libvirt channel directory - does not match VM ID"
                        );
                        continue;
                    }
                    
                    // Directory matches our VM ID - check for our agent socket
                    for channel_name in &channel_names {
                        let socket_path = entry.path().join(channel_name);
                        if socket_path.exists() {
                            info!(
                                vm_id = %vm_id, 
                                dir = %dir_str, 
                                path = %socket_path.display(), 
                                "Found verified libvirt agent socket (VM ID matches directory)"
                            );
                            return Some(socket_path);
                        }
                    }
                }
                
                None
            };
            
            // Check /run/libvirt/qemu/channel/
            let libvirt_run = std::path::Path::new("/run/libvirt/qemu/channel");
            if let Some(path) = check_libvirt_channel_dir(libvirt_run) {
                return Some(path);
            }
            
            // Also check /var/lib/libvirt/qemu/channel/
            let libvirt_var = std::path::Path::new("/var/lib/libvirt/qemu/channel");
            if let Some(path) = check_libvirt_channel_dir(libvirt_var) {
                return Some(path);
            }
            
            debug!(vm_id = %vm_id, "No agent socket found in any known location");
            None
        }

        /// Create a new agent client with a custom socket path.
        pub fn with_socket_path(vm_id: impl Into<String>, socket_path: PathBuf) -> Self {
            Self {
                vm_id: vm_id.into(),
                socket_path,
                writer: None,
                pending: Arc::new(Mutex::new(HashMap::new())),
                telemetry_tx: None,
                agent_ready_tx: None,
                response_handler_alive: Arc::new(AtomicBool::new(false)),
            }
        }

        /// Set a channel to receive telemetry updates.
        pub fn with_telemetry_channel(mut self, tx: mpsc::Sender<TelemetryReport>) -> Self {
            self.telemetry_tx = Some(tx);
            self
        }

        /// Set a channel to receive AgentReadyEvent.
        pub fn with_agent_ready_channel(mut self, tx: mpsc::Sender<AgentReadyEvent>) -> Self {
            self.agent_ready_tx = Some(tx);
            self
        }

        /// Check if the agent socket exists.
        pub fn socket_exists(&self) -> bool {
            self.socket_path.exists()
        }
        
        /// Re-check socket paths and update if a valid one is found
        pub fn refresh_socket_path(&mut self) -> bool {
            if let Some(path) = Self::find_socket_path(&self.vm_id) {
                self.socket_path = path;
                true
            } else {
                false
            }
        }

        /// Connect to the agent with retry logic.
        /// 
        /// Uses exponential backoff to handle race conditions with virtio-serial sockets,
        /// which can hang if the guest agent isn't ready yet.
        pub async fn connect(&mut self) -> Result<()> {
            // Refresh socket path in case it changed
            if !self.socket_exists() {
                self.refresh_socket_path();
            }
            
            if !self.socket_exists() {
                return Err(anyhow!(
                    "Agent socket not found: {}",
                    self.socket_path.display()
                ));
            }

            info!(
                vm_id = %self.vm_id,
                socket = %self.socket_path.display(),
                "Connecting to guest agent"
            );

            // Retry configuration for handling race conditions with virtio-serial
            const MAX_RETRIES: u32 = 3;
            const INITIAL_BACKOFF_MS: u64 = 500;
            const CONNECT_TIMEOUT_SECS: u64 = 5;
            
            let mut last_error: Option<anyhow::Error> = None;
            let mut backoff = Duration::from_millis(INITIAL_BACKOFF_MS);
            let connect_timeout = Duration::from_secs(CONNECT_TIMEOUT_SECS);

            for attempt in 0..MAX_RETRIES {
                if attempt > 0 {
                    debug!(
                        vm_id = %self.vm_id,
                        attempt = attempt + 1,
                        max_retries = MAX_RETRIES,
                        backoff_ms = backoff.as_millis(),
                        "Retrying agent connection after backoff"
                    );
                    tokio::time::sleep(backoff).await;
                    backoff *= 2; // Exponential backoff
                    
                    // Refresh socket path - it might have changed
                    self.refresh_socket_path();
                }

                // Use a timeout for the connect operation since virtio-serial sockets
                // can hang if the guest agent isn't running or responding
                match tokio::time::timeout(
                    connect_timeout,
                    UnixStream::connect(&self.socket_path)
                ).await {
                    Ok(Ok(stream)) => {
                        // Success! Proceed with the connection setup
                        if attempt > 0 {
                            info!(
                                vm_id = %self.vm_id,
                                attempt = attempt + 1,
                                "Agent connection succeeded after retry"
                            );
                        }
                        return self.setup_connection(stream).await;
                    }
                    Ok(Err(e)) => {
                        // Connection failed (not timeout)
                        let err_msg = format!("Failed to connect to agent socket: {}", e);
                        warn!(
                            vm_id = %self.vm_id,
                            attempt = attempt + 1,
                            error = %e,
                            socket = %self.socket_path.display(),
                            "Agent connection failed"
                        );
                        last_error = Some(anyhow!(err_msg).context(format!(
                            "Socket: {}", self.socket_path.display()
                        )));
                    }
                    Err(_timeout) => {
                        // Timeout
                        warn!(
                            vm_id = %self.vm_id,
                            attempt = attempt + 1,
                            timeout_secs = CONNECT_TIMEOUT_SECS,
                            socket = %self.socket_path.display(),
                            "Agent connection timed out"
                        );
                        last_error = Some(anyhow!(
                            "Timeout connecting to agent socket after {}s: {}",
                            CONNECT_TIMEOUT_SECS,
                            self.socket_path.display()
                        ));
                    }
                }
            }

            // All retries exhausted
            error!(
                vm_id = %self.vm_id,
                max_retries = MAX_RETRIES,
                socket = %self.socket_path.display(),
                "Failed to connect to agent after all retries"
            );
            
            Err(last_error.unwrap_or_else(|| anyhow!(
                "Failed to connect to agent socket: {}",
                self.socket_path.display()
            )))
        }
        
        /// Internal helper to set up the connection after successfully connecting.
        async fn setup_connection(&mut self, stream: UnixStream) -> Result<()> {
            // Split the stream into read and write halves to avoid mutex contention
            // The reader goes to the response_handler task, writer is kept for sending requests
            let (reader, writer) = tokio::io::split(stream);
            let writer = Arc::new(Mutex::new(writer));
            self.writer = Some(writer.clone());

            // Start the response handler with just the reader half
            let pending = self.pending.clone();
            let telemetry_tx = self.telemetry_tx.clone();
            let agent_ready_tx = self.agent_ready_tx.clone();
            let vm_id = self.vm_id.clone();
            
            // Mark response handler as alive before spawning
            let handler_alive = self.response_handler_alive.clone();
            handler_alive.store(true, Ordering::SeqCst);

            tokio::spawn(async move {
                info!(vm_id = %vm_id, "Response handler task starting");
                let result = response_handler(reader, pending, telemetry_tx, agent_ready_tx, vm_id.clone()).await;
                
                // Mark handler as dead when exiting (for any reason)
                handler_alive.store(false, Ordering::SeqCst);
                
                match result {
                    Ok(()) => {
                        info!(vm_id = %vm_id, "Response handler task exited normally");
                    }
                    Err(e) => {
                        error!(vm_id = %vm_id, error = %e, "Response handler task exited with error");
                    }
                }
            });

            info!(vm_id = %self.vm_id, "Connected to guest agent");
            Ok(())
        }

        /// Disconnect from the agent.
        pub async fn disconnect(&mut self) {
            self.writer = None;
            self.response_handler_alive.store(false, Ordering::SeqCst);
        }

        /// Check if the agent is connected and the response handler is alive.
        /// 
        /// A connection is considered alive only when:
        /// 1. The writer exists (we can send requests)
        /// 2. The response handler task is still running (we can receive responses)
        /// 
        /// This prevents "zombie" connections where the writer exists but
        /// the response handler has died, causing all requests to time out.
        pub fn is_connected(&self) -> bool {
            self.writer.is_some() && self.response_handler_alive.load(Ordering::SeqCst)
        }

        /// Check if the agent is connected and responding.
        pub async fn ping(&self) -> Result<PongResponse> {
            self.ping_with_timeout(DEFAULT_TIMEOUT).await
        }

        /// Ping with a custom timeout.
        pub async fn ping_with_timeout(&self, timeout: Duration) -> Result<PongResponse> {
            let request = AgentMessage {
                message_id: Uuid::new_v4().to_string(),
                timestamp: Some(current_timestamp()),
                payload: Some(agent_message::Payload::Ping(PingRequest {
                    sequence: rand::random(),
                })),
            };

            let response = self.send_request(request, timeout).await?;

            match response.payload {
                Some(agent_message::Payload::Pong(pong)) => Ok(pong),
                _ => Err(anyhow!("Unexpected response type")),
            }
        }

        /// Execute a command in the guest VM.
        pub async fn execute(&self, command: &str, timeout_secs: u32) -> Result<ExecuteResponse> {
            self.execute_full(ExecuteRequest {
                command: command.to_string(),
                args: Vec::new(),
                working_directory: String::new(),
                environment: HashMap::new(),
                timeout_seconds: timeout_secs,
                wait_for_exit: true,
                run_as_user: String::new(),
                max_output_bytes: 0,
                run_as_group: String::new(),
                include_supplementary_groups: true,
            })
            .await
        }

        /// Execute a command with full options.
        pub async fn execute_full(&self, req: ExecuteRequest) -> Result<ExecuteResponse> {
            let timeout = Duration::from_secs(req.timeout_seconds as u64 + 5);

            let request = AgentMessage {
                message_id: Uuid::new_v4().to_string(),
                timestamp: Some(current_timestamp()),
                payload: Some(agent_message::Payload::Execute(req)),
            };

            let response = self.send_request(request, timeout).await?;

            match response.payload {
                Some(agent_message::Payload::ExecuteResponse(resp)) => Ok(resp),
                _ => Err(anyhow!("Unexpected response type")),
            }
        }

        /// Read a file from the guest VM.
        pub async fn read_file(&self, path: &str) -> Result<Vec<u8>> {
            let mut data = Vec::new();
            let mut offset = 0u64;

            loop {
                let request = AgentMessage {
                    message_id: Uuid::new_v4().to_string(),
                    timestamp: Some(current_timestamp()),
                    payload: Some(agent_message::Payload::FileRead(FileReadRequest {
                        path: path.to_string(),
                        offset,
                        length: 0,
                        chunk_size: 65536,
                    })),
                };

                let response = self.send_request(request, DEFAULT_TIMEOUT).await?;

                match response.payload {
                    Some(agent_message::Payload::FileReadResponse(resp)) => {
                        if !resp.success {
                            return Err(anyhow!("File read failed: {}", resp.error));
                        }
                        data.extend_from_slice(&resp.data);
                        offset += resp.data.len() as u64;
                        if resp.eof {
                            break;
                        }
                    }
                    _ => return Err(anyhow!("Unexpected response type")),
                }
            }

            Ok(data)
        }

        /// Write a file to the guest VM.
        pub async fn write_file(&self, path: &str, data: &[u8], mode: u32) -> Result<()> {
            const CHUNK_SIZE: usize = 65536;

            let total_chunks = (data.len() + CHUNK_SIZE - 1) / CHUNK_SIZE;
            let total_chunks = if total_chunks == 0 { 1 } else { total_chunks };

            for (i, chunk) in data.chunks(CHUNK_SIZE).enumerate() {
                let is_last = i == total_chunks - 1;

                let request = AgentMessage {
                    message_id: Uuid::new_v4().to_string(),
                    timestamp: Some(current_timestamp()),
                    payload: Some(agent_message::Payload::FileWrite(FileWriteRequest {
                        path: path.to_string(),
                        data: chunk.to_vec(),
                        offset: (i * CHUNK_SIZE) as u64,
                        append: false,
                        eof: is_last,
                        mode,
                        create_parents: true,
                        chunk_number: i as u32,
                        total_chunks: total_chunks as u32,
                    })),
                };

                let response = self.send_request(request, DEFAULT_TIMEOUT).await?;

                match response.payload {
                    Some(agent_message::Payload::FileWriteResponse(resp)) => {
                        if !resp.success {
                            return Err(anyhow!("File write failed: {}", resp.error));
                        }
                    }
                    _ => return Err(anyhow!("Unexpected response type")),
                }
            }

            Ok(())
        }

        /// List directory contents in the guest VM.
        /// 
        /// This is required for the file browser feature. Returns a list of directory entries
        /// with metadata (name, size, permissions, modification time, etc.).
        pub async fn list_directory(&self, path: &str, include_hidden: bool) -> Result<ListDirectoryResponse> {
            let request = AgentMessage {
                message_id: Uuid::new_v4().to_string(),
                timestamp: Some(current_timestamp()),
                payload: Some(agent_message::Payload::ListDirectory(ListDirectoryRequest {
                    path: path.to_string(),
                    include_hidden,
                    max_entries: 0, // Unlimited
                    continuation_token: String::new(),
                })),
            };

            let response = self.send_request(request, DEFAULT_TIMEOUT).await?;

            match response.payload {
                Some(agent_message::Payload::ListDirectoryResponse(resp)) => {
                    if !resp.success {
                        return Err(anyhow!("Directory listing failed: {}", resp.error));
                    }
                    Ok(resp)
                }
                _ => Err(anyhow!("Unexpected response type")),
            }
        }

        /// Request the guest VM to shutdown.
        pub async fn shutdown(&self, reboot: bool) -> Result<ShutdownResponse> {
            use limiquantix_proto::agent::ShutdownType;

            let shutdown_type = if reboot {
                ShutdownType::Reboot
            } else {
                ShutdownType::Poweroff
            };

            let request = AgentMessage {
                message_id: Uuid::new_v4().to_string(),
                timestamp: Some(current_timestamp()),
                payload: Some(agent_message::Payload::Shutdown(ShutdownRequest {
                    r#type: shutdown_type as i32,
                    delay_seconds: 0,
                    message: String::new(),
                })),
            };

            let response = self.send_request(request, DEFAULT_TIMEOUT).await?;

            match response.payload {
                Some(agent_message::Payload::ShutdownResponse(resp)) => Ok(resp),
                _ => Err(anyhow!("Unexpected response type")),
            }
        }

        /// Quiesce (freeze) filesystems for safe snapshots.
        pub async fn quiesce_filesystems(
            &self,
            mount_points: Vec<String>,
            timeout_seconds: u32,
            run_pre_freeze_scripts: bool,
        ) -> Result<QuiesceFilesystemsResponse> {
            let timeout = Duration::from_secs(timeout_seconds as u64 + 10);

            let request = AgentMessage {
                message_id: Uuid::new_v4().to_string(),
                timestamp: Some(current_timestamp()),
                payload: Some(agent_message::Payload::Quiesce(QuiesceFilesystemsRequest {
                    mount_points,
                    timeout_seconds,
                    run_pre_freeze_scripts,
                    pre_freeze_script_dir: String::new(),
                })),
            };

            let response = self.send_request(request, timeout).await?;

            match response.payload {
                Some(agent_message::Payload::QuiesceResponse(resp)) => Ok(resp),
                _ => Err(anyhow!("Unexpected response type")),
            }
        }

        /// Thaw (unfreeze) filesystems after a snapshot.
        pub async fn thaw_filesystems(
            &self,
            quiesce_token: Option<String>,
            run_post_thaw_scripts: bool,
        ) -> Result<ThawFilesystemsResponse> {
            let request = AgentMessage {
                message_id: Uuid::new_v4().to_string(),
                timestamp: Some(current_timestamp()),
                payload: Some(agent_message::Payload::Thaw(ThawFilesystemsRequest {
                    quiesce_token: quiesce_token.unwrap_or_default(),
                    mount_points: Vec::new(),
                    run_post_thaw_scripts,
                    post_thaw_script_dir: String::new(),
                })),
            };

            let response = self.send_request(request, DEFAULT_TIMEOUT).await?;

            match response.payload {
                Some(agent_message::Payload::ThawResponse(resp)) => Ok(resp),
                _ => Err(anyhow!("Unexpected response type")),
            }
        }

        /// Synchronize the guest's system clock.
        pub async fn sync_time(&self, force: bool) -> Result<SyncTimeResponse> {
            let request = AgentMessage {
                message_id: Uuid::new_v4().to_string(),
                timestamp: Some(current_timestamp()),
                payload: Some(agent_message::Payload::SyncTime(SyncTimeRequest {
                    force,
                    set_time: None,
                })),
            };

            let response = self.send_request(request, DEFAULT_TIMEOUT).await?;

            match response.payload {
                Some(agent_message::Payload::SyncTimeResponse(resp)) => Ok(resp),
                _ => Err(anyhow!("Unexpected response type")),
            }
        }

        /// Request fresh telemetry from the guest agent.
        /// 
        /// This sends a ping request to the guest agent which triggers an immediate
        /// telemetry response. Unlike reading from cache, this actually contacts the
        /// guest and returns real-time metrics.
        /// 
        /// The guest agent responds to ping requests with a TelemetryReport event
        /// containing current CPU, memory, disk, and network usage.
        /// 
        /// Timeout: 5 seconds (telemetry collection should be fast)
        pub async fn request_telemetry(&self) -> Result<PongResponse> {
            let request = AgentMessage {
                message_id: Uuid::new_v4().to_string(),
                timestamp: Some(current_timestamp()),
                payload: Some(agent_message::Payload::Ping(PingRequest {
                    sequence: 1, // Request with sequence 1 signals "please send telemetry"
                })),
            };

            // Use a 5 second timeout - telemetry should be quick
            let response = self.send_request(request, Duration::from_secs(5)).await?;

            match response.payload {
                Some(agent_message::Payload::Pong(resp)) => Ok(resp),
                _ => Err(anyhow!("Unexpected response type")),
            }
        }

        /// Send a request and wait for a response.
        async fn send_request(
            &self,
            request: AgentMessage,
            timeout: Duration,
        ) -> Result<AgentMessage> {
            let writer = self
                .writer
                .as_ref()
                .ok_or_else(|| anyhow!("Not connected to agent"))?;

            let message_id = request.message_id.clone();
            debug!(vm_id = %self.vm_id, message_id = %message_id, "Sending request to agent");

            let (tx, rx) = oneshot::channel();
            {
                let mut pending = self.pending.lock().await;
                pending.insert(message_id.clone(), PendingRequest { response_tx: tx });
            }

            // Write the request using only the writer half (no contention with reader)
            {
                let mut writer = writer.lock().await;
                write_message(&mut *writer, &request).await?;
                debug!(vm_id = %self.vm_id, message_id = %message_id, "Request sent, waiting for response");
            }

            match tokio::time::timeout(timeout, rx).await {
                Ok(Ok(response)) => {
                    debug!(vm_id = %self.vm_id, message_id = %message_id, "Response received");
                    Ok(response)
                }
                Ok(Err(_)) => {
                    error!(vm_id = %self.vm_id, message_id = %message_id, "Response channel closed");
                    Err(anyhow!("Response channel closed"))
                }
                Err(_) => {
                    let mut pending = self.pending.lock().await;
                    pending.remove(&message_id);
                    error!(vm_id = %self.vm_id, message_id = %message_id, timeout_secs = timeout.as_secs(), "Request timed out");
                    Err(anyhow!("Request timed out"))
                }
            }
        }
    }

    /// Handle incoming responses from the agent.
    /// Takes ownership of the reader half of the split stream.
    /// 
    /// This task runs continuously, reading messages from the agent and either:
    /// - Processing AgentReady/Telemetry/Error events
    /// - Routing responses to pending requests
    /// 
    /// The task exits when:
    /// - The socket is closed (Ok(None) from read)
    /// - A read error occurs
    /// - The socket EOF is reached
    async fn response_handler(
        mut reader: ReadHalf<UnixStream>,
        pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
        telemetry_tx: Option<mpsc::Sender<TelemetryReport>>,
        agent_ready_tx: Option<mpsc::Sender<AgentReadyEvent>>,
        vm_id: String,
    ) -> Result<()> {
        info!(vm_id = %vm_id, "Response handler started - now listening for messages from guest agent");
        
        let mut message_count: u64 = 0;
        
        loop {
            // Read directly from the reader - no mutex needed since we own this half
            debug!(vm_id = %vm_id, message_count = message_count, "Waiting for next message from agent");
            
            let message = match read_message::<_, AgentMessage>(&mut reader).await {
                Ok(Some(msg)) => {
                    message_count += 1;
                    debug!(vm_id = %vm_id, message_count = message_count, "Read message successfully");
                    msg
                }
                Ok(None) => {
                    info!(vm_id = %vm_id, message_count = message_count, 
                          "Agent connection closed by peer (EOF) after {} messages", message_count);
                    break;
                }
                Err(e) => {
                    error!(vm_id = %vm_id, message_count = message_count, error = %e, 
                           "Failed to read message from agent - handler exiting");
                    return Err(e);
                }
            };

            let message_id = message.message_id.clone();
            debug!(vm_id = %vm_id, message_id = %message_id, "Received message from agent");

            match &message.payload {
                Some(agent_message::Payload::Telemetry(report)) => {
                    debug!(vm_id = %vm_id, "Received telemetry report");
                    if let Some(ref tx) = telemetry_tx {
                        let _ = tx.send(report.clone()).await;
                    }
                    continue;
                }
                Some(agent_message::Payload::AgentReady(ready)) => {
                    info!(
                        vm_id = %vm_id,
                        version = %ready.version,
                        hostname = %ready.hostname,
                        os = %ready.os_name,
                        kernel = %ready.kernel_version,
                        ips = ?ready.ip_addresses,
                        "Agent ready event received"
                    );
                    // Forward to service to update agent cache
                    if let Some(ref tx) = agent_ready_tx {
                        if let Err(e) = tx.send(ready.clone()).await {
                            warn!(vm_id = %vm_id, error = %e, "Failed to forward AgentReadyEvent");
                        }
                    }
                    continue;
                }
                Some(agent_message::Payload::Error(err)) => {
                    error!(
                        vm_id = %vm_id,
                        code = %err.code,
                        message = %err.message,
                        "Agent error"
                    );
                    continue;
                }
                Some(agent_message::Payload::Pong(pong)) => {
                    debug!(
                        vm_id = %vm_id,
                        message_id = %message_id,
                        version = %pong.version,
                        "Received pong response"
                    );
                }
                _ => {
                    debug!(vm_id = %vm_id, message_id = %message_id, "Received response message");
                }
            }

            // Route response to waiting request
            let pending_req = {
                let mut pending = pending.lock().await;
                pending.remove(&message_id)
            };

            if let Some(req) = pending_req {
                debug!(vm_id = %vm_id, message_id = %message_id, "Routing response to pending request");
                let _ = req.response_tx.send(message);
            } else {
                debug!(vm_id = %vm_id, message_id = %message_id, "No pending request for message");
            }
        }

        Ok(())
    }

    /// Magic header for protocol framing: "QTX1" (Quantix Protocol v1)
    /// This allows the reader to resync if it receives garbage/stale data.
    const MAGIC_HEADER: [u8; 4] = [0x51, 0x54, 0x58, 0x01]; // Q=0x51, T=0x54, X=0x58, 1=0x01
    
    /// Maximum bytes to scan when resyncing before giving up
    const MAX_RESYNC_BYTES: usize = 64 * 1024; // 64KB

    /// Read a magic-header-prefixed protobuf message from any async reader.
    /// 
    /// The protocol format is:
    /// - 4 bytes: Magic header "QTX1" (0x51 0x54 0x58 0x01)
    /// - 4 bytes: Message length (big-endian u32)
    /// - N bytes: Protobuf payload
    ///
    /// If garbage data is encountered, this function will scan for the magic header,
    /// discarding invalid bytes until a valid message is found. This prevents the
    /// deadlock scenario where:
    /// 1. Host connects after guest sent data
    /// 2. Host reads garbage as a huge "length" (e.g., 50,000)
    /// 3. Host blocks forever waiting for 50,000 bytes
    /// 4. Guest's buffer fills up and writes timeout
    async fn read_message<R, M>(reader: &mut R) -> Result<Option<M>>
    where
        R: AsyncReadExt + Unpin,
        M: Message + Default,
    {
        // Track total bytes scanned across ALL resync attempts in this function call
        let mut total_resync_bytes: usize = 0;
        
        loop {
            // Reset per-iteration resync counter (CRITICAL FIX: was not being reset before)
            let mut resync_bytes_this_iteration: usize = 0;
            
            // 1. Scan for Magic Header (Resync Mechanism)
            let mut header_byte = [0u8; 1];
            let mut match_count: usize = 0;

            while match_count < 4 {
                match reader.read(&mut header_byte).await {
                    Ok(0) => {
                        // EOF
                        if total_resync_bytes > 0 {
                            debug!(total_bytes_scanned = total_resync_bytes, "EOF reached during resync");
                        }
                        return Ok(None);
                    }
                    Ok(_) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                        return Ok(None);
                    }
                    Err(e) => {
                        return Err(e).context("Failed to read magic header");
                    }
                }

                // Count EVERY byte we read (CRITICAL FIX: was only counting mismatches)
                resync_bytes_this_iteration += 1;

                if header_byte[0] == MAGIC_HEADER[match_count] {
                    match_count += 1;
                } else {
                    // Mismatch - log progress periodically
                    if resync_bytes_this_iteration > 0 && resync_bytes_this_iteration % 1000 == 0 {
                        warn!(
                            bytes_scanned_this_attempt = resync_bytes_this_iteration,
                            total_bytes_scanned = total_resync_bytes + resync_bytes_this_iteration,
                            "Protocol resync in progress - scanning for magic header"
                        );
                    }
                    
                    // Check if current byte could be start of new magic sequence
                    match_count = if header_byte[0] == MAGIC_HEADER[0] { 1 } else { 0 };
                    
                    // Safety limit to prevent infinite scanning
                    if total_resync_bytes + resync_bytes_this_iteration > MAX_RESYNC_BYTES {
                        return Err(anyhow!(
                            "Failed to find magic header after scanning {} bytes - connection may be corrupted",
                            total_resync_bytes + resync_bytes_this_iteration
                        ));
                    }
                }
            }

            // We found the magic header!
            // Subtract 4 from resync count since the magic header bytes are valid
            let garbage_bytes = resync_bytes_this_iteration.saturating_sub(4);
            
            // Log if we had to skip garbage
            if garbage_bytes > 0 {
                warn!(
                    garbage_bytes_skipped = garbage_bytes,
                    "Protocol resynced - skipped garbage bytes before finding valid header"
                );
            }
            
            // Reset total counter since we found a valid header
            total_resync_bytes = 0;

            // 2. Read the 4-byte length prefix
            let mut len_buf = [0u8; 4];
            match reader.read_exact(&mut len_buf).await {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    return Ok(None);
                }
                Err(e) => {
                    return Err(e).context("Failed to read message length");
                }
            }

            let len = u32::from_be_bytes(len_buf) as usize;

            // 3. Validate message size - if invalid, resync
            if len == 0 {
                warn!("Received zero-length message after valid header, resyncing...");
                // Add 8 bytes to resync counter (4 magic + 4 length)
                total_resync_bytes += 8;
                continue;
            }
            
            // Check for "magic header as length" - this happens when a partial write 
            // left just the magic header, and we're now reading the NEXT message's 
            // magic header (0x51545801 = 1364547585) as the "length" field.
            // This is a definite desync condition.
            const MAGIC_AS_U32: u32 = 0x51545801; // "QTX1" as big-endian u32
            if len_buf == MAGIC_AS_U32.to_be_bytes() {
                warn!(
                    "Detected magic header in length field - stream desync from partial write, resyncing..."
                );
                // We just consumed what was actually a magic header as a "length".
                // The next 4 bytes will be the actual length of that message.
                // Add 4 bytes to resync counter (just the misread 4 bytes)
                total_resync_bytes += 4;
                continue;
            }
            
            if len > MAX_MESSAGE_SIZE {
                warn!(
                    length = len,
                    max = MAX_MESSAGE_SIZE,
                    length_hex = format!("0x{:08X}", len),
                    "Message length exceeds maximum, likely garbage after valid-looking header, resyncing..."
                );
                // Add 8 bytes to resync counter (4 magic + 4 length)
                total_resync_bytes += 8;
                continue;
            }

            // 4. Read the payload
            let mut payload = vec![0u8; len];
            match reader.read_exact(&mut payload).await {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    return Ok(None);
                }
                Err(e) => {
                    return Err(e).context("Failed to read message payload");
                }
            }

            // 5. Decode the protobuf message
            match M::decode(&payload[..]) {
                Ok(message) => {
                    debug!(length = len, "Message received and decoded successfully");
                    return Ok(Some(message));
                }
                Err(e) => {
                    warn!(
                        error = %e,
                        length = len,
                        "Failed to decode protobuf message, resyncing..."
                    );
                    // Add consumed bytes to resync counter (8 header + payload)
                    total_resync_bytes += 8 + len;
                    continue;
                }
            }
        }
    }

    /// Write a magic-header-prefixed protobuf message to any async writer.
    /// 
    /// The protocol format is:
    /// - 4 bytes: Magic header "QTX1" (0x51 0x54 0x58 0x01)
    /// - 4 bytes: Message length (big-endian u32)
    /// - N bytes: Protobuf payload
    async fn write_message<W, M>(writer: &mut W, message: &M) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
        M: Message,
    {
        let payload = message.encode_to_vec();
        let len = payload.len();

        if len > MAX_MESSAGE_SIZE {
            return Err(anyhow!("Message too large: {} bytes", len));
        }

        // Write magic header first
        writer.write_all(&MAGIC_HEADER).await.context("Failed to write magic header")?;
        
        // Write length
        let len_bytes = (len as u32).to_be_bytes();
        writer.write_all(&len_bytes).await.context("Failed to write message length")?;
        
        // Write payload
        writer.write_all(&payload).await.context("Failed to write message payload")?;
        writer.flush().await.context("Failed to flush")?;

        Ok(())
    }

    /// Get the current timestamp.
    fn current_timestamp() -> Timestamp {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();

        Timestamp {
            seconds: now.as_secs() as i64,
            nanos: now.subsec_nanos() as i32,
        }
    }

    /// Manager for tracking agent connections across multiple VMs.
    pub struct AgentManager {
        clients: Mutex<HashMap<String, AgentClient>>,
        telemetry_tx: mpsc::Sender<(String, TelemetryReport)>,
    }

    impl AgentManager {
        /// Create a new agent manager.
        pub fn new() -> (Self, mpsc::Receiver<(String, TelemetryReport)>) {
            let (tx, rx) = mpsc::channel(100);
            (
                Self {
                    clients: Mutex::new(HashMap::new()),
                    telemetry_tx: tx,
                },
                rx,
            )
        }

        /// Get or create an agent client for a VM.
        pub async fn get_client(&self, vm_id: &str) -> Result<()> {
            let mut clients = self.clients.lock().await;

            if clients.contains_key(vm_id) {
                return Ok(());
            }

            let (telemetry_tx, mut telemetry_rx) = mpsc::channel::<TelemetryReport>(10);
            let vm_id_str = vm_id.to_string();
            let mut client = AgentClient::new(&vm_id_str).with_telemetry_channel(telemetry_tx);

            if client.socket_exists() {
                client.connect().await?;

                let vm_id_for_spawn = vm_id_str.clone();
                let manager_tx = self.telemetry_tx.clone();
                tokio::spawn(async move {
                    while let Some(report) = telemetry_rx.recv().await {
                        if manager_tx.send((vm_id_for_spawn.clone(), report)).await.is_err() {
                            break;
                        }
                    }
                });

                clients.insert(vm_id_str, client);
            }

            Ok(())
        }

        /// Execute a command on a VM.
        pub async fn execute(
            &self,
            vm_id: &str,
            command: &str,
            timeout_secs: u32,
        ) -> Result<ExecuteResponse> {
            let clients = self.clients.lock().await;
            let client = clients
                .get(vm_id)
                .ok_or_else(|| anyhow!("Agent not connected for VM: {}", vm_id))?;

            client.execute(command, timeout_secs).await
        }

        /// Check if an agent is available for a VM.
        pub async fn is_available(&self, vm_id: &str) -> bool {
            let clients = self.clients.lock().await;
            if let Some(client) = clients.get(vm_id) {
                client.is_connected()
            } else {
                let client = AgentClient::new(vm_id);
                client.socket_exists()
            }
        }

        /// Remove a client when a VM is stopped.
        pub async fn remove_client(&self, vm_id: &str) {
            let mut clients = self.clients.lock().await;
            if let Some(mut client) = clients.remove(vm_id) {
                client.disconnect().await;
            }
        }
    }

    impl Default for AgentManager {
        fn default() -> Self {
            Self::new().0
        }
    }
}

// ============================================================================
// NON-UNIX STUB IMPLEMENTATION
// ============================================================================

#[cfg(not(unix))]
mod stub_impl {
    use super::*;
    use limiquantix_proto::agent::{
        PongResponse, ShutdownResponse,
        QuiesceFilesystemsResponse, ThawFilesystemsResponse, SyncTimeResponse,
    };
    use tracing::warn;

    /// Guest Agent Client stub for non-Unix platforms.
    pub struct AgentClient {
        vm_id: String,
        socket_path: PathBuf,
    }

    impl AgentClient {
        pub fn new(vm_id: impl Into<String>) -> Self {
            let vm_id = vm_id.into();
            let socket_path = PathBuf::from(format!("{}/{}.agent.sock", SOCKET_BASE_PATH, vm_id));
            Self { vm_id, socket_path }
        }

        pub fn with_socket_path(vm_id: impl Into<String>, socket_path: PathBuf) -> Self {
            Self {
                vm_id: vm_id.into(),
                socket_path,
            }
        }

        pub fn with_telemetry_channel(self, _tx: mpsc::Sender<TelemetryReport>) -> Self {
            self
        }

        pub fn socket_exists(&self) -> bool {
            false // Unix sockets don't exist on Windows
        }

        pub async fn connect(&mut self) -> Result<()> {
            warn!(vm_id = %self.vm_id, "Guest agent not supported on this platform");
            Err(anyhow!("Guest agent requires Unix sockets (Linux/macOS)"))
        }

        pub async fn disconnect(&mut self) {}

        pub fn is_connected(&self) -> bool {
            false
        }

        pub async fn ping(&self) -> Result<PongResponse> {
            Err(anyhow!("Guest agent not supported on this platform"))
        }

        pub async fn ping_with_timeout(&self, _timeout: Duration) -> Result<PongResponse> {
            Err(anyhow!("Guest agent not supported on this platform"))
        }

        pub async fn execute(&self, _command: &str, _timeout_secs: u32) -> Result<ExecuteResponse> {
            Err(anyhow!("Guest agent not supported on this platform"))
        }

        pub async fn execute_full(&self, _req: ExecuteRequest) -> Result<ExecuteResponse> {
            Err(anyhow!("Guest agent not supported on this platform"))
        }

        pub async fn read_file(&self, _path: &str) -> Result<Vec<u8>> {
            Err(anyhow!("Guest agent not supported on this platform"))
        }

        pub async fn write_file(&self, _path: &str, _data: &[u8], _mode: u32) -> Result<()> {
            Err(anyhow!("Guest agent not supported on this platform"))
        }

        pub async fn shutdown(&self, _reboot: bool) -> Result<ShutdownResponse> {
            Err(anyhow!("Guest agent not supported on this platform"))
        }

        pub async fn quiesce_filesystems(
            &self,
            _mount_points: Vec<String>,
            _timeout_seconds: u32,
            _run_pre_freeze_scripts: bool,
        ) -> Result<QuiesceFilesystemsResponse> {
            Err(anyhow!("Guest agent not supported on this platform"))
        }

        pub async fn thaw_filesystems(
            &self,
            _quiesce_token: Option<String>,
            _run_post_thaw_scripts: bool,
        ) -> Result<ThawFilesystemsResponse> {
            Err(anyhow!("Guest agent not supported on this platform"))
        }

        pub async fn sync_time(&self, _force: bool) -> Result<SyncTimeResponse> {
            Err(anyhow!("Guest agent not supported on this platform"))
        }
    }

    /// Agent Manager stub for non-Unix platforms.
    pub struct AgentManager {
        _marker: std::marker::PhantomData<()>,
    }

    impl AgentManager {
        pub fn new() -> (Self, mpsc::Receiver<(String, TelemetryReport)>) {
            let (_tx, rx) = mpsc::channel(1);
            (
                Self {
                    _marker: std::marker::PhantomData,
                },
                rx,
            )
        }

        pub async fn get_client(&self, vm_id: &str) -> Result<()> {
            warn!(vm_id = %vm_id, "Guest agent not supported on this platform");
            Ok(())
        }

        pub async fn execute(
            &self,
            _vm_id: &str,
            _command: &str,
            _timeout_secs: u32,
        ) -> Result<ExecuteResponse> {
            Err(anyhow!("Guest agent not supported on this platform"))
        }

        pub async fn is_available(&self, _vm_id: &str) -> bool {
            false
        }

        pub async fn remove_client(&self, _vm_id: &str) {}
    }

    impl Default for AgentManager {
        fn default() -> Self {
            Self::new().0
        }
    }
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

#[cfg(unix)]
pub use unix_impl::{AgentClient, AgentManager};

#[cfg(not(unix))]
pub use stub_impl::{AgentClient, AgentManager};
