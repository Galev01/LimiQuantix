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
	
	// State reconciliation states (for deletion scenarios)
	VMStateLost       VMState = "LOST"       // Managed VM was deleted outside control plane
	VMStateTerminated VMState = "TERMINATED" // VM was properly deleted, kept for audit
)

// VMOrigin indicates where the VM came from (for state reconciliation).
type VMOrigin string

const (
	VMOriginUnknown        VMOrigin = ""
	VMOriginControlPlane   VMOrigin = "control-plane"    // Created via QvDC Dashboard/API
	VMOriginHostDiscovered VMOrigin = "host-discovered"  // Discovered on host during sync
	VMOriginImported       VMOrigin = "imported"         // Imported from another system
)

// VirtualMachine represents a virtual machine in the system.
type VirtualMachine struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	ProjectID       string            `json:"project_id"`
	FolderID        string            `json:"folder_id,omitempty"`
	Description     string            `json:"description"`
	Labels          map[string]string `json:"labels"`
	HardwareVersion string            `json:"hardware_version"`

	Spec   VMSpec   `json:"spec"`
	Status VMStatus `json:"status"`

	// ScheduledAt is for scheduled VM creation (create the VM later).
	ScheduledAt *time.Time `json:"scheduled_at,omitempty"`

	// CustomizationSpecID references a reusable customization specification.
	CustomizationSpecID string `json:"customization_spec_id,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	CreatedBy string    `json:"created_by"`
	
	// ==========================================================================
	// State Reconciliation Fields
	// ==========================================================================
	
	// Origin indicates where the VM came from.
	// - control-plane: Created via QvDC Dashboard/API (managed lifecycle)
	// - host-discovered: Discovered on a host during state sync (unmanaged)
	// - imported: Explicitly imported from another system
	Origin VMOrigin `json:"origin,omitempty" db:"origin"`
	
	// IsManaged indicates if QvDC controls this VM's lifecycle.
	// false = discovered VM that user hasn't "adopted" yet
	// Only managed VMs will trigger alerts if deleted outside control plane.
	IsManaged bool `json:"is_managed" db:"is_managed"`
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
	HAPolicy  *HAPolicy        `json:"ha_policy,omitempty"`
}

// HAPolicy defines high availability settings for a VM.
type HAPolicy struct {
	AutoRestart  bool   `json:"auto_restart"`
	Priority     int32  `json:"priority"`
	RestartDelay int32  `json:"restart_delay_seconds,omitempty"`
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
	
	// State reconciliation fields
	LastSeen   *time.Time `json:"last_seen,omitempty" db:"last_seen"`     // Last time VM was seen on a host
	LostReason string     `json:"lost_reason,omitempty" db:"lost_reason"` // Why VM is in LOST state
	LostAt     *time.Time `json:"lost_at,omitempty" db:"lost_at"`         // When VM was marked as LOST
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
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Password string `json:"password,omitempty"`
	URL      string `json:"url,omitempty"` // Legacy field
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

// ============================================================================
// Snapshot
// ============================================================================

// Snapshot represents a point-in-time snapshot of a virtual machine.
type Snapshot struct {
	ID             string    `json:"id"`
	VMID           string    `json:"vm_id"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	ParentID       string    `json:"parent_id,omitempty"`
	MemoryIncluded bool      `json:"memory_included"`
	Quiesced       bool      `json:"quiesced"`
	SizeBytes      uint64    `json:"size_bytes"`
	CreatedAt      time.Time `json:"created_at"`
}

// ============================================================================
// VM Events
// ============================================================================

// VMEvent represents an event that occurred on a virtual machine.
type VMEvent struct {
	ID        string            `json:"id"`
	VMID      string            `json:"vm_id"`
	Type      string            `json:"type"`      // power, config, snapshot, disk, network, error
	Severity  string            `json:"severity"`  // info, warning, error
	Message   string            `json:"message"`
	User      string            `json:"user"`
	CreatedAt time.Time         `json:"created_at"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

