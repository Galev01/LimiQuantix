#!/bin/bash
# =============================================================================
# Quantix-vDC Rootfs Builder
# =============================================================================
# Creates an Alpine Linux-based rootfs for the Quantix-vDC control plane
# appliance, then packages it as a squashfs image for the installer ISO.
#
# Usage: ./build-rootfs.sh [VERSION]
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
echo "║         Quantix-vDC Rootfs Builder v${VERSION}                      ║"
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
PACKAGES=$(grep -v '^#' "${WORK_DIR}/profiles/packages.conf" | grep -v '^$' | tr '\n' ' ')

# Critical packages that MUST be installed
CRITICAL_PACKAGES="linux-lts openrc busybox musl e2fsprogs"

echo "   Installing critical packages first..."
for pkg in ${CRITICAL_PACKAGES}; do
    apk --root "${ROOTFS_DIR}" add "$pkg" || {
        echo "❌ CRITICAL ERROR: Failed to install $pkg!"
        exit 1
    }
done
echo "   ✅ Critical packages installed"

# Install remaining packages (allow individual failures for optional ones)
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
    cp -a "${WORK_DIR}/overlay/"* "${ROOTFS_DIR}/" 2>/dev/null || true
    echo "✅ Overlay files applied"
else
    echo "⚠️  No overlay directory found"
fi

# Make scripts executable
chmod +x "${ROOTFS_DIR}/usr/bin/"* 2>/dev/null || true
chmod +x "${ROOTFS_DIR}/etc/init.d/"* 2>/dev/null || true

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

# Enable essential services (sysinit)
chroot "${ROOTFS_DIR}" /sbin/rc-update add devfs sysinit || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add dmesg sysinit || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add mdev sysinit || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add hwdrivers sysinit || true

# Enable boot services
chroot "${ROOTFS_DIR}" /sbin/rc-update add modules boot || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add sysctl boot || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add hostname boot || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add bootmisc boot || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add networking boot || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add urandom boot || true

# Enable default services
chroot "${ROOTFS_DIR}" /sbin/rc-update add dbus default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add rsyslog default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add chronyd default || true

# Quantix-vDC services (enabled on first boot)
chroot "${ROOTFS_DIR}" /sbin/rc-update add quantix-firstboot boot || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add postgresql default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add redis default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add etcd default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add nginx default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add quantix-controlplane default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add quantix-console default || true

# Shutdown services
chroot "${ROOTFS_DIR}" /sbin/rc-update add mount-ro shutdown || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add killprocs shutdown || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add savecache shutdown || true

echo "✅ System configured"

# -----------------------------------------------------------------------------
# Step 5: Create required directories
# -----------------------------------------------------------------------------
echo "📦 Step 5: Creating directories..."

# Control plane directories
mkdir -p "${ROOTFS_DIR}/etc/quantix-vdc"
mkdir -p "${ROOTFS_DIR}/usr/bin"
mkdir -p "${ROOTFS_DIR}/usr/share/quantix-vdc/dashboard"

# Data directories (mounted on separate partition)
mkdir -p "${ROOTFS_DIR}/var/lib/postgresql/16/data"
mkdir -p "${ROOTFS_DIR}/var/lib/etcd"
mkdir -p "${ROOTFS_DIR}/var/lib/redis"
mkdir -p "${ROOTFS_DIR}/var/lib/quantix-vdc"
mkdir -p "${ROOTFS_DIR}/var/lib/quantix-vdc/certs"
mkdir -p "${ROOTFS_DIR}/var/lib/quantix-vdc/logs"

# Runtime directories
mkdir -p "${ROOTFS_DIR}/var/log"
mkdir -p "${ROOTFS_DIR}/run"

# Set permissions
chmod 700 "${ROOTFS_DIR}/var/lib/postgresql"
chmod 700 "${ROOTFS_DIR}/var/lib/etcd"
chmod 700 "${ROOTFS_DIR}/var/lib/redis"
chmod 700 "${ROOTFS_DIR}/var/lib/quantix-vdc"

echo "✅ Directories created"

# -----------------------------------------------------------------------------
# Step 6: Configure hostname and network defaults
# -----------------------------------------------------------------------------
echo "📦 Step 6: Configuring defaults..."

# Default hostname
echo "quantix-vdc" > "${ROOTFS_DIR}/etc/hostname"

# Hosts file
cat > "${ROOTFS_DIR}/etc/hosts" << 'EOF'
127.0.0.1       localhost
::1             localhost ip6-localhost ip6-loopback
ff02::1         ip6-allnodes
ff02::2         ip6-allrouters
EOF

# Default network config (DHCP on eth0)
cat > "${ROOTFS_DIR}/etc/network/interfaces" << 'EOF'
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
EOF

# Issue banner
cat > "${ROOTFS_DIR}/etc/issue" << 'EOF'

  ██████╗ ██╗   ██╗ █████╗ ███╗   ██╗████████╗██╗██╗  ██╗
 ██╔═══██╗██║   ██║██╔══██╗████╗  ██║╚══██╔══╝██║╚██╗██╔╝
 ██║   ██║██║   ██║███████║██╔██╗ ██║   ██║   ██║ ╚███╔╝ 
 ██║▄▄ ██║██║   ██║██╔══██║██║╚██╗██║   ██║   ██║ ██╔██╗ 
 ╚██████╔╝╚██████╔╝██║  ██║██║ ╚████║   ██║   ██║██╔╝ ██╗
  ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚═╝  ╚═╝

            Quantix-vDC Control Plane Appliance

EOF

echo "✅ Defaults configured"

# -----------------------------------------------------------------------------
# Step 7: Write version info
# -----------------------------------------------------------------------------
echo "📦 Step 7: Writing version info..."

cat > "${ROOTFS_DIR}/etc/quantix-vdc-release" << EOF
QUANTIX_VDC_VERSION="${VERSION}"
QUANTIX_VDC_CODENAME="genesis"
QUANTIX_VDC_BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ALPINE_VERSION="${ALPINE_VERSION}"
EOF

echo "✅ Version info written"

# -----------------------------------------------------------------------------
# Step 8: Clean up
# -----------------------------------------------------------------------------
echo "📦 Step 8: Cleaning up..."

# Remove APK cache
rm -rf "${ROOTFS_DIR}/var/cache/apk/"*

# Remove unnecessary files
rm -rf "${ROOTFS_DIR}/usr/share/doc/"*
rm -rf "${ROOTFS_DIR}/usr/share/man/"*
rm -rf "${ROOTFS_DIR}/usr/share/info/"*

# Clear logs
rm -rf "${ROOTFS_DIR}/var/log/"*

echo "✅ Cleanup complete"

# -----------------------------------------------------------------------------
# Step 9: Create squashfs
# -----------------------------------------------------------------------------
echo "📦 Step 9: Creating squashfs..."

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
echo "║                    Rootfs Build Complete!                     ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Output: ${OUTPUT_DIR}/${SQUASHFS_NAME}"
echo "║  Size:   ${SQUASHFS_SIZE}"
echo "╚═══════════════════════════════════════════════════════════════╝"
