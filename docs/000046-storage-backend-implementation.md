# 000046 - Storage Backend Implementation Plan

**Purpose:** Detailed implementation plan for LimiQuantix storage backends to replace VMware's storage stack.

**Last Updated:** January 3, 2026

**Status:** 
- ✅ LocalBackend - Complete
- ✅ NfsBackend - Complete  
- ✅ CephBackend - Complete
- ✅ Node Daemon gRPC - Complete
- ✅ Control Plane Integration - Complete
- ⏳ iSCSI Backend - Pending
- ⏳ Frontend UI - Pending

---

## 1. Executive Summary

LimiQuantix must support two storage models to replace VMware vSphere:

1. **Consumed Storage**: Connecting to enterprise SAN/NAS (NFS, iSCSI)
2. **Hyper-Converged Storage**: Distributed storage (Ceph RBD)

### Storage Backend Types

| Type | Use Case | VMware Equivalent | Priority |
|------|----------|-------------------|----------|
| **LOCAL_DIR** | Development, testing | Local VMFS | P1 (exists) |
| **NFS** | Enterprise NAS, shared storage | NFS Datastore | P2 |
| **CEPH_RBD** | vSAN replacement, HCI | vSAN | P3 |
| **ISCSI** | Enterprise SAN connectivity | iSCSI Datastore | P4 |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CONTROL PLANE (Go)                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      StoragePoolService                              │    │
│  │  - CreatePool, GetPool, ListPools, DeletePool                       │    │
│  │  - GetPoolMetrics                                                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                       VolumeService                                  │    │
│  │  - CreateVolume, AttachVolume, DetachVolume                         │    │
│  │  - ResizeVolume, CloneVolume                                        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ gRPC
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          NODE DAEMON (Rust)                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      StorageManager                                  │    │
│  │  - Implements StorageBackend trait                                  │    │
│  │  - Routes to appropriate backend implementation                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│       ┌────────────────────────────┼────────────────────────────┐           │
│       ▼                            ▼                            ▼           │
│  ┌──────────┐              ┌──────────┐                  ┌──────────┐       │
│  │   NFS    │              │   CEPH   │                  │  ISCSI   │       │
│  │ Backend  │              │  Backend │                  │ Backend  │       │
│  └──────────┘              └──────────┘                  └──────────┘       │
│       │                          │                            │             │
│       ▼                          ▼                            ▼             │
│  ┌──────────┐              ┌──────────┐                  ┌──────────┐       │
│  │ mount -t │              │  rbd://  │                  │ iscsiadm │       │
│  │   nfs    │              │  librbd  │                  │   + LVM  │       │
│  └──────────┘              └──────────┘                  └──────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LIBVIRT / QEMU                                     │
│                                                                              │
│  NFS:    <disk type='file'> /var/lib/limiquantix/pools/xxx/disk.qcow2      │
│  CEPH:   <disk type='network' protocol='rbd'>                               │
│  ISCSI:  <disk type='block'> /dev/mapper/lvm-volume                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Proto Definitions (Updated)

### CephConfig

```protobuf
message CephConfig {
  string cluster_id = 1;
  string pool_name = 2;
  repeated string monitors = 3;  // ["10.0.0.1:6789"]
  string user = 4;               // "libvirt"
  string keyring_path = 5;       // "/etc/ceph/ceph.client.libvirt.keyring"
  string namespace = 6;          // For multi-tenancy
  string secret_uuid = 7;        // Libvirt Secret UUID for auth
}
```

### NfsConfig

```protobuf
message NfsConfig {
  string server = 1;        // "192.168.1.50"
  string export_path = 2;   // "/mnt/ssd-pool"
  string version = 3;       // "4.1"
  string options = 4;       // "soft,timeo=100"
  string mount_point = 5;   // Auto-generated local mount path
}
```

### IscsiConfig

```protobuf
message IscsiConfig {
  string portal = 1;        // "192.168.1.50:3260"
  string target = 2;        // "iqn.2023-01.com.storage:ssd-pool"
  bool chap_enabled = 3;
  string chap_user = 4;
  string chap_password = 5;
  uint32 lun = 6;
  string volume_group = 7;  // LVM VG name
}
```

---

## 4. Rust Implementation

### 4.1 Module Structure

```
agent/limiquantix-hypervisor/src/storage/
├── mod.rs           # StorageBackend trait + StorageManager
├── local.rs         # Local directory backend (exists as storage.rs)
├── nfs.rs           # NFS mount/unmount + dir pool
├── ceph.rs          # Ceph RBD via librbd CLI
├── iscsi.rs         # iSCSI discovery, login, LVM
└── xml.rs           # Libvirt XML generators for network disks
```

### 4.2 StorageBackend Trait

```rust
use async_trait::async_trait;
use crate::error::Result;

/// Information about a mounted/attached storage pool
pub struct PoolInfo {
    pub pool_id: String,
    pub pool_type: PoolType,
    pub mount_path: Option<String>,    // For NFS
    pub device_path: Option<String>,   // For iSCSI
    pub rbd_pool: Option<String>,      // For Ceph
    pub total_bytes: u64,
    pub available_bytes: u64,
}

/// Information needed to attach a volume to a VM
pub struct VolumeAttachInfo {
    pub volume_id: String,
    pub disk_xml: String,  // Libvirt disk XML snippet
}

/// Storage backend trait - implemented by each storage type
#[async_trait]
pub trait StorageBackend: Send + Sync {
    /// Initialize/mount the storage pool
    async fn init_pool(&self, pool_id: &str, config: &StorageBackendConfig) -> Result<PoolInfo>;
    
    /// Destroy/unmount the storage pool
    async fn destroy_pool(&self, pool_id: &str) -> Result<()>;
    
    /// Get pool status and metrics
    async fn get_pool_info(&self, pool_id: &str) -> Result<PoolInfo>;
    
    /// Create a new volume in the pool
    async fn create_volume(
        &self,
        pool_id: &str,
        volume_id: &str,
        size_bytes: u64,
        source: Option<&VolumeSource>,
    ) -> Result<()>;
    
    /// Delete a volume
    async fn delete_volume(&self, pool_id: &str, volume_id: &str) -> Result<()>;
    
    /// Resize a volume (grow only)
    async fn resize_volume(&self, pool_id: &str, volume_id: &str, new_size_bytes: u64) -> Result<()>;
    
    /// Get libvirt disk XML for attaching volume to VM
    async fn get_attach_info(&self, pool_id: &str, volume_id: &str) -> Result<VolumeAttachInfo>;
    
    /// Clone a volume
    async fn clone_volume(
        &self,
        pool_id: &str,
        source_volume_id: &str,
        dest_volume_id: &str,
    ) -> Result<()>;
    
    /// Create a snapshot
    async fn create_snapshot(
        &self,
        pool_id: &str,
        volume_id: &str,
        snapshot_id: &str,
    ) -> Result<()>;
}
```

### 4.3 NFS Backend Implementation

```rust
// agent/limiquantix-hypervisor/src/storage/nfs.rs

use std::path::PathBuf;
use std::process::Command;
use async_trait::async_trait;
use tracing::{info, warn, instrument};

use crate::error::{HypervisorError, Result};
use super::{StorageBackend, PoolInfo, VolumeAttachInfo, VolumeSource};

pub struct NfsBackend {
    base_path: PathBuf,
}

impl NfsBackend {
    pub fn new() -> Self {
        Self {
            base_path: PathBuf::from("/var/lib/limiquantix/pools"),
        }
    }
    
    fn mount_point(&self, pool_id: &str) -> PathBuf {
        self.base_path.join(pool_id)
    }
    
    #[instrument(skip(self))]
    pub fn mount_nfs(
        &self,
        pool_id: &str,
        server: &str,
        export_path: &str,
        version: &str,
        options: &str,
    ) -> Result<PathBuf> {
        let mount_point = self.mount_point(pool_id);
        
        // Create mount point directory
        std::fs::create_dir_all(&mount_point)
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to create mount point: {}", e)
            ))?;
        
        // Check if already mounted
        if self.is_mounted(&mount_point)? {
            info!(pool_id = %pool_id, "NFS already mounted");
            return Ok(mount_point);
        }
        
        // Build mount options
        let mut mount_opts = vec![format!("vers={}", version)];
        if !options.is_empty() {
            mount_opts.push(options.to_string());
        }
        let opts_str = mount_opts.join(",");
        
        // Execute mount command
        let source = format!("{}:{}", server, export_path);
        let status = Command::new("mount")
            .arg("-t").arg("nfs")
            .arg("-o").arg(&opts_str)
            .arg(&source)
            .arg(&mount_point)
            .status()
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to execute mount: {}", e)
            ))?;
        
        if !status.success() {
            return Err(HypervisorError::Internal(
                format!("mount failed with exit code: {:?}", status.code())
            ));
        }
        
        info!(
            pool_id = %pool_id,
            source = %source,
            mount_point = %mount_point.display(),
            "NFS mounted successfully"
        );
        
        Ok(mount_point)
    }
    
    #[instrument(skip(self))]
    pub fn unmount_nfs(&self, pool_id: &str) -> Result<()> {
        let mount_point = self.mount_point(pool_id);
        
        if !self.is_mounted(&mount_point)? {
            info!(pool_id = %pool_id, "NFS not mounted, nothing to unmount");
            return Ok(());
        }
        
        let status = Command::new("umount")
            .arg(&mount_point)
            .status()
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to execute umount: {}", e)
            ))?;
        
        if !status.success() {
            return Err(HypervisorError::Internal(
                format!("umount failed with exit code: {:?}", status.code())
            ));
        }
        
        // Remove mount point directory
        if let Err(e) = std::fs::remove_dir(&mount_point) {
            warn!(error = %e, "Failed to remove mount point directory");
        }
        
        info!(pool_id = %pool_id, "NFS unmounted successfully");
        Ok(())
    }
    
    fn is_mounted(&self, path: &PathBuf) -> Result<bool> {
        let output = Command::new("mountpoint")
            .arg("-q")
            .arg(path)
            .status()
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to check mount: {}", e)
            ))?;
        
        Ok(output.success())
    }
    
    fn get_fs_stats(&self, path: &PathBuf) -> Result<(u64, u64)> {
        // Use statvfs to get filesystem stats
        let output = Command::new("df")
            .arg("--output=size,avail")
            .arg("-B1")
            .arg(path)
            .output()
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to get fs stats: {}", e)
            ))?;
        
        if !output.status.success() {
            return Err(HypervisorError::Internal("df command failed".into()));
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout.lines().collect();
        if lines.len() < 2 {
            return Err(HypervisorError::Internal("Unexpected df output".into()));
        }
        
        let parts: Vec<&str> = lines[1].split_whitespace().collect();
        if parts.len() < 2 {
            return Err(HypervisorError::Internal("Unexpected df output format".into()));
        }
        
        let total: u64 = parts[0].parse().unwrap_or(0);
        let available: u64 = parts[1].parse().unwrap_or(0);
        
        Ok((total, available))
    }
}

#[async_trait]
impl StorageBackend for NfsBackend {
    async fn init_pool(&self, pool_id: &str, config: &StorageBackendConfig) -> Result<PoolInfo> {
        let nfs_config = config.nfs.as_ref()
            .ok_or_else(|| HypervisorError::InvalidConfig("NFS config required".into()))?;
        
        let mount_path = self.mount_nfs(
            pool_id,
            &nfs_config.server,
            &nfs_config.export_path,
            &nfs_config.version,
            &nfs_config.options,
        )?;
        
        let (total, available) = self.get_fs_stats(&mount_path)?;
        
        Ok(PoolInfo {
            pool_id: pool_id.to_string(),
            pool_type: PoolType::Nfs,
            mount_path: Some(mount_path.to_string_lossy().to_string()),
            device_path: None,
            rbd_pool: None,
            total_bytes: total,
            available_bytes: available,
        })
    }
    
    async fn destroy_pool(&self, pool_id: &str) -> Result<()> {
        self.unmount_nfs(pool_id)
    }
    
    async fn get_pool_info(&self, pool_id: &str) -> Result<PoolInfo> {
        let mount_path = self.mount_point(pool_id);
        
        if !self.is_mounted(&mount_path)? {
            return Err(HypervisorError::InvalidConfig(
                format!("Pool {} is not mounted", pool_id)
            ));
        }
        
        let (total, available) = self.get_fs_stats(&mount_path)?;
        
        Ok(PoolInfo {
            pool_id: pool_id.to_string(),
            pool_type: PoolType::Nfs,
            mount_path: Some(mount_path.to_string_lossy().to_string()),
            device_path: None,
            rbd_pool: None,
            total_bytes: total,
            available_bytes: available,
        })
    }
    
    async fn create_volume(
        &self,
        pool_id: &str,
        volume_id: &str,
        size_bytes: u64,
        source: Option<&VolumeSource>,
    ) -> Result<()> {
        let mount_path = self.mount_point(pool_id);
        let volume_path = mount_path.join(format!("{}.qcow2", volume_id));
        
        match source {
            Some(VolumeSource::Clone(source_id)) => {
                // Clone from existing volume
                let source_path = mount_path.join(format!("{}.qcow2", source_id));
                let status = Command::new("qemu-img")
                    .arg("create")
                    .arg("-f").arg("qcow2")
                    .arg("-F").arg("qcow2")
                    .arg("-b").arg(&source_path)
                    .arg(&volume_path)
                    .status()
                    .map_err(|e| HypervisorError::Internal(format!("qemu-img failed: {}", e)))?;
                
                if !status.success() {
                    return Err(HypervisorError::Internal("qemu-img clone failed".into()));
                }
            }
            Some(VolumeSource::Image(image_path)) => {
                // Create overlay on image
                let status = Command::new("qemu-img")
                    .arg("create")
                    .arg("-f").arg("qcow2")
                    .arg("-F").arg("qcow2")
                    .arg("-b").arg(image_path)
                    .arg(&volume_path)
                    .status()
                    .map_err(|e| HypervisorError::Internal(format!("qemu-img failed: {}", e)))?;
                
                if !status.success() {
                    return Err(HypervisorError::Internal("qemu-img create failed".into()));
                }
                
                // Resize if needed
                if size_bytes > 0 {
                    let _ = Command::new("qemu-img")
                        .arg("resize")
                        .arg(&volume_path)
                        .arg(format!("{}", size_bytes))
                        .status();
                }
            }
            None => {
                // Create empty volume
                let status = Command::new("qemu-img")
                    .arg("create")
                    .arg("-f").arg("qcow2")
                    .arg(&volume_path)
                    .arg(format!("{}", size_bytes))
                    .status()
                    .map_err(|e| HypervisorError::Internal(format!("qemu-img failed: {}", e)))?;
                
                if !status.success() {
                    return Err(HypervisorError::Internal("qemu-img create failed".into()));
                }
            }
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, "Volume created");
        Ok(())
    }
    
    async fn delete_volume(&self, pool_id: &str, volume_id: &str) -> Result<()> {
        let mount_path = self.mount_point(pool_id);
        let volume_path = mount_path.join(format!("{}.qcow2", volume_id));
        
        if volume_path.exists() {
            std::fs::remove_file(&volume_path)
                .map_err(|e| HypervisorError::Internal(format!("Failed to delete volume: {}", e)))?;
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, "Volume deleted");
        Ok(())
    }
    
    async fn resize_volume(&self, pool_id: &str, volume_id: &str, new_size_bytes: u64) -> Result<()> {
        let mount_path = self.mount_point(pool_id);
        let volume_path = mount_path.join(format!("{}.qcow2", volume_id));
        
        let status = Command::new("qemu-img")
            .arg("resize")
            .arg(&volume_path)
            .arg(format!("{}", new_size_bytes))
            .status()
            .map_err(|e| HypervisorError::Internal(format!("qemu-img resize failed: {}", e)))?;
        
        if !status.success() {
            return Err(HypervisorError::Internal("qemu-img resize failed".into()));
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, new_size = %new_size_bytes, "Volume resized");
        Ok(())
    }
    
    async fn get_attach_info(&self, pool_id: &str, volume_id: &str) -> Result<VolumeAttachInfo> {
        let mount_path = self.mount_point(pool_id);
        let volume_path = mount_path.join(format!("{}.qcow2", volume_id));
        
        // NFS uses standard file-based disk XML
        let disk_xml = format!(r#"
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2' cache='writeback'/>
      <source file='{}'/>
      <target dev='vdX' bus='virtio'/>
    </disk>
"#, volume_path.display());
        
        Ok(VolumeAttachInfo {
            volume_id: volume_id.to_string(),
            disk_xml,
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
        let mount_path = self.mount_point(pool_id);
        let volume_path = mount_path.join(format!("{}.qcow2", volume_id));
        
        let status = Command::new("qemu-img")
            .arg("snapshot")
            .arg("-c").arg(snapshot_id)
            .arg(&volume_path)
            .status()
            .map_err(|e| HypervisorError::Internal(format!("qemu-img snapshot failed: {}", e)))?;
        
        if !status.success() {
            return Err(HypervisorError::Internal("qemu-img snapshot failed".into()));
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, snapshot_id = %snapshot_id, "Snapshot created");
        Ok(())
    }
}
```

### 4.4 Ceph RBD Backend

```rust
// agent/limiquantix-hypervisor/src/storage/ceph.rs

use std::process::Command;
use async_trait::async_trait;
use tracing::{info, instrument};

use crate::error::{HypervisorError, Result};
use super::{StorageBackend, PoolInfo, VolumeAttachInfo, VolumeSource};

pub struct CephBackend;

impl CephBackend {
    pub fn new() -> Self {
        Self
    }
    
    fn rbd_image_name(pool_name: &str, volume_id: &str) -> String {
        format!("{}/{}", pool_name, volume_id)
    }
}

#[async_trait]
impl StorageBackend for CephBackend {
    async fn init_pool(&self, pool_id: &str, config: &StorageBackendConfig) -> Result<PoolInfo> {
        let ceph_config = config.ceph.as_ref()
            .ok_or_else(|| HypervisorError::InvalidConfig("Ceph config required".into()))?;
        
        // Verify Ceph connectivity
        let status = Command::new("rbd")
            .arg("ls")
            .arg(&ceph_config.pool_name)
            .status()
            .map_err(|e| HypervisorError::Internal(format!("rbd command failed: {}", e)))?;
        
        if !status.success() {
            return Err(HypervisorError::Internal(
                format!("Cannot connect to Ceph pool {}", ceph_config.pool_name)
            ));
        }
        
        // Get pool stats
        let output = Command::new("rbd")
            .arg("pool")
            .arg("stats")
            .arg(&ceph_config.pool_name)
            .arg("--format=json")
            .output()
            .map_err(|e| HypervisorError::Internal(format!("rbd stats failed: {}", e)))?;
        
        // Parse stats (simplified)
        let total_bytes = 1_000_000_000_000; // 1TB placeholder
        let available_bytes = 500_000_000_000; // 500GB placeholder
        
        Ok(PoolInfo {
            pool_id: pool_id.to_string(),
            pool_type: PoolType::CephRbd,
            mount_path: None,
            device_path: None,
            rbd_pool: Some(ceph_config.pool_name.clone()),
            total_bytes,
            available_bytes,
        })
    }
    
    async fn destroy_pool(&self, _pool_id: &str) -> Result<()> {
        // Ceph pools are not destroyed by limiquantix
        // They are managed externally
        Ok(())
    }
    
    async fn get_pool_info(&self, pool_id: &str) -> Result<PoolInfo> {
        // Return cached pool info
        todo!("Implement Ceph pool info retrieval")
    }
    
    async fn create_volume(
        &self,
        pool_id: &str,
        volume_id: &str,
        size_bytes: u64,
        source: Option<&VolumeSource>,
    ) -> Result<()> {
        let pool_name = pool_id; // Simplified - use pool_id as pool_name
        
        match source {
            Some(VolumeSource::Clone(source_id)) => {
                // Clone from existing RBD image
                let source_image = Self::rbd_image_name(pool_name, source_id);
                let dest_image = Self::rbd_image_name(pool_name, volume_id);
                
                let status = Command::new("rbd")
                    .arg("clone")
                    .arg(&source_image)
                    .arg(&dest_image)
                    .status()
                    .map_err(|e| HypervisorError::Internal(format!("rbd clone failed: {}", e)))?;
                
                if !status.success() {
                    return Err(HypervisorError::Internal("rbd clone failed".into()));
                }
            }
            _ => {
                // Create new RBD image
                let image_name = Self::rbd_image_name(pool_name, volume_id);
                
                let status = Command::new("rbd")
                    .arg("create")
                    .arg(&image_name)
                    .arg("--size").arg(format!("{}", size_bytes / 1024 / 1024)) // Size in MB
                    .status()
                    .map_err(|e| HypervisorError::Internal(format!("rbd create failed: {}", e)))?;
                
                if !status.success() {
                    return Err(HypervisorError::Internal("rbd create failed".into()));
                }
            }
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, "RBD volume created");
        Ok(())
    }
    
    async fn delete_volume(&self, pool_id: &str, volume_id: &str) -> Result<()> {
        let image_name = Self::rbd_image_name(pool_id, volume_id);
        
        let status = Command::new("rbd")
            .arg("rm")
            .arg(&image_name)
            .status()
            .map_err(|e| HypervisorError::Internal(format!("rbd rm failed: {}", e)))?;
        
        if !status.success() {
            return Err(HypervisorError::Internal("rbd rm failed".into()));
        }
        
        info!(pool_id = %pool_id, volume_id = %volume_id, "RBD volume deleted");
        Ok(())
    }
    
    async fn resize_volume(&self, pool_id: &str, volume_id: &str, new_size_bytes: u64) -> Result<()> {
        let image_name = Self::rbd_image_name(pool_id, volume_id);
        
        let status = Command::new("rbd")
            .arg("resize")
            .arg(&image_name)
            .arg("--size").arg(format!("{}", new_size_bytes / 1024 / 1024))
            .status()
            .map_err(|e| HypervisorError::Internal(format!("rbd resize failed: {}", e)))?;
        
        if !status.success() {
            return Err(HypervisorError::Internal("rbd resize failed".into()));
        }
        
        Ok(())
    }
    
    async fn get_attach_info(&self, pool_id: &str, volume_id: &str) -> Result<VolumeAttachInfo> {
        // Ceph uses network disk XML
        // Note: secret_uuid must be configured in libvirt
        let disk_xml = format!(r#"
    <disk type='network' device='disk'>
      <driver name='qemu' type='raw'/>
      <source protocol='rbd' name='{}/{}'>
        <host name='MONITOR_HOST' port='6789'/>
      </source>
      <auth username='libvirt'>
        <secret type='ceph' uuid='SECRET_UUID'/>
      </auth>
      <target dev='vdX' bus='virtio'/>
    </disk>
"#, pool_id, volume_id);
        
        Ok(VolumeAttachInfo {
            volume_id: volume_id.to_string(),
            disk_xml,
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
        let image_name = Self::rbd_image_name(pool_id, volume_id);
        
        let status = Command::new("rbd")
            .arg("snap")
            .arg("create")
            .arg(format!("{}@{}", image_name, snapshot_id))
            .status()
            .map_err(|e| HypervisorError::Internal(format!("rbd snap failed: {}", e)))?;
        
        if !status.success() {
            return Err(HypervisorError::Internal("rbd snap create failed".into()));
        }
        
        Ok(())
    }
}
```

---

## 5. Libvirt XML Generation

### 5.1 NFS (File-based)

```xml
<disk type='file' device='disk'>
  <driver name='qemu' type='qcow2' cache='writeback'/>
  <source file='/var/lib/limiquantix/pools/pool-123/vm-456-disk-0.qcow2'/>
  <target dev='vda' bus='virtio'/>
</disk>
```

### 5.2 Ceph RBD (Network)

```xml
<disk type='network' device='disk'>
  <driver name='qemu' type='raw'/>
  <source protocol='rbd' name='libvirt-pool/vm-456-disk-0'>
    <host name='10.0.0.1' port='6789'/>
    <host name='10.0.0.2' port='6789'/>
    <host name='10.0.0.3' port='6789'/>
  </source>
  <auth username='libvirt'>
    <secret type='ceph' uuid='a5d0dd94-57c4-ae55-ffe0-7e3732a24455'/>
  </auth>
  <target dev='vda' bus='virtio'/>
</disk>
```

### 5.3 iSCSI via LVM (Block)

```xml
<disk type='block' device='disk'>
  <driver name='qemu' type='raw' cache='none' io='native'/>
  <source dev='/dev/mapper/vg_iscsi-lv_vm456_disk0'/>
  <target dev='vda' bus='virtio'/>
</disk>
```

---

## 6. Implementation Timeline

### Phase 1: NFS (Week 1)
- [ ] Create storage module structure
- [ ] Implement NfsBackend with mount/unmount
- [ ] Integrate with existing StorageManager
- [ ] Add unit tests
- [ ] Update XML builder for file-based disks

### Phase 2: Ceph RBD (Week 2)
- [ ] Implement CephBackend with rbd CLI
- [ ] Add libvirt secret management
- [ ] Update XML builder for network disks
- [ ] Integration testing with real Ceph cluster

### Phase 3: iSCSI (Week 3)
- [ ] Implement IscsiBackend
- [ ] Add iscsiadm integration
- [ ] Add LVM management
- [ ] Update XML builder for block devices

### Phase 4: Control Plane Integration (Week 4)
- [ ] Add StoragePoolService in Go backend
- [ ] Integrate with Node Daemon gRPC
- [ ] Add storage pool UI in frontend
- [ ] End-to-end testing

---

## 7. Testing Strategy

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_nfs_mount_unmount() {
        // Requires NFS server for integration testing
        // Use mock for unit tests
    }
    
    #[tokio::test]
    async fn test_volume_create_delete() {
        let backend = NfsBackend::new();
        // ...
    }
}
```

### Integration Tests

1. **NFS Test Environment**: Set up local NFS server in Docker
2. **Ceph Test Environment**: Use Ceph single-node container
3. **iSCSI Test Environment**: Use targetcli for iSCSI target

---

## 8. References

- [Ceph RBD Documentation](https://docs.ceph.com/en/latest/rbd/)
- [Libvirt Storage Documentation](https://libvirt.org/storage.html)
- [Libvirt Domain XML - Disks](https://libvirt.org/formatdomain.html#hard-drives-floppy-disks-cdroms)
- [NFS Best Practices for Virtualization](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/7/html/storage_administration_guide/ch-nfs)
