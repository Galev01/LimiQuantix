//! Ceph RBD storage backend.
//!
//! This backend uses Ceph RADOS Block Devices for distributed storage.
//! It's the "vSAN killer" - providing enterprise-grade distributed storage.
//!
//! ## Features
//! - Native RBD block device access (no mount needed)
//! - Copy-on-write cloning (fast VM provisioning)
//! - Snapshot support with consistent point-in-time copies
//! - Live resize without VM downtime
//! - Multi-node access for live migration
//!
//! ## Prerequisites
//! - Ceph cluster with RBD pool created
//! - `ceph-common` package installed (provides `rbd` CLI)
//! - Libvirt secret configured with Ceph auth key
//!
//! ## Example
//!
//! ```rust,ignore
//! use limiquantix_hypervisor::storage::{CephBackend, PoolConfig, StorageBackend};
//!
//! let backend = CephBackend::new();
//! let config = PoolConfig::ceph("libvirt-pool", vec!["10.0.0.1:6789".into()]);
//!
//! backend.init_pool("pool-123", &config).await?;
//! backend.create_volume("pool-123", "vol-456", 50 * 1024 * 1024 * 1024, None).await?;
//! ```

use std::collections::HashMap;
use std::process::Command;
use std::sync::Arc;
use async_trait::async_trait;
use tokio::sync::RwLock;
use tracing::{debug, error, info, instrument, warn};

use crate::error::{HypervisorError, Result};
use super::types::{PoolConfig, PoolInfo, PoolType, VolumeAttachInfo, VolumeSource, VolumeInfo};
use super::traits::StorageBackend;

/// Cached Ceph pool configuration.
#[derive(Debug, Clone)]
struct CephPoolState {
    /// Ceph RBD pool name
    pool_name: String,
    /// Monitor addresses
    monitors: Vec<String>,
    /// Ceph user
    user: String,
    /// Keyring path
    keyring_path: String,
    /// Namespace (for multi-tenancy)
    namespace: String,
    /// Libvirt secret UUID
    secret_uuid: Option<String>,
}

/// Ceph RBD storage backend.
///
/// Provides distributed block storage using Ceph RADOS Block Devices.
/// This is the recommended backend for production multi-node deployments.
pub struct CephBackend {
    /// Cached pool configurations keyed by pool_id
    pools: Arc<RwLock<HashMap<String, CephPoolState>>>,
    /// rbd CLI binary path
    rbd_path: String,
}

impl CephBackend {
    /// Create a new Ceph backend with default settings.
    pub fn new() -> Self {
        Self {
            pools: Arc::new(RwLock::new(HashMap::new())),
            rbd_path: "rbd".to_string(),
        }
    }
    
    /// Create a Ceph backend with a custom rbd binary path.
    pub fn with_rbd_path(rbd_path: impl Into<String>) -> Self {
        Self {
            pools: Arc::new(RwLock::new(HashMap::new())),
            rbd_path: rbd_path.into(),
        }
    }
    
    /// Get the RBD image spec (pool/namespace/image format).
    fn image_spec(&self, state: &CephPoolState, volume_id: &str) -> String {
        if state.namespace.is_empty() {
            format!("{}/{}", state.pool_name, volume_id)
        } else {
            format!("{}/{}/{}", state.pool_name, state.namespace, volume_id)
        }
    }
    
    /// Build common rbd CLI arguments for authentication.
    fn auth_args(&self, state: &CephPoolState) -> Vec<String> {
        let mut args = vec![];
        
        // Add monitors
        if !state.monitors.is_empty() {
            args.push("--mon-host".to_string());
            args.push(state.monitors.join(","));
        }
        
        // Add user
        args.push("--id".to_string());
        args.push(state.user.clone());
        
        // Add keyring
        if !state.keyring_path.is_empty() {
            args.push("--keyring".to_string());
            args.push(state.keyring_path.clone());
        }
        
        args
    }
    
    /// Execute an rbd command and return the output.
    fn run_rbd(&self, args: &[&str], state: &CephPoolState) -> Result<String> {
        let auth_args = self.auth_args(state);
        let auth_refs: Vec<&str> = auth_args.iter().map(|s| s.as_str()).collect();
        
        let mut all_args: Vec<&str> = Vec::new();
        all_args.extend(args);
        all_args.extend(auth_refs.iter());
        
        debug!(
            command = %self.rbd_path,
            args = ?all_args,
            "Executing rbd command"
        );
        
        let output = Command::new(&self.rbd_path)
            .args(&all_args)
            .output()
            .map_err(|e| HypervisorError::Internal(format!("Failed to execute rbd: {}", e)))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            error!(stderr = %stderr, "rbd command failed");
            return Err(HypervisorError::Internal(format!("rbd failed: {}", stderr)));
        }
        
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
    
    /// Get pool state from cache.
    async fn get_pool_state(&self, pool_id: &str) -> Result<CephPoolState> {
        let pools = self.pools.read().await;
        pools.get(pool_id)
            .cloned()
            .ok_or_else(|| HypervisorError::Internal(format!("Ceph pool {} not found in cache", pool_id)))
    }
    
    /// Get pool capacity using `rbd df`.
    fn get_pool_capacity(&self, state: &CephPoolState) -> Result<(u64, u64)> {
        // rbd du --pool <pool> --format json
        let output = self.run_rbd(
            &["du", "--pool", &state.pool_name, "--format", "json"],
            state,
        )?;
        
        // Parse JSON output
        let json: serde_json::Value = serde_json::from_str(&output)
            .map_err(|e| HypervisorError::Internal(format!("Failed to parse rbd du output: {}", e)))?;
        
        // Extract total and used from images array
        let used_bytes: u64 = json["images"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|img| img["used_size"].as_u64())
                    .sum()
            })
            .unwrap_or(0);
        
        // For total capacity, we need to query the pool via rados or ceph CLI
        // As a fallback, use `ceph df` or estimate
        let total_bytes = self.get_ceph_pool_size(&state.pool_name, state)?;
        
        let available_bytes = total_bytes.saturating_sub(used_bytes);
        
        Ok((total_bytes, available_bytes))
    }
    
    /// Get Ceph pool size using ceph CLI.
    fn get_ceph_pool_size(&self, pool_name: &str, state: &CephPoolState) -> Result<u64> {
        let auth_args = self.auth_args(state);
        let auth_refs: Vec<&str> = auth_args.iter().map(|s| s.as_str()).collect();
        
        let mut args = vec!["osd", "pool", "get", pool_name, "size", "--format", "json"];
        args.extend(auth_refs.iter().copied());
        
        // Try ceph CLI first
        let output = Command::new("ceph")
            .args(&args)
            .output();
        
        match output {
            Ok(out) if out.status.success() => {
                // Parse ceph output - this gives replica count
                // For actual size, we'd need ceph df
                let stdout = String::from_utf8_lossy(&out.stdout);
                debug!(output = %stdout, "ceph pool get output");
            }
            _ => {
                debug!("ceph CLI not available, using default capacity estimate");
            }
        }
        
        // Fallback: query df for pool stats
        let df_output = Command::new("ceph")
            .args(["df", "--format", "json"])
            .args(&auth_refs)
            .output();
        
        if let Ok(out) = df_output {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    if let Some(pools) = json["pools"].as_array() {
                        for pool in pools {
                            if pool["name"].as_str() == Some(pool_name) {
                                if let Some(stats) = pool["stats"].as_object() {
                                    let max_avail = stats.get("max_avail")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(0);
                                    let stored = stats.get("stored")
                                        .and_then(|v| v.as_u64())
                                        .unwrap_or(0);
                                    return Ok(max_avail + stored);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Ultimate fallback: 1 TiB estimate
        warn!("Could not determine pool size, using 1 TiB estimate");
        Ok(1024 * 1024 * 1024 * 1024)
    }
    
    /// Create a libvirt secret for Ceph authentication.
    /// 
    /// Returns the secret UUID.
    #[instrument(skip(self, state), fields(user = %state.user))]
    fn ensure_libvirt_secret(&self, state: &CephPoolState, pool_id: &str) -> Result<String> {
        // If we already have a secret UUID, verify it exists
        if let Some(ref uuid) = state.secret_uuid {
            let check = Command::new("virsh")
                .args(["secret-get-value", uuid])
                .output();
            
            if check.map(|o| o.status.success()).unwrap_or(false) {
                debug!(uuid = %uuid, "Libvirt secret already exists");
                return Ok(uuid.clone());
            }
        }
        
        // Generate a deterministic UUID based on pool_id and user
        let uuid = format!(
            "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
            pool_id.chars().take(8).fold(0u32, |acc, c| acc.wrapping_add(c as u32)),
            state.user.chars().take(4).fold(0u16, |acc, c| acc.wrapping_add(c as u16)),
            0x4000u16, // Version 4
            0x8000u16, // Variant
            state.pool_name.chars().fold(0u64, |acc, c| acc.wrapping_add(c as u64))
        );
        
        // Create secret XML
        let secret_xml = format!(
            r#"<secret ephemeral='no' private='no'>
  <uuid>{}</uuid>
  <usage type='ceph'>
    <name>client.{} secret for {}</name>
  </usage>
</secret>"#,
            uuid, state.user, pool_id
        );
        
        // Write to temp file
        let temp_path = format!("/tmp/ceph-secret-{}.xml", pool_id);
        std::fs::write(&temp_path, &secret_xml)
            .map_err(|e| HypervisorError::Internal(format!("Failed to write secret XML: {}", e)))?;
        
        // Define the secret
        let output = Command::new("virsh")
            .args(["secret-define", "--file", &temp_path])
            .output()
            .map_err(|e| HypervisorError::Internal(format!("virsh secret-define failed: {}", e)))?;
        
        // Cleanup temp file
        let _ = std::fs::remove_file(&temp_path);
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(format!("virsh secret-define failed: {}", stderr)));
        }
        
        // Read the key from keyring and set secret value
        let key = self.read_ceph_key(state)?;
        
        let output = Command::new("virsh")
            .args(["secret-set-value", &uuid, "--base64", &key])
            .output()
            .map_err(|e| HypervisorError::Internal(format!("virsh secret-set-value failed: {}", e)))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(format!("virsh secret-set-value failed: {}", stderr)));
        }
        
        info!(uuid = %uuid, user = %state.user, "Libvirt secret created");
        Ok(uuid)
    }
    
    /// Read the Ceph authentication key from keyring file.
    fn read_ceph_key(&self, state: &CephPoolState) -> Result<String> {
        // Try reading from keyring file
        if !state.keyring_path.is_empty() {
            if let Ok(content) = std::fs::read_to_string(&state.keyring_path) {
                // Parse keyring format: key = <base64 key>
                for line in content.lines() {
                    let line = line.trim();
                    if line.starts_with("key") {
                        if let Some(key) = line.split('=').nth(1) {
                            return Ok(key.trim().to_string());
                        }
                    }
                }
            }
        }
        
        // Fallback: use ceph auth get-key
        let output = Command::new("ceph")
            .args(["auth", "get-key", &format!("client.{}", state.user)])
            .output()
            .map_err(|e| HypervisorError::Internal(format!("ceph auth get-key failed: {}", e)))?;
        
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }
        
        Err(HypervisorError::Internal("Could not read Ceph authentication key".into()))
    }
    
    /// Generate libvirt disk XML for Ceph RBD.
    fn generate_disk_xml(&self, state: &CephPoolState, volume_id: &str, secret_uuid: &str) -> String {
        // Build host entries
        let hosts: String = state.monitors.iter()
            .map(|m| {
                let parts: Vec<&str> = m.split(':').collect();
                let host = parts[0];
                let port = parts.get(1).unwrap_or(&"6789");
                format!("      <host name='{}' port='{}'/>", host, port)
            })
            .collect::<Vec<_>>()
            .join("\n");
        
        // RBD source name
        let source_name = if state.namespace.is_empty() {
            format!("{}/{}", state.pool_name, volume_id)
        } else {
            format!("{}/{}/{}", state.pool_name, state.namespace, volume_id)
        };
        
        format!(
            r#"    <disk type='network' device='disk'>
      <driver name='qemu' type='raw' cache='writeback' discard='unmap'/>
      <source protocol='rbd' name='{}'>
{}
      </source>
      <auth username='{}'>
        <secret type='ceph' uuid='{}'/>
      </auth>
      <target dev='vdX' bus='virtio'/>
    </disk>"#,
            source_name,
            hosts,
            state.user,
            secret_uuid
        )
    }
}

impl Default for CephBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl StorageBackend for CephBackend {
    #[instrument(skip(self, config), fields(pool_id = %pool_id))]
    async fn init_pool(&self, pool_id: &str, config: &PoolConfig) -> Result<PoolInfo> {
        let ceph_config = config.ceph.as_ref()
            .ok_or_else(|| HypervisorError::InvalidConfig("Ceph config required".into()))?;
        
        // Validate configuration
        if ceph_config.pool_name.is_empty() {
            return Err(HypervisorError::InvalidConfig("Ceph pool name is required".into()));
        }
        if ceph_config.monitors.is_empty() {
            return Err(HypervisorError::InvalidConfig("At least one Ceph monitor is required".into()));
        }
        
        // Create pool state
        let state = CephPoolState {
            pool_name: ceph_config.pool_name.clone(),
            monitors: ceph_config.monitors.clone(),
            user: if ceph_config.user.is_empty() { "admin".to_string() } else { ceph_config.user.clone() },
            keyring_path: ceph_config.keyring_path.clone(),
            namespace: ceph_config.namespace.clone(),
            secret_uuid: ceph_config.secret_uuid.clone(),
        };
        
        // Verify connectivity by listing images
        info!(
            pool_id = %pool_id,
            ceph_pool = %state.pool_name,
            monitors = ?state.monitors,
            "Initializing Ceph RBD pool"
        );
        
        match self.run_rbd(&["ls", "--pool", &state.pool_name], &state) {
            Ok(_) => {
                debug!("Ceph pool connectivity verified");
            }
            Err(e) => {
                error!(error = %e, "Failed to connect to Ceph pool");
                return Err(HypervisorError::Internal(format!(
                    "Failed to connect to Ceph pool {}: {}",
                    state.pool_name, e
                )));
            }
        }
        
        // Ensure libvirt secret exists
        let secret_uuid = self.ensure_libvirt_secret(&state, pool_id)?;
        
        // Update state with secret UUID
        let mut state = state;
        state.secret_uuid = Some(secret_uuid);
        
        // Get capacity
        let (total_bytes, available_bytes) = self.get_pool_capacity(&state)?;
        
        // Cache pool state
        {
            let mut pools = self.pools.write().await;
            pools.insert(pool_id.to_string(), state.clone());
        }
        
        info!(
            pool_id = %pool_id,
            ceph_pool = %state.pool_name,
            total_gb = total_bytes / 1024 / 1024 / 1024,
            available_gb = available_bytes / 1024 / 1024 / 1024,
            "Ceph RBD pool initialized"
        );
        
        Ok(PoolInfo {
            pool_id: pool_id.to_string(),
            pool_type: PoolType::CephRbd,
            mount_path: None,
            device_path: None,
            rbd_pool: Some(state.pool_name),
            total_bytes,
            available_bytes,
        })
    }
    
    async fn destroy_pool(&self, pool_id: &str) -> Result<()> {
        // Remove from cache (Ceph pools don't need unmounting)
        let mut pools = self.pools.write().await;
        if pools.remove(pool_id).is_some() {
            info!(pool_id = %pool_id, "Ceph pool removed from cache");
        } else {
            warn!(pool_id = %pool_id, "Pool not found in cache");
        }
        Ok(())
    }
    
    async fn get_pool_info(&self, pool_id: &str) -> Result<PoolInfo> {
        let state = self.get_pool_state(pool_id).await?;
        let (total_bytes, available_bytes) = self.get_pool_capacity(&state)?;
        
        Ok(PoolInfo {
            pool_id: pool_id.to_string(),
            pool_type: PoolType::CephRbd,
            mount_path: None,
            device_path: None,
            rbd_pool: Some(state.pool_name),
            total_bytes,
            available_bytes,
        })
    }
    
    async fn list_volumes(&self, pool_id: &str) -> Result<Vec<VolumeInfo>> {
        let state = self.get_pool_state(pool_id).await?;
        
        // Use rbd ls --format json to list all images
        let output = self.run_rbd(&["ls", "--pool", &state.pool_name, "--format", "json"], &state)?;
        
        let images: Vec<String> = serde_json::from_str(&output).unwrap_or_default();
        let mut volumes = Vec::new();
        
        for image_name in images {
            // Get image info
            if let Ok(info_output) = self.run_rbd(&["info", "--pool", &state.pool_name, &image_name, "--format", "json"], &state) {
                if let Ok(info) = serde_json::from_str::<serde_json::Value>(&info_output) {
                    let capacity = info["size"].as_u64().unwrap_or(0);
                    let allocation = info["objects"].as_u64().unwrap_or(0) * 4 * 1024 * 1024; // Estimate based on 4MB objects
                    
                    volumes.push(VolumeInfo {
                        name: image_name.clone(),
                        path: format!("rbd:{}/{}", state.pool_name, image_name),
                        capacity,
                        allocation,
                        format: Some("rbd".to_string()),
                    });
                }
            }
        }
        
        Ok(volumes)
    }
    
    #[instrument(skip(self, source), fields(pool_id = %pool_id, volume_id = %volume_id, size_bytes = %size_bytes))]
    async fn create_volume(
        &self,
        pool_id: &str,
        volume_id: &str,
        size_bytes: u64,
        source: Option<&VolumeSource>,
    ) -> Result<()> {
        let state = self.get_pool_state(pool_id).await?;
        let image_spec = self.image_spec(&state, volume_id);
        
        match source {
            Some(VolumeSource::Clone(source_id)) => {
                // Fast copy-on-write clone
                // First, create a snapshot of the source
                let source_spec = self.image_spec(&state, source_id);
                let snap_name = format!("clone_src_{}", volume_id);
                
                info!(
                    source = %source_spec,
                    dest = %image_spec,
                    "Cloning RBD volume"
                );
                
                // Protect and clone (protect required for cloning)
                self.run_rbd(
                    &["snap", "create", &format!("{}@{}", source_spec, snap_name)],
                    &state,
                )?;
                
                self.run_rbd(
                    &["snap", "protect", &format!("{}@{}", source_spec, snap_name)],
                    &state,
                )?;
                
                // Clone from snapshot
                self.run_rbd(
                    &["clone", &format!("{}@{}", source_spec, snap_name), &image_spec],
                    &state,
                )?;
                
                info!(volume_id = %volume_id, "RBD volume cloned");
            }
            Some(VolumeSource::Image(image_id)) => {
                // Clone from image (same as Clone but source is an image ID)
                let source_spec = self.image_spec(&state, image_id);
                let snap_name = "base";
                
                info!(
                    source = %source_spec,
                    dest = %image_spec,
                    "Cloning from image"
                );
                
                // Assume images have a protected "base" snapshot
                // Clone from it
                self.run_rbd(
                    &["clone", &format!("{}@{}", source_spec, snap_name), &image_spec],
                    &state,
                )?;
                
                // Resize if needed
                if size_bytes > 0 {
                    self.run_rbd(
                        &["resize", "--size", &(size_bytes / 1024 / 1024).to_string(), &image_spec],
                        &state,
                    )?;
                }
                
                info!(volume_id = %volume_id, "RBD volume created from image");
            }
            Some(VolumeSource::Snapshot(snapshot_id)) => {
                // Restore from snapshot - create clone or copy
                info!(
                    snapshot = %snapshot_id,
                    dest = %image_spec,
                    "Restoring from snapshot"
                );
                
                // Parse snapshot_id format: volume_id@snap_name
                self.run_rbd(
                    &["clone", snapshot_id, &image_spec],
                    &state,
                )?;
                
                info!(volume_id = %volume_id, "RBD volume restored from snapshot");
            }
            None => {
                // Create empty volume
                if size_bytes == 0 {
                    return Err(HypervisorError::InvalidConfig(
                        "Volume size must be greater than 0".into()
                    ));
                }
                
                let size_mb = size_bytes / 1024 / 1024;
                info!(
                    image = %image_spec,
                    size_mb = size_mb,
                    "Creating empty RBD volume"
                );
                
                self.run_rbd(
                    &["create", "--size", &size_mb.to_string(), &image_spec],
                    &state,
                )?;
                
                info!(volume_id = %volume_id, size_gb = size_bytes / 1024 / 1024 / 1024, "RBD volume created");
            }
        }
        
        Ok(())
    }
    
    async fn delete_volume(&self, pool_id: &str, volume_id: &str) -> Result<()> {
        let state = self.get_pool_state(pool_id).await?;
        let image_spec = self.image_spec(&state, volume_id);
        
        info!(image = %image_spec, "Deleting RBD volume");
        
        // First, remove any snapshots
        let snap_list = self.run_rbd(
            &["snap", "ls", &image_spec, "--format", "json"],
            &state,
        );
        
        if let Ok(output) = snap_list {
            if let Ok(snaps) = serde_json::from_str::<Vec<serde_json::Value>>(&output) {
                for snap in snaps {
                    if let Some(name) = snap["name"].as_str() {
                        // Unprotect if protected
                        let _ = self.run_rbd(
                            &["snap", "unprotect", &format!("{}@{}", image_spec, name)],
                            &state,
                        );
                        // Delete snapshot
                        let _ = self.run_rbd(
                            &["snap", "rm", &format!("{}@{}", image_spec, name)],
                            &state,
                        );
                    }
                }
            }
        }
        
        // Delete the image
        self.run_rbd(&["rm", &image_spec], &state)?;
        
        info!(volume_id = %volume_id, "RBD volume deleted");
        Ok(())
    }
    
    async fn resize_volume(&self, pool_id: &str, volume_id: &str, new_size_bytes: u64) -> Result<()> {
        let state = self.get_pool_state(pool_id).await?;
        let image_spec = self.image_spec(&state, volume_id);
        let size_mb = new_size_bytes / 1024 / 1024;
        
        info!(
            image = %image_spec,
            new_size_mb = size_mb,
            "Resizing RBD volume"
        );
        
        self.run_rbd(
            &["resize", "--size", &size_mb.to_string(), &image_spec],
            &state,
        )?;
        
        info!(volume_id = %volume_id, new_size_gb = new_size_bytes / 1024 / 1024 / 1024, "RBD volume resized");
        Ok(())
    }
    
    async fn get_attach_info(&self, pool_id: &str, volume_id: &str) -> Result<VolumeAttachInfo> {
        let state = self.get_pool_state(pool_id).await?;
        
        // Verify volume exists
        let image_spec = self.image_spec(&state, volume_id);
        self.run_rbd(&["info", &image_spec], &state)
            .map_err(|_| HypervisorError::InvalidConfig(format!("Volume {} not found", volume_id)))?;
        
        let secret_uuid = state.secret_uuid.as_ref()
            .ok_or_else(|| HypervisorError::Internal("Libvirt secret UUID not configured".into()))?;
        
        let disk_xml = self.generate_disk_xml(&state, volume_id, secret_uuid);
        
        Ok(VolumeAttachInfo {
            volume_id: volume_id.to_string(),
            disk_xml,
            path: image_spec,
        })
    }
    
    async fn clone_volume(
        &self,
        pool_id: &str,
        source_volume_id: &str,
        dest_volume_id: &str,
    ) -> Result<()> {
        self.create_volume(
            pool_id,
            dest_volume_id,
            0,
            Some(&VolumeSource::Clone(source_volume_id.to_string())),
        ).await
    }
    
    async fn create_snapshot(
        &self,
        pool_id: &str,
        volume_id: &str,
        snapshot_id: &str,
    ) -> Result<()> {
        let state = self.get_pool_state(pool_id).await?;
        let image_spec = self.image_spec(&state, volume_id);
        let snap_spec = format!("{}@{}", image_spec, snapshot_id);
        
        info!(
            image = %image_spec,
            snapshot = %snapshot_id,
            "Creating RBD snapshot"
        );
        
        self.run_rbd(&["snap", "create", &snap_spec], &state)?;
        
        info!(
            volume_id = %volume_id,
            snapshot_id = %snapshot_id,
            "RBD snapshot created"
        );
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_image_spec_without_namespace() {
        let backend = CephBackend::new();
        let state = CephPoolState {
            pool_name: "rbd".to_string(),
            monitors: vec!["10.0.0.1:6789".to_string()],
            user: "admin".to_string(),
            keyring_path: String::new(),
            namespace: String::new(),
            secret_uuid: None,
        };
        
        assert_eq!(backend.image_spec(&state, "vol-123"), "rbd/vol-123");
    }
    
    #[test]
    fn test_image_spec_with_namespace() {
        let backend = CephBackend::new();
        let state = CephPoolState {
            pool_name: "rbd".to_string(),
            monitors: vec!["10.0.0.1:6789".to_string()],
            user: "admin".to_string(),
            keyring_path: String::new(),
            namespace: "tenant1".to_string(),
            secret_uuid: None,
        };
        
        assert_eq!(backend.image_spec(&state, "vol-123"), "rbd/tenant1/vol-123");
    }
    
    #[test]
    fn test_auth_args() {
        let backend = CephBackend::new();
        let state = CephPoolState {
            pool_name: "rbd".to_string(),
            monitors: vec!["10.0.0.1:6789".to_string(), "10.0.0.2:6789".to_string()],
            user: "libvirt".to_string(),
            keyring_path: "/etc/ceph/ceph.client.libvirt.keyring".to_string(),
            namespace: String::new(),
            secret_uuid: None,
        };
        
        let args = backend.auth_args(&state);
        assert!(args.contains(&"--mon-host".to_string()));
        assert!(args.contains(&"--id".to_string()));
        assert!(args.contains(&"libvirt".to_string()));
        assert!(args.contains(&"--keyring".to_string()));
    }
    
    #[test]
    fn test_generate_disk_xml() {
        let backend = CephBackend::new();
        let state = CephPoolState {
            pool_name: "libvirt-pool".to_string(),
            monitors: vec!["10.0.0.1:6789".to_string(), "10.0.0.2:6789".to_string()],
            user: "libvirt".to_string(),
            keyring_path: String::new(),
            namespace: String::new(),
            secret_uuid: Some("550e8400-e29b-41d4-a716-446655440000".to_string()),
        };
        
        let xml = backend.generate_disk_xml(&state, "vm-100-disk-0", "550e8400-e29b-41d4-a716-446655440000");
        
        assert!(xml.contains("type='network'"));
        assert!(xml.contains("protocol='rbd'"));
        assert!(xml.contains("libvirt-pool/vm-100-disk-0"));
        assert!(xml.contains("10.0.0.1"));
        assert!(xml.contains("10.0.0.2"));
        assert!(xml.contains("username='libvirt'"));
        assert!(xml.contains("type='ceph'"));
        assert!(xml.contains("550e8400-e29b-41d4-a716-446655440000"));
    }
    
    #[test]
    fn test_pool_config_ceph() {
        let config = PoolConfig::ceph(
            "libvirt-pool",
            vec!["10.0.0.1:6789".into(), "10.0.0.2:6789".into()],
        );
        assert!(config.ceph.is_some());
        let ceph = config.ceph.unwrap();
        assert_eq!(ceph.pool_name, "libvirt-pool");
        assert_eq!(ceph.monitors.len(), 2);
        assert_eq!(ceph.user, "admin");
    }
}
