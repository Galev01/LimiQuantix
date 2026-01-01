// Package memory provides in-memory repository implementations for development and testing.
package memory

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/services/node"
)

// Ensure NodeRepository implements node.Repository
var _ node.Repository = (*NodeRepository)(nil)

// NodeRepository is an in-memory implementation of the Node repository.
type NodeRepository struct {
	mu   sync.RWMutex
	data map[string]*domain.Node
}

// NewNodeRepository creates a new in-memory Node repository.
func NewNodeRepository() *NodeRepository {
	return &NodeRepository{
		data: make(map[string]*domain.Node),
	}
}

// Create stores a new node.
func (r *NodeRepository) Create(ctx context.Context, n *domain.Node) (*domain.Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Generate ID if not set
	if n.ID == "" {
		n.ID = uuid.New().String()
	}

	// Check for duplicate hostname
	for _, existing := range r.data {
		if existing.Hostname == n.Hostname {
			return nil, domain.ErrAlreadyExists
		}
	}

	// Set timestamps
	now := time.Now()
	if n.CreatedAt.IsZero() {
		n.CreatedAt = now
	}
	n.UpdatedAt = now

	// Clone to avoid external mutations
	stored := cloneNode(n)
	r.data[stored.ID] = stored

	return cloneNode(stored), nil
}

// Get retrieves a node by ID.
func (r *NodeRepository) Get(ctx context.Context, id string) (*domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	n, ok := r.data[id]
	if !ok {
		return nil, domain.ErrNotFound
	}

	return cloneNode(n), nil
}

// GetByHostname retrieves a node by hostname.
func (r *NodeRepository) GetByHostname(ctx context.Context, hostname string) (*domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, n := range r.data {
		if n.Hostname == hostname {
			return cloneNode(n), nil
		}
	}

	return nil, domain.ErrNotFound
}

// List returns all nodes matching the filter.
func (r *NodeRepository) List(ctx context.Context, filter node.NodeFilter) ([]*domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*domain.Node

	for _, n := range r.data {
		if !matchesNodeFilter(n, filter) {
			continue
		}
		result = append(result, cloneNode(n))
	}

	return result, nil
}

// ListSchedulable returns nodes that can accept new VMs.
func (r *NodeRepository) ListSchedulable(ctx context.Context) ([]*domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*domain.Node

	for _, n := range r.data {
		if n.IsSchedulable() {
			result = append(result, cloneNode(n))
		}
	}

	return result, nil
}

// Update updates an existing node.
func (r *NodeRepository) Update(ctx context.Context, n *domain.Node) (*domain.Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.data[n.ID]; !ok {
		return nil, domain.ErrNotFound
	}

	n.UpdatedAt = time.Now()
	stored := cloneNode(n)
	r.data[n.ID] = stored

	return cloneNode(stored), nil
}

// UpdateStatus updates only the status fields of a node.
func (r *NodeRepository) UpdateStatus(ctx context.Context, id string, status domain.NodeStatus) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	n, ok := r.data[id]
	if !ok {
		return domain.ErrNotFound
	}

	n.Status = status
	n.UpdatedAt = time.Now()

	return nil
}

// UpdateHeartbeat updates the last heartbeat time and resources.
func (r *NodeRepository) UpdateHeartbeat(ctx context.Context, id string, resources domain.Resources) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	n, ok := r.data[id]
	if !ok {
		return domain.ErrNotFound
	}

	now := time.Now()
	n.LastHeartbeat = &now
	n.Status.Allocated = resources
	n.UpdatedAt = now

	return nil
}

// Delete removes a node by ID.
func (r *NodeRepository) Delete(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.data[id]; !ok {
		return domain.ErrNotFound
	}

	delete(r.data, id)
	return nil
}

// ListByCluster returns all nodes in a cluster.
func (r *NodeRepository) ListByCluster(ctx context.Context, clusterID string) ([]*domain.Node, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*domain.Node

	for _, n := range r.data {
		if n.ClusterID == clusterID {
			result = append(result, cloneNode(n))
		}
	}

	return result, nil
}

// ============================================================================
// Helper Functions
// ============================================================================

// matchesNodeFilter checks if a node matches the given filter criteria.
func matchesNodeFilter(n *domain.Node, filter node.NodeFilter) bool {
	// Cluster filter
	if filter.ClusterID != "" && n.ClusterID != filter.ClusterID {
		return false
	}

	// Phase filter
	if len(filter.Phases) > 0 {
		matched := false
		for _, phase := range filter.Phases {
			if n.Status.Phase == phase {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}

	// Compute only filter
	if filter.ComputeOnly && !n.Spec.Role.Compute {
		return false
	}

	// Labels filter
	for key, value := range filter.Labels {
		if n.Labels[key] != value {
			return false
		}
	}

	return true
}

// cloneNode creates a deep copy of a Node.
func cloneNode(n *domain.Node) *domain.Node {
	if n == nil {
		return nil
	}

	clone := *n

	// Clone labels
	if n.Labels != nil {
		clone.Labels = make(map[string]string, len(n.Labels))
		for k, v := range n.Labels {
			clone.Labels[k] = v
		}
	}

	// Clone slices
	clone.Spec.Storage = append([]domain.StorageDevice(nil), n.Spec.Storage...)
	clone.Spec.Networks = append([]domain.NetworkAdapter(nil), n.Spec.Networks...)
	clone.Spec.CPU.Features = append([]string(nil), n.Spec.CPU.Features...)
	clone.Status.Conditions = append([]domain.NodeCondition(nil), n.Status.Conditions...)
	clone.Status.VMIDs = append([]string(nil), n.Status.VMIDs...)

	// Clone pointers
	if n.LastHeartbeat != nil {
		t := *n.LastHeartbeat
		clone.LastHeartbeat = &t
	}
	if n.Status.SystemInfo != nil {
		si := *n.Status.SystemInfo
		clone.Status.SystemInfo = &si
	}

	return &clone
}

// ============================================================================
// Seed Data for Development
// ============================================================================

// SeedDemoData adds sample nodes for development and demo purposes.
func (r *NodeRepository) SeedDemoData() {
	now := time.Now()

	demoNodes := []*domain.Node{
		{
			ID:           "node-01",
			Hostname:     "hypervisor-01.limiquantix.local",
			ManagementIP: "192.168.1.101",
			Labels:       map[string]string{"rack": "rack-1", "zone": "zone-a"},
			Spec: domain.NodeSpec{
				CPU: domain.NodeCPUInfo{
					Model:          "Intel Xeon E5-2680 v4",
					Sockets:        2,
					CoresPerSocket: 14,
					ThreadsPerCore: 2,
					FrequencyMHz:   2400,
					Features:       []string{"vmx", "avx2", "aes"},
				},
				Memory: domain.NodeMemoryInfo{
					TotalMiB:       262144, // 256 GB
					AllocatableMiB: 245760, // ~240 GB
				},
				Storage: []domain.StorageDevice{
					{Name: "nvme0n1", Type: "NVMe", SizeGiB: 1000, Path: "/dev/nvme0n1"},
					{Name: "nvme1n1", Type: "NVMe", SizeGiB: 1000, Path: "/dev/nvme1n1"},
				},
				Networks: []domain.NetworkAdapter{
					{Name: "eno1", MACAddress: "aa:bb:cc:dd:ee:01", SpeedMbps: 10000, MTU: 9000, SRIOVCapable: true},
					{Name: "eno2", MACAddress: "aa:bb:cc:dd:ee:02", SpeedMbps: 10000, MTU: 9000, SRIOVCapable: true},
				},
				Role: domain.NodeRole{Compute: true, Storage: true},
			},
			Status: domain.NodeStatus{
				Phase: domain.NodePhaseReady,
				Allocatable: domain.Resources{
					CPUCores:   56,
					MemoryMiB:  245760,
					StorageGiB: 2000,
				},
				Allocated: domain.Resources{
					CPUCores:   16,
					MemoryMiB:  49152,
					StorageGiB: 200,
				},
				VMIDs: []string{
					"11111111-1111-1111-1111-111111111111",
					"44444444-4444-4444-4444-444444444444",
				},
				SystemInfo: &domain.SystemInfo{
					OS:                "Linux",
					Kernel:            "5.15.0-generic",
					Architecture:      "x86_64",
					HypervisorVersion: "KVM 6.0",
					AgentVersion:      "0.1.0",
				},
			},
			CreatedAt:     now.Add(-720 * time.Hour), // 30 days ago
			UpdatedAt:     now.Add(-5 * time.Minute),
			LastHeartbeat: &now,
		},
		{
			ID:           "node-02",
			Hostname:     "hypervisor-02.limiquantix.local",
			ManagementIP: "192.168.1.102",
			Labels:       map[string]string{"rack": "rack-1", "zone": "zone-a"},
			Spec: domain.NodeSpec{
				CPU: domain.NodeCPUInfo{
					Model:          "Intel Xeon E5-2680 v4",
					Sockets:        2,
					CoresPerSocket: 14,
					ThreadsPerCore: 2,
					FrequencyMHz:   2400,
					Features:       []string{"vmx", "avx2", "aes"},
				},
				Memory: domain.NodeMemoryInfo{
					TotalMiB:       262144,
					AllocatableMiB: 245760,
				},
				Storage: []domain.StorageDevice{
					{Name: "nvme0n1", Type: "NVMe", SizeGiB: 1000, Path: "/dev/nvme0n1"},
				},
				Networks: []domain.NetworkAdapter{
					{Name: "eno1", MACAddress: "aa:bb:cc:dd:ee:11", SpeedMbps: 10000, MTU: 9000, SRIOVCapable: true},
				},
				Role: domain.NodeRole{Compute: true, Storage: true},
			},
			Status: domain.NodeStatus{
				Phase: domain.NodePhaseReady,
				Allocatable: domain.Resources{
					CPUCores:   56,
					MemoryMiB:  245760,
					StorageGiB: 1000,
				},
				Allocated: domain.Resources{
					CPUCores:   40,
					MemoryMiB:  180000,
					StorageGiB: 600,
				},
				VMIDs: []string{
					"22222222-2222-2222-2222-222222222222",
				},
				SystemInfo: &domain.SystemInfo{
					OS:                "Linux",
					Kernel:            "5.15.0-generic",
					Architecture:      "x86_64",
					HypervisorVersion: "KVM 6.0",
					AgentVersion:      "0.1.0",
				},
			},
			CreatedAt:     now.Add(-720 * time.Hour),
			UpdatedAt:     now.Add(-2 * time.Minute),
			LastHeartbeat: &now,
		},
		{
			ID:           "node-03",
			Hostname:     "hypervisor-03.limiquantix.local",
			ManagementIP: "192.168.1.103",
			Labels:       map[string]string{"rack": "rack-2", "zone": "zone-b"},
			Spec: domain.NodeSpec{
				CPU: domain.NodeCPUInfo{
					Model:          "AMD EPYC 7742",
					Sockets:        2,
					CoresPerSocket: 64,
					ThreadsPerCore: 2,
					FrequencyMHz:   2250,
					Features:       []string{"svm", "avx2", "aes"},
				},
				Memory: domain.NodeMemoryInfo{
					TotalMiB:       524288, // 512 GB
					AllocatableMiB: 500000,
				},
				Storage: []domain.StorageDevice{
					{Name: "nvme0n1", Type: "NVMe", SizeGiB: 2000, Path: "/dev/nvme0n1"},
					{Name: "nvme1n1", Type: "NVMe", SizeGiB: 2000, Path: "/dev/nvme1n1"},
				},
				Networks: []domain.NetworkAdapter{
					{Name: "eth0", MACAddress: "aa:bb:cc:dd:ee:21", SpeedMbps: 25000, MTU: 9000, SRIOVCapable: true},
				},
				Role: domain.NodeRole{Compute: true, Storage: true},
			},
			Status: domain.NodeStatus{
				Phase: domain.NodePhaseReady,
				Allocatable: domain.Resources{
					CPUCores:   256,
					MemoryMiB:  500000,
					StorageGiB: 4000,
				},
				Allocated: domain.Resources{
					CPUCores:   0,
					MemoryMiB:  0,
					StorageGiB: 0,
				},
				VMIDs:      []string{},
				SystemInfo: &domain.SystemInfo{
					OS:                "Linux",
					Kernel:            "6.1.0-generic",
					Architecture:      "x86_64",
					HypervisorVersion: "KVM 7.0",
					AgentVersion:      "0.1.0",
				},
			},
			CreatedAt:     now.Add(-48 * time.Hour),
			UpdatedAt:     now.Add(-1 * time.Minute),
			LastHeartbeat: &now,
		},
	}

	for _, n := range demoNodes {
		r.data[n.ID] = n
	}
}
