# limiquantix Control Plane Dockerfile
# Multi-stage build for minimal final image

# ============================================================================
# Build Stage
# ============================================================================
FROM golang:1.22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates

WORKDIR /app

# Download dependencies first (for better caching)
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -X main.version=$(git describe --tags --always --dirty 2>/dev/null || echo dev) -X main.commit=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
    -o /controlplane ./cmd/controlplane

# ============================================================================
# Runtime Stage
# ============================================================================
FROM alpine:3.19

# Install runtime dependencies
RUN apk --no-cache add ca-certificates tzdata

# Create non-root user
RUN addgroup -g 1000 limiquantix && \
    adduser -u 1000 -G limiquantix -s /bin/sh -D limiquantix

WORKDIR /app

# Copy binary from builder
COPY --from=builder /controlplane /app/controlplane

# Copy default config
COPY configs/config.yaml /app/configs/

# Set ownership
RUN chown -R limiquantix:limiquantix /app

# Switch to non-root user
USER limiquantix

# Expose ports
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Run the binary
ENTRYPOINT ["/app/controlplane"]

