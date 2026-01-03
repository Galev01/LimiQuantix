# 000047 - Storage Backend: Ceph RBD Integration

**Purpose:** Design and implement Ceph RBD (RADOS Block Device) as the distributed storage backend for VM volumes.

**Status:** 🚧 In Progress

---

## Executive Summary

Ceph RBD provides distributed, replicated block storage for VM volumes. This integration enables:

1. **Distributed Storage** - Volumes accessible from any hypervisor node
2. **Live Migration** - VMs can move between nodes without copying disks
3. **High Availability** - Data replicated across OSDs (Object Storage Daemons)
4. **Snapshots** - Instant copy-on-write snapshots
5. **Thin Provisioning** - Allocate space on demand

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Control Plane (Go)                                 │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────┐│
│  │  VolumeService  │────▶│   StoragePool   │────▶│   CephStorageBackend    ││
│  │  - Create       │     │   Repository    │     │   - Pool management     ││
│  │  - Attach       │     │                 │     │   - Volume operations   ││
│  │  - Snapshot     │     │                 │     │   - RBD CLI wrapper     ││
│  └─────────────────┘     └─────────────────┘     └─────────────────────────┘│
└───────────────────────────────────────────────────────────────────────────── │
                                    │ gRPC                                      
                                    ▼                                           
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Node Daemon (Rust)                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  RBD Storage Adapter                                                    ││
│  │    - Map RBD images to block devices                                    ││
│  │    - Provide QEMU block access (rbd:// protocol)                        ││
│  │    - Manage local cache                                                 ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                    │                                           
                                    ▼                                           
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Ceph Cluster                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  MON     │  │  MON     │  │  MON     │  │  MGR     │  │  MGR     │      │
│  │ (Monitor)│  │ (Monitor)│  │ (Monitor)│  │ (Manager)│  │ (Manager)│      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│                                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  OSD     │  │  OSD     │  │  OSD     │  │  OSD     │  │  OSD     │      │
│  │ (SSD 1)  │  │ (SSD 2)  │  │ (HDD 1)  │  │ (HDD 2)  │  │ (NVMe 1) │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  RBD Pool: limiquantix-volumes                                          ││
│  │    ├── vm-123-disk-0  (50 GiB, thin provisioned)                        ││
│  │    ├── vm-123-disk-1  (100 GiB, SSD tier)                               ││
│  │    ├── vm-456-disk-0  (200 GiB, replicated 3x)                          ││
│  │    └── template-ubuntu-22.04 (base image)                               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Ceph Pool Configuration

### Create RBD Pool

```bash
# Create pool with appropriate PG count
ceph osd pool create limiquantix-volumes 128 128

# Enable RBD application
ceph osd pool application enable limiquantix-volumes rbd

# Initialize pool for RBD
rbd pool init limiquantix-volumes

# Set replication size (3 copies)
ceph osd pool set limiquantix-volumes size 3
ceph osd pool set limiquantix-volumes min_size 2
```

### Storage Tiers

```bash
# Create SSD tier pool
ceph osd pool create limiquantix-ssd 64 64
ceph osd pool set limiquantix-ssd crush_rule ssd_rule

# Create HDD tier pool
ceph osd pool create limiquantix-hdd 128 128
ceph osd pool set limiquantix-hdd crush_rule hdd_rule
```

---

## Proto Definitions

### StoragePool Configuration

```protobuf
// proto/limiquantix/storage/v1/storage.proto

message StoragePoolSpec {
  StorageBackend backend = 1;
  
  // Ceph-specific configuration
  CephConfig ceph_config = 10;
}

message CephConfig {
  // Ceph cluster configuration
  repeated string monitors = 1;  // ["10.0.0.1:6789", "10.0.0.2:6789"]
  string cluster_name = 2;       // Default: "ceph"
  
  // Pool configuration
  string pool_name = 3;          // "limiquantix-volumes"
  string namespace = 4;          // Optional namespace within pool
  
  // Authentication
  string user = 5;               // "admin" or service account
  string keyring_path = 6;       // "/etc/ceph/ceph.client.admin.keyring"
  
  // Features
  bool enable_exclusive_lock = 7;  // Required for live migration
  bool enable_journaling = 8;      // For mirroring
  
  // Default image features
  repeated string image_features = 9;  // ["layering", "exclusive-lock"]
}
```

### Volume Spec

```protobuf
message VolumeSpec {
  uint64 size_bytes = 1;
  VolumeType type = 2;
  QosConfig qos = 3;
  
  // RBD-specific options
  RbdOptions rbd_options = 10;
}

message RbdOptions {
  // Image format (2 = new format with features)
  uint32 image_format = 1;
  
  // Features to enable
  repeated string features = 2;  // ["layering", "exclusive-lock", "object-map"]
  
  // Stripe configuration
  uint64 stripe_unit = 3;        // Bytes per stripe (default: 4MiB)
  uint64 stripe_count = 4;       // Number of stripes (default: 1)
  
  // Data pool for erasure coding
  string data_pool = 5;
}
```

---

## Backend Implementation

### Go: Ceph Storage Backend

```go
// backend/internal/storage/ceph/backend.go
package ceph

import (
    "context"
    "fmt"
    "os/exec"
    "strconv"
    "strings"
    
    "github.com/ceph/go-ceph/rados"
    "github.com/ceph/go-ceph/rbd"
    "go.uber.org/zap"
    
    "github.com/limiquantix/limiquantix/internal/domain"
)

// CephBackend implements storage.Backend for Ceph RBD.
type CephBackend struct {
    conn     *rados.Conn
    pool     string
    ioctx    *rados.IOContext
    logger   *zap.Logger
}

// NewCephBackend creates a new Ceph storage backend.
func NewCephBackend(config *domain.CephConfig, logger *zap.Logger) (*CephBackend, error) {
    conn, err := rados.NewConnWithUser(config.User)
    if err != nil {
        return nil, fmt.Errorf("failed to create Ceph connection: %w", err)
    }
    
    if err := conn.ReadConfigFile(config.ConfigPath); err != nil {
        return nil, fmt.Errorf("failed to read Ceph config: %w", err)
    }
    
    if err := conn.Connect(); err != nil {
        return nil, fmt.Errorf("failed to connect to Ceph: %w", err)
    }
    
    ioctx, err := conn.OpenIOContext(config.PoolName)
    if err != nil {
        conn.Shutdown()
        return nil, fmt.Errorf("failed to open pool %s: %w", config.PoolName, err)
    }
    
    return &CephBackend{
        conn:   conn,
        pool:   config.PoolName,
        ioctx:  ioctx,
        logger: logger.Named("ceph-backend"),
    }, nil
}

// CreateVolume creates a new RBD image.
func (b *CephBackend) CreateVolume(ctx context.Context, vol *domain.Volume) error {
    imageName := b.volumeToImageName(vol.ID)
    sizeBytes := vol.Spec.SizeBytes
    
    b.logger.Info("Creating RBD image",
        zap.String("image", imageName),
        zap.Uint64("size_bytes", sizeBytes),
    )
    
    // Create image with features
    features := rbd.FeatureLayering | rbd.FeatureExclusiveLock | rbd.FeatureObjectMap
    
    _, err := rbd.Create3(b.ioctx, imageName, sizeBytes, features, 22) // order 22 = 4MB objects
    if err != nil {
        return fmt.Errorf("failed to create RBD image: %w", err)
    }
    
    return nil
}

// CreateVolumeFromImage creates a volume from a base image (clone).
func (b *CephBackend) CreateVolumeFromImage(ctx context.Context, vol *domain.Volume, baseImage string) error {
    // First, create a snapshot of the base image
    snapName := "protected-for-cloning"
    
    img, err := rbd.OpenImage(b.ioctx, baseImage, rbd.NoSnapshot)
    if err != nil {
        return fmt.Errorf("failed to open base image: %w", err)
    }
    defer img.Close()
    
    // Check if snapshot exists
    snapshots, err := img.GetSnapshotNames()
    if err != nil {
        return fmt.Errorf("failed to list snapshots: %w", err)
    }
    
    snapExists := false
    for _, snap := range snapshots {
        if snap.Name == snapName {
            snapExists = true
            break
        }
    }
    
    if !snapExists {
        // Create and protect snapshot
        snap, err := img.CreateSnapshot(snapName)
        if err != nil {
            return fmt.Errorf("failed to create snapshot: %w", err)
        }
        if err := snap.Protect(); err != nil {
            return fmt.Errorf("failed to protect snapshot: %w", err)
        }
    }
    
    // Clone the image
    features := rbd.FeatureLayering | rbd.FeatureExclusiveLock
    cloneName := b.volumeToImageName(vol.ID)
    
    _, err = img.Clone(snapName, b.ioctx, cloneName, features, 22)
    if err != nil {
        return fmt.Errorf("failed to clone image: %w", err)
    }
    
    // Resize if needed
    if vol.Spec.SizeBytes > 0 {
        clone, err := rbd.OpenImage(b.ioctx, cloneName, rbd.NoSnapshot)
        if err != nil {
            return fmt.Errorf("failed to open clone: %w", err)
        }
        defer clone.Close()
        
        if err := clone.Resize(vol.Spec.SizeBytes); err != nil {
            return fmt.Errorf("failed to resize clone: %w", err)
        }
    }
    
    return nil
}

// DeleteVolume removes an RBD image.
func (b *CephBackend) DeleteVolume(ctx context.Context, volumeID string) error {
    imageName := b.volumeToImageName(volumeID)
    
    b.logger.Info("Deleting RBD image", zap.String("image", imageName))
    
    img, err := rbd.OpenImage(b.ioctx, imageName, rbd.NoSnapshot)
    if err != nil {
        return fmt.Errorf("failed to open image: %w", err)
    }
    
    // Remove all snapshots first
    snapshots, _ := img.GetSnapshotNames()
    for _, snap := range snapshots {
        s := img.GetSnapshot(snap.Name)
        s.Unprotect()
        s.Remove()
    }
    
    img.Close()
    
    return rbd.RemoveImage(b.ioctx, imageName)
}

// ResizeVolume expands an RBD image.
func (b *CephBackend) ResizeVolume(ctx context.Context, volumeID string, newSize uint64) error {
    imageName := b.volumeToImageName(volumeID)
    
    img, err := rbd.OpenImage(b.ioctx, imageName, rbd.NoSnapshot)
    if err != nil {
        return fmt.Errorf("failed to open image: %w", err)
    }
    defer img.Close()
    
    return img.Resize(newSize)
}

// GetVolumeStats returns usage statistics for a volume.
func (b *CephBackend) GetVolumeStats(ctx context.Context, volumeID string) (*domain.VolumeStats, error) {
    imageName := b.volumeToImageName(volumeID)
    
    img, err := rbd.OpenImage(b.ioctx, imageName, rbd.NoSnapshot)
    if err != nil {
        return nil, fmt.Errorf("failed to open image: %w", err)
    }
    defer img.Close()
    
    size, err := img.GetSize()
    if err != nil {
        return nil, err
    }
    
    // Get disk usage
    du, err := img.DiffIterate(rbd.DiffIterateConfig{
        IncludeParent: true,
        WholeObject:   true,
    })
    // ... calculate used bytes from diff
    
    return &domain.VolumeStats{
        ProvisionedBytes: size,
        UsedBytes:        0, // Calculate from diff
    }, nil
}

// volumeToImageName converts a volume ID to an RBD image name.
func (b *CephBackend) volumeToImageName(volumeID string) string {
    return fmt.Sprintf("vol-%s", volumeID)
}

// Close cleans up the Ceph connection.
func (b *CephBackend) Close() error {
    if b.ioctx != nil {
        b.ioctx.Destroy()
    }
    if b.conn != nil {
        b.conn.Shutdown()
    }
    return nil
}
```

### Rust: Node Daemon RBD Support

```rust
// agent/limiquantix-hypervisor/src/storage/rbd.rs

use std::process::Command;
use anyhow::{Context, Result};
use tracing::{info, warn};

/// RBD storage adapter for Ceph.
pub struct RbdStorage {
    pool: String,
    monitors: Vec<String>,
    user: String,
}

impl RbdStorage {
    pub fn new(pool: String, monitors: Vec<String>, user: String) -> Self {
        Self { pool, monitors, user }
    }
    
    /// Get the QEMU block device specification for an RBD image.
    pub fn get_qemu_spec(&self, image_name: &str) -> String {
        let mon_hosts = self.monitors.join(";");
        format!(
            "rbd:{}/{}:mon_host={}:auth_supported=cephx:id={}",
            self.pool, image_name, mon_hosts, self.user
        )
    }
    
    /// Map an RBD image to a local block device.
    pub fn map_image(&self, image_name: &str) -> Result<String> {
        let output = Command::new("rbd")
            .args(["map", &format!("{}/{}", self.pool, image_name)])
            .output()
            .context("Failed to execute rbd map")?;
        
        if !output.status.success() {
            anyhow::bail!(
                "rbd map failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        
        let device = String::from_utf8_lossy(&output.stdout).trim().to_string();
        info!(image = %image_name, device = %device, "Mapped RBD image");
        
        Ok(device)
    }
    
    /// Unmap an RBD image from the local block device.
    pub fn unmap_image(&self, image_name: &str) -> Result<()> {
        let output = Command::new("rbd")
            .args(["unmap", &format!("{}/{}", self.pool, image_name)])
            .output()
            .context("Failed to execute rbd unmap")?;
        
        if !output.status.success() {
            warn!(
                image = %image_name,
                error = %String::from_utf8_lossy(&output.stderr),
                "Failed to unmap RBD image"
            );
        }
        
        Ok(())
    }
    
    /// Create a snapshot.
    pub fn create_snapshot(&self, image_name: &str, snap_name: &str) -> Result<()> {
        let output = Command::new("rbd")
            .args([
                "snap", "create",
                &format!("{}@{}", image_name, snap_name),
                "--pool", &self.pool,
            ])
            .output()
            .context("Failed to create snapshot")?;
        
        if !output.status.success() {
            anyhow::bail!(
                "Snapshot creation failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        
        Ok(())
    }
}
```

---

## QEMU Integration

### VM Disk Configuration

When a VM uses Ceph storage, the libvirt XML uses the `rbd` protocol:

```xml
<disk type='network' device='disk'>
  <driver name='qemu' type='raw' cache='writeback' discard='unmap'/>
  <source protocol='rbd' name='limiquantix-volumes/vol-abc123'>
    <host name='10.0.0.1' port='6789'/>
    <host name='10.0.0.2' port='6789'/>
    <host name='10.0.0.3' port='6789'/>
  </source>
  <auth username='libvirt'>
    <secret type='ceph' uuid='a5d4c91e-1234-5678-90ab-cdef12345678'/>
  </auth>
  <target dev='vda' bus='virtio'/>
</disk>
```

### Libvirt Secret Setup

```bash
# Create a secret for Ceph authentication
virsh secret-define --file ceph-secret.xml

# ceph-secret.xml
# <secret ephemeral='no' private='no'>
#   <uuid>a5d4c91e-1234-5678-90ab-cdef12345678</uuid>
#   <usage type='ceph'>
#     <name>client.libvirt secret</name>
#   </usage>
# </secret>

# Set the secret value (Ceph keyring)
ceph auth get-key client.libvirt | virsh secret-set-value --secret a5d4c91e-1234-5678-90ab-cdef12345678 --base64 -
```

---

## Performance Tuning

### Ceph Configuration

```ini
# /etc/ceph/ceph.conf

[client]
rbd_cache = true
rbd_cache_size = 134217728        # 128 MB
rbd_cache_max_dirty = 100663296   # 96 MB
rbd_cache_target_dirty = 67108864 # 64 MB
rbd_cache_writethrough_until_flush = false
rbd_concurrent_management_ops = 20

[osd]
osd_op_threads = 8
osd_disk_threads = 4
```

### QEMU/KVM Tuning

```xml
<!-- Disk caching and I/O mode -->
<driver name='qemu' type='raw' 
        cache='writeback' 
        discard='unmap' 
        io='native'/>
```

---

## Monitoring & Metrics

### Pool Metrics

```bash
# Pool usage
ceph df detail

# Pool I/O stats
ceph osd pool stats limiquantix-volumes

# Image usage
rbd du limiquantix-volumes
```

### Prometheus Metrics

The Ceph cluster exposes metrics via the MGR Prometheus module:

```yaml
# ceph_pool_stored_bytes
# ceph_pool_rd
# ceph_pool_wr
# ceph_rbd_read_bytes
# ceph_rbd_write_bytes
```

---

## Migration Requirements

For live migration with Ceph RBD:

1. **Exclusive Lock** feature must be enabled on images
2. All hypervisors must have access to the same Ceph cluster
3. Ceph client authentication must be configured on all nodes

```bash
# Verify exclusive lock feature
rbd info limiquantix-volumes/vol-abc123 | grep features
# Should show: exclusive-lock
```

---

## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| `rbd: error opening image` | Image doesn't exist | Check volume ID mapping |
| `rbd: image is locked` | Another client has exclusive lock | Wait for migration or force unlock |
| `HEALTH_WARN` | Ceph cluster degraded | Check OSD status |
| `ENOSPC` | Pool full | Add OSDs or delete unused images |

---

## Testing

```bash
# Create test image
rbd create --size 10G limiquantix-volumes/test-vol

# Map to local device
rbd map limiquantix-volumes/test-vol

# Write test data
dd if=/dev/urandom of=/dev/rbd0 bs=1M count=100

# Unmap
rbd unmap /dev/rbd0

# Delete
rbd rm limiquantix-volumes/test-vol
```

---

## Dependencies

### Go (Control Plane)

```go
// go.mod
require (
    github.com/ceph/go-ceph v0.27.0
)
```

### Rust (Node Daemon)

```toml
# Cargo.toml - uses CLI for now, native bindings available via ceph crate
# [dependencies]
# ceph = "0.x"  # Optional native bindings
```

### System Packages

```bash
# Ubuntu/Debian
apt install ceph-common librbd-dev librados-dev

# Rocky/AlmaLinux
dnf install ceph-common librbd-devel librados-devel
```
