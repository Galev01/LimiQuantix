# Backend Testing Guide

**Document ID:** 000029  
**Purpose:** Comprehensive testing guide for the Quantixkvm backend  
**Status:** Reference Document  
**Date:** January 2026

---

## Overview

This guide covers all testing levels for the Quantixkvm backend:

1. **Unit Tests** - Test individual functions/methods
2. **Integration Tests** - Test service + repository combinations
3. **E2E Tests** - Test full API endpoints
4. **Load Tests** - Test performance under load

---

## 1. Prerequisites

### 1.1 Install Test Dependencies

```bash
cd backend

# Install test tools
go install gotest.tools/gotestsum@latest
go install github.com/vektra/mockery/v2@latest

# Install load testing tool
go install github.com/rakyll/hey@latest
```

### 1.2 Environment Setup

```bash
# Start infrastructure for integration tests
docker compose up -d postgres redis etcd

# Run migrations
make migrate-up

# Verify services are running
curl http://localhost:8080/health
```

---

## 2. Unit Tests

### 2.1 Running Unit Tests

```bash
# Run all unit tests
make test

# Run with coverage
make test-coverage

# Run specific package
go test -v ./internal/services/vm/...

# Run specific test
go test -v -run TestVMService_CreateVM ./internal/services/vm/...
```

### 2.2 Unit Test Checklist

#### VM Service Tests (`internal/services/vm/`)

| Test | Description | Priority |
|------|-------------|----------|
| `TestCreateVM_Success` | Create VM with valid spec | P0 |
| `TestCreateVM_InvalidSpec` | Reject VM with missing fields | P0 |
| `TestCreateVM_DuplicateName` | Reject duplicate VM name | P0 |
| `TestGetVM_Exists` | Get existing VM | P0 |
| `TestGetVM_NotFound` | Return error for missing VM | P0 |
| `TestListVMs_Empty` | List with no VMs | P0 |
| `TestListVMs_Filtered` | List with state filter | P1 |
| `TestListVMs_Paginated` | List with pagination | P1 |
| `TestUpdateVM_Success` | Update VM spec | P0 |
| `TestDeleteVM_Success` | Delete existing VM | P0 |
| `TestStartVM_Stopped` | Start a stopped VM | P0 |
| `TestStartVM_AlreadyRunning` | Error when already running | P1 |
| `TestStopVM_Running` | Stop a running VM | P0 |
| `TestStopVM_AlreadyStopped` | Error when already stopped | P1 |

#### Node Service Tests (`internal/services/node/`)

| Test | Description | Priority |
|------|-------------|----------|
| `TestRegisterNode_Success` | Register new node | P0 |
| `TestRegisterNode_DuplicateHostname` | Reject duplicate hostname | P0 |
| `TestGetNode_Exists` | Get existing node | P0 |
| `TestListNodes_All` | List all nodes | P0 |
| `TestListNodes_ByCluster` | List nodes in cluster | P1 |
| `TestUpdateNode_Success` | Update node spec | P0 |
| `TestDrainNode_Success` | Mark node for drain | P1 |
| `TestEnableNode_Success` | Enable disabled node | P1 |

#### Auth Service Tests (`internal/services/auth/`)

| Test | Description | Priority |
|------|-------------|----------|
| `TestLogin_ValidCredentials` | Login with correct password | P0 |
| `TestLogin_InvalidPassword` | Reject wrong password | P0 |
| `TestLogin_UserNotFound` | Reject unknown user | P0 |
| `TestLogin_DisabledUser` | Reject disabled user | P0 |
| `TestRefreshToken_Valid` | Refresh with valid token | P0 |
| `TestRefreshToken_Expired` | Reject expired token | P0 |
| `TestCreateUser_Success` | Create new user | P0 |
| `TestChangePassword_Success` | Change password | P1 |

#### Scheduler Tests (`internal/scheduler/`)

| Test | Description | Priority |
|------|-------------|----------|
| `TestSchedule_SingleNode` | Schedule on only available node | P0 |
| `TestSchedule_BestNode` | Select node with most resources | P0 |
| `TestSchedule_NoNodes` | Error when no nodes available | P0 |
| `TestSchedule_InsufficientResources` | Error when resources insufficient | P0 |
| `TestSchedule_SpreadStrategy` | Spread VMs across nodes | P1 |
| `TestSchedule_PackStrategy` | Pack VMs on fewest nodes | P1 |
| `TestSchedule_AffinityRules` | Respect affinity constraints | P1 |
| `TestSchedule_AntiAffinityRules` | Respect anti-affinity | P1 |

#### DRS Engine Tests (`internal/drs/`)

| Test | Description | Priority |
|------|-------------|----------|
| `TestAnalyzeBalance_Balanced` | No recommendations when balanced | P0 |
| `TestAnalyzeBalance_CPUOverload` | Detect CPU overload | P0 |
| `TestAnalyzeBalance_MemoryOverload` | Detect memory overload | P0 |
| `TestGenerateRecommendation_Priority` | Correct priority assignment | P1 |
| `TestApplyRecommendation_Success` | Apply migration recommendation | P1 |

#### HA Manager Tests (`internal/ha/`)

| Test | Description | Priority |
|------|-------------|----------|
| `TestCheckNode_Healthy` | Healthy node detection | P0 |
| `TestCheckNode_MissedHeartbeat` | Detect missed heartbeat | P0 |
| `TestCheckNode_Failure` | Declare node failed | P0 |
| `TestFailover_RestartVMs` | Restart VMs on failure | P0 |
| `TestFailover_NoAvailableNode` | Handle no available nodes | P1 |

---

## 3. Integration Tests

### 3.1 Running Integration Tests

```bash
# Run integration tests (requires running infrastructure)
make test-integration

# Or manually
go test -v -tags=integration ./internal/repository/postgres/...
```

### 3.2 Integration Test Checklist

#### PostgreSQL Repository Tests

| Test | Description | Priority |
|------|-------------|----------|
| `TestVMRepository_Create` | Insert VM in database | P0 |
| `TestVMRepository_Get` | Retrieve VM from database | P0 |
| `TestVMRepository_List` | List with filters | P0 |
| `TestVMRepository_Update` | Update VM in database | P0 |
| `TestVMRepository_Delete` | Delete VM from database | P0 |
| `TestVMRepository_ListByNode` | List VMs on node | P1 |
| `TestNodeRepository_CRUD` | Full CRUD operations | P0 |
| `TestNodeRepository_ListSchedulable` | List schedulable nodes | P0 |

#### Redis Cache Tests

| Test | Description | Priority |
|------|-------------|----------|
| `TestCache_SetGet` | Set and get value | P0 |
| `TestCache_TTL` | Value expires after TTL | P0 |
| `TestCache_Delete` | Delete value | P0 |
| `TestCache_PubSub` | Publish and receive event | P1 |
| `TestCache_RateLimit` | Rate limiting works | P1 |

#### etcd Tests

| Test | Description | Priority |
|------|-------------|----------|
| `TestEtcd_PutGet` | Store and retrieve value | P0 |
| `TestEtcd_Watch` | Watch for changes | P1 |
| `TestEtcd_Lock` | Acquire and release lock | P0 |
| `TestEtcd_LeaderElection` | Leader election works | P1 |

---

## 4. E2E API Tests

### 4.1 Running E2E Tests

```bash
# Start the server
make run &

# Run E2E tests
make test-e2e

# Or use curl for manual testing (see below)
```

### 4.2 E2E Test Scenarios

#### Authentication Flow

```bash
# 1. Login
curl -X POST http://localhost:8080/Quantixkvm.auth.v1.AuthService/Login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}'

# Expected: { "access_token": "...", "refresh_token": "...", "expires_at": "..." }

# 2. Use token for authenticated request
curl http://localhost:8080/Quantixkvm.compute.v1.VMService/ListVMs \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{}'

# 3. Refresh token
curl -X POST http://localhost:8080/Quantixkvm.auth.v1.AuthService/RefreshToken \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "<refresh_token>"}'

# 4. Access without token (should fail)
curl http://localhost:8080/Quantixkvm.compute.v1.VMService/ListVMs \
  -H "Content-Type: application/json" \
  -d '{}'

# Expected: 401 Unauthenticated
```

#### VM Lifecycle

```bash
# 1. List VMs (initially empty or seeded)
curl http://localhost:8080/Quantixkvm.compute.v1.VMService/ListVMs \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"page_size": 10}'

# 2. Create VM
curl -X POST http://localhost:8080/Quantixkvm.compute.v1.VMService/CreateVM \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-vm-1",
    "project_id": "00000000-0000-0000-0000-000000000001",
    "spec": {
      "cpu": {"cores": 2, "sockets": 1, "threads": 1},
      "memory": {"size_mib": 4096}
    }
  }'

# 3. Get VM
curl http://localhost:8080/Quantixkvm.compute.v1.VMService/GetVM \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id": "<vm_id>"}'

# 4. Start VM
curl -X POST http://localhost:8080/Quantixkvm.compute.v1.VMService/StartVM \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id": "<vm_id>"}'

# 5. Stop VM
curl -X POST http://localhost:8080/Quantixkvm.compute.v1.VMService/StopVM \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id": "<vm_id>"}'

# 6. Delete VM
curl -X POST http://localhost:8080/Quantixkvm.compute.v1.VMService/DeleteVM \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id": "<vm_id>"}'
```

#### Node Management

```bash
# 1. List Nodes
curl http://localhost:8080/Quantixkvm.compute.v1.NodeService/ListNodes \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{}'

# 2. Register Node
curl -X POST http://localhost:8080/Quantixkvm.compute.v1.NodeService/RegisterNode \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "hostname": "node-test-1",
    "management_ip": "192.168.1.100",
    "spec": {
      "cpu": {"sockets": 2, "cores_per_socket": 8, "threads_per_core": 2},
      "memory": {"total_mib": 65536, "allocatable_mib": 60000},
      "role": {"compute": true, "storage": false}
    }
  }'

# 3. Get Node
curl http://localhost:8080/Quantixkvm.compute.v1.NodeService/GetNode \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id": "<node_id>"}'

# 4. Drain Node
curl -X POST http://localhost:8080/Quantixkvm.compute.v1.NodeService/DrainNode \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id": "<node_id>"}'
```

#### Network Management

```bash
# 1. List Networks
curl http://localhost:8080/Quantixkvm.network.v1.VirtualNetworkService/ListVirtualNetworks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{}'

# 2. Create Network
curl -X POST http://localhost:8080/Quantixkvm.network.v1.VirtualNetworkService/CreateVirtualNetwork \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-network",
    "spec": {
      "type": "OVERLAY",
      "ip_config": {
        "cidr": "10.0.0.0/24",
        "gateway": "10.0.0.1"
      }
    }
  }'

# 3. List Security Groups
curl http://localhost:8080/Quantixkvm.network.v1.SecurityGroupService/ListSecurityGroups \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 4.3 E2E Test Checklist

| Scenario | Description | Priority |
|----------|-------------|----------|
| Auth: Login with valid credentials | Returns tokens | P0 |
| Auth: Login with invalid credentials | Returns 401 | P0 |
| Auth: Access protected endpoint without token | Returns 401 | P0 |
| Auth: Access with expired token | Returns 401 | P0 |
| Auth: Refresh token | Returns new tokens | P0 |
| VM: Create VM | Returns created VM | P0 |
| VM: Create VM with invalid spec | Returns 400 | P0 |
| VM: Get VM | Returns VM details | P0 |
| VM: List VMs with pagination | Returns paginated list | P0 |
| VM: Start VM | Changes state to RUNNING | P0 |
| VM: Stop VM | Changes state to STOPPED | P0 |
| VM: Delete VM | Removes VM | P0 |
| Node: Register node | Returns registered node | P0 |
| Node: List nodes | Returns node list | P0 |
| Node: Node heartbeat | Updates last heartbeat | P1 |
| Network: Create network | Returns created network | P0 |
| Network: List networks | Returns network list | P0 |
| Security: Create security group | Returns created group | P0 |
| Security: Add rule | Adds rule to group | P1 |
| RBAC: Admin can create user | Success | P0 |
| RBAC: Viewer cannot create VM | Returns 403 | P0 |
| Health: /health returns 200 | Server healthy | P0 |
| Health: /ready returns 200 | All components ready | P0 |

---

## 5. Load Testing

### 5.1 Running Load Tests

```bash
# Install hey if not already installed
go install github.com/rakyll/hey@latest

# Basic load test - ListVMs
hey -n 1000 -c 50 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -m POST \
  -d '{"page_size": 10}' \
  http://localhost:8080/Quantixkvm.compute.v1.VMService/ListVMs

# Load test - CreateVM (careful: creates many VMs)
hey -n 100 -c 10 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -m POST \
  -d '{"name": "load-test-{{.RequestIndex}}", "project_id": "00000000-0000-0000-0000-000000000001", "spec": {"cpu": {"cores": 1}, "memory": {"size_mib": 1024}}}' \
  http://localhost:8080/Quantixkvm.compute.v1.VMService/CreateVM
```

### 5.2 Load Test Targets

| Endpoint | Target RPS | Target p99 | Notes |
|----------|------------|------------|-------|
| /health | 10,000 | < 5ms | Should be very fast |
| ListVMs | 1,000 | < 50ms | Read-heavy |
| GetVM | 2,000 | < 20ms | Single record |
| CreateVM | 100 | < 200ms | Write + scheduling |
| StartVM | 50 | < 500ms | State change |
| ListNodes | 1,000 | < 30ms | Read-heavy |

### 5.3 Load Test Checklist

| Test | Description | Target |
|------|-------------|--------|
| Sustained load (5 min) | 100 RPS for 5 minutes | No errors, p99 < 100ms |
| Spike test | 0 → 500 RPS → 0 | Recovery < 10s |
| Concurrent users | 100 concurrent connections | No connection errors |
| Database stress | 1000 inserts | All succeed |
| Cache hit rate | Repeated reads | > 80% cache hit |

---

## 6. Test File Structure

```
backend/
├── internal/
│   ├── services/
│   │   ├── vm/
│   │   │   ├── service.go
│   │   │   └── service_test.go       # Unit tests
│   │   ├── node/
│   │   │   ├── service.go
│   │   │   └── service_test.go       # Unit tests
│   │   ├── auth/
│   │   │   ├── service.go
│   │   │   ├── service_test.go       # Unit tests
│   │   │   └── jwt_test.go           # JWT tests
│   │   └── alert/
│   │       ├── service.go
│   │       └── service_test.go       # Unit tests
│   ├── scheduler/
│   │   ├── scheduler.go
│   │   └── scheduler_test.go         # Unit tests
│   ├── drs/
│   │   ├── engine.go
│   │   └── engine_test.go            # Unit tests
│   ├── ha/
│   │   ├── manager.go
│   │   └── manager_test.go           # Unit tests
│   └── repository/
│       ├── postgres/
│       │   ├── vm_repository.go
│       │   └── vm_repository_test.go # Integration tests
│       ├── redis/
│       │   ├── cache.go
│       │   └── cache_test.go         # Integration tests
│       └── etcd/
│           ├── client.go
│           └── client_test.go        # Integration tests
├── tests/
│   ├── e2e/
│   │   ├── auth_test.go              # E2E auth tests
│   │   ├── vm_test.go                # E2E VM tests
│   │   ├── node_test.go              # E2E node tests
│   │   └── network_test.go           # E2E network tests
│   ├── load/
│   │   ├── list_vms.sh               # Load test script
│   │   └── create_vms.sh             # Load test script
│   └── fixtures/
│       ├── vms.json                  # Test VM data
│       ├── nodes.json                # Test node data
│       └── users.json                # Test user data
└── Makefile                          # Test targets
```

---

## 7. Makefile Test Targets

```makefile
# Add to backend/Makefile

.PHONY: test test-unit test-integration test-e2e test-coverage test-load

# Run all tests
test: test-unit test-integration

# Unit tests only
test-unit:
	go test -v -short ./internal/...

# Integration tests (requires running infrastructure)
test-integration:
	go test -v -tags=integration ./internal/repository/...

# E2E tests (requires running server)
test-e2e:
	go test -v -tags=e2e ./tests/e2e/...

# Coverage report
test-coverage:
	go test -coverprofile=coverage.out ./internal/...
	go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: coverage.html"

# Load tests
test-load:
	@echo "Running load tests..."
	./tests/load/list_vms.sh

# Generate mocks for testing
generate-mocks:
	mockery --all --keeptree --output=mocks

# Benchmark tests
benchmark:
	go test -bench=. -benchmem ./internal/...
```

---

## 8. CI/CD Test Pipeline

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      
      - name: Run unit tests
        run: |
          cd backend
          go test -v -short -race ./internal/...

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: Quantixkvm
          POSTGRES_PASSWORD: Quantixkvm
          POSTGRES_DB: Quantixkvm_test
        ports:
          - 5432:5432
      redis:
        image: redis:7
        ports:
          - 6379:6379
      etcd:
        image: quay.io/coreos/etcd:v3.5.17
        ports:
          - 2379:2379

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      
      - name: Run migrations
        run: |
          cd backend
          make migrate-up
      
      - name: Run integration tests
        run: |
          cd backend
          go test -v -tags=integration ./internal/repository/...

  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      
      - name: Generate coverage
        run: |
          cd backend
          go test -coverprofile=coverage.out ./internal/...
          go tool cover -func=coverage.out
      
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: backend/coverage.out
```

---

## 9. Test Data Fixtures

### VMs (`tests/fixtures/vms.json`)

```json
[
  {
    "name": "test-vm-1",
    "project_id": "00000000-0000-0000-0000-000000000001",
    "spec": {
      "cpu": {"cores": 2, "sockets": 1, "threads": 1},
      "memory": {"size_mib": 4096}
    }
  },
  {
    "name": "test-vm-2",
    "project_id": "00000000-0000-0000-0000-000000000001",
    "spec": {
      "cpu": {"cores": 4, "sockets": 1, "threads": 2},
      "memory": {"size_mib": 8192}
    }
  }
]
```

### Nodes (`tests/fixtures/nodes.json`)

```json
[
  {
    "hostname": "test-node-1",
    "management_ip": "192.168.1.101",
    "spec": {
      "cpu": {"sockets": 2, "cores_per_socket": 8, "threads_per_core": 2},
      "memory": {"total_mib": 65536, "allocatable_mib": 60000},
      "role": {"compute": true, "storage": false}
    }
  },
  {
    "hostname": "test-node-2",
    "management_ip": "192.168.1.102",
    "spec": {
      "cpu": {"sockets": 2, "cores_per_socket": 16, "threads_per_core": 2},
      "memory": {"total_mib": 131072, "allocatable_mib": 120000},
      "role": {"compute": true, "storage": true}
    }
  }
]
```

---

## 10. Quick Test Commands

```bash
# ============================================
# Quick Test Reference
# ============================================

# 1. Start infrastructure
docker compose up -d

# 2. Run migrations
make migrate-up

# 3. Start server in dev mode
go run cmd/controlplane/main.go --dev &

# 4. Health check
curl http://localhost:8080/health

# 5. Run unit tests
make test-unit

# 6. Run all tests with coverage
make test-coverage

# 7. View coverage report
open coverage.html

# 8. Stop server
pkill -f controlplane

# 9. Stop infrastructure
docker compose down
```

---

## 11. Debugging Failed Tests

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Connection refused | Server not running | Start with `make run` |
| Database error | Migrations not run | Run `make migrate-up` |
| 401 Unauthorized | Missing/invalid token | Get new token via login |
| 403 Forbidden | Insufficient permissions | Use admin account |
| Timeout | Slow query or deadlock | Check logs, optimize query |
| Cache miss | Redis not running | Start Redis container |

### Debug Commands

```bash
# Check server logs
tail -f backend.log

# Check PostgreSQL
docker exec -it Quantixkvm-postgres-1 psql -U Quantixkvm -c "SELECT COUNT(*) FROM virtual_machines;"

# Check Redis
docker exec -it Quantixkvm-redis-1 redis-cli KEYS "*"

# Check etcd
docker exec -it Quantixkvm-etcd-1 etcdctl get --prefix /

# Test database connection
curl http://localhost:8080/ready
```

---

## References

- [Backend Plan](../backend-plan.md)
- [Phase 2 Implementation](./000026-backend-phase2-implementation.md)
- [Phase 3 Implementation](./000027-backend-phase3-data-persistence.md)
- [Phase 4 Implementation](./000028-backend-phase4-advanced-features.md)
