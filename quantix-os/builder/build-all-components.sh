#!/bin/bash
# =============================================================================
# Quantix-OS Component Builder
# =============================================================================
# Builds all Quantix-OS components (Node Daemon, Host UI) inside Docker.
# This script runs INSIDE the Docker container.
#
# Usage: ./builder/build-all-components.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$WORK_DIR")"
OVERLAY_DIR="${WORK_DIR}/overlay"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           Quantix-OS Component Builder                        ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "Working directory: ${WORK_DIR}"
echo "Repository root: ${REPO_ROOT}"
echo ""

# -----------------------------------------------------------------------------
# Build Node Daemon (Rust)
# -----------------------------------------------------------------------------
echo "📦 Building Node Daemon..."

NODE_DAEMON_DIR="${REPO_ROOT}/agent"
if [ -d "${NODE_DAEMON_DIR}/limiquantix-node" ]; then
    echo "   Found node daemon source at: ${NODE_DAEMON_DIR}"
    
    cd "${NODE_DAEMON_DIR}"
    
    # Build with static OpenSSL
    echo "   Compiling (this may take a few minutes)..."
    OPENSSL_STATIC=1 cargo build --release -p limiquantix-node 2>&1 | tail -20
    
    # Copy binary to overlay
    mkdir -p "${OVERLAY_DIR}/usr/bin"
    cp "${NODE_DAEMON_DIR}/target/release/limiquantix-node" "${OVERLAY_DIR}/usr/bin/qx-node"
    chmod +x "${OVERLAY_DIR}/usr/bin/qx-node"
    
    # Verify it's statically linked (for musl)
    if file "${OVERLAY_DIR}/usr/bin/qx-node" | grep -q "statically linked"; then
        echo "   ✅ Node daemon built (statically linked)"
    else
        echo "   ✅ Node daemon built (dynamically linked - OK for Alpine)"
    fi
    
    ls -lh "${OVERLAY_DIR}/usr/bin/qx-node"
else
    echo "   ⚠️  Node daemon source not found at ${NODE_DAEMON_DIR}"
    echo "   Creating placeholder..."
    mkdir -p "${OVERLAY_DIR}/usr/bin"
    cat > "${OVERLAY_DIR}/usr/bin/qx-node" << 'EOF'
#!/bin/sh
echo "Quantix-OS Node Daemon - Placeholder"
echo "The actual daemon was not built. Please rebuild with full sources."
exit 1
EOF
    chmod +x "${OVERLAY_DIR}/usr/bin/qx-node"
fi

# -----------------------------------------------------------------------------
# Build Host UI (Node.js/React)
# -----------------------------------------------------------------------------
echo ""
echo "📦 Building Host UI..."

HOST_UI_DIR="${REPO_ROOT}/quantix-host-ui"
if [ -d "${HOST_UI_DIR}" ] && [ -f "${HOST_UI_DIR}/package.json" ]; then
    echo "   Found Host UI source at: ${HOST_UI_DIR}"
    
    cd "${HOST_UI_DIR}"
    
    # Install dependencies and build
    echo "   Installing dependencies..."
    npm install --silent 2>&1 | tail -5
    
    echo "   Building production bundle..."
    npm run build 2>&1 | tail -10
    
    # Copy to overlay
    mkdir -p "${OVERLAY_DIR}/usr/share/quantix-host-ui"
    rm -rf "${OVERLAY_DIR}/usr/share/quantix-host-ui/"*
    cp -r "${HOST_UI_DIR}/dist/"* "${OVERLAY_DIR}/usr/share/quantix-host-ui/"
    
    echo "   ✅ Host UI built"
    ls -lh "${OVERLAY_DIR}/usr/share/quantix-host-ui/"
else
    echo "   ⚠️  Host UI source not found at ${HOST_UI_DIR}"
    echo "   Creating placeholder..."
    mkdir -p "${OVERLAY_DIR}/usr/share/quantix-host-ui"
    cat > "${OVERLAY_DIR}/usr/share/quantix-host-ui/index.html" << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Quantix-OS</title>
    <style>
        body { font-family: system-ui; background: #0d1117; color: #c9d1d9; 
               display: flex; justify-content: center; align-items: center; 
               height: 100vh; margin: 0; }
        .container { text-align: center; }
        h1 { color: #58a6ff; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Quantix-OS</h1>
        <p>Host UI placeholder - rebuild with full sources</p>
    </div>
</body>
</html>
EOF
fi

# -----------------------------------------------------------------------------
# Build Console TUI (Rust) - Optional
# -----------------------------------------------------------------------------
echo ""
echo "📦 Building Console TUI..."

CONSOLE_TUI_DIR="${WORK_DIR}/console-tui"
if [ -d "${CONSOLE_TUI_DIR}" ] && [ -f "${CONSOLE_TUI_DIR}/Cargo.toml" ]; then
    echo "   Found Console TUI source at: ${CONSOLE_TUI_DIR}"
    
    cd "${CONSOLE_TUI_DIR}"
    
    echo "   Compiling..."
    OPENSSL_STATIC=1 cargo build --release 2>&1 | tail -10 || {
        echo "   ⚠️  TUI build failed, skipping..."
    }
    
    if [ -f "${CONSOLE_TUI_DIR}/target/release/qx-console" ]; then
        mkdir -p "${OVERLAY_DIR}/usr/local/bin"
        cp "${CONSOLE_TUI_DIR}/target/release/qx-console" "${OVERLAY_DIR}/usr/local/bin/"
        chmod +x "${OVERLAY_DIR}/usr/local/bin/qx-console"
        echo "   ✅ Console TUI built"
    fi
else
    echo "   ⚠️  Console TUI source not found, skipping..."
fi

# -----------------------------------------------------------------------------
# Create symlinks for compatibility
# -----------------------------------------------------------------------------
echo ""
echo "📦 Creating compatibility symlinks..."

# The node daemon expects webui at /usr/share/quantix/webui
mkdir -p "${OVERLAY_DIR}/usr/share/quantix"
ln -sf ../quantix-host-ui "${OVERLAY_DIR}/usr/share/quantix/webui"
echo "   ✅ /usr/share/quantix/webui -> ../quantix-host-ui"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                 Component Build Complete                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "Built components:"
[ -f "${OVERLAY_DIR}/usr/bin/qx-node" ] && echo "  ✅ /usr/bin/qx-node"
[ -f "${OVERLAY_DIR}/usr/share/quantix-host-ui/index.html" ] && echo "  ✅ /usr/share/quantix-host-ui/"
[ -f "${OVERLAY_DIR}/usr/local/bin/qx-console" ] && echo "  ✅ /usr/local/bin/qx-console"
echo ""
