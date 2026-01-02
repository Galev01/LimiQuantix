# 000006: Protocol Buffers & Build System Guide

> **Document Type:** Developer Guide  
> **Audience:** New developers, contributors  
> **Last Updated:** 2025-01-01

---

## Table of Contents

1. [What is a Protocol Buffer (Proto) File?](#what-is-a-protocol-buffer-proto-file)
2. [Why We Use Protocol Buffers](#why-we-use-protocol-buffers)
3. [Proto File Structure](#proto-file-structure)
4. [What is a Makefile?](#what-is-a-makefile)
5. [What is Buf?](#what-is-buf)
6. [How Everything Orchestrates Together](#how-everything-orchestrates-together)
7. [The Code Generation Pipeline](#the-code-generation-pipeline)
8. [Practical Examples](#practical-examples)
9. [Common Commands](#common-commands)

---

## What is a Protocol Buffer (Proto) File?

**Protocol Buffers** (often called "protobuf" or "proto") is a language-neutral, platform-neutral way to define data structures and service APIs. Think of it as a **universal schema language** that can generate code for multiple programming languages.

### The Problem Proto Solves

Imagine you're building limiquantix with three components:
- **Backend** (Go) - Control plane that manages VMs
- **Frontend** (TypeScript/React) - Dashboard UI
- **Agent** (Rust) - Runs inside VMs

Without proto, you'd need to:
1. Define the `VirtualMachine` structure in Go
2. Define the same structure again in TypeScript
3. Define it again in Rust
4. Manually keep all three in sync (error-prone!)
5. Write serialization/deserialization code for each

**With proto**, you:
1. Define `VirtualMachine` once in a `.proto` file
2. Auto-generate code for Go, TypeScript, and Rust
3. All versions are guaranteed to be compatible

### A Simple Example

```protobuf
// vm.proto - The single source of truth

syntax = "proto3";                    // Use proto3 syntax
package limiquantix.compute.v1;       // Namespace to avoid conflicts

// A message is like a struct/class
message VirtualMachine {
  string id = 1;                      // Field number 1
  string name = 2;                    // Field number 2
  uint32 cpu_cores = 3;               // Field number 3
  uint64 memory_mib = 4;              // Field number 4
}
```

This generates:

**Go:**
```go
type VirtualMachine struct {
    Id        string
    Name      string
    CpuCores  uint32
    MemoryMib uint64
}
```

**TypeScript:**
```typescript
interface VirtualMachine {
    id: string;
    name: string;
    cpuCores: number;
    memoryMib: bigint;
}
```

**Rust:**
```rust
pub struct VirtualMachine {
    pub id: String,
    pub name: String,
    pub cpu_cores: u32,
    pub memory_mib: u64,
}
```

---

## Why We Use Protocol Buffers

| Benefit | Explanation |
|---------|-------------|
| **Single Source of Truth** | Define once, generate everywhere |
| **Type Safety** | Compiler catches type mismatches |
| **Backward Compatible** | Add fields without breaking old code |
| **Efficient** | Binary format is smaller than JSON |
| **gRPC Native** | Built-in support for RPC services |
| **Self-Documenting** | Proto files serve as API documentation |

### Proto vs JSON vs XML

| Feature | Proto | JSON | XML |
|---------|-------|------|-----|
| Size | Smallest | Medium | Largest |
| Parse Speed | Fastest | Medium | Slowest |
| Human Readable | No (binary) | Yes | Yes |
| Schema Required | Yes | No | Optional |
| Code Generation | Yes | Limited | Limited |

---

## Proto File Structure

### Our Project Layout

```
proto/
├── buf.yaml              # Buf configuration (linting rules)
├── buf.gen.yaml          # Code generation targets
├── buf.lock              # Dependency versions
└── limiquantix/          # Our namespace
    ├── compute/v1/       # Compute domain, version 1
    │   ├── vm.proto      # VM data model
    │   ├── vm_service.proto  # VM gRPC service
    │   ├── node.proto    # Node data model
    │   └── node_service.proto
    ├── storage/v1/       # Storage domain
    │   ├── storage.proto
    │   └── storage_service.proto
    └── network/v1/       # Network domain
        ├── network.proto
        └── network_service.proto
```

### Anatomy of a Proto File

```protobuf
// ============================================================
// 1. SYNTAX DECLARATION (required, must be first)
// ============================================================
syntax = "proto3";

// ============================================================
// 2. PACKAGE (namespace to prevent naming conflicts)
// ============================================================
package limiquantix.compute.v1;

// ============================================================
// 3. OPTIONS (language-specific settings)
// ============================================================
option go_package = "github.com/limiquantix/limiquantix/pkg/api/compute/v1;computev1";

// ============================================================
// 4. IMPORTS (other proto files we depend on)
// ============================================================
import "google/protobuf/timestamp.proto";

// ============================================================
// 5. MESSAGES (data structures)
// ============================================================
message VirtualMachine {
  string id = 1;              // Field number (never reuse!)
  string name = 2;
  VmSpec spec = 3;            // Nested message
  VmStatus status = 4;
  google.protobuf.Timestamp created_at = 5;
}

message VmSpec {
  uint32 cpu_cores = 1;
  uint64 memory_mib = 2;
  repeated string disk_ids = 3;  // repeated = array/list
}

// ============================================================
// 6. ENUMS (fixed set of values)
// ============================================================
enum PowerState {
  POWER_STATE_UNSPECIFIED = 0;  // Always have 0 as default
  POWER_STATE_RUNNING = 1;
  POWER_STATE_STOPPED = 2;
}

// ============================================================
// 7. SERVICES (gRPC API definitions)
// ============================================================
service VMService {
  rpc CreateVM(CreateVMRequest) returns (VirtualMachine);
  rpc GetVM(GetVMRequest) returns (VirtualMachine);
  rpc ListVMs(ListVMsRequest) returns (ListVMsResponse);
  rpc WatchVM(WatchVMRequest) returns (stream VirtualMachine);  // streaming
}
```

### Field Numbers Are Critical

```protobuf
message Example {
  string name = 1;    // Field 1
  int32 age = 2;      // Field 2
  // string email = 3;  // DELETED - but number 3 is now "burned"
  string phone = 4;   // Field 4 (we skip 3 forever)
}
```

**Rules:**
- Field numbers 1-15 use 1 byte (use for common fields)
- Field numbers 16-2047 use 2 bytes
- Never reuse a deleted field number
- Numbers 19000-19999 are reserved by protobuf

---

## What is a Makefile?

A **Makefile** is a build automation file that defines how to compile, test, and run your project. It uses the `make` command-line tool (pre-installed on macOS/Linux).

### Why Use a Makefile?

Instead of remembering long commands:

```bash
# Without Makefile - you have to remember all this:
cd proto && buf lint && buf generate && cd ..
```

You just run:

```bash
# With Makefile - simple!
make proto
```

### Our Makefile Structure

```makefile
# ==============================================================
# VARIABLES (reusable values)
# ==============================================================
PROTO_DIR := proto
BACKEND_DIR := backend
FRONTEND_DIR := frontend

# ==============================================================
# PHONY TARGETS (not actual files)
# ==============================================================
.PHONY: proto proto-lint setup help

# ==============================================================
# TARGETS (commands you can run)
# ==============================================================

# make proto - generates code from proto files
proto: proto-lint
	@echo "🔨 Generating code..."
	@cd $(PROTO_DIR) && buf generate
	@echo "✅ Done!"

# make proto-lint - checks proto files for errors
proto-lint:
	@echo "🔍 Linting..."
	@cd $(PROTO_DIR) && buf lint

# make setup - installs dependencies
setup:
	@echo "📦 Installing dependencies..."
	brew install bufbuild/buf/buf
	go install google.golang.org/protobuf/cmd/protoc-gen-go@latest

# make help - shows available commands
help:
	@echo "Available commands:"
	@echo "  make proto      - Generate code"
	@echo "  make proto-lint - Lint proto files"
	@echo "  make setup      - Install dependencies"
```

### How Make Works

```
┌─────────────────────────────────────────────────────────────┐
│  You run: make proto                                        │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Make reads Makefile, finds "proto" target                  │
│  Sees it depends on "proto-lint" (runs that first)          │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Runs proto-lint commands:                                  │
│    cd proto && buf lint                                     │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  If lint passes, runs proto commands:                       │
│    cd proto && buf generate                                 │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Generated files appear in:                                 │
│    backend/pkg/api/.../*.go                                 │
│    frontend/src/api/.../*.ts                                │
└─────────────────────────────────────────────────────────────┘
```

---

## What is Buf?

**Buf** is a modern tool for working with Protocol Buffers. It replaces the older `protoc` compiler with a better developer experience.

### Buf vs protoc

| Feature | Buf | protoc |
|---------|-----|--------|
| Config File | `buf.yaml` (simple YAML) | Command-line flags (complex) |
| Linting | Built-in | Requires plugins |
| Breaking Change Detection | Built-in | Manual |
| Dependency Management | `buf.lock` (like npm) | Manual downloads |
| Remote Plugins | Yes (no local install) | Requires local plugins |

### Our Buf Configuration

**`buf.yaml`** - Defines linting rules:

```yaml
version: v2

modules:
  - path: .
    name: buf.build/limiquantix/api

lint:
  use:
    - STANDARD        # Standard protobuf rules
    - COMMENTS        # Require documentation comments
  
breaking:
  use:
    - FILE            # Detect breaking changes

deps:
  - buf.build/googleapis/googleapis  # Google's common types
```

**`buf.gen.yaml`** - Defines code generation:

```yaml
version: v2

plugins:
  # Generate Go code
  - remote: buf.build/protocolbuffers/go
    out: ../backend/pkg/api
    opt:
      - paths=source_relative
  
  # Generate Go gRPC services
  - remote: buf.build/grpc/go
    out: ../backend/pkg/api
    opt:
      - paths=source_relative
  
  # Generate TypeScript
  - remote: buf.build/bufbuild/es
    out: ../frontend/src/api
    opt:
      - target=ts
```

---

## How Everything Orchestrates Together

### The Big Picture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DEVELOPER                                       │
│                                  │                                           │
│                          runs: make proto                                    │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MAKEFILE                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  proto: proto-lint                                                   │    │
│  │      cd proto && buf generate                                        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                   │                                          │
│                           calls: buf generate                                │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                 BUF                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  1. Reads buf.yaml (what to lint)                                   │    │
│  │  2. Reads buf.gen.yaml (what to generate)                           │    │
│  │  3. Parses all .proto files                                         │    │
│  │  4. Calls each plugin (protoc-gen-go, protoc-gen-es, etc.)          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                   │                                          │
│              generates code for each target language                         │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐         ┌───────────────┐         ┌───────────────┐
│     GO        │         │  TYPESCRIPT   │         │     RUST      │
│   backend/    │         │   frontend/   │         │    agent/     │
│   pkg/api/    │         │   src/api/    │         │   src/proto/  │
│               │         │               │         │               │
│ *.pb.go       │         │ *.ts          │         │ *.rs          │
│ *_grpc.pb.go  │         │ *_connect.ts  │         │               │
└───────────────┘         └───────────────┘         └───────────────┘
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ALL COMPONENTS IN SYNC                               │
│                                                                              │
│   The Go backend, TypeScript frontend, and Rust agent all share             │
│   the exact same data structures and can communicate seamlessly.            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Step-by-Step Flow

```
┌────┐  ┌────────────┐  ┌─────────┐  ┌────────────┐  ┌────────────────┐
│ 1  │  │ Developer  │  │ Edits   │  │ vm.proto   │  │ Adds new field │
│    │──│ needs new  │──│ proto   │──│ storage.   │──│ "gpu_count"    │
│    │  │ feature    │  │ file    │  │ proto      │  │                │
└────┘  └────────────┘  └─────────┘  └────────────┘  └────────────────┘
                                                              │
                                                              ▼
┌────┐  ┌────────────┐  ┌─────────┐  ┌────────────┐  ┌────────────────┐
│ 2  │  │ Developer  │  │ Runs    │  │ make       │  │ Triggers Buf   │
│    │──│ generates  │──│         │──│ proto      │──│ and plugins    │
│    │  │ code       │  │         │  │            │  │                │
└────┘  └────────────┘  └─────────┘  └────────────┘  └────────────────┘
                                                              │
                                                              ▼
┌────┐  ┌────────────┐  ┌─────────┐  ┌────────────┐  ┌────────────────┐
│ 3  │  │ Go code    │  │ TS code │  │ Rust code  │  │ All updated    │
│    │──│ generated  │──│ generat │──│ generated  │──│ automatically  │
│    │  │ in backend │  │ ed      │  │ in agent   │  │                │
└────┘  └────────────┘  └─────────┘  └────────────┘  └────────────────┘
                                                              │
                                                              ▼
┌────┐  ┌────────────┐  ┌─────────┐  ┌────────────┐  ┌────────────────┐
│ 4  │  │ Developer  │  │ Uses    │  │ New field  │  │ Type-safe in   │
│    │──│ uses new   │──│ genera  │──│ "GpuCount" │──│ all languages  │
│    │  │ field      │  │ ted     │  │ available  │  │                │
└────┘  └────────────┘  └─────────┘  └────────────┘  └────────────────┘
```

---

## The Code Generation Pipeline

### What Gets Generated

From a single proto file, multiple files are generated:

```
vm.proto (input)
    │
    ├──▶ Go
    │       vm.pb.go           # Message types (structs)
    │       vm_grpc.pb.go      # gRPC client/server interfaces
    │
    ├──▶ TypeScript  
    │       vm_pb.ts           # Message types (interfaces)
    │       vm_connect.ts      # Connect-ES client
    │
    └──▶ Rust (optional)
            vm.rs              # Message types (structs)
            vm_tonic.rs        # Tonic gRPC client/server
```

### Example: What's Inside Generated Files

**Input (`vm.proto`):**
```protobuf
message VirtualMachine {
  string id = 1;
  string name = 2;
}

service VMService {
  rpc GetVM(GetVMRequest) returns (VirtualMachine);
}
```

**Output (`vm.pb.go`):**
```go
// Generated by protoc-gen-go. DO NOT EDIT.

type VirtualMachine struct {
    Id   string `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
    Name string `protobuf:"bytes,2,opt,name=name,proto3" json:"name,omitempty"`
}

func (x *VirtualMachine) GetId() string {
    if x != nil { return x.Id }
    return ""
}

func (x *VirtualMachine) GetName() string {
    if x != nil { return x.Name }
    return ""
}
```

**Output (`vm_grpc.pb.go`):**
```go
// VMServiceClient is the client API for VMService service.
type VMServiceClient interface {
    GetVM(ctx context.Context, in *GetVMRequest, opts ...grpc.CallOption) (*VirtualMachine, error)
}

// VMServiceServer is the server API for VMService service.
type VMServiceServer interface {
    GetVM(context.Context, *GetVMRequest) (*VirtualMachine, error)
}
```

**Output (`vm_pb.ts`):**
```typescript
export interface VirtualMachine {
  id: string;
  name: string;
}

export const VirtualMachineSchema: GenMessage<VirtualMachine> = ...
```

---

## Practical Examples

### Adding a New Field

1. **Edit the proto file:**
```protobuf
message VirtualMachine {
  string id = 1;
  string name = 2;
  uint32 gpu_count = 3;  // NEW FIELD
}
```

2. **Regenerate code:**
```bash
make proto
```

3. **Use in Go:**
```go
vm := &computev1.VirtualMachine{
    Id:       "vm-123",
    Name:     "my-vm",
    GpuCount: 2,  // Now available!
}
```

4. **Use in TypeScript:**
```typescript
const vm: VirtualMachine = {
    id: "vm-123",
    name: "my-vm",
    gpuCount: 2,  // Now available!
};
```

### Adding a New Service Method

1. **Edit the service proto:**
```protobuf
service VMService {
  rpc CreateVM(CreateVMRequest) returns (VirtualMachine);
  rpc GetVM(GetVMRequest) returns (VirtualMachine);
  rpc DeleteVM(DeleteVMRequest) returns (google.protobuf.Empty);  // NEW
}
```

2. **Regenerate and implement:**
```go
// backend/internal/service/vm_service.go

func (s *vmServer) DeleteVM(ctx context.Context, req *computev1.DeleteVMRequest) (*emptypb.Empty, error) {
    // Your implementation here
    return &emptypb.Empty{}, nil
}
```

---

## Common Commands

| Command | What It Does |
|---------|--------------|
| `make proto` | Lint and generate all code |
| `make proto-lint` | Check protos for errors |
| `make proto-format` | Auto-format proto files |
| `make proto-breaking` | Check for breaking changes vs main branch |
| `make proto-clean` | Delete all generated files |
| `make setup` | Install all dependencies |
| `make help` | Show all available commands |

### Troubleshooting

**"buf: command not found"**
```bash
make setup-buf
# or
brew install bufbuild/buf/buf
```

**"proto lint failed"**
```bash
# See what's wrong
cd proto && buf lint

# Common issues:
# - Missing comments on public types
# - Field numbers reused
# - Import not found
```

**"generated code is outdated"**
```bash
make proto-clean
make proto
```

---

## Summary

| Component | Purpose |
|-----------|---------|
| **Proto files** (`.proto`) | Define data structures and APIs once |
| **Buf** | Modern tool to lint, validate, and generate code |
| **Makefile** | Automation layer - simple commands like `make proto` |
| **Generated code** | Auto-created Go, TypeScript, Rust files |

The flow is:

```
Proto Files → Buf (reads config) → Plugins → Generated Code → Your Application
```

This ensures:
- ✅ Single source of truth for all APIs
- ✅ Type safety across all languages
- ✅ Automatic backward compatibility checks
- ✅ Easy-to-use developer experience

---

## References

- [Protocol Buffers Official Guide](https://protobuf.dev/programming-guides/proto3/)
- [Buf Documentation](https://buf.build/docs/)
- [gRPC Documentation](https://grpc.io/docs/)
- [Make Manual](https://www.gnu.org/software/make/manual/)

