// Package server provides the HTTP/Connect-RPC server for the control plane.
package server

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/rs/cors"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/config"
	"github.com/limiquantix/limiquantix/internal/repository/etcd"
	"github.com/limiquantix/limiquantix/internal/repository/memory"
	"github.com/limiquantix/limiquantix/internal/repository/postgres"
	"github.com/limiquantix/limiquantix/internal/repository/redis"
	"github.com/limiquantix/limiquantix/internal/scheduler"
	"github.com/limiquantix/limiquantix/internal/services/admin"
	networkservice "github.com/limiquantix/limiquantix/internal/services/network"
	"github.com/limiquantix/limiquantix/internal/services/node"
	nodeservice "github.com/limiquantix/limiquantix/internal/services/node"
	"github.com/limiquantix/limiquantix/internal/services/registration"
	storageservice "github.com/limiquantix/limiquantix/internal/services/storage"
	"github.com/limiquantix/limiquantix/internal/services/vm"
	vmservice "github.com/limiquantix/limiquantix/internal/services/vm"
	"github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1/computev1connect"
	"github.com/limiquantix/limiquantix/pkg/api/limiquantix/network/v1/networkv1connect"
	"github.com/limiquantix/limiquantix/pkg/api/limiquantix/storage/v1/storagev1connect"
)

// Server represents the main HTTP server.
type Server struct {
	config     *config.Config
	logger     *zap.Logger
	httpServer *http.Server
	mux        *http.ServeMux

	// Infrastructure
	db    *postgres.DB
	cache *redis.Cache
	etcd  *etcd.Client

	// Repository interfaces (abstracted for swappable backends)
	vmRepo   vm.Repository
	nodeRepo node.Repository

	// Memory-only repositories (no PostgreSQL equivalent yet)
	storagePoolRepo       *memory.StoragePoolRepository
	volumeRepo            *memory.VolumeRepository
	imageRepo             *storageservice.MemoryImageRepository
	networkRepo           *memory.NetworkRepository
	securityGroupRepo     *memory.SecurityGroupRepository
	registrationTokenRepo *memory.RegistrationTokenRepository

	// Admin repositories (PostgreSQL)
	roleRepo   *postgres.RoleRepository
	apiKeyRepo *postgres.APIKeyRepository
	auditRepo  *postgres.AuditRepository
	orgRepo    *postgres.OrganizationRepository
	emailRepo  *postgres.AdminEmailRepository
	ruleRepo   *postgres.GlobalRuleRepository

	// Scheduler
	scheduler *scheduler.Scheduler

	// Node Daemon connection pool
	daemonPool *node.DaemonPool

	// Services
	vmService            *vmservice.Service
	nodeService          *nodeservice.Service
	networkService       *networkservice.NetworkService
	securityGroupService *networkservice.SecurityGroupService
	imageService         *storageservice.ImageService
	ovaService           *storageservice.OVAService

	// Registration service
	registrationService *registration.Service
	registrationHandler *RegistrationHandler

	// Admin services
	adminHandler *AdminHandler

	// Leader election (for HA)
	leader *etcd.Leader
}

// ServerOption configures the server.
type ServerOption func(*Server)

// WithPostgreSQL enables PostgreSQL as the data store.
func WithPostgreSQL(db *postgres.DB) ServerOption {
	return func(s *Server) {
		s.db = db
	}
}

// WithRedis enables Redis caching.
func WithRedis(cache *redis.Cache) ServerOption {
	return func(s *Server) {
		s.cache = cache
	}
}

// WithEtcd enables etcd for distributed coordination.
func WithEtcd(client *etcd.Client) ServerOption {
	return func(s *Server) {
		s.etcd = client
	}
}

// New creates a new server instance.
func New(cfg *config.Config, logger *zap.Logger, opts ...ServerOption) *Server {
	mux := http.NewServeMux()

	s := &Server{
		config: cfg,
		logger: logger,
		mux:    mux,
	}

	// Apply options
	for _, opt := range opts {
		opt(s)
	}

	// Initialize repositories
	s.initRepositories()

	// Initialize services
	s.initServices()

	// Register routes
	s.registerRoutes()

	// Create HTTP server
	handler := s.setupMiddleware(mux)
	s.httpServer = &http.Server{
		Addr:         cfg.Server.Address(),
		Handler:      handler,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	return s
}

// initRepositories initializes data repositories.
func (s *Server) initRepositories() {
	if s.db != nil {
		// Use PostgreSQL repositories
		s.logger.Info("Initializing PostgreSQL repositories")
		s.vmRepo = postgres.NewVMRepository(s.db, s.logger)
		s.nodeRepo = postgres.NewNodeRepository(s.db, s.logger)

		// Initialize admin repositories (PostgreSQL only)
		s.roleRepo = postgres.NewRoleRepository(s.db, s.logger)
		s.apiKeyRepo = postgres.NewAPIKeyRepository(s.db, s.logger)
		s.auditRepo = postgres.NewAuditRepository(s.db, s.logger)
		s.orgRepo = postgres.NewOrganizationRepository(s.db, s.logger)
		s.emailRepo = postgres.NewAdminEmailRepository(s.db, s.logger)
		s.ruleRepo = postgres.NewGlobalRuleRepository(s.db, s.logger)
		s.logger.Info("Admin repositories initialized (PostgreSQL)")
	} else {
		// Use in-memory repositories (development mode)
		s.logger.Info("Initializing in-memory repositories")
		s.vmRepo = memory.NewVMRepository()
		s.nodeRepo = memory.NewNodeRepository()

		// Admin repositories require PostgreSQL - log warning
		s.logger.Warn("Admin panel requires PostgreSQL - admin features disabled in development mode")
	}

	// These remain in-memory for now (PostgreSQL implementations can be added later)
	s.storagePoolRepo = memory.NewStoragePoolRepository()
	s.volumeRepo = memory.NewVolumeRepository()
	s.imageRepo = storageservice.NewMemoryImageRepository()
	s.networkRepo = memory.NewNetworkRepository()
	s.securityGroupRepo = memory.NewSecurityGroupRepository()
	s.registrationTokenRepo = memory.NewRegistrationTokenRepository()

	s.logger.Info("Repositories initialized",
		zap.Bool("postgres", s.db != nil),
		zap.Bool("redis", s.cache != nil),
		zap.Bool("etcd", s.etcd != nil),
	)
}

// initServices initializes business logic services.
func (s *Server) initServices() {
	s.logger.Info("Initializing services")

	// Initialize scheduler
	schedulerConfig := scheduler.DefaultConfig()
	if s.config.Scheduler.PlacementStrategy != "" {
		schedulerConfig.PlacementStrategy = s.config.Scheduler.PlacementStrategy
	}
	if s.config.Scheduler.OvercommitCPU > 0 {
		schedulerConfig.OvercommitCPU = s.config.Scheduler.OvercommitCPU
	}
	if s.config.Scheduler.OvercommitMemory > 0 {
		schedulerConfig.OvercommitMemory = s.config.Scheduler.OvercommitMemory
	}

	// Create scheduler with repository adapters
	s.scheduler = scheduler.New(
		s.nodeRepo.(scheduler.NodeRepository),
		s.vmRepo.(scheduler.VMRepository),
		schedulerConfig,
		s.logger,
	)

	// Initialize Node Daemon connection pool
	s.daemonPool = node.NewDaemonPool(s.logger)
	s.logger.Info("Node Daemon connection pool initialized")

	// Compute services with Node Daemon integration
	s.vmService = vmservice.NewServiceWithDaemon(
		s.vmRepo,
		s.nodeRepo,
		s.daemonPool,
		s.scheduler,
		s.logger,
	)
	s.nodeService = nodeservice.NewServiceWithVMRepo(s.nodeRepo, s.vmRepo, s.logger)

	// Network services
	s.networkService = networkservice.NewNetworkService(s.networkRepo, s.logger)
	s.securityGroupService = networkservice.NewSecurityGroupService(s.securityGroupRepo, s.logger)

	// Storage services
	s.imageService = storageservice.NewImageService(s.imageRepo, s.logger)
	s.ovaService = storageservice.NewOVAService(s.imageRepo, s.logger)

	// Registration token service (always available)
	s.registrationService = registration.NewService(s.registrationTokenRepo, s.logger)
	s.registrationHandler = NewRegistrationHandler(s.registrationService, s.logger)

	// Initialize admin services if PostgreSQL is available
	if s.db != nil && s.roleRepo != nil {
		roleService := admin.NewRoleService(s.roleRepo, s.logger)
		apiKeyService := admin.NewAPIKeyService(s.apiKeyRepo, 10, s.logger)
		auditService := admin.NewAuditService(s.auditRepo, 90, s.logger)
		orgService := admin.NewOrganizationService(s.orgRepo, s.logger)
		emailService := admin.NewAdminEmailService(s.emailRepo, nil, s.logger) // nil email sender for now
		ruleService := admin.NewGlobalRuleService(s.ruleRepo, s.logger)

		s.adminHandler = NewAdminHandler(
			roleService,
			apiKeyService,
			auditService,
			orgService,
			emailService,
			ruleService,
			s.logger,
		)
		s.logger.Info("Admin services initialized")
	}

	s.logger.Info("Services initialized",
		zap.String("scheduler_strategy", schedulerConfig.PlacementStrategy),
		zap.Float64("cpu_overcommit", schedulerConfig.OvercommitCPU),
		zap.Float64("memory_overcommit", schedulerConfig.OvercommitMemory),
	)
}

// registerRoutes registers all HTTP routes and Connect-RPC services.
func (s *Server) registerRoutes() {
	// Health endpoints
	s.mux.HandleFunc("/health", s.healthHandler)
	s.mux.HandleFunc("/healthz", s.healthHandler) // Kubernetes-style endpoint
	s.mux.HandleFunc("/ready", s.readyHandler)
	s.mux.HandleFunc("/live", s.liveHandler)

	// API info
	s.mux.HandleFunc("/api/v1/info", s.infoHandler)

	// Console WebSocket endpoint
	consoleHandler := NewConsoleHandler(s)
	s.mux.Handle("/api/console/", consoleHandler)
	s.logger.Info("Registered console WebSocket handler", zap.String("path", "/api/console/{vmId}/ws"))

	// Agent download endpoint (for cloud-init auto-install)
	agentHandler := NewAgentDownloadHandler(s.logger)
	s.mux.Handle("/api/agent/", agentHandler)
	s.logger.Info("Registered agent download handler", zap.String("path", "/api/agent/"))

	// =========================================================================
	// REST API Endpoints (for simple frontend consumption)
	// =========================================================================

	// VM REST API (power actions + file transfer)
	// Routes:
	//   - POST /api/vms/{id}/{action} - Power actions (start, stop, reboot, force_stop)
	//   - /api/vms/{id}/files/* - File transfer operations (write, read, list, stat, delete)
	vmRestHandler := NewVMRestHandler(s)
	s.mux.Handle("/api/vms/", vmRestHandler)
	s.logger.Info("Registered VM REST API", zap.String("path", "/api/vms/{id}/*"))

	// =========================================================================
	// Connect-RPC Services - Compute
	// =========================================================================

	// VM Service
	vmPath, vmHandler := computev1connect.NewVMServiceHandler(s.vmService)
	s.mux.Handle(vmPath, vmHandler)
	s.logger.Info("Registered VM service", zap.String("path", vmPath))

	// Node Service
	nodePath, nodeHandler := computev1connect.NewNodeServiceHandler(s.nodeService)
	s.mux.Handle(nodePath, nodeHandler)
	s.logger.Info("Registered Node service", zap.String("path", nodePath))

	// =========================================================================
	// Connect-RPC Services - Network
	// =========================================================================

	// VirtualNetwork Service
	networkPath, networkHandler := networkv1connect.NewVirtualNetworkServiceHandler(s.networkService)
	s.mux.Handle(networkPath, networkHandler)
	s.logger.Info("Registered VirtualNetwork service", zap.String("path", networkPath))

	// SecurityGroup Service
	sgPath, sgHandler := networkv1connect.NewSecurityGroupServiceHandler(s.securityGroupService)
	s.mux.Handle(sgPath, sgHandler)
	s.logger.Info("Registered SecurityGroup service", zap.String("path", sgPath))

	// =========================================================================
	// Connect-RPC Services - Storage
	// =========================================================================

	// Image Service
	imagePath, imageHandler := storagev1connect.NewImageServiceHandler(s.imageService)
	s.mux.Handle(imagePath, imageHandler)
	s.logger.Info("Registered Image service", zap.String("path", imagePath))

	// OVA Service (Connect-RPC)
	ovaPath, ovaHandler := storagev1connect.NewOVAServiceHandler(s.ovaService)
	s.mux.Handle(ovaPath, ovaHandler)
	s.logger.Info("Registered OVA service", zap.String("path", ovaPath))

	// OVA Upload Handler (HTTP multipart - Connect-RPC doesn't support file uploads)
	ovaUploadHandler := NewOVAUploadHandler(s.ovaService, s.logger)
	ovaUploadHandler.RegisterRoutes(s.mux)
	s.logger.Info("Registered OVA upload handler", zap.String("path", "/api/v1/ova/"))

	// =========================================================================
	// Registration Token REST API (always available)
	// =========================================================================
	s.registrationHandler.RegisterRoutes(s.mux)
	s.logger.Info("Registered Registration Token API routes", zap.String("path", "/api/admin/registration-tokens"))

	// =========================================================================
	// Host Registration REST API (for vDC UI to add hosts)
	// =========================================================================
	hostRegHandler := NewHostRegistrationHandler(s)
	hostRegHandler.RegisterRoutes(s.mux)
	s.logger.Info("Registered Host Registration API routes", zap.String("path", "/api/nodes/{register,discover}"))

	// =========================================================================
	// Admin REST API (requires PostgreSQL)
	// =========================================================================
	if s.adminHandler != nil {
		s.adminHandler.RegisterRoutes(s.mux)
		s.logger.Info("Registered Admin API routes", zap.String("path", "/api/admin/*"))
	}

	s.logger.Info("All routes registered")
}

// setupMiddleware configures middleware chain.
func (s *Server) setupMiddleware(handler http.Handler) http.Handler {
	// CORS middleware
	corsHandler := cors.New(cors.Options{
		AllowedOrigins:   s.config.CORS.AllowedOrigins,
		AllowedMethods:   s.config.CORS.AllowedMethods,
		AllowedHeaders:   s.config.CORS.AllowedHeaders,
		AllowCredentials: s.config.CORS.AllowCredentials,
		MaxAge:           86400, // 24 hours
	})

	// Apply middleware
	handler = corsHandler.Handler(handler)
	handler = s.loggingMiddleware(handler)
	handler = s.recoveryMiddleware(handler)

	return handler
}

// loggingMiddleware logs HTTP requests.
func (s *Server) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Wrap response writer to capture status code
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		next.ServeHTTP(wrapped, r)

		// Skip logging for health checks
		if r.URL.Path == "/health" || r.URL.Path == "/ready" || r.URL.Path == "/live" {
			return
		}

		s.logger.Info("HTTP request",
			zap.String("method", r.Method),
			zap.String("path", r.URL.Path),
			zap.Int("status", wrapped.statusCode),
			zap.Duration("duration", time.Since(start)),
			zap.String("remote_addr", r.RemoteAddr),
			zap.String("user_agent", r.UserAgent()),
		)
	})
}

// recoveryMiddleware recovers from panics.
func (s *Server) recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				s.logger.Error("Panic recovered",
					zap.Any("error", err),
					zap.String("path", r.URL.Path),
				)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// responseWriter wraps http.ResponseWriter to capture status code.
// It also implements http.Hijacker to support WebSocket upgrades.
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// Hijack implements http.Hijacker interface for WebSocket support.
func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hijacker, ok := rw.ResponseWriter.(http.Hijacker); ok {
		return hijacker.Hijack()
	}
	return nil, nil, fmt.Errorf("ResponseWriter does not implement http.Hijacker")
}

// Flush implements http.Flusher interface.
func (rw *responseWriter) Flush() {
	if flusher, ok := rw.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// healthHandler returns health status.
func (s *Server) healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"healthy","service":"limiquantix-controlplane"}`)
}

// readyHandler returns readiness status.
func (s *Server) readyHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ready := true
	details := map[string]string{}

	// Check PostgreSQL
	if s.db != nil {
		if err := s.db.Health(ctx); err != nil {
			ready = false
			details["postgres"] = "unhealthy"
		} else {
			details["postgres"] = "healthy"
		}
	}

	// Check Redis
	if s.cache != nil {
		if err := s.cache.Health(ctx); err != nil {
			ready = false
			details["redis"] = "unhealthy"
		} else {
			details["redis"] = "healthy"
		}
	}

	// Check etcd
	if s.etcd != nil {
		if err := s.etcd.Health(ctx); err != nil {
			ready = false
			details["etcd"] = "unhealthy"
		} else {
			details["etcd"] = "healthy"
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if ready {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"ready":true,"components":%s}`, toJSON(details))
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprintf(w, `{"ready":false,"components":%s}`, toJSON(details))
	}
}

// liveHandler returns liveness status.
func (s *Server) liveHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"alive":true}`)
}

// infoHandler returns API information.
func (s *Server) infoHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{
		"name": "limiquantix Control Plane",
		"version": "0.1.0",
		"api_version": "v1",
		"description": "Distributed Virtualization Platform",
		"services": ["VMService", "NodeService", "VirtualNetworkService", "SecurityGroupService"],
		"infrastructure": {
			"postgres": %t,
			"redis": %t,
			"etcd": %t
		}
	}`, s.db != nil, s.cache != nil, s.etcd != nil)
}

// GetScheduler returns the scheduler instance for use by other services.
func (s *Server) GetScheduler() *scheduler.Scheduler {
	return s.scheduler
}

// GetCache returns the Redis cache for use by other services.
func (s *Server) GetCache() *redis.Cache {
	return s.cache
}

// GetEtcd returns the etcd client for use by other services.
func (s *Server) GetEtcd() *etcd.Client {
	return s.etcd
}

// GetRegistrationService returns the registration service for use by other components.
func (s *Server) GetRegistrationService() *registration.Service {
	return s.registrationService
}

// Run starts the HTTP server and blocks until shutdown.
func (s *Server) Run(ctx context.Context) error {
	s.logger.Info("Starting server",
		zap.String("address", s.config.Server.Address()),
	)

	// Start leader election if etcd is available
	if s.etcd != nil {
		leader, err := s.etcd.CampaignForLeader(ctx, "controlplane", func(isLeader bool) {
			if isLeader {
				s.logger.Info("This instance is now the leader")
				// Start leader-only tasks (DRS, HA, etc.)
			} else {
				s.logger.Info("This instance is now a follower")
				// Stop leader-only tasks
			}
		})
		if err != nil {
			s.logger.Warn("Failed to start leader election", zap.Error(err))
		} else {
			s.leader = leader
		}
	}

	// Start server in goroutine
	errCh := make(chan error, 1)
	go func() {
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	// Wait for shutdown signal or error
	select {
	case <-ctx.Done():
		s.logger.Info("Shutdown signal received")
	case err := <-errCh:
		return fmt.Errorf("server error: %w", err)
	}

	// Graceful shutdown
	return s.Shutdown()
}

// Shutdown gracefully shuts down the server.
func (s *Server) Shutdown() error {
	shutdownCtx, cancel := context.WithTimeout(context.Background(), s.config.Server.ShutdownTimeout)
	defer cancel()

	s.logger.Info("Shutting down server...")

	// Resign from leadership
	if s.leader != nil {
		if err := s.leader.Resign(shutdownCtx); err != nil {
			s.logger.Warn("Failed to resign leadership", zap.Error(err))
		}
	}

	// Close HTTP server
	if err := s.httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("HTTP shutdown error: %w", err)
	}

	// Close infrastructure connections
	if s.daemonPool != nil {
		if err := s.daemonPool.Close(); err != nil {
			s.logger.Warn("Failed to close daemon pool", zap.Error(err))
		}
	}
	if s.etcd != nil {
		if err := s.etcd.Close(); err != nil {
			s.logger.Warn("Failed to close etcd", zap.Error(err))
		}
	}
	if s.cache != nil {
		if err := s.cache.Close(); err != nil {
			s.logger.Warn("Failed to close Redis", zap.Error(err))
		}
	}
	if s.db != nil {
		s.db.Close()
	}

	s.logger.Info("Server stopped gracefully")
	return nil
}

// Address returns the server address.
func (s *Server) Address() string {
	return s.config.Server.Address()
}

// toJSON converts a map to JSON string.
func toJSON(m map[string]string) string {
	if len(m) == 0 {
		return "{}"
	}
	result := "{"
	first := true
	for k, v := range m {
		if !first {
			result += ","
		}
		result += fmt.Sprintf(`"%s":"%s"`, k, v)
		first = false
	}
	result += "}"
	return result
}
