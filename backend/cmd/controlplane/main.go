// Package main is the entry point for the LimiQuantix control plane.
package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"syscall"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/limiquantix/limiquantix/internal/config"
	"github.com/limiquantix/limiquantix/internal/repository/etcd"
	"github.com/limiquantix/limiquantix/internal/repository/postgres"
	"github.com/limiquantix/limiquantix/internal/repository/redis"
	"github.com/limiquantix/limiquantix/internal/server"
)

var (
	version   = "dev"
	commit    = "unknown"
	buildDate = "unknown"
)

func main() {
	// Parse command line flags
	configPath := flag.String("config", "", "Path to config file")
	showVersion := flag.Bool("version", false, "Show version information")
	devMode := flag.Bool("dev", false, "Run in development mode (in-memory only)")
	flag.Parse()

	if *showVersion {
		println("LimiQuantix Control Plane")
		println("Version:", version)
		println("Commit:", commit)
		println("Build Date:", buildDate)
		os.Exit(0)
	}

	// Load configuration
	cfg, err := config.Load(*configPath)
	if err != nil {
		println("Failed to load config:", err.Error())
		os.Exit(1)
	}

	// Setup logger
	logger := setupLogger(cfg.Logging)
	defer logger.Sync()

	logger.Info("Starting LimiQuantix Control Plane",
		zap.String("version", version),
		zap.String("commit", commit),
		zap.Bool("dev_mode", *devMode),
	)

	// Setup signal handling
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		logger.Info("Received signal", zap.String("signal", sig.String()))
		cancel()
	}()

	// Build server options based on configuration
	var opts []server.ServerOption

	if !*devMode {
		// Connect to PostgreSQL
		db, err := connectPostgres(ctx, cfg.Database, logger)
		if err != nil {
			logger.Warn("PostgreSQL connection failed, falling back to in-memory",
				zap.Error(err),
			)
		} else {
			opts = append(opts, server.WithPostgreSQL(db))
		}

		// Connect to Redis
		cache, err := connectRedis(cfg.Redis, logger)
		if err != nil {
			logger.Warn("Redis connection failed, caching disabled",
				zap.Error(err),
			)
		} else {
			opts = append(opts, server.WithRedis(cache))
		}

		// Connect to etcd
		etcdClient, err := connectEtcd(cfg.Etcd, logger)
		if err != nil {
			logger.Warn("etcd connection failed, distributed features disabled",
				zap.Error(err),
			)
		} else {
			opts = append(opts, server.WithEtcd(etcdClient))
		}
	} else {
		logger.Info("Running in development mode (in-memory repositories)")
	}

	// Create and run server
	srv := server.New(cfg, logger, opts...)

	if err := srv.Run(ctx); err != nil {
		logger.Fatal("Server error", zap.Error(err))
	}

	logger.Info("Goodbye!")
}

// connectPostgres establishes a PostgreSQL connection.
func connectPostgres(ctx context.Context, cfg config.DatabaseConfig, logger *zap.Logger) (*postgres.DB, error) {
	logger.Info("Connecting to PostgreSQL",
		zap.String("host", cfg.Host),
		zap.Int("port", cfg.Port),
		zap.String("database", cfg.Name),
	)

	db, err := postgres.NewDB(ctx, cfg, logger)
	if err != nil {
		return nil, err
	}

	return db, nil
}

// connectRedis establishes a Redis connection.
func connectRedis(cfg config.RedisConfig, logger *zap.Logger) (*redis.Cache, error) {
	logger.Info("Connecting to Redis",
		zap.String("host", cfg.Host),
		zap.Int("port", cfg.Port),
	)

	cache, err := redis.NewCache(cfg, logger)
	if err != nil {
		return nil, err
	}

	return cache, nil
}

// connectEtcd establishes an etcd connection.
func connectEtcd(cfg config.EtcdConfig, logger *zap.Logger) (*etcd.Client, error) {
	logger.Info("Connecting to etcd",
		zap.Strings("endpoints", cfg.Endpoints),
	)

	client, err := etcd.NewClient(cfg, logger)
	if err != nil {
		return nil, err
	}

	return client, nil
}

// setupLogger configures the zap logger based on configuration.
func setupLogger(cfg config.LoggingConfig) *zap.Logger {
	var level zapcore.Level
	switch cfg.Level {
	case "debug":
		level = zapcore.DebugLevel
	case "info":
		level = zapcore.InfoLevel
	case "warn":
		level = zapcore.WarnLevel
	case "error":
		level = zapcore.ErrorLevel
	default:
		level = zapcore.InfoLevel
	}

	var zapConfig zap.Config
	if cfg.Format == "console" {
		zapConfig = zap.NewDevelopmentConfig()
	} else {
		zapConfig = zap.NewProductionConfig()
	}

	zapConfig.Level = zap.NewAtomicLevelAt(level)

	logger, err := zapConfig.Build()
	if err != nil {
		panic("Failed to create logger: " + err.Error())
	}

	return logger
}
