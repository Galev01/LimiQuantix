//! Transport layer for virtio-serial communication.
//!
//! This module handles connecting to the virtio-serial device
//! exposed by QEMU/KVM for host-guest communication.

use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;
use std::time::Duration;
use tokio::fs::OpenOptions;
use tokio::io::{AsyncRead, AsyncWrite, ReadHalf, WriteHalf};
use tracing::{debug, info, warn};

/// Known device paths for the LimiQuantix agent channel
#[cfg(unix)]
const DEVICE_PATHS: &[&str] = &[
    "/dev/virtio-ports/org.limiquantix.agent.0",
    "/dev/vport0p1",
    "/dev/vport1p1",
];

/// Device name pattern for Windows
#[cfg(windows)]
const DEVICE_NAME: &str = r"\\.\Global\org.limiquantix.agent.0";

/// Wrapper around the virtio-serial file handle
pub struct AgentTransport {
    inner: tokio::fs::File,
}

impl AgentTransport {
    /// Connect to the virtio-serial device.
    ///
    /// This function will wait for the device to appear, with exponential backoff.
    pub async fn connect() -> Result<Self> {
        Self::connect_with_timeout(Duration::from_secs(60)).await
    }

    /// Connect with a custom timeout.
    pub async fn connect_with_timeout(timeout: Duration) -> Result<Self> {
        let device_path = wait_for_device(timeout).await?;
        Self::open(&device_path).await
    }

    /// Connect to a specific device path.
    ///
    /// If the path is "auto", uses the default device discovery.
    pub async fn connect_with_path(path: &str) -> Result<Self> {
        if path == "auto" {
            return Self::connect().await;
        }

        let device_path = PathBuf::from(path);
        
        // Wait for the specific device with timeout
        let timeout = Duration::from_secs(60);
        let start = std::time::Instant::now();
        let mut backoff = Duration::from_millis(100);
        let max_backoff = Duration::from_secs(5);

        loop {
            if device_path.exists() || Self::try_open_device(&device_path) {
                return Self::open(&device_path).await;
            }

            if start.elapsed() >= timeout {
                return Err(anyhow!(
                    "Timeout waiting for virtio-serial device: {}",
                    path
                ));
            }

            warn!(
                path = %path,
                elapsed = ?start.elapsed(),
                "Waiting for specified virtio-serial device..."
            );
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(max_backoff);
        }
    }

    /// Try to open a device to check if it exists (Windows workaround)
    fn try_open_device(path: &PathBuf) -> bool {
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .is_ok()
    }

    /// Open a specific device path.
    async fn open(path: &PathBuf) -> Result<Self> {
        info!(path = %path.display(), "Opening virtio-serial device");

        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .await
            .with_context(|| format!("Failed to open device: {}", path.display()))?;

        info!(path = %path.display(), "Successfully opened virtio-serial device");

        Ok(Self { inner: file })
    }

    /// Split the transport into read and write halves.
    pub fn split(self) -> (ReadHalf<tokio::fs::File>, WriteHalf<tokio::fs::File>) {
        tokio::io::split(self.inner)
    }
}

impl AsyncRead for AgentTransport {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for AgentTransport {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<Result<usize, std::io::Error>> {
        std::pin::Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), std::io::Error>> {
        std::pin::Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), std::io::Error>> {
        std::pin::Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

/// Wait for the virtio-serial device to appear.
///
/// Uses exponential backoff to avoid busy-waiting.
#[cfg(unix)]
async fn wait_for_device(timeout: Duration) -> Result<PathBuf> {
    use tokio::time::{interval, Instant};

    let start = Instant::now();
    let mut check_interval = interval(Duration::from_millis(100));
    let mut backoff = Duration::from_millis(100);
    let max_backoff = Duration::from_secs(5);

    loop {
        check_interval.tick().await;

        // Check each known device path
        for path_str in DEVICE_PATHS {
            let path = PathBuf::from(path_str);
            if path.exists() {
                debug!(path = %path.display(), "Found virtio-serial device");
                return Ok(path);
            }
        }

        // Check if timeout exceeded
        if start.elapsed() >= timeout {
            return Err(anyhow!(
                "Timeout waiting for virtio-serial device. Checked paths: {:?}",
                DEVICE_PATHS
            ));
        }

        // Exponential backoff
        warn!(
            elapsed = ?start.elapsed(),
            timeout = ?timeout,
            "Waiting for virtio-serial device..."
        );
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(max_backoff);
    }
}

#[cfg(windows)]
async fn wait_for_device(timeout: Duration) -> Result<PathBuf> {
    use tokio::time::{interval, Instant};

    let start = Instant::now();
    let mut check_interval = interval(Duration::from_millis(100));
    let mut backoff = Duration::from_millis(100);
    let max_backoff = Duration::from_secs(5);

    let path = PathBuf::from(DEVICE_NAME);

    loop {
        check_interval.tick().await;

        // Try to open the device to check if it exists
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
        {
            Ok(_) => {
                debug!(path = %path.display(), "Found virtio-serial device");
                return Ok(path);
            }
            Err(_) => {
                // Device not ready yet
            }
        }

        // Check if timeout exceeded
        if start.elapsed() >= timeout {
            return Err(anyhow!(
                "Timeout waiting for virtio-serial device: {}",
                DEVICE_NAME
            ));
        }

        // Exponential backoff
        warn!(
            elapsed = ?start.elapsed(),
            timeout = ?timeout,
            "Waiting for virtio-serial device..."
        );
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(max_backoff);
    }
}

/// Find the agent device without waiting.
///
/// Returns `None` if the device is not found.
#[cfg(unix)]
pub fn find_device() -> Option<PathBuf> {
    for path_str in DEVICE_PATHS {
        let path = PathBuf::from(path_str);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

#[cfg(windows)]
pub fn find_device() -> Option<PathBuf> {
    let path = PathBuf::from(DEVICE_NAME);
    if std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .is_ok()
    {
        Some(path)
    } else {
        None
    }
}
