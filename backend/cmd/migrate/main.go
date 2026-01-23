// Package main provides a CLI tool for running database migrations.
package main

import (
	"database/sql"
	"fmt"
	"os"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/spf13/viper"
	"go.uber.org/zap"
)

func main() {
	logger, _ := zap.NewDevelopment()
	defer logger.Sync()

	if len(os.Args) < 2 {
		logger.Fatal("Usage: migrate <up|down|version|force N>")
	}

	command := os.Args[1]

	// Load configuration
	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.user", "limiquantix")
	viper.SetDefault("database.password", "limiquantix")
	viper.SetDefault("database.name", "limiquantix")
	viper.SetDefault("database.sslmode", "disable")

	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	// Environment variables
	viper.SetEnvPrefix("limiquantix")
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err != nil {
		logger.Debug("No config file found", zap.Error(err))
	}

	// Build connection string
	dsn := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		viper.GetString("database.user"),
		viper.GetString("database.password"),
		viper.GetString("database.host"),
		viper.GetInt("database.port"),
		viper.GetString("database.name"),
		viper.GetString("database.sslmode"),
	)

	// Connect to database
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		logger.Fatal("Failed to connect to database", zap.Error(err))
	}
	defer db.Close()

	// Ping to verify connection
	if err := db.Ping(); err != nil {
		logger.Fatal("Failed to ping database", zap.Error(err))
	}

	logger.Info("Connected to database",
		zap.String("host", viper.GetString("database.host")),
		zap.String("database", viper.GetString("database.name")),
	)

	// Create postgres driver
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		logger.Fatal("Failed to create database driver", zap.Error(err))
	}

	// Use relative path for migrations - simpler and works cross-platform
	migrationsURL := "file://migrations"

	logger.Debug("Migrations path", zap.String("path", migrationsURL))

	// Create migrator
	m, err := migrate.NewWithDatabaseInstance(
		migrationsURL,
		"postgres",
		driver,
	)
	if err != nil {
		logger.Fatal("Failed to create migrator", zap.Error(err))
	}

	// Execute command
	switch command {
	case "up":
		logger.Info("Running migrations up...")
		if err := m.Up(); err != nil && err != migrate.ErrNoChange {
			logger.Fatal("Migration failed", zap.Error(err))
		}
		logger.Info("Migrations completed successfully")

	case "down":
		logger.Info("Rolling back last migration...")
		if err := m.Steps(-1); err != nil && err != migrate.ErrNoChange {
			logger.Fatal("Rollback failed", zap.Error(err))
		}
		logger.Info("Rollback completed successfully")

	case "down-all":
		logger.Info("Rolling back all migrations...")
		if err := m.Down(); err != nil && err != migrate.ErrNoChange {
			logger.Fatal("Rollback failed", zap.Error(err))
		}
		logger.Info("All migrations rolled back successfully")

	case "version":
		version, dirty, err := m.Version()
		if err != nil {
			logger.Fatal("Failed to get version", zap.Error(err))
		}
		logger.Info("Current migration version",
			zap.Uint("version", version),
			zap.Bool("dirty", dirty),
		)

	case "force":
		if len(os.Args) < 3 {
			logger.Fatal("Usage: migrate force <version>")
		}
		var version int
		if _, err := fmt.Sscanf(os.Args[2], "%d", &version); err != nil {
			logger.Fatal("Invalid version number", zap.Error(err))
		}
		logger.Info("Forcing version...", zap.Int("version", version))
		if err := m.Force(version); err != nil {
			logger.Fatal("Force failed", zap.Error(err))
		}
		logger.Info("Version forced successfully")

	default:
		logger.Fatal("Unknown command. Use: up, down, down-all, version, force")
	}
}
