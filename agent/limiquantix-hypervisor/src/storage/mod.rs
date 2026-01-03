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
mod types;
mod traits;

pub use local::*;
pub use nfs::*;
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
}

impl Default for StorageManager {
    fn default() -> Self {
        Self::new()
    }
}
