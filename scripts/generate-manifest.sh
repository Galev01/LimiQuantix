#!/bin/bash
# =============================================================================
# Quantix-OS Update Manifest Generator
# =============================================================================
# Generates a manifest.json from staged artifacts.
#
# Usage:
#   ./generate-manifest.sh [STAGING_DIR]
#
# Expects artifacts named:
#   - qx-node.tar.zst
#   - qx-console.tar.zst
#   - host-ui.tar.zst
# =============================================================================

set -e

STAGING_DIR="${1:-.}"
VERSION="${VERSION:-0.0.1}"
CHANNEL="${CHANNEL:-dev}"
PRODUCT="${PRODUCT:-quantix-os}"

# Function to get file info
get_file_info() {
    local file="$1"
    local name="$2"
    local install_path="$3"
    local restart_service="$4"
    
    if [ ! -f "$file" ]; then
        return 1
    fi
    
    local size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null)
    local sha256=$(sha256sum "$file" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$file" | cut -d' ' -f1)
    
    local service_json="null"
    if [ -n "$restart_service" ]; then
        service_json="\"$restart_service\""
    fi
    
    cat << EOF
    {
      "name": "$name",
      "version": "$VERSION",
      "artifact": "$(basename "$file")",
      "sha256": "$sha256",
      "size_bytes": $size,
      "install_path": "$install_path",
      "restart_service": $service_json,
      "backup_before_update": true,
      "permissions": "0755"
    }
EOF
}

# Generate manifest
cat << EOF
{
  "product": "$PRODUCT",
  "version": "$VERSION",
  "channel": "$CHANNEL",
  "release_date": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "update_type": "component",
  "components": [
EOF

FIRST=true

# qx-node
if [ -f "$STAGING_DIR/qx-node.tar.zst" ]; then
    [ "$FIRST" = false ] && echo ","
    FIRST=false
    get_file_info "$STAGING_DIR/qx-node.tar.zst" "qx-node" "/data/bin/qx-node" "quantix-node"
fi

# qx-console
if [ -f "$STAGING_DIR/qx-console.tar.zst" ]; then
    [ "$FIRST" = false ] && echo ","
    FIRST=false
    get_file_info "$STAGING_DIR/qx-console.tar.zst" "qx-console" "/data/bin/qx-console" "quantix-console"
fi

# host-ui
if [ -f "$STAGING_DIR/host-ui.tar.zst" ]; then
    [ "$FIRST" = false ] && echo ","
    FIRST=false
    get_file_info "$STAGING_DIR/host-ui.tar.zst" "host-ui" "/data/share/quantix-host-ui" ""
fi

cat << EOF

  ],
  "min_version": "0.0.1",
  "release_notes": "Quantix-OS $VERSION update for $CHANNEL channel"
}
EOF
