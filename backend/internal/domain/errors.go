// Package domain contains domain models and business logic errors.
package domain

import "errors"

// Common domain errors
var (
	// ErrNotFound is returned when a requested resource is not found.
	ErrNotFound = errors.New("resource not found")

	// ErrAlreadyExists is returned when trying to create a resource that already exists.
	ErrAlreadyExists = errors.New("resource already exists")

	// ErrInvalidArgument is returned when an invalid argument is provided.
	ErrInvalidArgument = errors.New("invalid argument")

	// ErrPermissionDenied is returned when the user lacks permission for an operation.
	ErrPermissionDenied = errors.New("permission denied")

	// ErrResourceExhausted is returned when resources are not available.
	ErrResourceExhausted = errors.New("resources exhausted")

	// ErrOperationFailed is returned when an operation fails.
	ErrOperationFailed = errors.New("operation failed")

	// ErrConflict is returned when there's a conflict with current state.
	ErrConflict = errors.New("conflict with current state")

	// ErrUnavailable is returned when a service or resource is unavailable.
	ErrUnavailable = errors.New("service unavailable")
)

