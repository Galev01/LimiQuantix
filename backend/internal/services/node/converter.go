// Package node provides the node service for the control plane.
package node

import (
	"github.com/limiquantix/limiquantix/internal/domain"
	computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ============================================================================
// Proto to Domain Converters
// ============================================================================

// convertSpecFromProto converts a proto NodeSpec to a domain NodeSpec.
func convertSpecFromProto(spec *computev1.NodeSpec) domain.NodeSpec {
	if spec == nil {
		return domain.NodeSpec{}
	}

	result := domain.NodeSpec{}

	// CPU info
	if spec.Cpu != nil {
		result.CPU = domain.NodeCPUInfo{
			Model:          spec.Cpu.Model,
			Sockets:        int32(spec.Cpu.Sockets),
			CoresPerSocket: int32(spec.Cpu.CoresPerSocket),
			ThreadsPerCore: int32(spec.Cpu.ThreadsPerCore),
			FrequencyMHz:   int32(spec.Cpu.FrequencyMhz),
			Features:       spec.Cpu.Features,
		}
	}

	// Memory info - convert bytes to MiB
	if spec.Memory != nil {
		result.Memory = domain.NodeMemoryInfo{
			TotalMiB:       int64(spec.Memory.TotalBytes / (1024 * 1024)),
			AllocatableMiB: int64(spec.Memory.AllocatableBytes / (1024 * 1024)),
		}
	}

	// Storage devices
	for _, device := range spec.Storage {
		if device == nil {
			continue
		}
		result.Storage = append(result.Storage, domain.StorageDevice{
			Name:    device.Path, // Use path as name
			Type:    device.Type.String(),
			SizeGiB: int64(device.SizeBytes / (1024 * 1024 * 1024)),
			Path:    device.Path,
			Model:   device.Model,
			Serial:  device.Serial,
		})
	}

	// Network adapters
	for _, nic := range spec.Network {
		if nic == nil {
			continue
		}
		result.Networks = append(result.Networks, domain.NetworkAdapter{
			Name:         nic.Name,
			MACAddress:   nic.MacAddress,
			SpeedMbps:    int64(nic.SpeedMbps),
			MTU:          int32(nic.Mtu),
			Driver:       nic.Driver,
			SRIOVCapable: nic.SriovCapable,
		})
	}

	// Role
	if spec.Role != nil {
		result.Role = domain.NodeRole{
			Compute:      spec.Role.Compute,
			Storage:      spec.Role.Storage,
			ControlPlane: spec.Role.ControlPlane,
		}
	}

	return result
}

// ============================================================================
// Domain to Proto Converters
// ============================================================================

// ToProto converts a domain Node to a proto Node.
func ToProto(node *domain.Node) *computev1.Node {
	if node == nil {
		return nil
	}

	result := &computev1.Node{
		Id:           node.ID,
		Hostname:     node.Hostname,
		ManagementIp: node.ManagementIP,
		Labels:       node.Labels,
	}

	// Timestamps
	if !node.CreatedAt.IsZero() {
		result.CreatedAt = timestamppb.New(node.CreatedAt)
	}
	if !node.UpdatedAt.IsZero() {
		result.UpdatedAt = timestamppb.New(node.UpdatedAt)
	}

	// Spec
	result.Spec = convertSpecToProto(node.Spec)

	// Status
	result.Status = convertStatusToProto(node.Status)

	return result
}

// convertSpecToProto converts a domain NodeSpec to a proto NodeSpec.
func convertSpecToProto(spec domain.NodeSpec) *computev1.NodeSpec {
	result := &computev1.NodeSpec{}

	// CPU info
	result.Cpu = &computev1.CpuInfo{
		Model:          spec.CPU.Model,
		Sockets:        uint32(spec.CPU.Sockets),
		CoresPerSocket: uint32(spec.CPU.CoresPerSocket),
		ThreadsPerCore: uint32(spec.CPU.ThreadsPerCore),
		FrequencyMhz:   uint64(spec.CPU.FrequencyMHz),
		Features:       spec.CPU.Features,
	}

	// Memory info - convert MiB to bytes
	result.Memory = &computev1.MemoryInfo{
		TotalBytes:       uint64(spec.Memory.TotalMiB) * 1024 * 1024,
		AllocatableBytes: uint64(spec.Memory.AllocatableMiB) * 1024 * 1024,
	}

	// Storage devices - convert GiB to bytes
	for _, device := range spec.Storage {
		result.Storage = append(result.Storage, &computev1.StorageDevice{
			Path:      device.Path,
			Model:     device.Model,
			Serial:    device.Serial,
			SizeBytes: uint64(device.SizeGiB) * 1024 * 1024 * 1024,
			Type:      parseStorageType(device.Type),
		})
	}

	// Network adapters
	for _, nic := range spec.Networks {
		result.Network = append(result.Network, &computev1.NetworkDevice{
			Name:         nic.Name,
			MacAddress:   nic.MACAddress,
			SpeedMbps:    uint64(nic.SpeedMbps),
			Mtu:          uint32(nic.MTU),
			Driver:       nic.Driver,
			SriovCapable: nic.SRIOVCapable,
		})
	}

	// Role
	result.Role = &computev1.NodeRole{
		Compute:      spec.Role.Compute,
		Storage:      spec.Role.Storage,
		ControlPlane: spec.Role.ControlPlane,
	}

	return result
}

// convertStatusToProto converts a domain NodeStatus to a proto NodeStatus.
func convertStatusToProto(status domain.NodeStatus) *computev1.NodeStatus {
	result := &computev1.NodeStatus{
		Phase: convertPhaseToProto(status.Phase),
		VmIds: status.VMIDs,
	}

	// Conditions
	for _, cond := range status.Conditions {
		result.Conditions = append(result.Conditions, &computev1.NodeCondition{
			Type:           cond.Type,
			Status:         parseConditionStatus(cond.Status),
			Reason:         cond.Reason,
			Message:        cond.Message,
			LastTransition: timestamppb.New(cond.LastUpdate),
		})
	}

	// Resource allocation
	result.Resources = &computev1.ResourceAllocation{
		Cpu: &computev1.CpuAllocation{
			AllocatableVcpus: uint32(status.Allocatable.CPUCores),
			AllocatedVcpus:   uint32(status.Allocated.CPUCores),
		},
		Memory: &computev1.MemoryAllocation{
			AllocatableBytes: uint64(status.Allocatable.MemoryMiB) * 1024 * 1024,
			AllocatedBytes:   uint64(status.Allocated.MemoryMiB) * 1024 * 1024,
		},
	}

	// System info
	if status.SystemInfo != nil {
		result.System = &computev1.SystemInfo{
			OsName:            status.SystemInfo.OS,
			KernelVersion:     status.SystemInfo.Kernel,
			HypervisorVersion: status.SystemInfo.HypervisorVersion,
			AgentVersion:      status.SystemInfo.AgentVersion,
		}
	}

	return result
}

// parseConditionStatus converts a string status to a proto NodeCondition_Status.
func parseConditionStatus(status string) computev1.NodeCondition_Status {
	switch status {
	case "True":
		return computev1.NodeCondition_TRUE
	case "False":
		return computev1.NodeCondition_FALSE
	default:
		return computev1.NodeCondition_UNKNOWN
	}
}

// convertPhaseToProto converts a domain NodePhase to a proto NodeStatus_Phase.
func convertPhaseToProto(phase domain.NodePhase) computev1.NodeStatus_Phase {
	switch phase {
	case domain.NodePhasePending:
		return computev1.NodeStatus_PENDING
	case domain.NodePhaseReady:
		return computev1.NodeStatus_READY
	case domain.NodePhaseNotReady:
		return computev1.NodeStatus_NOT_READY
	case domain.NodePhaseMaintenance:
		return computev1.NodeStatus_MAINTENANCE
	case domain.NodePhaseDraining:
		return computev1.NodeStatus_DRAINING
	case domain.NodePhaseError:
		return computev1.NodeStatus_OFFLINE
	default:
		return computev1.NodeStatus_UNKNOWN
	}
}

// convertPhaseFromProto converts a proto NodeStatus_Phase to a domain NodePhase.
func convertPhaseFromProto(phase computev1.NodeStatus_Phase) domain.NodePhase {
	switch phase {
	case computev1.NodeStatus_PENDING:
		return domain.NodePhasePending
	case computev1.NodeStatus_READY:
		return domain.NodePhaseReady
	case computev1.NodeStatus_NOT_READY:
		return domain.NodePhaseNotReady
	case computev1.NodeStatus_MAINTENANCE:
		return domain.NodePhaseMaintenance
	case computev1.NodeStatus_DRAINING:
		return domain.NodePhaseDraining
	case computev1.NodeStatus_OFFLINE:
		return domain.NodePhaseError
	default:
		return domain.NodePhaseUnknown
	}
}

// Helper function for parsing storage types
func parseStorageType(t string) computev1.StorageDevice_DeviceType {
	switch t {
	case "SSD", "ssd":
		return computev1.StorageDevice_SSD
	case "NVMe", "NVME", "nvme":
		return computev1.StorageDevice_NVME
	case "HDD", "hdd":
		return computev1.StorageDevice_HDD
	default:
		return computev1.StorageDevice_HDD
	}
}
