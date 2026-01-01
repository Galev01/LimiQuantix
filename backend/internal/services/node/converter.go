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
			Sockets:        spec.Cpu.Sockets,
			CoresPerSocket: spec.Cpu.CoresPerSocket,
			ThreadsPerCore: spec.Cpu.ThreadsPerCore,
			FrequencyMHz:   spec.Cpu.FrequencyMhz,
			Features:       spec.Cpu.Features,
		}
	}

	// Memory info
	if spec.Memory != nil {
		result.Memory = domain.NodeMemoryInfo{
			TotalMiB:       int64(spec.Memory.TotalMib),
			AllocatableMiB: int64(spec.Memory.AllocatableMib),
		}
	}

	// Storage devices
	for _, device := range spec.Storage {
		if device == nil {
			continue
		}
		result.Storage = append(result.Storage, domain.StorageDevice{
			Name:    device.Name,
			Type:    device.Type.String(),
			SizeGiB: int64(device.SizeGib),
			Path:    device.Path,
			Model:   device.Model,
			Serial:  device.Serial,
		})
	}

	// Network adapters
	for _, nic := range spec.Networks {
		if nic == nil {
			continue
		}
		result.Networks = append(result.Networks, domain.NetworkAdapter{
			Name:         nic.Name,
			MACAddress:   nic.MacAddress,
			SpeedMbps:    int64(nic.SpeedMbps),
			MTU:          nic.Mtu,
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
		ClusterId:    node.ClusterID,
	}

	// Timestamps
	if !node.CreatedAt.IsZero() {
		result.CreatedAt = timestamppb.New(node.CreatedAt)
	}
	if !node.UpdatedAt.IsZero() {
		result.UpdatedAt = timestamppb.New(node.UpdatedAt)
	}
	if node.LastHeartbeat != nil && !node.LastHeartbeat.IsZero() {
		result.LastHeartbeat = timestamppb.New(*node.LastHeartbeat)
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
		Sockets:        spec.CPU.Sockets,
		CoresPerSocket: spec.CPU.CoresPerSocket,
		ThreadsPerCore: spec.CPU.ThreadsPerCore,
		FrequencyMhz:   spec.CPU.FrequencyMHz,
		Features:       spec.CPU.Features,
	}

	// Memory info
	result.Memory = &computev1.MemoryInfo{
		TotalMib:       uint64(spec.Memory.TotalMiB),
		AllocatableMib: uint64(spec.Memory.AllocatableMiB),
	}

	// Storage devices
	for _, device := range spec.Storage {
		result.Storage = append(result.Storage, &computev1.StorageDevice{
			Name:    device.Name,
			Type:    parseStorageType(device.Type),
			SizeGib: uint64(device.SizeGiB),
			Path:    device.Path,
			Model:   device.Model,
			Serial:  device.Serial,
		})
	}

	// Network adapters
	for _, nic := range spec.Networks {
		result.Networks = append(result.Networks, &computev1.NetworkDevice{
			Name:         nic.Name,
			MacAddress:   nic.MACAddress,
			SpeedMbps:    uint32(nic.SpeedMbps),
			Mtu:          nic.MTU,
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
		Phase:  convertPhaseToProto(status.Phase),
		VmIds:  status.VMIDs,
	}

	// Conditions
	for _, cond := range status.Conditions {
		result.Conditions = append(result.Conditions, &computev1.NodeCondition{
			Type:       cond.Type,
			Status:     cond.Status,
			Reason:     cond.Reason,
			Message:    cond.Message,
			LastUpdate: timestamppb.New(cond.LastUpdate),
		})
	}

	// Allocatable resources
	result.Allocatable = &computev1.NodeResources{
		CpuCores:   status.Allocatable.CPUCores,
		MemoryMib:  uint64(status.Allocatable.MemoryMiB),
		StorageGib: uint64(status.Allocatable.StorageGiB),
		GpuCount:   status.Allocatable.GPUCount,
	}

	// Allocated resources
	result.Allocated = &computev1.NodeResources{
		CpuCores:   status.Allocated.CPUCores,
		MemoryMib:  uint64(status.Allocated.MemoryMiB),
		StorageGib: uint64(status.Allocated.StorageGiB),
		GpuCount:   status.Allocated.GPUCount,
	}

	// System info
	if status.SystemInfo != nil {
		result.SystemInfo = &computev1.SystemInfo{
			Os:                status.SystemInfo.OS,
			Kernel:            status.SystemInfo.Kernel,
			Architecture:      status.SystemInfo.Architecture,
			HypervisorVersion: status.SystemInfo.HypervisorVersion,
			AgentVersion:      status.SystemInfo.AgentVersion,
		}
	}

	return result
}

// convertPhaseToProto converts a domain NodePhase to a proto NodePhase.
func convertPhaseToProto(phase domain.NodePhase) computev1.NodePhase {
	switch phase {
	case domain.NodePhasePending:
		return computev1.NodePhase_NODE_PHASE_PENDING
	case domain.NodePhaseReady:
		return computev1.NodePhase_NODE_PHASE_READY
	case domain.NodePhaseNotReady:
		return computev1.NodePhase_NODE_PHASE_NOT_READY
	case domain.NodePhaseMaintenance:
		return computev1.NodePhase_NODE_PHASE_MAINTENANCE
	case domain.NodePhaseDraining:
		return computev1.NodePhase_NODE_PHASE_DRAINING
	case domain.NodePhaseError:
		return computev1.NodePhase_NODE_PHASE_ERROR
	default:
		return computev1.NodePhase_NODE_PHASE_UNSPECIFIED
	}
}

// convertPhaseFromProto converts a proto NodePhase to a domain NodePhase.
func convertPhaseFromProto(phase computev1.NodePhase) domain.NodePhase {
	switch phase {
	case computev1.NodePhase_NODE_PHASE_PENDING:
		return domain.NodePhasePending
	case computev1.NodePhase_NODE_PHASE_READY:
		return domain.NodePhaseReady
	case computev1.NodePhase_NODE_PHASE_NOT_READY:
		return domain.NodePhaseNotReady
	case computev1.NodePhase_NODE_PHASE_MAINTENANCE:
		return domain.NodePhaseMaintenance
	case computev1.NodePhase_NODE_PHASE_DRAINING:
		return domain.NodePhaseDraining
	case computev1.NodePhase_NODE_PHASE_ERROR:
		return domain.NodePhaseError
	default:
		return domain.NodePhaseUnknown
	}
}

// Helper function for parsing storage types
func parseStorageType(t string) computev1.StorageDeviceType {
	switch t {
	case "SSD", "ssd":
		return computev1.StorageDeviceType_STORAGE_DEVICE_TYPE_SSD
	case "NVMe", "NVME", "nvme":
		return computev1.StorageDeviceType_STORAGE_DEVICE_TYPE_NVME
	case "HDD", "hdd":
		return computev1.StorageDeviceType_STORAGE_DEVICE_TYPE_HDD
	default:
		return computev1.StorageDeviceType_STORAGE_DEVICE_TYPE_UNSPECIFIED
	}
}
