#!/bin/bash
# =============================================================================
# Quantix-OS Squashfs Builder
# =============================================================================
# Creates an Alpine Linux-based rootfs with KVM virtualization stack,
# then packages it as a squashfs image.
#
# Usage: ./build-squashfs.sh [VERSION]
# =============================================================================

set -e

VERSION="${1:-1.0.0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
ROOTFS_DIR="/rootfs"
OUTPUT_DIR="/output"
SQUASHFS_NAME="system-${VERSION}.squashfs"

# Alpine version
ALPINE_VERSION="3.20"
ALPINE_MIRROR="https://dl-cdn.alpinelinux.org/alpine"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           Quantix-OS Squashfs Builder v${VERSION}                   ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Create base Alpine rootfs
# -----------------------------------------------------------------------------
echo "📦 Step 1: Creating Alpine rootfs..."

# Clean any previous build
rm -rf "${ROOTFS_DIR}"
mkdir -p "${ROOTFS_DIR}"

# Initialize APK in the rootfs
mkdir -p "${ROOTFS_DIR}/etc/apk"
echo "${ALPINE_MIRROR}/v${ALPINE_VERSION}/main" > "${ROOTFS_DIR}/etc/apk/repositories"
echo "${ALPINE_MIRROR}/v${ALPINE_VERSION}/community" >> "${ROOTFS_DIR}/etc/apk/repositories"

# Copy APK keys
cp -a /etc/apk/keys "${ROOTFS_DIR}/etc/apk/"

# Install base system
apk --root "${ROOTFS_DIR}" --initdb add alpine-base

echo "✅ Base rootfs created"

# -----------------------------------------------------------------------------
# Step 2: Install packages
# -----------------------------------------------------------------------------
echo "📦 Step 2: Installing packages..."

# Read package list (skip comments and empty lines)
PACKAGES=$(grep -v '^#' "${WORK_DIR}/profiles/quantix/packages.conf" | grep -v '^$' | tr '\n' ' ')

# Critical packages that MUST be installed (system won't boot without these)
CRITICAL_PACKAGES="linux-lts linux-firmware openrc busybox musl e2fsprogs"

echo "   Installing critical packages first..."
for pkg in ${CRITICAL_PACKAGES}; do
    apk --root "${ROOTFS_DIR}" add "$pkg" || {
        echo "❌ CRITICAL ERROR: Failed to install $pkg - system will not boot!"
        exit 1
    }
done
echo "   ✅ Critical packages installed"

# Verify kernel and modules were installed
if [ ! -d "${ROOTFS_DIR}/lib/modules" ]; then
    echo "❌ CRITICAL ERROR: No kernel modules found after installing linux-lts!"
    echo "   Checking installed packages..."
    apk --root "${ROOTFS_DIR}" info 2>/dev/null | head -20
    exit 1
fi

KERNEL_VERSION=$(ls "${ROOTFS_DIR}/lib/modules" 2>/dev/null | head -1)
if [ -z "$KERNEL_VERSION" ]; then
    echo "❌ CRITICAL ERROR: Kernel modules directory is empty!"
    exit 1
fi
echo "   ✅ Kernel modules installed: ${KERNEL_VERSION}"

# Install remaining packages (allow individual failures)
echo "   Installing additional packages..."
FAILED_PKGS=""
for pkg in ${PACKAGES}; do
    # Skip critical packages (already installed)
    case " ${CRITICAL_PACKAGES} " in
        *" $pkg "*) continue ;;
    esac
    
    apk --root "${ROOTFS_DIR}" add "$pkg" 2>/dev/null || {
        FAILED_PKGS="${FAILED_PKGS} $pkg"
    }
done

if [ -n "$FAILED_PKGS" ]; then
    echo "   ⚠️  Some optional packages failed:${FAILED_PKGS}"
else
    echo "   ✅ All additional packages installed"
fi

echo "✅ Packages installed"

# -----------------------------------------------------------------------------
# Step 3: Apply overlay files
# -----------------------------------------------------------------------------
echo "📦 Step 3: Applying overlay files..."

# Copy overlay files
if [ -d "${WORK_DIR}/overlay" ]; then
    cp -a "${WORK_DIR}/overlay/"* "${ROOTFS_DIR}/"
    echo "✅ Overlay files applied"
else
    echo "⚠️  No overlay directory found"
fi

# Make scripts executable
chmod +x "${ROOTFS_DIR}/usr/local/bin/"* 2>/dev/null || true
chmod +x "${ROOTFS_DIR}/etc/init.d/"* 2>/dev/null || true
chmod +x "${ROOTFS_DIR}/etc/local.d/"* 2>/dev/null || true

# -----------------------------------------------------------------------------
# Step 4: Configure system
# -----------------------------------------------------------------------------
echo "📦 Step 4: Configuring system..."

# Set timezone
ln -sf /usr/share/zoneinfo/UTC "${ROOTFS_DIR}/etc/localtime"
echo "UTC" > "${ROOTFS_DIR}/etc/timezone"

# Configure OpenRC
mkdir -p "${ROOTFS_DIR}/run/openrc"
touch "${ROOTFS_DIR}/run/openrc/softlevel"

# Enable essential services
chroot "${ROOTFS_DIR}" /sbin/rc-update add devfs sysinit || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add dmesg sysinit || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add mdev sysinit || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add hwdrivers sysinit || true

chroot "${ROOTFS_DIR}" /sbin/rc-update add modules boot || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add sysctl boot || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add hostname boot || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add bootmisc boot || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add syslog boot || true

chroot "${ROOTFS_DIR}" /sbin/rc-update add dbus default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add libvirtd default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add ovsdb-server default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add ovs-vswitchd default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add seatd default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add chronyd default || true

# Quantix-OS custom services
chroot "${ROOTFS_DIR}" /sbin/rc-update add quantix-network boot || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add quantix-node default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add quantix-console default || true

chroot "${ROOTFS_DIR}" /sbin/rc-update add mount-ro shutdown || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add killprocs shutdown || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add savecache shutdown || true

echo "✅ System configured"

# -----------------------------------------------------------------------------
# Step 5: Create required directories
# -----------------------------------------------------------------------------
echo "📦 Step 5: Creating directories..."

mkdir -p "${ROOTFS_DIR}/quantix"
mkdir -p "${ROOTFS_DIR}/quantix/certificates"
mkdir -p "${ROOTFS_DIR}/data"
mkdir -p "${ROOTFS_DIR}/data/vms"
mkdir -p "${ROOTFS_DIR}/data/isos"
mkdir -p "${ROOTFS_DIR}/data/images"
mkdir -p "${ROOTFS_DIR}/data/backups"
mkdir -p "${ROOTFS_DIR}/var/log"
mkdir -p "${ROOTFS_DIR}/var/lib/libvirt"
mkdir -p "${ROOTFS_DIR}/var/lib/quantix"
mkdir -p "${ROOTFS_DIR}/run/user/0"
mkdir -p "${ROOTFS_DIR}/run/libvirt"
mkdir -p "${ROOTFS_DIR}/run/openvswitch"

# Set permissions
chmod 700 "${ROOTFS_DIR}/quantix"
chmod 700 "${ROOTFS_DIR}/quantix/certificates"
chmod 755 "${ROOTFS_DIR}/data"
chmod 700 "${ROOTFS_DIR}/run/user/0"

# Create input group and add root for GUI console access
chroot "${ROOTFS_DIR}" addgroup -S input 2>/dev/null || true
chroot "${ROOTFS_DIR}" addgroup -S video 2>/dev/null || true
chroot "${ROOTFS_DIR}" addgroup -S seat 2>/dev/null || true
chroot "${ROOTFS_DIR}" adduser root input 2>/dev/null || true
chroot "${ROOTFS_DIR}" adduser root video 2>/dev/null || true
chroot "${ROOTFS_DIR}" adduser root seat 2>/dev/null || true

echo "✅ Directories created and permissions set"

# -----------------------------------------------------------------------------
# Step 6: Write version info
# -----------------------------------------------------------------------------
echo "📦 Step 6: Writing version info..."

cat > "${ROOTFS_DIR}/etc/quantix-release" << EOF
QUANTIX_VERSION="${VERSION}"
QUANTIX_CODENAME="genesis"
QUANTIX_BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ALPINE_VERSION="${ALPINE_VERSION}"
EOF

echo "✅ Version info written"

# -----------------------------------------------------------------------------
# Step 7: Clean up
# -----------------------------------------------------------------------------
echo "📦 Step 7: Cleaning up..."

# Remove APK cache
rm -rf "${ROOTFS_DIR}/var/cache/apk/"*

# Remove package manager (security hardening)
# Note: Uncomment for production builds
# rm -f "${ROOTFS_DIR}/sbin/apk"
# rm -rf "${ROOTFS_DIR}/etc/apk"
# rm -rf "${ROOTFS_DIR}/lib/apk"

# Remove unnecessary files
rm -rf "${ROOTFS_DIR}/usr/share/doc/"*
rm -rf "${ROOTFS_DIR}/usr/share/man/"*
rm -rf "${ROOTFS_DIR}/usr/share/info/"*

# Clear logs
rm -rf "${ROOTFS_DIR}/var/log/"*

echo "✅ Cleanup complete"

# -----------------------------------------------------------------------------
# Step 8: Create squashfs
# -----------------------------------------------------------------------------
echo "📦 Step 8: Creating squashfs..."

mkdir -p "${OUTPUT_DIR}"

mksquashfs "${ROOTFS_DIR}" "${OUTPUT_DIR}/${SQUASHFS_NAME}" \
    -comp xz \
    -b 1M \
    -Xbcj x86 \
    -no-xattrs \
    -noappend

# Calculate size
SQUASHFS_SIZE=$(du -h "${OUTPUT_DIR}/${SQUASHFS_NAME}" | cut -f1)

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    Build Complete!                            ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Output: ${OUTPUT_DIR}/${SQUASHFS_NAME}"
echo "║  Size:   ${SQUASHFS_SIZE}"
echo "╚═══════════════════════════════════════════════════════════════╝"
