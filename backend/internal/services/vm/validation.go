// Package vm provides the virtual machine service for the control plane.
package vm

import (
	"fmt"
	"regexp"

	computev1 "github.com/Quantixkvm/Quantixkvm/pkg/api/Quantixkvm/compute/v1"
)

// Validation constants
const (
	MaxNameLength        = 255
	MaxDescriptionLength = 1000
	MaxLabels            = 50
	MaxLabelKeyLength    = 63
	MaxLabelValueLength  = 255
	MinCPUCores          = 1
	MaxCPUCores          = 256
	MinMemoryMiB         = 256
	MaxMemoryMiB         = 1048576 // 1 TiB
	MinDiskSizeGiB       = 1
	MaxDiskSizeGiB       = 65536 // 64 TiB
)

// ValidNameRegex validates VM names (alphanumeric, hyphens, underscores).
var ValidNameRegex = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]*$`)

// ValidationError represents a validation error with field context.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

// validateCreateRequest validates a CreateVMRequest.
func validateCreateRequest(req *computev1.CreateVMRequest) error {
	if req == nil {
		return &ValidationError{Field: "request", Message: "request cannot be nil"}
	}

	// Name validation
	if req.Name == "" {
		return &ValidationError{Field: "name", Message: "name is required"}
	}
	if len(req.Name) > MaxNameLength {
		return &ValidationError{Field: "name", Message: fmt.Sprintf("name too long (max %d characters)", MaxNameLength)}
	}
	if !ValidNameRegex.MatchString(req.Name) {
		return &ValidationError{Field: "name", Message: "name must start with a letter and contain only alphanumeric characters, hyphens, and underscores"}
	}

	// Spec validation
	if req.Spec == nil {
		return &ValidationError{Field: "spec", Message: "spec is required"}
	}

	// CPU validation
	if req.Spec.Cpu == nil {
		return &ValidationError{Field: "spec.cpu", Message: "CPU configuration is required"}
	}
	if req.Spec.Cpu.Cores < MinCPUCores {
		return &ValidationError{Field: "spec.cpu.cores", Message: fmt.Sprintf("at least %d CPU core is required", MinCPUCores)}
	}
	if req.Spec.Cpu.Cores > MaxCPUCores {
		return &ValidationError{Field: "spec.cpu.cores", Message: fmt.Sprintf("maximum %d CPU cores allowed", MaxCPUCores)}
	}

	// Memory validation
	if req.Spec.Memory == nil {
		return &ValidationError{Field: "spec.memory", Message: "memory configuration is required"}
	}
	if req.Spec.Memory.SizeMib < MinMemoryMiB {
		return &ValidationError{Field: "spec.memory.size_mib", Message: fmt.Sprintf("at least %d MiB memory is required", MinMemoryMiB)}
	}
	if req.Spec.Memory.SizeMib > MaxMemoryMiB {
		return &ValidationError{Field: "spec.memory.size_mib", Message: fmt.Sprintf("maximum %d MiB memory allowed", MaxMemoryMiB)}
	}

	// Labels validation
	if len(req.Labels) > MaxLabels {
		return &ValidationError{Field: "labels", Message: fmt.Sprintf("maximum %d labels allowed", MaxLabels)}
	}
	for key, value := range req.Labels {
		if len(key) > MaxLabelKeyLength {
			return &ValidationError{Field: "labels", Message: fmt.Sprintf("label key '%s' too long (max %d characters)", key, MaxLabelKeyLength)}
		}
		if len(value) > MaxLabelValueLength {
			return &ValidationError{Field: "labels", Message: fmt.Sprintf("label value for '%s' too long (max %d characters)", key, MaxLabelValueLength)}
		}
	}

	// Description validation
	if len(req.Description) > MaxDescriptionLength {
		return &ValidationError{Field: "description", Message: fmt.Sprintf("description too long (max %d characters)", MaxDescriptionLength)}
	}

	// Disks validation
	for i, disk := range req.Spec.Disks {
		if disk.SizeGib < MinDiskSizeGiB {
			return &ValidationError{Field: fmt.Sprintf("spec.disks[%d].size_gib", i), Message: fmt.Sprintf("minimum disk size is %d GiB", MinDiskSizeGiB)}
		}
		if disk.SizeGib > MaxDiskSizeGiB {
			return &ValidationError{Field: fmt.Sprintf("spec.disks[%d].size_gib", i), Message: fmt.Sprintf("maximum disk size is %d GiB", MaxDiskSizeGiB)}
		}
	}

	return nil
}

// validateUpdateRequest validates an UpdateVMRequest.
func validateUpdateRequest(req *computev1.UpdateVMRequest) error {
	if req == nil {
		return &ValidationError{Field: "request", Message: "request cannot be nil"}
	}

	if req.Id == "" {
		return &ValidationError{Field: "id", Message: "VM ID is required"}
	}

	// If spec is provided, validate it
	if req.Spec != nil {
		if req.Spec.Cpu != nil {
			if req.Spec.Cpu.Cores < MinCPUCores || req.Spec.Cpu.Cores > MaxCPUCores {
				return &ValidationError{Field: "spec.cpu.cores", Message: fmt.Sprintf("CPU cores must be between %d and %d", MinCPUCores, MaxCPUCores)}
			}
		}

		if req.Spec.Memory != nil {
			if req.Spec.Memory.SizeMib < MinMemoryMiB || req.Spec.Memory.SizeMib > MaxMemoryMiB {
				return &ValidationError{Field: "spec.memory.size_mib", Message: fmt.Sprintf("memory must be between %d and %d MiB", MinMemoryMiB, MaxMemoryMiB)}
			}
		}
	}

	// Labels validation
	if len(req.Labels) > MaxLabels {
		return &ValidationError{Field: "labels", Message: fmt.Sprintf("maximum %d labels allowed", MaxLabels)}
	}

	return nil
}

// validateStartRequest validates a StartVMRequest.
func validateStartRequest(req *computev1.StartVMRequest) error {
	if req == nil {
		return &ValidationError{Field: "request", Message: "request cannot be nil"}
	}
	if req.Id == "" {
		return &ValidationError{Field: "id", Message: "VM ID is required"}
	}
	return nil
}

// validateStopRequest validates a StopVMRequest.
func validateStopRequest(req *computev1.StopVMRequest) error {
	if req == nil {
		return &ValidationError{Field: "request", Message: "request cannot be nil"}
	}
	if req.Id == "" {
		return &ValidationError{Field: "id", Message: "VM ID is required"}
	}
	return nil
}
