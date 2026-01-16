# =============================================================================
# Quantix Update Server Dockerfile
# =============================================================================
# Multi-stage build for a minimal production image
# =============================================================================

# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /build

# Install git for go mod download
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum* ./

# Download dependencies
RUN go mod download

# Copy source code
COPY *.go ./

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o update-server .

# =============================================================================
# Production stage
# =============================================================================
FROM alpine:3.20

# Install ca-certificates for HTTPS support
RUN apk add --no-cache ca-certificates tzdata

# Create non-root user
RUN adduser -D -u 1000 quantix

# Create directories
RUN mkdir -p /data/releases /etc/update-server && \
    chown -R quantix:quantix /data /etc/update-server

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/update-server /app/update-server

# Switch to non-root user
USER quantix

# Expose port
EXPOSE 9000

# Environment variables with defaults
ENV RELEASE_DIR=/data/releases
ENV LISTEN_ADDR=0.0.0.0:9000
ENV PUBLISH_TOKEN=change-me-in-production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:9000/health || exit 1

# Run the server
CMD ["/app/update-server"]
