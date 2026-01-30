//! # Quantix KVM Guest Agent
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
//!
//! ## Architecture
//! The agent uses a **Supervisor Loop** pattern to ensure resilience:
//! - If the connection drops (host disconnects), it reconnects automatically
//! - If telemetry fails repeatedly, the entire connection is reset
//! - The process never dies due to connection issues, only on shutdown signals

use anyhow::{Context, Result};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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

/// Global health state (persists across reconnections)
pub struct HealthState {
    /// Last successful telemetry timestamp (unix millis)
    pub last_telemetry_success: AtomicU64,
    /// Agent start time
    pub start_time: Instant,
    /// Number of messages processed
    pub messages_processed: AtomicU64,
    /// Number of errors
    pub error_count: AtomicU64,
    /// Number of reconnections
    pub reconnection_count: AtomicU64,
}

impl HealthState {
    fn new() -> Self {
        Self {
            last_telemetry_success: AtomicU64::new(0),
            start_time: Instant::now(),
            messages_processed: AtomicU64::new(0),
            error_count: AtomicU64::new(0),
            reconnection_count: AtomicU64::new(0),
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

    fn record_reconnection(&self) {
        self.reconnection_count.fetch_add(1, Ordering::SeqCst);
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
        "Quantix KVM Guest Agent starting"
    );

    debug!(?config, "Configuration loaded");

    // Initialize health state ONCE (persists across reconnections)
    let health = Arc::new(HealthState::new());

    // Start health check loop (runs independently of connection)
    if config.health.enabled {
        let health_clone = health.clone();
        let health_interval = config.health.interval_secs;
        let telemetry_timeout = config.health.telemetry_timeout_secs;
        tokio::spawn(async move {
            health_check_loop(health_clone, health_interval, telemetry_timeout).await;
        });
    }

    // Setup shutdown signal handler
    let shutdown_requested = Arc::new(AtomicBool::new(false));
    let shutdown_flag = shutdown_requested.clone();
    tokio::spawn(async move {
        if let Err(e) = wait_for_shutdown_signal().await {
            error!(error = %e, "Shutdown signal handler failed");
        }
        shutdown_flag.store(true, Ordering::SeqCst);
    });

    // ========================================================================
    // SUPERVISOR LOOP - The core resilience pattern
    // ========================================================================
    // This loop ensures the agent stays alive and reconnects on failures:
    // - If the host disconnects, we reconnect
    // - If telemetry fails repeatedly, we reset the connection
    // - Only shutdown signals cause the process to exit
    // ========================================================================
    
    let mut reconnect_delay = Duration::from_secs(1);
    const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(30);
    const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(1);

    loop {
        // Check if shutdown was requested
        if shutdown_requested.load(Ordering::SeqCst) {
            info!("Shutdown signal received. Exiting agent gracefully.");
            break;
        }

        info!(
            reconnections = health.reconnection_count.load(Ordering::SeqCst),
            "Attempting to connect to host..."
        );

        // 1. Connect to virtio-serial device
        let device_path = config.get_device_path();
        let transport = match AgentTransport::connect_with_path(&device_path).await {
            Ok(t) => {
                info!(device_path = %device_path, "Connected to host via virtio-serial");
                reconnect_delay = INITIAL_RECONNECT_DELAY; // Reset backoff on success
                t
            }
            Err(e) => {
                error!(
                    error = %e,
                    device_path = %device_path,
                    retry_in_secs = reconnect_delay.as_secs(),
                    "Failed to connect to virtio-serial device"
                );
                tokio::time::sleep(reconnect_delay).await;
                // Exponential backoff
                reconnect_delay = (reconnect_delay * 2).min(MAX_RECONNECT_DELAY);
                continue;
            }
        };

        // 2. Setup resources for this connection
        let (reader, writer) = transport.split();
        let writer = Arc::new(Mutex::new(writer));
        let handler = Arc::new(MessageHandler::new(config.clone()));
        let telemetry = TelemetryCollector::new();

        // 3. Send AgentReady event (handshake)
        if let Err(e) = send_agent_ready(&writer, &telemetry, &config).await {
            error!(error = %e, "Failed to send AgentReady - reconnecting...");
            health.record_error();
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        }

        // 4. Run tasks in parallel using tokio::select!
        // This is the KEY FIX: If EITHER task fails, BOTH are cancelled and we reconnect
        let telemetry_writer = writer.clone();
        let telemetry_health = health.clone();
        let telemetry_interval = config.telemetry_interval_secs;
        
        let read_handler = handler.clone();
        let read_writer = writer.clone();
        let read_health = health.clone();
        let shutdown_check = shutdown_requested.clone();

        let connection_result = tokio::select! {
            // Task A: Telemetry Loop
            res = telemetry_loop(telemetry, telemetry_writer, telemetry_interval, telemetry_health) => {
                match &res {
                    Ok(_) => warn!("Telemetry loop finished unexpectedly (should run forever)"),
                    Err(e) => error!(error = %e, "Telemetry loop failed - triggering reconnect"),
                }
                res.map(|_| "telemetry")
            }
            
            // Task B: Message Read Loop
            res = run_message_loop(reader, read_writer, read_handler, read_health) => {
                match &res {
                    Ok(_) => info!("Connection closed by host (EOF)"),
                    Err(e) => error!(error = %e, "Read loop failed - triggering reconnect"),
                }
                res.map(|_| "read_loop")
            }

            // Task C: Periodic shutdown check (every 5 seconds)
            _ = async {
                loop {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    if shutdown_check.load(Ordering::SeqCst) {
                        break;
                    }
                }
            } => {
                info!("Shutdown signal detected during connection");
                Ok("shutdown")
            }
        };

        // 5. Connection ended - either failure or shutdown
        // Resources (transport, writer, reader) are automatically dropped here
        
        match connection_result {
            Ok("shutdown") => {
                info!("Shutting down agent");
                break;
            }
            Ok(task_name) => {
                info!(task = task_name, "Connection ended normally");
            }
            Err(_) => {
                health.record_error();
            }
        }

        // Record reconnection attempt
        health.record_reconnection();
        
        warn!(
            reconnect_delay_secs = reconnect_delay.as_secs(),
            total_reconnections = health.reconnection_count.load(Ordering::SeqCst),
            "Connection lost or reset. Reconnecting..."
        );
        
        tokio::time::sleep(reconnect_delay).await;
        // Apply backoff for repeated failures
        reconnect_delay = (reconnect_delay * 2).min(MAX_RECONNECT_DELAY);
    }

    info!(
        uptime_secs = health.uptime_secs(),
        messages_processed = health.messages_processed.load(Ordering::SeqCst),
        total_reconnections = health.reconnection_count.load(Ordering::SeqCst),
        "Quantix KVM Guest Agent stopped"
    );

    Ok(())
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

    // Use timeout to prevent blocking forever on initial write
    let write_timeout = Duration::from_secs(10);
    let mut guard = writer.lock().await;
    
    match tokio::time::timeout(write_timeout, write_message(&mut *guard, &ready_event)).await {
        Ok(Ok(())) => {
            info!(
                capabilities = get_capabilities().len(),
                version = env!("CARGO_PKG_VERSION"),
                "Sent AgentReady event to host"
            );
            Ok(())
        }
        Ok(Err(e)) => {
            Err(e).context("Failed to send AgentReady event")
        }
        Err(_) => {
            Err(anyhow::anyhow!("Timeout sending AgentReady event - host may not be reading"))
        }
    }
}

/// Telemetry reporting loop with write timeout, error tracking, and recovery.
/// 
/// Handles write failures gracefully by:
/// 1. Using a timeout to prevent indefinite blocking on writes
/// 2. Tracking consecutive failures to detect connection issues
/// 3. Logging detailed error information for debugging
/// 4. **Returning Err when failures exceed threshold** to trigger reconnection
/// 
/// Returns `Err` when too many consecutive failures occur, signaling the supervisor
/// loop to tear down this connection and reconnect.
async fn telemetry_loop<W: AsyncWriteExt + Unpin + Send + 'static>(
    collector: TelemetryCollector,
    writer: Arc<Mutex<W>>,
    interval_secs: u64,
    health: Arc<HealthState>,
) -> Result<()> {
    use limiquantix_proto::agent::{agent_message, AgentMessage};
    use prost_types::Timestamp;
    use std::time::{SystemTime, UNIX_EPOCH};

    // Configuration for write timeout and error handling
    const WRITE_TIMEOUT_SECS: u64 = 5;
    const MAX_CONSECUTIVE_FAILURES: u32 = 10;
    const RECONNECT_THRESHOLD: u32 = 50;  // Trigger reconnect after this many failures
    const FAILURE_BACKOFF_SECS: u64 = 2;
    
    let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));
    let mut consecutive_failures: u32 = 0;

    info!(
        interval_secs = interval_secs,
        reconnect_threshold = RECONNECT_THRESHOLD,
        "Telemetry loop started"
    );

    loop {
        interval.tick().await;

        // If we've had way too many failures, signal for reconnection
        if consecutive_failures >= RECONNECT_THRESHOLD {
            error!(
                consecutive_failures = consecutive_failures,
                "Telemetry write failures exceeded reconnection threshold - requesting device reconnect"
            );
            return Err(anyhow::anyhow!(
                "Too many consecutive write failures ({}), device may need reconnection",
                consecutive_failures
            ));
        }

        // If we've had too many consecutive failures, add extra backoff
        // This prevents flooding logs and gives the host time to recover
        if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
            warn!(
                consecutive_failures = consecutive_failures,
                backoff_secs = FAILURE_BACKOFF_SECS,
                "Telemetry write failures exceeded threshold, backing off"
            );
            tokio::time::sleep(Duration::from_secs(FAILURE_BACKOFF_SECS)).await;
        }

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

        // Send telemetry report with timeout
        // CRITICAL: Use a scoped block to ensure the mutex guard is dropped IMMEDIATELY
        // after the write operation completes (or times out). This prevents deadlock
        // if the timeout fires while the write is stuck in kernel space.
        let write_result = {
            let mut guard = writer.lock().await;
            let write_timeout = Duration::from_secs(WRITE_TIMEOUT_SECS);
            let result = tokio::time::timeout(write_timeout, write_message(&mut *guard, &message)).await;
            // Guard is dropped here at end of block, BEFORE we process the result
            drop(guard);
            result
        };
        
        match write_result {
            Ok(Ok(())) => {
                // Success
                if consecutive_failures > 0 {
                    info!(
                        previous_failures = consecutive_failures,
                        "Telemetry write recovered after failures"
                    );
                }
                consecutive_failures = 0;
                health.record_telemetry_success();
            }
            Ok(Err(e)) => {
                // Write failed (not timeout)
                consecutive_failures += 1;
                warn!(
                    error = %e,
                    consecutive_failures = consecutive_failures,
                    "Failed to send telemetry report"
                );
                health.record_error();
            }
            Err(_timeout) => {
                // FATAL: Write timed out - stream is now CORRUPTED!
                // 
                // When tokio::time::timeout cancels the write future, it may leave a partial
                // message on the stream (e.g., just the magic header without the length/payload).
                // Any subsequent writes will be misaligned, causing the host to see garbage
                // and enter a resync loop.
                //
                // The ONLY safe recovery is to close the stream and reconnect.
                error!(
                    timeout_secs = WRITE_TIMEOUT_SECS,
                    "FATAL: Telemetry write timed out - stream is corrupted, forcing reconnect"
                );
                health.record_error();
                
                // Return error to trigger supervisor reconnection
                return Err(anyhow::anyhow!(
                    "Write timeout corrupted stream - reconnection required"
                ));
            }
        }
    }
}

/// Health check loop (runs independently of connection)
async fn health_check_loop(health: Arc<HealthState>, interval_secs: u64, telemetry_timeout_secs: u64) {
    let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));

    loop {
        interval.tick().await;

        let uptime = health.uptime_secs();
        let messages = health.messages_processed.load(Ordering::SeqCst);
        let errors = health.error_count.load(Ordering::SeqCst);
        let reconnections = health.reconnection_count.load(Ordering::SeqCst);
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
                reconnections = reconnections,
                telemetry_age_secs = telemetry_age_secs,
                "Health check: OK"
            );
        } else {
            warn!(
                uptime_secs = uptime,
                messages_processed = messages,
                errors = errors,
                reconnections = reconnections,
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

    info!("Message read loop started");

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
                // Connection closed by host (EOF)
                info!("Host closed the connection (EOF)");
                return Ok(());
            }
            Err(e) => {
                // Read error - could be transient or fatal
                error!(error = %e, "Failed to read message from host");
                health.record_error();
                return Err(e);
            }
        }
    }
}

/// Wait for shutdown signal (SIGTERM, SIGINT, or Ctrl+C)
async fn wait_for_shutdown_signal() -> Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};

        let mut sigterm = signal(SignalKind::terminate())?;
        let mut sigint = signal(SignalKind::interrupt())?;

        tokio::select! {
            _ = sigterm.recv() => {
                info!("Received SIGTERM");
            }
            _ = sigint.recv() => {
                info!("Received SIGINT");
            }
        }
    }

    #[cfg(windows)]
    {
        tokio::signal::ctrl_c().await?;
        info!("Received Ctrl+C");
    }

    Ok(())
}
