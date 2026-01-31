# 000092 - Native L4 Load Balancing Service

**Purpose:** Document the implementation of native Layer 4 load balancing using OVN's built-in load balancer capabilities.

**Status:** ✅ Implemented

---

## Executive Summary

Quantix-KVM provides native L4 load balancing without requiring dedicated load balancer VMs or appliances. The implementation leverages OVN's built-in load balancer table to distribute traffic across backend pool members with configurable algorithms and health checks.

**Key Features:**
- No "Manager" appliances - uses OVN native LB
- TCP/UDP load balancing (L4)
- Round-robin, least-connections algorithms
- Active health checks (TCP connect, HTTP GET)
- Real-time statistics

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     QvDC Dashboard                                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  LoadBalancers.tsx                                          │  │
│  │  - Create/Delete LB        - Add/Remove Listeners           │  │
│  │  - Add/Remove Members      - View Statistics                │  │
│  └──────────────────────────────────────────────────────────── ┘  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ Connect-RPC
┌────────────────────────────▼─────────────────────────────────────┐
│                   Go Control Plane                                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  LoadBalancerService (loadbalancer_service.go)             │  │
│  │  - CreateLoadBalancer()    - DeleteLoadBalancer()          │  │
│  │  - AddListener()           - RemoveListener()              │  │
│  │  - AddPoolMember()         - RemovePoolMember()            │  │
│  │  - GetLoadBalancerStats()                                  │  │
│  └──────────────────────────────────────────────────────────── ┘  │
│                             │                                     │
│                             ▼ OVN Commands                        │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  OVN Northbound DB                                         │  │
│  │  - ovn-nbctl lb-add <name> <vip>:<port> <backends>         │  │
│  │  - ovn-nbctl ls-lb-add <switch> <lb>                       │  │
│  └──────────────────────────────────────────────────────────── ┘  │
└──────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                   Rust Node Daemon                                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  health_check.rs                                            │  │
│  │  - TCP connect checks      - HTTP GET checks                │  │
│  │  - Unhealthy threshold     - Healthy threshold              │  │
│  │  - Report status to control plane                           │  │
│  └──────────────────────────────────────────────────────────── ┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### LoadBalancer

```go
type LoadBalancer struct {
    ID          string
    Name        string
    ProjectID   string
    NetworkID   string
    VIP         string            // Virtual IP address
    Algorithm   string            // "round_robin", "least_connections"
    Listeners   []LBListener
    Status      LoadBalancerStatus
    CreatedAt   time.Time
    UpdatedAt   time.Time
}

type LBListener struct {
    ID           string
    Protocol     string    // "TCP", "UDP", "HTTP", "HTTPS"
    Port         int
    DefaultPool  *LBPool
}

type LBPool struct {
    ID            string
    Algorithm     string
    Members       []LBMember
    HealthMonitor *HealthMonitor
}

type LBMember struct {
    ID        string
    Address   string    // Backend IP
    Port      int       // Backend port
    Weight    int       // For weighted algorithms
    Status    string    // "ONLINE", "OFFLINE", "DRAIN"
}

type HealthMonitor struct {
    Type             string    // "TCP", "HTTP", "HTTPS"
    Delay            int       // Seconds between checks
    Timeout          int       // Seconds to wait for response
    MaxRetries       int       // Failures before marking unhealthy
    HTTPMethod       string    // For HTTP checks
    URLPath          string    // For HTTP checks
    ExpectedCodes    string    // "200", "200-299"
}
```

---

## API Reference

### Proto Definition

```protobuf
service LoadBalancerService {
  rpc CreateLoadBalancer(CreateLoadBalancerRequest) returns (LoadBalancer);
  rpc GetLoadBalancer(GetLoadBalancerRequest) returns (LoadBalancer);
  rpc ListLoadBalancers(ListLoadBalancersRequest) returns (ListLoadBalancersResponse);
  rpc UpdateLoadBalancer(UpdateLoadBalancerRequest) returns (LoadBalancer);
  rpc DeleteLoadBalancer(DeleteLoadBalancerRequest) returns (google.protobuf.Empty);
  
  rpc AddListener(AddListenerRequest) returns (LoadBalancer);
  rpc RemoveListener(RemoveListenerRequest) returns (LoadBalancer);
  
  rpc AddPoolMember(AddPoolMemberRequest) returns (LoadBalancer);
  rpc RemovePoolMember(RemovePoolMemberRequest) returns (LoadBalancer);
  
  rpc GetLoadBalancerStats(GetLoadBalancerStatsRequest) returns (LoadBalancerStats);
}
```

### REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/load-balancers` | Create load balancer |
| GET | `/api/v1/load-balancers` | List load balancers |
| GET | `/api/v1/load-balancers/{id}` | Get load balancer |
| PUT | `/api/v1/load-balancers/{id}` | Update load balancer |
| DELETE | `/api/v1/load-balancers/{id}` | Delete load balancer |
| POST | `/api/v1/load-balancers/{id}/listeners` | Add listener |
| DELETE | `/api/v1/load-balancers/{id}/listeners/{lid}` | Remove listener |
| POST | `/api/v1/load-balancers/{id}/pools/{pid}/members` | Add member |
| DELETE | `/api/v1/load-balancers/{id}/pools/{pid}/members/{mid}` | Remove member |

---

## OVN Integration

### Creating a Load Balancer

When `CreateLoadBalancer` is called, the service executes:

```bash
# Create OVN load balancer
ovn-nbctl lb-add lb-web-1 192.168.1.100:80 10.0.0.10:8080,10.0.0.11:8080

# Attach to logical switch
ovn-nbctl ls-lb-add network-1 lb-web-1
```

### Load Balancer Algorithms

| Algorithm | OVN Option | Description |
|-----------|------------|-------------|
| Round Robin | (default) | Sequential distribution |
| Least Connections | Not native | Requires custom implementation |

### Health Check Integration

The Rust agent performs health checks and reports results to the control plane:

```rust
// agent/limiquantix-node/src/health_check.rs

pub struct HealthCheckManager {
    configs: HashMap<String, HealthCheckConfig>,
    targets: Vec<HealthCheckTarget>,
    results_tx: mpsc::Sender<HealthCheckResult>,
}

impl HealthCheckManager {
    pub async fn run_check_cycle(&self) -> Vec<HealthCheckResult> {
        let mut results = Vec::new();
        for target in &self.targets {
            let (healthy, error) = match &target.config.check_type {
                HealthCheckType::TCP => self.tcp_check(target).await,
                HealthCheckType::HTTP { .. } => self.http_check(target).await,
            };
            results.push(HealthCheckResult { target_id: target.id, healthy, error });
        }
        results
    }
}
```

When a member becomes unhealthy, the control plane updates OVN:

```bash
# Remove unhealthy backend
ovn-nbctl lb-del lb-web-1 192.168.1.100:80 10.0.0.11:8080
```

---

## Frontend Integration

### React Query Hooks

```typescript
// frontend/src/hooks/useLoadBalancers.ts

export function useLoadBalancers(options?: { projectId?: string }) {
  return useQuery({
    queryKey: loadBalancerKeys.list(options?.projectId),
    queryFn: () => loadBalancerApi.list({ projectId: options?.projectId }),
    staleTime: 30000,
  });
}

export function useCreateLoadBalancer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => loadBalancerApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: loadBalancerKeys.lists() });
    },
  });
}
```

### API Client

```typescript
// frontend/src/lib/api-client.ts

export const loadBalancerApi = {
  async list(params?: { projectId?: string }): Promise<LoadBalancerListResponse> {
    return apiCall<LoadBalancerListResponse>(
      'limiquantix.network.v1.LoadBalancerService',
      'ListLoadBalancers',
      params || {}
    );
  },
  
  async create(data: CreateLoadBalancerData): Promise<ApiLoadBalancer> {
    return apiCall<ApiLoadBalancer>(
      'limiquantix.network.v1.LoadBalancerService',
      'CreateLoadBalancer',
      data
    );
  },
  // ... other methods
};
```

---

## Usage Examples

### Create a Web Load Balancer

```bash
# Using the API
curl -X POST http://localhost:8080/api/v1/load-balancers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "web-lb",
    "project_id": "proj-123",
    "network_id": "net-456",
    "vip_address": "192.168.1.100",
    "listeners": [{
      "protocol": "TCP",
      "port": 80,
      "default_pool": {
        "algorithm": "ROUND_ROBIN",
        "members": [
          {"address": "10.0.0.10", "port": 8080, "weight": 1},
          {"address": "10.0.0.11", "port": 8080, "weight": 1}
        ],
        "health_monitor": {
          "type": "HTTP",
          "delay": 5,
          "timeout": 3,
          "max_retries": 3,
          "http_method": "GET",
          "url_path": "/health",
          "expected_codes": "200"
        }
      }
    }]
  }'
```

### Monitor Load Balancer Statistics

```bash
# Get real-time stats
curl http://localhost:8080/api/v1/load-balancers/lb-123/stats

# Response:
{
  "total_connections": 15432,
  "active_connections": 127,
  "bytes_in": 1073741824,
  "bytes_out": 5368709120,
  "requests_per_second": 245.7,
  "listeners": [
    {
      "listener_id": "lis-456",
      "connections": 127,
      "members": [
        {"member_id": "mem-1", "connections": 64, "status": "ONLINE"},
        {"member_id": "mem-2", "connections": 63, "status": "ONLINE"}
      ]
    }
  ]
}
```

---

## Troubleshooting

### Check OVN Load Balancer Status

```bash
# List all load balancers
ovn-nbctl lb-list

# Show specific load balancer
ovn-nbctl lb-list lb-web-1

# Check which switches have the LB
ovn-nbctl ls-lb-list network-1
```

### Health Check Not Working

1. Verify health check configuration:
```bash
# Check if health check module is running
journalctl -u quantix-node -f | grep health_check
```

2. Test connectivity from node to backend:
```bash
# TCP check
nc -zv 10.0.0.10 8080

# HTTP check
curl -v http://10.0.0.10:8080/health
```

### Traffic Not Reaching Backends

1. Verify OVN flows:
```bash
# Trace packet through OVN
ovn-trace network-1 'inport=="client-port" && eth.src==<mac> && ip4.dst==192.168.1.100'
```

2. Check OVS flows:
```bash
ovs-ofctl dump-flows br-int | grep "192.168.1.100"
```

---

## Files

| File | Description |
|------|-------------|
| `backend/internal/services/network/loadbalancer_service.go` | Go service implementation |
| `backend/internal/repository/memory/network_repository.go` | In-memory repository |
| `agent/limiquantix-node/src/health_check.rs` | Rust health check module |
| `frontend/src/hooks/useLoadBalancers.ts` | React Query hooks |
| `frontend/src/lib/api-client.ts` | API client methods |
| `frontend/src/pages/LoadBalancers.tsx` | UI page |
| `proto/limiquantix/network/v1/network_service.proto` | Proto definitions |

---

## See Also

- [000048-network-backend-ovn-ovs.md](000048-network-backend-ovn-ovs.md) - OVN/OVS architecture
- [000052-advanced-networking-features.md](000052-advanced-networking-features.md) - Advanced features overview
