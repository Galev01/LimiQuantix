# Quantix-vDC Version Control System

**Document ID:** 000004  
**Date:** January 10, 2026  
**Scope:** Quantix-vDC build system, versioning, and installer

---

## Overview

Quantix-vDC uses a semantic versioning system with auto-increment capabilities for automated builds. The version is embedded in the ISO and displayed in both the installer TUI and the installed system.

## Version Format

```
MAJOR.MINOR.PATCH
```

- **PATCH**: 1-100, auto-increments on each build
- **MINOR**: 0-9, increments when PATCH > 100
- **MAJOR**: Increments when MINOR > 9 (typically manual for major releases)

### Rollover Logic

```
0.0.1 → 0.0.2 → ... → 0.0.100 → 0.1.1 → ... → 0.9.100 → 1.0.1
```

## Files

### `VERSION`

Located at: `Quantix-vDC/VERSION`

Contains the current version number as plain text:
```
0.0.1
```

### `builder/version.sh`

Version management script with the following commands:

| Command                   | Description             |
| ------------------------- | ----------------------- |
| `./version.sh get`        | Display current version |
| `./version.sh increment`  | Increment PATCH version |
| `./version.sh set X.Y.Z`  | Set specific version    |
| `./version.sh bump minor` | Bump MINOR version      |
| `./version.sh bump major` | Bump MAJOR version      |

## Makefile Targets

### Version Management

```bash
# Display current version
make version

# Increment version manually
make version-bump

# Set specific version
make version-set V=2.0.0
```

### Build Targets

```bash
# Build ISO with auto-increment (0.0.1 → 0.0.2)
make iso

# Build ISO without version bump
make iso-no-bump
```

## Version Display Locations

### 1. Installer TUI

The version appears in the backtitle of every dialog:
```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Quantix-vDC Installer v0.0.1                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2. ISO Filesystem

VERSION file is embedded in the ISO at:
```
/quantix-vdc/VERSION
```

### 3. Installed System

After installation, the version is stored at:
```
/etc/quantix-version
```

## Build System Integration

### build-iso.sh

The build script creates the VERSION file in the ISO:
```bash
echo "${VERSION}" > "${ISO_DIR}/quantix-vdc/VERSION"
```

### install.sh

The installer copies the version to the installed system:
```bash
cp "${CDROM_PATH}/quantix-vdc/VERSION" "${TARGET_MOUNT}/etc/quantix-version"
```

### tui.sh

The TUI reads the version at startup:
```bash
VERSION=$(cat /mnt/cdrom/quantix-vdc/VERSION 2>/dev/null || echo "unknown")
BACKTITLE="Quantix-vDC Installer v${VERSION}"
```

## Usage Examples

### Standard Development Build

```bash
# Each build increments version
make iso                  # v0.0.1 → v0.0.2
make iso                  # v0.0.2 → v0.0.3
make iso                  # v0.0.3 → v0.0.4
```

### Release Build

```bash
# Set release version
make version-set V=1.0.0

# Build without incrementing
make iso-no-bump
```

### Hotfix Build

```bash
# Check current version
make version              # v1.0.5

# Build hotfix (auto-increments)
make iso                  # v1.0.5 → v1.0.6
```

## Integration with CI/CD

For automated builds:

```bash
#!/bin/bash
# CI Build Script

cd Quantix-vDC

# Get version before build
VERSION_BEFORE=$(cat VERSION)

# Build with auto-increment
make iso

# Get version after build
VERSION_AFTER=$(cat VERSION)

echo "Built: $VERSION_BEFORE → $VERSION_AFTER"
```

## Comparison with Quantix-OS

Both Quantix-vDC and Quantix-OS use the same version control system:

| Feature        | Quantix-vDC            | Quantix-OS             |
| -------------- | ---------------------- | ---------------------- |
| VERSION file   | `Quantix-vDC/VERSION`  | `Quantix-OS/VERSION`   |
| version.sh     | `builder/version.sh`   | `builder/version.sh`   |
| ISO path       | `/quantix-vdc/VERSION` | `/quantix/VERSION`     |
| Installed path | `/etc/quantix-version` | `/etc/quantix-version` |

## Troubleshooting

### Version shows "unknown"

- Check that VERSION file exists on ISO
- Verify cdrom is mounted at expected path
- Run: `cat /mnt/cdrom/quantix-vdc/VERSION`

### Version not incrementing

- Ensure `builder/version.sh` is executable:
  ```bash
  chmod +x builder/version.sh
  ```
- Check VERSION file is writable

### Build fails with version error

- Verify VERSION file contains valid format: `X.Y.Z`
- Reset to known good version:
  ```bash
  echo "0.0.1" > VERSION
  ```
