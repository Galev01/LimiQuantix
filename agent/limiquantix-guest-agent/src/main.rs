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
//! - **Desktop Integration**: Display resize, clipboard sharing
//!
//! ## Communication
//! Uses virtio-serial (paravirtualized serial port) with length-prefixed protobuf.

use anyhow::{Context, Result};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

pub mod config;
pub mod error;
mod handlers;
mod protocol;
pub mod security;
mod telemetry;
mod transport;
#[cfg(feature = "vsock")]
pub mod vsock;

pub use config::AgentConfig;
pub use error::{AgentError, AgentResult, ErrorCategory};

use crate::handlers::MessageHandler;
use crate::protocol::{read_message, write_message};
use crate::telemetry::TelemetryCollector;
use crate::transport::AgentTransport;

/// Global health state
pub struct HealthState {
    /// Last successful telemetry timestamp (unix millis)
    pub last_telemetry_success: AtomicU64,
    /// Agent start time
    pub start_time: Instant,
    /// Number of messages processed
    pub messages_processed: AtomicU64,
    /// Number of errors
    pub error_count: AtomicU64,
}

impl HealthState {
    fn new() -> Self {
        Self {
            last_telemetry_success: AtomicU64::new(0),
            start_time: Instant::now(),
            messages_processed: AtomicU64::new(0),
            error_count: AtomicU64::new(0),
        }
    }

    fn record_telemetry_success(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        self.last_telemetry_success.store(now, Ordering::SeqCst);
    }

    fn record_message_processed(&self) {
        self.messages_processed.fetch_add(1, Ordering::SeqCst);
    }

    fn record_error(&self) {
        self.error_count.fetch_add(1, Ordering::SeqCst);
    }

    fn uptime_secs(&self) -> u64 {
        self.start_time.elapsed().as_secs()
    }
}

/// Initialize tracing/logging based on configuration
fn init_logging(config: &AgentConfig) {
    use tracing_subscriber::{
        fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter,
    };

    // Build filter from config or environment
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new(format!(
            "{},limiquantix_guest_agent=debug",
            config.log_level
        ))
    });

    // If log file is configured, add file layer
    if !config.log_file.is_empty() {
        let log_path = Path::new(&config.log_file);
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        if let Some(file_name) = log_path.file_name() {
            if let Some(dir) = log_path.parent() {
                let file_appender = tracing_appender::rolling::daily(dir, file_name);
                
                if config.log_format == config::LogFormat::Json {
                    tracing_subscriber::registry()
                        .with(filter)
                        .with(fmt::layer().json())
                        .with(fmt::layer().json().with_writer(file_appender).with_ansi(false))
                        .init();
                } else {
                    tracing_subscriber::registry()
                        .with(filter)
                        .with(fmt::layer().pretty())
                        .with(fmt::layer().json().with_writer(file_appender).with_ansi(false))
                        .init();
                }
                return;
            }
        }
    }

    // Fallback: stdout only
    if config.log_format == config::LogFormat::Json {
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt::layer().json())
            .init();
    } else {
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt::layer().pretty())
            .init();
    }
}

/// Get all agent capabilities based on current build
fn get_capabilities() -> Vec<String> {
    let mut caps = vec![
        "telemetry".to_string(),
        "execute".to_string(),
        "file_read".to_string(),
        "file_write".to_string(),
        "file_list".to_string(),
        "file_delete".to_string(),
        "file_stat".to_string(),
        "directory_create".to_string(),
        "shutdown".to_string(),
        "reboot".to_string(),
        "reset_password".to_string(),
        "configure_network".to_string(),
        "quiesce".to_string(),
        "thaw".to_string(),
        "sync_time".to_string(),
        "display_resize".to_string(),
        "clipboard".to_string(),
        "process_list".to_string(),
        "process_kill".to_string(),
        "service_list".to_string(),
        "service_control".to_string(),
        "hardware_info".to_string(),
        "software_list".to_string(),
        "self_update".to_string(),
    ];

    // Platform-specific capabilities
    #[cfg(unix)]
    caps.push("user_context_exec".to_string());

    #[cfg(windows)]
    caps.push("vss_quiesce".to_string());

    caps
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load configuration first (before logging init)
    let config = AgentConfig::load();

    // Validate configuration
    if let Err(e) = config.validate() {
        eprintln!("Configuration error: {}", e);
        std::process::exit(1);
    }

    // Initialize logging with config
    init_logging(&config);

    info!(
        version = env!("CARGO_PKG_VERSION"),
        config_path = config::DEFAULT_CONFIG_PATH,
        "LimiQuantix Guest Agent starting"
    );

    debug!(?config, "Configuration loaded");

    // Initialize health state
    let health = Arc::new(HealthState::new());

    // Wait for and open the virtio-serial device
    let device_path = config.get_device_path();
    info!(device_path = %device_path, "Connecting to host");

    let transport = AgentTransport::connect_with_path(&device_path)
        .await
        .context("Failed to connect to host")?;

    info!("Connected to host via virtio-serial");

    // Split the transport for reading and writing
    let (reader, writer) = transport.split();
    let writer = Arc::new(Mutex::new(writer));

    // Create message handler with config
    let handler = Arc::new(MessageHandler::new(config.clone()));

    // Create telemetry collector
    let telemetry = TelemetryCollector::new();

    // Send agent ready event with all capabilities
    send_agent_ready(&writer, &telemetry, &config).await?;

    // Start telemetry loop (background task)
    let telemetry_writer = writer.clone();
    let telemetry_interval = config.telemetry_interval_secs;
    let telemetry_health = health.clone();
    tokio::spawn(async move {
        if let Err(e) = telemetry_loop(
            telemetry,
            telemetry_writer,
            telemetry_interval,
            telemetry_health,
        )
        .await
        {
            error!(error = %e, "Telemetry loop failed");
        }
    });

    // Start health check loop if enabled
    if config.health.enabled {
        let health_clone = health.clone();
        let health_interval = config.health.interval_secs;
        let telemetry_timeout = config.health.telemetry_timeout_secs;
        tokio::spawn(async move {
            health_check_loop(health_clone, health_interval, telemetry_timeout).await;
        });
    }

    // Handle shutdown signals
    let shutdown_writer = writer.clone();
    tokio::spawn(async move {
        if let Err(e) = handle_shutdown_signal(shutdown_writer).await {
            error!(error = %e, "Shutdown handler failed");
        }
    });

    // Main message loop
    run_message_loop(reader, writer, handler, health).await
}

/// Send the AgentReady event to the host
async fn send_agent_ready<W: AsyncWriteExt + Unpin>(
    writer: &Arc<Mutex<W>>,
    telemetry: &TelemetryCollector,
    _config: &AgentConfig,
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
            capabilities: get_capabilities(),
        })),
    };

    let mut guard = writer.lock().await;
    write_message(&mut *guard, &ready_event)
        .await
        .context("Failed to send AgentReady event")?;

    info!(
        capabilities = ?get_capabilities().len(),
        "Sent AgentReady event to host"
    );
    Ok(())
}

/// Telemetry reporting loop
async fn telemetry_loop<W: AsyncWriteExt + Unpin>(
    collector: TelemetryCollector,
    writer: Arc<Mutex<W>>,
    interval_secs: u64,
    health: Arc<HealthState>,
) -> Result<()> {
    use limiquantix_proto::agent::{agent_message, AgentMessage};
    use prost_types::Timestamp;
    use std::time::{SystemTime, UNIX_EPOCH};

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
        match write_message(&mut *guard, &message).await {
            Ok(()) => {
                health.record_telemetry_success();
            }
            Err(e) => {
                warn!(error = %e, "Failed to send telemetry report");
                health.record_error();
            }
        }
    }
}

/// Health check loop
async fn health_check_loop(health: Arc<HealthState>, interval_secs: u64, telemetry_timeout_secs: u64) {
    let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));

    loop {
        interval.tick().await;

        let uptime = health.uptime_secs();
        let messages = health.messages_processed.load(Ordering::SeqCst);
        let errors = health.error_count.load(Ordering::SeqCst);
        let last_telemetry = health.last_telemetry_success.load(Ordering::SeqCst);

        // Check if telemetry is stale
        let now_millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let telemetry_age_secs = if last_telemetry > 0 {
            (now_millis - last_telemetry) / 1000
        } else {
            0
        };

        let healthy = telemetry_age_secs < telemetry_timeout_secs || last_telemetry == 0;

        if healthy {
            debug!(
                uptime_secs = uptime,
                messages_processed = messages,
                errors = errors,
                telemetry_age_secs = telemetry_age_secs,
                "Health check: OK"
            );
        } else {
            warn!(
                uptime_secs = uptime,
                messages_processed = messages,
                errors = errors,
                telemetry_age_secs = telemetry_age_secs,
                timeout_secs = telemetry_timeout_secs,
                "Health check: DEGRADED - telemetry stale"
            );
        }
    }
}

/// Main message processing loop
async fn run_message_loop<R, W>(
    mut reader: R,
    writer: Arc<Mutex<W>>,
    handler: Arc<MessageHandler>,
    health: Arc<HealthState>,
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
                debug!(message_id = %msg_id, "Received message from host");

                health.record_message_processed();

                // Handle the message
                let handler = handler.clone();
                let writer = writer.clone();
                let health = health.clone();

                tokio::spawn(async move {
                    match handler.handle(message).await {
                        Ok(Some(response)) => {
                            let mut guard = writer.lock().await;
                            if let Err(e) = write_message(&mut *guard, &response).await {
                                error!(error = %e, message_id = %msg_id, "Failed to send response");
                                health.record_error();
                            }
                        }
                        Ok(None) => {
                            // No response needed
                        }
                        Err(e) => {
                            error!(error = %e, message_id = %msg_id, "Failed to handle message");
                            health.record_error();
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
                health.record_error();
                // Small delay before retrying
                tokio::time::sleep(Duration::from_millis(100)).await;
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
