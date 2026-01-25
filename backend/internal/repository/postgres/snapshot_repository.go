// Package postgres provides PostgreSQL implementations of repositories.
package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/limiquantix/limiquantix/internal/domain"
)

// SnapshotRepository provides database operations for VM snapshots.
type SnapshotRepository struct {
	pool *pgxpool.Pool
}

// NewSnapshotRepository creates a new snapshot repository.
func NewSnapshotRepository(pool *pgxpool.Pool) *SnapshotRepository {
	return &SnapshotRepository{pool: pool}
}

// Create persists a new snapshot to the database.
func (r *SnapshotRepository) Create(ctx context.Context, snap *domain.Snapshot, vmSpec *domain.VMSpec) error {
	if snap.ID == "" {
		return errors.New("snapshot ID is required")
	}
	if snap.VMID == "" {
		return errors.New("VM ID is required")
	}

	// Serialize VM spec at time of snapshot
	var vmStateJSON []byte
	var err error
	if vmSpec != nil {
		vmStateJSON, err = json.Marshal(vmSpec)
		if err != nil {
			return fmt.Errorf("failed to serialize VM spec: %w", err)
		}
	}

	query := `
		INSERT INTO vm_snapshots (id, vm_id, name, description, parent_id, state, size_bytes, vm_state, created_at, created_by)
		VALUES ($1, $2, $3, $4, NULLIF($5, '')::uuid, 'AVAILABLE', $6, $7, $8, $9)
		ON CONFLICT (vm_id, name) DO UPDATE SET
			description = EXCLUDED.description,
			size_bytes = EXCLUDED.size_bytes,
			vm_state = EXCLUDED.vm_state,
			state = 'AVAILABLE'
	`

	createdAt := snap.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now()
	}

	_, err = r.pool.Exec(ctx, query,
		snap.ID,
		snap.VMID,
		snap.Name,
		snap.Description,
		snap.ParentID,
		snap.SizeBytes,
		vmStateJSON,
		createdAt,
		"", // created_by - could be passed in
	)
	if err != nil {
		return fmt.Errorf("failed to insert snapshot: %w", err)
	}

	return nil
}

// Get retrieves a snapshot by ID.
func (r *SnapshotRepository) Get(ctx context.Context, id string) (*domain.Snapshot, error) {
	query := `
		SELECT id, vm_id, name, description, COALESCE(parent_id::text, ''), state, size_bytes, created_at
		FROM vm_snapshots
		WHERE id = $1
	`

	var snap domain.Snapshot
	var state string
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&snap.ID,
		&snap.VMID,
		&snap.Name,
		&snap.Description,
		&snap.ParentID,
		&state,
		&snap.SizeBytes,
		&snap.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to get snapshot: %w", err)
	}

	return &snap, nil
}

// ListByVM returns all snapshots for a VM.
func (r *SnapshotRepository) ListByVM(ctx context.Context, vmID string) ([]*domain.Snapshot, error) {
	query := `
		SELECT id, vm_id, name, description, COALESCE(parent_id::text, ''), state, size_bytes, created_at
		FROM vm_snapshots
		WHERE vm_id = $1
		ORDER BY created_at DESC
	`

	rows, err := r.pool.Query(ctx, query, vmID)
	if err != nil {
		return nil, fmt.Errorf("failed to list snapshots: %w", err)
	}
	defer rows.Close()

	var snapshots []*domain.Snapshot
	for rows.Next() {
		var snap domain.Snapshot
		var state string
		if err := rows.Scan(
			&snap.ID,
			&snap.VMID,
			&snap.Name,
			&snap.Description,
			&snap.ParentID,
			&state,
			&snap.SizeBytes,
			&snap.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan snapshot: %w", err)
		}
		snapshots = append(snapshots, &snap)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating snapshots: %w", err)
	}

	return snapshots, nil
}

// Delete removes a snapshot from the database.
func (r *SnapshotRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM vm_snapshots WHERE id = $1`
	result, err := r.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete snapshot: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	return nil
}

// DeleteByVM removes all snapshots for a VM.
func (r *SnapshotRepository) DeleteByVM(ctx context.Context, vmID string) error {
	query := `DELETE FROM vm_snapshots WHERE vm_id = $1`
	_, err := r.pool.Exec(ctx, query, vmID)
	if err != nil {
		return fmt.Errorf("failed to delete snapshots for VM: %w", err)
	}
	return nil
}

// UpdateState updates the state of a snapshot.
func (r *SnapshotRepository) UpdateState(ctx context.Context, id string, state string) error {
	query := `UPDATE vm_snapshots SET state = $2 WHERE id = $1`
	result, err := r.pool.Exec(ctx, query, id, state)
	if err != nil {
		return fmt.Errorf("failed to update snapshot state: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	return nil
}

// SyncFromHypervisor synchronizes snapshots from the hypervisor to the database.
// This ensures the database reflects the actual state on the hypervisor.
func (r *SnapshotRepository) SyncFromHypervisor(ctx context.Context, vmID string, hypervisorSnapshots []*domain.Snapshot) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Get existing snapshots from DB
	existingQuery := `SELECT id FROM vm_snapshots WHERE vm_id = $1`
	rows, err := tx.Query(ctx, existingQuery, vmID)
	if err != nil {
		return fmt.Errorf("failed to query existing snapshots: %w", err)
	}

	existingIDs := make(map[string]bool)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("failed to scan snapshot ID: %w", err)
		}
		existingIDs[id] = true
	}
	rows.Close()

	// Track which IDs are in hypervisor
	hypervisorIDs := make(map[string]bool)
	for _, snap := range hypervisorSnapshots {
		hypervisorIDs[snap.ID] = true

		// Upsert snapshot
		upsertQuery := `
			INSERT INTO vm_snapshots (id, vm_id, name, description, parent_id, state, size_bytes, created_at)
			VALUES ($1, $2, $3, $4, NULLIF($5, '')::uuid, 'AVAILABLE', $6, $7)
			ON CONFLICT (id) DO UPDATE SET
				name = EXCLUDED.name,
				description = EXCLUDED.description,
				size_bytes = EXCLUDED.size_bytes,
				state = 'AVAILABLE'
		`
		createdAt := snap.CreatedAt
		if createdAt.IsZero() {
			createdAt = time.Now()
		}
		_, err := tx.Exec(ctx, upsertQuery,
			snap.ID,
			snap.VMID,
			snap.Name,
			snap.Description,
			snap.ParentID,
			snap.SizeBytes,
			createdAt,
		)
		if err != nil {
			return fmt.Errorf("failed to upsert snapshot %s: %w", snap.ID, err)
		}
	}

	// Mark snapshots that exist in DB but not on hypervisor as DELETED
	for id := range existingIDs {
		if !hypervisorIDs[id] {
			updateQuery := `UPDATE vm_snapshots SET state = 'DELETED' WHERE id = $1`
			_, err := tx.Exec(ctx, updateQuery, id)
			if err != nil {
				return fmt.Errorf("failed to mark snapshot %s as deleted: %w", id, err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}
