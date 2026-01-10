#!/bin/bash
# =============================================================================
# Quantix-vDC Version Management
# =============================================================================
# Manages semantic versioning with auto-increment for Quantix-vDC builds.
#
# Version Format: MAJOR.MINOR.PATCH
#   - PATCH: 1-100, auto-increments on each build
#   - MINOR: 0-9, increments when PATCH > 100
#   - MAJOR: Increments when MINOR > 9 (requires manual decision typically)
#
# Usage:
#   ./version.sh get           - Get current version
#   ./version.sh increment     - Increment patch version
#   ./version.sh set X.Y.Z     - Set specific version
#   ./version.sh bump minor    - Bump minor version
#   ./version.sh bump major    - Bump major version
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="${SCRIPT_DIR}/../VERSION"

# Ensure VERSION file exists
if [ ! -f "$VERSION_FILE" ]; then
    echo "0.0.1" > "$VERSION_FILE"
fi

get_version() {
    cat "$VERSION_FILE" | tr -d '[:space:]'
}

set_version() {
    local new_version="$1"
    echo "$new_version" > "$VERSION_FILE"
    echo "$new_version"
}

increment_patch() {
    local current=$(get_version)
    local major=$(echo "$current" | cut -d. -f1)
    local minor=$(echo "$current" | cut -d. -f2)
    local patch=$(echo "$current" | cut -d. -f3)
    
    # Increment patch
    patch=$((patch + 1))
    
    # Roll over logic: PATCH > 100 -> reset PATCH, increment MINOR
    if [ "$patch" -gt 100 ]; then
        patch=1
        minor=$((minor + 1))
        
        # MINOR > 9 -> reset MINOR, increment MAJOR
        if [ "$minor" -gt 9 ]; then
            minor=0
            major=$((major + 1))
        fi
    fi
    
    local new_version="${major}.${minor}.${patch}"
    set_version "$new_version"
}

bump_minor() {
    local current=$(get_version)
    local major=$(echo "$current" | cut -d. -f1)
    local minor=$(echo "$current" | cut -d. -f2)
    
    minor=$((minor + 1))
    if [ "$minor" -gt 9 ]; then
        minor=0
        major=$((major + 1))
    fi
    
    local new_version="${major}.${minor}.1"
    set_version "$new_version"
}

bump_major() {
    local current=$(get_version)
    local major=$(echo "$current" | cut -d. -f1)
    
    major=$((major + 1))
    
    local new_version="${major}.0.1"
    set_version "$new_version"
}

# Main command handler
case "${1:-get}" in
    get)
        get_version
        ;;
    increment)
        increment_patch
        ;;
    set)
        if [ -z "$2" ]; then
            echo "Usage: $0 set X.Y.Z" >&2
            exit 1
        fi
        set_version "$2"
        ;;
    bump)
        case "$2" in
            minor)
                bump_minor
                ;;
            major)
                bump_major
                ;;
            *)
                echo "Usage: $0 bump [minor|major]" >&2
                exit 1
                ;;
        esac
        ;;
    *)
        echo "Usage: $0 {get|increment|set|bump}" >&2
        exit 1
        ;;
esac
