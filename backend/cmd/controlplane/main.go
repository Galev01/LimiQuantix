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
	)

	// Create server
	srv := server.New(cfg, logger)

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

	// Run server
	if err := srv.Run(ctx); err != nil {
		logger.Fatal("Server error", zap.Error(err))
	}

	logger.Info("Goodbye!")
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

