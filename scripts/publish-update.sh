#!/bin/bash
# =============================================================================
# Quantix-OS Update Publisher
# =============================================================================
# Builds and publishes component updates to the update server.
#
# Usage:
#   ./publish-update.sh                    # Build all components and publish to dev
#   ./publish-update.sh --channel beta     # Publish to beta channel
#   ./publish-update.sh --component qx-node # Build and publish only qx-node
#   ./publish-update.sh --dry-run          # Build but don't upload
#
# Environment:
#   UPDATE_SERVER  - URL of update server (default: http://192.168.0.95:9000)
#   PUBLISH_TOKEN  - Authentication token (default: dev-token)
#   VERSION        - Version to publish (default: read from VERSION file)
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CHANNEL="${CHANNEL:-dev}"
UPDATE_SERVER="${UPDATE_SERVER:-http://192.168.0.251:9000}"
PUBLISH_TOKEN="${PUBLISH_TOKEN:-dev-token}"
DRY_RUN=false
COMPONENTS=()
BUILD_ALL=true
NO_BUMP=false

# Version file location
VERSION_FILE="$PROJECT_ROOT/Quantix-OS/VERSION"
VERSION_SCRIPT="$PROJECT_ROOT/Quantix-OS/builder/version.sh"

# Staging directory for build artifacts
STAGING_DIR="/tmp/quantix-update-staging"

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

Builds and publishes Quantix-OS component updates. Automatically increments
the version number on each publish unless --no-bump or --version is specified.

On Windows, Rust components are built using Docker for Alpine compatibility.
Make sure Docker is running before building Rust components.

Options:
  --channel CHANNEL     Release channel (dev, beta, stable). Default: dev
  --component NAME      Build and publish only specified component
                        Can be specified multiple times
  --server URL          Update server URL. Default: $UPDATE_SERVER
  --token TOKEN         Authentication token. Default: dev-token
  --version VERSION     Version to publish (disables auto-increment)
  --no-bump             Don't increment version, use current VERSION file
  --dry-run             Build artifacts but don't upload
  --help                Show this help

Components:
  qx-node              Node daemon (Rust) - requires Docker on Windows
  qx-console           Console TUI (Rust) - requires Docker on Windows
  host-ui              Host UI (React) - builds natively

Examples:
  $(basename "$0")                                    # Build all, bump version, publish
  $(basename "$0") --channel beta                    # Publish to beta channel
  $(basename "$0") --component host-ui               # Only publish host-ui (fast, no Docker)
  $(basename "$0") --component qx-node --dry-run    # Build qx-node without upload
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
    COMPONENTS=("qx-node" "qx-console" "host-ui")
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
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              Quantix-OS Update Publisher                      ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
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
# Docker Image for Rust builds
# =============================================================================

RUST_BUILDER_IMAGE="quantix-rust-tui-builder"

# Check if we need Docker for Rust builds (Windows or no musl)
use_docker_for_rust() {
    # On Windows (MINGW/MSYS/Cygwin), always use Docker
    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
        return 0
    fi
    # On Linux, check if musl toolchain is available
    if ! command -v x86_64-linux-musl-gcc &> /dev/null; then
        return 0
    fi
    return 1
}

build_rust_with_docker() {
    local crate="$1"
    local output_name="$2"
    local source_dir="$3"
    
    log_info "Building $crate with Docker (Alpine native)..."
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        return 1
    fi
    
    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running. Please start Docker Desktop."
        return 1
    fi
    
    # Convert path for Docker on Windows (Git Bash mangles paths)
    # Git Bash converts /build to C:/Program Files/Git/build, so we need to disable that
    local docker_workdir="//build"  # Double slash prevents Git Bash path conversion
    
    # Convert source_dir to Docker-compatible path
    local docker_source_dir="$source_dir"
    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        # Convert Windows path: /c/Users/... -> C:/Users/...
        # Or if already C:\..., convert backslashes
        docker_source_dir=$(cd "$source_dir" && pwd -W 2>/dev/null || pwd)
    fi
    
    # Ensure Docker image exists
    if ! docker image inspect "$RUST_BUILDER_IMAGE" &> /dev/null; then
        log_info "Building Docker image $RUST_BUILDER_IMAGE (this may take a few minutes)..."
        if ! docker build --network=host -t "$RUST_BUILDER_IMAGE" -f "$PROJECT_ROOT/Quantix-OS/builder/Dockerfile.rust-tui" "$PROJECT_ROOT/Quantix-OS/builder/"; then
            log_error "Failed to build Docker image"
            return 1
        fi
    fi
    
    log_info "Running cargo build in Docker container..."
    log_info "Source dir: $docker_source_dir"
    
    # Build in Docker - use MSYS_NO_PATHCONV to prevent path mangling
    # Clean cargo cache first to ensure fresh build with latest code changes
    log_info "Running Docker build with clean cache..."
    if ! MSYS_NO_PATHCONV=1 docker run --rm --network=host \
        -v "$docker_source_dir:/build:rw" \
        -w "$docker_workdir" \
        "$RUST_BUILDER_IMAGE" \
        sh -c "cargo clean -p $crate 2>/dev/null || true; cargo build --release -p $crate --features libvirt"; then
        log_error "Docker build failed for $crate"
        return 1
    fi
    
    log_info "Docker build completed, checking for binary..."
    
    # The binary is in target/release (Docker builds to the mounted volume)
    local binary_path="$source_dir/target/release/$output_name"
    
    if [ -f "$binary_path" ]; then
        log_info "Found binary: $binary_path ($(du -h "$binary_path" | cut -f1))"
        echo "$binary_path"
        return 0
    fi
    
    # Debug: list what's in target/release
    log_warn "Binary not found at: $binary_path"
    log_warn "Contents of target/release:"
    ls -la "$source_dir"/target/release/ 2>/dev/null | head -20 || true
    
    log_error "Binary $output_name not found after build"
    return 1
}

# =============================================================================
# Build Components
# =============================================================================

log_step "Building components..."

for component in "${COMPONENTS[@]}"; do
    case "$component" in
        qx-node)
            log_info "Building qx-node (Rust)..."
            
            cd "$PROJECT_ROOT/agent"
            BINARY=""
            
            if use_docker_for_rust; then
                # Use Docker for cross-compilation
                build_rust_with_docker "limiquantix-node" "limiquantix-node" "$PROJECT_ROOT/agent"
                BUILD_RESULT=$?
                
                # Check for binary at the expected location (relative to PROJECT_ROOT)
                if [ -f "$PROJECT_ROOT/agent/target/release/limiquantix-node" ]; then
                    BINARY="$PROJECT_ROOT/agent/target/release/limiquantix-node"
                    log_info "Found qx-node binary: $BINARY"
                elif [ $BUILD_RESULT -ne 0 ]; then
                    log_error "Docker build failed for qx-node"
                fi
            else
                # Native Linux build with musl
                log_info "Building with musl for static linking..."
                cargo build --release -p limiquantix-node --target x86_64-unknown-linux-musl --features libvirt 2>&1 | tail -10
                
                if [ -f "$PROJECT_ROOT/agent/target/x86_64-unknown-linux-musl/release/limiquantix-node" ]; then
                    BINARY="$PROJECT_ROOT/agent/target/x86_64-unknown-linux-musl/release/limiquantix-node"
                fi
            fi
            
            # Fallback: check overlay directory (from previous ISO build)
            if [ -z "$BINARY" ] || [ ! -f "$BINARY" ]; then
                if [ -f "$PROJECT_ROOT/Quantix-OS/overlay/usr/bin/qx-node" ]; then
                    log_warn "Using pre-built binary from overlay directory"
                    BINARY="$PROJECT_ROOT/Quantix-OS/overlay/usr/bin/qx-node"
                fi
            fi
            
            if [ -z "$BINARY" ] || [ ! -f "$BINARY" ]; then
                log_error "qx-node binary not found after build!"
                exit 1
            fi
            
            # Package with compression (zstd preferred, fallback to gzip)
            log_info "Packaging qx-node..."
            if command -v zstd &> /dev/null; then
                tar -C "$(dirname "$BINARY")" -c "$(basename "$BINARY")" | zstd -19 > "$STAGING_DIR/qx-node.tar.zst"
                ARTIFACTS["qx-node"]="$STAGING_DIR/qx-node.tar.zst"
                log_info "  Created: qx-node.tar.zst ($(du -h "$STAGING_DIR/qx-node.tar.zst" | cut -f1))"
            else
                tar -C "$(dirname "$BINARY")" -czf "$STAGING_DIR/qx-node.tar.gz" "$(basename "$BINARY")"
                ARTIFACTS["qx-node"]="$STAGING_DIR/qx-node.tar.gz"
                log_info "  Created: qx-node.tar.gz ($(du -h "$STAGING_DIR/qx-node.tar.gz" | cut -f1))"
            fi
            ;;
            
        qx-console)
            log_info "Building qx-console (Rust TUI)..."
            
            cd "$PROJECT_ROOT/Quantix-OS/console-tui"
            BINARY=""
            
            if use_docker_for_rust; then
                # Use Docker for cross-compilation
                log_info "Building qx-console with Docker (Alpine native)..."
                
                # Ensure Docker image exists
                if ! docker image inspect "$RUST_BUILDER_IMAGE" &> /dev/null; then
                    log_info "Building Docker image $RUST_BUILDER_IMAGE..."
                    docker build --network=host -t "$RUST_BUILDER_IMAGE" -f "$PROJECT_ROOT/Quantix-OS/builder/Dockerfile.rust-tui" "$PROJECT_ROOT/Quantix-OS/builder/"
                fi
                
                # Convert path for Docker on Windows
                CONSOLE_SOURCE_DIR="$PROJECT_ROOT/Quantix-OS/console-tui"
                if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
                    CONSOLE_SOURCE_DIR=$(cd "$CONSOLE_SOURCE_DIR" && pwd -W 2>/dev/null || pwd)
                fi
                
                # Use MSYS_NO_PATHCONV to prevent Git Bash path mangling
                MSYS_NO_PATHCONV=1 docker run --rm --network=host \
                    -v "$CONSOLE_SOURCE_DIR:/build:rw" \
                    -w "//build" \
                    "$RUST_BUILDER_IMAGE" \
                    sh -c "cargo build --release"
                
                # Check for binary at expected location
                if [ -f "$PROJECT_ROOT/Quantix-OS/console-tui/target/release/qx-console" ]; then
                    BINARY="$PROJECT_ROOT/Quantix-OS/console-tui/target/release/qx-console"
                    log_info "Found qx-console binary: $BINARY"
                fi
            else
                # Native Linux build with musl
                log_info "Building with musl for static linking..."
                cargo build --release --target x86_64-unknown-linux-musl 2>&1 | tail -10
                
                if [ -f "$PROJECT_ROOT/Quantix-OS/console-tui/target/x86_64-unknown-linux-musl/release/qx-console" ]; then
                    BINARY="$PROJECT_ROOT/Quantix-OS/console-tui/target/x86_64-unknown-linux-musl/release/qx-console"
                fi
            fi
            
            # Fallback: check overlay directory (from previous ISO build)
            if [ -z "$BINARY" ] || [ ! -f "$BINARY" ]; then
                if [ -f "$PROJECT_ROOT/Quantix-OS/overlay/usr/local/bin/qx-console" ]; then
                    log_warn "Using pre-built binary from overlay directory"
                    BINARY="$PROJECT_ROOT/Quantix-OS/overlay/usr/local/bin/qx-console"
                fi
            fi
            
            if [ -z "$BINARY" ] || [ ! -f "$BINARY" ]; then
                log_warn "qx-console binary not found, skipping..."
                continue
            fi
            
            # Package with compression (zstd preferred, fallback to gzip)
            log_info "Packaging qx-console..."
            if command -v zstd &> /dev/null; then
                tar -C "$(dirname "$BINARY")" -c "$(basename "$BINARY")" | zstd -19 > "$STAGING_DIR/qx-console.tar.zst"
                ARTIFACTS["qx-console"]="$STAGING_DIR/qx-console.tar.zst"
                log_info "  Created: qx-console.tar.zst ($(du -h "$STAGING_DIR/qx-console.tar.zst" | cut -f1))"
            else
                tar -C "$(dirname "$BINARY")" -czf "$STAGING_DIR/qx-console.tar.gz" "$(basename "$BINARY")"
                ARTIFACTS["qx-console"]="$STAGING_DIR/qx-console.tar.gz"
                log_info "  Created: qx-console.tar.gz ($(du -h "$STAGING_DIR/qx-console.tar.gz" | cut -f1))"
            fi
            ;;
            
        host-ui)
            log_info "Building host-ui (React)..."
            cd "$PROJECT_ROOT/quantix-host-ui"
            
            # Build the React app
            npm install 2>&1 | tail -5
            npm run build 2>&1 | tail -10
            
            if [ ! -d "dist" ]; then
                log_error "Host UI build failed - dist directory not found!"
                exit 1
            fi
            
            # Package the entire dist directory (zstd preferred, fallback to gzip)
            log_info "Packaging host-ui..."
            if command -v zstd &> /dev/null; then
                tar -C dist -c . | zstd -19 > "$STAGING_DIR/host-ui.tar.zst"
                ARTIFACTS["host-ui"]="$STAGING_DIR/host-ui.tar.zst"
                log_info "  Created: host-ui.tar.zst ($(du -h "$STAGING_DIR/host-ui.tar.zst" | cut -f1))"
            else
                tar -C dist -czf "$STAGING_DIR/host-ui.tar.gz" .
                ARTIFACTS["host-ui"]="$STAGING_DIR/host-ui.tar.gz"
                log_info "  Created: host-ui.tar.gz ($(du -h "$STAGING_DIR/host-ui.tar.gz" | cut -f1))"
            fi
            ;;
            
        *)
            log_warn "Unknown component: $component, skipping..."
            ;;
    esac
done

# =============================================================================
# Generate Manifest
# =============================================================================

log_step "Generating manifest..."

RELEASE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
MANIFEST="$STAGING_DIR/manifest.json"

# Start building JSON
cat > "$MANIFEST" << EOF
{
  "product": "quantix-os",
  "version": "$VERSION",
  "channel": "$CHANNEL",
  "release_date": "$RELEASE_DATE",
  "update_type": "component",
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
    
    # Get SHA256 (cross-platform)
    artifact_sha256=$(sha256sum "$artifact_path" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$artifact_path" | cut -d' ' -f1)
    
    # Determine install path
    case "$component" in
        qx-node)
            install_path="/data/bin/qx-node"
            restart_service="quantix-node"
            ;;
        qx-console)
            install_path="/data/bin/qx-console"
            restart_service="quantix-console"
            ;;
        host-ui)
            install_path="/data/share/quantix-host-ui"
            restart_service=""
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
      "permissions": "0755"
    }
EOF
done

# Close the manifest
cat >> "$MANIFEST" << EOF

  ],
  "min_version": "0.0.1",
  "release_notes": "Quantix-OS $VERSION update"
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
RESPONSE=$(curl -s -w "\n%{http_code}" "${CURL_ARGS[@]}" "$UPDATE_SERVER/api/v1/quantix-os/publish")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    log_info "Upload successful!"
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    Publish Complete!                          ║${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║  Version: $VERSION${NC}"
    echo -e "${GREEN}║  Channel: $CHANNEL${NC}"
    echo -e "${GREEN}║  Server:  $UPDATE_SERVER${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║  Hosts can now update via:                                    ║${NC}"
    echo -e "${GREEN}║    curl -X POST https://<host>:8443/api/v1/updates/apply      ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
else
    log_error "Upload failed with HTTP $HTTP_CODE"
    echo "$BODY"
    exit 1
fi

# =============================================================================
# Post-Publish Cleanup & Cache Invalidation
# =============================================================================

log_info "Cleaning up build artifacts and caches..."

# Clear Rust/Cargo cache for the agent crates to ensure next build is fresh
if command -v cargo &> /dev/null; then
    cargo clean -p limiquantix-node 2>/dev/null || true
fi

# Remove any local staging artifacts
rm -rf "$PROJECT_ROOT/agent/target/release/limiquantix-node" 2>/dev/null || true

# Cleanup staging directory
rm -rf "$STAGING_DIR"
