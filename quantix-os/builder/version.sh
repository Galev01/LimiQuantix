#!/bin/bash
# =============================================================================
# Quantix-OS Version Management
# =============================================================================
# Manages semantic versioning with auto-increment for Quantix-OS builds.
#
# Version format: MAJOR.MINOR.PATCH
#   - PATCH increments from 001 to 100
#   - When PATCH reaches 100, MINOR increments and PATCH resets to 001
#   - When MINOR reaches 10, MAJOR increments and MINOR resets to 0
#
# Usage:
#   ./version.sh get          # Get current version
#   ./version.sh increment    # Increment version (returns new version)
#   ./version.sh set X.Y.Z    # Set specific version
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION_FILE="${SCRIPT_DIR}/../VERSION"

# Initialize version file if it doesn't exist
if [ ! -f "$VERSION_FILE" ]; then
    echo "0.0.1" > "$VERSION_FILE"
fi

get_version() {
    cat "$VERSION_FILE" | tr -d '\n\r '
}

set_version() {
    echo "$1" > "$VERSION_FILE"
    echo "$1"
}

increment_version() {
    local current=$(get_version)
    
    # Parse version components
    local major=$(echo "$current" | cut -d. -f1)
    local minor=$(echo "$current" | cut -d. -f2)
    local patch=$(echo "$current" | cut -d. -f3)
    
    # Remove leading zeros for arithmetic
    major=$((10#$major))
    minor=$((10#$minor))
    patch=$((10#$patch))
    
    # Increment patch
    patch=$((patch + 1))
    
    # Roll over logic
    if [ $patch -gt 100 ]; then
        patch=1
        minor=$((minor + 1))
    fi
    
    if [ $minor -gt 9 ]; then
        minor=0
        major=$((major + 1))
    fi
    
    # Format version (patch is always 3 digits for display, but stored as number)
    local new_version="${major}.${minor}.${patch}"
    
    set_version "$new_version"
}

# Main command handling
case "${1:-get}" in
    get)
        get_version
        ;;
    increment)
        increment_version
        ;;
    set)
        if [ -z "$2" ]; then
            echo "Usage: $0 set X.Y.Z" >&2
            exit 1
        fi
        set_version "$2"
        ;;
    *)
        echo "Usage: $0 {get|increment|set X.Y.Z}" >&2
        exit 1
        ;;
esac
