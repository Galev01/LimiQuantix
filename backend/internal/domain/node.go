package domain

import (
	"time"
)

// NodePhase represents the lifecycle phase of a node.
type NodePhase string

const (
	NodePhaseUnknown     NodePhase = "UNKNOWN"
	NodePhasePending     NodePhase = "PENDING"
	NodePhaseReady       NodePhase = "READY"
	NodePhaseNotReady    NodePhase = "NOT_READY"
	NodePhaseMaintenance NodePhase = "MAINTENANCE"
	NodePhaseDraining    NodePhase = "DRAINING"
	NodePhaseError       NodePhase = "ERROR"
)

// Node represents a physical hypervisor host.
type Node struct {
	ID           string            `json:"id"`
	Hostname     string            `json:"hostname"`
	ManagementIP string            `json:"management_ip"`
	Labels       map[string]string `json:"labels"`
	ClusterID    string            `json:"cluster_id,omitempty"`

	Spec   NodeSpec   `json:"spec"`
	Status NodeStatus `json:"status"`

	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	LastHeartbeat *time.Time `json:"last_heartbeat,omitempty"`
}

// NodeSpec represents the hardware capabilities of a node.
type NodeSpec struct {
	CPU      NodeCPUInfo      `json:"cpu"`
	Memory   NodeMemoryInfo   `json:"memory"`
	Storage  []StorageDevice  `json:"storage"`
	Networks []NetworkAdapter `json:"networks"`
	Role     NodeRole         `json:"role"`
}

// NodeCPUInfo represents CPU information for a node.
type NodeCPUInfo struct {
	Model       string   `json:"model"`
	Sockets     int32    `json:"sockets"`
	CoresPerSocket int32 `json:"cores_per_socket"`
	ThreadsPerCore int32 `json:"threads_per_core"`
	FrequencyMHz int32   `json:"frequency_mhz"`
	Features    []string `json:"features,omitempty"`
}

// TotalCores returns the total number of CPU cores.
func (c NodeCPUInfo) TotalCores() int32 {
	return c.Sockets * c.CoresPerSocket
}

// TotalThreads returns the total number of CPU threads.
func (c NodeCPUInfo) TotalThreads() int32 {
	return c.Sockets * c.CoresPerSocket * c.ThreadsPerCore
}

// NodeMemoryInfo represents memory information for a node.
type NodeMemoryInfo struct {
	TotalMiB       int64 `json:"total_mib"`
	AllocatableMiB int64 `json:"allocatable_mib"`
}

// StorageDevice represents a storage device on a node.
type StorageDevice struct {
	Name     string `json:"name"`
	Type     string `json:"type"` // HDD, SSD, NVMe
	SizeGiB  int64  `json:"size_gib"`
	Path     string `json:"path"`
	Model    string `json:"model,omitempty"`
	Serial   string `json:"serial,omitempty"`
}

// NetworkAdapter represents a network adapter on a node.
type NetworkAdapter struct {
	Name       string `json:"name"`
	MACAddress string `json:"mac_address"`
	SpeedMbps  int64  `json:"speed_mbps"`
	MTU        int32  `json:"mtu"`
	Driver     string `json:"driver,omitempty"`
	SRIOVCapable bool `json:"sriov_capable"`
}

// NodeRole represents the role of a node in the cluster.
type NodeRole struct {
	Compute      bool `json:"compute"`
	Storage      bool `json:"storage"`
	ControlPlane bool `json:"control_plane"`
}

// NodeStatus represents the current status of a node.
type NodeStatus struct {
	Phase       NodePhase       `json:"phase"`
	Conditions  []NodeCondition `json:"conditions,omitempty"`
	Allocatable Resources       `json:"allocatable"`
	Allocated   Resources       `json:"allocated"`
	VMIDs       []string        `json:"vm_ids,omitempty"`
	SystemInfo  *SystemInfo     `json:"system_info,omitempty"`
}

// NodeCondition represents a condition of a node.
type NodeCondition struct {
	Type    string    `json:"type"`
	Status  string    `json:"status"` // True, False, Unknown
	Reason  string    `json:"reason,omitempty"`
	Message string    `json:"message,omitempty"`
	LastUpdate time.Time `json:"last_update"`
}

// Resources represents allocatable/allocated resources.
type Resources struct {
	CPUCores     int32 `json:"cpu_cores"`
	MemoryMiB    int64 `json:"memory_mib"`
	StorageGiB   int64 `json:"storage_gib"`
	GPUCount     int32 `json:"gpu_count,omitempty"`
}

// SystemInfo represents system information about the node.
type SystemInfo struct {
	OS              string `json:"os"`
	Kernel          string `json:"kernel"`
	Architecture    string `json:"architecture"`
	HypervisorVersion string `json:"hypervisor_version"`
	AgentVersion    string `json:"agent_version"`
}

// IsReady returns true if the node is ready to accept VMs.
func (n *Node) IsReady() bool {
	return n.Status.Phase == NodePhaseReady
}

// IsSchedulable returns true if VMs can be scheduled on this node.
func (n *Node) IsSchedulable() bool {
	return n.Status.Phase == NodePhaseReady && n.Spec.Role.Compute
}

// AvailableCPU returns the available CPU cores.
func (n *Node) AvailableCPU() int32 {
	return n.Status.Allocatable.CPUCores - n.Status.Allocated.CPUCores
}

// AvailableMemory returns the available memory in MiB.
func (n *Node) AvailableMemory() int64 {
	return n.Status.Allocatable.MemoryMiB - n.Status.Allocated.MemoryMiB
}

// VMCount returns the number of VMs running on this node.
func (n *Node) VMCount() int {
	return len(n.Status.VMIDs)
}

