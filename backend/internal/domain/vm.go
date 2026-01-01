package domain

import (
	"time"
)

// VMState represents the power state of a virtual machine.
type VMState string

const (
	VMStatePending   VMState = "PENDING"
	VMStateCreating  VMState = "CREATING"
	VMStateStarting  VMState = "STARTING"
	VMStateRunning   VMState = "RUNNING"
	VMStateStopping  VMState = "STOPPING"
	VMStateStopped   VMState = "STOPPED"
	VMStatePaused    VMState = "PAUSED"
	VMStateSuspended VMState = "SUSPENDED"
	VMStateMigrating VMState = "MIGRATING"
	VMStateError     VMState = "ERROR"
	VMStateFailed    VMState = "FAILED"
	VMStateDeleting  VMState = "DELETING"
)

// VirtualMachine represents a virtual machine in the system.
type VirtualMachine struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	ProjectID       string            `json:"project_id"`
	Description     string            `json:"description"`
	Labels          map[string]string `json:"labels"`
	HardwareVersion string            `json:"hardware_version"`

	Spec   VMSpec   `json:"spec"`
	Status VMStatus `json:"status"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	CreatedBy string    `json:"created_by"`
}

// VMSpec represents the desired configuration of a virtual machine.
type VMSpec struct {
	CPU       CPUConfig        `json:"cpu"`
	Memory    MemoryConfig     `json:"memory"`
	Disks     []DiskDevice     `json:"disks"`
	NICs      []NetworkDevice  `json:"nics"`
	Cdroms    []CDROMDevice    `json:"cdroms,omitempty"`
	Display   *DisplayConfig   `json:"display,omitempty"`
	Boot      *BootConfig      `json:"boot,omitempty"`
	Placement *PlacementPolicy `json:"placement,omitempty"`
}

// CPUConfig represents CPU configuration for a VM.
type CPUConfig struct {
	Cores   int32  `json:"cores"`
	Sockets int32  `json:"sockets"`
	Threads int32  `json:"threads"`
	Model   string `json:"model,omitempty"`
}

// TotalCores returns the total number of vCPUs.
func (c CPUConfig) TotalCores() int32 {
	sockets := c.Sockets
	if sockets == 0 {
		sockets = 1
	}
	threads := c.Threads
	if threads == 0 {
		threads = 1
	}
	return c.Cores * sockets * threads
}

// MemoryConfig represents memory configuration for a VM.
type MemoryConfig struct {
	SizeMiB         int64 `json:"size_mib"`
	BallooningLimit int64 `json:"ballooning_limit,omitempty"`
	HugePagesEnabled bool `json:"huge_pages_enabled,omitempty"`
}

// DiskDevice represents a disk attached to a VM.
type DiskDevice struct {
	Name         string `json:"name"`
	VolumeID     string `json:"volume_id,omitempty"`
	SizeGiB      int64  `json:"size_gib"`
	Bus          string `json:"bus"` // virtio, scsi, sata
	Cache        string `json:"cache,omitempty"`
	IOPSLimit    int64  `json:"iops_limit,omitempty"`
	BootOrder    int32  `json:"boot_order,omitempty"`
	Provisioning string `json:"provisioning,omitempty"` // thin, thick
}

// NetworkDevice represents a network interface attached to a VM.
type NetworkDevice struct {
	Name            string   `json:"name"`
	NetworkID       string   `json:"network_id"`
	MACAddress      string   `json:"mac_address,omitempty"`
	IPAddresses     []string `json:"ip_addresses,omitempty"`
	SecurityGroups  []string `json:"security_groups,omitempty"`
	BandwidthLimitMbps int64 `json:"bandwidth_limit_mbps,omitempty"`
}

// CDROMDevice represents a CD-ROM device attached to a VM.
type CDROMDevice struct {
	Name     string `json:"name"`
	ImageID  string `json:"image_id,omitempty"`
	ISO      string `json:"iso,omitempty"`
	Connected bool  `json:"connected"`
}

// DisplayConfig represents display/console configuration.
type DisplayConfig struct {
	Type     string `json:"type"` // vnc, spice
	Port     int32  `json:"port,omitempty"`
	Password string `json:"password,omitempty"`
}

// BootConfig represents boot configuration.
type BootConfig struct {
	Order   []string `json:"order"` // disk, cdrom, network
	UEFI    bool     `json:"uefi"`
	SecureBoot bool  `json:"secure_boot"`
}

// PlacementPolicy represents VM placement preferences.
type PlacementPolicy struct {
	NodeID            string            `json:"node_id,omitempty"`
	ClusterID         string            `json:"cluster_id,omitempty"`
	AffinityLabels    map[string]string `json:"affinity_labels,omitempty"`
	AntiAffinityLabels map[string]string `json:"anti_affinity_labels,omitempty"`
}

// VMStatus represents the current runtime status of a virtual machine.
type VMStatus struct {
	State       VMState       `json:"state"`
	NodeID      string        `json:"node_id,omitempty"`
	IPAddresses []string      `json:"ip_addresses,omitempty"`
	Resources   ResourceUsage `json:"resources,omitempty"`
	GuestAgent  *GuestAgent   `json:"guest_agent,omitempty"`
	Console     *ConsoleInfo  `json:"console,omitempty"`
	Message     string        `json:"message,omitempty"`
}

// ResourceUsage represents current resource consumption.
type ResourceUsage struct {
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryUsedMiB int64   `json:"memory_used_mib"`
	DiskReadBps   int64   `json:"disk_read_bps"`
	DiskWriteBps  int64   `json:"disk_write_bps"`
	NetworkRxBps  int64   `json:"network_rx_bps"`
	NetworkTxBps  int64   `json:"network_tx_bps"`
}

// GuestAgent represents guest agent information.
type GuestAgent struct {
	Installed bool   `json:"installed"`
	Version   string `json:"version,omitempty"`
	Hostname  string `json:"hostname,omitempty"`
	OS        string `json:"os,omitempty"`
}

// ConsoleInfo represents console connection information.
type ConsoleInfo struct {
	Type     string `json:"type"`
	URL      string `json:"url"`
	Password string `json:"password,omitempty"`
}

// IsRunning returns true if the VM is in a running state.
func (vm *VirtualMachine) IsRunning() bool {
	return vm.Status.State == VMStateRunning
}

// IsStopped returns true if the VM is stopped.
func (vm *VirtualMachine) IsStopped() bool {
	return vm.Status.State == VMStateStopped
}

// CanStart returns true if the VM can be started.
func (vm *VirtualMachine) CanStart() bool {
	return vm.Status.State == VMStateStopped || vm.Status.State == VMStatePaused
}

// CanStop returns true if the VM can be stopped.
func (vm *VirtualMachine) CanStop() bool {
	return vm.Status.State == VMStateRunning || vm.Status.State == VMStatePaused
}

