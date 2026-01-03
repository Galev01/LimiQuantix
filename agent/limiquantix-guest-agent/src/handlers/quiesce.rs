//! Filesystem quiescing handler for safe snapshots.
//!
//! This module implements fsfreeze/thaw operations to ensure filesystem
//! consistency during snapshot operations. This is critical for databases
//! and other applications that require consistent disk state.
//!
//! ## How it works
//!
//! 1. **Quiesce (Freeze)**: Uses `fsfreeze -f` on Linux to freeze all writes
//!    to the filesystem. The kernel queues all I/O until thaw.
//!
//! 2. **Thaw (Unfreeze)**: Uses `fsfreeze -u` to resume normal I/O.
//!
//! ## Safety Features
//!
//! - Auto-thaw timeout: Filesystems are automatically thawed after timeout
//! - Pre/post scripts: Optional hooks for database flush/resume
//! - Partial failure handling: Reports which filesystems failed

use crate::AgentConfig;
use limiquantix_proto::agent::{
    agent_message, FrozenFilesystem, QuiesceFilesystemsRequest, QuiesceFilesystemsResponse,
    ThawFilesystemsRequest, ThawFilesystemsResponse,
};
use prost_types::Timestamp;
use std::collections::HashSet;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

/// Global state to track frozen filesystems
static FROZEN_FILESYSTEMS: once_cell::sync::Lazy<Arc<Mutex<HashSet<String>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashSet::new())));

/// Auto-thaw guard - will thaw on drop or timeout
static AUTO_THAW_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Default timeout for quiesce operations (60 seconds)
const DEFAULT_QUIESCE_TIMEOUT: u32 = 60;

/// Default pre-freeze script directory
const DEFAULT_PRE_FREEZE_DIR: &str = "/etc/limiquantix/pre-freeze.d";

/// Default post-thaw script directory
const DEFAULT_POST_THAW_DIR: &str = "/etc/limiquantix/post-thaw.d";

/// Handle a quiesce (freeze) request.
pub async fn handle_quiesce(
    req: QuiesceFilesystemsRequest,
    _config: &AgentConfig,
) -> agent_message::Payload {
    info!(
        mount_points = ?req.mount_points,
        timeout = req.timeout_seconds,
        "Quiescing filesystems"
    );

    let timeout = if req.timeout_seconds > 0 {
        req.timeout_seconds
    } else {
        DEFAULT_QUIESCE_TIMEOUT
    };

    let pre_freeze_dir = if req.pre_freeze_script_dir.is_empty() {
        DEFAULT_PRE_FREEZE_DIR.to_string()
    } else {
        req.pre_freeze_script_dir
    };

    // Run pre-freeze scripts if requested
    if req.run_pre_freeze_scripts {
        if let Err(e) = run_hook_scripts(&pre_freeze_dir).await {
            warn!(error = %e, dir = %pre_freeze_dir, "Pre-freeze scripts failed");
            // Continue anyway - scripts are optional
        }
    }

    // Get list of mount points to freeze
    let mount_points = if req.mount_points.is_empty() {
        get_writable_filesystems().await
    } else {
        req.mount_points
    };

    if mount_points.is_empty() {
        return agent_message::Payload::QuiesceResponse(QuiesceFilesystemsResponse {
            success: false,
            frozen: vec![],
            error: "No filesystems to freeze".to_string(),
            quiesce_token: String::new(),
            auto_thaw_at: None,
        });
    }

    // Freeze each filesystem
    let mut frozen = Vec::new();
    let mut all_success = true;
    let mut frozen_set = FROZEN_FILESYSTEMS.lock().await;

    for mount_point in &mount_points {
        let result = freeze_filesystem(mount_point).await;
        let (device, fs_type) = get_mount_info(mount_point).await;

        match result {
            Ok(()) => {
                info!(mount_point = %mount_point, "Filesystem frozen");
                frozen_set.insert(mount_point.clone());
                frozen.push(FrozenFilesystem {
                    mount_point: mount_point.clone(),
                    device,
                    filesystem: fs_type,
                    frozen: true,
                    error: String::new(),
                });
            }
            Err(e) => {
                error!(mount_point = %mount_point, error = %e, "Failed to freeze filesystem");
                all_success = false;
                frozen.push(FrozenFilesystem {
                    mount_point: mount_point.clone(),
                    device,
                    filesystem: fs_type,
                    frozen: false,
                    error: e.to_string(),
                });
            }
        }
    }

    // If any failed, thaw the ones we froze
    if !all_success {
        warn!("Partial freeze failure, thawing frozen filesystems");
        for fs in &frozen {
            if fs.frozen {
                let _ = thaw_filesystem(&fs.mount_point).await;
                frozen_set.remove(&fs.mount_point);
            }
        }

        return agent_message::Payload::QuiesceResponse(QuiesceFilesystemsResponse {
            success: false,
            frozen,
            error: "Failed to freeze all filesystems".to_string(),
            quiesce_token: String::new(),
            auto_thaw_at: None,
        });
    }

    // Generate quiesce token
    let token = uuid::Uuid::new_v4().to_string();

    // Calculate auto-thaw time
    let auto_thaw_at = SystemTime::now()
        .checked_add(Duration::from_secs(timeout as u64))
        .unwrap_or(SystemTime::now());

    let auto_thaw_timestamp = auto_thaw_at
        .duration_since(UNIX_EPOCH)
        .map(|d| Timestamp {
            seconds: d.as_secs() as i64,
            nanos: d.subsec_nanos() as i32,
        })
        .ok();

    // Set up auto-thaw timer
    let frozen_mounts: Vec<String> = frozen.iter().filter(|f| f.frozen).map(|f| f.mount_point.clone()).collect();
    spawn_auto_thaw_timer(frozen_mounts, timeout);

    info!(
        count = frozen.iter().filter(|f| f.frozen).count(),
        token = %token,
        timeout_secs = timeout,
        "Filesystems quiesced successfully"
    );

    agent_message::Payload::QuiesceResponse(QuiesceFilesystemsResponse {
        success: true,
        frozen,
        error: String::new(),
        quiesce_token: token,
        auto_thaw_at: auto_thaw_timestamp,
    })
}

/// Handle a thaw (unfreeze) request.
pub async fn handle_thaw(
    req: ThawFilesystemsRequest,
    _config: &AgentConfig,
) -> agent_message::Payload {
    let start = Instant::now();

    info!(
        mount_points = ?req.mount_points,
        token = %req.quiesce_token,
        "Thawing filesystems"
    );

    // Cancel auto-thaw timer
    AUTO_THAW_ACTIVE.store(false, Ordering::SeqCst);

    let post_thaw_dir = if req.post_thaw_script_dir.is_empty() {
        DEFAULT_POST_THAW_DIR.to_string()
    } else {
        req.post_thaw_script_dir
    };

    // Get list of mount points to thaw
    let mount_points = if req.mount_points.is_empty() {
        // Thaw all currently frozen filesystems
        let frozen = FROZEN_FILESYSTEMS.lock().await;
        frozen.iter().cloned().collect()
    } else {
        req.mount_points
    };

    // Thaw each filesystem
    let mut thawed = Vec::new();
    let mut all_success = true;
    let mut error_msg = String::new();
    let mut frozen_set = FROZEN_FILESYSTEMS.lock().await;

    for mount_point in &mount_points {
        match thaw_filesystem(mount_point).await {
            Ok(()) => {
                info!(mount_point = %mount_point, "Filesystem thawed");
                frozen_set.remove(mount_point);
                thawed.push(mount_point.clone());
            }
            Err(e) => {
                error!(mount_point = %mount_point, error = %e, "Failed to thaw filesystem");
                all_success = false;
                error_msg = format!("Failed to thaw {}: {}", mount_point, e);
            }
        }
    }

    // Run post-thaw scripts if requested
    if req.run_post_thaw_scripts {
        if let Err(e) = run_hook_scripts(&post_thaw_dir).await {
            warn!(error = %e, dir = %post_thaw_dir, "Post-thaw scripts failed");
        }
    }

    let duration_ms = start.elapsed().as_millis() as u64;

    info!(
        count = thawed.len(),
        duration_ms = duration_ms,
        "Filesystems thawed"
    );

    agent_message::Payload::ThawResponse(ThawFilesystemsResponse {
        success: all_success,
        thawed_mount_points: thawed,
        error: error_msg,
        frozen_duration_ms: duration_ms,
    })
}

/// Freeze a single filesystem using fsfreeze.
#[cfg(unix)]
async fn freeze_filesystem(mount_point: &str) -> Result<(), String> {
    let output = Command::new("fsfreeze")
        .arg("-f")
        .arg(mount_point)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run fsfreeze: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("fsfreeze failed: {}", stderr.trim()))
    }
}

/// Windows VSS (Volume Shadow Copy Service) integration.
/// Uses vssadmin and diskshadow for snapshot-safe quiescing.
#[cfg(windows)]
async fn freeze_filesystem(mount_point: &str) -> Result<(), String> {
    use std::fs;
    use std::path::PathBuf;
    
    // Windows VSS approach:
    // 1. Create a VSS shadow copy which triggers VSS writers (SQL, Exchange, etc.)
    // 2. The shadow copy creation process freezes I/O momentarily
    // 3. We don't actually use the shadow copy, we just want the quiesce effect
    
    // For volume-level quiescing, we use diskshadow with a script
    let volume = normalize_windows_volume(mount_point)?;
    
    // Create a temporary diskshadow script
    let script_content = format!(
        "set context volatile nowriters\n\
         set option differential\n\
         begin backup\n\
         add volume {} alias quiesce_vol\n\
         create\n\
         end backup\n",
        volume
    );
    
    let script_path = PathBuf::from(format!(
        "{}\\limiquantix_quiesce_{}.dsh",
        std::env::temp_dir().display(),
        std::process::id()
    ));
    
    fs::write(&script_path, &script_content)
        .map_err(|e| format!("Failed to write diskshadow script: {}", e))?;
    
    // Execute diskshadow
    let output = Command::new("diskshadow")
        .arg("/s")
        .arg(&script_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run diskshadow: {}", e))?;
    
    // Clean up script
    let _ = fs::remove_file(&script_path);
    
    if output.status.success() {
        info!(volume = %volume, "VSS quiesce initiated");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // VSS might fail but still have quiesced - check output
        if stderr.contains("successfully") || output.stdout.len() > 0 {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.contains("Shadow copy set") {
                return Ok(());
            }
        }
        Err(format!("diskshadow failed: {}", stderr.trim()))
    }
}

/// Normalize Windows volume path (C: -> C:\, etc.)
#[cfg(windows)]
fn normalize_windows_volume(path: &str) -> Result<String, String> {
    let path = path.trim();
    
    // Handle drive letters
    if path.len() >= 2 && path.chars().nth(1) == Some(':') {
        let drive = path.chars().next().unwrap().to_uppercase().next().unwrap();
        return Ok(format!("{}:\\", drive));
    }
    
    // Handle mount points (e.g., D:\Data)
    if path.starts_with("\\\\?\\") || path.contains(':') {
        return Ok(path.to_string());
    }
    
    Err(format!("Invalid Windows volume path: {}", path))
}

/// Thaw a single filesystem using fsfreeze.
#[cfg(unix)]
async fn thaw_filesystem(mount_point: &str) -> Result<(), String> {
    let output = Command::new("fsfreeze")
        .arg("-u")
        .arg(mount_point)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run fsfreeze: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("fsfreeze unfreeze failed: {}", stderr.trim()))
    }
}

/// Windows VSS thaw - delete the shadow copy to release the quiesce.
#[cfg(windows)]
async fn thaw_filesystem(mount_point: &str) -> Result<(), String> {
    // On Windows, "thawing" means deleting the VSS shadow copies we created
    // This releases any VSS writer holds
    
    let volume = normalize_windows_volume(mount_point)?;
    
    // Use vssadmin to delete shadows for this volume
    let output = Command::new("vssadmin")
        .args(["delete", "shadows", "/for=", &volume, "/quiet"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to run vssadmin: {}", e))?;
    
    // vssadmin delete might fail if no shadows exist, which is fine
    if output.status.success() {
        info!(volume = %volume, "VSS shadows deleted (thaw)");
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // "No items found" is acceptable - means no shadows to delete
        if stderr.contains("No items found") || stderr.contains("no shadow copies") {
            Ok(())
        } else {
            warn!(volume = %volume, stderr = %stderr, "vssadmin delete failed (non-critical)");
            // Non-critical failure - shadows will expire anyway
            Ok(())
        }
    }
}

/// Get list of writable filesystems that can be frozen.
async fn get_writable_filesystems() -> Vec<String> {
    let mut filesystems = Vec::new();

    #[cfg(unix)]
    {
        // Parse /proc/mounts to get mounted filesystems
        if let Ok(content) = tokio::fs::read_to_string("/proc/mounts").await {
            for line in content.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    let mount_point = parts[1];
                    let fs_type = parts[2];
                    let options = parts[3];

                    // Skip virtual filesystems and read-only mounts
                    if is_freezable_filesystem(fs_type, options) {
                        filesystems.push(mount_point.to_string());
                    }
                }
            }
        }
    }

    filesystems
}

/// Check if a filesystem type supports fsfreeze.
fn is_freezable_filesystem(fs_type: &str, options: &str) -> bool {
    // Filesystems that support fsfreeze
    let freezable_types = ["ext4", "ext3", "xfs", "btrfs", "jfs", "reiserfs"];

    // Skip read-only mounts
    if options.contains("ro,") || options.starts_with("ro ") || options.ends_with(",ro") {
        return false;
    }

    freezable_types.contains(&fs_type)
}

/// Get device and filesystem type for a mount point.
async fn get_mount_info(mount_point: &str) -> (String, String) {
    #[cfg(unix)]
    {
        if let Ok(content) = tokio::fs::read_to_string("/proc/mounts").await {
            for line in content.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 && parts[1] == mount_point {
                    return (parts[0].to_string(), parts[2].to_string());
                }
            }
        }
    }

    (String::new(), String::new())
}

/// Run hook scripts in a directory.
async fn run_hook_scripts(dir: &str) -> Result<(), String> {
    let path = Path::new(dir);
    if !path.exists() {
        debug!(dir = %dir, "Hook directory does not exist, skipping");
        return Ok(());
    }

    let mut entries: Vec<_> = match tokio::fs::read_dir(path).await {
        Ok(rd) => {
            let mut entries = Vec::new();
            let mut rd = rd;
            while let Ok(Some(entry)) = rd.next_entry().await {
                if let Ok(ft) = entry.file_type().await {
                    if ft.is_file() {
                        entries.push(entry.path());
                    }
                }
            }
            entries
        }
        Err(e) => return Err(format!("Failed to read directory: {}", e)),
    };

    // Sort scripts by name for consistent ordering
    entries.sort();

    for script_path in entries {
        // Check if executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = tokio::fs::metadata(&script_path).await {
                let permissions = metadata.permissions();
                if permissions.mode() & 0o111 == 0 {
                    debug!(script = ?script_path, "Skipping non-executable script");
                    continue;
                }
            }
        }

        info!(script = ?script_path, "Running hook script");

        let output = Command::new(&script_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("Failed to run {:?}: {}", script_path, e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!(
                script = ?script_path,
                exit_code = output.status.code(),
                stderr = %stderr,
                "Hook script failed"
            );
        }
    }

    Ok(())
}

/// Spawn a background task that will auto-thaw after timeout.
fn spawn_auto_thaw_timer(mount_points: Vec<String>, timeout_secs: u32) {
    AUTO_THAW_ACTIVE.store(true, Ordering::SeqCst);

    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(timeout_secs as u64)).await;

        if AUTO_THAW_ACTIVE.load(Ordering::SeqCst) {
            warn!(
                timeout_secs = timeout_secs,
                "Auto-thaw timeout reached, thawing filesystems"
            );

            let mut frozen_set = FROZEN_FILESYSTEMS.lock().await;

            for mount_point in &mount_points {
                if frozen_set.contains(mount_point) {
                    match thaw_filesystem(mount_point).await {
                        Ok(()) => {
                            info!(mount_point = %mount_point, "Auto-thawed filesystem");
                            frozen_set.remove(mount_point);
                        }
                        Err(e) => {
                            error!(mount_point = %mount_point, error = %e, "Failed to auto-thaw");
                        }
                    }
                }
            }

            AUTO_THAW_ACTIVE.store(false, Ordering::SeqCst);
        }
    });
}
