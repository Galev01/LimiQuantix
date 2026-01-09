// Package domain contains the core business entities for the Quantix-KVM control plane.
package domain

import (
	"time"
)

// DRSMode defines the automation level for Distributed Resource Scheduler.
type DRSMode string

const (
	// DRSModeManual requires admin approval for all recommendations.
	DRSModeManual DRSMode = "manual"
	// DRSModePartiallyAutomated applies low-impact recommendations automatically.
	DRSModePartiallyAutomated DRSMode = "partially_automated"
	// DRSModeFullyAutomated applies all recommendations automatically.
	DRSModeFullyAutomated DRSMode = "fully_automated"
)

// ClusterStatus represents the health status of a cluster.
type ClusterStatus string

const (
	ClusterStatusHealthy     ClusterStatus = "HEALTHY"
	ClusterStatusWarning     ClusterStatus = "WARNING"
	ClusterStatusCritical    ClusterStatus = "CRITICAL"
	ClusterStatusMaintenance ClusterStatus = "MAINTENANCE"
)

// Cluster represents a logical grouping of hypervisor hosts for HA and DRS.
// Similar to VMware vSphere Cluster.
type Cluster struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	ProjectID   string            `json:"project_id,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`

	// High Availability configuration
	HAEnabled           bool `json:"ha_enabled"`
	HAAdmissionControl  bool `json:"ha_admission_control"`  // Reserve resources for failover
	HAHostMonitoring    bool `json:"ha_host_monitoring"`    // Monitor host health
	HAVMMonitoring      bool `json:"ha_vm_monitoring"`      // Monitor VM health via agent
	HAFailoverCapacity  int  `json:"ha_failover_capacity"`  // Number of host failures to tolerate
	HARestartPriority   int  `json:"ha_restart_priority"`   // Default VM restart priority (1-5)
	HAIsolationResponse int  `json:"ha_isolation_response"` // 0=none, 1=shutdown, 2=power_off

	// Distributed Resource Scheduler configuration
	DRSEnabled              bool    `json:"drs_enabled"`
	DRSMode                 DRSMode `json:"drs_mode"`
	DRSMigrationThreshold   int     `json:"drs_migration_threshold"`   // 1 (aggressive) to 5 (conservative)
	DRSPowerManagement      bool    `json:"drs_power_management"`      // Power off idle hosts
	DRSPredictiveEnabled    bool    `json:"drs_predictive_enabled"`    // Predictive DRS
	DRSVMDistributionPolicy string  `json:"drs_vm_distribution_policy"` // "balanced", "packed"

	// Storage configuration
	SharedStorageRequired bool     `json:"shared_storage_required"` // Require shared storage for HA
	DefaultStoragePoolID  string   `json:"default_storage_pool_id,omitempty"`
	StoragePoolIDs        []string `json:"storage_pool_ids,omitempty"`

	// Network configuration
	DefaultNetworkID string   `json:"default_network_id,omitempty"`
	NetworkIDs       []string `json:"network_ids,omitempty"`

	// Computed status (read-only)
	Status ClusterStatus `json:"status"`

	// Timestamps
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ClusterStats contains aggregated statistics for a cluster.
type ClusterStats struct {
	// Host counts
	TotalHosts       int `json:"total_hosts"`
	OnlineHosts      int `json:"online_hosts"`
	MaintenanceHosts int `json:"maintenance_hosts"`
	OfflineHosts     int `json:"offline_hosts"`

	// VM counts
	TotalVMs   int `json:"total_vms"`
	RunningVMs int `json:"running_vms"`
	StoppedVMs int `json:"stopped_vms"`

	// Resource totals
	CPUTotalGHz       float64 `json:"cpu_total_ghz"`
	CPUUsedGHz        float64 `json:"cpu_used_ghz"`
	MemoryTotalBytes  int64   `json:"memory_total_bytes"`
	MemoryUsedBytes   int64   `json:"memory_used_bytes"`
	StorageTotalBytes int64   `json:"storage_total_bytes"`
	StorageUsedBytes  int64   `json:"storage_used_bytes"`
}

// ClusterWithStats combines a cluster with its computed statistics.
type ClusterWithStats struct {
	Cluster
	Stats ClusterStats `json:"stats"`
}

// ClusterRepository defines the interface for cluster persistence.
type ClusterRepository interface {
	// Create creates a new cluster.
	Create(cluster *Cluster) error
	// Get retrieves a cluster by ID.
	Get(id string) (*Cluster, error)
	// GetByName retrieves a cluster by name.
	GetByName(name string) (*Cluster, error)
	// List returns all clusters, optionally filtered by project.
	List(projectID string) ([]*Cluster, error)
	// Update updates an existing cluster.
	Update(cluster *Cluster) error
	// Delete removes a cluster by ID.
	Delete(id string) error
}
