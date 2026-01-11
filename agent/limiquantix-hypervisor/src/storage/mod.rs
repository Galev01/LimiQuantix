//! Storage backends for LimiQuantix.
//!
//! This module provides storage backend implementations for different storage types:
//! - **Local**: Local directory/LVM storage (development, single-node)
//! - **NFS**: Network File System (enterprise shared storage)
//! - **Ceph**: Ceph RBD (hyper-converged, distributed storage)
//! - **iSCSI**: iSCSI targets with LVM (enterprise SAN)
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────┐
//! │                     StorageManager                               │
//! │  - Routes to appropriate backend based on pool type             │
//! │  - Manages pool lifecycle (init, destroy)                       │
//! └─────────────────────────┬───────────────────────────────────────┘
//!                           │
//!       ┌───────────────────┼───────────────────┐
//!       ▼                   ▼                   ▼
//! ┌───────────┐      ┌───────────┐       ┌───────────┐
//! │  Local    │      │   NFS     │       │   Ceph    │
//! │  Backend  │      │  Backend  │       │  Backend  │
//! └───────────┘      └───────────┘       └───────────┘
//! ```

mod local;
mod nfs;
mod ceph;
mod iscsi;
mod types;
mod traits;

pub use local::*;
pub use nfs::*;
pub use ceph::*;
pub use iscsi::*;
pub use types::*;
pub use traits::*;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, instrument, warn};

use crate::error::{HypervisorError, Result};

/// Storage manager that routes operations to the appropriate backend.
pub struct StorageManager {
    /// Registered storage backends by type
    backends: HashMap<PoolType, Arc<dyn StorageBackend>>,
    /// Active pool information
    pools: Arc<RwLock<HashMap<String, PoolInfo>>>,
}

impl StorageManager {
    /// Create a new storage manager with default backends.
    pub fn new() -> Self {
        let mut backends: HashMap<PoolType, Arc<dyn StorageBackend>> = HashMap::new();
        
        // Register default backends
        backends.insert(PoolType::LocalDir, Arc::new(LocalBackend::new()));
        backends.insert(PoolType::Nfs, Arc::new(NfsBackend::new()));
        backends.insert(PoolType::CephRbd, Arc::new(CephBackend::new()));
        backends.insert(PoolType::Iscsi, Arc::new(IscsiBackend::new()));
        
        Self {
            backends,
            pools: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    /// Get a backend for a specific pool type.
    fn get_backend(&self, pool_type: PoolType) -> Result<Arc<dyn StorageBackend>> {
        self.backends.get(&pool_type)
            .cloned()
            .ok_or_else(|| HypervisorError::Internal(
                format!("No backend registered for pool type {:?}", pool_type)
            ))
    }
    
    /// Initialize a storage pool.
    #[instrument(skip(self, config), fields(pool_id = %pool_id, pool_type = ?pool_type))]
    pub async fn init_pool(
        &self,
        pool_id: &str,
        pool_type: PoolType,
        config: PoolConfig,
    ) -> Result<PoolInfo> {
        let backend = self.get_backend(pool_type)?;
        
        info!("Initializing storage pool");
        
        let pool_info = backend.init_pool(pool_id, &config).await?;
        
        // Cache pool info
        {
            let mut pools = self.pools.write().await;
            pools.insert(pool_id.to_string(), pool_info.clone());
        }
        
        info!(
            total_bytes = pool_info.total_bytes,
            available_bytes = pool_info.available_bytes,
            "Storage pool initialized"
        );
        
        Ok(pool_info)
    }
    
    /// Destroy a storage pool.
    #[instrument(skip(self), fields(pool_id = %pool_id))]
    pub async fn destroy_pool(&self, pool_id: &str) -> Result<()> {
        let pool_info = {
            let pools = self.pools.read().await;
            pools.get(pool_id).cloned()
        };
        
        if let Some(info) = pool_info {
            let backend = self.get_backend(info.pool_type)?;
            backend.destroy_pool(pool_id).await?;
            
            // Remove from cache
            let mut pools = self.pools.write().await;
            pools.remove(pool_id);
            
            info!("Storage pool destroyed");
        } else {
            warn!("Pool not found in cache, nothing to destroy");
        }
        
        Ok(())
    }
    
    /// Get pool information.
    pub async fn get_pool_info(&self, pool_id: &str) -> Result<PoolInfo> {
        let pools = self.pools.read().await;
        pools.get(pool_id)
            .cloned()
            .ok_or_else(|| HypervisorError::Internal(
                format!("Pool {} not found", pool_id)
            ))
    }
    
    /// Refresh pool information.
    #[instrument(skip(self), fields(pool_id = %pool_id))]
    pub async fn refresh_pool_info(&self, pool_id: &str) -> Result<PoolInfo> {
        let pool_type = {
            let pools = self.pools.read().await;
            pools.get(pool_id)
                .map(|p| p.pool_type)
                .ok_or_else(|| HypervisorError::Internal(
                    format!("Pool {} not found", pool_id)
                ))?
        };
        
        let backend = self.get_backend(pool_type)?;
        let pool_info = backend.get_pool_info(pool_id).await?;
        
        // Update cache
        {
            let mut pools = self.pools.write().await;
            pools.insert(pool_id.to_string(), pool_info.clone());
        }
        
        Ok(pool_info)
    }
    
    /// Create a volume in a pool.
    #[instrument(skip(self, source), fields(pool_id = %pool_id, volume_id = %volume_id, size_bytes = %size_bytes))]
    pub async fn create_volume(
        &self,
        pool_id: &str,
        volume_id: &str,
        size_bytes: u64,
        source: Option<VolumeSource>,
    ) -> Result<()> {
        let pool_type = {
            let pools = self.pools.read().await;
            pools.get(pool_id)
                .map(|p| p.pool_type)
                .ok_or_else(|| HypervisorError::Internal(
                    format!("Pool {} not found", pool_id)
                ))?
        };
        
        let backend = self.get_backend(pool_type)?;
        backend.create_volume(pool_id, volume_id, size_bytes, source.as_ref()).await?;
        
        info!("Volume created");
        Ok(())
    }
    
    /// Delete a volume from a pool.
    #[instrument(skip(self), fields(pool_id = %pool_id, volume_id = %volume_id))]
    pub async fn delete_volume(&self, pool_id: &str, volume_id: &str) -> Result<()> {
        let pool_type = {
            let pools = self.pools.read().await;
            pools.get(pool_id)
                .map(|p| p.pool_type)
                .ok_or_else(|| HypervisorError::Internal(
                    format!("Pool {} not found", pool_id)
                ))?
        };
        
        let backend = self.get_backend(pool_type)?;
        backend.delete_volume(pool_id, volume_id).await?;
        
        info!("Volume deleted");
        Ok(())
    }
    
    /// Get libvirt disk XML for attaching a volume to a VM.
    pub async fn get_attach_info(
        &self,
        pool_id: &str,
        volume_id: &str,
    ) -> Result<VolumeAttachInfo> {
        let pool_type = {
            let pools = self.pools.read().await;
            pools.get(pool_id)
                .map(|p| p.pool_type)
                .ok_or_else(|| HypervisorError::Internal(
                    format!("Pool {} not found", pool_id)
                ))?
        };
        
        let backend = self.get_backend(pool_type)?;
        backend.get_attach_info(pool_id, volume_id).await
    }
    
    /// Resize a volume.
    #[instrument(skip(self), fields(pool_id = %pool_id, volume_id = %volume_id, new_size_bytes = %new_size_bytes))]
    pub async fn resize_volume(
        &self,
        pool_id: &str,
        volume_id: &str,
        new_size_bytes: u64,
    ) -> Result<()> {
        let pool_type = {
            let pools = self.pools.read().await;
            pools.get(pool_id)
                .map(|p| p.pool_type)
                .ok_or_else(|| HypervisorError::Internal(
                    format!("Pool {} not found", pool_id)
                ))?
        };
        
        let backend = self.get_backend(pool_type)?;
        backend.resize_volume(pool_id, volume_id, new_size_bytes).await?;
        
        info!("Volume resized");
        Ok(())
    }
    
    /// Clone a volume.
    #[instrument(skip(self), fields(pool_id = %pool_id, source_id = %source_volume_id, dest_id = %dest_volume_id))]
    pub async fn clone_volume(
        &self,
        pool_id: &str,
        source_volume_id: &str,
        dest_volume_id: &str,
    ) -> Result<()> {
        let pool_type = {
            let pools = self.pools.read().await;
            pools.get(pool_id)
                .map(|p| p.pool_type)
                .ok_or_else(|| HypervisorError::Internal(
                    format!("Pool {} not found", pool_id)
                ))?
        };
        
        let backend = self.get_backend(pool_type)?;
        backend.clone_volume(pool_id, source_volume_id, dest_volume_id).await?;
        
        info!("Volume cloned");
        Ok(())
    }
    
    /// Create a snapshot of a volume.
    #[instrument(skip(self), fields(pool_id = %pool_id, volume_id = %volume_id, snapshot_id = %snapshot_id))]
    pub async fn create_snapshot(
        &self,
        pool_id: &str,
        volume_id: &str,
        snapshot_id: &str,
    ) -> Result<()> {
        let pool_type = {
            let pools = self.pools.read().await;
            pools.get(pool_id)
                .map(|p| p.pool_type)
                .ok_or_else(|| HypervisorError::Internal(
                    format!("Pool {} not found", pool_id)
                ))?
        };
        
        let backend = self.get_backend(pool_type)?;
        backend.create_snapshot(pool_id, volume_id, snapshot_id).await?;
        
        info!("Snapshot created");
        Ok(())
    }
    
    /// List all pools.
    pub async fn list_pools(&self) -> Vec<PoolInfo> {
        let pools = self.pools.read().await;
        pools.values().cloned().collect()
    }
    
    /// Register an existing pool without initializing it.
    /// 
    /// This is useful when a pool mount already exists (e.g., after daemon restart)
    /// and we want to add it to the cache.
    pub async fn register_pool(&self, pool_info: PoolInfo) {
        let mut pools = self.pools.write().await;
        pools.insert(pool_info.pool_id.clone(), pool_info);
    }
    
    /// Try to discover a pool by checking if its mount path exists.
    /// 
    /// This is useful when a pool is not in cache but might be mounted.
    /// Returns None if the pool cannot be discovered.
    pub async fn try_discover_pool(&self, pool_id: &str) -> Option<PoolInfo> {
        use std::path::Path;
        use std::process::Command;
        
        // Check common mount paths for NFS and local pools
        let nfs_mount_base = "/var/lib/limiquantix/pools";
        let local_base = "/var/lib/limiquantix/local";
        
        // Check NFS mount path
        let nfs_path = format!("{}/{}", nfs_mount_base, pool_id);
        if let Some(pool_info) = self.try_discover_at_path(pool_id, &nfs_path, PoolType::Nfs).await {
            // Register and return
            self.register_pool(pool_info.clone()).await;
            return Some(pool_info);
        }
        
        // Check local directory path
        let local_path = format!("{}/{}", local_base, pool_id);
        if let Some(pool_info) = self.try_discover_at_path(pool_id, &local_path, PoolType::LocalDir).await {
            self.register_pool(pool_info.clone()).await;
            return Some(pool_info);
        }
        
        None
    }
    
    /// Helper to try discovering a pool at a specific path.
    async fn try_discover_at_path(&self, pool_id: &str, path: &str, pool_type: PoolType) -> Option<PoolInfo> {
        use std::path::Path;
        use std::process::Command;
        
        let path_buf = Path::new(path);
        
        // Check if path exists and is a directory
        if !path_buf.exists() || !path_buf.is_dir() {
            return None;
        }
        
        // For NFS, verify it's a mount point
        if pool_type == PoolType::Nfs {
            let status = Command::new("mountpoint")
                .arg("-q")
                .arg(path)
                .status()
                .ok()?;
            
            if !status.success() {
                return None;
            }
        }
        
        // Get filesystem stats
        let output = Command::new("df")
            .arg("--output=size,avail")
            .arg("-B1")
            .arg(path)
            .output()
            .ok()?;
        
        if !output.status.success() {
            return None;
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout.lines().collect();
        if lines.len() < 2 {
            return None;
        }
        
        let parts: Vec<&str> = lines[1].split_whitespace().collect();
        if parts.len() < 2 {
            return None;
        }
        
        let total_bytes: u64 = parts[0].parse().unwrap_or(0);
        let available_bytes: u64 = parts[1].parse().unwrap_or(0);
        
        info!(
            pool_id = %pool_id,
            path = %path,
            pool_type = ?pool_type,
            total_bytes = total_bytes,
            "Discovered existing pool mount"
        );
        
        Some(PoolInfo {
            pool_id: pool_id.to_string(),
            pool_type,
            mount_path: Some(path.to_string()),
            device_path: None,
            rbd_pool: None,
            total_bytes,
            available_bytes,
            volume_count: 0,
        })
    }
    
    /// Get pool info, with fallback to discovery if not in cache.
    /// 
    /// This method first checks the cache, then tries to discover the pool
    /// from existing mounts.
    pub async fn get_pool_info_or_discover(&self, pool_id: &str) -> Result<PoolInfo> {
        // First, try the cache
        if let Ok(pool) = self.get_pool_info(pool_id).await {
            return Ok(pool);
        }
        
        // Try to discover from existing mounts
        if let Some(pool) = self.try_discover_pool(pool_id).await {
            return Ok(pool);
        }
        
        Err(HypervisorError::Internal(
            format!("Pool {} not found in cache or mounts", pool_id)
        ))
    }
    
    /// List all volumes in a pool.
    #[instrument(skip(self), fields(pool_id = %pool_id))]
    pub async fn list_volumes(&self, pool_id: &str) -> Result<Vec<VolumeInfo>> {
        let pool_type = {
            let pools = self.pools.read().await;
            pools.get(pool_id)
                .map(|p| p.pool_type)
                .ok_or_else(|| HypervisorError::Internal(
                    format!("Pool {} not found", pool_id)
                ))?
        };
        
        let backend = self.get_backend(pool_type)?;
        backend.list_volumes(pool_id).await
    }
}

impl Default for StorageManager {
    fn default() -> Self {
        Self::new()
    }
}
