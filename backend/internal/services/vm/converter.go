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
			Cores:   int32(spec.Cpu.Cores),
			Sockets: int32(spec.Cpu.Sockets),
			Threads: int32(spec.Cpu.ThreadsPerCore),
			Model:   spec.Cpu.Model,
		}
	}

	// Memory config
	if spec.Memory != nil {
		result.Memory = domain.MemoryConfig{
			SizeMiB:          int64(spec.Memory.SizeMib),
			BallooningLimit:  int64(spec.Memory.MaxMemoryMib),
			HugePagesEnabled: spec.Memory.HugePages != nil,
		}
	}

	// Disks
	for _, disk := range spec.Disks {
		if disk == nil {
			continue
		}
		result.Disks = append(result.Disks, domain.DiskDevice{
			Name:        disk.Id,
			VolumeID:    disk.VolumeId,
			SizeGiB:     int64(disk.SizeGib),
			Bus:         disk.Bus.String(),
			Cache:       disk.Cache.String(),
			BootOrder:   int32(disk.BootIndex),
			BackingFile: disk.BackingFile, // Cloud image path for copy-on-write
		})
	}

	// NICs
	for _, nic := range spec.Nics {
		if nic == nil {
			continue
		}
		result.NICs = append(result.NICs, domain.NetworkDevice{
			Name:           nic.Id,
			NetworkID:      nic.NetworkId,
			MACAddress:     nic.MacAddress,
			SecurityGroups: nic.SecurityGroups,
		})
	}

	// CDROMs
	for _, cdrom := range spec.Cdroms {
		if cdrom == nil {
			continue
		}
		result.Cdroms = append(result.Cdroms, domain.CDROMDevice{
			Name:      cdrom.Id,
			ISO:       cdrom.IsoPath, // Use ISO field for the actual path
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

	// Guest OS profile
	if spec.GuestOs != nil {
		result.GuestOS = convertGuestOSFromProto(spec.GuestOs.Family)
	}

	// HA Policy
	if spec.HaPolicy != nil {
		result.HAPolicy = &domain.HAPolicy{
			AutoRestart:  spec.HaPolicy.AutoRestart,
			Priority:     spec.HaPolicy.Priority,
			RestartDelay: int32(spec.HaPolicy.RestartDelaySec),
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
		Cores:          uint32(spec.CPU.Cores),
		Sockets:        uint32(spec.CPU.Sockets),
		ThreadsPerCore: uint32(spec.CPU.Threads),
		Model:          spec.CPU.Model,
	}

	// Memory config
	result.Memory = &computev1.MemoryConfig{
		SizeMib:      uint64(spec.Memory.SizeMiB),
		MaxMemoryMib: uint64(spec.Memory.BallooningLimit),
	}

	// Disks
	for _, disk := range spec.Disks {
		result.Disks = append(result.Disks, &computev1.DiskDevice{
			Id:          disk.Name,
			VolumeId:    disk.VolumeID,
			SizeGib:     uint64(disk.SizeGiB),
			Bus:         parseBusType(disk.Bus),
			BootIndex:   uint32(disk.BootOrder),
			BackingFile: disk.BackingFile, // Cloud image path for copy-on-write
		})
	}

	// NICs
	for _, nic := range spec.NICs {
		result.Nics = append(result.Nics, &computev1.NetworkInterface{
			Id:             nic.Name,
			NetworkId:      nic.NetworkID,
			MacAddress:     nic.MACAddress,
			SecurityGroups: nic.SecurityGroups,
		})
	}

	// CDROMs
	for _, cdrom := range spec.Cdroms {
		result.Cdroms = append(result.Cdroms, &computev1.CdromDevice{
			Id:        cdrom.Name,
			IsoPath:   cdrom.ISO, // Use ISO field for the actual path
			Connected: cdrom.Connected,
		})
	}

	// Guest OS profile
	if spec.GuestOS != "" {
		result.GuestOs = &computev1.GuestOSProfile{
			Family: convertGuestOSToProto(spec.GuestOS),
		}
	}

	// HA Policy
	if spec.HAPolicy != nil {
		result.HaPolicy = &computev1.HaPolicy{
			AutoRestart:     spec.HAPolicy.AutoRestart,
			Priority:        spec.HAPolicy.Priority,
			RestartDelaySec: uint32(spec.HAPolicy.RestartDelay),
		}
	}

	return result
}

// convertStatusToProto converts a domain VMStatus to a proto VmStatus.
func convertStatusToProto(status domain.VMStatus) *computev1.VmStatus {
	result := &computev1.VmStatus{
		State:        convertPowerStateToProto(status.State),
		NodeId:       status.NodeID,
		IpAddresses:  status.IPAddresses,
		ErrorMessage: status.Message,
	}

	// Resource usage
	result.ResourceUsage = &computev1.ResourceUsage{
		CpuUsagePercent: status.Resources.CPUPercent,
		MemoryUsedBytes: uint64(status.Resources.MemoryUsedMiB) * 1024 * 1024,
		DiskReadBytes:   uint64(status.Resources.DiskReadBps),
		DiskWriteBytes:  uint64(status.Resources.DiskWriteBps),
		NetworkRxBytes:  uint64(status.Resources.NetworkRxBps),
		NetworkTxBytes:  uint64(status.Resources.NetworkTxBps),
	}

	// Guest info
	if status.GuestAgent != nil {
		result.GuestInfo = &computev1.GuestInfo{
			Hostname:      status.GuestAgent.Hostname,
			OsName:        status.GuestAgent.OS,
			OsVersion:     status.GuestAgent.OSVersion,
			KernelVersion: status.GuestAgent.KernelVersion,
			AgentVersion:  status.GuestAgent.Version,
			UptimeSeconds: status.GuestAgent.UptimeSeconds,
		}
		// Add IP addresses if available
		if len(status.GuestAgent.IPAddresses) > 0 {
			result.IpAddresses = status.GuestAgent.IPAddresses
		}
	}

	// Console info
	if status.Console != nil {
		result.Console = &computev1.ConsoleInfo{
			Host:     status.Console.Host,
			Port:     uint32(status.Console.Port),
			Password: status.Console.Password,
		}
	}

	return result
}

// convertPowerStateToProto converts a domain VMState to a proto PowerState.
func convertPowerStateToProto(state domain.VMState) computev1.VmStatus_PowerState {
	switch state {
	case domain.VMStatePending, domain.VMStateCreating:
		return computev1.VmStatus_PROVISIONING
	case domain.VMStateStarting:
		return computev1.VmStatus_PROVISIONING
	case domain.VMStateRunning:
		return computev1.VmStatus_RUNNING
	case domain.VMStateStopping:
		return computev1.VmStatus_STOPPED
	case domain.VMStateStopped:
		return computev1.VmStatus_STOPPED
	case domain.VMStatePaused:
		return computev1.VmStatus_PAUSED
	case domain.VMStateSuspended:
		return computev1.VmStatus_SUSPENDED
	case domain.VMStateMigrating:
		return computev1.VmStatus_MIGRATING
	case domain.VMStateError, domain.VMStateFailed:
		return computev1.VmStatus_CRASHED
	case domain.VMStateDeleting:
		return computev1.VmStatus_STOPPED
	default:
		return computev1.VmStatus_UNKNOWN
	}
}

// convertPowerStateFromProto converts a proto PowerState to a domain VMState.
func convertPowerStateFromProto(state computev1.VmStatus_PowerState) domain.VMState {
	switch state {
	case computev1.VmStatus_PROVISIONING:
		return domain.VMStateCreating
	case computev1.VmStatus_RUNNING:
		return domain.VMStateRunning
	case computev1.VmStatus_STOPPED:
		return domain.VMStateStopped
	case computev1.VmStatus_PAUSED:
		return domain.VMStatePaused
	case computev1.VmStatus_SUSPENDED:
		return domain.VMStateSuspended
	case computev1.VmStatus_MIGRATING:
		return domain.VMStateMigrating
	case computev1.VmStatus_CRASHED:
		return domain.VMStateError
	default:
		return domain.VMStateStopped
	}
}

// convertPowerStatesToDomain converts a slice of proto PowerStates to domain VMStates.
func convertPowerStatesToDomain(states []computev1.VmStatus_PowerState) []domain.VMState {
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

func parseBusType(bus string) computev1.DiskDevice_BusType {
	switch bus {
	case "VIRTIO", "virtio", "virtio_blk":
		return computev1.DiskDevice_VIRTIO_BLK
	case "SCSI", "scsi", "virtio_scsi":
		return computev1.DiskDevice_VIRTIO_SCSI
	case "NVME", "nvme":
		return computev1.DiskDevice_NVME
	case "SATA", "sata":
		return computev1.DiskDevice_SATA
	case "IDE", "ide":
		return computev1.DiskDevice_IDE
	default:
		return computev1.DiskDevice_VIRTIO_BLK
	}
}

func parseDisplayType(t string) computev1.DisplayConfig_DisplayType {
	switch t {
	case "VNC", "vnc":
		return computev1.DisplayConfig_VNC
	case "SPICE", "spice":
		return computev1.DisplayConfig_SPICE
	case "NONE", "none":
		return computev1.DisplayConfig_NONE
	default:
		return computev1.DisplayConfig_VNC
	}
}

// convertGuestOSFromProto converts a proto GuestOSFamily enum to a domain GuestOSFamily.
func convertGuestOSFromProto(family computev1.GuestOSFamily) domain.GuestOSFamily {
	switch family {
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_RHEL:
		return domain.GuestOSRHEL
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_DEBIAN:
		return domain.GuestOSDebian
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_SUSE:
		return domain.GuestOSSUSE
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_ARCH:
		return domain.GuestOSArch
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_FEDORA:
		return domain.GuestOSFedora
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_GENERIC_LINUX:
		return domain.GuestOSGenericLinux
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_WINDOWS_SERVER:
		return domain.GuestOSWindowsServer
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_WINDOWS_DESKTOP:
		return domain.GuestOSWindowsDesktop
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_WINDOWS_LEGACY:
		return domain.GuestOSWindowsLegacy
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_FREEBSD:
		return domain.GuestOSFreeBSD
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_OPENBSD:
		return domain.GuestOSOpenBSD
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_NETBSD:
		return domain.GuestOSNetBSD
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_MACOS:
		return domain.GuestOSMacOS
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_SOLARIS:
		return domain.GuestOSSolaris
	case computev1.GuestOSFamily_GUEST_OS_FAMILY_OTHER:
		return domain.GuestOSOther
	default:
		return domain.GuestOSUnspecified
	}
}

// convertGuestOSToProto converts a domain GuestOSFamily to a proto GuestOSFamily enum.
func convertGuestOSToProto(family domain.GuestOSFamily) computev1.GuestOSFamily {
	switch family {
	case domain.GuestOSRHEL:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_RHEL
	case domain.GuestOSDebian:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_DEBIAN
	case domain.GuestOSSUSE:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_SUSE
	case domain.GuestOSArch:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_ARCH
	case domain.GuestOSFedora:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_FEDORA
	case domain.GuestOSGenericLinux:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_GENERIC_LINUX
	case domain.GuestOSWindowsServer:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_WINDOWS_SERVER
	case domain.GuestOSWindowsDesktop:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_WINDOWS_DESKTOP
	case domain.GuestOSWindowsLegacy:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_WINDOWS_LEGACY
	case domain.GuestOSFreeBSD:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_FREEBSD
	case domain.GuestOSOpenBSD:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_OPENBSD
	case domain.GuestOSNetBSD:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_NETBSD
	case domain.GuestOSMacOS:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_MACOS
	case domain.GuestOSSolaris:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_SOLARIS
	case domain.GuestOSOther:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_OTHER
	default:
		return computev1.GuestOSFamily_GUEST_OS_FAMILY_UNSPECIFIED
	}
}

// ============================================================================
// Snapshot Converters
// ============================================================================

// SnapshotToProto converts a domain Snapshot to a proto Snapshot.
func SnapshotToProto(snap *domain.Snapshot) *computev1.Snapshot {
	if snap == nil {
		return nil
	}

	result := &computev1.Snapshot{
		Id:             snap.ID,
		Name:           snap.Name,
		Description:    snap.Description,
		ParentId:       snap.ParentID,
		MemoryIncluded: snap.MemoryIncluded,
		Quiesced:       snap.Quiesced,
		SizeBytes:      snap.SizeBytes,
	}

	if !snap.CreatedAt.IsZero() {
		result.CreatedAt = timestamppb.New(snap.CreatedAt)
	}

	return result
}
