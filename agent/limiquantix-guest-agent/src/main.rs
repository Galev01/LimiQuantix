//! # LimiQuantix Guest Agent
//!
//! A lightweight agent that runs inside guest VMs to enable deep integration
//! with the hypervisor host via virtio-serial communication.
//!
//! ## Features
//! - **Telemetry**: Report real RAM/Disk usage, CPU, network interfaces
//! - **Execution**: Run scripts/commands inside the VM
//! - **File Transfer**: Push/Pull files without SSH
//! - **Lifecycle**: Clean shutdown, password reset, IP reporting
//!
//! ## Communication
//! Uses virtio-serial (paravirtualized serial port) with length-prefixed protobuf.

use anyhow::{Context, Result};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tracing::{error, info, warn};

mod handlers;
mod protocol;
mod telemetry;
mod transport;

use crate::handlers::MessageHandler;
use crate::protocol::{read_message, write_message};
use crate::telemetry::TelemetryCollector;
use crate::transport::AgentTransport;

/// Agent configuration
#[derive(Debug, Clone)]
pub struct AgentConfig {
    /// Telemetry reporting interval in seconds
    pub telemetry_interval_secs: u64,
    /// Maximum command execution timeout in seconds
    pub max_exec_timeout_secs: u32,
    /// Maximum file chunk size in bytes
    pub max_chunk_size: usize,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            telemetry_interval_secs: 5,
            max_exec_timeout_secs: 300, // 5 minutes
            max_chunk_size: 65536,      // 64KB
        }
    }
}

/// Initialize tracing/logging
fn init_logging() {
    use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,limiquantix_guest_agent=debug"));

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().json())
        .init();
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    init_logging();

    info!(
        version = env!("CARGO_PKG_VERSION"),
        "LimiQuantix Guest Agent starting"
    );

    // Load configuration
    let config = AgentConfig::default();
    info!(?config, "Configuration loaded");

    // Wait for and open the virtio-serial device
    let transport = AgentTransport::connect()
        .await
        .context("Failed to connect to host")?;

    info!("Connected to host via virtio-serial");

    // Split the transport for reading and writing
    let (reader, writer) = transport.split();
    let writer = Arc::new(Mutex::new(writer));

    // Create message handler
    let handler = Arc::new(MessageHandler::new(config.clone()));

    // Create telemetry collector
    let telemetry = TelemetryCollector::new();

    // Send agent ready event
    send_agent_ready(&writer, &telemetry).await?;

    // Start telemetry loop (background task)
    let telemetry_writer = writer.clone();
    let telemetry_interval = config.telemetry_interval_secs;
    tokio::spawn(async move {
        if let Err(e) = telemetry_loop(telemetry, telemetry_writer, telemetry_interval).await {
            error!(error = %e, "Telemetry loop failed");
        }
    });

    // Handle shutdown signals
    let shutdown_writer = writer.clone();
    tokio::spawn(async move {
        if let Err(e) = handle_shutdown_signal(shutdown_writer).await {
            error!(error = %e, "Shutdown handler failed");
        }
    });

    // Main message loop
    run_message_loop(reader, writer, handler).await
}

/// Send the AgentReady event to the host
async fn send_agent_ready<W: AsyncWriteExt + Unpin>(
    writer: &Arc<Mutex<W>>,
    telemetry: &TelemetryCollector,
) -> Result<()> {
    use limiquantix_proto::agent::{agent_message, AgentMessage, AgentReadyEvent};
    use prost_types::Timestamp;
    use std::time::{SystemTime, UNIX_EPOCH};

    let sys_info = telemetry.get_system_info();
    let ips = telemetry.get_ip_addresses();

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();

    let ready_event = AgentMessage {
        message_id: uuid::Uuid::new_v4().to_string(),
        timestamp: Some(Timestamp {
            seconds: now.as_secs() as i64,
            nanos: now.subsec_nanos() as i32,
        }),
        payload: Some(agent_message::Payload::AgentReady(AgentReadyEvent {
            version: env!("CARGO_PKG_VERSION").to_string(),
            os_name: sys_info.os_name,
            os_version: sys_info.os_version,
            kernel_version: sys_info.kernel_version,
            architecture: sys_info.architecture,
            hostname: sys_info.hostname,
            ip_addresses: ips,
            capabilities: vec![
                "telemetry".to_string(),
                "execute".to_string(),
                "file_read".to_string(),
                "file_write".to_string(),
                "shutdown".to_string(),
                "reset_password".to_string(),
            ],
        })),
    };

    let mut guard = writer.lock().await;
    write_message(&mut *guard, &ready_event)
        .await
        .context("Failed to send AgentReady event")?;

    info!("Sent AgentReady event to host");
    Ok(())
}

/// Telemetry reporting loop
async fn telemetry_loop<W: AsyncWriteExt + Unpin>(
    collector: TelemetryCollector,
    writer: Arc<Mutex<W>>,
    interval_secs: u64,
) -> Result<()> {
    use limiquantix_proto::agent::{agent_message, AgentMessage};
    use prost_types::Timestamp;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));

    loop {
        interval.tick().await;

        // Collect telemetry
        let report = collector.collect();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();

        let message = AgentMessage {
            message_id: uuid::Uuid::new_v4().to_string(),
            timestamp: Some(Timestamp {
                seconds: now.as_secs() as i64,
                nanos: now.subsec_nanos() as i32,
            }),
            payload: Some(agent_message::Payload::Telemetry(report)),
        };

        // Send telemetry report
        let mut guard = writer.lock().await;
        if let Err(e) = write_message(&mut *guard, &message).await {
            warn!(error = %e, "Failed to send telemetry report");
            // Continue running, don't fail the loop
        }
    }
}

/// Main message processing loop
async fn run_message_loop<R, W>(
    mut reader: R,
    writer: Arc<Mutex<W>>,
    handler: Arc<MessageHandler>,
) -> Result<()>
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin + Send + 'static,
{
    use limiquantix_proto::agent::AgentMessage;

    info!("Starting message loop");

    loop {
        // Read incoming message
        match read_message::<_, AgentMessage>(&mut reader).await {
            Ok(Some(message)) => {
                let msg_id = message.message_id.clone();
                info!(message_id = %msg_id, "Received message from host");

                // Handle the message
                let handler = handler.clone();
                let writer = writer.clone();

                tokio::spawn(async move {
                    match handler.handle(message).await {
                        Ok(Some(response)) => {
                            let mut guard = writer.lock().await;
                            if let Err(e) = write_message(&mut *guard, &response).await {
                                error!(error = %e, message_id = %msg_id, "Failed to send response");
                            }
                        }
                        Ok(None) => {
                            // No response needed
                        }
                        Err(e) => {
                            error!(error = %e, message_id = %msg_id, "Failed to handle message");
                        }
                    }
                });
            }
            Ok(None) => {
                // Connection closed
                info!("Connection closed by host");
                break;
            }
            Err(e) => {
                error!(error = %e, "Failed to read message");
                // Small delay before retrying
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
        }
    }

    Ok(())
}

/// Handle shutdown signals (SIGTERM, SIGINT)
async fn handle_shutdown_signal<W: AsyncWriteExt + Unpin>(
    _writer: Arc<Mutex<W>>,
) -> Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};

        let mut sigterm = signal(SignalKind::terminate())?;
        let mut sigint = signal(SignalKind::interrupt())?;

        tokio::select! {
            _ = sigterm.recv() => {
                info!("Received SIGTERM, shutting down");
            }
            _ = sigint.recv() => {
                info!("Received SIGINT, shutting down");
            }
        }
    }

    #[cfg(windows)]
    {
        tokio::signal::ctrl_c().await?;
        info!("Received Ctrl+C, shutting down");
    }

    std::process::exit(0);
}
