#!/bin/bash
# =============================================================================
# Quantix-vDC Update Publisher
# =============================================================================
# Builds and publishes Quantix-vDC (Control Plane) updates to the update server.
#
# Usage:
#   ./publish-vdc-update.sh                       # Build all and publish to dev
#   ./publish-vdc-update.sh --channel beta        # Publish to beta channel
#   ./publish-vdc-update.sh --component dashboard # Build only dashboard
#   ./publish-vdc-update.sh --dry-run             # Build but don't upload
#
# Environment:
#   UPDATE_SERVER  - URL of update server (default: http://localhost:9000)
#   PUBLISH_TOKEN  - Authentication token (default: dev-token)
#   VERSION        - Version to publish (default: read from VERSION file)
#
# Components:
#   controlplane   - Go backend server
#   dashboard      - React frontend
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CHANNEL="${CHANNEL:-dev}"
UPDATE_SERVER="${UPDATE_SERVER:-http://192.168.0.148:9000}"
PUBLISH_TOKEN="${PUBLISH_TOKEN:-dev-token}"
DRY_RUN=false
COMPONENTS=()
BUILD_ALL=true
NO_BUMP=false

# Version file location
VERSION_FILE="$PROJECT_ROOT/Quantix-vDC/VERSION"
VERSION_SCRIPT="$PROJECT_ROOT/Quantix-vDC/builder/version.sh"

# Staging directory for build artifacts
STAGING_DIR="/tmp/quantix-vdc-update-staging"

# =============================================================================
# Helper functions
# =============================================================================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

show_usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Quantix-vDC Update Publisher

Builds and publishes Quantix-vDC component updates. Automatically increments
the version number on each publish unless --no-bump or --version is specified.

Options:
  --channel CHANNEL     Release channel (dev, beta, stable). Default: dev
  --component NAME      Build only specified component (can repeat)
  --server URL          Update server URL. Default: $UPDATE_SERVER
  --token TOKEN         Authentication token. Default: dev-token
  --version VERSION     Version to publish (disables auto-increment)
  --no-bump             Don't increment version, use current VERSION file
  --dry-run             Build artifacts but don't upload
  --help                Show this help

Components:
  controlplane          Go backend server
  dashboard             React frontend

Examples:
  $(basename "$0")                                    # Build, bump version, publish to dev
  $(basename "$0") --channel beta                    # Publish to beta channel
  $(basename "$0") --component dashboard --dry-run   # Build dashboard only
  $(basename "$0") --no-bump                         # Publish without incrementing version
EOF
}

# =============================================================================
# Parse arguments
# =============================================================================

while [[ $# -gt 0 ]]; do
    case "$1" in
        --channel)
            CHANNEL="$2"
            shift 2
            ;;
        --component)
            COMPONENTS+=("$2")
            BUILD_ALL=false
            shift 2
            ;;
        --server)
            UPDATE_SERVER="$2"
            shift 2
            ;;
        --token)
            PUBLISH_TOKEN="$2"
            shift 2
            ;;
        --version)
            VERSION="$2"
            NO_BUMP=true  # If version is manually specified, don't bump
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --no-bump)
            NO_BUMP=true
            shift
            ;;
        --help|-h)
            show_usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# If no components specified, build all
if [ "$BUILD_ALL" = true ]; then
    COMPONENTS=("controlplane" "dashboard" "migrations")
fi

# Validate channel
if [[ ! "$CHANNEL" =~ ^(dev|beta|stable)$ ]]; then
    log_error "Invalid channel: $CHANNEL. Must be dev, beta, or stable."
    exit 1
fi

# =============================================================================
# Version Management
# =============================================================================

# Auto-increment version unless --no-bump or --version was specified
if [ "$NO_BUMP" = false ] && [ -z "$VERSION" ]; then
    if [ -x "$VERSION_SCRIPT" ]; then
        log_info "Incrementing version..."
        VERSION=$("$VERSION_SCRIPT" increment)
        log_info "New version: $VERSION"
    elif [ -f "$VERSION_FILE" ]; then
        VERSION=$(cat "$VERSION_FILE" | tr -d '\n\r ')
    else
        VERSION="0.0.1"
    fi
elif [ -z "$VERSION" ]; then
    # --no-bump specified, read current version without incrementing
    if [ -f "$VERSION_FILE" ]; then
        VERSION=$(cat "$VERSION_FILE" | tr -d '\n\r ')
    else
        VERSION="0.0.1"
    fi
fi

# =============================================================================
# Main
# =============================================================================

echo ""
echo -e "${MAGENTA}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${MAGENTA}║              Quantix-vDC Update Publisher                     ║${NC}"
echo -e "${MAGENTA}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
log_info "Version:     $VERSION"
log_info "Channel:     $CHANNEL"
log_info "Server:      $UPDATE_SERVER"
log_info "Components:  ${COMPONENTS[*]}"
log_info "Dry run:     $DRY_RUN"
echo ""

# Create staging directory
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

# Track built artifacts for manifest
declare -A ARTIFACTS

# =============================================================================
# Build Components
# =============================================================================

log_step "Building components..."

for component in "${COMPONENTS[@]}"; do
    case "$component" in
        controlplane)
            log_info "Building controlplane (Go)..."
            cd "$PROJECT_ROOT/backend"
            
            # Check if Go is available
            if ! command -v go &> /dev/null; then
                log_error "Go is not installed. Please install Go 1.22+."
                continue
            fi
            
            # Build for Linux
            log_info "Compiling for Linux amd64..."
            
            # Clear ENTIRE Go build cache to ensure fresh build with latest code changes
            # This is necessary because changes in internal packages need to be recompiled
            log_info "Clearing entire Go build cache..."
            go clean -cache 2>/dev/null || true
            
            # Remove any stale local binaries
            rm -f "$PROJECT_ROOT/backend/controlplane" "$PROJECT_ROOT/backend/controlplane.exe" 2>/dev/null || true
            
            # Build with -a flag to force rebuild all packages
            CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a \
                -ldflags="-w -s -X main.Version=$VERSION" \
                -o "$STAGING_DIR/quantix-controlplane" \
                ./cmd/controlplane 2>&1 | tail -10
            
            if [ -f "$STAGING_DIR/quantix-controlplane" ]; then
                log_info "Packaging controlplane..."
                
                # Always use gzip for compatibility (QvDC only supports .tar.gz)
                tar -C "$STAGING_DIR" -czf "$STAGING_DIR/controlplane.tar.gz" quantix-controlplane
                ARTIFACTS["controlplane"]="$STAGING_DIR/controlplane.tar.gz"
                log_info "  Created: controlplane.tar.gz ($(du -h "$STAGING_DIR/controlplane.tar.gz" | cut -f1))"
                
                rm -f "$STAGING_DIR/quantix-controlplane"
            else
                log_error "Build failed - binary not created!"
            fi
            ;;
            
        dashboard)
            log_info "Building dashboard (React)..."
            cd "$PROJECT_ROOT/frontend"
            
            # Check if npm is available
            if ! command -v npm &> /dev/null; then
                log_error "npm is not installed. Please install Node.js."
                continue
            fi
            
            # Install dependencies and build
            log_info "Installing dependencies..."
            npm install 2>&1 | tail -5
            
            log_info "Building production bundle..."
            npm run build 2>&1 | tail -10
            
            if [ -d "dist" ]; then
                log_info "Packaging dashboard..."
                
                # Always use gzip for compatibility (QvDC only supports .tar.gz)
                tar -C dist -czf "$STAGING_DIR/dashboard.tar.gz" .
                ARTIFACTS["dashboard"]="$STAGING_DIR/dashboard.tar.gz"
                log_info "  Created: dashboard.tar.gz ($(du -h "$STAGING_DIR/dashboard.tar.gz" | cut -f1))"
            else
                log_error "Build failed - dist directory not found!"
            fi
            ;;
            


        migrations)
            log_info "Building migrations..."
            cd "$PROJECT_ROOT/backend"
            
            # Build migrate tool
            log_info "Compiling migration tool..."
            CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a \
                -ldflags="-w -s" \
                -o "$STAGING_DIR/quantix-migrate" \
                ./cmd/migrate
            
            if [ -f "$STAGING_DIR/quantix-migrate" ]; then
                log_info "Packaging migrations..."
                
                # Create a temporary directory for packing
                MIG_PKG_DIR="$STAGING_DIR/migrations_pkg"
                mkdir -p "$MIG_PKG_DIR"
                
                # Copy binary and migrations folder
                cp "$STAGING_DIR/quantix-migrate" "$MIG_PKG_DIR/"
                cp -r "$PROJECT_ROOT/backend/migrations" "$MIG_PKG_DIR/"
                
                # Compress
                # tar -C "$STAGING_DIR/migrations_pkg" -czf "$STAGING_DIR/migrations.tar.gz" .
                # NOTE: We preserve the structure so it extracts to:
                # /usr/share/quantix-vdc/migrations/quantix-migrate
                # /usr/share/quantix-vdc/migrations/migrations/*.sql
                tar -C "$MIG_PKG_DIR" -czf "$STAGING_DIR/migrations.tar.gz" .
                
                ARTIFACTS["migrations"]="$STAGING_DIR/migrations.tar.gz"
                log_info "  Created: migrations.tar.gz ($(du -h "$STAGING_DIR/migrations.tar.gz" | cut -f1))"
                
                rm -rf "$MIG_PKG_DIR" "$STAGING_DIR/quantix-migrate"
            else
                log_error "Build failed - migrate binary not created!"
            fi
            ;;
            
        *)
            log_warn "Unknown component: $component, skipping..."
            ;;
    esac
done

# Check if we have any artifacts
if [ ${#ARTIFACTS[@]} -eq 0 ]; then
    log_error "No artifacts built! Cannot publish."
    exit 1
fi

# =============================================================================
# Generate Manifest
# =============================================================================

log_step "Generating manifest..."

RELEASE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
MANIFEST="$STAGING_DIR/manifest.json"

# Start building JSON
cat > "$MANIFEST" << EOF
{
  "product": "quantix-vdc",
  "version": "$VERSION",
  "channel": "$CHANNEL",
  "release_date": "$RELEASE_DATE",
  "update_type": "component",
  "requires_maintenance_window": true,
  "components": [
EOF

# Add each component to manifest
FIRST=true
for component in "${!ARTIFACTS[@]}"; do
    artifact_path="${ARTIFACTS[$component]}"
    artifact_name="$(basename "$artifact_path")"
    
    # Get file size (cross-platform)
    if stat --version &> /dev/null 2>&1; then
        # GNU stat
        artifact_size=$(stat -c%s "$artifact_path")
    else
        # BSD stat (macOS)
        artifact_size=$(stat -f%z "$artifact_path")
    fi
    
    artifact_sha256=$(sha256sum "$artifact_path" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$artifact_path" | cut -d' ' -f1)
    
    # Determine install path and service
    case "$component" in
        controlplane)
            install_path="/usr/bin/qx-controlplane"
            restart_service="quantix-controlplane"
            requires_db_migration="false"
            ;;
        dashboard)
            install_path="/usr/share/quantix-vdc/dashboard"
            restart_service=""
            requires_db_migration="false"
            ;;
        migrations)
            install_path="/usr/share/quantix-vdc/migrations/"
            restart_service=""
            requires_db_migration="true"
            ;;
    esac
    
    if [ "$FIRST" = true ]; then
        FIRST=false
    else
        echo "," >> "$MANIFEST"
    fi
    
    cat >> "$MANIFEST" << EOF
    {
      "name": "$component",
      "version": "$VERSION",
      "artifact": "$artifact_name",
      "sha256": "$artifact_sha256",
      "size_bytes": $artifact_size,
      "install_path": "$install_path",
      "restart_service": $([ -n "$restart_service" ] && echo "\"$restart_service\"" || echo "null"),
      "backup_before_update": true,
      "permissions": "0755",
      "requires_db_migration": $requires_db_migration
    }
EOF
done

# Close the manifest
cat >> "$MANIFEST" << EOF

  ],
  "min_version": "0.0.1",
  "release_notes": "Quantix-vDC $VERSION update"
}
EOF

log_info "Manifest generated: $MANIFEST"

# =============================================================================
# Publish to Server
# =============================================================================

if [ "$DRY_RUN" = true ]; then
    log_warn "Dry run - skipping upload"
    log_info "Artifacts staged in: $STAGING_DIR"
    echo ""
    echo "Manifest contents:"
    cat "$MANIFEST"
    exit 0
fi

log_step "Publishing to $UPDATE_SERVER..."

# Build curl command with all artifacts
CURL_ARGS=(
    "-X" "POST"
    "-H" "Authorization: Bearer $PUBLISH_TOKEN"
    "-F" "manifest=@$MANIFEST"
)

for component in "${!ARTIFACTS[@]}"; do
    artifact_path="${ARTIFACTS[$component]}"
    artifact_name="$(basename "$artifact_path")"
    CURL_ARGS+=("-F" "$artifact_name=@$artifact_path")
done

# Execute upload
RESPONSE=$(curl -s -w "\n%{http_code}" "${CURL_ARGS[@]}" "$UPDATE_SERVER/api/v1/quantix-vdc/publish")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    log_info "Upload successful!"
    echo ""
    echo -e "${MAGENTA}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${MAGENTA}║                    Publish Complete!                          ║${NC}"
    echo -e "${MAGENTA}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${MAGENTA}║  Product: Quantix-vDC                                         ║${NC}"
    echo -e "${MAGENTA}║  Version: $VERSION                                            ${NC}"
    echo -e "${MAGENTA}║  Channel: $CHANNEL                                            ${NC}"
    echo -e "${MAGENTA}║  Server:  $UPDATE_SERVER                                      ${NC}"
    echo -e "${MAGENTA}║                                                               ║${NC}"
    echo -e "${MAGENTA}║  Components published:                                        ║${NC}"
    for component in "${!ARTIFACTS[@]}"; do
        echo -e "${MAGENTA}║    - $component                                              ${NC}"
    done
    echo -e "${MAGENTA}╚═══════════════════════════════════════════════════════════════╝${NC}"
else
    log_error "Upload failed with HTTP $HTTP_CODE"
    echo "$BODY"
    exit 1
fi

# =============================================================================
# Post-Publish Cleanup & Cache Invalidation
# =============================================================================

log_info "Cleaning up build artifacts and caches..."

# Clear Go build cache for this project to ensure next build is fresh
go clean -cache "$PROJECT_ROOT/backend/..." 2>/dev/null || true

# Remove any local staging artifacts that might be stale
rm -f "$PROJECT_ROOT/backend/controlplane" 2>/dev/null || true
rm -f "$PROJECT_ROOT/backend/controlplane.exe" 2>/dev/null || true
rm -rf "$PROJECT_ROOT/backend/bin/" 2>/dev/null || true

# Cleanup staging directory
rm -rf "$STAGING_DIR"
