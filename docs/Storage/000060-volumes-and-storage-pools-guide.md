# Volumes and Storage Pools: Complete Guide

**Document ID:** 000060  
**Date:** January 11, 2026  
**Scope:** Storage architecture, volumes, storage pools

## Executive Summary

Quantix-KVM introduces a **modern, cloud-native storage model** that separates storage containers (Pools) from individual virtual disks (Volumes). This architecture provides significant advantages over traditional VMware datastores, including independent disk lifecycle management, portable storage, and API-first automation.

---

## Terminology Mapping

| VMware Term | Quantix Term | Description |
|-------------|--------------|-------------|
| Datastore | **Storage Pool** | Container backed by shared/local storage |
| VMDK file | **Volume** | First-class virtual disk with independent lifecycle |
| Datastore Cluster | Pool Group (future) | Aggregate of multiple pools for DRS |
| VMFS | N/A | Quantix uses QCOW2 on any filesystem |
| vVol | Volume (native) | API-managed disks are default, not optional |

---

## Storage Pools

### What is a Storage Pool?

A **Storage Pool** is a logical container that abstracts the underlying storage backend. It represents a mountable storage location where volumes (virtual disks) are stored.

### Supported Backend Types

| Type | Description | Use Case |
|------|-------------|----------|
| **NFS** | Network File System share | Shared storage, easy setup |
| **Ceph RBD** | RADOS Block Device | Enterprise distributed storage |
| **Ceph FS** | Ceph Filesystem | POSIX-compatible shared storage |
| **Local Directory** | Path on host filesystem | Development, single-node |
| **Local LVM** | LVM volume group | Production local storage |
| **iSCSI** | iSCSI target LUNs | Block storage over network |

### Pool Configuration

```yaml
# Example: NFS Pool
name: "prod-nfs-01"
type: NFS
backend:
  nfs:
    server: "192.168.1.100"
    export_path: "/exports/vms"
    version: "4.1"
    options: "rw,sync,no_root_squash"
```

### Pool Status Phases

| Phase | Description |
|-------|-------------|
| `PENDING` | Pool created, awaiting initialization on nodes |
| `READY` | Pool mounted and operational |
| `DEGRADED` | Pool accessible but with issues |
| `ERROR` | Pool failed to initialize |
| `DELETING` | Pool being removed |

### Host Assignment

Storage pools can be **assigned to specific hosts**:

- **Shared storage** (NFS, Ceph): Assign to multiple hosts
- **Local storage**: Typically assigned to a single host

VMs can only be created on hosts that have access to the selected storage pool.

---

## Volumes

### What is a Volume?

A **Volume** is a first-class API resource representing a virtual disk (QCOW2 file). Unlike VMware VMDKs which are just files inside a datastore, Quantix volumes are:

1. **Independently managed** - Create, delete, snapshot without a VM
2. **Attachable/Detachable** - Move between VMs
3. **API-addressable** - Full CRUD operations via REST/gRPC
4. **Tracked with metadata** - Labels, QoS, encryption settings

### Volume vs VMDK Comparison

| Aspect | VMware VMDK | Quantix Volume |
|--------|-------------|----------------|
| **Identity** | File path | UUID + API object |
| **Lifecycle** | Tied to VM | Independent |
| **Management** | Via VM or file browser | First-class API |
| **Portability** | Copy file manually | Detach/Attach API |
| **Snapshots** | VM-level only | Volume-level independent |
| **Cloning** | Linked clones complex | Simple API call |
| **QoS** | Per-VM | Per-volume granular |
| **Encryption** | VM-level | Per-volume |

### Volume Provisioning Types

| Type | Behavior | Use Case |
|------|----------|----------|
| **Thin** | Grows on write | Default, space efficient |
| **Thick Lazy** | Allocated, zero on write | Balanced |
| **Thick Eager** | Pre-zeroed | Maximum performance |

### Volume Status Phases

| Phase | Description |
|-------|-------------|
| `PENDING` | Volume created in API, not yet on storage |
| `CREATING` | Volume being provisioned |
| `READY` | Available for attachment |
| `IN_USE` | Attached to a running VM |
| `RESIZING` | Online resize in progress |
| `ERROR` | Volume operation failed |
| `DELETING` | Volume being removed |

### Volume Access Modes

| Mode | Description |
|------|-------------|
| `READ_WRITE_ONCE` | Single writer (default) |
| `READ_ONLY_MANY` | Multiple readers, no writers |
| `READ_WRITE_MANY` | Multiple writers (shared disk) |

---

## API Examples

### Create a Volume

```bash
# REST API
curl -X POST http://localhost:8080/storage.v1.VolumeService/CreateVolume \
  -H "Content-Type: application/json" \
  -d '{
    "name": "prod-db-data",
    "poolId": "pool-nfs-01",
    "projectId": "default",
    "spec": {
      "sizeBytes": 107374182400,  // 100 GB
      "provisioning": "THIN"
    }
  }'
```

### Attach Volume to VM

```bash
curl -X POST http://localhost:8080/storage.v1.VolumeService/AttachVolume \
  -d '{
    "volumeId": "vol-abc123",
    "vmId": "vm-xyz789",
    "targetBus": "virtio",
    "bootOrder": 0
  }'
```

### Detach and Reattach to Different VM

```bash
# Detach from VM-1
curl -X POST http://localhost:8080/storage.v1.VolumeService/DetachVolume \
  -d '{"volumeId": "vol-abc123"}'

# Attach to VM-2
curl -X POST http://localhost:8080/storage.v1.VolumeService/AttachVolume \
  -d '{"volumeId": "vol-abc123", "vmId": "vm-other456"}'
```

### Clone a Volume

```bash
curl -X POST http://localhost:8080/storage.v1.VolumeService/CloneVolume \
  -d '{
    "sourceVolumeId": "vol-template-base",
    "name": "vm-clone-01-disk",
    "targetPoolId": "pool-fast-ssd"
  }'
```

---

## Advanced Features

### Volume Snapshots

Volumes support independent snapshots (not tied to VM snapshots):

```bash
# Create snapshot
curl -X POST http://localhost:8080/storage.v1.SnapshotService/CreateSnapshot \
  -d '{
    "volumeId": "vol-abc123",
    "name": "before-upgrade"
  }'

# Revert to snapshot
curl -X POST http://localhost:8080/storage.v1.SnapshotService/RevertToSnapshot \
  -d '{
    "snapshotId": "snap-xyz789"
  }'
```

### QoS Settings

Per-volume quality of service:

```yaml
spec:
  qos:
    maxIops: 10000
    minIops: 1000
    maxThroughputBytes: 209715200  # 200 MB/s
    burstIops: 15000
    burstDurationSec: 60
```

### Encryption

Per-volume encryption:

```yaml
spec:
  encryption:
    enabled: true
    cipher: "aes-xts-plain64"
    keyManagement: "internal"
```

---

## Use Cases

### 1. Database Volume Management

**Scenario**: Production database needs dedicated storage with snapshots.

```
1. Create volume: prod-mysql-data (500 GB, Thick Eager)
2. Set QoS: 20,000 IOPS minimum
3. Attach to MySQL VM
4. Schedule nightly snapshots
5. If disaster: detach, attach to recovery VM
```

### 2. Template Volume Library

**Scenario**: Pre-configured OS volumes as templates.

```
1. Create volume: template-ubuntu-22.04
2. Boot VM, install and configure
3. Shutdown, detach volume
4. Mark as template (read-only)
5. Clone for each new VM
```

### 3. Moving Workloads

**Scenario**: Migrate application between hosts.

```
1. Shutdown VM on host-1
2. Volume automatically in READY state
3. Create new VM on host-2 (same pool assignment)
4. Attach same volume
5. Boot - data intact
```

### 4. Backup Integration

**Scenario**: Third-party backup integration.

```
1. Quiesce filesystem (guest agent)
2. Create volume snapshot
3. Clone snapshot to backup pool
4. Thaw filesystem
5. Export clone to backup system
6. Delete temporary clone
```

---

## Best Practices

### Naming Conventions

```
{workload}-{purpose}-{sequence}

Examples:
- prod-web-01-boot
- prod-db-01-data
- staging-app-02-logs
```

### Pool Organization

```
Pools by tier:
├── pool-nvme-fast      # High IOPS databases
├── pool-ssd-standard   # General workloads
├── pool-hdd-archive    # Cold storage, backups
└── pool-local-dev      # Development/testing
```

### Volume Sizing

- **OS volumes**: 50-100 GB
- **Application data**: Based on requirements
- **Thin provisioning**: Safe up to 2:1 overcommit
- **Leave 20% free** in pools for snapshots

---

## Comparison: Day-in-the-Life

### VMware Workflow

1. Log into vCenter
2. Navigate to datastore browser
3. Find VM folder
4. Right-click VMDK → Copy
5. Navigate to destination
6. Paste, wait for file copy
7. Register VMDK with new VM (complex)

### Quantix Workflow

1. `quantix volume clone prod-db-data --target new-db-data`
2. `quantix vm attach new-vm --volume new-db-data`

**Time saved: 10 minutes → 10 seconds**

---

## Migration from VMware

### Converting VMDKs to Volumes

```bash
# Import VMDK as new volume
quantix image import \
  --source /path/to/disk.vmdk \
  --pool pool-prod-01 \
  --name imported-disk \
  --format qcow2
```

### OVA Import

OVA files containing multiple VMDKs are automatically:
1. Extracted
2. Converted to QCOW2
3. Registered as volumes
4. Associated with created VM

---

## Related Documents

- [000003-storage-model-design.md](../adr/000003-storage-model-design.md)
- [000057-storage-pool-host-assignment.md](000057-storage-pool-host-assignment.md)
- [000058-storage-pool-details-page.md](../ui/000058-storage-pool-details-page.md)



💼 The Sales Pitch: Quantix Volumes vs VMware Datastores
Picture this...
"So you're a VMware admin. It's Friday at 4:45 PM. Your DBA calls in a panic—they need to move the production database disk to a recovery VM. NOW."
In VMware:
Log into vCenter (hope it doesn't timeout)
Navigate through the folder tree to find the datastore
Open datastore browser (Java applet loads... eventually)
Find the VM folder
Right-click the VMDK → Copy
Navigate to the destination folder (more clicking)
Paste... wait 20 minutes for 500GB to copy
Now manually edit the new VM's VMX file to add this disk
Pray it boots
Time: 45 minutes. Stress level: Critical.
In Quantix:
quantix volume detach prod-db-01-data --vm prod-mysqlquantix volume attach prod-db-01-data --vm recovery-mysql
Time: 10 seconds. The disk is already where it needs to be.
Why Volumes Are a Game-Changer
🎯 First-Class API Objects
VMware VMDKs are files. Just bits on a filesystem. Want to track them? Build your own CMDB.
Quantix Volumes are API resources. Every volume has:
A UUID that never changes
Full metadata (labels, descriptions)
Complete audit history
QoS settings per-disk
Encryption per-disk
# List all production database volumesquantix volume list --label "tier=database" --label "env=production"
Try doing that with VMware. I'll wait.
🔄 Independent Lifecycle
VMware says: "The disk belongs to the VM."
Quantix says: "The disk is the disk. Attach it wherever you need it."
Use cases you couldn't dream of before:
Volume Library - Pre-build optimized OS volumes, clone in seconds
Disaster Recovery - Disk survives VM deletion
Hot Migrations - Move data between pools without VM downtime
Multi-Attach - Shared disks for clusters (read-write-many)
📸 Volume-Level Snapshots
VMware snapshots are per-VM. Want to snapshot just the data disk? Create a chain that slows everything down.
Quantix:
# Snapshot just the data volume before upgradequantix snapshot create prod-db-data --name "pre-upgrade"# Oh no, upgrade failed? Roll back just that diskquantix snapshot revert prod-db-data --snapshot "pre-upgrade"
The boot disk? Untouched. The logs disk? Still there. Surgical precision.
🚀 Instant Clones
# Clone a 500GB template volumequantix volume clone gold-image-ubuntu --target new-vm-boot# Time: 0.3 seconds (copy-on-write)
No "linked clone" complexity. No "consolidate" nightmares. Just fast, clean clones.
💰 The ROI
Task	VMware Time	Quantix Time	Monthly Savings (50 VMs)
Attach disk to different VM	25 min	10 sec	20 hours
Clone disk for testing	15 min	0.3 sec	12 hours
Create data disk snapshot	5 min	2 sec	4 hours
Audit "where is this disk?"	10 min	1 sec	8 hours
That's 44 hours/month your team gets back. At $75/hour loaded cost, that's $3,300/month in productivity gains.
🎤 The Closing
"VMware treats disks like files in a folder. You dig through datastores like it's 2005.
Quantix treats disks like cloud resources. You query, attach, snapshot, clone—all via API.
Your infrastructure team becomes 10x faster. Your DR is bulletproof. Your automation is trivial.
And when it's Friday at 4:45 PM and the DBA calls? You type two commands and go home."