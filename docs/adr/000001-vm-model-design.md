# ADR-001: Virtual Machine Model Design

**Status:** Accepted  
**Date:** 2025-01-01  
**Authors:** limiquantix Team

## Context

limiquantix aims to be a "VMware Killer" - a modern, API-first virtualization platform that matches VMware vSphere's feature set while being simpler to operate and more performant. The VM model is the core data structure that defines what a virtual machine is and what capabilities it has.

## Decision

We have designed a comprehensive Protobuf schema (`vm_model.proto`) that follows the **Kubernetes-style Spec/Status pattern** while providing **VMware vSphere feature parity**.

### Key Design Principles

#### 1. Spec/Status Separation

```
VirtualMachine
├── spec (Desired State) - What the user wants
└── status (Runtime State) - What the system observes
```

This enables:
- **Declarative management**: Users declare intent, system reconciles
- **API idempotency**: Applying the same spec twice has no effect
- **Clear ownership**: Users own spec, system owns status

#### 2. Label-Based Organization (vs. VMware Folders)

VMware uses rigid folder hierarchies. We use **labels** (key-value pairs):

```protobuf
map<string, string> labels = 4; // e.g., "env:prod", "tier:database"
```

Benefits:
- Multiple classification dimensions simultaneously
- No restructuring when organization changes
- Native Kubernetes compatibility

#### 3. Multi-Tenancy via Projects

Every VM belongs to a `project_id`, enabling:
- Namespace isolation
- Quota enforcement
- RBAC scoping

### Feature Coverage

| Category | VMware Feature | limiquantix Equivalent |
|----------|---------------|----------------------|
| **CPU** | vCPU, Sockets, Cores | `CpuConfig` with full topology |
| **CPU Advanced** | CPU Affinity, NUMA | `NumaConfig`, `CpuFeatures` |
| **Memory** | RAM, Ballooning | `MemoryConfig` with huge pages |
| **Storage** | VMDK, vSAN | `DiskDevice` with multiple bus types |
| **Storage QoS** | SIOC | `IoLimits` with burst support |
| **Network** | vNIC, DVS | `NetworkInterface` with SR-IOV |
| **Network QoS** | Traffic Shaping | `NetworkQos` |
| **GPU** | vGPU, Passthrough | `VgpuDevice`, `PciDevice` |
| **Security** | vTPM | `TpmConfig` |
| **Boot** | BIOS/UEFI | `FirmwareType`, `BootConfig` |
| **Console** | VMRC | `DisplayConfig` (VNC/SPICE) |
| **Snapshots** | VM Snapshots | `Snapshot` with tree support |
| **Templates** | VM Templates | `TemplateConfig` with linked clones |
| **HA** | vSphere HA | `HaPolicy` |
| **DRS** | Distributed Resource Scheduler | `PlacementPolicy` |
| **vMotion** | Live Migration | `MigrationConfig` |
| **Guest Customization** | cloud-init/sysprep | `ProvisioningConfig` |

### Unique limiquantix Features

1. **Health Checks** (`HealthStatus`): Built-in health monitoring with pluggable checks
2. **Watchdog Integration** (`WatchdogConfig`): Hardware watchdog for self-healing VMs
3. **VirtIO-RNG** (`RngConfig`): Native entropy for containers and crypto workloads
4. **VSOCK Support** (`GuestAgentConfig`): Faster agent communication than virtio-serial

## Consequences

### Positive

- **Complete feature parity** with VMware vSphere for VM definitions
- **API-first design** enables Terraform, Pulumi, and CLI tooling
- **Extensible** via Protobuf's evolution rules (new fields are additive)
- **Language-agnostic** code generation for Go, Rust, TypeScript, Python

### Negative

- **Complexity**: The full schema has 40+ message types
- **Learning curve**: Users coming from simpler platforms may be overwhelmed
- **Protobuf dependency**: Requires protoc toolchain for development

### Risks

1. **Over-engineering**: Not all users need vGPU or TPM; we mitigate with sensible defaults
2. **Schema evolution**: Breaking changes require careful versioning (hence `v1` package)

## Alternatives Considered

### 1. JSON Schema Instead of Protobuf

**Rejected because:**
- No strong typing for code generation
- Larger payload sizes
- No built-in backward compatibility rules

### 2. Simplified Model (Proxmox-style)

**Rejected because:**
- Doesn't meet enterprise feature requirements
- Would limit our ability to compete with VMware

### 3. Direct libvirt XML

**Rejected because:**
- XML is verbose and error-prone
- Tightly coupled to libvirt implementation
- Poor developer experience

## Implementation Notes

### Protobuf Compilation

```bash
# Go
protoc --go_out=. --go-grpc_out=. vm_model.proto

# Rust
protoc --rust_out=. vm_model.proto

# TypeScript (Connect-ES)
buf generate
```

### Default Values

Most fields have sensible defaults:
- `firmware`: `BIOS` (for compatibility)
- `cpu.model`: `qemu64` (for migration compatibility)
- `disk.bus`: `VIRTIO_BLK` (for performance)
- `nic.model`: `VIRTIO_NET` (for performance)
- `display.type`: `VNC` (for simplicity)

### Validation Rules

Validation is NOT in the proto file. It will be implemented in the control plane:
- `cpu.cores` > 0
- `memory.size_mib` >= 128
- `disk.size_gib` > 0
- Label keys match `^[a-z][a-z0-9-]*$`

## References

- [Kubernetes API Conventions](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md)
- [VMware vSphere API Reference](https://developer.vmware.com/apis/vsphere-automation/latest/)
- [Cloud Hypervisor API](https://github.com/cloud-hypervisor/cloud-hypervisor/blob/main/docs/api.md)
- [libvirt Domain XML](https://libvirt.org/formatdomain.html)

