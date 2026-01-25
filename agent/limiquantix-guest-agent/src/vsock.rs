//! VSOCK transport layer for high-bandwidth communication.
//!
//! VSOCK (Virtual Socket) provides a higher-bandwidth communication channel
//! compared to virtio-serial, useful for file transfers and clipboard images.
//!
//! This module is only available on Linux as VSOCK requires kernel support.

#[cfg(target_os = "linux")]
use anyhow::{anyhow, Context, Result};
#[cfg(target_os = "linux")]
use std::time::Duration;
#[cfg(target_os = "linux")]
use tokio::io::{AsyncRead, AsyncWrite, ReadHalf, WriteHalf};
#[cfg(target_os = "linux")]
use tracing::{debug, error, info, warn};

/// VSOCK CID for the host (hypervisor)
#[cfg(target_os = "linux")]
pub const VMADDR_CID_HOST: u32 = 2;

/// Default VSOCK port for the agent
#[cfg(target_os = "linux")]
pub const DEFAULT_VSOCK_PORT: u32 = 9443;

/// VSOCK transport wrapper
#[cfg(target_os = "linux")]
pub struct VsockTransport {
    stream: tokio_vsock::VsockStream,
}

#[cfg(target_os = "linux")]
impl VsockTransport {
    /// Connect to the host via VSOCK.
    pub async fn connect() -> Result<Self> {
        Self::connect_with_port(DEFAULT_VSOCK_PORT).await
    }

    /// Connect to the host via VSOCK on a specific port.
    pub async fn connect_with_port(port: u32) -> Result<Self> {
        Self::connect_with_timeout(port, Duration::from_secs(30)).await
    }

    /// Connect with a custom timeout.
    pub async fn connect_with_timeout(port: u32, timeout: Duration) -> Result<Self> {
        info!(cid = VMADDR_CID_HOST, port = port, "Connecting via VSOCK");

        let addr = tokio_vsock::VsockAddr::new(VMADDR_CID_HOST, port);

        let connect_future = tokio_vsock::VsockStream::connect(addr);
        let stream = tokio::time::timeout(timeout, connect_future)
            .await
            .map_err(|_| anyhow!("VSOCK connection timeout"))?
            .context("Failed to connect via VSOCK")?;

        info!(cid = VMADDR_CID_HOST, port = port, "Connected via VSOCK");

        Ok(Self { stream })
    }

    /// Split the transport into read and write halves.
    pub fn split(self) -> (ReadHalf<tokio_vsock::VsockStream>, WriteHalf<tokio_vsock::VsockStream>) {
        tokio::io::split(self.stream)
    }

    /// Check if VSOCK is available on this system.
    pub fn is_available() -> bool {
        // Check if /dev/vsock exists
        std::path::Path::new("/dev/vsock").exists()
    }

    /// Get the local CID (Context ID) of this VM.
    pub fn get_local_cid() -> Result<u32> {
        use std::fs::File;
        use std::io::Read;
        use std::os::unix::io::AsRawFd;

        let file = File::open("/dev/vsock")
            .context("Failed to open /dev/vsock")?;

        // IOCTL to get local CID
        // IOCTL_VM_SOCKETS_GET_LOCAL_CID = 0x7b9 (1977)
        const IOCTL_VM_SOCKETS_GET_LOCAL_CID: libc::c_ulong = 0x7b9;

        let mut cid: u32 = 0;
        let result = unsafe {
            libc::ioctl(file.as_raw_fd(), IOCTL_VM_SOCKETS_GET_LOCAL_CID, &mut cid)
        };

        if result < 0 {
            return Err(anyhow!("Failed to get local CID: {}", std::io::Error::last_os_error()));
        }

        Ok(cid)
    }
}

#[cfg(target_os = "linux")]
impl AsyncRead for VsockTransport {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}

#[cfg(target_os = "linux")]
impl AsyncWrite for VsockTransport {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<Result<usize, std::io::Error>> {
        std::pin::Pin::new(&mut self.stream).poll_write(cx, buf)
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), std::io::Error>> {
        std::pin::Pin::new(&mut self.stream).poll_flush(cx)
    }

    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), std::io::Error>> {
        std::pin::Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

/// Stub implementation for non-Linux platforms
#[cfg(not(target_os = "linux"))]
pub struct VsockTransport;

#[cfg(not(target_os = "linux"))]
impl VsockTransport {
    pub async fn connect() -> anyhow::Result<Self> {
        Err(anyhow::anyhow!("VSOCK is only supported on Linux"))
    }

    pub fn is_available() -> bool {
        false
    }
}

/// Unified transport that can use either virtio-serial or VSOCK
pub enum UnifiedTransport {
    /// Virtio-serial transport (primary)
    VirtioSerial(crate::transport::AgentTransport),
    /// VSOCK transport (high-bandwidth)
    #[cfg(target_os = "linux")]
    Vsock(VsockTransport),
}

impl UnifiedTransport {
    /// Connect using the best available transport.
    ///
    /// Prefers virtio-serial for compatibility, falls back to VSOCK if available.
    pub async fn connect(prefer_vsock: bool) -> anyhow::Result<Self> {
        #[cfg(target_os = "linux")]
        if prefer_vsock && VsockTransport::is_available() {
            match VsockTransport::connect().await {
                Ok(transport) => {
                    tracing::info!("Connected via VSOCK (high-bandwidth mode)");
                    return Ok(Self::Vsock(transport));
                }
                Err(e) => {
                    tracing::warn!(error = %e, "VSOCK connection failed, falling back to virtio-serial");
                }
            }
        }

        // Fall back to virtio-serial
        let transport = crate::transport::AgentTransport::connect().await?;
        tracing::info!("Connected via virtio-serial");
        Ok(Self::VirtioSerial(transport))
    }

    /// Check if this transport is using VSOCK.
    pub fn is_vsock(&self) -> bool {
        #[cfg(target_os = "linux")]
        {
            matches!(self, Self::Vsock(_))
        }
        #[cfg(not(target_os = "linux"))]
        {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "linux")]
    fn test_vsock_availability() {
        // Just check that the function doesn't panic
        let available = VsockTransport::is_available();
        println!("VSOCK available: {}", available);
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn test_get_local_cid() {
        if VsockTransport::is_available() {
            match VsockTransport::get_local_cid() {
                Ok(cid) => println!("Local CID: {}", cid),
                Err(e) => println!("Failed to get CID: {}", e),
            }
        }
    }
}
