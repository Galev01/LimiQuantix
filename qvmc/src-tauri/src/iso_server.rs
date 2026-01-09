//! Local ISO Server
//!
//! Provides an HTTP server that serves local ISO files to the hypervisor.
//! This enables mounting local ISOs directly to VMs without first uploading
//! them to the hypervisor's storage.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{oneshot, RwLock};
use tracing::{error, info, warn};
use warp::Filter;

/// Active ISO server state
#[derive(Debug)]
pub struct IsoServerState {
    /// The path to the ISO file being served
    pub iso_path: PathBuf,
    /// The port the server is listening on
    pub port: u16,
    /// The URL to access the ISO
    pub url: String,
    /// Shutdown signal sender
    shutdown_tx: Option<oneshot::Sender<()>>,
}

/// Global ISO server manager
pub struct IsoServerManager {
    /// Currently active server (only one at a time)
    active_server: RwLock<Option<IsoServerState>>,
}

impl IsoServerManager {
    pub fn new() -> Self {
        Self {
            active_server: RwLock::new(None),
        }
    }

    /// Start serving a local ISO file
    ///
    /// Returns the URL that the hypervisor can use to access the ISO.
    pub async fn start_serving(&self, iso_path: PathBuf) -> Result<String, String> {
        // Stop any existing server first
        self.stop_serving().await;

        // Verify the file exists
        if !iso_path.exists() {
            return Err(format!("ISO file not found: {:?}", iso_path));
        }

        // Get local IP address that should be reachable from the hypervisor
        let local_ip = get_local_ip()?;

        // Find an available port
        let port = portpicker::pick_unused_port()
            .ok_or_else(|| "Failed to find available port".to_string())?;

        // Create the URL
        let filename = iso_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("disk.iso");
        let url = format!("http://{}:{}/{}", local_ip, port, filename);

        info!(
            "Starting ISO server for {:?} at {}",
            iso_path, url
        );

        // Create shutdown channel
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        // Clone path for storage before moving into async block
        let iso_path_for_state = iso_path.clone();
        let filename_clone = filename.to_string();

        // Start the HTTP server in a background task
        let addr: SocketAddr = ([0, 0, 0, 0], port).into();

        // Create shared path for the routes
        let shared_path = Arc::new(iso_path);

        tokio::spawn(async move {
            let path_for_file = Arc::clone(&shared_path);
            let path_for_redirect = Arc::clone(&shared_path);
            
            // Create a route that serves the ISO file
            let iso_path_filter = {
                warp::path(filename_clone.clone())
                    .and(warp::get())
                    .and(warp::header::optional::<String>("range"))
                    .and_then(move |range_header: Option<String>| {
                        let path = Arc::clone(&path_for_file);
                        async move {
                            serve_iso_file(&path, range_header).await
                        }
                    })
            };

            // Also serve at root for convenience
            let root_route = {
                let filename_for_redirect = filename_clone.clone();
                warp::path::end()
                    .and(warp::get())
                    .map(move || {
                        warp::redirect::temporary(
                            warp::http::Uri::try_from(format!("/{}", filename_for_redirect)).unwrap()
                        )
                    })
            };

            let routes = iso_path_filter.or(root_route);

            // Run server with graceful shutdown
            let (_, server) = warp::serve(routes)
                .bind_with_graceful_shutdown(addr, async {
                    shutdown_rx.await.ok();
                });

            info!("ISO server started on port {}", port);
            server.await;
            info!("ISO server stopped");
        });

        // Store the server state
        {
            let mut active = self.active_server.write().await;
            *active = Some(IsoServerState {
                iso_path: iso_path_for_state,
                port,
                url: url.clone(),
                shutdown_tx: Some(shutdown_tx),
            });
        }

        Ok(url)
    }

    /// Stop the currently running ISO server
    pub async fn stop_serving(&self) {
        let mut active = self.active_server.write().await;
        if let Some(mut state) = active.take() {
            info!("Stopping ISO server for {:?}", state.iso_path);
            if let Some(tx) = state.shutdown_tx.take() {
                let _ = tx.send(());
            }
        }
    }

    /// Get the current server URL if active
    pub async fn get_current_url(&self) -> Option<String> {
        let active = self.active_server.read().await;
        active.as_ref().map(|s| s.url.clone())
    }

    /// Check if a server is currently running
    pub async fn is_serving(&self) -> bool {
        let active = self.active_server.read().await;
        active.is_some()
    }
}

/// Serve an ISO file with support for range requests (important for large files)
async fn serve_iso_file(
    path: &PathBuf,
    range_header: Option<String>,
) -> Result<impl warp::Reply, warp::Rejection> {
    use tokio::fs::File;
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    use warp::http::{Response, StatusCode};
    use std::io::SeekFrom;

    let file_size = match tokio::fs::metadata(path).await {
        Ok(meta) => meta.len(),
        Err(e) => {
            error!("Failed to get file metadata: {}", e);
            return Ok(Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(vec![])
                .unwrap());
        }
    };

    // Parse range header if present
    if let Some(range) = range_header {
        if let Some(range_spec) = range.strip_prefix("bytes=") {
            let parts: Vec<&str> = range_spec.split('-').collect();
            if parts.len() == 2 {
                let start: u64 = parts[0].parse().unwrap_or(0);
                let end: u64 = if parts[1].is_empty() {
                    file_size - 1
                } else {
                    parts[1].parse().unwrap_or(file_size - 1)
                };

                let length = end - start + 1;

                // Read the requested range
                let mut file = match File::open(path).await {
                    Ok(f) => f,
                    Err(e) => {
                        error!("Failed to open ISO file: {}", e);
                        return Ok(Response::builder()
                            .status(StatusCode::INTERNAL_SERVER_ERROR)
                            .body(vec![])
                            .unwrap());
                    }
                };

                if let Err(e) = file.seek(SeekFrom::Start(start)).await {
                    error!("Failed to seek in ISO file: {}", e);
                    return Ok(Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(vec![])
                        .unwrap());
                }

                // Read in chunks to avoid memory issues with large files
                let chunk_size = std::cmp::min(length as usize, 8 * 1024 * 1024); // 8MB max
                let mut buffer = vec![0u8; chunk_size];
                let bytes_read = match file.read(&mut buffer).await {
                    Ok(n) => n,
                    Err(e) => {
                        error!("Failed to read ISO file: {}", e);
                        return Ok(Response::builder()
                            .status(StatusCode::INTERNAL_SERVER_ERROR)
                            .body(vec![])
                            .unwrap());
                    }
                };

                buffer.truncate(bytes_read);

                return Ok(Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header("Content-Type", "application/octet-stream")
                    .header("Content-Length", bytes_read.to_string())
                    .header("Content-Range", format!("bytes {}-{}/{}", start, start + bytes_read as u64 - 1, file_size))
                    .header("Accept-Ranges", "bytes")
                    .body(buffer)
                    .unwrap());
            }
        }
    }

    // No range requested - return file info (for HEAD) or small files
    // For large files, we should really stream, but for simplicity we return headers
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", file_size.to_string())
        .header("Accept-Ranges", "bytes")
        .header("Content-Disposition", format!("attachment; filename=\"{}\"", 
            path.file_name().and_then(|n| n.to_str()).unwrap_or("disk.iso")))
        .body(vec![]) // Empty body for HEAD requests, client should use range
        .unwrap())
}

/// Get the local IP address that should be reachable from the hypervisor
fn get_local_ip() -> Result<String, String> {
    // Try to get the local IP address
    match local_ip_address::local_ip() {
        Ok(ip) => {
            info!("Detected local IP: {}", ip);
            Ok(ip.to_string())
        }
        Err(e) => {
            warn!("Failed to detect local IP: {}", e);
            // Fallback to localhost (won't work for remote hypervisors)
            Ok("127.0.0.1".to_string())
        }
    }
}

/// Get all available network interfaces with their IPs
pub fn get_network_interfaces() -> Vec<NetworkInterface> {
    let mut interfaces = Vec::new();

    // Get all local IPs
    if let Ok(ip) = local_ip_address::local_ip() {
        interfaces.push(NetworkInterface {
            name: "Primary".to_string(),
            ip: ip.to_string(),
            is_loopback: false,
        });
    }

    // Always add localhost as fallback
    interfaces.push(NetworkInterface {
        name: "Localhost".to_string(),
        ip: "127.0.0.1".to_string(),
        is_loopback: true,
    });

    interfaces
}

/// Network interface info
#[derive(Debug, Clone, serde::Serialize)]
pub struct NetworkInterface {
    pub name: String,
    pub ip: String,
    pub is_loopback: bool,
}
