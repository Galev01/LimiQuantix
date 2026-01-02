// Package scheduler implements VM placement logic for the limiquantix control plane.
// It determines which host should run a new VM based on resource availability,
// placement policies, and scoring strategies.
package scheduler

// Config holds the scheduler configuration.
type Config struct {
	// PlacementStrategy determines how VMs are distributed across nodes.
	// - "spread": Distribute VMs evenly across nodes (better HA)
	// - "pack": Consolidate VMs on fewer nodes (better resource efficiency)
	PlacementStrategy string `mapstructure:"placement_strategy"`

	// OvercommitCPU is the CPU overcommit ratio (e.g., 2.0 = 2x overcommit)
	OvercommitCPU float64 `mapstructure:"overcommit_cpu"`

	// OvercommitMemory is the memory overcommit ratio (e.g., 1.5 = 1.5x overcommit)
	OvercommitMemory float64 `mapstructure:"overcommit_memory"`

	// ReservedCPUCores is the number of CPU cores reserved for the hypervisor
	ReservedCPUCores int `mapstructure:"reserved_cpu_cores"`

	// ReservedMemoryMiB is the amount of memory in MiB reserved for the hypervisor
	ReservedMemoryMiB int `mapstructure:"reserved_memory_mib"`

	// EnableNUMAPlacement enables NUMA-aware placement
	EnableNUMAPlacement bool `mapstructure:"enable_numa_placement"`
}

// DefaultConfig returns the default scheduler configuration.
func DefaultConfig() Config {
	return Config{
		PlacementStrategy: "spread",
		OvercommitCPU:     1.0, // No overcommit by default
		OvercommitMemory:  1.0, // No overcommit by default
		ReservedCPUCores:  1,
		ReservedMemoryMiB: 1024, // 1 GiB reserved for hypervisor
	}
}
