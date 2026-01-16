# Production-Grade OTA Update System

**Document ID:** 000082  
**Date:** January 16, 2026  
**Scope:** Update Server production features - Node Draining, Cryptographic Signing, DB Migrations

## Overview

This document describes the three critical production-grade features added to the Quantix Update Server:

1. **Node Draining (Maintenance Mode)** - Safe hypervisor updates with VM migration
2. **Cryptographic Signing (Ed25519)** - Authenticity verification for manifests
3. **Database Migrations** - Lifecycle hooks for stateful vDC updates

## 1. Node Draining (Maintenance Mode)

### Problem

Unlike updating a phone or IoT device, you cannot simply reboot a hypervisor host at will—it has running VMs that would be terminated.

### Solution

The update agent interfaces with the Control Plane through a maintenance mode workflow:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     NODE DRAINING WORKFLOW                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Agent detects update available                                       │
│           │                                                              │
│           ▼                                                              │
│  2. Agent → Update Server: "Request Maintenance Mode"                    │
│           │                                                              │
│           ▼                                                              │
│  3. Update Server → Control Plane: "Drain VMs from Node X"              │
│           │                                                              │
│           ▼                                                              │
│  4. Control Plane: Live migrate VMs to other nodes                      │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │  VM1 ──migrate──► Node B                                         │ │
│     │  VM2 ──migrate──► Node C                                         │ │
│     │  VM3 ──migrate──► Node B                                         │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│           │                                                              │
│           ▼                                                              │
│  5. Control Plane → Update Server: "Node X is empty"                    │
│           │                                                              │
│           ▼                                                              │
│  6. Update Server → Agent: "Proceed with update"                        │
│           │                                                              │
│           ▼                                                              │
│  7. Agent applies A/B update and reboots                                │
│           │                                                              │
│           ▼                                                              │
│  8. Agent → Update Server: "Update complete"                            │
│           │                                                              │
│           ▼                                                              │
│  9. Update Server → Control Plane: "Re-enable scheduling on Node X"     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/maintenance/request` | POST | Node requests maintenance mode |
| `/api/v1/maintenance/status/{nodeId}` | GET | Check maintenance status |
| `/api/v1/maintenance/drain-progress` | POST | Control plane reports drain progress |
| `/api/v1/maintenance/complete` | POST | Node reports update completion |
| `/api/v1/maintenance/cancel/{nodeId}` | POST | Cancel maintenance mode |
| `/api/v1/maintenance/list` | GET | List all nodes in maintenance |

### Maintenance States

| State | Description |
|-------|-------------|
| `none` | Not in maintenance |
| `requested` | Maintenance requested, waiting for approval |
| `draining` | VMs being migrated off the node |
| `ready` | Node is empty, ready for update |
| `updating` | Update in progress |
| `rebooting` | Rebooting after A/B update |
| `verifying` | Post-update health check |
| `completed` | Update successful |
| `failed` | Update failed |
| `cancelled` | Maintenance cancelled |

### Example: Node Requesting Maintenance

```bash
curl -X POST http://update-server:9000/api/v1/maintenance/request \
  -H "Content-Type: application/json" \
  -d '{
    "node_id": "qhci-01",
    "target_version": "0.0.6",
    "update_type": "full",
    "requires_reboot": true
  }'
```

Response (draining in progress):
```json
{
  "approved": true,
  "state": "draining",
  "message": "Draining VMs from node",
  "wait_seconds": 30,
  "proceed_now": false
}
```

Response (ready for update):
```json
{
  "approved": true,
  "state": "ready",
  "message": "Node is drained, ready for update",
  "proceed_now": true
}
```

---

## 2. Cryptographic Signing (Ed25519)

### Problem

SHA256 hashing only provides **integrity** (detecting corruption), not **authenticity** (verifying the source). If the update server is compromised, an attacker could push malicious updates.

### Solution

Use Ed25519 digital signatures to cryptographically sign manifests:

- **Private key**: Stored securely in CI/CD pipeline
- **Public key**: Baked into update agents at build time
- **Algorithm**: Ed25519 (fast, secure, TUF-compatible)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     SIGNING WORKFLOW                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  BUILD TIME (CI/CD):                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  1. Build artifacts                                                  ││
│  │  2. Create manifest.json                                             ││
│  │  3. Sign manifest with PRIVATE KEY                                   ││
│  │  4. Upload signed manifest + artifacts to Update Server              ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
│  RUNTIME (Update Agent):                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  1. Fetch signed manifest from Update Server                         ││
│  │  2. Verify signature using embedded PUBLIC KEY                       ││
│  │  3. If signature invalid → REJECT update                             ││
│  │  4. If signature valid → Verify SHA256 → Apply update                ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Signed Manifest Format

```json
{
  "manifest": { /* original manifest JSON */ },
  "signature": "base64-encoded-ed25519-signature",
  "key_id": "quantix-release-key-1",
  "signed_at": "2026-01-16T15:30:00Z",
  "algorithm": "ed25519"
}
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/{product}/manifest/signed` | GET | Get signed manifest |
| `/api/v1/admin/generate-keys` | POST | Generate new keypair |
| `/api/v1/admin/public-key` | GET | Get public key for embedding |

### Configuration

```bash
# Environment variables for signing
SIGNING_PRIVATE_KEY=/path/to/signing-private.key  # Required for signing
SIGNING_PUBLIC_KEY=/path/to/signing-public.key    # Optional, will be derived
SIGNING_KEY_ID=quantix-release-key-1              # Key identifier
```

### Example: Generate Signing Keys

```bash
curl -X POST http://update-server:9000/api/v1/admin/generate-keys \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
{
  "status": "generated",
  "private_key": "/data/releases/signing-private.key",
  "public_key": "/data/releases/signing-public.key",
  "note": "Keep the private key secret! Embed the public key in your update agents."
}
```

### Example: Get Signed Manifest

```bash
curl http://update-server:9000/api/v1/quantix-os/manifest/signed?channel=stable
```

### Embedding Public Key in Agent

```rust
// In agent/limiquantix-node/src/update/mod.rs
const SIGNING_PUBLIC_KEY: &str = "base64-encoded-public-key-here";

fn verify_manifest(signed: &SignedManifest) -> Result<Manifest> {
    let public_key = base64::decode(SIGNING_PUBLIC_KEY)?;
    let signature = base64::decode(&signed.signature)?;
    
    if !ed25519::verify(&public_key, &signed.manifest, &signature) {
        return Err(UpdateError::SignatureVerificationFailed);
    }
    
    Ok(serde_json::from_slice(&signed.manifest)?)
}
```

---

## 3. Database Migrations (vDC Updates)

### Problem

Updating the Quantix-vDC Control Plane is different from updating a host—it involves stateful data (PostgreSQL). A failed update could corrupt the database.

### Solution

Implement a migration lifecycle with hooks:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     VDC UPDATE LIFECYCLE                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Phase 1: PRE-CHECK                                                      │
│  ├── Verify database connectivity                                        │
│  ├── Check available disk space                                          │
│  └── Verify service is running                                           │
│           │                                                              │
│           ▼                                                              │
│  Phase 2: SNAPSHOT                                                       │
│  ├── pg_dump database to /data/snapshots/                               │
│  └── Mark rollback as available                                          │
│           │                                                              │
│           ▼                                                              │
│  Phase 3: DOWNLOAD                                                       │
│  └── Download new version artifacts                                      │
│           │                                                              │
│           ▼                                                              │
│  Phase 4: MIGRATE                                                        │
│  ├── Stop current service                                                │
│  ├── Run SQL schema migrations                                           │
│  └── Update configuration files                                          │
│           │                                                              │
│           ▼                                                              │
│  Phase 5: START                                                          │
│  └── Start new version                                                   │
│           │                                                              │
│           ▼                                                              │
│  Phase 6: HEALTH CHECK                                                   │
│  ├── Verify /health endpoint responds                                    │
│  ├── Retry up to 5 times with 5s intervals                              │
│  └── If failed → trigger rollback                                        │
│           │                                                              │
│           ▼                                                              │
│  Phase 7: COMPLETED                                                      │
│  └── Update successful!                                                  │
│                                                                          │
│  ─────────────────────────────────────────────────────────────────────── │
│                                                                          │
│  ROLLBACK (if any phase fails):                                          │
│  ├── Stop failed service                                                 │
│  ├── Restore database from snapshot (pg_restore)                         │
│  ├── Start previous version                                              │
│  └── Mark as rolled back                                                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/migrations/status` | GET | Get current migration state |
| `/api/v1/migrations/start` | POST | Start vDC update lifecycle |
| `/api/v1/migrations/snapshot` | POST | Manually create snapshot |
| `/api/v1/migrations/run` | POST | Manually run migrations |
| `/api/v1/migrations/rollback` | POST | Trigger rollback |
| `/api/v1/migrations/snapshots` | GET | List available snapshots |

### Migration Phases

| Phase | Description |
|-------|-------------|
| `none` | No migration in progress |
| `pre_check` | Validating prerequisites |
| `snapshot` | Creating database snapshot |
| `download` | Downloading new version |
| `migrating` | Running SQL migrations |
| `starting` | Starting new version |
| `health_check` | Verifying health |
| `completed` | Successfully completed |
| `failed` | Failed, needs rollback |
| `rolling_back` | Rollback in progress |
| `rolled_back` | Rollback completed |

### Configuration

```bash
# Environment variables for migrations
DATABASE_URL=postgres://user:pass@localhost:5432/quantix
DATABASE_TYPE=postgres  # or "sqlite"
SNAPSHOT_DIR=/data/snapshots
MIGRATIONS_DIR=/app/migrations
HEALTH_CHECK_URL=http://localhost:8080/health
VDC_SERVICE_NAME=quantix-controlplane
SERVICE_MANAGER=systemd  # or "openrc", "docker"
```

### Example: Start vDC Update

```bash
curl -X POST http://update-server:9000/api/v1/migrations/start \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target_version": "0.0.6",
    "current_version": "0.0.5",
    "skip_snapshot": false
  }'
```

### Example: Check Migration Status

```bash
curl http://update-server:9000/api/v1/migrations/status
```

Response:
```json
{
  "phase": "health_check",
  "current_version": "0.0.5",
  "target_version": "0.0.6",
  "started_at": "2026-01-16T15:30:00Z",
  "snapshot_path": "/data/snapshots/vdc-snapshot-20260116-153000.sql",
  "snapshot_created": "2026-01-16T15:30:05Z",
  "migrations_run": 3,
  "migrations_pending": 0,
  "health_check_retries": 2,
  "can_rollback": true
}
```

### Example: Manual Rollback

```bash
curl -X POST http://update-server:9000/api/v1/migrations/rollback \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "snapshot_path": "/data/snapshots/vdc-snapshot-20260116-153000.sql"
  }'
```

---

## Security Considerations

### Signing Keys

1. **Never commit private keys to git**
2. Store private key in secure vault (HashiCorp Vault, AWS Secrets Manager)
3. Rotate keys periodically (key_id supports rotation)
4. Embed public key at agent build time, not runtime

### Maintenance Mode

1. Only authenticated nodes can request maintenance
2. Control plane validates node identity before draining
3. Force mode should be restricted to emergency situations

### Database Snapshots

1. Snapshots contain sensitive data - secure the snapshot directory
2. Automatically clean up old snapshots (keep last N)
3. Test restore procedure regularly

---

## Future Enhancements

1. **TUF Integration** - Full The Update Framework compliance
2. **Delta Updates** - Binary diffs for smaller downloads
3. **Staged Rollouts** - Canary deployments with automatic rollback
4. **Multi-Region CDN** - Distribute artifacts globally
