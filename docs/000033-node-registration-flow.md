# 000033 - Node Registration Flow

**Document ID:** 000033  
**Category:** Architecture / Integration  
**Status:** Implemented  
**Created:** January 2, 2026  

---

## Overview

This document describes how Node Daemons automatically register with the Control Plane on startup and maintain connectivity via periodic heartbeats.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Control Plane (Go)                               │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                      NodeService                                     │ │
│  │                                                                      │ │
│  │   RegisterNode()  ─────► Create/Update Node in Repository           │ │
│  │   UpdateHeartbeat() ───► Update LastHeartbeat + Resources           │ │
│  │   ListNodes() ─────────► Return all registered nodes                │ │
│  │                                                                      │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTP/Connect-RPC
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
         ▼                         ▼                         ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Node Daemon 1  │    │  Node Daemon 2  │    │  Node Daemon 3  │
│                 │    │                 │    │                 │
│ RegistrationClient  │ RegistrationClient  │ RegistrationClient
│ - register()    │    │ - register()    │    │ - register()    │
│ - heartbeat()   │    │ - heartbeat()   │    │ - heartbeat()   │
│ - run() loop    │    │ - run() loop    │    │ - run() loop    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## Registration Flow

### Startup Sequence

```
1. Node Daemon starts
2. Collects system telemetry (CPU, memory, hostname)
3. Detects management IP address
4. Calls RegisterNode() on Control Plane
5. Receives node ID and configuration
6. Starts heartbeat loop (every 30 seconds)
7. Starts gRPC server for VM operations
```

### Registration Request

The Node Daemon sends the following information:

```json
{
  "hostname": "hypervisor-01.local",
  "managementIp": "192.168.1.10:9090",
  "labels": {
    "zone": "us-east-1a",
    "rack": "rack-42"
  },
  "role": {
    "compute": true,
    "storage": false,
    "controlPlane": false
  },
  "cpuInfo": {
    "model": "Intel Xeon E5-2680 v4",
    "sockets": 2,
    "coresPerSocket": 14,
    "threadsPerCore": 2,
    "features": ["vmx", "avx2"]
  },
  "memoryInfo": {
    "totalMib": 262144,
    "allocatableMib": 245760
  }
}
```

### Control Plane Response

On success, the Control Plane returns the full Node object:

```json
{
  "id": "28113561-2e72-490d-8bd7-050d2e7c2d18",
  "hostname": "hypervisor-01.local",
  "managementIp": "192.168.1.10:9090",
  "status": {
    "phase": "READY"
  },
  "createdAt": "2026-01-02T09:27:41.446Z"
}
```

---

## Heartbeat Loop

After successful registration, the Node Daemon sends periodic heartbeats:

### Heartbeat Request

```json
{
  "nodeId": "28113561-2e72-490d-8bd7-050d2e7c2d18",
  "cpuUsagePercent": 35.2,
  "memoryUsedMib": 98304,
  "memoryTotalMib": 262144
}
```

### Heartbeat Behavior

- **Interval**: Every 30 seconds (configurable)
- **Retry on Failure**: Exponential backoff on connection errors
- **Re-registration**: After 3 consecutive heartbeat failures, attempts re-registration

---

## Implementation Details

### Rust - RegistrationClient

**Location**: `agent/limiquantix-node/src/registration.rs`

```rust
pub struct RegistrationClient {
    control_plane_address: String,
    node_id: String,
    hostname: String,
    management_ip: String,
    labels: HashMap<String, String>,
    heartbeat_interval: Duration,
    telemetry: Arc<TelemetryCollector>,
    http_client: reqwest::Client,
}

impl RegistrationClient {
    /// Register with the control plane.
    pub async fn register(&self) -> Result<()>;
    
    /// Send a heartbeat.
    pub async fn heartbeat(&self) -> Result<()>;
    
    /// Run the registration + heartbeat loop.
    pub async fn run(&self);
}
```

### Go - NodeService.RegisterNode

**Location**: `backend/internal/services/node/service.go`

```go
func (s *Service) RegisterNode(
    ctx context.Context,
    req *connect.Request[computev1.RegisterNodeRequest],
) (*connect.Response[computev1.Node], error) {
    // 1. Check if node already exists (by hostname)
    // 2. If exists: update existing node, set status to READY
    // 3. If new: create new node with provided info
    // 4. Return full node object
}
```

---

## Configuration

### Node Daemon CLI Flags

```bash
# Enable registration
limiquantix-node --register --control-plane http://control-plane:8080

# Full example
limiquantix-node \
  --dev \
  --listen 0.0.0.0:9090 \
  --control-plane http://control-plane:8080 \
  --register \
  --node-id my-node-01
```

### Node Daemon Config File

```yaml
# /etc/limiquantix/node.yaml
node:
  id: my-node-01  # Optional, auto-generated if not set
  hostname: hypervisor-01.local  # Optional, auto-detected
  labels:
    zone: us-east-1a
    rack: rack-42

server:
  listen_address: 0.0.0.0:9090

control_plane:
  address: http://control-plane:8080
  registration_enabled: true
  heartbeat_interval_secs: 30
```

---

## Management IP Detection

The Node Daemon automatically detects its management IP address:

1. Enumerate all network interfaces
2. Skip loopback (127.0.0.1)
3. Skip link-local (169.254.x.x)
4. Return first valid IPv4 address
5. Fallback to 127.0.0.1 if detection fails

The management IP is sent with port 9090 (e.g., `192.168.1.10:9090`) so the Control Plane knows how to connect back.

---

## Error Handling

### Registration Failures

| Failure Mode | Behavior |
|--------------|----------|
| Control Plane unreachable | Retry with exponential backoff (1s → 60s max) |
| Invalid request (4xx) | Log error, retry after delay |
| Server error (5xx) | Retry with backoff |

### Heartbeat Failures

| Failure Mode | Behavior |
|--------------|----------|
| Single failure | Log warning, continue |
| 3+ consecutive failures | Attempt re-registration |
| Re-registration success | Reset failure counter |

---

## Lifecycle States

```
                    ┌─────────────────┐
                    │   NOT_STARTED   │
                    └────────┬────────┘
                             │ run()
                             ▼
                    ┌─────────────────┐
          ┌─────────│  REGISTERING    │◄────────────┐
          │         └────────┬────────┘             │
          │                  │ success              │
          │                  ▼                      │
          │         ┌─────────────────┐             │
          │         │    REGISTERED    │            │
          │         └────────┬────────┘             │
          │                  │                      │
          │                  ▼                      │
          │         ┌─────────────────┐             │
    error │         │  HEARTBEATING   │─────────────┤
   (retry)│         └────────┬────────┘             │
          │                  │ 3+ failures          │
          │                  ▼                      │
          │         ┌─────────────────┐             │
          └─────────│ RE-REGISTERING  │─────────────┘
                    └─────────────────┘
```

---

## Monitoring & Debugging

### Logs (Node Daemon)

```
INFO  Registering with control plane control_plane=http://127.0.0.1:8080
INFO  Successfully registered with control plane node_id=28113561-...
DEBUG Sending heartbeat node_id=28113561-...
DEBUG Heartbeat acknowledged node_id=28113561-...
WARN  Heartbeat failed, will retry node_id=28113561-... status=500
```

### Logs (Control Plane)

```
INFO  Node registration request hostname=hypervisor-01.local
INFO  Node registered successfully node_id=28113561-...
INFO  HTTP request path=/NodeService/RegisterNode status=200
```

---

## Testing

### Manual Test

```bash
# Terminal 1: Start Control Plane
cd backend && go run ./cmd/controlplane --dev

# Terminal 2: Start Node Daemon with registration
cd agent && cargo run --bin limiquantix-node -- \
  --dev \
  --listen 127.0.0.1:9090 \
  --control-plane http://127.0.0.1:8080 \
  --register

# Terminal 3: Check registered nodes
curl -X POST http://127.0.0.1:8080/limiquantix.compute.v1.NodeService/ListNodes \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Expected Output

The ListNodes response should include the newly registered node:

```json
{
  "nodes": [
    {
      "id": "28113561-2e72-490d-8bd7-050d2e7c2d18",
      "hostname": "Gals-MacBook-Pro.local",
      "managementIp": "192.168.0.144:9090",
      "status": {
        "phase": "READY"
      }
    }
    // ... other demo nodes
  ]
}
```

---

## Future Enhancements

1. **TLS/mTLS**: Secure registration with certificates
2. **Authentication**: API key or token for registration
3. ~~**Heartbeat Endpoint**~~: ✅ Implemented - UpdateHeartbeat in Go backend
4. **Health Status**: Track node health based on missed heartbeats
5. **Auto-drain**: Mark node as draining after extended heartbeat loss
6. **Event Streaming**: WebSocket for real-time node status updates

---

## Related Documents

- [000032 - VMService to Node Daemon Integration](000032-vmservice-node-daemon-integration.md)
- [000031 - Node Daemon Implementation Plan](000031-node-daemon-implementation-plan.md)
- [000002 - Node Model Design](adr/000002-node-model-design.md)

