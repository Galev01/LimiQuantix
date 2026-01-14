# Installer Storage Pool Configuration

**Document ID:** 000057  
**Date:** January 14, 2026  
**Scope:** Quantix-OS Installer TUI

## Overview

The Quantix-OS installer now supports configuring additional storage pools during the initial installation. This allows administrators to prepare dedicated disks for VM storage during the OS installation, similar to VMware ESXi's datastore configuration.

## Feature Description

During installation, after selecting the boot disk, users are presented with an **optional** step to configure additional disks as storage pools.

### Installation Flow

1. **Welcome** - Introduction to the installer
2. **Select Boot Disk** - Choose the disk for OS installation
3. **Confirm Boot Disk** - Review partition layout
4. **Configure Storage Pools** (NEW, Optional) - Select additional disks for VM storage
5. **Configure Hostname** - Set system hostname
6. **Configure Root Password** - Set root password
7. **Installation Summary** - Review all settings
8. **Installation** - Execute installation

### Storage Pool Configuration Step

If additional disks are detected (>10GB, not the boot disk), the installer will:

1. Ask if the user wants to configure storage pools
2. Display a checklist of available disks
3. For each selected disk:
   - Prompt for a pool name (default: `local-<disk-name>`)
   - Validate the name (alphanumeric + hyphens)
4. Show a summary of configured pools

### What Happens to Selected Disks

For each disk selected as a storage pool:

1. **Partition Table**: Created as GPT
2. **Partition**: Single partition spanning entire disk
3. **Filesystem**: Formatted with XFS (optimal for VM storage)
4. **Label**: Named after the pool name

### Configuration Files Generated

The installer creates:

- `/quantix/limiquantix/storage-pools.yaml` - Pool definitions
- `/quantix/fstab.pools` - Mount entries for pools

Example `storage-pools.yaml`:

```yaml
storage_pools:
  - name: local-nvme0n1
    disk: /dev/nvme0n1
    partition: /dev/nvme0n1p1
    uuid: a1b2c3d4-...
    filesystem: xfs
    mount_point: /data/pools/local-nvme0n1
  - name: local-sda
    disk: /dev/sda
    partition: /dev/sda1
    uuid: e5f6g7h8-...
    filesystem: xfs
    mount_point: /data/pools/local-sda
```

### First Boot Integration

On first boot, the `firstboot.sh` script:

1. **Mounts pools** from `fstab.pools`
2. **Appends entries** to `/etc/fstab` for persistence
3. **Registers pools** with libvirt as directory storage pools
4. **Creates subdirectories**: `vms/`, `images/`, `isos/` in each pool

### Libvirt Pool Registration

Each configured pool is automatically registered with libvirt:

```bash
virsh pool-define-as <pool-name> dir --target /data/pools/<pool-name>
virsh pool-autostart <pool-name>
virsh pool-start <pool-name>
```

## Usage Examples

### Scenario 1: Single Boot Disk

User has one disk (500GB NVMe):

1. Select `/dev/nvme0n1` as boot disk
2. "No additional disks found" message shown
3. Continue with installation

### Scenario 2: Boot + Storage Disks

User has three disks:
- 256GB SSD for OS (`/dev/sda`)
- 2TB HDD for storage (`/dev/sdb`)
- 1TB NVMe for fast storage (`/dev/nvme0n1`)

1. Select `/dev/sda` as boot disk
2. Storage pool configuration shows:
   - `/dev/sdb` (2TB)
   - `/dev/nvme0n1` (1TB)
3. User selects both disks
4. Names them: `hdd-storage` and `nvme-fast`
5. Installation formats both as XFS storage pools

### Scenario 3: Skip Storage Configuration

User wants to configure storage later:

1. Select boot disk
2. When asked "Configure storage pools now?" → Select "No"
3. Continue with standard installation
4. Configure storage pools later via QHMI web interface

## Command-Line Usage

For automated installations:

```bash
./install.sh \
  --disk /dev/sda \
  --hostname quantix-node-01 \
  --password MySecurePass \
  --storage-pools "/dev/sdb:hdd-storage /dev/nvme0n1:nvme-fast" \
  --auto
```

Format: `--storage-pools "DISK1:NAME1 DISK2:NAME2 ..."`

## Integration with Quantix-vDC

When the host joins a Quantix-vDC cluster:

1. Storage pools are visible in the vDC inventory
2. Pools can be used for VM provisioning
3. Pool health and capacity are monitored
4. VMs can be migrated between pools

## Disk Recommendations

| Disk Type | Recommended Use |
|-----------|-----------------|
| NVMe SSD | Boot disk, fast VM storage |
| SATA SSD | General VM storage |
| HDD | ISO/image library, backups |

## Troubleshooting

### Installer TUI Not Found

If the boot screen shows **"Installer not found"**, it means the installer
scripts were not accessible in the live root.

**Checklist:**

1. Rebuild the ISO so installer scripts are included:
   - The ISO must contain `/installer/tui.sh`
2. Ensure you're booting the latest ISO
3. If booting with `toram`, the initramfs will copy installer scripts into
   `/installer` before pivoting to the live root

**Quick verification after boot:**

```bash
ls -la /installer
```

### Storage Pool Not Mounted

Check firstboot logs:
```bash
cat /var/log/quantix-firstboot.log | grep -i pool
```

Manually mount:
```bash
mount -a
```

### Pool Not Visible in Libvirt

List pools:
```bash
virsh pool-list --all
```

Refresh pool:
```bash
virsh pool-refresh <pool-name>
```

### Wrong Disk Selected

If you selected the wrong disk during installation:
1. Boot from USB again
2. Run installer
3. Choose correct disks

⚠️ **Note**: Selecting a disk as a storage pool will **erase all data** on that disk.

## Future Enhancements

- [ ] RAID configuration support
- [ ] LVM thin provisioning option
- [ ] Network storage (NFS/iSCSI) configuration
- [ ] Disk encryption (LUKS) option
