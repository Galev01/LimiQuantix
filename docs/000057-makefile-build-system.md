# Quantix-KVM Makefile Build System

**Document ID:** 000057  
**Date:** January 21, 2026  
**Scope:** Build system architecture, ISO generation, validation

---

## Overview

The Quantix-KVM project uses a **hierarchical Makefile structure** with distinct build systems for different products:

| Makefile | Product | Output |
|----------|---------|--------|
| `/Makefile` | Development environment | Local services (no artifacts) |
| `/Quantix-OS/Makefile` | Hypervisor ISO | `quantix-os-X.Y.Z.iso` |
| `/Quantix-vDC/Makefile` | Control Plane ISO | `quantix-vdc-X.Y.Z.iso` |
| `/backend/Makefile` | Backend binary | `bin/controlplane` |

---

## Quantix-OS Build System

### Architecture

```
Quantix-OS/
├── Makefile              # Main build orchestration
├── VERSION               # Current version (e.g., 0.1.45)
├── builder/              # Docker build environments
│   ├── Dockerfile        # Alpine-based builder
│   ├── Dockerfile.rust-tui  # Rust cross-compilation
│   ├── build-iso.sh      # ISO generation script
│   ├── build-squashfs.sh # Rootfs compression
│   └── version.sh        # Version management
├── overlay/              # Files baked into ISO
│   ├── usr/bin/qx-node   # Node daemon (built)
│   ├── usr/share/quantix-host-ui/  # Host UI (built)
│   ├── etc/limiquantix/  # Configuration
│   └── etc/init.d/       # OpenRC services
└── output/               # Built artifacts
    └── quantix-os-X.Y.Z.iso
```

### Build Process

```bash
cd Quantix-OS
make iso
```

**Execution flow:**

1. **version-bump** - Increments VERSION file
2. **node-daemon** - Cross-compiles Rust binary for Alpine Linux
   - Uses `quantix-rust-tui-builder` Docker image
   - Builds with `--features libvirt` for VM support
   - Output: `overlay/usr/bin/qx-node`
3. **host-ui** - Builds React frontend
   - Uses `node:20-alpine` Docker image
   - Output: `overlay/usr/share/quantix-host-ui/`
4. **console-tui** - Builds optional Rust TUI (if source exists)
   - Output: `overlay/usr/local/bin/qx-console`
5. **squashfs** - Creates compressed rootfs
   - Runs `build-squashfs.sh` in Docker
6. **ISO** - Generates bootable ISO
   - Runs `build-iso.sh` in Docker

### Feature Flags (Critical)

The node daemon has a critical feature flag:

```toml
# agent/limiquantix-node/Cargo.toml
[features]
default = ["libvirt"]
libvirt = ["limiquantix-hypervisor/libvirt"]
```

**Without libvirt, VM management will NOT work!**

The Makefile ensures this:
```makefile
cargo build --release -p limiquantix-node --features libvirt
```

### Validation

```bash
make validate
```

Checks:
- `qx-node` binary exists and is executable
- libvirt support is enabled (scans binary for indicators)
- Host UI contains real content (not placeholder)
- BUILD_INFO.json is present
- Configuration files exist

---

## Quantix-vDC Build System

### Architecture

```
Quantix-vDC/
├── Makefile              # Main build orchestration
├── VERSION               # Current version
├── builder/              # Docker build environments
│   ├── Dockerfile        # Alpine-based builder
│   ├── build-rootfs.sh   # Rootfs creation
│   └── build-iso.sh      # ISO generation
├── installer/            # Installation scripts
│   ├── install.sh        # Disk installation
│   ├── tui.sh            # TUI installer
│   └── firstboot.sh      # Post-install setup
├── overlay/              # Files baked into ISO
│   ├── usr/bin/qx-controlplane  # Control plane (built)
│   └── usr/share/quantix-vdc/dashboard/  # Dashboard (built)
└── output/               # Built artifacts
    ├── quantix-vdc-X.Y.Z.iso
    └── migrations/       # Database migrations
```

### Build Process

```bash
cd Quantix-vDC
make iso
```

**Execution flow:**

1. **version-bump** - Increments VERSION file
2. **backend** - Compiles Go control plane
   - Uses `golang:alpine` Docker image
   - Static binary with `CGO_ENABLED=0`
   - Output: `overlay/usr/bin/qx-controlplane`
3. **frontend** - Builds React dashboard
   - Uses `node:20-alpine` Docker image
   - Output: `overlay/usr/share/quantix-vdc/dashboard/`
4. **migrations** - Copies SQL migrations
   - Source: `/backend/migrations/`
   - Output: `output/migrations/`
5. **rootfs** - Creates filesystem
6. **ISO** - Generates bootable installer ISO

### Validation

```bash
make validate
```

Checks:
- `qx-controlplane` binary exists and is executable
- Dashboard contains real content (not placeholder)
- Database migrations are present
- Required modules detected in binary

---

## Root Makefile (Development)

The root `/Makefile` is for **local development only** - it does NOT build ISOs.

### Development Commands

```bash
# Start everything
make dev

# Start individual components
make dev-docker    # PostgreSQL, etcd, Redis
make dev-backend   # Go control plane
make dev-frontend  # React dashboard
make dev-hostui    # Host UI
make dev-node      # Rust node daemon

# Stop everything
make dev-stop
```

### Protobuf Generation

```bash
make proto        # Generate Go + TypeScript from .proto files
make proto-lint   # Lint proto definitions
make proto-clean  # Remove generated files
```

---

## Validation Deep Dive

### Why Validate?

Builds can succeed but produce **incomplete artifacts**:

1. **Silent frontend failures** - npm errors may create placeholder HTML
2. **Missing feature flags** - Binary compiles but lacks functionality
3. **Docker volume issues** - Files not copied to overlay

### Validation Output Examples

**Successful validation:**
```
═══════════════════════════════════════════════════════════════
  Validating Quantix-OS Build
═══════════════════════════════════════════════════════════════

📋 Checking binaries...

  [qx-node] Node Daemon (Rust)
    ✅ Found: overlay/usr/bin/qx-node (15M)
    ✅ Executable: Yes

📋 Checking Host UI (React)...

  ✅ Host UI installed: 47 files (2.1M)
  ✅ Content: Real build (not placeholder)
  ✅ BUILD_INFO.json present

📋 Checking Feature Flags...

  [libvirt] VM Management Support
    ✅ libvirt support: ENABLED (detected in binary)

═══════════════════════════════════════════════════════════════
  ✅ VALIDATION PASSED - All required components present
═══════════════════════════════════════════════════════════════
```

**Failed validation:**
```
═══════════════════════════════════════════════════════════════
  Validating Quantix-OS Build
═══════════════════════════════════════════════════════════════

📋 Checking binaries...

  [qx-node] Node Daemon (Rust)
    ❌ NOT FOUND: overlay/usr/bin/qx-node
       Run: make node-daemon

📋 Checking Host UI (React)...

  ❌ NOT FOUND: overlay/usr/share/quantix-host-ui/index.html
     Run: make host-ui

═══════════════════════════════════════════════════════════════
  ❌ VALIDATION FAILED - 2 error(s) found
═══════════════════════════════════════════════════════════════
```

---

## Troubleshooting

### "Frontend build produced no output"

**Cause:** npm or vite build failed

**Solution:**
```bash
# Check frontend manually
cd frontend
npm install
npm run build
ls -la dist/
```

### "libvirt support: UNKNOWN"

**Cause:** Cannot detect libvirt in binary

**Solution:**
1. Verify Cargo.toml has correct features
2. Check build logs for libvirt compilation
3. Rebuild with explicit feature flag:
```bash
cd Quantix-OS
make clean
make node-daemon
make validate
```

### "Permission denied" errors

**Cause:** Docker volume permissions

**Solution:**
```bash
cd Quantix-vDC
make fix-perms
make iso
```

### Docker build fails

**Cause:** Docker not running or missing images

**Solution:**
```bash
# Ensure Docker is running
docker info

# Rebuild Docker images
cd Quantix-OS
make docker-builder
make docker-rust-tui
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Build Quantix-OS ISO | `cd Quantix-OS && make iso` |
| Build without version bump | `cd Quantix-OS && make iso-no-bump` |
| Validate Quantix-OS | `cd Quantix-OS && make validate` |
| Build Quantix-vDC ISO | `cd Quantix-vDC && make iso` |
| Validate Quantix-vDC | `cd Quantix-vDC && make validate` |
| Local dev (all) | `make dev` |
| Regenerate proto | `make proto` |
| Test in QEMU | `cd Quantix-OS && make test-qemu` |
| Clean build | `cd Quantix-OS && make clean` |
| Show version | `make version` |
| Set version | `make version-set V=1.2.3` |

---

## See Also

- `.cursor/rules/makefiles.mdc` - Agent rules for Makefile operations
- `docs/000054-local-development-guide.md` - Local development setup
- `Quantix-OS/builder/README.md` - Builder Docker images
