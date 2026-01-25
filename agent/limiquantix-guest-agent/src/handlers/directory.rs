//! Directory operation handlers.
//!
//! Handles directory listing, creation, deletion, and file stat operations.

use crate::AgentConfig;
use limiquantix_proto::agent::{
    agent_message, CreateDirectoryRequest, CreateDirectoryResponse, DirectoryEntry,
    FileDeleteRequest, FileDeleteResponse, FileStatRequest, FileStatResponse,
    ListDirectoryRequest, ListDirectoryResponse,
};
use prost_types::Timestamp;
use std::path::Path;
use std::time::UNIX_EPOCH;
use tokio::fs;
use tracing::{debug, error, info, warn};

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, PermissionsExt};

/// Handle a list directory request.
pub async fn handle_list_directory(
    req: ListDirectoryRequest,
    _config: &AgentConfig,
) -> agent_message::Payload {
    let path = Path::new(&req.path);

    // Validate path
    if !is_path_safe(path) {
        return agent_message::Payload::ListDirectoryResponse(ListDirectoryResponse {
            success: false,
            entries: Vec::new(),
            continuation_token: String::new(),
            error: "Invalid path: directory traversal detected".to_string(),
            total_entries: 0,
        });
    }

    // Check if path exists and is a directory
    if !path.exists() {
        return agent_message::Payload::ListDirectoryResponse(ListDirectoryResponse {
            success: false,
            entries: Vec::new(),
            continuation_token: String::new(),
            error: "Directory not found".to_string(),
            total_entries: 0,
        });
    }

    if !path.is_dir() {
        return agent_message::Payload::ListDirectoryResponse(ListDirectoryResponse {
            success: false,
            entries: Vec::new(),
            continuation_token: String::new(),
            error: "Path is not a directory".to_string(),
            total_entries: 0,
        });
    }

    // Read directory entries
    let mut entries = Vec::new();
    let mut read_dir = match fs::read_dir(path).await {
        Ok(rd) => rd,
        Err(e) => {
            error!(path = %req.path, error = %e, "Failed to read directory");
            return agent_message::Payload::ListDirectoryResponse(ListDirectoryResponse {
                success: false,
                entries: Vec::new(),
                continuation_token: String::new(),
                error: format!("Failed to read directory: {}", e),
                total_entries: 0,
            });
        }
    };

    let max_entries = if req.max_entries > 0 {
        req.max_entries as usize
    } else {
        usize::MAX
    };

    let mut count = 0u32;
    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let file_name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files unless requested
        if !req.include_hidden && file_name.starts_with('.') {
            continue;
        }

        // Pagination support via continuation token
        if !req.continuation_token.is_empty() && file_name <= req.continuation_token {
            continue;
        }

        if entries.len() >= max_entries {
            break;
        }

        match entry_to_directory_entry(&entry).await {
            Ok(dir_entry) => {
                entries.push(dir_entry);
                count += 1;
            }
            Err(e) => {
                warn!(file = %file_name, error = %e, "Failed to stat directory entry");
            }
        }
    }

    // Sort entries by name
    entries.sort_by(|a, b| a.name.cmp(&b.name));

    // Set continuation token if we hit the limit
    let continuation_token = if entries.len() >= max_entries {
        entries.last().map(|e| e.name.clone()).unwrap_or_default()
    } else {
        String::new()
    };

    debug!(
        path = %req.path,
        entries = entries.len(),
        "Directory listing successful"
    );

    agent_message::Payload::ListDirectoryResponse(ListDirectoryResponse {
        success: true,
        entries,
        continuation_token,
        error: String::new(),
        total_entries: count,
    })
}

/// Handle a create directory request.
pub async fn handle_create_directory(req: CreateDirectoryRequest) -> agent_message::Payload {
    let path = Path::new(&req.path);

    // Validate path
    if !is_path_safe(path) {
        return agent_message::Payload::CreateDirectoryResponse(CreateDirectoryResponse {
            success: false,
            error: "Invalid path: directory traversal detected".to_string(),
        });
    }

    // Create directory
    let result = if req.create_parents {
        fs::create_dir_all(path).await
    } else {
        fs::create_dir(path).await
    };

    if let Err(e) = result {
        error!(path = %req.path, error = %e, "Failed to create directory");
        return agent_message::Payload::CreateDirectoryResponse(CreateDirectoryResponse {
            success: false,
            error: format!("Failed to create directory: {}", e),
        });
    }

    // Set permissions if specified
    #[cfg(unix)]
    if req.mode > 0 {
        let permissions = std::fs::Permissions::from_mode(req.mode);
        if let Err(e) = fs::set_permissions(path, permissions).await {
            warn!(path = %req.path, mode = req.mode, error = %e, "Failed to set permissions");
        }
    }

    info!(path = %req.path, "Directory created successfully");

    agent_message::Payload::CreateDirectoryResponse(CreateDirectoryResponse {
        success: true,
        error: String::new(),
    })
}

/// Handle a file delete request.
pub async fn handle_file_delete(req: FileDeleteRequest) -> agent_message::Payload {
    let path = Path::new(&req.path);

    // Validate path
    if !is_path_safe(path) {
        return agent_message::Payload::FileDeleteResponse(FileDeleteResponse {
            success: false,
            error: "Invalid path: directory traversal detected".to_string(),
        });
    }

    // Check if path exists
    if !path.exists() {
        return agent_message::Payload::FileDeleteResponse(FileDeleteResponse {
            success: false,
            error: "Path not found".to_string(),
        });
    }

    // Delete file or directory
    let result = if path.is_dir() {
        if req.recursive {
            fs::remove_dir_all(path).await
        } else {
            fs::remove_dir(path).await
        }
    } else {
        fs::remove_file(path).await
    };

    if let Err(e) = result {
        error!(path = %req.path, error = %e, "Failed to delete");
        return agent_message::Payload::FileDeleteResponse(FileDeleteResponse {
            success: false,
            error: format!("Failed to delete: {}", e),
        });
    }

    info!(path = %req.path, recursive = req.recursive, "Deleted successfully");

    agent_message::Payload::FileDeleteResponse(FileDeleteResponse {
        success: true,
        error: String::new(),
    })
}

/// Handle a file stat request.
pub async fn handle_file_stat(req: FileStatRequest) -> agent_message::Payload {
    let path = Path::new(&req.path);

    // Validate path
    if !is_path_safe(path) {
        return agent_message::Payload::FileStatResponse(FileStatResponse {
            success: false,
            entry: None,
            error: "Invalid path: directory traversal detected".to_string(),
        });
    }

    // Check if path exists
    if !path.exists() {
        return agent_message::Payload::FileStatResponse(FileStatResponse {
            success: false,
            entry: None,
            error: "Path not found".to_string(),
        });
    }

    // Get metadata
    let metadata = match fs::metadata(path).await {
        Ok(m) => m,
        Err(e) => {
            error!(path = %req.path, error = %e, "Failed to stat");
            return agent_message::Payload::FileStatResponse(FileStatResponse {
                success: false,
                entry: None,
                error: format!("Failed to stat: {}", e),
            });
        }
    };

    let entry = metadata_to_directory_entry(path, &metadata).await;

    debug!(path = %req.path, "File stat successful");

    agent_message::Payload::FileStatResponse(FileStatResponse {
        success: true,
        entry: Some(entry),
        error: String::new(),
    })
}

/// Convert a DirEntry to a DirectoryEntry proto message.
async fn entry_to_directory_entry(
    entry: &tokio::fs::DirEntry,
) -> Result<DirectoryEntry, std::io::Error> {
    let metadata = entry.metadata().await?;
    let path = entry.path();

    Ok(metadata_to_directory_entry(&path, &metadata).await)
}

/// Convert metadata to a DirectoryEntry proto message.
async fn metadata_to_directory_entry(path: &Path, metadata: &std::fs::Metadata) -> DirectoryEntry {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let full_path = path.to_string_lossy().to_string();

    let is_directory = metadata.is_dir();
    let is_symlink = metadata.file_type().is_symlink();
    let size_bytes = if is_directory { 0 } else { metadata.len() };

    // Get file mode
    #[cfg(unix)]
    let mode = metadata.permissions().mode();
    #[cfg(windows)]
    let mode = if metadata.permissions().readonly() {
        0o444
    } else {
        0o644
    };

    // Get timestamps
    let modified_at = metadata.modified().ok().map(|t| {
        let duration = t.duration_since(UNIX_EPOCH).unwrap_or_default();
        Timestamp {
            seconds: duration.as_secs() as i64,
            nanos: duration.subsec_nanos() as i32,
        }
    });

    let created_at = metadata.created().ok().map(|t| {
        let duration = t.duration_since(UNIX_EPOCH).unwrap_or_default();
        Timestamp {
            seconds: duration.as_secs() as i64,
            nanos: duration.subsec_nanos() as i32,
        }
    });

    // Get owner/group (Unix only)
    #[cfg(unix)]
    let (owner, group) = {
        let uid = metadata.uid();
        let gid = metadata.gid();

        // Try to resolve names
        let owner = get_username(uid).unwrap_or_else(|| uid.to_string());
        let group = get_groupname(gid).unwrap_or_else(|| gid.to_string());

        (owner, group)
    };

    #[cfg(windows)]
    let (owner, group) = (String::new(), String::new());

    // Get symlink target
    let symlink_target = if is_symlink {
        fs::read_link(path)
            .await
            .ok()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    DirectoryEntry {
        name,
        path: full_path,
        is_directory,
        is_symlink,
        size_bytes,
        mode,
        modified_at,
        created_at,
        owner,
        group,
        symlink_target,
    }
}

/// Check if a path is safe (no directory traversal).
fn is_path_safe(path: &Path) -> bool {
    // Reject paths with ".."
    for component in path.components() {
        if let std::path::Component::ParentDir = component {
            return false;
        }
    }

    // Must be an absolute path
    path.is_absolute()
}

/// Get username from UID (Unix only).
#[cfg(unix)]
fn get_username(uid: u32) -> Option<String> {
    use nix::unistd::{Uid, User};
    User::from_uid(Uid::from_raw(uid))
        .ok()
        .flatten()
        .map(|u| u.name)
}

/// Get group name from GID (Unix only).
#[cfg(unix)]
fn get_groupname(gid: u32) -> Option<String> {
    use nix::unistd::{Gid, Group};
    Group::from_gid(Gid::from_raw(gid))
        .ok()
        .flatten()
        .map(|g| g.name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_path_safe() {
        assert!(is_path_safe(Path::new("/etc")));
        assert!(is_path_safe(Path::new("/var/log")));
        assert!(!is_path_safe(Path::new("../etc")));
        assert!(!is_path_safe(Path::new("/var/../etc")));
        assert!(!is_path_safe(Path::new("relative/path")));
    }
}
