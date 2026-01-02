//! Logging initialization using tracing.

use anyhow::Result;
use tracing_subscriber::{
    fmt,
    layer::SubscriberExt,
    util::SubscriberInitExt,
    EnvFilter,
};

/// Initialize the tracing subscriber with the specified log level.
///
/// # Arguments
/// * `level` - Log level string (trace, debug, info, warn, error)
///
/// # Example
/// ```
/// Quantixkvm_common::init_logging("info").unwrap();
/// ```
pub fn init_logging(level: &str) -> Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(level));

    let subscriber = tracing_subscriber::registry()
        .with(filter)
        .with(
            fmt::layer()
                .with_target(true)
                .with_thread_ids(true)
                .with_file(true)
                .with_line_number(true)
        );

    subscriber.init();

    Ok(())
}

/// Initialize logging with JSON output format.
/// Suitable for production environments with log aggregation.
pub fn init_logging_json(level: &str) -> Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(level));

    let subscriber = tracing_subscriber::registry()
        .with(filter)
        .with(
            fmt::layer()
                .json()
                .with_target(true)
                .with_thread_ids(true)
        );

    subscriber.init();

    Ok(())
}

