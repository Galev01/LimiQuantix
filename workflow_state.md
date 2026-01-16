# Workflow State

## Completed Task: Push Update Client to Quantix-vDC

**Date:** January 16, 2026

### Summary
Integrated the OTA update system into Quantix-vDC backend and verified the frontend implementation. The system can now push updates to connected QHCI hosts.

---

## Changes Made

### Backend (Go - backend/)

#### 1. Wired NodeGetter to Update Service
**File:** `internal/server/server.go`

Added NodeGetter adapter to connect the update service with the node repository:

```go
// Wire up the NodeGetter so the update service can communicate with hosts
nodeGetter := updateservice.NewNodeGetterFromFuncs(
    // GetNodeByID function
    func(ctx context.Context, id string) (*updateservice.NodeInfo, error) {
        node, err := s.nodeRepo.Get(ctx, id)
        if err != nil {
            return nil, err
        }
        return &updateservice.NodeInfo{
            ID:           node.ID,
            Hostname:     node.Hostname,
            ManagementIP: node.ManagementIP,
        }, nil
    },
    // ListNodes function
    func(ctx context.Context) ([]*updateservice.NodeInfo, error) {
        nodes, err := s.nodeRepo.List(ctx, nodeservice.NodeFilter{})
        if err != nil {
            return nil, err
        }
        result := make([]*updateservice.NodeInfo, 0, len(nodes))
        for _, n := range nodes {
            result = append(result, &updateservice.NodeInfo{
                ID:           n.ID,
                Hostname:     n.Hostname,
                ManagementIP: n.ManagementIP,
            })
        }
        return result, nil
    },
)
s.updateService.SetNodeGetter(nodeGetter)
```

#### 2. Added NodeGetter Adapter to Update Service
**File:** `internal/services/update/service.go`

- Added `crypto/tls` import for TLS configuration
- Added `hostClient *http.Client` field with TLS skip verification for self-signed certs
- Created `NewNodeGetterFromFuncs()` factory for flexible integration
- Implemented `NodeGetterAdapter` struct with callback functions
- Fixed `CheckHostUpdate()` to use the shared `hostClient`
- Fixed `ApplyHostUpdate()` with proper TLS handling

#### 3. TLS Skip Verification for Host Communication
Hosts use self-signed certificates, so the update service now skips TLS verification when communicating with QHCI hosts.

```go
hostTransport := &http.Transport{
    TLSClientConfig: &tls.Config{
        InsecureSkipVerify: true, // Skip verification for self-signed certs
    },
}
```

### Frontend (Already Complete)

The frontend was already implemented:
- `src/hooks/useUpdates.ts` - All React Query hooks
- `src/pages/Settings.tsx` - UpdateSettings component with:
  - vDC update status and actions
  - Host list with per-host update actions
  - Channel selector (stable/beta/dev)
  - Auto-check and auto-apply toggles

---

## API Endpoints (Backend)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/updates/vdc/status` | GET | Get vDC update status |
| `/api/v1/updates/vdc/check` | POST | Check for vDC updates |
| `/api/v1/updates/vdc/apply` | POST | Apply vDC update |
| `/api/v1/updates/hosts` | GET | Get all hosts update status |
| `/api/v1/updates/hosts/check` | POST | Check all hosts for updates |
| `/api/v1/updates/hosts/{nodeId}` | GET | Get specific host status |
| `/api/v1/updates/hosts/{nodeId}/check` | POST | Check host for updates |
| `/api/v1/updates/hosts/{nodeId}/apply` | POST | Apply update to host |
| `/api/v1/updates/config` | GET/PUT | Get/update configuration |

---

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  QUANTIX-VDC UPDATE PUSH FLOW                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Frontend (Settings → Updates)                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ • Check for vDC Updates      → POST /api/v1/updates/vdc/check      ││
│  │ • Apply vDC Update           → POST /api/v1/updates/vdc/apply      ││
│  │ • Check All Hosts            → POST /api/v1/updates/hosts/check    ││
│  │ • Apply Host Update          → POST /api/v1/updates/hosts/{id}/apply││
│  │ • Channel Selector           → PUT /api/v1/updates/config          ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                              │                                           │
│                              ▼                                           │
│  Backend (update_handler.go + service.go)                                │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ UpdateHandler → UpdateService → NodeGetter (adapter)                ││
│  │                                     │                                ││
│  │                                     ▼                                ││
│  │                              NodeRepository                          ││
│  │                              (gets node IPs)                         ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                              │                                           │
│              ┌───────────────┴───────────────┐                          │
│              ▼                               ▼                          │
│  ┌─────────────────┐           ┌─────────────────────┐                  │
│  │  Update Server  │           │  QHCI Host (qx-node)│                  │
│  │  Port: 9000     │           │  Port: 8443 (HTTPS) │                  │
│  │  • manifests    │           │  /api/v1/updates/*  │                  │
│  │  • artifacts    │           │  (self-signed TLS)  │                  │
│  └─────────────────┘           └─────────────────────┘                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Testing

1. **Build the backend:**
   ```bash
   cd backend && go build ./...
   ```
   ✅ Verified - compiles successfully

2. **Build the frontend:**
   ```bash
   cd frontend && npm run build
   ```

3. **Access the Updates tab:**
   - Navigate to Settings → Updates in the vDC Dashboard
   - Connected hosts will appear in the "QHCI Host Updates" section
   - Click "Check All Hosts" to query each host for available updates
   - Click "Apply" on individual hosts to trigger updates

---

## Configuration

Add to `/etc/quantix-vdc/config.yaml`:

```yaml
updates:
  server_url: "http://update-server:9000"
  channel: "dev"
  auto_check: true
  auto_apply: false
```

---

## Related Documentation

- [000081 - OTA Update System](docs/updates/000081-ota-update-system.md)
- [000082 - Production Grade Updates](docs/updates/000082-production-grade-updates.md)
- [000083 - Quantix-OS Update Client Plan](docs/updates/000083-quantix-os-update-client-plan.md)

---

## Status: COMPLETE
