// Package domain provides the core domain models for Quantix-KVM.
package domain

import (
	"time"
)

// FolderType represents the type of objects a folder can contain.
type FolderType string

const (
	// FolderTypeVM is for virtual machine folders.
	FolderTypeVM FolderType = "VM"
	// FolderTypeDatastore is for storage/datastore folders.
	FolderTypeDatastore FolderType = "DATASTORE"
	// FolderTypeNetwork is for network folders.
	FolderTypeNetwork FolderType = "NETWORK"
	// FolderTypeHost is for host folders.
	FolderTypeHost FolderType = "HOST"
)

// Folder represents a hierarchical folder for organizing resources.
// Similar to VMware vSphere folder structure.
type Folder struct {
	// ID is the unique identifier (UUIDv4).
	ID string `json:"id"`

	// Name is the display name of the folder.
	Name string `json:"name"`

	// ParentID is the ID of the parent folder (empty for root folders).
	ParentID string `json:"parent_id,omitempty"`

	// ProjectID is the project/tenant this folder belongs to.
	ProjectID string `json:"project_id"`

	// Type indicates what kind of objects this folder contains.
	Type FolderType `json:"type"`

	// Description is an optional description of the folder.
	Description string `json:"description,omitempty"`

	// Path is the full path from root (e.g., "/Production/Web Servers").
	// Computed field, not stored directly.
	Path string `json:"path,omitempty"`

	// ChildCount is the number of immediate children (folders + objects).
	// Computed field, not stored directly.
	ChildCount int `json:"child_count,omitempty"`

	// Labels for additional metadata.
	Labels map[string]string `json:"labels,omitempty"`

	// Timestamps.
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	CreatedBy string    `json:"created_by,omitempty"`
}

// IsRoot returns true if this is a root folder (no parent).
func (f *Folder) IsRoot() bool {
	return f.ParentID == ""
}

// Validate checks if the folder has valid data.
func (f *Folder) Validate() error {
	if f.Name == "" {
		return ErrInvalidInput
	}
	if f.ProjectID == "" {
		return ErrInvalidInput
	}
	if f.Type == "" {
		return ErrInvalidInput
	}
	return nil
}

// FolderTree represents a folder with its children.
type FolderTree struct {
	Folder   *Folder       `json:"folder"`
	Children []*FolderTree `json:"children,omitempty"`
}

// FolderFilter defines filter criteria for listing folders.
type FolderFilter struct {
	ProjectID string     `json:"project_id,omitempty"`
	ParentID  string     `json:"parent_id,omitempty"`
	Type      FolderType `json:"type,omitempty"`
	Name      string     `json:"name,omitempty"`
}
