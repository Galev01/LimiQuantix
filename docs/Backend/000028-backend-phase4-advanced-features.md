# Backend Phase 4 Implementation - Advanced Features

**Document ID:** 000028  
**Purpose:** Documents the implementation of Backend Phase 4: Advanced Features  
**Status:** ✅ Complete  
**Date:** January 2026

---

## Overview

Backend Phase 4 implements enterprise-grade features including JWT authentication, RBAC authorization, alerting, DRS (Distributed Resource Scheduler), HA (High Availability), and real-time streaming.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           limiquantix Backend                               │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      Security Layer                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │  │
│  │  │ JWT Manager │  │Auth Middleware│  │    RBAC    │                   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Background Services                                │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │  │
│  │  │ DRS Engine  │  │ HA Manager  │  │  Streaming  │                   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                       Core Services                                   │  │
│  │  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐                   │  │
│  │  │  VM  │  │ Node │  │Storage│  │Network│  │ Alert│                   │  │
│  │  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘                   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Authentication & Authorization

### 1.1 Domain Models (`domain/user.go`)

| Model | Description |
|-------|-------------|
| `User` | User account with role and password hash |
| `Role` | Enum: `admin`, `operator`, `viewer` |
| `Permission` | Fine-grained permissions (e.g., `vm:create`) |
| `RolePermissions` | Mapping of roles to permissions |
| `AuditEntry` | Audit log for user actions |

### 1.2 JWT Manager (`services/auth/jwt.go`)

| Method | Description |
|--------|-------------|
| `NewJWTManager(cfg)` | Create JWT manager with config |
| `Generate(user)` | Create access + refresh token pair |
| `Verify(token)` | Validate and parse access token |
| `VerifyRefreshToken(token)` | Validate refresh token |

**Token Claims:**
```go
type Claims struct {
    UserID   string
    Username string
    Email    string
    Role     domain.Role
    jwt.RegisteredClaims
}
```

### 1.3 Auth Service (`services/auth/service.go`)

| Method | Description |
|--------|-------------|
| `Login(req)` | Authenticate user, return tokens |
| `Logout(sessionID, userID)` | Invalidate session |
| `RefreshTokens(refreshToken)` | Get new token pair |
| `CreateUser(...)` | Create new user account |
| `ChangePassword(...)` | Update user password |
| `CheckPermission(userID, permission)` | RBAC check |

### 1.4 Auth Middleware (`server/middleware/auth.go`)

**Connect-RPC Interceptor:**
```go
interceptor := middleware.NewAuthInterceptor(jwtManager, logger)

// In service registration:
vmPath, vmHandler := computev1connect.NewVMServiceHandler(
    vmService,
    connect.WithInterceptors(interceptor),
)
```

**Helper Functions:**
```go
// Extract user info from context
claims, ok := middleware.GetClaims(ctx)
userID, ok := middleware.GetUserID(ctx)
role, ok := middleware.GetRole(ctx)

// Check permissions
if err := middleware.RequireRole(ctx, domain.RoleAdmin); err != nil {
    return nil, err
}

if err := middleware.RequirePermission(ctx, domain.PermissionVMCreate); err != nil {
    return nil, err
}
```

---

## 2. Alert Service

### 2.1 Alert Domain Model (`domain/user.go`)

```go
type Alert struct {
    ID             string
    Severity       AlertSeverity   // CRITICAL, WARNING, INFO
    Title          string
    Message        string
    SourceType     AlertSourceType // VM, HOST, STORAGE, NETWORK, CLUSTER, SYSTEM
    SourceID       string
    SourceName     string
    Acknowledged   bool
    Resolved       bool
    CreatedAt      time.Time
}
```

### 2.2 Alert Service (`services/alert/service.go`)

| Method | Description |
|--------|-------------|
| `CreateAlert(...)` | Create new alert |
| `GetAlert(id)` | Get alert by ID |
| `ListAlerts(filter, ...)` | Paginated alert list |
| `AcknowledgeAlert(id, by)` | Mark as acknowledged |
| `ResolveAlert(id)` | Mark as resolved |
| `GetAlertSummary()` | Count by severity |
| `VMAlert(...)` | Create VM-specific alert |
| `NodeAlert(...)` | Create node-specific alert |
| `StorageAlert(...)` | Create storage alert |
| `ClusterAlert(...)` | Create cluster alert |
| `SystemAlert(...)` | Create system-wide alert |

---

## 3. DRS Engine (Distributed Resource Scheduler)

### 3.1 Configuration

```yaml
drs:
  enabled: true
  interval: 5m           # Analysis frequency
  automation_level: manual  # manual | partial | full
  threshold_cpu: 80      # Trigger at 80% CPU
  threshold_memory: 85   # Trigger at 85% memory
```

### 3.2 DRS Engine (`drs/engine.go`)

| Method | Description |
|--------|-------------|
| `Start(ctx)` | Begin background analysis |
| `runAnalysis(ctx)` | Single analysis cycle |
| `calculateNodeMetrics(ctx, node)` | Get node resource usage |
| `analyzeBalance(ctx, metrics)` | Find imbalanced nodes |
| `GetPendingRecommendations(ctx, limit)` | List pending recommendations |
| `ApproveRecommendation(ctx, id, by)` | Mark as approved |
| `ApplyRecommendation(ctx, id, by)` | Execute migration |
| `RejectRecommendation(ctx, id)` | Reject recommendation |

### 3.3 DRS Recommendation

```go
type DRSRecommendation struct {
    ID                 string
    Priority           DRSPriority  // CRITICAL, HIGH, MEDIUM, LOW
    RecommendationType DRSRecommendationType // MIGRATE, POWER_ON, POWER_OFF
    Reason             string
    VMID               string
    VMName             string
    SourceNodeID       string
    SourceNodeName     string
    TargetNodeID       string
    TargetNodeName     string
    ImpactCPU          int32        // Expected improvement %
    ImpactMemory       int32
    EstimatedDuration  string       // e.g., "2m30s"
    Status             DRSStatus    // PENDING, APPROVED, APPLIED, REJECTED
}
```

### 3.4 DRS Flow

1. **Analysis** - Every `interval`, analyze all nodes
2. **Detection** - Find nodes exceeding CPU/memory thresholds
3. **Recommendation** - Generate migration recommendations
4. **Approval** - (If `automation_level` is `manual`) Wait for operator approval
5. **Execution** - Trigger VM migration
6. **Cleanup** - Remove old recommendations after 24h

---

## 4. HA Manager (High Availability)

### 4.1 Configuration

```yaml
ha:
  enabled: true
  check_interval: 10s       # Node health check frequency
  heartbeat_timeout: 30s    # Max time without heartbeat
  failure_threshold: 3      # Checks before declaring failure
```

### 4.2 HA Manager (`ha/manager.go`)

| Method | Description |
|--------|-------------|
| `Start(ctx)` | Begin node monitoring |
| `checkNodes(ctx)` | Check all nodes |
| `checkNode(ctx, node)` | Check single node health |
| `triggerFailover(ctx, node)` | Restart VMs from failed node |
| `failoverVM(ctx, vm, failedNodeID)` | Restart single VM |
| `GetNodeState(nodeID)` | Get node health state |
| `ManualFailover(ctx, nodeID)` | Force failover |

### 4.3 HA Flow

1. **Monitoring** - Every `check_interval`, check all node heartbeats
2. **Detection** - If heartbeat age > `heartbeat_timeout`, increment failed checks
3. **Failure Declaration** - After `failure_threshold` failed checks, declare node failed
4. **Failover** - For each HA-enabled VM on failed node:
   - Find alternative node via scheduler
   - Start VM on new node
   - Create alert
5. **Recovery** - When node recovers, update state

### 4.4 Node Health States

| State | Description |
|-------|-------------|
| `HEALTHY` | Node heartbeat within timeout |
| `UNKNOWN` | Missed 1-2 heartbeats |
| `UNREACHABLE` | Cannot reach node |
| `FAILED` | Node declared failed, VMs migrated |

---

## 5. Real-Time Streaming

### 5.1 Streaming Service (`services/streaming/service.go`)

| Method | Description |
|--------|-------------|
| `Subscribe(ctx, filter)` | Create event subscription |
| `Unsubscribe(id)` | Remove subscription |
| `Publish(event)` | Send event to matching subscribers |
| `PublishVMEvent(type, vm)` | Publish VM event |
| `PublishNodeEvent(type, node)` | Publish node event |
| `PublishAlertEvent(type, alert)` | Publish alert event |

### 5.2 Subscription Filter

```go
type SubscriptionFilter struct {
    ResourceType string      // "vm", "node", "alert"
    ResourceID   string      // Optional: specific resource
    EventTypes   []EventType // CREATED, UPDATED, DELETED, STARTED, STOPPED
    ProjectID    string      // For multi-tenant filtering
}
```

### 5.3 VM Watcher

```go
watcher := streaming.NewVMWatcher(streamingService, vmRepo, logger)

// Watch single VM
vmChan, err := watcher.WatchVM(ctx, "vm-123")
for vm := range vmChan {
    fmt.Printf("VM updated: %s, state: %s\n", vm.Name, vm.Status.State)
}

// Watch all VMs in project
vmsChan, err := watcher.WatchVMs(ctx, "project-123")
```

### 5.4 Node Watcher

```go
watcher := streaming.NewNodeWatcher(streamingService, nodeRepo, logger)

// Watch single node
nodeChan, err := watcher.WatchNode(ctx, "node-123")
for node := range nodeChan {
    fmt.Printf("Node updated: %s, phase: %s\n", node.Hostname, node.Status.Phase)
}

// Watch all nodes
nodesChan, err := watcher.WatchNodes(ctx)
```

---

## 6. Dependencies Added

```go
// go.mod additions
require (
    github.com/golang-jwt/jwt/v5 v5.2.1  // JWT tokens
    golang.org/x/crypto v0.38.0          // Password hashing (bcrypt)
)
```

---

## 7. File Summary

```
backend/internal/
├── domain/
│   └── user.go                    # User, Role, Permission, Alert, DRS models
├── services/
│   ├── auth/
│   │   ├── jwt.go                 # JWT token management
│   │   └── service.go             # Auth service (login, users)
│   ├── alert/
│   │   └── service.go             # Alert management
│   └── streaming/
│       └── service.go             # Real-time event streaming
├── server/
│   └── middleware/
│       └── auth.go                # Auth interceptor for Connect-RPC
├── drs/
│   └── engine.go                  # DRS analysis and recommendations
└── ha/
    └── manager.go                 # Node monitoring and VM failover
```

---

## 8. Integration Example

### Enable Auth in Server

```go
// In server.go
func (s *Server) registerRoutes() {
    // Create auth interceptor
    authInterceptor := middleware.NewAuthInterceptor(s.jwtManager, s.logger)
    
    // Register services with auth
    vmPath, vmHandler := computev1connect.NewVMServiceHandler(
        s.vmService,
        connect.WithInterceptors(authInterceptor),
    )
    s.mux.Handle(vmPath, vmHandler)
}
```

### Start Background Services

```go
// In main.go
func main() {
    // ... server setup ...
    
    // Start DRS engine (only runs on leader)
    drsEngine := drs.NewEngine(cfg.DRS, nodeRepo, vmRepo, recommRepo, alertService, leader, logger)
    go drsEngine.Start(ctx)
    
    // Start HA manager (only runs on leader)
    haManager := ha.NewManager(cfg.HA, nodeRepo, vmRepo, scheduler, vmController, alertService, leader, logger)
    go haManager.Start(ctx)
    
    // Start streaming service
    streamingService := streaming.NewService(logger)
    // ... pass to services that need to publish events ...
}
```

---

## 9. API Usage Examples

### Login

```bash
curl -X POST http://localhost:8080/limiquantix.auth.v1.AuthService/Login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}'
```

### Authenticated Request

```bash
curl http://localhost:8080/limiquantix.compute.v1.VMService/ListVMs \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Refresh Token

```bash
curl -X POST http://localhost:8080/limiquantix.auth.v1.AuthService/RefreshToken \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "<refresh_token>"}'
```

---

## 10. Next Steps

### Phase 5 (Future)
1. **Rate Limiting** - Protect APIs from abuse
2. **API Keys** - Service account authentication
3. **SSO Integration** - SAML/OIDC support
4. **Multi-tenancy** - Project isolation
5. **Audit Dashboard** - UI for audit logs
6. **Alert Webhooks** - External notification integrations

---

## References

- [Backend Plan](../backend-plan.md)
- [Backend Implementation Guide](./000024-backend-implementation-guide.md)
- [Phase 2 Implementation](./000026-backend-phase2-implementation.md)
- [Phase 3 Implementation](./000027-backend-phase3-data-persistence.md)
