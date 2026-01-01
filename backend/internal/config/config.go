// Package config provides configuration management for the LimiQuantix control plane.
package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config holds all configuration for the application.
type Config struct {
	Server    ServerConfig    `mapstructure:"server"`
	Database  DatabaseConfig  `mapstructure:"database"`
	Etcd      EtcdConfig      `mapstructure:"etcd"`
	Redis     RedisConfig     `mapstructure:"redis"`
	Auth      AuthConfig      `mapstructure:"auth"`
	Scheduler SchedulerConfig `mapstructure:"scheduler"`
	DRS       DRSConfig       `mapstructure:"drs"`
	HA        HAConfig        `mapstructure:"ha"`
	Logging   LoggingConfig   `mapstructure:"logging"`
	CORS      CORSConfig      `mapstructure:"cors"`
}

// ServerConfig holds HTTP server configuration.
type ServerConfig struct {
	Host            string        `mapstructure:"host"`
	Port            int           `mapstructure:"port"`
	ReadTimeout     time.Duration `mapstructure:"read_timeout"`
	WriteTimeout    time.Duration `mapstructure:"write_timeout"`
	ShutdownTimeout time.Duration `mapstructure:"shutdown_timeout"`
}

// Address returns the server address string.
func (c ServerConfig) Address() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

// DatabaseConfig holds PostgreSQL configuration.
type DatabaseConfig struct {
	Host            string        `mapstructure:"host"`
	Port            int           `mapstructure:"port"`
	Name            string        `mapstructure:"name"`
	User            string        `mapstructure:"user"`
	Password        string        `mapstructure:"password"`
	SSLMode         string        `mapstructure:"sslmode"`
	MaxOpenConns    int           `mapstructure:"max_open_conns"`
	MaxIdleConns    int           `mapstructure:"max_idle_conns"`
	ConnMaxLifetime time.Duration `mapstructure:"conn_max_lifetime"`
}

// DSN returns the PostgreSQL connection string.
func (c DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		c.Host, c.Port, c.User, c.Password, c.Name, c.SSLMode,
	)
}

// EtcdConfig holds etcd configuration.
type EtcdConfig struct {
	Endpoints   []string      `mapstructure:"endpoints"`
	DialTimeout time.Duration `mapstructure:"dial_timeout"`
	Username    string        `mapstructure:"username"`
	Password    string        `mapstructure:"password"`
}

// RedisConfig holds Redis configuration.
type RedisConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}

// Address returns the Redis address string.
func (c RedisConfig) Address() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

// AuthConfig holds authentication configuration.
type AuthConfig struct {
	JWTSecret     string        `mapstructure:"jwt_secret"`
	TokenExpiry   time.Duration `mapstructure:"token_expiry"`
	RefreshExpiry time.Duration `mapstructure:"refresh_expiry"`
}

// SchedulerConfig holds VM scheduler configuration.
type SchedulerConfig struct {
	PlacementStrategy string  `mapstructure:"placement_strategy"`
	OvercommitCPU     float64 `mapstructure:"overcommit_cpu"`
	OvercommitMemory  float64 `mapstructure:"overcommit_memory"`
}

// DRSConfig holds Distributed Resource Scheduler configuration.
type DRSConfig struct {
	Enabled         bool          `mapstructure:"enabled"`
	AutomationLevel string        `mapstructure:"automation_level"`
	Interval        time.Duration `mapstructure:"interval"`
	ThresholdCPU    int           `mapstructure:"threshold_cpu"`
	ThresholdMemory int           `mapstructure:"threshold_memory"`
}

// HAConfig holds High Availability configuration.
type HAConfig struct {
	Enabled          bool          `mapstructure:"enabled"`
	CheckInterval    time.Duration `mapstructure:"check_interval"`
	FailureThreshold int           `mapstructure:"failure_threshold"`
}

// LoggingConfig holds logging configuration.
type LoggingConfig struct {
	Level  string `mapstructure:"level"`
	Format string `mapstructure:"format"`
	Output string `mapstructure:"output"`
}

// CORSConfig holds CORS configuration.
type CORSConfig struct {
	AllowedOrigins   []string `mapstructure:"allowed_origins"`
	AllowedMethods   []string `mapstructure:"allowed_methods"`
	AllowedHeaders   []string `mapstructure:"allowed_headers"`
	AllowCredentials bool     `mapstructure:"allow_credentials"`
}

// Load loads configuration from file and environment variables.
func Load(configPath string) (*Config, error) {
	v := viper.New()

	// Set defaults
	setDefaults(v)

	// Config file
	if configPath != "" {
		v.SetConfigFile(configPath)
	} else {
		v.SetConfigName("config")
		v.SetConfigType("yaml")
		v.AddConfigPath("./configs")
		v.AddConfigPath(".")
	}

	// Environment variables
	v.SetEnvPrefix("LIMIQUANTIX")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	// Read config file
	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("failed to read config file: %w", err)
		}
		// Config file not found, use defaults and env vars
	}

	// Unmarshal config
	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return &cfg, nil
}

func setDefaults(v *viper.Viper) {
	// Server
	v.SetDefault("server.host", "0.0.0.0")
	v.SetDefault("server.port", 8080)
	v.SetDefault("server.read_timeout", "30s")
	v.SetDefault("server.write_timeout", "30s")
	v.SetDefault("server.shutdown_timeout", "10s")

	// Database
	v.SetDefault("database.host", "localhost")
	v.SetDefault("database.port", 5432)
	v.SetDefault("database.name", "limiquantix")
	v.SetDefault("database.user", "limiquantix")
	v.SetDefault("database.password", "limiquantix")
	v.SetDefault("database.sslmode", "disable")
	v.SetDefault("database.max_open_conns", 25)
	v.SetDefault("database.max_idle_conns", 5)
	v.SetDefault("database.conn_max_lifetime", "5m")

	// etcd
	v.SetDefault("etcd.endpoints", []string{"localhost:2379"})
	v.SetDefault("etcd.dial_timeout", "5s")

	// Redis
	v.SetDefault("redis.host", "localhost")
	v.SetDefault("redis.port", 6379)
	v.SetDefault("redis.db", 0)

	// Auth
	v.SetDefault("auth.jwt_secret", "change-me-in-production")
	v.SetDefault("auth.token_expiry", "24h")
	v.SetDefault("auth.refresh_expiry", "168h")

	// Scheduler
	v.SetDefault("scheduler.placement_strategy", "spread")
	v.SetDefault("scheduler.overcommit_cpu", 2.0)
	v.SetDefault("scheduler.overcommit_memory", 1.5)

	// DRS
	v.SetDefault("drs.enabled", true)
	v.SetDefault("drs.automation_level", "partial")
	v.SetDefault("drs.interval", "5m")
	v.SetDefault("drs.threshold_cpu", 80)
	v.SetDefault("drs.threshold_memory", 85)

	// HA
	v.SetDefault("ha.enabled", true)
	v.SetDefault("ha.check_interval", "30s")
	v.SetDefault("ha.failure_threshold", 3)

	// Logging
	v.SetDefault("logging.level", "info")
	v.SetDefault("logging.format", "json")
	v.SetDefault("logging.output", "stdout")

	// CORS
	v.SetDefault("cors.allowed_origins", []string{"http://localhost:5173"})
	v.SetDefault("cors.allowed_methods", []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"})
	v.SetDefault("cors.allowed_headers", []string{"*"})
	v.SetDefault("cors.allow_credentials", true)
}

