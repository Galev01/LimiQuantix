# ADR-005: gRPC Services Design

**Status:** Accepted  
**Date:** 2025-01-01  
**Authors:** Quantixkvm Team

## Context

Quantixkvm requires a robust API layer for:
- UI dashboard communication
- CLI tool integration
- Terraform provider support
- Inter-service communication (control plane ↔ agents)

## Decision

We have chosen **gRPC** as the primary API protocol with the following service structure:

### Compute Services
- `VMService` - Virtual machine lifecycle management
- `NodeService` - Physical host management

### Storage Services
- `StoragePoolService` - Storage pool management
- `VolumeService` - Virtual disk management
- `SnapshotService` - Snapshot operations
- `ImageService` - OS image management

### Network Services
- `VirtualNetworkService` - SDN network management
- `PortService` - Network port management
- `SecurityGroupService` - Firewall rules
- `FloatingIpService` - Public IP management
- `LoadBalancerService` - Load balancer management
- `VpnServiceManager` - VPN configuration

### Key Design Principles

#### 1. CRUD + Operations Pattern

Each service follows a consistent pattern:

```protobuf
service VMService {
  // CRUD
  rpc CreateVM(CreateVMRequest) returns (VirtualMachine);
  rpc GetVM(GetVMRequest) returns (VirtualMachine);
  rpc ListVMs(ListVMsRequest) returns (ListVMsResponse);
  rpc UpdateVM(UpdateVMRequest) returns (VirtualMachine);
  rpc DeleteVM(DeleteVMRequest) returns (google.protobuf.Empty);
  
  // Operations
  rpc StartVM(StartVMRequest) returns (VirtualMachine);
  rpc StopVM(StopVMRequest) returns (VirtualMachine);
  rpc MigrateVM(MigrateVMRequest) returns (MigrateVMResponse);
  
  // Streaming
  rpc WatchVM(WatchVMRequest) returns (stream VirtualMachine);
}
```

#### 2. Pagination for Lists

All list operations support cursor-based pagination:

```protobuf
message ListVMsRequest {
  int32 page_size = 10;
  string page_token = 11;
  string order_by = 12;  // "name", "created_at desc"
}

message ListVMsResponse {
  repeated VirtualMachine vms = 1;
  string next_page_token = 2;
  int32 total_count = 3;
}
```

#### 3. Field Masks for Updates

Partial updates using field masks:

```protobuf
message UpdateVMRequest {
  string id = 1;
  VmSpec spec = 2;
  google.protobuf.FieldMask update_mask = 3;
}
```

This allows updating only specific fields without sending the entire object.

#### 4. Streaming for Real-Time Updates

Server-side streaming for live updates:

```protobuf
// Watch a single VM for changes
rpc WatchVM(WatchVMRequest) returns (stream VirtualMachine);

// Watch all nodes in the cluster
rpc WatchNodes(WatchNodesRequest) returns (stream NodeUpdate);

// Stream real-time metrics
rpc StreamMetrics(StreamMetricsRequest) returns (stream ResourceUsage);
```

#### 5. Empty Responses for Deletes

Delete operations return `google.protobuf.Empty`:

```protobuf
rpc DeleteVM(DeleteVMRequest) returns (google.protobuf.Empty);
```

### API Gateway Pattern

Frontend uses Connect-ES (gRPC-Web compatible):

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Dashboard  │────▶│  Envoy/API   │────▶│  Control Plane  │
│  (React)    │     │   Gateway    │     │  (Go gRPC)      │
└─────────────┘     └──────────────┘     └─────────────────┘
     │                    │                      │
     │  Connect-ES        │  gRPC                │  gRPC
     │  (HTTP/2)          │  (HTTP/2)            │  (Internal)
     │                    │                      │
     └────────────────────┴──────────────────────┘
```

### Error Handling

Using standard gRPC status codes:

| Situation | Status Code |
|-----------|-------------|
| Resource not found | `NOT_FOUND` |
| Invalid input | `INVALID_ARGUMENT` |
| Already exists | `ALREADY_EXISTS` |
| Permission denied | `PERMISSION_DENIED` |
| Rate limited | `RESOURCE_EXHAUSTED` |
| Internal error | `INTERNAL` |
| Unavailable | `UNAVAILABLE` |

Error details using `google.rpc.ErrorInfo`:

```go
// Example error with details
return nil, status.Errorf(codes.InvalidArgument,
    "invalid VM spec: memory must be at least 128 MiB")
```

## Consequences

### Positive

- **Type safety**: Protobuf provides strong typing
- **Performance**: Binary protocol, efficient serialization
- **Streaming**: Native support for real-time updates
- **Code generation**: Clients auto-generated for Go, TS, Rust
- **Backward compatible**: Protobuf evolution rules

### Negative

- **Browser complexity**: Requires Connect-ES or Envoy for web
- **Debugging**: Binary format harder to debug than JSON
- **Learning curve**: gRPC concepts (streaming, metadata)

### Trade-offs

We chose gRPC over REST because:
1. **Streaming**: Essential for real-time dashboard updates
2. **Performance**: Better for high-volume agent communication
3. **Type safety**: Reduces integration errors

We expose a REST gateway via Envoy for:
1. **Terraform**: Uses REST/JSON
2. **Simple integrations**: curl-friendly

## Implementation Notes

### Go Server Implementation

```go
type vmServer struct {
    computev1.UnimplementedVMServiceServer
    db      *database.DB
    engine  *vm.Engine
    logger  *zap.Logger
}

func (s *vmServer) CreateVM(ctx context.Context, req *computev1.CreateVMRequest) (*computev1.VirtualMachine, error) {
    logger := s.logger.With(
        zap.String("project_id", req.ProjectId),
        zap.String("vm_name", req.Name),
    )
    
    logger.Info("Creating VM")
    
    vm, err := s.engine.Create(ctx, req)
    if err != nil {
        logger.Error("Failed to create VM", zap.Error(err))
        return nil, status.Errorf(codes.Internal, "failed to create VM: %v", err)
    }
    
    logger.Info("VM created", zap.String("vm_id", vm.Id))
    return vm, nil
}
```

### TypeScript Client Usage

```typescript
import { createClient } from "@connectrpc/connect";
import { VMService } from "./api/Quantixkvm/compute/v1/vm_service_connect";

const client = createClient(VMService, transport);

// Create a VM
const vm = await client.createVM({
  name: "my-vm",
  projectId: "default",
  spec: {
    cpu: { cores: 4 },
    memory: { sizeMib: 8192n },
  },
});

// Watch for updates
for await (const update of client.watchVM({ vmId: vm.id })) {
  console.log("VM updated:", update.status?.state);
}
```

## References

- [gRPC Best Practices](https://grpc.io/docs/guides/)
- [Connect-ES Documentation](https://connectrpc.com/docs/web/)
- [Google API Design Guide](https://cloud.google.com/apis/design)

