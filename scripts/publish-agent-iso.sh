#!/bin/bash
# =============================================================================
# Quantix Agent Tools ISO Publisher
# =============================================================================
# Builds and publishes the Agent Tools ISO to the Update Server.
#
# Usage:
#   ./publish-agent-iso.sh                    # Build and publish to update server
#   ./publish-agent-iso.sh --no-build         # Publish existing ISO without rebuilding
#   ./publish-agent-iso.sh --version 0.1.5    # Specify version explicitly
#   ./publish-agent-iso.sh --dry-run          # Build but don't upload
#
# Environment:
#   UPDATE_SERVER  - URL of update server (default: http://192.168.0.148:9000)
#   PUBLISH_TOKEN  - Authentication token (default: dev-token)
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
UPDATE_SERVER="${UPDATE_SERVER:-http://192.168.0.148:9000}"
PUBLISH_TOKEN="${PUBLISH_TOKEN:-dev-token}"
OUTPUT_DIR="${PROJECT_ROOT}/dist"
ISO_NAME_PREFIX="quantix-kvm-agent-tools"
DRY_RUN=false
NO_BUILD=false
FORCE_REBUILD=false
NO_CACHE=false

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

Builds and publishes the Quantix Agent Tools ISO to the Update Server.

Options:
  --server URL          Update server URL. Default: $UPDATE_SERVER
  --token TOKEN         Authentication token. Default: dev-token
  --version VERSION     Version to publish (overrides VERSION file)
  --output DIR          Output directory for ISO. Default: dist/
  --no-build            Skip build, use existing ISO in output directory
  --rebuild             Force rebuild Docker image (picks up code changes)
  --no-cache            Force rebuild with --no-cache (completely fresh build)
  --dry-run             Build but don't upload
  --help                Show this help

Examples:
  $(basename "$0")                        # Build and publish
  $(basename "$0") --no-build             # Publish existing ISO
  $(basename "$0") --version 0.2.0        # Publish with specific version
  $(basename "$0") --dry-run              # Build without uploading
  $(basename "$0") --server http://192.168.0.100:9000  # Use different server

The ISO contains:
  - Static Linux binaries (amd64/arm64)
  - DEB packages for Debian/Ubuntu
  - RPM packages for RHEL/CentOS/Fedora
  - Universal install.sh script
EOF
}

# =============================================================================
# Parse arguments
# =============================================================================

while [[ $# -gt 0 ]]; do
    case "$1" in
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
            shift 2
            ;;
        --output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --no-build)
            NO_BUILD=true
            shift
            ;;
        --rebuild|--force)
            FORCE_REBUILD=true
            shift
            ;;
        --no-cache)
            NO_CACHE=true
            FORCE_REBUILD=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
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

# =============================================================================
# Version Management
# =============================================================================

# Get version from file if not specified
if [ -z "$VERSION" ]; then
    # Try Quantix-OS VERSION file first
    if [ -f "$PROJECT_ROOT/Quantix-OS/VERSION" ]; then
        VERSION=$(cat "$PROJECT_ROOT/Quantix-OS/VERSION" | tr -d '\n\r ')
    elif [ -f "$PROJECT_ROOT/agent/Cargo.toml" ]; then
        # Extract version from Cargo.toml
        VERSION=$(grep -m1 '^version' "$PROJECT_ROOT/agent/Cargo.toml" | sed 's/.*"\(.*\)".*/\1/')
    else
        VERSION="0.1.0"
    fi
fi

# =============================================================================
# Main
# =============================================================================

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           Quantix Agent Tools ISO Publisher                   ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
log_info "Version:     $VERSION"
log_info "Server:      $UPDATE_SERVER"
log_info "Output:      $OUTPUT_DIR"
log_info "No build:    $NO_BUILD"
log_info "Dry run:     $DRY_RUN"
echo ""

# =============================================================================
# Build ISO (if needed)
# =============================================================================

ISO_FILE="${OUTPUT_DIR}/${ISO_NAME_PREFIX}-${VERSION}.iso"

if [ "$NO_BUILD" = true ]; then
    log_step "Skipping build, looking for existing ISO..."
    
    # Find existing ISO
    if [ -f "$ISO_FILE" ]; then
        log_info "Found: $ISO_FILE"
    else
        # Try to find any ISO in the output directory
        FOUND_ISO=$(find "$OUTPUT_DIR" -name "${ISO_NAME_PREFIX}-*.iso" -type f 2>/dev/null | sort -V | tail -1)
        if [ -n "$FOUND_ISO" ]; then
            ISO_FILE="$FOUND_ISO"
            # Extract version from filename
            VERSION=$(basename "$ISO_FILE" | sed "s/${ISO_NAME_PREFIX}-//" | sed 's/\.iso$//')
            log_info "Found: $ISO_FILE (version: $VERSION)"
        else
            log_error "No ISO found in $OUTPUT_DIR"
            log_error "Run without --no-build to create one, or specify --output with the correct directory"
            exit 1
        fi
    fi
else
    log_step "Building Agent Tools ISO..."
    
    # Build arguments
    BUILD_ARGS=("--version" "$VERSION" "--output" "$OUTPUT_DIR")
    
    if [ "$FORCE_REBUILD" = true ]; then
        BUILD_ARGS+=("--rebuild")
    fi
    
    if [ "$NO_CACHE" = true ]; then
        BUILD_ARGS+=("--no-cache")
    fi
    
    # Run build script
    if [ -x "$SCRIPT_DIR/build-agent-iso.sh" ]; then
        "$SCRIPT_DIR/build-agent-iso.sh" "${BUILD_ARGS[@]}"
    else
        log_error "Build script not found: $SCRIPT_DIR/build-agent-iso.sh"
        exit 1
    fi
    
    # Verify ISO was created
    if [ ! -f "$ISO_FILE" ]; then
        log_error "ISO not created: $ISO_FILE"
        exit 1
    fi
    
    log_info "Built: $ISO_FILE"
fi

# =============================================================================
# Calculate SHA256
# =============================================================================

log_step "Calculating SHA256 checksum..."

if command -v sha256sum &> /dev/null; then
    ISO_SHA256=$(sha256sum "$ISO_FILE" | cut -d' ' -f1)
elif command -v shasum &> /dev/null; then
    ISO_SHA256=$(shasum -a 256 "$ISO_FILE" | cut -d' ' -f1)
else
    log_error "No SHA256 tool found (sha256sum or shasum)"
    exit 1
fi

ISO_SIZE=$(stat -c%s "$ISO_FILE" 2>/dev/null || stat -f%z "$ISO_FILE")
ISO_FILENAME=$(basename "$ISO_FILE")

log_info "Filename: $ISO_FILENAME"
log_info "Size:     $(numfmt --to=iec-i --suffix=B $ISO_SIZE 2>/dev/null || echo "${ISO_SIZE} bytes")"
log_info "SHA256:   $ISO_SHA256"

# =============================================================================
# Publish to Server
# =============================================================================

if [ "$DRY_RUN" = true ]; then
    log_warn "Dry run - skipping upload"
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    Dry Run Complete                           ║${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║  ISO:      $ISO_FILENAME${NC}"
    echo -e "${GREEN}║  Version:  $VERSION${NC}"
    echo -e "${GREEN}║  SHA256:   ${ISO_SHA256:0:16}...${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║  Would upload to: $UPDATE_SERVER/api/v1/iso/publish${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    exit 0
fi

log_step "Publishing to $UPDATE_SERVER..."

# Upload ISO with multipart form
RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $PUBLISH_TOKEN" \
    -F "iso=@$ISO_FILE" \
    -F "version=$VERSION" \
    -F "sha256=$ISO_SHA256" \
    "$UPDATE_SERVER/api/v1/iso/publish")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    log_info "Upload successful!"
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    Publish Complete!                          ║${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║  ISO:      $ISO_FILENAME${NC}"
    echo -e "${GREEN}║  Version:  $VERSION${NC}"
    echo -e "${GREEN}║  Server:   $UPDATE_SERVER${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║  Download URLs:                                               ║${NC}"
    echo -e "${GREEN}║    Latest:  $UPDATE_SERVER/api/v1/iso/latest${NC}"
    echo -e "${GREEN}║    Direct:  $UPDATE_SERVER/api/v1/iso/download/$ISO_FILENAME${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
else
    log_error "Upload failed with HTTP $HTTP_CODE"
    echo "$BODY"
    exit 1
fi
