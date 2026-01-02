// Package middleware provides HTTP and Connect-RPC middleware.
package middleware

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/services/auth"
)

// ContextKey is the type for context keys.
type ContextKey string

const (
	// ClaimsKey is the context key for JWT claims.
	ClaimsKey ContextKey = "claims"
	// UserIDKey is the context key for the authenticated user ID.
	UserIDKey ContextKey = "user_id"
	// RoleKey is the context key for the user's role.
	RoleKey ContextKey = "role"
)

// AuthInterceptor provides authentication for Connect-RPC services.
type AuthInterceptor struct {
	jwtManager *auth.JWTManager
	logger     *zap.Logger
}

// NewAuthInterceptor creates a new auth interceptor.
func NewAuthInterceptor(jwtManager *auth.JWTManager, logger *zap.Logger) *AuthInterceptor {
	return &AuthInterceptor{
		jwtManager: jwtManager,
		logger:     logger.With(zap.String("middleware", "auth")),
	}
}

// WrapUnary returns a unary interceptor function.
func (a *AuthInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		// Skip auth for public endpoints
		if isPublicEndpoint(req.Spec().Procedure) {
			return next(ctx, req)
		}

		// Extract token from Authorization header
		authHeader := req.Header().Get("Authorization")
		if authHeader == "" {
			a.logger.Debug("Missing authorization header", zap.String("procedure", req.Spec().Procedure))
			return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("missing authorization header"))
		}

		// Parse Bearer token
		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenString == authHeader {
			return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid authorization format, expected 'Bearer <token>'"))
		}

		// Verify token
		claims, err := a.jwtManager.Verify(tokenString)
		if err != nil {
			a.logger.Debug("Token verification failed", zap.Error(err))
			return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid or expired token"))
		}

		// Add claims to context
		ctx = context.WithValue(ctx, ClaimsKey, claims)
		ctx = context.WithValue(ctx, UserIDKey, claims.UserID)
		ctx = context.WithValue(ctx, RoleKey, claims.Role)

		a.logger.Debug("Request authenticated",
			zap.String("user_id", claims.UserID),
			zap.String("username", claims.Username),
			zap.String("role", string(claims.Role)),
			zap.String("procedure", req.Spec().Procedure),
		)

		return next(ctx, req)
	}
}

// WrapStreamingClient returns a streaming client interceptor.
func (a *AuthInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return func(ctx context.Context, spec connect.Spec) connect.StreamingClientConn {
		// Client-side streaming doesn't need server auth
		return next(ctx, spec)
	}
}

// WrapStreamingHandler returns a streaming handler interceptor.
func (a *AuthInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		// Skip auth for public endpoints
		if isPublicEndpoint(conn.Spec().Procedure) {
			return next(ctx, conn)
		}

		// Extract token from Authorization header
		authHeader := conn.RequestHeader().Get("Authorization")
		if authHeader == "" {
			return connect.NewError(connect.CodeUnauthenticated, errors.New("missing authorization header"))
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenString == authHeader {
			return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid authorization format"))
		}

		// Verify token
		claims, err := a.jwtManager.Verify(tokenString)
		if err != nil {
			return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid or expired token"))
		}

		// Add claims to context
		ctx = context.WithValue(ctx, ClaimsKey, claims)
		ctx = context.WithValue(ctx, UserIDKey, claims.UserID)
		ctx = context.WithValue(ctx, RoleKey, claims.Role)

		return next(ctx, conn)
	}
}

// publicEndpoints lists endpoints that don't require authentication.
var publicEndpoints = []string{
	// Health checks
	"/health",
	"/ready",
	"/live",
	// Auth endpoints
	"/limiquantix.auth.v1.AuthService/Login",
	"/limiquantix.auth.v1.AuthService/RefreshToken",
	// gRPC reflection (for development tools)
	"/grpc.reflection.v1alpha.ServerReflection",
	"/grpc.reflection.v1.ServerReflection",
}

// isPublicEndpoint checks if a procedure is public (no auth required).
func isPublicEndpoint(procedure string) bool {
	for _, ep := range publicEndpoints {
		if strings.Contains(procedure, ep) || strings.HasSuffix(procedure, ep) {
			return true
		}
	}
	return false
}

// GetClaims extracts JWT claims from the context.
func GetClaims(ctx context.Context) (*auth.Claims, bool) {
	claims, ok := ctx.Value(ClaimsKey).(*auth.Claims)
	return claims, ok
}

// GetUserID extracts the user ID from the context.
func GetUserID(ctx context.Context) (string, bool) {
	userID, ok := ctx.Value(UserIDKey).(string)
	return userID, ok
}

// GetRole extracts the user's role from the context.
func GetRole(ctx context.Context) (domain.Role, bool) {
	role, ok := ctx.Value(RoleKey).(domain.Role)
	return role, ok
}

// RequireRole returns an error if the user doesn't have the required role.
func RequireRole(ctx context.Context, requiredRoles ...domain.Role) error {
	role, ok := GetRole(ctx)
	if !ok {
		return connect.NewError(connect.CodeUnauthenticated, errors.New("not authenticated"))
	}

	for _, r := range requiredRoles {
		if role == r {
			return nil
		}
	}

	return connect.NewError(connect.CodePermissionDenied, errors.New("insufficient permissions"))
}

// RequirePermission returns an error if the user doesn't have the required permission.
func RequirePermission(ctx context.Context, permission domain.Permission) error {
	role, ok := GetRole(ctx)
	if !ok {
		return connect.NewError(connect.CodeUnauthenticated, errors.New("not authenticated"))
	}

	if !domain.HasPermission(role, permission) {
		return connect.NewError(connect.CodePermissionDenied, errors.New("insufficient permissions"))
	}

	return nil
}
