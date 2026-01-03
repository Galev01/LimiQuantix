#!/bin/bash
# Debug script to inspect cloud-init ISO contents
# Usage: ./debug-cloudinit.sh /path/to/cloud-init.iso
#
# This script extracts and displays the contents of a cloud-init NoCloud ISO
# to help debug provisioning issues.

set -e

ISO_PATH="$1"

if [ -z "$ISO_PATH" ]; then
    echo "Usage: $0 <path-to-cloud-init.iso>"
    echo ""
    echo "Example: $0 /var/lib/limiquantix/images/vm-123/cloud-init.iso"
    exit 1
fi

if [ ! -f "$ISO_PATH" ]; then
    echo "Error: File not found: $ISO_PATH"
    exit 1
fi

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "=========================================="
echo "Cloud-Init ISO Debug Tool"
echo "=========================================="
echo ""
echo "ISO Path: $ISO_PATH"
echo "ISO Size: $(ls -lh "$ISO_PATH" | awk '{print $5}')"
echo ""

# Mount or extract the ISO
echo "Extracting ISO contents..."
if command -v 7z &> /dev/null; then
    7z x -o"$TEMP_DIR" "$ISO_PATH" > /dev/null 2>&1
elif command -v bsdtar &> /dev/null; then
    bsdtar -xf "$ISO_PATH" -C "$TEMP_DIR"
else
    # Try mounting (requires root on most systems)
    MOUNT_DIR="$TEMP_DIR/mount"
    mkdir -p "$MOUNT_DIR"
    if sudo mount -o loop,ro "$ISO_PATH" "$MOUNT_DIR" 2>/dev/null; then
        cp -r "$MOUNT_DIR"/* "$TEMP_DIR/"
        sudo umount "$MOUNT_DIR"
    else
        echo "Error: Cannot extract ISO. Install 7z or bsdtar, or run as root."
        exit 1
    fi
fi

echo ""
echo "=========================================="
echo "FILES IN ISO:"
echo "=========================================="
ls -la "$TEMP_DIR"

echo ""
echo "=========================================="
echo "META-DATA:"
echo "=========================================="
if [ -f "$TEMP_DIR/meta-data" ]; then
    cat "$TEMP_DIR/meta-data"
else
    echo "(not found)"
fi

echo ""
echo "=========================================="
echo "USER-DATA:"
echo "=========================================="
if [ -f "$TEMP_DIR/user-data" ]; then
    cat "$TEMP_DIR/user-data"
else
    echo "(not found)"
fi

echo ""
echo "=========================================="
echo "NETWORK-CONFIG:"
echo "=========================================="
if [ -f "$TEMP_DIR/network-config" ]; then
    cat "$TEMP_DIR/network-config"
else
    echo "(not found)"
fi

echo ""
echo "=========================================="
echo "VENDOR-DATA:"
echo "=========================================="
if [ -f "$TEMP_DIR/vendor-data" ]; then
    cat "$TEMP_DIR/vendor-data"
else
    echo "(not found)"
fi

echo ""
echo "=========================================="
echo "VALIDATION:"
echo "=========================================="

# Check if user-data starts with #cloud-config
if [ -f "$TEMP_DIR/user-data" ]; then
    FIRST_LINE=$(head -n1 "$TEMP_DIR/user-data")
    if [ "$FIRST_LINE" = "#cloud-config" ]; then
        echo "✓ user-data starts with #cloud-config"
    else
        echo "✗ user-data does NOT start with #cloud-config (got: $FIRST_LINE)"
    fi
    
    # Check for common issues
    if grep -q "plain_text_passwd" "$TEMP_DIR/user-data" 2>/dev/null; then
        echo "✗ WARNING: 'plain_text_passwd' found - this is NOT a valid cloud-init field!"
        echo "  Use 'chpasswd.list' instead: "
        echo "    chpasswd:"
        echo "      list:"
        echo "        - username:password"
    fi
    
    if grep -q "chpasswd:" "$TEMP_DIR/user-data" 2>/dev/null; then
        echo "✓ chpasswd section found"
        grep -A5 "chpasswd:" "$TEMP_DIR/user-data" | head -6
    else
        echo "⚠ No chpasswd section - password won't be set"
    fi
    
    if grep -q "ssh_pwauth:" "$TEMP_DIR/user-data" 2>/dev/null; then
        SSH_PWAUTH=$(grep "ssh_pwauth:" "$TEMP_DIR/user-data")
        echo "✓ SSH password auth: $SSH_PWAUTH"
    else
        echo "⚠ ssh_pwauth not set - SSH password login may be disabled"
    fi
    
    if grep -q "lock_passwd: false" "$TEMP_DIR/user-data" 2>/dev/null; then
        echo "✓ Password login enabled (lock_passwd: false)"
    else
        echo "⚠ lock_passwd may not be set - password login could be locked"
    fi
fi

echo ""
echo "Done!"
