# Quantix-OS OTA Update System

**Document ID:** 000081  
**Date:** January 16, 2026  
**Scope:** Over-The-Air update mechanism for Quantix-OS and Quantix-vDC

## Overview

The Quantix OTA Update System provides a production-grade mechanism for updating Quantix-OS hosts without requiring manual ISO reinstallation. It supports two update modes:

1. **Component Updates** - Update individual binaries and web UI without reboot
2. **Full A/B Updates** - Replace the entire system image with automatic rollback protection

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UPDATE FLOW                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Developer Machine              Update Server              Quantix-OS    │
│  ┌─────────────────┐           ┌─────────────────┐       ┌─────────────┐│
│  │ publish-update. │──builds──►│   Go + Docker   │◄─poll─│  qx-node    ││
│  │ sh              │  uploads  │   Port: 9000    │       │  update     ││
│  └─────────────────┘           └─────────────────┘       │  module     ││
│                                        │                  └─────────────┘│
│                                        │                         │       │
│                                        ▼                         ▼       │
│                               /releases/quantix-os/     /data/bin/qx-node│
│                               ├── dev/                  /data/share/     │
│                               │   └── 0.0.5/            quantix-host-ui/ │
│                               │       ├── manifest.json                  │
│                               │       ├── qx-node.tar.zst               │
│                               │       ├── qx-console.tar.zst            │
│                               │       └── host-ui.tar.zst               │
│                               ├── beta/                                  │
│                               └── stable/                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Update Server

**Location:** `/update-server/`  
**Technology:** Go 1.22 + Fiber + Docker  
**Port:** 9000

A lightweight Go server that:
- Hosts update manifests and artifacts
- Supports multiple release channels (dev, beta, stable)
- Provides REST API for manifest retrieval and artifact download
- Handles release publishing with authentication

**API Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/v1/channels` | GET | List available channels |
| `/api/v1/{product}/manifest` | GET | Get latest manifest |
| `/api/v1/{product}/releases` | GET | List all releases |
| `/api/v1/{product}/releases/{version}/{artifact}` | GET | Download artifact |
| `/api/v1/{product}/publish` | POST | Upload new release (auth required) |

**Running the Server:**

```bash
cd update-server
docker-compose up -d

# Check health
curl http://localhost:9000/health
```

### 2. Update Client (Rust)

**Location:** `/agent/limiquantix-node/src/update/`

The update client is built into the qx-node daemon and provides:

- `UpdateManager` - Main coordinator for update operations
- `UpdateDownloader` - Downloads and verifies artifacts
- `UpdateApplier` - Extracts and installs updates
- `ABUpdateManager` - Handles full system A/B updates

**Key Features:**
- HTTP resume support for interrupted downloads
- SHA256 verification of all artifacts
- Atomic file replacement with backup
- Service restart orchestration via OpenRC

### 3. Overlay Mount System

**Location:** `/Quantix-OS/overlay/etc/local.d/05-overlay-mounts.start`

Enables updating binaries on the read-only squashfs root:

- `/data/bin/` - Updatable binaries (qx-node, qx-console)
- `/data/share/quantix-host-ui/` - Updatable web UI
- `/data/versions/` - Version tracking files

### 4. A/B Partition System

**Location:** `/agent/limiquantix-node/src/update/ab_update.rs`

For full system image updates:

- QUANTIX-A (1.5GB) - System slot A
- QUANTIX-B (1.5GB) - System slot B
- Automatic rollback after 3 failed boot attempts
- GRUB integration for slot switching

## Update Manifest Format

```json
{
  "product": "quantix-os",
  "version": "0.0.5",
  "channel": "dev",
  "release_date": "2026-01-16T12:00:00Z",
  "update_type": "component",
  "components": [
    {
      "name": "qx-node",
      "version": "0.0.5",
      "artifact": "qx-node.tar.zst",
      "sha256": "abc123...",
      "size_bytes": 5242880,
      "install_path": "/data/bin/qx-node",
      "restart_service": "quantix-node",
      "backup_before_update": true,
      "permissions": "0755"
    }
  ],
  "full_image": {
    "artifact": "system.squashfs",
    "sha256": "def456...",
    "size_bytes": 524288000,
    "requires_reboot": true,
    "target_slot": "auto"
  },
  "min_version": "0.0.1",
  "release_notes": "Bug fixes and improvements"
}
```

## Usage

### Checking for Updates

Via Host UI Web Interface:
1. Navigate to Settings → Updates
2. Click "Check for Updates"

Via API:
```bash
curl -k https://<host>:8443/api/v1/updates/check
```

Via TUI:
- Use the web interface at `https://<host-ip>:8443`

### Applying Updates

Via API:
```bash
curl -k -X POST https://<host>:8443/api/v1/updates/apply
```

### Publishing Updates (Developer)

```bash
# Build and publish all components to dev channel
./scripts/publish-update.sh

# Publish only qx-node to beta
./scripts/publish-update.sh --channel beta --component qx-node

# Dry run (build without upload)
./scripts/publish-update.sh --dry-run
```

## Configuration

### Update Client Configuration

In `/etc/limiquantix/node.yaml`:

```yaml
updates:
  enabled: true
  server_url: "http://192.168.0.95:9000"
  channel: "dev"
  check_interval: "1h"
  auto_apply: false
  auto_reboot: false
```

### Environment Variables (Update Server)

| Variable | Default | Description |
|----------|---------|-------------|
| `RELEASE_DIR` | `/data/releases` | Artifact storage directory |
| `LISTEN_ADDR` | `0.0.0.0:9000` | Server listen address |
| `PUBLISH_TOKEN` | `dev-token` | Authentication token |

## Update Types

### Component Updates (Hot Updates)

For development iteration without full reinstall:

1. Server checks for newer version in manifest
2. Downloads individual component artifacts (tar.zst)
3. Verifies SHA256 checksums
4. Backs up existing files to `/data/updates/backup/`
5. Extracts and installs to `/data/bin/` or `/data/share/`
6. Restarts affected OpenRC services

**No reboot required.**

### Full A/B Updates (System Updates)

For major version upgrades or kernel updates:

1. Detects current boot slot (A or B)
2. Downloads full system.squashfs to staging
3. Mounts inactive partition
4. Installs squashfs, kernel, and initramfs
5. Updates GRUB to boot from new slot
6. Sets "update pending" flag
7. **Requires reboot**

**Rollback Protection:**
- Boot counter incremented on each boot attempt
- After 3 failed boots, automatically reverts to previous slot
- Health verification clears pending state on success

## File Locations

| Path | Description |
|------|-------------|
| `/data/bin/qx-node` | Updatable node daemon |
| `/data/bin/qx-console` | Updatable console TUI |
| `/data/share/quantix-host-ui/` | Updatable Host UI |
| `/data/versions/` | Component version files |
| `/data/updates/staging/` | Download staging area |
| `/data/updates/backup/` | Pre-update backups |
| `/quantix/ab-update-state.json` | A/B update state |

## Boot Scripts

| Script | Order | Purpose |
|--------|-------|---------|
| `03-ab-update-check.start` | Early | Checks for A/B rollback |
| `05-overlay-mounts.start` | Early | Sets up /data overlay paths |
| `99-ab-update-verify.start` | Late | Marks A/B update as successful |

## Troubleshooting

### Update Check Fails

1. Verify update server is running:
   ```bash
   curl http://<server>:9000/health
   ```

2. Check network connectivity from host:
   ```bash
   curl http://<server>:9000/api/v1/quantix-os/manifest?channel=dev
   ```

3. Check qx-node logs:
   ```bash
   tail -f /var/log/quantix-node.log
   ```

### Update Apply Fails

1. Check staging directory:
   ```bash
   ls -la /data/updates/staging/
   ```

2. Verify checksums manually:
   ```bash
   sha256sum /data/updates/staging/*.tar.zst
   ```

3. Check available disk space:
   ```bash
   df -h /data
   ```

### A/B Update Rollback

If system boots to previous version after update:

1. Check boot logs:
   ```bash
   dmesg | grep -i quantix
   ```

2. Check A/B state file (may be cleared after rollback):
   ```bash
   cat /quantix/ab-update-state.json
   ```

3. Review service status:
   ```bash
   rc-status
   ```

## Security Considerations

1. **HTTPS** - Use TLS for update server in production
2. **Token Auth** - Publish endpoint requires `PUBLISH_TOKEN`
3. **SHA256** - All artifacts verified before installation
4. **Backup** - Original files backed up before replacement
5. **Rollback** - Failed A/B updates automatically revert

## Future Enhancements

- [ ] Delta updates (binary diff) for smaller downloads
- [ ] Signature verification (GPG/RSA signed manifests)
- [ ] Scheduled update windows
- [ ] Bandwidth throttling
- [ ] Multi-region CDN support
- [ ] Update dependencies (component prerequisites)

## Related Documentation

- [000077 - Version Control System](../Quantix-OS/000077-version-control-system.md)
- [000006 - Proto and Build System Guide](../000006-proto-and-build-system-guide.md)
- Update Server README: `/update-server/README.md`
- Manifest Schema: `/update-server/schema/manifest.schema.json`
