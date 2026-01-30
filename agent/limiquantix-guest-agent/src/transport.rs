//! Transport layer for virtio-serial communication.
//!
//! This module handles connecting to the virtio-serial device
//! exposed by QEMU/KVM for host-guest communication.
//!
//! IMPORTANT: Character devices (like virtio-serial) require special handling.
//! We use std::fs::File with non-blocking mode and tokio's AsyncFd for proper
//! async I/O on character devices, as tokio::fs::File doesn't work reliably with them.

use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;
use std::time::Duration;
use tracing::{debug, info, warn};

#[cfg(unix)]
use std::os::unix::io::AsRawFd;
#[cfg(unix)]
use tokio::io::unix::AsyncFd;
#[cfg(unix)]
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
#[cfg(unix)]
use std::io::{Read, Write};
#[cfg(unix)]
use std::pin::Pin;
#[cfg(unix)]
use std::task::{Context as TaskContext, Poll};

#[cfg(windows)]
use tokio::fs::OpenOptions;
#[cfg(windows)]
use tokio::io::{AsyncRead, AsyncWrite};

/// Known device paths for the Quantix KVM agent channel
#[cfg(unix)]
const DEVICE_PATHS: &[&str] = &[
    "/dev/virtio-ports/org.quantix.agent.0",
    "/dev/virtio-ports/org.limiquantix.agent.0",
    "/dev/vport0p1",
    "/dev/vport1p1",
];

#[cfg(windows)]
const DEVICE_NAME: &str = r"\\.\Global\org.quantix.agent.0";

/// Wrapper around the virtio-serial file handle
#[cfg(unix)]
pub struct AgentTransport {
    inner: AsyncFd<std::fs::File>,
}

#[cfg(windows)]
pub struct AgentTransport {
    inner: tokio::fs::File,
}

impl AgentTransport {
    /// Connect to the virtio-serial device with default timeout.
    pub async fn connect() -> Result<Self> {
        Self::connect_with_timeout(Duration::from_secs(60)).await
    }

    /// Connect with a custom timeout.
    pub async fn connect_with_timeout(timeout: Duration) -> Result<Self> {
        let device_path = wait_for_device(timeout).await?;
        Self::open(&device_path).await
    }

    /// Connect to a specific device path.
    pub async fn connect_with_path(path: &str) -> Result<Self> {
        if path == "auto" {
            return Self::connect().await;
        }

        let device_path = PathBuf::from(path);
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

    fn try_open_device(path: &PathBuf) -> bool {
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .is_ok()
    }

    #[cfg(unix)]
    async fn open(path: &PathBuf) -> Result<Self> {
        info!(path = %path.display(), "Opening virtio-serial device (AsyncFd mode)");

        // Open with std::fs::File - tokio::fs::File doesn't work with char devices
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .with_context(|| format!("Failed to open device: {}", path.display()))?;

        // Set non-blocking mode
        let fd = file.as_raw_fd();
        unsafe {
            let flags = libc::fcntl(fd, libc::F_GETFL);
            if flags == -1 {
                return Err(anyhow!("Failed to get file flags: {}", std::io::Error::last_os_error()));
            }
            if libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) == -1 {
                return Err(anyhow!("Failed to set non-blocking: {}", std::io::Error::last_os_error()));
            }
        }

        let async_fd = AsyncFd::new(file)
            .with_context(|| format!("Failed to create AsyncFd: {}", path.display()))?;

        info!(path = %path.display(), "Successfully opened virtio-serial device");
        Ok(Self { inner: async_fd })
    }

    #[cfg(windows)]
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

    /// Split into read and write halves using tokio::io::split
    pub fn split(self) -> (tokio::io::ReadHalf<Self>, tokio::io::WriteHalf<Self>) {
        tokio::io::split(self)
    }
}

// Unix AsyncRead implementation using AsyncFd
#[cfg(unix)]
impl AsyncRead for AgentTransport {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        loop {
            let mut guard = match self.inner.poll_read_ready(cx) {
                Poll::Ready(Ok(guard)) => guard,
                Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
                Poll::Pending => return Poll::Pending,
            };

            let unfilled = buf.initialize_unfilled();
            match guard.get_inner().read(unfilled) {
                Ok(0) => return Poll::Ready(Ok(())),
                Ok(n) => {
                    buf.advance(n);
                    return Poll::Ready(Ok(()));
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    guard.clear_ready();
                    continue;
                }
                Err(e) => return Poll::Ready(Err(e)),
            }
        }
    }
}

#[cfg(unix)]
impl AsyncWrite for AgentTransport {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buf: &[u8],
    ) -> Poll<Result<usize, std::io::Error>> {
        loop {
            let mut guard = match self.inner.poll_write_ready(cx) {
                Poll::Ready(Ok(guard)) => guard,
                Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
                Poll::Pending => return Poll::Pending,
            };

            match guard.get_inner().write(buf) {
                Ok(n) => return Poll::Ready(Ok(n)),
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    guard.clear_ready();
                    continue;
                }
                Err(e) => return Poll::Ready(Err(e)),
            }
        }
    }

    fn poll_flush(
        self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
    ) -> Poll<Result<(), std::io::Error>> {
        loop {
            let mut guard = match self.inner.poll_write_ready(cx) {
                Poll::Ready(Ok(guard)) => guard,
                Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
                Poll::Pending => return Poll::Pending,
            };

            match guard.get_inner().flush() {
                Ok(()) => return Poll::Ready(Ok(())),
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    guard.clear_ready();
                    continue;
                }
                Err(e) => return Poll::Ready(Err(e)),
            }
        }
    }

    fn poll_shutdown(
        self: Pin<&mut Self>,
        _cx: &mut TaskContext<'_>,
    ) -> Poll<Result<(), std::io::Error>> {
        Poll::Ready(Ok(()))
    }
}

// Windows implementations
#[cfg(windows)]
impl AsyncRead for AgentTransport {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

#[cfg(windows)]
impl AsyncWrite for AgentTransport {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> Poll<Result<usize, std::io::Error>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Result<(), std::io::Error>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Result<(), std::io::Error>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

/// Wait for the virtio-serial device to appear.
#[cfg(unix)]
async fn wait_for_device(timeout: Duration) -> Result<PathBuf> {
    use tokio::time::Instant;

    let start = Instant::now();
    let mut backoff = Duration::from_millis(100);
    let max_backoff = Duration::from_secs(5);
    let mut first_check = true;

    loop {
        if first_check {
            info!(
                paths = ?DEVICE_PATHS,
                timeout_secs = timeout.as_secs(),
                "Starting device discovery"
            );
            first_check = false;
        }

        for path_str in DEVICE_PATHS {
            let path = PathBuf::from(path_str);
            
            // Try to actually open the device - more reliable than exists()
            match std::fs::OpenOptions::new().read(true).write(true).open(&path) {
                Ok(_file) => {
                    // Successfully opened - device exists and is accessible
                    info!(
                        path = %path.display(),
                        elapsed_ms = start.elapsed().as_millis(),
                        "Found accessible virtio-serial device"
                    );
                    return Ok(path);
                }
                Err(e) => {
                    debug!(path = %path.display(), error = %e, "Device not accessible");
                }
            }
        }

        if start.elapsed() >= timeout {
            let mut status = Vec::new();
            for path_str in DEVICE_PATHS {
                let path = PathBuf::from(path_str);
                let s = match std::fs::OpenOptions::new().read(true).write(true).open(&path) {
                    Ok(_) => "accessible",
                    Err(e) => match e.kind() {
                        std::io::ErrorKind::NotFound => "not_found",
                        std::io::ErrorKind::PermissionDenied => "permission_denied",
                        _ => "error",
                    },
                };
                status.push(format!("{}: {}", path_str, s));
            }
            return Err(anyhow!(
                "Timeout waiting for virtio-serial device. Status: {}",
                status.join(", ")
            ));
        }

        if backoff >= Duration::from_secs(1) {
            warn!(
                elapsed_secs = start.elapsed().as_secs(),
                timeout_secs = timeout.as_secs(),
                "Still waiting for virtio-serial device..."
            );
        }
        
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(max_backoff);
    }
}

#[cfg(windows)]
async fn wait_for_device(timeout: Duration) -> Result<PathBuf> {
    use tokio::time::Instant;

    let start = Instant::now();
    let mut backoff = Duration::from_millis(100);
    let max_backoff = Duration::from_secs(5);
    let path = PathBuf::from(DEVICE_NAME);

    loop {
        if std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .is_ok()
        {
            info!(path = %path.display(), "Found virtio-serial device");
            return Ok(path);
        }

        if start.elapsed() >= timeout {
            return Err(anyhow!(
                "Timeout waiting for virtio-serial device: {}",
                DEVICE_NAME
            ));
        }

        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(max_backoff);
    }
}

/// Find the device path (utility function)
pub fn find_device() -> Option<PathBuf> {
    #[cfg(unix)]
    for path_str in DEVICE_PATHS {
        let path = PathBuf::from(path_str);
        if path.exists() {
            return Some(path);
        }
    }
    
    #[cfg(windows)]
    {
        let path = PathBuf::from(DEVICE_NAME);
        if std::fs::OpenOptions::new().read(true).write(true).open(&path).is_ok() {
            return Some(path);
        }
    }
    
    None
}
