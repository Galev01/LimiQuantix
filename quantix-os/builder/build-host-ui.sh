#!/bin/bash
# =============================================================================
# Quantix-OS Host UI Builder
# =============================================================================
# Builds the React-based Host UI and copies it to the overlay.
# Uses Docker for consistent cross-platform builds.
#
# Usage: ./build-host-ui.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
HOST_UI_DIR="$(dirname "$WORK_DIR")/quantix-host-ui"
OUTPUT_DIR="${WORK_DIR}/overlay/usr/share/quantix-host-ui"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              Quantix-OS Host UI Builder                       ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if Host UI project exists
if [ ! -d "$HOST_UI_DIR" ]; then
    echo "❌ Host UI project not found at: $HOST_UI_DIR"
    echo "   Creating placeholder..."
    mkdir -p "$OUTPUT_DIR"
    cat > "$OUTPUT_DIR/index.html" << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Quantix-OS Host UI</title>
    <style>
        body {
            font-family: system-ui, sans-serif;
            background: #0a0e14;
            color: #e6edf3;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
            padding: 2rem;
        }
        h1 { color: #58a6ff; }
        p { color: #8b949e; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Quantix-OS</h1>
        <p>Host UI is not yet built.</p>
        <p>Run <code>make host-ui</code> to build the web interface.</p>
    </div>
</body>
</html>
EOF
    echo "✅ Placeholder created"
    exit 0
fi

echo "📦 Building Host UI from: $HOST_UI_DIR"

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker."
    exit 1
fi

# Build using Docker for consistent results
echo "🐳 Building with Docker (node:20-alpine)..."
docker run --rm \
    -v "${HOST_UI_DIR}:/app:rw" \
    -w /app \
    node:20-alpine \
    sh -c "npm install && npm run build"

# Copy to overlay
echo "📋 Copying to overlay..."
mkdir -p "$OUTPUT_DIR"
rm -rf "$OUTPUT_DIR"/*
cp -r "$HOST_UI_DIR/dist/"* "$OUTPUT_DIR/"

# Calculate size
UI_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)
FILE_COUNT=$(find "$OUTPUT_DIR" -type f | wc -l)

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    Build Complete!                            ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Output: $OUTPUT_DIR"
echo "║  Size:   $UI_SIZE ($FILE_COUNT files)"
echo "╚═══════════════════════════════════════════════════════════════╝"
