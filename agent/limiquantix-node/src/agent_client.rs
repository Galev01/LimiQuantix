//! Guest Agent Client
//!
//! This module provides a client for communicating with the LimiQuantix Guest Agent
//! running inside VMs via virtio-serial (Unix sockets on the host).

use anyhow::{anyhow, Context, Result};
use limiquantix_proto::agent::{
    agent_message, AgentMessage, ExecuteRequest, ExecuteResponse, FileReadRequest,
    FileReadResponse, FileWriteRequest, FileWriteResponse, PingRequest, PongResponse,
    ShutdownRequest, ShutdownResponse, TelemetryReport,
};
use prost::Message;
use prost_types::Timestamp;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, oneshot, Mutex};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Maximum message size (16 MB)
const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;

/// Default timeout for agent operations
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Base path for VM agent sockets
const SOCKET_BASE_PATH: &str = "/var/run/limiquantix/vms";

/// Pending request waiting for a response
struct PendingRequest {
    response_tx: oneshot::Sender<AgentMessage>,
}

/// Guest Agent Client for communicating with a specific VM's agent.
pub struct AgentClient {
    vm_id: String,
    socket_path: PathBuf,
    stream: Option<Arc<Mutex<UnixStream>>>,
    pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
    telemetry_tx: Option<mpsc::Sender<TelemetryReport>>,
}

impl AgentClient {
    /// Create a new agent client for the given VM.
    pub fn new(vm_id: impl Into<String>) -> Self {
        let vm_id = vm_id.into();
        let socket_path = PathBuf::from(format!("{}/{}.agent.sock", SOCKET_BASE_PATH, vm_id));

        Self {
            vm_id,
            socket_path,
            stream: None,
            pending: Arc::new(Mutex::new(HashMap::new())),
            telemetry_tx: None,
        }
    }

    /// Create a new agent client with a custom socket path.
    pub fn with_socket_path(vm_id: impl Into<String>, socket_path: PathBuf) -> Self {
        Self {
            vm_id: vm_id.into(),
            socket_path,
            stream: None,
            pending: Arc::new(Mutex::new(HashMap::new())),
            telemetry_tx: None,
        }
    }

    /// Set a channel to receive telemetry updates.
    pub fn with_telemetry_channel(mut self, tx: mpsc::Sender<TelemetryReport>) -> Self {
        self.telemetry_tx = Some(tx);
        self
    }

    /// Check if the agent socket exists.
    pub fn socket_exists(&self) -> bool {
        self.socket_path.exists()
    }

    /// Connect to the agent.
    pub async fn connect(&mut self) -> Result<()> {
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

        let stream = UnixStream::connect(&self.socket_path)
            .await
            .with_context(|| {
                format!(
                    "Failed to connect to agent socket: {}",
                    self.socket_path.display()
                )
            })?;

        let stream = Arc::new(Mutex::new(stream));
        self.stream = Some(stream.clone());

        // Start the response handler
        let pending = self.pending.clone();
        let telemetry_tx = self.telemetry_tx.clone();
        let vm_id = self.vm_id.clone();

        tokio::spawn(async move {
            if let Err(e) = response_handler(stream, pending, telemetry_tx, vm_id).await {
                error!(error = %e, "Response handler error");
            }
        });

        info!(vm_id = %self.vm_id, "Connected to guest agent");
        Ok(())
    }

    /// Disconnect from the agent.
    pub async fn disconnect(&mut self) {
        self.stream = None;
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
    pub async fn execute(
        &self,
        command: &str,
        timeout_secs: u32,
    ) -> Result<ExecuteResponse> {
        self.execute_full(ExecuteRequest {
            command: command.to_string(),
            args: Vec::new(),
            working_directory: String::new(),
            environment: HashMap::new(),
            timeout_seconds: timeout_secs,
            wait_for_exit: true,
            run_as_user: String::new(),
            max_output_bytes: 0,
        })
        .await
    }

    /// Execute a command with full options.
    pub async fn execute_full(&self, req: ExecuteRequest) -> Result<ExecuteResponse> {
        let timeout = Duration::from_secs(req.timeout_seconds as u64 + 5); // Add buffer

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
                    length: 0, // Read all
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

    /// Send a request and wait for a response.
    async fn send_request(
        &self,
        request: AgentMessage,
        timeout: Duration,
    ) -> Result<AgentMessage> {
        let stream = self
            .stream
            .as_ref()
            .ok_or_else(|| anyhow!("Not connected to agent"))?;

        let message_id = request.message_id.clone();

        // Create response channel
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(message_id.clone(), PendingRequest { response_tx: tx });
        }

        // Send the request
        {
            let mut stream = stream.lock().await;
            write_message(&mut *stream, &request).await?;
        }

        // Wait for response with timeout
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err(anyhow!("Response channel closed")),
            Err(_) => {
                // Remove pending request on timeout
                let mut pending = self.pending.lock().await;
                pending.remove(&message_id);
                Err(anyhow!("Request timed out"))
            }
        }
    }
}

/// Handle incoming responses from the agent.
async fn response_handler(
    stream: Arc<Mutex<UnixStream>>,
    pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
    telemetry_tx: Option<mpsc::Sender<TelemetryReport>>,
    vm_id: String,
) -> Result<()> {
    loop {
        // Read a message
        let message = {
            let mut stream = stream.lock().await;
            match read_message::<AgentMessage>(&mut *stream).await {
                Ok(Some(msg)) => msg,
                Ok(None) => {
                    info!(vm_id = %vm_id, "Agent connection closed");
                    break;
                }
                Err(e) => {
                    error!(vm_id = %vm_id, error = %e, "Failed to read message");
                    break;
                }
            }
        };

        let message_id = message.message_id.clone();

        // Handle unsolicited events
        match &message.payload {
            Some(agent_message::Payload::Telemetry(report)) => {
                debug!(vm_id = %vm_id, "Received telemetry report");
                if let Some(ref tx) = telemetry_tx {
                    if tx.send(report.clone()).await.is_err() {
                        warn!(vm_id = %vm_id, "Telemetry channel closed");
                    }
                }
                continue;
            }
            Some(agent_message::Payload::AgentReady(ready)) => {
                info!(
                    vm_id = %vm_id,
                    version = %ready.version,
                    hostname = %ready.hostname,
                    ips = ?ready.ip_addresses,
                    "Agent ready"
                );
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
            _ => {}
        }

        // Look for pending request
        let pending_req = {
            let mut pending = pending.lock().await;
            pending.remove(&message_id)
        };

        if let Some(req) = pending_req {
            if req.response_tx.send(message).is_err() {
                warn!(message_id = %message_id, "Response receiver dropped");
            }
        } else {
            debug!(message_id = %message_id, "Received response for unknown request");
        }
    }

    Ok(())
}

/// Read a length-prefixed protobuf message.
async fn read_message<M>(reader: &mut UnixStream) -> Result<Option<M>>
where
    M: Message + Default,
{
    // Read length prefix
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Ok(None);
        }
        Err(e) => {
            return Err(e).context("Failed to read message length");
        }
    }

    let len = u32::from_be_bytes(len_buf) as usize;

    if len > MAX_MESSAGE_SIZE {
        return Err(anyhow!("Message too large: {} bytes", len));
    }

    // Read payload
    let mut payload = vec![0u8; len];
    reader
        .read_exact(&mut payload)
        .await
        .context("Failed to read message payload")?;

    // Decode
    let message = M::decode(&payload[..]).context("Failed to decode message")?;

    Ok(Some(message))
}

/// Write a length-prefixed protobuf message.
async fn write_message<M>(writer: &mut UnixStream, message: &M) -> Result<()>
where
    M: Message,
{
    let payload = message.encode_to_vec();
    let len = payload.len();

    if len > MAX_MESSAGE_SIZE {
        return Err(anyhow!("Message too large: {} bytes", len));
    }

    // Write length prefix
    let len_bytes = (len as u32).to_be_bytes();
    writer
        .write_all(&len_bytes)
        .await
        .context("Failed to write message length")?;

    // Write payload
    writer
        .write_all(&payload)
        .await
        .context("Failed to write message payload")?;

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
        let mut client = AgentClient::new(vm_id).with_telemetry_channel(telemetry_tx);

        if client.socket_exists() {
            client.connect().await?;

            // Forward telemetry to manager's channel
            let vm_id = vm_id.to_string();
            let manager_tx = self.telemetry_tx.clone();
            tokio::spawn(async move {
                while let Some(report) = telemetry_rx.recv().await {
                    if manager_tx.send((vm_id.clone(), report)).await.is_err() {
                        break;
                    }
                }
            });

            clients.insert(vm_id.to_string(), client);
        }

        Ok(())
    }

    /// Execute a command on a VM.
    pub async fn execute(&self, vm_id: &str, command: &str, timeout_secs: u32) -> Result<ExecuteResponse> {
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
            client.stream.is_some()
        } else {
            // Check if socket exists
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
