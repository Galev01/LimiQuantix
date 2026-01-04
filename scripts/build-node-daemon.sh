#!/bin/bash
# =============================================================================
# BUILD NODE DAEMON
# =============================================================================
# This script builds the Quantix Node Daemon with proper proto regeneration.
# Run this on the hypervisor after pulling changes.
#
# Usage:
#   ./scripts/build-node-daemon.sh [--debug]
#
# Options:
#   --debug    Build in debug mode (faster compilation, larger binary)
#
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
AGENT_DIR="$PROJECT_ROOT/agent"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Parse arguments
BUILD_MODE="release"
if [[ "$1" == "--debug" ]]; then
    BUILD_MODE="debug"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  QUANTIX NODE DAEMON BUILD"
echo "═══════════════════════════════════════════════════════════"
echo ""

cd "$AGENT_DIR"

# Step 1: Check for protoc
log_info "Checking for protobuf compiler..."
if ! command -v protoc &> /dev/null; then
    log_error "protoc not found! Install with: sudo apt install protobuf-compiler"
    exit 1
fi
PROTOC_VERSION=$(protoc --version)
log_success "Found $PROTOC_VERSION"

# Step 2: Force regenerate proto files
log_info "Regenerating protobuf files..."
PROTO_GEN_DIR="$AGENT_DIR/limiquantix-proto/src/generated"

if [ -d "$PROTO_GEN_DIR" ]; then
    log_warn "Removing stale generated files..."
    rm -rf "$PROTO_GEN_DIR"
fi

mkdir -p "$PROTO_GEN_DIR"

# Build the proto crate (triggers build.rs which generates the files)
log_info "Building limiquantix-proto..."

# Change to the proto crate directory for proper path resolution
cd "$AGENT_DIR/limiquantix-proto"

# Run cargo build from within the crate directory
if ! cargo build 2>&1; then
    log_error "Proto generation failed!"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Make sure protoc is installed: protoc --version"
    echo "  2. Check proto files exist in: $AGENT_DIR/limiquantix-proto/proto/"
    echo "  3. Try manually: cd $AGENT_DIR/limiquantix-proto && cargo build -vv"
    exit 1
fi

# Return to agent directory
cd "$AGENT_DIR"

if [ ! -f "$PROTO_GEN_DIR/limiquantix.node.v1.rs" ]; then
    log_error "Proto generation failed! Generated files not found."
    exit 1
fi

log_success "Proto files regenerated"

# Step 3: Build the node daemon
log_info "Building limiquantix-node ($BUILD_MODE mode)..."

if [[ "$BUILD_MODE" == "release" ]]; then
    cargo build --release --bin limiquantix-node --features libvirt
    BINARY_PATH="$AGENT_DIR/target/release/limiquantix-node"
else
    cargo build --bin limiquantix-node --features libvirt
    BINARY_PATH="$AGENT_DIR/target/debug/limiquantix-node"
fi

if [ ! -f "$BINARY_PATH" ]; then
    log_error "Build failed! Binary not found at $BINARY_PATH"
    exit 1
fi

# Get binary size
BINARY_SIZE=$(du -h "$BINARY_PATH" | cut -f1)

echo ""
echo "═══════════════════════════════════════════════════════════"
log_success "Build completed successfully!"
echo ""
echo "  Binary: $BINARY_PATH"
echo "  Size:   $BINARY_SIZE"
echo ""
echo "  To install as systemd service:"
echo "    sudo cp $BINARY_PATH /usr/local/bin/"
echo "    sudo systemctl restart limiquantix-node"
echo ""
echo "  To run directly:"
echo "    $BINARY_PATH --listen 0.0.0.0:9090 --control-plane http://YOUR_CONTROL_PLANE:8080"
echo "═══════════════════════════════════════════════════════════"
echo ""
