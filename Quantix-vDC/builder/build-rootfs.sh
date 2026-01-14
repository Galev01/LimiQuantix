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
# Step 2b: Download and bundle etcd (not in Alpine repos)
# -----------------------------------------------------------------------------
echo "📦 Step 2b: Downloading and bundling etcd..."

ETCD_VERSION="v3.5.17"
ETCD_ARCH="amd64"
ETCD_URL="https://github.com/etcd-io/etcd/releases/download/${ETCD_VERSION}/etcd-${ETCD_VERSION}-linux-${ETCD_ARCH}.tar.gz"

# Download etcd during build (so no network needed at first boot)
if ! wget -q "${ETCD_URL}" -O /tmp/etcd.tar.gz; then
    echo "⚠️  Warning: Failed to download etcd from GitHub"
    echo "   The appliance will attempt to download it on first boot"
else
    cd /tmp
    tar -xzf etcd.tar.gz
    
    # Copy etcd binaries to rootfs
    cp "etcd-${ETCD_VERSION}-linux-${ETCD_ARCH}/etcd" "${ROOTFS_DIR}/usr/bin/"
    cp "etcd-${ETCD_VERSION}-linux-${ETCD_ARCH}/etcdctl" "${ROOTFS_DIR}/usr/bin/"
    chmod +x "${ROOTFS_DIR}/usr/bin/etcd" "${ROOTFS_DIR}/usr/bin/etcdctl"
    
    # Create etcd OpenRC init script
    cat > "${ROOTFS_DIR}/etc/init.d/etcd" << 'ETCDINIT'
#!/sbin/openrc-run
name="etcd"
description="etcd distributed key-value store"
command="/usr/bin/etcd"
command_args="--data-dir=/var/lib/etcd --listen-client-urls=http://127.0.0.1:2379 --advertise-client-urls=http://127.0.0.1:2379"
command_background="yes"
pidfile="/run/etcd.pid"
output_log="/var/log/etcd.log"
error_log="/var/log/etcd.err"

depend() {
    need net localmount
    after quantix-firstboot
}

start_pre() {
    mkdir -p /var/lib/etcd
    chmod 700 /var/lib/etcd
}
ETCDINIT
    chmod +x "${ROOTFS_DIR}/etc/init.d/etcd"
    
    # Clean up
    rm -rf /tmp/etcd.tar.gz /tmp/etcd-${ETCD_VERSION}-linux-${ETCD_ARCH}
    
    echo "✅ etcd ${ETCD_VERSION} bundled into ISO"
fi

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
chroot "${ROOTFS_DIR}" /sbin/rc-update add local default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add networking default || true

# Quantix-vDC services (enabled on first boot)
chroot "${ROOTFS_DIR}" /sbin/rc-update add quantix-firstboot boot || true

# PostgreSQL - try both service names (Alpine 3.20 uses postgresql16)
chroot "${ROOTFS_DIR}" /sbin/rc-update add postgresql16 default 2>/dev/null || \
    chroot "${ROOTFS_DIR}" /sbin/rc-update add postgresql default 2>/dev/null || true

# Create symlink for postgresql service name compatibility
if [ -f "${ROOTFS_DIR}/etc/init.d/postgresql16" ] && [ ! -f "${ROOTFS_DIR}/etc/init.d/postgresql" ]; then
    ln -sf postgresql16 "${ROOTFS_DIR}/etc/init.d/postgresql"
fi

chroot "${ROOTFS_DIR}" /sbin/rc-update add redis default || true

# etcd is pre-bundled during ISO build
chroot "${ROOTFS_DIR}" /sbin/rc-update add etcd default 2>/dev/null || true

chroot "${ROOTFS_DIR}" /sbin/rc-update add nginx default || true
chroot "${ROOTFS_DIR}" /sbin/rc-update add quantix-controlplane default || true

# SSH - enabled by default for remote management
chroot "${ROOTFS_DIR}" /sbin/rc-update add sshd default || true

# Note: quantix-console is now run from /etc/inittab on tty1

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
mkdir -p "${ROOTFS_DIR}/etc/local.d"

# Set permissions
chmod 700 "${ROOTFS_DIR}/var/lib/postgresql"
chmod 700 "${ROOTFS_DIR}/var/lib/etcd"
chmod 700 "${ROOTFS_DIR}/var/lib/redis"
chmod 700 "${ROOTFS_DIR}/var/lib/quantix-vdc"

# Set ownership for PostgreSQL (user postgres is created by the package)
# The postgres user typically has UID 70 in Alpine
chroot "${ROOTFS_DIR}" chown -R postgres:postgres /var/lib/postgresql 2>/dev/null || true

# Create PostgreSQL log directory
mkdir -p "${ROOTFS_DIR}/var/log/postgresql"
chroot "${ROOTFS_DIR}" chown -R postgres:postgres /var/log/postgresql 2>/dev/null || true

# Create PostgreSQL run directory
mkdir -p "${ROOTFS_DIR}/run/postgresql"
chroot "${ROOTFS_DIR}" chown -R postgres:postgres /run/postgresql 2>/dev/null || true
chmod 755 "${ROOTFS_DIR}/run/postgresql"

# Create nginx directories (remove symlinks/files first if they exist)
rm -rf "${ROOTFS_DIR}/var/lib/nginx/logs" 2>/dev/null || true
rm -rf "${ROOTFS_DIR}/var/lib/nginx/tmp" 2>/dev/null || true
rm -rf "${ROOTFS_DIR}/var/log/nginx" 2>/dev/null || true
mkdir -p "${ROOTFS_DIR}/var/lib/nginx/logs"
mkdir -p "${ROOTFS_DIR}/var/lib/nginx/tmp/client_body"
mkdir -p "${ROOTFS_DIR}/var/lib/nginx/tmp/proxy"
mkdir -p "${ROOTFS_DIR}/var/lib/nginx/tmp/fastcgi"
mkdir -p "${ROOTFS_DIR}/var/log/nginx"
chroot "${ROOTFS_DIR}" chown -R nginx:nginx /var/lib/nginx 2>/dev/null || true
chroot "${ROOTFS_DIR}" chown -R nginx:nginx /var/log/nginx 2>/dev/null || true

# Create PostgreSQL symlinks (postgresql16 installs to /usr/libexec/postgresql16/)
# The init script expects /usr/bin/pg_ctl
echo "   Creating PostgreSQL binary symlinks..."
PG_BIN=""
for dir in /usr/libexec/postgresql16 /usr/lib/postgresql16/bin /usr/lib/postgresql/16/bin; do
    if [ -d "${ROOTFS_DIR}${dir}" ]; then
        PG_BIN="${dir}"
        break
    fi
done

if [ -n "$PG_BIN" ]; then
    for bin in pg_ctl pg_isready initdb postgres psql pg_dump pg_restore; do
        if [ -f "${ROOTFS_DIR}${PG_BIN}/${bin}" ] && [ ! -e "${ROOTFS_DIR}/usr/bin/${bin}" ]; then
            ln -sf "${PG_BIN}/${bin}" "${ROOTFS_DIR}/usr/bin/${bin}"
            echo "   Linked: ${bin} -> ${PG_BIN}/${bin}"
        fi
    done
else
    echo "   ⚠️  PostgreSQL binary directory not found, init script may fail"
fi

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

# Default network config (DHCP on first ethernet interface)
# Uses a script that finds the correct interface at boot time
cat > "${ROOTFS_DIR}/etc/network/interfaces" << 'EOF'
auto lo
iface lo inet loopback

# Will be configured by installer or DCUI
# Default: DHCP on first ethernet interface
auto eth0
iface eth0 inet dhcp
EOF

# Create a startup script to configure the correct interface
cat > "${ROOTFS_DIR}/etc/local.d/10-network-init.start" << 'NETSCRIPT'
#!/bin/sh
# Auto-detect and configure first ethernet interface

# Find first ethernet interface
IFACE=$(ip link show | grep -E "^[0-9]+: (eth|enp|ens)[^:]*:" | head -1 | awk -F: '{print $2}' | tr -d ' ')

if [ -n "$IFACE" ] && [ "$IFACE" != "eth0" ]; then
    # Interface name differs from default config
    if ! grep -q "auto $IFACE" /etc/network/interfaces; then
        # Append the correct interface config
        cat >> /etc/network/interfaces << EOF

# Auto-detected interface
auto $IFACE
iface $IFACE inet dhcp
EOF
        # Start the interface
        ip link set "$IFACE" up
        udhcpc -i "$IFACE" -b -q 2>/dev/null &
    fi
fi
NETSCRIPT
chmod +x "${ROOTFS_DIR}/etc/local.d/10-network-init.start"

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
# Step 7: Copy installer scripts
# -----------------------------------------------------------------------------
echo "📦 Step 7: Copying installer scripts..."

mkdir -p "${ROOTFS_DIR}/installer"

# Try multiple source locations (Docker volume issues workaround)
INSTALLER_SRC=""

# First try /work/installer (direct mount)
if [ -d "/work/installer" ] && [ -n "$(ls -A /work/installer/*.sh 2>/dev/null)" ]; then
    INSTALLER_SRC="/work/installer"
    echo "   Using installer scripts from /work/installer"
# Then try /work/overlay/installer (embedded in overlay)
elif [ -d "/work/overlay/installer" ] && [ -n "$(ls -A /work/overlay/installer/*.sh 2>/dev/null)" ]; then
    INSTALLER_SRC="/work/overlay/installer"
    echo "   Using installer scripts from /work/overlay/installer"
# Then try /output/installer-scripts (workaround copy)
elif [ -d "/output/installer-scripts" ] && [ -n "$(ls -A /output/installer-scripts/*.sh 2>/dev/null)" ]; then
    INSTALLER_SRC="/output/installer-scripts"
    echo "   Using installer scripts from /output/installer-scripts (workaround)"
fi

# Debug: Show what's available
echo "   Debug: Contents of /work/installer:"
ls -la /work/installer/ 2>&1 || echo "   Directory not found or empty"
echo "   Debug: Contents of /work/overlay/installer:"
ls -la /work/overlay/installer/ 2>&1 || echo "   Directory not found or empty"
echo "   Debug: Contents of /output/installer-scripts:"
ls -la /output/installer-scripts/ 2>&1 || echo "   Directory not found or empty"

if [ -n "$INSTALLER_SRC" ]; then
    # Copy each script explicitly and show errors
    for script in ${INSTALLER_SRC}/*.sh; do
        if [ -f "$script" ]; then
            echo "   Copying: $script"
            # Remove Windows line endings and copy
            sed 's/\r$//' "$script" > "${ROOTFS_DIR}/installer/$(basename "$script")"
            chmod +x "${ROOTFS_DIR}/installer/$(basename "$script")"
        fi
    done
    
    echo "   Installer scripts in rootfs:"
    ls -la "${ROOTFS_DIR}/installer/"
    
    # Verify at least one script exists
    if [ ! -f "${ROOTFS_DIR}/installer/tui.sh" ]; then
        echo "   ❌ ERROR: tui.sh not found in installer directory!"
        echo "   Available sources:"
        find /work/installer /output/installer-scripts -type f 2>&1 || true
        exit 1
    fi
else
    echo "   ❌ ERROR: No installer scripts found in any location!"
    echo "   Checked: /work/installer, /work/overlay/installer, /output/installer-scripts"
    exit 1
fi

echo "✅ Installer scripts copied"

# -----------------------------------------------------------------------------
# Step 8: Write version info
# -----------------------------------------------------------------------------
echo "📦 Step 8: Writing version info..."

cat > "${ROOTFS_DIR}/etc/quantix-vdc-release" << EOF
QUANTIX_VDC_VERSION="${VERSION}"
QUANTIX_VDC_CODENAME="genesis"
QUANTIX_VDC_BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ALPINE_VERSION="${ALPINE_VERSION}"
EOF

echo "✅ Version info written"

# -----------------------------------------------------------------------------
# Step 9: Clean up
# -----------------------------------------------------------------------------
echo "📦 Step 9: Cleaning up..."

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
# Step 10: Create squashfs
# -----------------------------------------------------------------------------
echo "📦 Step 10: Creating squashfs..."

# Debug: Show mount information
echo "   Debug: Checking mount points..."
mount | grep -E "output|work" || echo "   No relevant mounts found"
echo "   Debug: OUTPUT_DIR=${OUTPUT_DIR}"
df -h "${OUTPUT_DIR}" 2>/dev/null || echo "   df failed for ${OUTPUT_DIR}"

# Use /tmp as intermediate storage to avoid Docker overlayfs issues
TEMP_SQUASHFS="/tmp/${SQUASHFS_NAME}"

echo "   Creating squashfs at: ${TEMP_SQUASHFS}"

mksquashfs "${ROOTFS_DIR}" "${TEMP_SQUASHFS}" \
    -comp xz \
    -b 1M \
    -Xbcj x86 \
    -no-xattrs \
    -noappend

# Verify temp file exists
if [ ! -f "${TEMP_SQUASHFS}" ]; then
    echo "❌ ERROR: mksquashfs did not create temp file!"
    exit 1
fi

echo "   Temp squashfs created: $(ls -lh ${TEMP_SQUASHFS})"

# Now copy to output directory
echo "   Copying to output directory: ${OUTPUT_DIR}/${SQUASHFS_NAME}"
cp -v "${TEMP_SQUASHFS}" "${OUTPUT_DIR}/${SQUASHFS_NAME}"

# Sync and verify
sync

# Debug: List output directory
echo "   Checking output directory content:"
ls -la "${OUTPUT_DIR}/"

# Calculate size (with error checking)
if [ -f "${OUTPUT_DIR}/${SQUASHFS_NAME}" ]; then
    SQUASHFS_SIZE=$(du -h "${OUTPUT_DIR}/${SQUASHFS_NAME}" | cut -f1)
    # Clean up temp file
    rm -f "${TEMP_SQUASHFS}"
else
    echo "❌ ERROR: Squashfs file was NOT copied to output!"
    echo "   Temp file exists: $(ls -la ${TEMP_SQUASHFS} 2>/dev/null || echo 'NO')"
    exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    Rootfs Build Complete!                     ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Output: ${OUTPUT_DIR}/${SQUASHFS_NAME}"
echo "║  Size:   ${SQUASHFS_SIZE}"
echo "╚═══════════════════════════════════════════════════════════════╝"

