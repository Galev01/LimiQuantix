//! ISO Manager - Manages ISO files and syncs metadata with control plane.
//!
//! This module provides:
//! - ISO metadata tracking with folder organization
//! - Persistence of ISO metadata to a local JSON file
//! - Notification of changes to the control plane
//! - File watching for external ISO additions/deletions

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// ISO metadata as stored locally and synced to control plane.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IsoMetadata {
    /// Unique identifier
    pub id: String,
    /// Display name (usually sanitized filename without extension)
    pub name: String,
    /// Original filename on disk
    pub filename: String,
    /// Virtual folder path for organization (e.g., "/windows/10")
    pub folder_path: String,
    /// File size in bytes
    pub size_bytes: u64,
    /// Format: "iso" or "img"
    pub format: String,
    /// Storage pool ID if on a specific pool
    pub storage_pool_id: Option<String>,
    /// Absolute path on disk
    pub path: String,
    /// SHA256 checksum (optional, computed lazily)
    pub checksum: Option<String>,
    /// Detected OS family
    pub os_family: Option<String>,
    /// Detected OS distribution
    pub os_distribution: Option<String>,
    /// Detected OS version
    pub os_version: Option<String>,
    /// Unix timestamp when created
    pub created_at: i64,
    /// Unix timestamp when last modified
    pub updated_at: i64,
}

impl IsoMetadata {
    /// Create new ISO metadata from file info.
    pub fn from_file(path: &Path, folder_path: &str, storage_pool_id: Option<String>) -> std::io::Result<Self> {
        let metadata = std::fs::metadata(path)?;
        let filename = path.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        
        let name = filename
            .strip_suffix(".iso")
            .or_else(|| filename.strip_suffix(".img"))
            .unwrap_or(&filename)
            .to_string();
        
        let format = if filename.ends_with(".iso") {
            "iso"
        } else if filename.ends_with(".img") {
            "img"
        } else {
            "unknown"
        };
        
        let (os_family, os_distribution, os_version) = detect_os_from_filename(&filename);
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        
        Ok(Self {
            id: Uuid::new_v4().to_string(),
            name,
            filename,
            folder_path: normalize_folder_path(folder_path),
            size_bytes: metadata.len(),
            format: format.to_string(),
            storage_pool_id,
            path: path.to_string_lossy().to_string(),
            checksum: None,
            os_family,
            os_distribution,
            os_version,
            created_at: now,
            updated_at: now,
        })
    }
    
    /// Get the full virtual path (folder + filename).
    pub fn get_full_path(&self) -> String {
        if self.folder_path == "/" {
            format!("/{}", self.filename)
        } else {
            format!("{}/{}", self.folder_path, self.filename)
        }
    }
}

/// ISO change event for sync notifications.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IsoChangeEvent {
    pub node_id: String,
    pub event_type: String, // "created", "updated", "deleted"
    #[serde(flatten)]
    pub iso: IsoMetadata,
    pub timestamp: i64,
}

/// ISO Manager state.
pub struct IsoManager {
    /// Cached ISO metadata by ID
    isos: RwLock<HashMap<String, IsoMetadata>>,
    /// Path to metadata persistence file
    metadata_path: PathBuf,
    /// Default directories to scan for ISOs
    scan_dirs: Vec<PathBuf>,
    /// Control plane address for sync
    control_plane_address: String,
    /// This node's ID
    node_id: RwLock<Option<String>>,
    /// HTTP client for control plane communication
    http_client: reqwest::Client,
}

impl IsoManager {
    /// Create a new ISO manager.
    pub fn new(control_plane_address: String) -> Self {
        let metadata_path = if Path::new("/data").exists() {
            PathBuf::from("/data/iso-metadata.json")
        } else {
            PathBuf::from("/var/lib/limiquantix/iso-metadata.json")
        };
        
        let scan_dirs = vec![
            PathBuf::from("/data/images"),
            PathBuf::from("/data/iso"),
            PathBuf::from("/var/lib/limiquantix/images"),
        ];
        
        Self {
            isos: RwLock::new(HashMap::new()),
            metadata_path,
            scan_dirs,
            control_plane_address,
            node_id: RwLock::new(None),
            http_client: reqwest::Client::new(),
        }
    }
    
    /// Set the node ID (called after registration).
    pub async fn set_node_id(&self, node_id: String) {
        *self.node_id.write().await = Some(node_id);
    }
    
    /// Load saved metadata from disk.
    pub async fn load(&self) -> anyhow::Result<()> {
        if !self.metadata_path.exists() {
            info!("No ISO metadata file found, starting fresh");
            return Ok(());
        }
        
        let content = fs::read_to_string(&self.metadata_path).await?;
        let isos: Vec<IsoMetadata> = serde_json::from_str(&content)?;
        
        let mut map = self.isos.write().await;
        for iso in isos {
            map.insert(iso.id.clone(), iso);
        }
        
        info!(count = map.len(), "Loaded ISO metadata");
        Ok(())
    }
    
    /// Save metadata to disk.
    pub async fn save(&self) -> anyhow::Result<()> {
        let isos = self.isos.read().await;
        let list: Vec<&IsoMetadata> = isos.values().collect();
        let content = serde_json::to_string_pretty(&list)?;
        
        // Ensure parent directory exists
        if let Some(parent) = self.metadata_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        
        fs::write(&self.metadata_path, content).await?;
        debug!(path = %self.metadata_path.display(), "Saved ISO metadata");
        Ok(())
    }
    
    /// Add or update an ISO in the manager.
    pub async fn upsert(&self, mut iso: IsoMetadata) -> IsoMetadata {
        let mut isos = self.isos.write().await;
        
        // Check if ISO with same path already exists
        for existing in isos.values() {
            if existing.path == iso.path {
                iso.id = existing.id.clone();
                iso.created_at = existing.created_at;
                break;
            }
        }
        
        iso.updated_at = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        
        let id = iso.id.clone();
        isos.insert(id, iso.clone());
        iso
    }
    
    /// Remove an ISO by ID.
    pub async fn remove(&self, id: &str) -> Option<IsoMetadata> {
        let mut isos = self.isos.write().await;
        isos.remove(id)
    }
    
    /// Remove an ISO by path.
    pub async fn remove_by_path(&self, path: &str) -> Option<IsoMetadata> {
        let mut isos = self.isos.write().await;
        let id = isos.iter()
            .find(|(_, iso)| iso.path == path)
            .map(|(id, _)| id.clone());
        
        if let Some(id) = id {
            isos.remove(&id)
        } else {
            None
        }
    }
    
    /// Get an ISO by ID.
    pub async fn get(&self, id: &str) -> Option<IsoMetadata> {
        let isos = self.isos.read().await;
        isos.get(id).cloned()
    }
    
    /// Get an ISO by path.
    pub async fn get_by_path(&self, path: &str) -> Option<IsoMetadata> {
        let isos = self.isos.read().await;
        isos.values().find(|iso| iso.path == path).cloned()
    }
    
    /// List all ISOs.
    pub async fn list(&self) -> Vec<IsoMetadata> {
        let isos = self.isos.read().await;
        isos.values().cloned().collect()
    }
    
    /// List ISOs in a specific folder.
    pub async fn list_by_folder(&self, folder: &str, include_subfolders: bool) -> Vec<IsoMetadata> {
        let folder = normalize_folder_path(folder);
        let isos = self.isos.read().await;
        
        isos.values()
            .filter(|iso| {
                if include_subfolders {
                    iso.folder_path == folder || iso.folder_path.starts_with(&format!("{}/", folder))
                } else {
                    iso.folder_path == folder
                }
            })
            .cloned()
            .collect()
    }
    
    /// List all unique folder paths.
    pub async fn list_folders(&self) -> Vec<String> {
        let isos = self.isos.read().await;
        let mut folders: std::collections::HashSet<String> = std::collections::HashSet::new();
        folders.insert("/".to_string());
        
        for iso in isos.values() {
            let folder = normalize_folder_path(&iso.folder_path);
            folders.insert(folder.clone());
            
            // Add parent folders
            let parts: Vec<&str> = folder.split('/').filter(|s| !s.is_empty()).collect();
            for i in 1..parts.len() {
                let parent = format!("/{}", parts[..i].join("/"));
                folders.insert(parent);
            }
        }
        
        let mut result: Vec<String> = folders.into_iter().collect();
        result.sort();
        result
    }
    
    /// Move an ISO to a different folder.
    pub async fn move_to_folder(&self, id: &str, folder: &str) -> anyhow::Result<IsoMetadata> {
        let folder = normalize_folder_path(folder);
        validate_folder_path(&folder)?;
        
        let mut isos = self.isos.write().await;
        let iso = isos.get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("ISO not found: {}", id))?;
        
        iso.folder_path = folder;
        iso.updated_at = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        
        Ok(iso.clone())
    }
    
    /// Scan default directories for ISO files and register them.
    pub async fn scan_directories(&self) -> anyhow::Result<ScanResult> {
        let mut result = ScanResult::default();
        
        for dir in &self.scan_dirs {
            if !dir.exists() {
                continue;
            }
            
            info!(dir = %dir.display(), "Scanning for ISO files");
            
            if let Ok(mut entries) = fs::read_dir(dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    if !path.is_file() {
                        continue;
                    }
                    
                    let filename = path.file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    
                    if !filename.ends_with(".iso") && !filename.ends_with(".img") {
                        continue;
                    }
                    
                    // Check if already tracked
                    let path_str = path.to_string_lossy().to_string();
                    if self.get_by_path(&path_str).await.is_some() {
                        result.existing += 1;
                        continue;
                    }
                    
                    // Create metadata
                    match IsoMetadata::from_file(&path, "/", None) {
                        Ok(iso) => {
                            self.upsert(iso).await;
                            result.registered += 1;
                            info!(path = %path.display(), "Registered ISO");
                        }
                        Err(e) => {
                            warn!(path = %path.display(), error = %e, "Failed to read ISO file");
                            result.errors.push(format!("{}: {}", path.display(), e));
                        }
                    }
                }
            }
        }
        
        // Save after scan
        if let Err(e) = self.save().await {
            warn!(error = %e, "Failed to save ISO metadata after scan");
        }
        
        Ok(result)
    }
    
    /// Notify control plane of an ISO change.
    pub async fn notify_change(&self, event_type: &str, iso: &IsoMetadata) -> anyhow::Result<()> {
        let node_id = match self.node_id.read().await.clone() {
            Some(id) => id,
            None => {
                debug!("Cannot notify: node ID not set (not registered yet)");
                return Ok(());
            }
        };
        
        if self.control_plane_address.is_empty() {
            debug!("Cannot notify: no control plane address configured");
            return Ok(());
        }
        
        let event = IsoChangeEvent {
            node_id: node_id.clone(),
            event_type: event_type.to_string(),
            iso: iso.clone(),
            timestamp: SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0),
        };
        
        let url = format!("{}/api/v1/images/notify", self.control_plane_address);
        
        let response = self.http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&event)
            .send()
            .await;
        
        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    debug!(
                        event_type = %event_type,
                        iso_id = %iso.id,
                        "ISO change notification sent"
                    );
                    Ok(())
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    warn!(status = %status, body = %body, "ISO notification failed");
                    Err(anyhow::anyhow!("Notification failed: {}", status))
                }
            }
            Err(e) => {
                warn!(error = %e, "Failed to send ISO notification");
                Err(anyhow::anyhow!("Notification request failed: {}", e))
            }
        }
    }
    
    /// Sync all ISOs to control plane (full sync).
    pub async fn sync_all(&self) -> anyhow::Result<u32> {
        let isos = self.list().await;
        let mut synced = 0u32;
        
        for iso in isos {
            if let Err(e) = self.notify_change("created", &iso).await {
                warn!(iso_id = %iso.id, error = %e, "Failed to sync ISO");
            } else {
                synced += 1;
            }
        }
        
        info!(synced = synced, "Completed ISO sync to control plane");
        Ok(synced)
    }
}

/// Result of a directory scan.
#[derive(Debug, Default)]
pub struct ScanResult {
    pub registered: u32,
    pub existing: u32,
    pub errors: Vec<String>,
}

/// Normalize folder path to consistent format.
/// "" -> "/", "windows" -> "/windows", "/windows/" -> "/windows"
pub fn normalize_folder_path(path: &str) -> String {
    if path.is_empty() {
        return "/".to_string();
    }
    
    let path = path.trim_end_matches('/');
    if path.is_empty() {
        return "/".to_string();
    }
    
    if !path.starts_with('/') {
        return format!("/{}", path);
    }
    
    path.to_string()
}

/// Validate folder path format.
pub fn validate_folder_path(path: &str) -> anyhow::Result<()> {
    if path.is_empty() || path == "/" {
        return Ok(());
    }
    
    if !path.starts_with('/') {
        return Err(anyhow::anyhow!("Folder path must start with /"));
    }
    
    if path.len() > 256 {
        return Err(anyhow::anyhow!("Folder path too long (max 256 chars)"));
    }
    
    let parts: Vec<&str> = path[1..].split('/').collect();
    if parts.len() > 5 {
        return Err(anyhow::anyhow!("Folder path too deep (max 5 levels)"));
    }
    
    for part in parts {
        if part.is_empty() {
            return Err(anyhow::anyhow!("Folder path contains empty segment"));
        }
        if part.chars().any(|c| "<>:\"|?*\\".contains(c)) {
            return Err(anyhow::anyhow!("Folder name contains invalid characters"));
        }
    }
    
    Ok(())
}

/// Detect OS info from filename patterns.
fn detect_os_from_filename(filename: &str) -> (Option<String>, Option<String>, Option<String>) {
    let filename_lower = filename.to_lowercase();
    
    let (family, distro) = if filename_lower.contains("windows") {
        (Some("windows".to_string()), Some("windows".to_string()))
    } else if filename_lower.contains("ubuntu") {
        (Some("linux".to_string()), Some("ubuntu".to_string()))
    } else if filename_lower.contains("debian") {
        (Some("linux".to_string()), Some("debian".to_string()))
    } else if filename_lower.contains("centos") {
        (Some("linux".to_string()), Some("centos".to_string()))
    } else if filename_lower.contains("rocky") {
        (Some("linux".to_string()), Some("rocky".to_string()))
    } else if filename_lower.contains("almalinux") || filename_lower.contains("alma") {
        (Some("linux".to_string()), Some("almalinux".to_string()))
    } else if filename_lower.contains("fedora") {
        (Some("linux".to_string()), Some("fedora".to_string()))
    } else if filename_lower.contains("opensuse") || filename_lower.contains("suse") {
        (Some("linux".to_string()), Some("opensuse".to_string()))
    } else if filename_lower.contains("arch") {
        (Some("linux".to_string()), Some("arch".to_string()))
    } else {
        (None, None)
    };
    
    // Try to detect version from filename
    let version = if filename_lower.contains("22.04") || filename_lower.contains("jammy") {
        Some("22.04".to_string())
    } else if filename_lower.contains("24.04") || filename_lower.contains("noble") {
        Some("24.04".to_string())
    } else if filename_lower.contains("20.04") || filename_lower.contains("focal") {
        Some("20.04".to_string())
    } else if filename_lower.contains("windows 10") || filename_lower.contains("win10") {
        Some("10".to_string())
    } else if filename_lower.contains("windows 11") || filename_lower.contains("win11") {
        Some("11".to_string())
    } else if filename_lower.contains("2022") {
        Some("2022".to_string())
    } else if filename_lower.contains("2019") {
        Some("2019".to_string())
    } else {
        None
    };
    
    (family, distro, version)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_normalize_folder_path() {
        assert_eq!(normalize_folder_path(""), "/");
        assert_eq!(normalize_folder_path("/"), "/");
        assert_eq!(normalize_folder_path("windows"), "/windows");
        assert_eq!(normalize_folder_path("/windows"), "/windows");
        assert_eq!(normalize_folder_path("/windows/"), "/windows");
        assert_eq!(normalize_folder_path("/windows/10/"), "/windows/10");
    }
    
    #[test]
    fn test_validate_folder_path() {
        assert!(validate_folder_path("").is_ok());
        assert!(validate_folder_path("/").is_ok());
        assert!(validate_folder_path("/windows").is_ok());
        assert!(validate_folder_path("/windows/10").is_ok());
        
        assert!(validate_folder_path("windows").is_err()); // Must start with /
        assert!(validate_folder_path("/a/b/c/d/e/f").is_err()); // Too deep
        assert!(validate_folder_path("/invalid<char").is_err()); // Invalid char
    }
    
    #[test]
    fn test_detect_os_from_filename() {
        let (family, distro, version) = detect_os_from_filename("ubuntu-22.04-server.iso");
        assert_eq!(family, Some("linux".to_string()));
        assert_eq!(distro, Some("ubuntu".to_string()));
        assert_eq!(version, Some("22.04".to_string()));
        
        let (family, distro, _) = detect_os_from_filename("Windows10_21H2.iso");
        assert_eq!(family, Some("windows".to_string()));
        assert_eq!(distro, Some("windows".to_string()));
    }
}
