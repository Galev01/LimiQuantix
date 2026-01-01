// Package domain contains core business entities for the LimiQuantix platform.
// This file defines user and authentication-related domain models.
package domain

import (
	"time"
)

// =============================================================================
// USER - User account management
// =============================================================================

// Role represents a user's role in the system.
type Role string

const (
	RoleAdmin    Role = "admin"    // Full system access
	RoleOperator Role = "operator" // Can manage VMs, nodes, etc.
	RoleViewer   Role = "viewer"   // Read-only access
)

// User represents a user account in the system.
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"` // Never expose password hash
	Role         Role      `json:"role"`
	Enabled      bool      `json:"enabled"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	LastLogin    *time.Time `json:"last_login,omitempty"`
}

// IsAdmin returns true if the user has admin role.
func (u *User) IsAdmin() bool {
	return u.Role == RoleAdmin
}

// CanManage returns true if the user can manage resources.
func (u *User) CanManage() bool {
	return u.Role == RoleAdmin || u.Role == RoleOperator
}

// CanView returns true if the user can view resources.
func (u *User) CanView() bool {
	return u.Enabled // All enabled users can view
}

// =============================================================================
// PERMISSIONS - Role-based access control
// =============================================================================

// Permission represents a specific action on a resource type.
type Permission string

const (
	// VM permissions
	PermissionVMCreate  Permission = "vm:create"
	PermissionVMRead    Permission = "vm:read"
	PermissionVMUpdate  Permission = "vm:update"
	PermissionVMDelete  Permission = "vm:delete"
	PermissionVMStart   Permission = "vm:start"
	PermissionVMStop    Permission = "vm:stop"
	PermissionVMMigrate Permission = "vm:migrate"

	// Node permissions
	PermissionNodeCreate Permission = "node:create"
	PermissionNodeRead   Permission = "node:read"
	PermissionNodeUpdate Permission = "node:update"
	PermissionNodeDelete Permission = "node:delete"
	PermissionNodeDrain  Permission = "node:drain"

	// Network permissions
	PermissionNetworkCreate Permission = "network:create"
	PermissionNetworkRead   Permission = "network:read"
	PermissionNetworkUpdate Permission = "network:update"
	PermissionNetworkDelete Permission = "network:delete"

	// Storage permissions
	PermissionStorageCreate Permission = "storage:create"
	PermissionStorageRead   Permission = "storage:read"
	PermissionStorageUpdate Permission = "storage:update"
	PermissionStorageDelete Permission = "storage:delete"

	// User permissions
	PermissionUserCreate Permission = "user:create"
	PermissionUserRead   Permission = "user:read"
	PermissionUserUpdate Permission = "user:update"
	PermissionUserDelete Permission = "user:delete"

	// System permissions
	PermissionSystemConfig Permission = "system:config"
	PermissionSystemAudit  Permission = "system:audit"
)

// RolePermissions defines which permissions each role has.
var RolePermissions = map[Role][]Permission{
	RoleAdmin: {
		// VMs
		PermissionVMCreate, PermissionVMRead, PermissionVMUpdate, PermissionVMDelete,
		PermissionVMStart, PermissionVMStop, PermissionVMMigrate,
		// Nodes
		PermissionNodeCreate, PermissionNodeRead, PermissionNodeUpdate, PermissionNodeDelete, PermissionNodeDrain,
		// Network
		PermissionNetworkCreate, PermissionNetworkRead, PermissionNetworkUpdate, PermissionNetworkDelete,
		// Storage
		PermissionStorageCreate, PermissionStorageRead, PermissionStorageUpdate, PermissionStorageDelete,
		// Users
		PermissionUserCreate, PermissionUserRead, PermissionUserUpdate, PermissionUserDelete,
		// System
		PermissionSystemConfig, PermissionSystemAudit,
	},
	RoleOperator: {
		// VMs
		PermissionVMCreate, PermissionVMRead, PermissionVMUpdate, PermissionVMDelete,
		PermissionVMStart, PermissionVMStop, PermissionVMMigrate,
		// Nodes
		PermissionNodeRead, PermissionNodeDrain,
		// Network
		PermissionNetworkCreate, PermissionNetworkRead, PermissionNetworkUpdate,
		// Storage
		PermissionStorageCreate, PermissionStorageRead, PermissionStorageUpdate,
		// Users
		PermissionUserRead,
	},
	RoleViewer: {
		PermissionVMRead,
		PermissionNodeRead,
		PermissionNetworkRead,
		PermissionStorageRead,
	},
}

// HasPermission checks if a role has a specific permission.
func HasPermission(role Role, permission Permission) bool {
	perms, ok := RolePermissions[role]
	if !ok {
		return false
	}
	for _, p := range perms {
		if p == permission {
			return true
		}
	}
	return false
}

// =============================================================================
// AUDIT LOG - Track user actions
// =============================================================================

// AuditAction represents an auditable action.
type AuditAction string

const (
	AuditActionLogin      AuditAction = "LOGIN"
	AuditActionLogout     AuditAction = "LOGOUT"
	AuditActionCreate     AuditAction = "CREATE"
	AuditActionUpdate     AuditAction = "UPDATE"
	AuditActionDelete     AuditAction = "DELETE"
	AuditActionStart      AuditAction = "START"
	AuditActionStop       AuditAction = "STOP"
	AuditActionMigrate    AuditAction = "MIGRATE"
	AuditActionSnapshot   AuditAction = "SNAPSHOT"
	AuditActionRestore    AuditAction = "RESTORE"
	AuditActionConfigChange AuditAction = "CONFIG_CHANGE"
)

// AuditEntry represents a single audit log entry.
type AuditEntry struct {
	ID           string            `json:"id"`
	UserID       string            `json:"user_id"`
	Username     string            `json:"username"`
	Action       AuditAction       `json:"action"`
	ResourceType string            `json:"resource_type"` // vm, node, network, etc.
	ResourceID   string            `json:"resource_id"`
	ResourceName string            `json:"resource_name"`
	Details      map[string]interface{} `json:"details,omitempty"`
	IPAddress    string            `json:"ip_address"`
	UserAgent    string            `json:"user_agent"`
	CreatedAt    time.Time         `json:"created_at"`
}

// =============================================================================
// ALERTS - System alerts and notifications
// =============================================================================

// AlertSeverity represents the severity of an alert.
type AlertSeverity string

const (
	AlertSeverityCritical AlertSeverity = "CRITICAL"
	AlertSeverityWarning  AlertSeverity = "WARNING"
	AlertSeverityInfo     AlertSeverity = "INFO"
)

// AlertSourceType represents the source of an alert.
type AlertSourceType string

const (
	AlertSourceVM      AlertSourceType = "VM"
	AlertSourceNode    AlertSourceType = "HOST"
	AlertSourceStorage AlertSourceType = "STORAGE"
	AlertSourceNetwork AlertSourceType = "NETWORK"
	AlertSourceCluster AlertSourceType = "CLUSTER"
	AlertSourceSystem  AlertSourceType = "SYSTEM"
)

// Alert represents a system alert.
type Alert struct {
	ID             string          `json:"id"`
	Severity       AlertSeverity   `json:"severity"`
	Title          string          `json:"title"`
	Message        string          `json:"message"`
	SourceType     AlertSourceType `json:"source_type"`
	SourceID       string          `json:"source_id"`
	SourceName     string          `json:"source_name"`
	Acknowledged   bool            `json:"acknowledged"`
	AcknowledgedBy string          `json:"acknowledged_by,omitempty"`
	AcknowledgedAt *time.Time      `json:"acknowledged_at,omitempty"`
	Resolved       bool            `json:"resolved"`
	ResolvedAt     *time.Time      `json:"resolved_at,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
}

// =============================================================================
// DRS RECOMMENDATIONS
// =============================================================================

// DRSPriority represents the priority of a DRS recommendation.
type DRSPriority string

const (
	DRSPriorityCritical DRSPriority = "CRITICAL"
	DRSPriorityHigh     DRSPriority = "HIGH"
	DRSPriorityMedium   DRSPriority = "MEDIUM"
	DRSPriorityLow      DRSPriority = "LOW"
)

// DRSRecommendationType represents the type of DRS recommendation.
type DRSRecommendationType string

const (
	DRSTypeMigrate  DRSRecommendationType = "MIGRATE"
	DRSTypePowerOn  DRSRecommendationType = "POWER_ON"
	DRSTypePowerOff DRSRecommendationType = "POWER_OFF"
)

// DRSStatus represents the status of a DRS recommendation.
type DRSStatus string

const (
	DRSStatusPending  DRSStatus = "PENDING"
	DRSStatusApproved DRSStatus = "APPROVED"
	DRSStatusApplied  DRSStatus = "APPLIED"
	DRSStatusRejected DRSStatus = "REJECTED"
)

// DRSRecommendation represents a DRS migration recommendation.
type DRSRecommendation struct {
	ID                string                `json:"id"`
	ClusterID         string                `json:"cluster_id"`
	Priority          DRSPriority           `json:"priority"`
	RecommendationType DRSRecommendationType `json:"recommendation_type"`
	Reason            string                `json:"reason"`
	VMID              string                `json:"vm_id"`
	VMName            string                `json:"vm_name"`
	SourceNodeID      string                `json:"source_node_id"`
	SourceNodeName    string                `json:"source_node_name"`
	TargetNodeID      string                `json:"target_node_id"`
	TargetNodeName    string                `json:"target_node_name"`
	ImpactCPU         int32                 `json:"impact_cpu"`         // Improvement percentage
	ImpactMemory      int32                 `json:"impact_memory"`      // Improvement percentage
	EstimatedDuration string                `json:"estimated_duration"` // e.g., "2m30s"
	Status            DRSStatus             `json:"status"`
	CreatedAt         time.Time             `json:"created_at"`
	AppliedAt         *time.Time            `json:"applied_at,omitempty"`
	AppliedBy         string                `json:"applied_by,omitempty"`
}
