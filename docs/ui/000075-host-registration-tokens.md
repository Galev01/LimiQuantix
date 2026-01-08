# 000075 - Host Registration Token System

**Document ID:** 000075  
**Category:** UI / Security  
**Status:** Implemented  
**Created:** January 8, 2026  

---

## Overview

This document describes the host registration token system that allows secure enrollment of Quantix-OS hosts into the cluster. Hosts must provide a valid registration token to join the cluster, preventing unauthorized nodes from registering.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Quantix-vDC UI                                  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Add Host Modal                                                  │   │
│  │  - Generate new tokens                                          │   │
│  │  - Configure expiry, max uses                                   │   │
│  │  - View/revoke existing tokens                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                 │                                       │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │ REST API
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Control Plane (Go)                                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Registration Token Service                                      │   │
│  │  - CreateToken()  → Generate cryptographic token                │   │
│  │  - ValidateToken() → Check expiry, uses, revocation             │   │
│  │  - UseToken()     → Increment usage after registration          │   │
│  │  - RevokeToken()  → Prevent further use                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                 │                                       │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Quantix-OS     │    │  Quantix-OS     │    │  Quantix-OS     │
│  Host 1         │    │  Host 2         │    │  Host 3         │
│                 │    │                 │    │                 │
│ Console (F4)    │    │ Console (F4)    │    │ Console (F4)    │
│ - Enter token   │    │ - Enter token   │    │ - Enter token   │
│ - Join cluster  │    │ - Join cluster  │    │ - Join cluster  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## Token Format

Registration tokens use a human-readable format with cryptographic security:

```
QUANTIX-XXXX-XXXX-XXXX-XXXX
```

Example: `QUANTIX-7Y3K-MNBV-2QP5-LXWJ`

- **Prefix**: `QUANTIX-` for easy identification
- **Body**: 16 Base32 characters (from 12 random bytes)
- **Format**: Grouped into 4-character blocks for readability

---

## REST API Endpoints

### List Tokens

```http
GET /api/admin/registration-tokens
GET /api/admin/registration-tokens?include_expired=true
```

Response:
```json
{
  "tokens": [
    {
      "id": "uuid-here",
      "token": "QUANTIX-7Y3K-MNBV-2QP5-LXWJ",
      "description": "Production rack 1",
      "expires_at": "2026-01-09T10:30:00Z",
      "max_uses": 5,
      "use_count": 2,
      "used_by_nodes": ["node-1", "node-2"],
      "is_valid": true,
      "created_at": "2026-01-08T10:30:00Z",
      "created_by": "admin"
    }
  ],
  "total_count": 1
}
```

### Create Token

```http
POST /api/admin/registration-tokens
Content-Type: application/json

{
  "description": "Production rack 1",
  "expires_in_hours": 24,
  "max_uses": 5
}
```

Response: Single token object (same format as list item)

### Get Token

```http
GET /api/admin/registration-tokens/{id}
```

### Revoke Token

```http
POST /api/admin/registration-tokens/{id}/revoke
```

### Delete Token

```http
DELETE /api/admin/registration-tokens/{id}
```

---

## Token Validation Rules

A token is valid if ALL of the following are true:

1. **Exists**: Token is in the database
2. **Not Expired**: Current time < `expires_at`
3. **Not Revoked**: `revoked_at` is null
4. **Not Exhausted**: `use_count` < `max_uses` (or `max_uses` = 0 for unlimited)

---

## UI Components

### Add Host Modal

Located at `frontend/src/components/host/AddHostModal.tsx`

Features:
- **Generate New Token** tab:
  - Description field (optional)
  - Expiry dropdown (1h, 4h, 24h, 3d, 7d)
  - Max uses dropdown (1, 5, 10, 25, unlimited)
  - Copy button for token
  - Setup instructions for Quantix-OS console

- **Existing Tokens** tab:
  - List of valid tokens with usage stats
  - Copy, revoke, delete actions
  - Expiry countdown display

### Host Registration Instructions

When a token is generated, the UI displays:

1. Boot the host with Quantix-OS
2. Press F4 in the console to open Cluster Join
3. Enter the Control Plane URL
4. Paste the registration token
5. The host will automatically register

---

## Security Considerations

### Token Generation

- Uses `crypto/rand` for cryptographically secure random bytes
- 12 bytes of entropy = 96 bits (effectively unguessable)
- Base32 encoding for human-readable format

### Token Lifecycle

| State | Description |
|-------|-------------|
| Active | Token can be used for registration |
| Used (partial) | Some uses remain (if max_uses > 1) |
| Exhausted | `use_count >= max_uses` |
| Expired | Past `expires_at` timestamp |
| Revoked | Manually revoked by admin |

### Best Practices

1. **Short Expiry**: Use 1-4 hour tokens for single host additions
2. **Single Use**: Use `max_uses=1` when adding known hosts
3. **Multi-Host**: Use higher limits for bulk provisioning
4. **Revoke Unused**: Revoke tokens after use or if leaked
5. **Audit Trail**: `used_by_nodes` tracks which hosts used each token

---

## Future Enhancements

1. **Token Validation in RegisterNode**: Require token in `RegisterNodeRequest`
2. **QR Code Display**: Generate QR code for easy mobile/camera scanning
3. **Email/Slack Tokens**: Send tokens via notification channels
4. **Token Groups**: Organize tokens by purpose/team
5. **Audit Logging**: Log token creation, use, revocation events
6. **PostgreSQL Storage**: Persist tokens for production use

---

## Files

### Backend

| File | Purpose |
|------|---------|
| `backend/internal/domain/registration_token.go` | Token model and generation |
| `backend/internal/repository/memory/registration_token_repository.go` | In-memory storage |
| `backend/internal/services/registration/service.go` | Business logic |
| `backend/internal/server/registration_handlers.go` | REST API handlers |
| `backend/internal/server/server.go` | Service integration |

### Frontend

| File | Purpose |
|------|---------|
| `frontend/src/lib/api-client.ts` | API client with token endpoints |
| `frontend/src/hooks/useRegistrationTokens.ts` | React Query hooks |
| `frontend/src/components/host/AddHostModal.tsx` | UI modal component |
| `frontend/src/pages/HostList.tsx` | Host page with Add Host button |

---

## Related Documents

- [000033 - Node Registration Flow](../node-daemon/000033-node-registration-flow.md)
- [000058 - Quantix-OS Complete Vision](../Quantix-OS/000058-quantix-os-complete-vision.md)
