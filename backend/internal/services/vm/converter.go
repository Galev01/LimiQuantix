// Package vm provides the virtual machine service for the control plane.
package vm

import (
	"github.com/limiquantix/limiquantix/internal/domain"
	computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ============================================================================
// Proto to Domain Converters
// ============================================================================

// convertSpecFromProto converts a proto VmSpec to a domain VMSpec.
func convertSpecFromProto(spec *computev1.VmSpec) domain.VMSpec {
	if spec == nil {
		return domain.VMSpec{}
	}

	result := domain.VMSpec{}

	// CPU config
	if spec.Cpu != nil {
		result.CPU = domain.CPUConfig{
			Cores:   spec.Cpu.Cores,
			Sockets: spec.Cpu.Sockets,
			Threads: spec.Cpu.Threads,
			Model:   spec.Cpu.Model,
		}
	}

	// Memory config
	if spec.Memory != nil {
		result.Memory = domain.MemoryConfig{
			SizeMiB:          int64(spec.Memory.SizeMib),
			BallooningLimit:  int64(spec.Memory.BallooningLimitMib),
			HugePagesEnabled: spec.Memory.HugePages,
		}
	}

	// Disks
	for _, disk := range spec.Disks {
		if disk == nil {
			continue
		}
		result.Disks = append(result.Disks, domain.DiskDevice{
			Name:      disk.Name,
			VolumeID:  disk.VolumeId,
			SizeGiB:   int64(disk.SizeGib),
			Bus:       disk.Bus.String(),
			Cache:     disk.CacheMode.String(),
			IOPSLimit: int64(disk.IopsLimit),
			BootOrder: disk.BootOrder,
		})
	}

	// NICs
	for _, nic := range spec.Nics {
		if nic == nil {
			continue
		}
		result.NICs = append(result.NICs, domain.NetworkDevice{
			Name:               nic.Name,
			NetworkID:          nic.NetworkId,
			MACAddress:         nic.MacAddress,
			SecurityGroups:     nic.SecurityGroupIds,
			BandwidthLimitMbps: int64(nic.BandwidthLimitMbps),
		})
	}

	// CDROMs
	for _, cdrom := range spec.Cdroms {
		if cdrom == nil {
			continue
		}
		result.Cdroms = append(result.Cdroms, domain.CDROMDevice{
			Name:      cdrom.Name,
			ImageID:   cdrom.ImageId,
			Connected: cdrom.Connected,
		})
	}

	// Display config
	if spec.Display != nil {
		result.Display = &domain.DisplayConfig{
			Type:     spec.Display.Type.String(),
			Password: spec.Display.Password,
		}
	}

	return result
}

// ============================================================================
// Domain to Proto Converters
// ============================================================================

// ToProto converts a domain VirtualMachine to a proto VirtualMachine.
func ToProto(vm *domain.VirtualMachine) *computev1.VirtualMachine {
	if vm == nil {
		return nil
	}

	result := &computev1.VirtualMachine{
		Id:              vm.ID,
		Name:            vm.Name,
		ProjectId:       vm.ProjectID,
		Description:     vm.Description,
		Labels:          vm.Labels,
		HardwareVersion: vm.HardwareVersion,
		CreatedBy:       vm.CreatedBy,
	}

	// Timestamps
	if !vm.CreatedAt.IsZero() {
		result.CreatedAt = timestamppb.New(vm.CreatedAt)
	}
	if !vm.UpdatedAt.IsZero() {
		result.UpdatedAt = timestamppb.New(vm.UpdatedAt)
	}

	// Spec
	result.Spec = convertSpecToProto(vm.Spec)

	// Status
	result.Status = convertStatusToProto(vm.Status)

	return result
}

// convertSpecToProto converts a domain VMSpec to a proto VmSpec.
func convertSpecToProto(spec domain.VMSpec) *computev1.VmSpec {
	result := &computev1.VmSpec{}

	// CPU config
	result.Cpu = &computev1.CpuConfig{
		Cores:   spec.CPU.Cores,
		Sockets: spec.CPU.Sockets,
		Threads: spec.CPU.Threads,
		Model:   spec.CPU.Model,
	}

	// Memory config
	result.Memory = &computev1.MemoryConfig{
		SizeMib:            uint32(spec.Memory.SizeMiB),
		BallooningLimitMib: uint32(spec.Memory.BallooningLimit),
		HugePages:          spec.Memory.HugePagesEnabled,
	}

	// Disks
	for _, disk := range spec.Disks {
		result.Disks = append(result.Disks, &computev1.DiskDevice{
			Name:      disk.Name,
			VolumeId:  disk.VolumeID,
			SizeGib:   uint32(disk.SizeGiB),
			Bus:       parseBusType(disk.Bus),
			BootOrder: disk.BootOrder,
			IopsLimit: uint32(disk.IOPSLimit),
		})
	}

	// NICs
	for _, nic := range spec.NICs {
		result.Nics = append(result.Nics, &computev1.NetworkInterface{
			Name:               nic.Name,
			NetworkId:          nic.NetworkID,
			MacAddress:         nic.MACAddress,
			SecurityGroupIds:   nic.SecurityGroups,
			BandwidthLimitMbps: uint32(nic.BandwidthLimitMbps),
		})
	}

	// CDROMs
	for _, cdrom := range spec.Cdroms {
		result.Cdroms = append(result.Cdroms, &computev1.CdromDevice{
			Name:      cdrom.Name,
			ImageId:   cdrom.ImageID,
			Connected: cdrom.Connected,
		})
	}

	return result
}

// convertStatusToProto converts a domain VMStatus to a proto VmStatus.
func convertStatusToProto(status domain.VMStatus) *computev1.VmStatus {
	result := &computev1.VmStatus{
		State:       convertPowerStateToProto(status.State),
		NodeId:      status.NodeID,
		IpAddresses: status.IPAddresses,
		Message:     status.Message,
	}

	// Resource usage
	result.Resources = &computev1.ResourceUsage{
		CpuPercent:    float32(status.Resources.CPUPercent),
		MemoryUsedMib: uint64(status.Resources.MemoryUsedMiB),
		DiskReadBps:   uint64(status.Resources.DiskReadBps),
		DiskWriteBps:  uint64(status.Resources.DiskWriteBps),
		NetworkRxBps:  uint64(status.Resources.NetworkRxBps),
		NetworkTxBps:  uint64(status.Resources.NetworkTxBps),
	}

	// Guest agent info
	if status.GuestAgent != nil {
		result.GuestAgent = &computev1.GuestAgentInfo{
			Installed: status.GuestAgent.Installed,
			Version:   status.GuestAgent.Version,
			Hostname:  status.GuestAgent.Hostname,
		}
	}

	// Console info
	if status.Console != nil {
		result.Console = &computev1.ConsoleInfo{
			Type: parseConsoleType(status.Console.Type),
			Url:  status.Console.URL,
		}
	}

	return result
}

// convertPowerStateToProto converts a domain VMState to a proto PowerState.
func convertPowerStateToProto(state domain.VMState) computev1.PowerState {
	switch state {
	case domain.VMStatePending:
		return computev1.PowerState_POWER_STATE_PENDING
	case domain.VMStateCreating:
		return computev1.PowerState_POWER_STATE_CREATING
	case domain.VMStateStarting:
		return computev1.PowerState_POWER_STATE_STARTING
	case domain.VMStateRunning:
		return computev1.PowerState_POWER_STATE_RUNNING
	case domain.VMStateStopping:
		return computev1.PowerState_POWER_STATE_STOPPING
	case domain.VMStateStopped:
		return computev1.PowerState_POWER_STATE_STOPPED
	case domain.VMStatePaused:
		return computev1.PowerState_POWER_STATE_PAUSED
	case domain.VMStateSuspended:
		return computev1.PowerState_POWER_STATE_SUSPENDED
	case domain.VMStateMigrating:
		return computev1.PowerState_POWER_STATE_MIGRATING
	case domain.VMStateError, domain.VMStateFailed:
		return computev1.PowerState_POWER_STATE_ERROR
	case domain.VMStateDeleting:
		return computev1.PowerState_POWER_STATE_DELETING
	default:
		return computev1.PowerState_POWER_STATE_UNSPECIFIED
	}
}

// convertPowerStateFromProto converts a proto PowerState to a domain VMState.
func convertPowerStateFromProto(state computev1.PowerState) domain.VMState {
	switch state {
	case computev1.PowerState_POWER_STATE_PENDING:
		return domain.VMStatePending
	case computev1.PowerState_POWER_STATE_CREATING:
		return domain.VMStateCreating
	case computev1.PowerState_POWER_STATE_STARTING:
		return domain.VMStateStarting
	case computev1.PowerState_POWER_STATE_RUNNING:
		return domain.VMStateRunning
	case computev1.PowerState_POWER_STATE_STOPPING:
		return domain.VMStateStopping
	case computev1.PowerState_POWER_STATE_STOPPED:
		return domain.VMStateStopped
	case computev1.PowerState_POWER_STATE_PAUSED:
		return domain.VMStatePaused
	case computev1.PowerState_POWER_STATE_SUSPENDED:
		return domain.VMStateSuspended
	case computev1.PowerState_POWER_STATE_MIGRATING:
		return domain.VMStateMigrating
	case computev1.PowerState_POWER_STATE_ERROR:
		return domain.VMStateError
	case computev1.PowerState_POWER_STATE_DELETING:
		return domain.VMStateDeleting
	default:
		return domain.VMStateStopped
	}
}

// convertPowerStatesToDomain converts a slice of proto PowerStates to domain VMStates.
func convertPowerStatesToDomain(states []computev1.PowerState) []domain.VMState {
	if len(states) == 0 {
		return nil
	}
	result := make([]domain.VMState, len(states))
	for i, s := range states {
		result[i] = convertPowerStateFromProto(s)
	}
	return result
}

// Helper functions for parsing enums

func parseBusType(bus string) computev1.BusType {
	switch bus {
	case "VIRTIO", "virtio":
		return computev1.BusType_BUS_TYPE_VIRTIO
	case "SCSI", "scsi":
		return computev1.BusType_BUS_TYPE_SCSI
	case "SATA", "sata":
		return computev1.BusType_BUS_TYPE_SATA
	case "IDE", "ide":
		return computev1.BusType_BUS_TYPE_IDE
	default:
		return computev1.BusType_BUS_TYPE_VIRTIO
	}
}

func parseConsoleType(t string) computev1.ConsoleType {
	switch t {
	case "VNC", "vnc":
		return computev1.ConsoleType_CONSOLE_TYPE_VNC
	case "SPICE", "spice":
		return computev1.ConsoleType_CONSOLE_TYPE_SPICE
	default:
		return computev1.ConsoleType_CONSOLE_TYPE_VNC
	}
}
