#!/bin/bash
# =============================================================================
# Quantix-OS Node Daemon Builder
# =============================================================================
# Builds the Rust node daemon for Alpine Linux (musl libc) and copies it to
# the overlay.
#
# IMPORTANT: Quantix-OS uses Alpine Linux which uses musl libc, NOT glibc.
# The binary MUST be compiled with the musl target to run on Quantix-OS hosts.
#
# Prerequisites (Ubuntu/Debian):
#   sudo apt install musl-tools
#   rustup target add x86_64-unknown-linux-musl
#
# Usage: ./build-node-daemon.sh [--skip-musl-check]
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
AGENT_DIR="$(dirname "$WORK_DIR")/agent"
OUTPUT_DIR="${WORK_DIR}/overlay/usr/bin"
MUSL_TARGET="x86_64-unknown-linux-musl"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║             Quantix-OS Node Daemon Builder                    ║"
echo "║         (Building for Alpine Linux / musl libc)               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if agent project exists
if [ ! -d "$AGENT_DIR/limiquantix-node" ]; then
    echo -e "${RED}❌ Node daemon project not found at: $AGENT_DIR/limiquantix-node${NC}"
    echo "   Creating placeholder binary..."
    mkdir -p "$OUTPUT_DIR"
    
    # Create a simple placeholder script
    cat > "$OUTPUT_DIR/qx-node" << 'EOF'
#!/bin/sh
echo "Quantix-OS Node Daemon"
echo "This is a placeholder. Build the actual daemon with:"
echo "  cd Quantix-OS/builder && ./build-node-daemon.sh"
exit 1
EOF
    chmod +x "$OUTPUT_DIR/qx-node"
    echo "✅ Placeholder created"
    exit 0
fi

echo "📦 Building Node Daemon from: $AGENT_DIR"

# Check for Rust
if ! command -v cargo &> /dev/null; then
    echo -e "${RED}❌ Rust/Cargo not found. Please install Rust.${NC}"
    exit 1
fi

# Check for musl target (REQUIRED for Alpine Linux)
echo "🔍 Checking musl target..."
if ! rustup target list --installed | grep -q "$MUSL_TARGET"; then
    echo -e "${YELLOW}⚠️  musl target not installed!${NC}"
    echo ""
    echo "Quantix-OS uses Alpine Linux which requires musl libc."
    echo "Binaries compiled with glibc will NOT work on Quantix-OS hosts."
    echo ""
    echo "To fix this, run:"
    echo -e "  ${GREEN}rustup target add $MUSL_TARGET${NC}"
    echo ""
    
    if [[ "$1" != "--skip-musl-check" ]]; then
        echo "On Ubuntu/Debian, you also need musl-tools:"
        echo -e "  ${GREEN}sudo apt install musl-tools${NC}"
        echo ""
        echo "Then re-run this script."
        exit 1
    else
        echo -e "${YELLOW}Skipping musl check (--skip-musl-check). Binary may not work on Alpine!${NC}"
    fi
fi

# Check for musl-gcc (needed for linking)
if ! command -v musl-gcc &> /dev/null; then
    echo -e "${YELLOW}⚠️  musl-gcc not found!${NC}"
    echo ""
    echo "Install musl-tools to get musl-gcc:"
    echo -e "  ${GREEN}sudo apt install musl-tools${NC}"
    echo ""
    
    if [[ "$1" != "--skip-musl-check" ]]; then
        exit 1
    fi
fi

echo -e "${GREEN}✅ musl target available${NC}"

# Build
echo ""
echo "🔨 Building node daemon for $MUSL_TARGET..."
cd "$AGENT_DIR"

# Set up cross-compilation environment
export CC_x86_64_unknown_linux_musl=musl-gcc
export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc

# Build with musl target
cargo build --release -p limiquantix-node --target "$MUSL_TARGET"
BINARY_PATH="$AGENT_DIR/target/$MUSL_TARGET/release/limiquantix-node"

if [ ! -f "$BINARY_PATH" ]; then
    echo -e "${RED}❌ Build failed! Binary not found at $BINARY_PATH${NC}"
    exit 1
fi

# Verify it's a static musl binary
echo ""
echo "🔍 Verifying binary..."
FILE_INFO=$(file "$BINARY_PATH")
if echo "$FILE_INFO" | grep -q "statically linked"; then
    echo -e "${GREEN}✅ Binary is statically linked (good for Alpine)${NC}"
elif echo "$FILE_INFO" | grep -q "dynamically linked"; then
    # Check if it's linked against musl
    if ldd "$BINARY_PATH" 2>/dev/null | grep -q "musl"; then
        echo -e "${GREEN}✅ Binary is linked against musl${NC}"
    else
        echo -e "${YELLOW}⚠️  Binary may be linked against glibc - verify it works on Alpine${NC}"
    fi
fi

# Copy to overlay
echo ""
echo "📋 Copying to overlay..."
mkdir -p "$OUTPUT_DIR"
cp "$BINARY_PATH" "$OUTPUT_DIR/qx-node"
chmod +x "$OUTPUT_DIR/qx-node"

# Strip the binary to reduce size
if command -v strip &> /dev/null; then
    echo "📦 Stripping binary to reduce size..."
    strip "$OUTPUT_DIR/qx-node" 2>/dev/null || true
fi

# Calculate size
BINARY_SIZE=$(du -h "$OUTPUT_DIR/qx-node" | cut -f1)

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    Build Complete!                            ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Target:  $MUSL_TARGET"
echo "║  Output:  $OUTPUT_DIR/qx-node"
echo "║  Size:    $BINARY_SIZE"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "The binary is now ready for Quantix-OS (Alpine Linux)."
echo "Run ./build-iso.sh to create the ISO with this binary."
