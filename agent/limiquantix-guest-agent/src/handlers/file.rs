//! File operation handlers.
//!
//! Handles file read and write requests from the host.

use crate::config::AgentConfig;
use limiquantix_proto::agent::{
    agent_message, FileReadRequest, FileReadResponse, FileWriteRequest, FileWriteResponse,
};
use prost_types::Timestamp;
use std::path::Path;
use std::time::UNIX_EPOCH;
use tokio::fs::{self, File, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tracing::{debug, error, warn};

/// Handle a file write request.
pub async fn handle_file_write(req: FileWriteRequest, config: &AgentConfig) -> agent_message::Payload {
    let path = Path::new(&req.path);

    // Validate path (prevent directory traversal)
    if !is_path_safe(path) {
        return agent_message::Payload::FileWriteResponse(FileWriteResponse {
            success: false,
            bytes_written: 0,
            error: "Invalid path: directory traversal detected".to_string(),
            chunk_number: req.chunk_number,
        });
    }

    // Check security config
    if !config.is_file_write_allowed(&req.path) {
        return agent_message::Payload::FileWriteResponse(FileWriteResponse {
            success: false,
            bytes_written: 0,
            error: "Access denied by security policy".to_string(),
            chunk_number: req.chunk_number,
        });
    }

    // Create parent directories if requested
    if req.create_parents {
        if let Some(parent) = path.parent() {
            if let Err(e) = fs::create_dir_all(parent).await {
                return agent_message::Payload::FileWriteResponse(FileWriteResponse {
                    success: false,
                    bytes_written: 0,
                    error: format!("Failed to create parent directories: {}", e),
                    chunk_number: req.chunk_number,
                });
            }
        }
    }

    // Open the file
    let file_result = if req.append {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await
    } else if req.offset > 0 || req.chunk_number > 0 {
        // For chunked writes, open in write mode without truncating
        OpenOptions::new()
            .create(true)
            .write(true)
            .open(path)
            .await
    } else {
        // First chunk or single write: create/truncate
        OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)
            .await
    };

    let mut file = match file_result {
        Ok(f) => f,
        Err(e) => {
            error!(path = %req.path, error = %e, "Failed to open file for writing");
            return agent_message::Payload::FileWriteResponse(FileWriteResponse {
                success: false,
                bytes_written: 0,
                error: format!("Failed to open file: {}", e),
                chunk_number: req.chunk_number,
            });
        }
    };

    // Seek to offset if specified (and not appending)
    if !req.append && req.offset > 0 {
        if let Err(e) = file.seek(SeekFrom::Start(req.offset)).await {
            error!(path = %req.path, offset = req.offset, error = %e, "Failed to seek");
            return agent_message::Payload::FileWriteResponse(FileWriteResponse {
                success: false,
                bytes_written: 0,
                error: format!("Failed to seek: {}", e),
                chunk_number: req.chunk_number,
            });
        }
    }

    // Write the data
    let bytes_written = match file.write_all(&req.data).await {
        Ok(()) => req.data.len() as u64,
        Err(e) => {
            error!(path = %req.path, error = %e, "Failed to write data");
            return agent_message::Payload::FileWriteResponse(FileWriteResponse {
                success: false,
                bytes_written: 0,
                error: format!("Failed to write: {}", e),
                chunk_number: req.chunk_number,
            });
        }
    };

    // Sync to disk
    if let Err(e) = file.sync_all().await {
        warn!(path = %req.path, error = %e, "Failed to sync file");
    }

    // Set permissions if specified
    #[cfg(unix)]
    if req.mode > 0 {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(req.mode);
        if let Err(e) = fs::set_permissions(path, permissions).await {
            warn!(path = %req.path, mode = req.mode, error = %e, "Failed to set permissions");
        }
    }

    debug!(
        path = %req.path,
        bytes_written = bytes_written,
        chunk = req.chunk_number,
        eof = req.eof,
        "File write successful"
    );

    agent_message::Payload::FileWriteResponse(FileWriteResponse {
        success: true,
        bytes_written,
        error: String::new(),
        chunk_number: req.chunk_number,
    })
}

/// Handle a file read request.
pub async fn handle_file_read(
    req: FileReadRequest,
    config: &AgentConfig,
) -> agent_message::Payload {
    let path = Path::new(&req.path);

    // Validate path
    if !is_path_safe(path) {
        return agent_message::Payload::FileReadResponse(FileReadResponse {
            success: false,
            data: Vec::new(),
            eof: true,
            total_size: 0,
            offset: 0,
            chunk_number: 0,
            error: "Invalid path: directory traversal detected".to_string(),
            mode: 0,
            modified_at: None,
        });
    }

    // Check security config
    if !config.is_file_read_allowed(&req.path) {
        return agent_message::Payload::FileReadResponse(FileReadResponse {
            success: false,
            data: Vec::new(),
            eof: true,
            total_size: 0,
            offset: 0,
            chunk_number: 0,
            error: "Access denied by security policy".to_string(),
            mode: 0,
            modified_at: None,
        });
    }

    // Check if file exists
    if !path.exists() {
        return agent_message::Payload::FileReadResponse(FileReadResponse {
            success: false,
            data: Vec::new(),
            eof: true,
            total_size: 0,
            offset: 0,
            chunk_number: 0,
            error: "File not found".to_string(),
            mode: 0,
            modified_at: None,
        });
    }

    // Get file metadata
    let metadata = match fs::metadata(path).await {
        Ok(m) => m,
        Err(e) => {
            return agent_message::Payload::FileReadResponse(FileReadResponse {
                success: false,
                data: Vec::new(),
                eof: true,
                total_size: 0,
                offset: 0,
                chunk_number: 0,
                error: format!("Failed to get metadata: {}", e),
                mode: 0,
                modified_at: None,
            });
        }
    };

    let total_size = metadata.len();

    // Get file mode
    #[cfg(unix)]
    let mode = {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode()
    };
    #[cfg(windows)]
    let mode = 0u32;

    // Get modified time
    let modified_at = metadata.modified().ok().map(|t| {
        let duration = t.duration_since(UNIX_EPOCH).unwrap_or_default();
        Timestamp {
            seconds: duration.as_secs() as i64,
            nanos: duration.subsec_nanos() as i32,
        }
    });

    // Open the file
    let mut file = match File::open(path).await {
        Ok(f) => f,
        Err(e) => {
            error!(path = %req.path, error = %e, "Failed to open file for reading");
            return agent_message::Payload::FileReadResponse(FileReadResponse {
                success: false,
                data: Vec::new(),
                eof: true,
                total_size,
                offset: 0,
                chunk_number: 0,
                error: format!("Failed to open file: {}", e),
                mode,
                modified_at,
            });
        }
    };

    // Seek to offset
    let offset = req.offset;
    if offset > 0 {
        if let Err(e) = file.seek(SeekFrom::Start(offset)).await {
            return agent_message::Payload::FileReadResponse(FileReadResponse {
                success: false,
                data: Vec::new(),
                eof: true,
                total_size,
                offset,
                chunk_number: 0,
                error: format!("Failed to seek: {}", e),
                mode,
                modified_at,
            });
        }
    }

    // Determine chunk size
    let chunk_size = if req.chunk_size > 0 {
        req.chunk_size as usize
    } else {
        config.max_chunk_size
    };

    // Determine how many bytes to read
    let bytes_to_read = if req.length > 0 {
        (req.length as usize).min(chunk_size)
    } else {
        chunk_size
    };

    // Read the data
    let mut buffer = vec![0u8; bytes_to_read];
    let bytes_read = match file.read(&mut buffer).await {
        Ok(n) => n,
        Err(e) => {
            error!(path = %req.path, error = %e, "Failed to read file");
            return agent_message::Payload::FileReadResponse(FileReadResponse {
                success: false,
                data: Vec::new(),
                eof: true,
                total_size,
                offset,
                chunk_number: 0,
                error: format!("Failed to read: {}", e),
                mode,
                modified_at,
            });
        }
    };

    buffer.truncate(bytes_read);
    let eof = bytes_read < bytes_to_read || (offset + bytes_read as u64) >= total_size;

    debug!(
        path = %req.path,
        bytes_read = bytes_read,
        offset = offset,
        total_size = total_size,
        eof = eof,
        "File read successful"
    );

    agent_message::Payload::FileReadResponse(FileReadResponse {
        success: true,
        data: buffer,
        eof,
        total_size,
        offset,
        chunk_number: 0,
        error: String::new(),
        mode,
        modified_at,
    })
}

/// Check if a path is safe (no directory traversal).
fn is_path_safe(path: &Path) -> bool {
    // Reject paths with ".."
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => return false,
            _ => {}
        }
    }

    // Must be an absolute path
    path.is_absolute()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_path_safe() {
        assert!(is_path_safe(Path::new("/etc/passwd")));
        assert!(is_path_safe(Path::new("/var/log/syslog")));
        assert!(!is_path_safe(Path::new("../etc/passwd")));
        assert!(!is_path_safe(Path::new("/var/../etc/passwd")));
        assert!(!is_path_safe(Path::new("relative/path")));
    }
}
