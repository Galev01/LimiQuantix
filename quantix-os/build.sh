#!/bin/bash
# =============================================================================
# Quantix-OS Complete Build Script
# =============================================================================
# This script builds Quantix-OS from scratch, handling all dependencies
# and running everything in Docker for reproducibility.
#
# Usage:
#   ./build.sh              # Full build
#   ./build.sh --clean      # Clean and rebuild
#   ./build.sh --iso-only   # Only rebuild ISO (skip squashfs if exists)
#
# Requirements:
#   - Docker installed and running
#   - Git (for pulling latest changes)
#   - ~2GB disk space
#
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
VERSION="${VERSION:-1.0.0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
BUILDER_IMAGE="quantix-builder"

# Parse arguments
CLEAN_BUILD=false
ISO_ONLY=false
SKIP_PULL=false

for arg in "$@"; do
    case $arg in
        --clean)
            CLEAN_BUILD=true
            ;;
        --iso-only)
            ISO_ONLY=true
            ;;
        --skip-pull)
            SKIP_PULL=true
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --clean      Clean all build artifacts before building"
            echo "  --iso-only   Only rebuild ISO (reuse existing squashfs)"
            echo "  --skip-pull  Skip git pull"
            echo "  --help       Show this help"
            exit 0
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------

print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════════════╗"
    echo "║                                                                   ║"
    echo "║     ██████╗ ██╗   ██╗ █████╗ ███╗   ██╗████████╗██╗██╗  ██╗      ║"
    echo "║    ██╔═══██╗██║   ██║██╔══██╗████╗  ██║╚══██╔══╝██║╚██╗██╔╝      ║"
    echo "║    ██║   ██║██║   ██║███████║██╔██╗ ██║   ██║   ██║ ╚███╔╝       ║"
    echo "║    ██║▄▄ ██║██║   ██║██╔══██║██║╚██╗██║   ██║   ██║ ██╔██╗       ║"
    echo "║    ╚██████╔╝╚██████╔╝██║  ██║██║ ╚████║   ██║   ██║██╔╝ ██╗      ║"
    echo "║     ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚═╝  ╚═╝      ║"
    echo "║                                                                   ║"
    echo "║                    Quantix-OS Build System                        ║"
    echo "║                        Version ${VERSION}                             ║"
    echo "║                                                                   ║"
    echo "╚═══════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

log_step() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}▶ $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_info() {
    echo -e "${CYAN}  ℹ $1${NC}"
}

log_success() {
    echo -e "${GREEN}  ✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}  ⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}  ❌ $1${NC}"
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running. Please start Docker."
        exit 1
    fi
    
    log_success "Docker is available"
}

# -----------------------------------------------------------------------------
# Main Build Process
# -----------------------------------------------------------------------------

print_banner

cd "$SCRIPT_DIR"

# Step 0: Check prerequisites
log_step "Step 0: Checking prerequisites"
check_docker

# Step 1: Pull latest changes (optional)
if [ "$SKIP_PULL" = false ]; then
    log_step "Step 1: Pulling latest changes from git"
    if [ -d "../.git" ]; then
        cd ..
        git fetch origin
        git reset --hard origin/main
        git clean -fd
        cd "$SCRIPT_DIR"
        log_success "Repository updated"
    else
        log_warning "Not a git repository, skipping pull"
    fi
else
    log_step "Step 1: Skipping git pull (--skip-pull)"
fi

# Step 2: Clean if requested
if [ "$CLEAN_BUILD" = true ]; then
    log_step "Step 2: Cleaning previous build artifacts"
    rm -rf "${OUTPUT_DIR}"/*.iso
    rm -rf "${OUTPUT_DIR}"/*.squashfs
    rm -rf "${OUTPUT_DIR}"/initramfs.img
    rm -rf .rootfs .iso
    log_success "Clean complete"
else
    log_step "Step 2: Skipping clean (use --clean to force)"
fi

# Step 3: Build Docker images
log_step "Step 3: Building Docker build environments"
docker build -t "${BUILDER_IMAGE}" -f builder/Dockerfile builder/
log_success "Docker image built: ${BUILDER_IMAGE}"

# Build full builder image (includes Rust, Node.js)
FULL_BUILDER_IMAGE="quantix-full-builder"
log_info "Building full builder image (includes Rust, Node.js)..."
docker build -t "${FULL_BUILDER_IMAGE}" -f builder/Dockerfile.full builder/
log_success "Docker image built: ${FULL_BUILDER_IMAGE}"

# Step 4: Make scripts executable
log_step "Step 4: Setting script permissions"
chmod +x builder/*.sh 2>/dev/null || true
chmod +x installer/*.sh 2>/dev/null || true
chmod +x overlay/usr/local/bin/* 2>/dev/null || true
chmod +x overlay/etc/init.d/* 2>/dev/null || true
chmod +x overlay/etc/local.d/*.start 2>/dev/null || true
chmod +x initramfs/init 2>/dev/null || true
log_success "Permissions set"

# Step 4b: Build components (Node Daemon, Host UI) inside Docker
log_step "Step 4b: Building Quantix-OS components (Node Daemon, Host UI)"
log_info "This may take several minutes on first run..."

# Mount the entire repo so we can access agent/ and quantix-host-ui/
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
docker run --rm --network=host \
    -v "${REPO_ROOT}:/work" \
    -w /work/quantix-os \
    "${FULL_BUILDER_IMAGE}" \
    /bin/bash ./builder/build-all-components.sh

log_success "Components built"

# Step 5: Build squashfs
mkdir -p "${OUTPUT_DIR}"

if [ "$ISO_ONLY" = true ] && [ -f "${OUTPUT_DIR}/system-${VERSION}.squashfs" ]; then
    log_step "Step 5: Skipping squashfs (--iso-only, file exists)"
else
    log_step "Step 5: Building root filesystem (squashfs)"
    docker run --rm --privileged \
        -v "${SCRIPT_DIR}:/work" \
        -v "${OUTPUT_DIR}:/output" \
        -w /work \
        "${BUILDER_IMAGE}" \
        /bin/bash ./builder/build-squashfs.sh "${VERSION}"
    log_success "Squashfs built"
fi

# Step 6: Build ISO
log_step "Step 6: Building bootable ISO"
docker run --rm --privileged \
    -v "${SCRIPT_DIR}:/work" \
    -v "${OUTPUT_DIR}:/output" \
    -w /work \
    "${BUILDER_IMAGE}" \
    /bin/bash ./builder/build-iso.sh "${VERSION}"

# Step 7: Verify output
log_step "Step 7: Verifying build output"

ISO_FILE="${OUTPUT_DIR}/quantix-os-${VERSION}.iso"
SQUASHFS_FILE="${OUTPUT_DIR}/system-${VERSION}.squashfs"

if [ -f "$ISO_FILE" ]; then
    ISO_SIZE=$(du -h "$ISO_FILE" | cut -f1)
    log_success "ISO created: $ISO_FILE ($ISO_SIZE)"
else
    log_error "ISO file not found!"
    
    # Debug: show what's in output
    log_info "Contents of output directory:"
    ls -la "${OUTPUT_DIR}/" 2>/dev/null || echo "  (empty or not found)"
    exit 1
fi

if [ -f "$SQUASHFS_FILE" ]; then
    SQ_SIZE=$(du -h "$SQUASHFS_FILE" | cut -f1)
    log_success "Squashfs: $SQUASHFS_FILE ($SQ_SIZE)"
fi

# Final summary
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                     BUILD SUCCESSFUL! 🎉                          ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${CYAN}ISO File:${NC}     ${ISO_FILE}"
echo -e "${GREEN}║${NC}  ${CYAN}ISO Size:${NC}     ${ISO_SIZE}"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${YELLOW}To test in QEMU:${NC}"
echo -e "${GREEN}║${NC}    qemu-system-x86_64 -enable-kvm -m 4G -cdrom ${ISO_FILE}"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${YELLOW}To deploy to USB (recommended):${NC}"
echo -e "${GREEN}║${NC}    sudo ./builder/deploy-usb.sh /dev/sdX"
echo -e "${GREEN}║${NC}    # Or with verification:"
echo -e "${GREEN}║${NC}    sudo ./builder/deploy-usb.sh --verify /dev/sdX"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${YELLOW}To list USB devices:${NC}"
echo -e "${GREEN}║${NC}    sudo ./builder/deploy-usb.sh --list"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
