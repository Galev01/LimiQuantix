# Quantix-OS Version Control System

**Document ID:** 000077  
**Date:** January 10, 2026  
**Scope:** Quantix-OS build system, versioning, and installer

## Overview

Quantix-OS uses a semantic versioning system with automatic build number increment. Each build automatically advances the version number, ensuring every ISO has a unique identifier.

## Version Format

```
MAJOR.MINOR.PATCH
```

**Examples:**
- `0.0.1` → First development build
- `0.0.100` → Last patch before minor bump
- `0.1.1` → First patch of new minor version
- `1.0.1` → First production release

### Increment Rules

1. **PATCH** increments from 1 to 100
2. When PATCH exceeds 100, it resets to 1 and **MINOR** increments
3. When MINOR exceeds 9, it resets to 0 and **MAJOR** increments

## Files and Locations

### Source Version File

```
Quantix-OS/VERSION
```

Contains the current version as plain text (e.g., `0.0.1`).

### Version Management Script

```bash
Quantix-OS/builder/version.sh
```

**Commands:**
- `./version.sh get` - Display current version
- `./version.sh increment` - Bump version and return new value
- `./version.sh set X.Y.Z` - Set specific version

### Runtime Version Locations

The version is available at runtime in these locations (checked in order):

1. `/quantix/VERSION` - Installed system (QUANTIX-A/B partition)
2. `/mnt/cdrom/quantix/VERSION` - When booted from ISO
3. `/cdrom/quantix/VERSION` - Alternative ISO mount
4. `/etc/quantix-version` - Legacy location
5. `/usr/share/quantix/VERSION` - Package distribution

## Build Integration

### Makefile Targets

```bash
# Build ISO with automatic version bump
make iso

# Build ISO without incrementing version
make iso-no-bump

# Show current version
make version

# Manually increment version
make version-bump

# Set specific version
make version-set V=1.0.0
```

### Build Process

1. `make iso` calls `version-bump` first
2. New version is read from `VERSION` file
3. Version is embedded in:
   - ISO filename: `quantix-os-X.Y.Z.iso`
   - Squashfs filename: `system-X.Y.Z.squashfs`
   - `/quantix/VERSION` on ISO
   - GRUB menu entries
   - BUILD_INFO.json for Host UI

## TUI Console Display

The console TUI displays the version in the System Information panel:

```
┌─ System Information ────────────────────────────┐
│ Version:  Quantix-OS v0.0.1                     │
│ Hostname: quantix-node-01                       │
│ IP:       192.168.0.100                         │
│ Status:   Standalone                            │
│ Uptime:   2d 5h 32m                             │
│ VMs:      12                                    │
└─────────────────────────────────────────────────┘
```

## TUI Installer

The installer TUI (`/installer/tui.sh`) uses `dialog` for a graphical-text interface similar to VMware ESXi installer.

### Features

- Welcome screen with version display
- Automatic disk detection (NVMe, SATA, VirtIO)
- Hostname configuration
- Root password setup
- Installation summary with confirmation
- Progress display
- Post-install instructions

### Partition Layout

```
┌─────────────────────────────────────────────────┐
│ Partition     │ Size    │ Type   │ Purpose     │
├───────────────┼─────────┼────────┼─────────────┤
│ EFI           │ 256 MB  │ FAT32  │ Bootloader  │
│ QUANTIX-A     │ 1.5 GB  │ ext4   │ Active OS   │
│ QUANTIX-B     │ 1.5 GB  │ ext4   │ Upgrade slot│
│ QUANTIX-CFG   │ 256 MB  │ ext4   │ Config      │
│ QUANTIX-DATA  │ rest    │ XFS    │ VM storage  │
└─────────────────────────────────────────────────┘
```

## Version Checking in Code

### Rust (TUI Console)

```rust
fn get_os_version() -> String {
    let version_paths = [
        "/quantix/VERSION",
        "/mnt/cdrom/quantix/VERSION",
        "/etc/quantix-version",
    ];
    
    for path in &version_paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            return content.trim().to_string();
        }
    }
    
    "0.0.1".to_string()  // Fallback
}
```

### Shell (Installer/Scripts)

```bash
VERSION_FILE="/mnt/cdrom/quantix/VERSION"
if [ -f "$VERSION_FILE" ]; then
    VERSION=$(cat "$VERSION_FILE" | tr -d '\n\r ')
else
    VERSION="0.0.1"
fi
```

## CI/CD Integration

For automated builds, the version can be controlled via environment:

```bash
# Set specific version for release
make version-set V=1.0.0
make iso-no-bump

# Or let CI auto-increment
make iso
```

## Related Files

- `Quantix-OS/Makefile` - Build system with version targets
- `Quantix-OS/VERSION` - Current version file
- `Quantix-OS/builder/version.sh` - Version management script
- `Quantix-OS/builder/build-iso.sh` - ISO builder (embeds version)
- `Quantix-OS/installer/tui.sh` - TUI installer
- `Quantix-OS/installer/install.sh` - Installation script
- `Quantix-OS/console-tui/src/main.rs` - Console TUI (displays version)
