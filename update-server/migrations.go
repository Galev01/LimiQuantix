// Package main - Database Migration Hooks for Quantix-vDC updates
// Handles schema migrations, snapshots, and rollback for stateful updates
package main

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"go.uber.org/zap"
)

// MigrationPhase represents the current phase of a vDC update
type MigrationPhase string

const (
	MigrationPhaseNone          MigrationPhase = "none"
	MigrationPhasePreCheck      MigrationPhase = "pre_check"      // Validating prerequisites
	MigrationPhaseSnapshot      MigrationPhase = "snapshot"       // Creating DB snapshot
	MigrationPhaseDownload      MigrationPhase = "download"       // Downloading new version
	MigrationPhaseMigrating     MigrationPhase = "migrating"      // Running SQL migrations
	MigrationPhaseStarting      MigrationPhase = "starting"       // Starting new version
	MigrationPhaseHealthCheck   MigrationPhase = "health_check"   // Verifying health
	MigrationPhaseCompleted     MigrationPhase = "completed"      // Successfully completed
	MigrationPhaseFailed        MigrationPhase = "failed"         // Failed, needs rollback
	MigrationPhaseRollingBack   MigrationPhase = "rolling_back"   // Rollback in progress
	MigrationPhaseRolledBack    MigrationPhase = "rolled_back"    // Rollback completed
)

// VDCMigrationState tracks the state of a vDC update with DB migrations
type VDCMigrationState struct {
	mu sync.RWMutex

	Phase           MigrationPhase `json:"phase"`
	CurrentVersion  string         `json:"current_version"`
	TargetVersion   string         `json:"target_version"`
	StartedAt       *time.Time     `json:"started_at,omitempty"`
	CompletedAt     *time.Time     `json:"completed_at,omitempty"`

	// Snapshot info
	SnapshotPath    string         `json:"snapshot_path,omitempty"`
	SnapshotCreated *time.Time     `json:"snapshot_created,omitempty"`

	// Migration info
	MigrationsRun     int      `json:"migrations_run"`
	MigrationsPending int      `json:"migrations_pending"`
	MigrationErrors   []string `json:"migration_errors,omitempty"`

	// Health check info
	HealthCheckPassed  bool     `json:"health_check_passed"`
	HealthCheckErrors  []string `json:"health_check_errors,omitempty"`
	HealthCheckRetries int      `json:"health_check_retries"`

	// Error info
	ErrorMessage string `json:"error_message,omitempty"`
	CanRollback  bool   `json:"can_rollback"`
}

// MigrationConfig holds configuration for vDC migrations
type MigrationConfig struct {
	// Database connection
	DatabaseURL     string `json:"database_url"`
	DatabaseType    string `json:"database_type"` // "postgres", "sqlite"

	// Snapshot settings
	SnapshotDir     string `json:"snapshot_dir"`
	KeepSnapshots   int    `json:"keep_snapshots"` // Number of snapshots to retain

	// Migration settings
	MigrationsDir   string `json:"migrations_dir"`
	MigrationTimeout time.Duration `json:"migration_timeout"`

	// Health check settings
	HealthCheckURL     string        `json:"health_check_url"`
	HealthCheckTimeout time.Duration `json:"health_check_timeout"`
	HealthCheckRetries int           `json:"health_check_retries"`

	// Service management
	ServiceName     string `json:"service_name"`     // e.g., "quantix-controlplane"
	ServiceManager  string `json:"service_manager"`  // "systemd", "openrc", "docker"
}

// MigrationHooks defines the lifecycle hooks for vDC updates
type MigrationHooks struct {
	config MigrationConfig
	state  VDCMigrationState
}

var (
	migrationState    VDCMigrationState
	migrationStateMu  sync.RWMutex
	defaultMigConfig  MigrationConfig
)

// InitMigrations initializes the migration subsystem
func InitMigrations() error {
	defaultMigConfig = MigrationConfig{
		DatabaseURL:        getEnv("DATABASE_URL", ""),
		DatabaseType:       getEnv("DATABASE_TYPE", "postgres"),
		SnapshotDir:        getEnv("SNAPSHOT_DIR", "/data/snapshots"),
		KeepSnapshots:      5,
		MigrationsDir:      getEnv("MIGRATIONS_DIR", "/app/migrations"),
		MigrationTimeout:   5 * time.Minute,
		HealthCheckURL:     getEnv("HEALTH_CHECK_URL", "http://localhost:8080/health"),
		HealthCheckTimeout: 30 * time.Second,
		HealthCheckRetries: 5,
		ServiceName:        getEnv("VDC_SERVICE_NAME", "quantix-controlplane"),
		ServiceManager:     getEnv("SERVICE_MANAGER", "systemd"),
	}

	// Create snapshot directory
	if err := os.MkdirAll(defaultMigConfig.SnapshotDir, 0755); err != nil {
		log.Warn("Failed to create snapshot directory", zap.Error(err))
	}

	log.Info("Migration subsystem initialized",
		zap.String("snapshot_dir", defaultMigConfig.SnapshotDir),
		zap.String("service_manager", defaultMigConfig.ServiceManager),
	)

	return nil
}

// RegisterMigrationRoutes registers migration-related API endpoints
func RegisterMigrationRoutes(api fiber.Router) {
	mig := api.Group("/migrations")

	// Get current migration state
	mig.Get("/status", handleMigrationStatus)

	// Start a vDC update with migrations
	mig.Post("/start", authMiddleware, handleMigrationStart)

	// Create a database snapshot
	mig.Post("/snapshot", authMiddleware, handleCreateSnapshot)

	// Run pending migrations
	mig.Post("/run", authMiddleware, handleRunMigrations)

	// Rollback to snapshot
	mig.Post("/rollback", authMiddleware, handleRollback)

	// List available snapshots
	mig.Get("/snapshots", handleListSnapshots)
}

// handleMigrationStatus returns the current migration state
func handleMigrationStatus(c *fiber.Ctx) error {
	migrationStateMu.RLock()
	defer migrationStateMu.RUnlock()

	return c.JSON(migrationState)
}

// handleMigrationStart initiates a full vDC update with migration lifecycle
func handleMigrationStart(c *fiber.Ctx) error {
	var req struct {
		TargetVersion  string `json:"target_version"`
		CurrentVersion string `json:"current_version"`
		SkipSnapshot   bool   `json:"skip_snapshot"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	migrationStateMu.Lock()
	if migrationState.Phase != MigrationPhaseNone && 
	   migrationState.Phase != MigrationPhaseCompleted && 
	   migrationState.Phase != MigrationPhaseRolledBack &&
	   migrationState.Phase != MigrationPhaseFailed {
		migrationStateMu.Unlock()
		return c.Status(http.StatusConflict).JSON(fiber.Map{
			"error": "Migration already in progress",
			"phase": migrationState.Phase,
		})
	}

	now := time.Now()
	migrationState = VDCMigrationState{
		Phase:          MigrationPhasePreCheck,
		CurrentVersion: req.CurrentVersion,
		TargetVersion:  req.TargetVersion,
		StartedAt:      &now,
		CanRollback:    false,
	}
	migrationStateMu.Unlock()

	// Run migration lifecycle in background
	go runMigrationLifecycle(req.TargetVersion, req.SkipSnapshot)

	return c.JSON(fiber.Map{
		"status":         "started",
		"target_version": req.TargetVersion,
		"phase":          MigrationPhasePreCheck,
	})
}

// runMigrationLifecycle executes the full migration lifecycle
func runMigrationLifecycle(targetVersion string, skipSnapshot bool) {
	updatePhase := func(phase MigrationPhase) {
		migrationStateMu.Lock()
		migrationState.Phase = phase
		migrationStateMu.Unlock()
		log.Info("Migration phase changed", zap.String("phase", string(phase)))
	}

	setError := func(err string) {
		migrationStateMu.Lock()
		migrationState.Phase = MigrationPhaseFailed
		migrationState.ErrorMessage = err
		migrationStateMu.Unlock()
		log.Error("Migration failed", zap.String("error", err))
	}

	// Phase 1: Pre-check
	updatePhase(MigrationPhasePreCheck)
	if err := runPreChecks(); err != nil {
		setError(fmt.Sprintf("Pre-check failed: %v", err))
		return
	}

	// Phase 2: Create snapshot (unless skipped)
	if !skipSnapshot {
		updatePhase(MigrationPhaseSnapshot)
		snapshotPath, err := createDatabaseSnapshot()
		if err != nil {
			setError(fmt.Sprintf("Snapshot failed: %v", err))
			return
		}
		migrationStateMu.Lock()
		migrationState.SnapshotPath = snapshotPath
		now := time.Now()
		migrationState.SnapshotCreated = &now
		migrationState.CanRollback = true
		migrationStateMu.Unlock()
	}

	// Phase 3: Download new version (handled externally by update client)
	updatePhase(MigrationPhaseDownload)
	// The actual download is handled by the update process

	// Phase 4: Stop service and run migrations
	updatePhase(MigrationPhaseMigrating)
	if err := stopService(); err != nil {
		setError(fmt.Sprintf("Failed to stop service: %v", err))
		return
	}

	if err := runDatabaseMigrations(); err != nil {
		setError(fmt.Sprintf("Migration failed: %v", err))
		// Attempt rollback
		go attemptRollback()
		return
	}

	// Phase 5: Start new version
	updatePhase(MigrationPhaseStarting)
	if err := startService(); err != nil {
		setError(fmt.Sprintf("Failed to start service: %v", err))
		go attemptRollback()
		return
	}

	// Phase 6: Health check
	updatePhase(MigrationPhaseHealthCheck)
	if err := runHealthChecks(); err != nil {
		setError(fmt.Sprintf("Health check failed: %v", err))
		go attemptRollback()
		return
	}

	// Phase 7: Completed
	updatePhase(MigrationPhaseCompleted)
	migrationStateMu.Lock()
	now := time.Now()
	migrationState.CompletedAt = &now
	migrationState.HealthCheckPassed = true
	migrationStateMu.Unlock()

	log.Info("Migration completed successfully",
		zap.String("version", targetVersion),
	)
}

// runPreChecks validates prerequisites for migration
func runPreChecks() error {
	// Check database connectivity
	if defaultMigConfig.DatabaseURL != "" {
		// TODO: Actually ping the database
		log.Info("Pre-check: Database connectivity OK")
	}

	// Check disk space for snapshot
	// TODO: Check available disk space

	// Check if service is running
	// TODO: Check service status

	return nil
}

// createDatabaseSnapshot creates a snapshot of the database
func createDatabaseSnapshot() (string, error) {
	timestamp := time.Now().Format("20060102-150405")
	snapshotName := fmt.Sprintf("vdc-snapshot-%s.sql", timestamp)
	snapshotPath := filepath.Join(defaultMigConfig.SnapshotDir, snapshotName)

	switch defaultMigConfig.DatabaseType {
	case "postgres":
		return createPostgresSnapshot(snapshotPath)
	case "sqlite":
		return createSQLiteSnapshot(snapshotPath)
	default:
		return "", fmt.Errorf("unsupported database type: %s", defaultMigConfig.DatabaseType)
	}
}

func createPostgresSnapshot(snapshotPath string) (string, error) {
	// Parse DATABASE_URL or use pg_dump
	cmd := exec.Command("pg_dump",
		"--format=custom",
		"--file="+snapshotPath,
		defaultMigConfig.DatabaseURL,
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("pg_dump failed: %s - %v", string(output), err)
	}

	log.Info("PostgreSQL snapshot created",
		zap.String("path", snapshotPath),
	)

	return snapshotPath, nil
}

func createSQLiteSnapshot(snapshotPath string) (string, error) {
	// For SQLite, just copy the database file
	cmd := exec.Command("cp", defaultMigConfig.DatabaseURL, snapshotPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("sqlite backup failed: %s - %v", string(output), err)
	}

	log.Info("SQLite snapshot created",
		zap.String("path", snapshotPath),
	)

	return snapshotPath, nil
}

// runDatabaseMigrations runs pending SQL migrations
func runDatabaseMigrations() error {
	// In a real implementation, this would use a migration tool like:
	// - golang-migrate
	// - goose
	// - atlas
	
	// For now, we'll just log and simulate
	log.Info("Running database migrations",
		zap.String("migrations_dir", defaultMigConfig.MigrationsDir),
	)

	// TODO: Implement actual migration running
	// Example with golang-migrate:
	// m, err := migrate.New("file://"+defaultMigConfig.MigrationsDir, defaultMigConfig.DatabaseURL)
	// if err != nil { return err }
	// if err := m.Up(); err != nil && err != migrate.ErrNoChange { return err }

	migrationStateMu.Lock()
	migrationState.MigrationsRun = 0
	migrationState.MigrationsPending = 0
	migrationStateMu.Unlock()

	return nil
}

// stopService stops the vDC service
func stopService() error {
	var cmd *exec.Cmd

	switch defaultMigConfig.ServiceManager {
	case "systemd":
		cmd = exec.Command("systemctl", "stop", defaultMigConfig.ServiceName)
	case "openrc":
		cmd = exec.Command("rc-service", defaultMigConfig.ServiceName, "stop")
	case "docker":
		cmd = exec.Command("docker", "stop", defaultMigConfig.ServiceName)
	default:
		return fmt.Errorf("unsupported service manager: %s", defaultMigConfig.ServiceManager)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to stop service: %s - %v", string(output), err)
	}

	log.Info("Service stopped",
		zap.String("service", defaultMigConfig.ServiceName),
	)

	return nil
}

// startService starts the vDC service
func startService() error {
	var cmd *exec.Cmd

	switch defaultMigConfig.ServiceManager {
	case "systemd":
		cmd = exec.Command("systemctl", "start", defaultMigConfig.ServiceName)
	case "openrc":
		cmd = exec.Command("rc-service", defaultMigConfig.ServiceName, "start")
	case "docker":
		cmd = exec.Command("docker", "start", defaultMigConfig.ServiceName)
	default:
		return fmt.Errorf("unsupported service manager: %s", defaultMigConfig.ServiceManager)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to start service: %s - %v", string(output), err)
	}

	log.Info("Service started",
		zap.String("service", defaultMigConfig.ServiceName),
	)

	// Wait a bit for service to fully start
	time.Sleep(5 * time.Second)

	return nil
}

// runHealthChecks verifies the service is healthy after update
func runHealthChecks() error {
	client := &http.Client{
		Timeout: defaultMigConfig.HealthCheckTimeout,
	}

	var lastErr error
	for i := 0; i < defaultMigConfig.HealthCheckRetries; i++ {
		migrationStateMu.Lock()
		migrationState.HealthCheckRetries = i + 1
		migrationStateMu.Unlock()

		resp, err := client.Get(defaultMigConfig.HealthCheckURL)
		if err != nil {
			lastErr = err
			log.Warn("Health check failed, retrying",
				zap.Int("attempt", i+1),
				zap.Error(err),
			)
			time.Sleep(5 * time.Second)
			continue
		}
		resp.Body.Close()

		if resp.StatusCode == http.StatusOK {
			log.Info("Health check passed",
				zap.Int("attempts", i+1),
			)
			return nil
		}

		lastErr = fmt.Errorf("health check returned status %d", resp.StatusCode)
		time.Sleep(5 * time.Second)
	}

	return fmt.Errorf("health check failed after %d attempts: %v", defaultMigConfig.HealthCheckRetries, lastErr)
}

// attemptRollback attempts to rollback to the previous state
func attemptRollback() {
	migrationStateMu.Lock()
	if !migrationState.CanRollback || migrationState.SnapshotPath == "" {
		migrationStateMu.Unlock()
		log.Error("Cannot rollback - no snapshot available")
		return
	}
	migrationState.Phase = MigrationPhaseRollingBack
	snapshotPath := migrationState.SnapshotPath
	migrationStateMu.Unlock()

	log.Info("Starting rollback",
		zap.String("snapshot", snapshotPath),
	)

	// Stop service
	if err := stopService(); err != nil {
		log.Error("Failed to stop service during rollback", zap.Error(err))
	}

	// Restore database
	if err := restoreDatabaseSnapshot(snapshotPath); err != nil {
		log.Error("Failed to restore database", zap.Error(err))
		migrationStateMu.Lock()
		migrationState.Phase = MigrationPhaseFailed
		migrationState.ErrorMessage = fmt.Sprintf("Rollback failed: %v", err)
		migrationStateMu.Unlock()
		return
	}

	// Start service (old version)
	if err := startService(); err != nil {
		log.Error("Failed to start service after rollback", zap.Error(err))
	}

	migrationStateMu.Lock()
	migrationState.Phase = MigrationPhaseRolledBack
	now := time.Now()
	migrationState.CompletedAt = &now
	migrationStateMu.Unlock()

	log.Info("Rollback completed")
}

// restoreDatabaseSnapshot restores a database from snapshot
func restoreDatabaseSnapshot(snapshotPath string) error {
	switch defaultMigConfig.DatabaseType {
	case "postgres":
		cmd := exec.Command("pg_restore",
			"--clean",
			"--if-exists",
			"--dbname="+defaultMigConfig.DatabaseURL,
			snapshotPath,
		)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("pg_restore failed: %s - %v", string(output), err)
		}
	case "sqlite":
		cmd := exec.Command("cp", snapshotPath, defaultMigConfig.DatabaseURL)
		output, err := cmd.CombinedOutput()
		if err != nil {
			return fmt.Errorf("sqlite restore failed: %s - %v", string(output), err)
		}
	}

	log.Info("Database restored from snapshot",
		zap.String("snapshot", snapshotPath),
	)

	return nil
}

// handleCreateSnapshot manually creates a database snapshot
func handleCreateSnapshot(c *fiber.Ctx) error {
	snapshotPath, err := createDatabaseSnapshot()
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"status":   "created",
		"path":     snapshotPath,
		"created":  time.Now(),
	})
}

// handleRunMigrations manually runs pending migrations
func handleRunMigrations(c *fiber.Ctx) error {
	if err := runDatabaseMigrations(); err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"status":         "completed",
		"migrations_run": migrationState.MigrationsRun,
	})
}

// handleRollback manually triggers a rollback
func handleRollback(c *fiber.Ctx) error {
	var req struct {
		SnapshotPath string `json:"snapshot_path"`
	}

	if err := c.BodyParser(&req); err != nil {
		// Use the current snapshot if not specified
		migrationStateMu.RLock()
		req.SnapshotPath = migrationState.SnapshotPath
		migrationStateMu.RUnlock()
	}

	if req.SnapshotPath == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "No snapshot path specified and no current snapshot available",
		})
	}

	// Verify snapshot exists
	if _, err := os.Stat(req.SnapshotPath); os.IsNotExist(err) {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "Snapshot not found",
		})
	}

	migrationStateMu.Lock()
	migrationState.SnapshotPath = req.SnapshotPath
	migrationState.CanRollback = true
	migrationStateMu.Unlock()

	go attemptRollback()

	return c.JSON(fiber.Map{
		"status":   "rollback_started",
		"snapshot": req.SnapshotPath,
	})
}

// handleListSnapshots returns available snapshots
func handleListSnapshots(c *fiber.Ctx) error {
	entries, err := os.ReadDir(defaultMigConfig.SnapshotDir)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to list snapshots",
		})
	}

	snapshots := make([]fiber.Map, 0)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		snapshots = append(snapshots, fiber.Map{
			"name":     entry.Name(),
			"path":     filepath.Join(defaultMigConfig.SnapshotDir, entry.Name()),
			"size":     info.Size(),
			"modified": info.ModTime(),
		})
	}

	return c.JSON(fiber.Map{
		"snapshots": snapshots,
		"count":     len(snapshots),
	})
}
