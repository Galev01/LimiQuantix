# ADR-003: Storage Model Design

**Status:** Accepted  
**Date:** 2025-01-01  
**Authors:** LimiQuantix Team

## Context

LimiQuantix requires a flexible storage abstraction that can:
- Support multiple backends (Ceph, local LVM, NFS, iSCSI)
- Provide enterprise features (QoS, encryption, tiering)
- Enable thin provisioning and snapshots
- Support OS image management

## Decision

We have designed a three-tier storage model:
1. **StoragePool** - Logical grouping of storage resources
2. **Volume** - Virtual disk that can be attached to VMs
3. **Image** - Bootable OS templates

### Key Design Principles

#### 1. Backend Abstraction

The storage pool abstracts different backends behind a common interface:

```protobuf
message StorageBackend {
  enum BackendType {
    CEPH_RBD = 0;    // Distributed block storage
    CEPH_CEPHFS = 1; // Distributed filesystem
    LOCAL_LVM = 2;   // Local logical volumes
    LOCAL_DIR = 3;   // Local directory (dev/test)
    NFS = 4;         // Network filesystem
    ISCSI = 5;       // iSCSI targets
  }
  BackendType type = 1;
  
  oneof config {
    CephConfig ceph = 2;
    LocalLvmConfig local_lvm = 3;
    // ...
  }
}
```

#### 2. Thin Provisioning by Default

Volumes use thin provisioning unless explicitly configured otherwise:

```protobuf
enum ProvisioningType {
  THIN = 0;       // Allocate on demand (default)
  THICK = 1;      // Pre-allocate space
}
```

#### 3. Volume Sources

Volumes can be created from multiple sources:

```protobuf
message VolumeSource {
  oneof source {
    EmptySource empty = 1;      // Blank disk
    CloneSource clone = 2;      // Copy of existing volume
    SnapshotSource snapshot = 3; // Restore from snapshot
    ImageSource image = 4;      // Boot from OS image
    UrlSource url = 5;          // Import from URL
  }
}
```

#### 4. Quality of Service

Per-volume QoS with burst support:

```protobuf
message VolumeQos {
  uint64 max_iops = 1;
  uint64 min_iops = 2;  // Guaranteed (reservation)
  uint64 max_throughput = 3;
  uint64 min_throughput = 4;
  
  // Burst allows temporary exceeding limits
  uint64 burst_iops = 5;
  uint64 burst_throughput = 6;
  uint32 burst_duration_sec = 7;
}
```

### Feature Coverage

| Feature | VMware Equivalent | LimiQuantix Implementation |
|---------|------------------|---------------------------|
| vSAN | VSAN Datastore | Ceph RBD pool |
| vVol | vVol | Volume abstraction |
| VMFS | VMFS Datastore | Local LVM pool |
| NFS Datastore | NFS Datastore | NFS pool |
| Storage Policy | SPBM | `VolumeQos` + `StoragePoolSpec` |
| SIOC | SIOC | `VolumeQos.max_iops` |
| Thin Provisioning | Thin VMDK | `ProvisioningType.THIN` |
| Linked Clones | Linked Clones | `CloneSource` with CoW |
| Snapshots | VM Snapshots | `VolumeSnapshot` |
| Encryption | VM Encryption | `EncryptionConfig` |

### Ceph Integration

Primary storage backend using Ceph RBD:

```protobuf
message CephConfig {
  string cluster_id = 1;     // Ceph cluster identifier
  string pool_name = 2;      // RADOS pool name
  repeated string monitors = 3; // Ceph monitors
  string user = 4;           // CephX user
  string keyring_path = 5;   // Auth keyring
  string namespace = 6;      // RBD namespace (multi-tenancy)
}
```

Benefits:
- **Distributed**: No single point of failure
- **Scalable**: Add OSDs to increase capacity
- **Efficient**: Copy-on-write snapshots and clones
- **Integrated**: Native QEMU/KVM support via librbd

## Consequences

### Positive

- **Multi-backend support** enables flexible deployment options
- **Ceph-first** provides enterprise-grade distributed storage
- **Thin provisioning** reduces storage waste
- **QoS guarantees** enable noisy-neighbor isolation
- **Snapshots** are efficient (CoW, not full copies)

### Negative

- **Ceph complexity**: Requires understanding Ceph operations
- **Performance overhead**: Network storage vs local NVMe
- **Abstraction cost**: Generic API may not expose all backend features

### Risks

1. **Ceph tuning**: Default configs may not be optimal
2. **Network bottleneck**: Storage traffic needs dedicated network

## Implementation Notes

### Volume Lifecycle

```
PENDING → CREATING → READY ↔ IN_USE
                        ↓
                    RESIZING
                        ↓
                    DELETING
```

### Snapshot Flow

```go
// Pseudo-code for creating a snapshot
func CreateSnapshot(volumeID, name string) (*VolumeSnapshot, error) {
    volume := getVolume(volumeID)
    
    switch volume.Pool.Backend.Type {
    case CEPH_RBD:
        // Use Ceph RBD snapshot
        err := ceph.CreateSnapshot(volume.BackendID, name)
    case LOCAL_LVM:
        // Use LVM snapshot
        err := lvm.CreateSnapshot(volume.BackendID, name)
    }
    
    return &VolumeSnapshot{
        ID: uuid.New(),
        Name: name,
        VolumeID: volumeID,
        Status: CREATING,
    }, nil
}
```

## References

- [Ceph RBD Documentation](https://docs.ceph.com/en/latest/rbd/)
- [VMware vSAN Design Guide](https://storagehub.vmware.com/t/vmware-vsan/)
- [OpenStack Cinder](https://docs.openstack.org/cinder/latest/)

