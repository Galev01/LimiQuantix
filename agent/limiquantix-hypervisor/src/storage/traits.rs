//! Storage backend trait definition.

use async_trait::async_trait;

use crate::error::Result;
use super::types::{PoolConfig, PoolInfo, VolumeAttachInfo, VolumeSource, VolumeInfo};

/// Storage backend trait - implemented by each storage type.
///
/// This trait defines the interface that all storage backends must implement.
/// The StorageManager uses this trait to route operations to the appropriate backend.
#[async_trait]
pub trait StorageBackend: Send + Sync {
    /// Initialize/mount the storage pool.
    ///
    /// This is called when a pool is first added to a node.
    /// For NFS, this mounts the share. For Ceph, this verifies connectivity.
    async fn init_pool(&self, pool_id: &str, config: &PoolConfig) -> Result<PoolInfo>;
    
    /// Destroy/unmount the storage pool.
    ///
    /// This is called when a pool is removed from a node.
    /// For NFS, this unmounts the share. For Ceph, this is a no-op.
    async fn destroy_pool(&self, pool_id: &str) -> Result<()>;
    
    /// Get pool status and metrics.
    ///
    /// Returns current capacity and health information.
    async fn get_pool_info(&self, pool_id: &str) -> Result<PoolInfo>;
    
    /// List all volumes in a pool.
    async fn list_volumes(&self, pool_id: &str) -> Result<Vec<VolumeInfo>>;
    
    /// Create a new volume in the pool.
    ///
    /// # Arguments
    /// * `pool_id` - The pool to create the volume in
    /// * `volume_id` - Unique identifier for the new volume
    /// * `size_bytes` - Size of the volume in bytes
    /// * `source` - Optional source for the volume (clone, image, etc.)
    async fn create_volume(
        &self,
        pool_id: &str,
        volume_id: &str,
        size_bytes: u64,
        source: Option<&VolumeSource>,
    ) -> Result<()>;
    
    /// Delete a volume.
    async fn delete_volume(&self, pool_id: &str, volume_id: &str) -> Result<()>;
    
    /// Resize a volume (grow only).
    ///
    /// Shrinking is not supported as it can cause data loss.
    async fn resize_volume(&self, pool_id: &str, volume_id: &str, new_size_bytes: u64) -> Result<()>;
    
    /// Get libvirt disk XML for attaching volume to VM.
    ///
    /// Returns the disk XML snippet that can be used with virsh attach-device.
    async fn get_attach_info(&self, pool_id: &str, volume_id: &str) -> Result<VolumeAttachInfo>;
    
    /// Clone a volume.
    ///
    /// Creates a copy of an existing volume. The implementation may use
    /// copy-on-write if the storage backend supports it.
    async fn clone_volume(
        &self,
        pool_id: &str,
        source_volume_id: &str,
        dest_volume_id: &str,
    ) -> Result<()>;
    
    /// Create a snapshot of a volume.
    async fn create_snapshot(
        &self,
        pool_id: &str,
        volume_id: &str,
        snapshot_id: &str,
    ) -> Result<()>;
}
