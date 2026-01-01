// Package server provides the HTTP/Connect-RPC server for the control plane.
package server

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/cors"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/config"
)

// Server represents the main HTTP server.
type Server struct {
	config     *config.Config
	logger     *zap.Logger
	httpServer *http.Server
	mux        *http.ServeMux
}

// New creates a new server instance.
func New(cfg *config.Config, logger *zap.Logger) *Server {
	mux := http.NewServeMux()

	s := &Server{
		config: cfg,
		logger: logger,
		mux:    mux,
	}

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

// registerRoutes registers all HTTP routes and Connect-RPC services.
func (s *Server) registerRoutes() {
	// Health endpoints
	s.mux.HandleFunc("/health", s.healthHandler)
	s.mux.HandleFunc("/ready", s.readyHandler)
	s.mux.HandleFunc("/live", s.liveHandler)

	// API info
	s.mux.HandleFunc("/api/v1/info", s.infoHandler)

	// TODO: Register Connect-RPC services here
	// path, handler := computev1connect.NewVMServiceHandler(vmService)
	// s.mux.Handle(path, handler)
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
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// healthHandler returns health status.
func (s *Server) healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"healthy","service":"limiquantix-controlplane"}`)
}

// readyHandler returns readiness status.
func (s *Server) readyHandler(w http.ResponseWriter, r *http.Request) {
	// TODO: Check database, etcd, redis connections
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"ready":true}`)
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
		"name": "LimiQuantix Control Plane",
		"version": "0.1.0",
		"api_version": "v1",
		"description": "Distributed Virtualization Platform"
	}`)
}

// Run starts the HTTP server and blocks until shutdown.
func (s *Server) Run(ctx context.Context) error {
	s.logger.Info("Starting server",
		zap.String("address", s.config.Server.Address()),
	)

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
	shutdownCtx, cancel := context.WithTimeout(context.Background(), s.config.Server.ShutdownTimeout)
	defer cancel()

	s.logger.Info("Shutting down server...")
	if err := s.httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown error: %w", err)
	}

	s.logger.Info("Server stopped gracefully")
	return nil
}

// Address returns the server address.
func (s *Server) Address() string {
	return s.config.Server.Address()
}

