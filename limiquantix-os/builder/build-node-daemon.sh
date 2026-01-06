#!/bin/bash
# =============================================================================
# Quantix-OS Node Daemon Builder
# =============================================================================
# Builds the Rust node daemon and copies it to the overlay.
#
# Usage: ./build-node-daemon.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
AGENT_DIR="$(dirname "$WORK_DIR")/agent"
OUTPUT_DIR="${WORK_DIR}/overlay/usr/bin"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║             Quantix-OS Node Daemon Builder                    ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if agent project exists
if [ ! -d "$AGENT_DIR/limiquantix-node" ]; then
    echo "❌ Node daemon project not found at: $AGENT_DIR/limiquantix-node"
    echo "   Creating placeholder binary..."
    mkdir -p "$OUTPUT_DIR"
    
    # Create a simple placeholder script
    cat > "$OUTPUT_DIR/qx-node" << 'EOF'
#!/bin/sh
echo "Quantix-OS Node Daemon"
echo "This is a placeholder. Build the actual daemon with:"
echo "  cd agent && cargo build --release -p limiquantix-node"
exit 1
EOF
    chmod +x "$OUTPUT_DIR/qx-node"
    echo "✅ Placeholder created"
    exit 0
fi

echo "📦 Building Node Daemon from: $AGENT_DIR"

# Check for Rust
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust/Cargo not found. Please install Rust."
    exit 1
fi

# Build
echo "🔨 Building node daemon..."
cd "$AGENT_DIR"

# Try to build for musl if available, otherwise use default target
if rustup target list | grep -q "x86_64-unknown-linux-musl (installed)"; then
    echo "   Using musl target for static linking..."
    cargo build --release -p limiquantix-node --target x86_64-unknown-linux-musl
    BINARY_PATH="$AGENT_DIR/target/x86_64-unknown-linux-musl/release/limiquantix-node"
else
    echo "   Using default target..."
    cargo build --release -p limiquantix-node
    BINARY_PATH="$AGENT_DIR/target/release/limiquantix-node"
fi

# Copy to overlay
echo "📋 Copying to overlay..."
mkdir -p "$OUTPUT_DIR"
cp "$BINARY_PATH" "$OUTPUT_DIR/qx-node"
chmod +x "$OUTPUT_DIR/qx-node"

# Calculate size
BINARY_SIZE=$(du -h "$OUTPUT_DIR/qx-node" | cut -f1)

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    Build Complete!                            ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Output: $OUTPUT_DIR/qx-node"
echo "║  Size:   $BINARY_SIZE"
echo "╚═══════════════════════════════════════════════════════════════╝"
