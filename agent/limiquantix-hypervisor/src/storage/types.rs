//! Storage type definitions.

use serde::{Deserialize, Serialize};

/// Type of storage pool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PoolType {
    /// Local directory (file-based)
    LocalDir,
    /// Local LVM (block-based)
    LocalLvm,
    /// NFS (file-based, network)
    Nfs,
    /// Ceph RBD (block-based, distributed)
    CephRbd,
    /// Ceph FS (file-based, distributed)
    CephFs,
    /// iSCSI (block-based, network)
    Iscsi,
}

/// Storage pool configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolConfig {
    /// NFS-specific configuration
    pub nfs: Option<NfsConfig>,
    /// Ceph-specific configuration
    pub ceph: Option<CephConfig>,
    /// iSCSI-specific configuration
    pub iscsi: Option<IscsiConfig>,
    /// Local directory configuration
    pub local: Option<LocalConfig>,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            nfs: None,
            ceph: None,
            iscsi: None,
            local: None,
        }
    }
}

impl PoolConfig {
    /// Create config for local directory.
    pub fn local(path: impl Into<String>) -> Self {
        Self {
            local: Some(LocalConfig { path: path.into() }),
            ..Default::default()
        }
    }
    
    /// Create config for NFS.
    pub fn nfs(server: impl Into<String>, export_path: impl Into<String>) -> Self {
        Self {
            nfs: Some(NfsConfig {
                server: server.into(),
                export_path: export_path.into(),
                version: "4.1".to_string(),
                options: String::new(),
                mount_point: None,
            }),
            ..Default::default()
        }
    }
    
    /// Create config for Ceph RBD.
    pub fn ceph(pool_name: impl Into<String>, monitors: Vec<String>) -> Self {
        Self {
            ceph: Some(CephConfig {
                cluster_id: String::new(),
                pool_name: pool_name.into(),
                monitors,
                user: "admin".to_string(),
                keyring_path: "/etc/ceph/ceph.client.admin.keyring".to_string(),
                namespace: String::new(),
                secret_uuid: None,
            }),
            ..Default::default()
        }
    }
}

/// Local directory configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConfig {
    /// Path to the local directory
    pub path: String,
}

/// NFS configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NfsConfig {
    /// NFS server address (e.g., "192.168.1.50" or "nfs.example.com")
    pub server: String,
    /// Export path on the NFS server (e.g., "/mnt/ssd-pool")
    pub export_path: String,
    /// NFS version: "3", "4", "4.1", "4.2"
    pub version: String,
    /// Mount options (e.g., "soft,timeo=100,retrans=2")
    pub options: String,
    /// Local mount point (auto-generated if None)
    pub mount_point: Option<String>,
}

impl Default for NfsConfig {
    fn default() -> Self {
        Self {
            server: String::new(),
            export_path: String::new(),
            version: "4.1".to_string(),
            options: "soft,timeo=100,retrans=2".to_string(),
            mount_point: None,
        }
    }
}

/// Ceph RBD configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CephConfig {
    /// Ceph cluster ID
    pub cluster_id: String,
    /// Ceph pool name
    pub pool_name: String,
    /// Monitor addresses (e.g., ["10.0.0.1:6789", "10.0.0.2:6789"])
    pub monitors: Vec<String>,
    /// Authentication user
    pub user: String,
    /// Path to the Ceph keyring file
    pub keyring_path: String,
    /// Namespace within the pool (for multi-tenancy)
    pub namespace: String,
    /// Libvirt Secret UUID for Ceph authentication
    pub secret_uuid: Option<String>,
}

/// iSCSI configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IscsiConfig {
    /// iSCSI target portal (e.g., "192.168.1.50:3260")
    pub portal: String,
    /// Target IQN (e.g., "iqn.2023-01.com.storage:ssd-pool")
    pub target: String,
    /// CHAP authentication enabled
    pub chap_enabled: bool,
    /// CHAP username
    pub chap_user: String,
    /// CHAP password
    pub chap_password: String,
    /// LUN to use
    pub lun: u32,
    /// LVM Volume Group name
    pub volume_group: Option<String>,
}

/// Information about a mounted/attached storage pool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolInfo {
    /// Pool ID
    pub pool_id: String,
    /// Pool type
    pub pool_type: PoolType,
    /// Mount path (for NFS, local dir)
    pub mount_path: Option<String>,
    /// Device path (for iSCSI, LVM)
    pub device_path: Option<String>,
    /// RBD pool name (for Ceph)
    pub rbd_pool: Option<String>,
    /// Total capacity in bytes
    pub total_bytes: u64,
    /// Available capacity in bytes
    pub available_bytes: u64,
}

/// Information needed to attach a volume to a VM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeAttachInfo {
    /// Volume ID
    pub volume_id: String,
    /// Libvirt disk XML snippet
    pub disk_xml: String,
    /// Path or identifier for the volume
    pub path: String,
}

/// Source for creating a volume.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VolumeSource {
    /// Clone from existing volume
    Clone(String),
    /// Create from backing image
    Image(String),
    /// Restore from snapshot
    Snapshot(String),
}

/// Information about a disk image.
#[derive(Debug, Clone)]
pub struct DiskInfo {
    /// Path to the disk image
    pub path: std::path::PathBuf,
    /// Disk format (qcow2, raw, etc.)
    pub format: String,
    /// Virtual size in bytes
    pub virtual_size: u64,
    /// Actual size on disk in bytes
    pub actual_size: u64,
    /// Backing file (for copy-on-write images)
    pub backing_file: Option<std::path::PathBuf>,
}

impl DiskInfo {
    /// Get the virtual size in GiB.
    pub fn virtual_size_gib(&self) -> u64 {
        self.virtual_size / 1024 / 1024 / 1024
    }
    
    /// Get the actual size in GiB.
    pub fn actual_size_gib(&self) -> f64 {
        self.actual_size as f64 / 1024.0 / 1024.0 / 1024.0
    }
}
