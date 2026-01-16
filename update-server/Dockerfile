# =============================================================================
# Quantix Update Server Dockerfile
# =============================================================================
# Multi-stage build for a minimal production image with UI
# =============================================================================

# =============================================================================
# UI Build Stage
# =============================================================================
FROM node:22-alpine AS ui-builder

WORKDIR /ui

# Copy package files
COPY ui/package.json ui/package-lock.json* ./

# Install dependencies
RUN npm install

# Copy source code
COPY ui/ ./

# Build the UI
RUN npm run build

# =============================================================================
# Go Build Stage
# =============================================================================
FROM golang:1.22-alpine AS go-builder

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
# Production Stage
# =============================================================================
FROM alpine:3.20

# Install ca-certificates, git for admin operations, and other tools
RUN apk add --no-cache ca-certificates tzdata git bash

# Create non-root user
RUN adduser -D -u 1000 quantix

# Create directories
RUN mkdir -p /data/releases /etc/update-server /app/ui/dist && \
    chown -R quantix:quantix /data /etc/update-server /app

WORKDIR /app

# Copy binary from builder
COPY --from=go-builder /build/update-server /app/update-server

# Copy UI from builder
COPY --from=ui-builder /ui/dist /app/ui/dist

# Expose port
EXPOSE 9000

# Environment variables with defaults
ENV RELEASE_DIR=/data/releases
ENV LISTEN_ADDR=0.0.0.0:9000
ENV PUBLISH_TOKEN=change-me-in-production
ENV GIT_REPO_PATH=/workspace
ENV UI_PATH=/app/ui/dist

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:9000/health || exit 1

# Run as root to allow git operations on mounted volumes
# In production, use proper volume permissions
CMD ["/app/update-server"]
