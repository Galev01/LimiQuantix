#!/bin/bash
# =============================================================================
# Quantix KVM Agent Tools ISO Builder
# =============================================================================
# Builds an ISO containing all agent binaries and installers for air-gapped
# installation, similar to VMware Tools ISO.
#
# Usage:
#   ./scripts/build-agent-iso.sh [--version VERSION] [--output DIR]
#
# Prerequisites:
#   - Docker (for building static binaries)
#   - genisoimage or mkisofs
#   - dpkg-deb (for DEB packages)
#   - rpmbuild (optional, for RPM packages)
#
# Output:
#   quantix-kvm-agent-tools-VERSION.iso
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# Default values
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VERSION="${VERSION:-0.1.0}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/dist}"
ISO_NAME="quantix-kvm-agent-tools"
BUILD_DIR="${ROOT_DIR}/target/iso-build"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --version)
            VERSION="$2"
            shift 2
            ;;
        --output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--version VERSION] [--output DIR]"
            echo ""
            echo "Options:"
            echo "  --version VERSION   Set the version string (default: 0.1.0)"
            echo "  --output DIR        Output directory for the ISO (default: dist/)"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

log_info "============================================="
log_info "Quantix KVM Agent Tools ISO Builder"
log_info "Version: ${VERSION}"
log_info "Output: ${OUTPUT_DIR}"
log_info "============================================="

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites..."
    
    local missing=()
    
    # Check for Docker
    if ! command -v docker &> /dev/null; then
        missing+=("docker")
    fi
    
    # Check for ISO creation tool
    if ! command -v genisoimage &> /dev/null && ! command -v mkisofs &> /dev/null; then
        missing+=("genisoimage or mkisofs")
    fi
    
    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing prerequisites: ${missing[*]}"
        log_error "Please install them and try again."
        exit 1
    fi
    
    log_info "All prerequisites met"
}

# Build static Linux binary (amd64)
build_linux_amd64() {
    log_step "Building Linux amd64 static binary..."
    
    cd "${ROOT_DIR}"
    
    # Build the Docker image if needed
    if ! docker image inspect quantix-guest-agent-builder &> /dev/null; then
        log_info "Building Docker image for guest agent..."
        docker build -t quantix-guest-agent-builder \
            -f Quantix-OS/builder/Dockerfile.guest-agent .
    fi
    
    # Build the static binary
    docker run --rm \
        -v "${ROOT_DIR}/agent:/build" \
        -e CARGO_TARGET_DIR=/build/target \
        quantix-guest-agent-builder
    
    # Verify the binary is static
    local binary="${ROOT_DIR}/agent/target/x86_64-unknown-linux-musl/release/quantix-kvm-agent"
    if [ ! -f "${binary}" ]; then
        log_error "Binary not found: ${binary}"
        exit 1
    fi
    
    # Verify it's truly static
    if ldd "${binary}" 2>&1 | grep -q "not a dynamic executable"; then
        log_info "Binary is statically linked ✓"
    else
        log_warn "Binary may have dynamic dependencies"
    fi
    
    echo "${binary}"
}

# Build static Linux binary (arm64) - requires cross-compilation setup
build_linux_arm64() {
    log_step "Building Linux arm64 static binary..."
    
    # Check if arm64 cross-compilation is set up
    if ! docker image inspect quantix-guest-agent-builder-arm64 &> /dev/null; then
        log_warn "ARM64 builder not available, creating placeholder"
        # For now, we'll skip ARM64 builds - requires additional setup
        # TODO: Add Dockerfile.guest-agent-arm64 for cross-compilation
        return 1
    fi
    
    cd "${ROOT_DIR}"
    docker run --rm \
        -v "${ROOT_DIR}/agent:/build" \
        -e CARGO_TARGET_DIR=/build/target \
        quantix-guest-agent-builder-arm64
    
    echo "${ROOT_DIR}/agent/target/aarch64-unknown-linux-musl/release/quantix-kvm-agent"
}

# Build DEB package
build_deb_package() {
    local arch="$1"
    local binary="$2"
    
    log_step "Building DEB package for ${arch}..."
    
    local pkg_name="quantix-kvm-agent"
    local pkg_dir="${BUILD_DIR}/deb/${pkg_name}_${VERSION}_${arch}"
    
    # Clean and create directory structure
    rm -rf "${pkg_dir}"
    mkdir -p "${pkg_dir}/DEBIAN"
    mkdir -p "${pkg_dir}/usr/local/bin"
    mkdir -p "${pkg_dir}/lib/systemd/system"
    mkdir -p "${pkg_dir}/etc/quantix-kvm"
    mkdir -p "${pkg_dir}/etc/quantix-kvm/pre-freeze.d"
    mkdir -p "${pkg_dir}/etc/quantix-kvm/post-thaw.d"
    mkdir -p "${pkg_dir}/var/log/quantix-kvm"
    
    # Copy binary
    cp "${binary}" "${pkg_dir}/usr/local/bin/quantix-kvm-agent"
    chmod 755 "${pkg_dir}/usr/local/bin/quantix-kvm-agent"
    
    # Copy systemd service
    cat > "${pkg_dir}/lib/systemd/system/quantix-kvm-agent.service" << 'EOF'
[Unit]
Description=Quantix KVM Guest Agent
Documentation=https://github.com/Quantix-KVM/LimiQuantix
After=network.target
ConditionVirtualization=vm

[Service]
Type=simple
ExecStart=/usr/local/bin/quantix-kvm-agent
Restart=always
RestartSec=5
Environment=RUST_LOG=info

# Security hardening
NoNewPrivileges=false
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
ReadWritePaths=/var/log/quantix-kvm /etc/quantix-kvm

[Install]
WantedBy=multi-user.target
EOF
    
    # Create control file
    cat > "${pkg_dir}/DEBIAN/control" << EOF
Package: ${pkg_name}
Version: ${VERSION}
Architecture: ${arch}
Maintainer: Quantix-KVM Team <team@quantix-kvm.io>
Homepage: https://github.com/Quantix-KVM/LimiQuantix
Description: Quantix KVM Guest Agent for VM Integration
 The Quantix KVM Guest Agent runs inside guest VMs to enable
 deep integration with the hypervisor, similar to VMware Tools.
 .
 Features:
  - Real-time telemetry (CPU, memory, disk, network)
  - Remote command execution
  - File transfer without SSH
  - Graceful shutdown/reboot
  - Password reset
  - Filesystem quiescing for snapshots
  - Time synchronization
  - Display resize (desktop VMs)
  - Clipboard sharing
  - Process and service management
EOF
    
    # Create conffiles
    cat > "${pkg_dir}/DEBIAN/conffiles" << EOF
/etc/quantix-kvm/agent.yaml
EOF
    
    # Create postinst
    cat > "${pkg_dir}/DEBIAN/postinst" << 'EOF'
#!/bin/bash
set -e

# Fix SELinux context if needed
if command -v getenforce &> /dev/null && [ "$(getenforce)" != "Disabled" ]; then
    if command -v chcon &> /dev/null; then
        chcon -t bin_t /usr/local/bin/quantix-kvm-agent 2>/dev/null || true
    fi
    if command -v restorecon &> /dev/null; then
        restorecon -v /usr/local/bin/quantix-kvm-agent 2>/dev/null || true
    fi
fi

# Reload and enable service
systemctl daemon-reload
systemctl enable quantix-kvm-agent.service
systemctl start quantix-kvm-agent.service || true

echo "Quantix KVM Agent installed successfully!"
echo "Check status: systemctl status quantix-kvm-agent"
EOF
    chmod 755 "${pkg_dir}/DEBIAN/postinst"
    
    # Create prerm
    cat > "${pkg_dir}/DEBIAN/prerm" << 'EOF'
#!/bin/bash
set -e

if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
    systemctl stop quantix-kvm-agent.service || true
    systemctl disable quantix-kvm-agent.service || true
fi
EOF
    chmod 755 "${pkg_dir}/DEBIAN/prerm"
    
    # Build the package
    if command -v dpkg-deb &> /dev/null; then
        dpkg-deb --build "${pkg_dir}"
        mv "${pkg_dir}.deb" "${BUILD_DIR}/linux/"
        log_info "Created: ${pkg_name}_${VERSION}_${arch}.deb"
    else
        log_warn "dpkg-deb not available, skipping DEB package"
    fi
}

# Build RPM package (requires rpmbuild)
build_rpm_package() {
    local arch="$1"
    local binary="$2"
    
    log_step "Building RPM package for ${arch}..."
    
    if ! command -v rpmbuild &> /dev/null; then
        log_warn "rpmbuild not available, skipping RPM package"
        return
    fi
    
    local rpm_arch
    case "${arch}" in
        amd64) rpm_arch="x86_64" ;;
        arm64) rpm_arch="aarch64" ;;
        *) rpm_arch="${arch}" ;;
    esac
    
    local rpm_dir="${BUILD_DIR}/rpm"
    rm -rf "${rpm_dir}"
    mkdir -p "${rpm_dir}"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}
    
    # Copy binary to SOURCES
    cp "${binary}" "${rpm_dir}/SOURCES/quantix-kvm-agent"
    
    # Create spec file
    cat > "${rpm_dir}/SPECS/quantix-kvm-agent.spec" << EOF
Name:           quantix-kvm-agent
Version:        ${VERSION}
Release:        1%{?dist}
Summary:        Quantix KVM Guest Agent for VM Integration

License:        Apache-2.0
URL:            https://github.com/Quantix-KVM/LimiQuantix

%description
The Quantix KVM Guest Agent runs inside guest VMs to enable
deep integration with the hypervisor, similar to VMware Tools.

%install
mkdir -p %{buildroot}/usr/local/bin
mkdir -p %{buildroot}/lib/systemd/system
mkdir -p %{buildroot}/etc/quantix-kvm
mkdir -p %{buildroot}/var/log/quantix-kvm
install -m 755 %{SOURCE0}/quantix-kvm-agent %{buildroot}/usr/local/bin/

cat > %{buildroot}/lib/systemd/system/quantix-kvm-agent.service << 'EOFSERVICE'
[Unit]
Description=Quantix KVM Guest Agent
After=network.target
ConditionVirtualization=vm

[Service]
Type=simple
ExecStart=/usr/local/bin/quantix-kvm-agent
Restart=always
RestartSec=5
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOFSERVICE

%post
# Fix SELinux context
if command -v getenforce &> /dev/null && [ "\$(getenforce)" != "Disabled" ]; then
    chcon -t bin_t /usr/local/bin/quantix-kvm-agent 2>/dev/null || true
    restorecon -v /usr/local/bin/quantix-kvm-agent 2>/dev/null || true
fi
systemctl daemon-reload
systemctl enable quantix-kvm-agent.service
systemctl start quantix-kvm-agent.service || true

%preun
if [ \$1 -eq 0 ]; then
    systemctl stop quantix-kvm-agent.service || true
    systemctl disable quantix-kvm-agent.service || true
fi

%files
/usr/local/bin/quantix-kvm-agent
/lib/systemd/system/quantix-kvm-agent.service
%dir /etc/quantix-kvm
%dir /var/log/quantix-kvm
EOF
    
    rpmbuild --define "_topdir ${rpm_dir}" -bb "${rpm_dir}/SPECS/quantix-kvm-agent.spec" 2>/dev/null || log_warn "RPM build failed"
    
    # Copy to output
    find "${rpm_dir}/RPMS" -name "*.rpm" -exec cp {} "${BUILD_DIR}/linux/" \; 2>/dev/null || true
}

# Create the ISO directory structure
create_iso_structure() {
    log_step "Creating ISO directory structure..."
    
    rm -rf "${BUILD_DIR}"
    mkdir -p "${BUILD_DIR}/linux"
    mkdir -p "${BUILD_DIR}/windows"
    mkdir -p "${OUTPUT_DIR}"
}

# Create universal install script
create_install_script() {
    log_step "Creating universal install script..."
    
    cat > "${BUILD_DIR}/linux/install.sh" << 'EOFINSTALL'
#!/bin/bash
# =============================================================================
# Quantix KVM Agent Tools - Universal Installer
# =============================================================================
# Installs: QEMU Guest Agent + Quantix KVM Agent
#
# Supported distributions:
#   - Debian/Ubuntu (apt)
#   - RHEL/CentOS/Rocky/Fedora (dnf/yum)
#   - SUSE/openSUSE (zypper)
#   - Arch Linux (pacman)
#   - Alpine Linux (apk)
#   - Any other Linux (binary install)
#
# Usage:
#   sudo ./install.sh
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[Quantix]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[Quantix]${NC} $1"; }
log_error() { echo -e "${RED}[Quantix]${NC} $1"; }

# Check for root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root: sudo ./install.sh"
    exit 1
fi

# Get script directory (where the ISO is mounted)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect architecture
ARCH="$(uname -m)"
case "${ARCH}" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)
        log_error "Unsupported architecture: ${ARCH}"
        exit 1
        ;;
esac
log_info "Detected architecture: ${ARCH}"

# Detect OS family
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID="${ID}"
        OS_ID_LIKE="${ID_LIKE:-}"
        OS_NAME="${PRETTY_NAME:-${NAME}}"
    elif [ -f /etc/redhat-release ]; then
        OS_ID="rhel"
        OS_NAME="$(cat /etc/redhat-release)"
    elif [ -f /etc/debian_version ]; then
        OS_ID="debian"
        OS_NAME="Debian $(cat /etc/debian_version)"
    else
        OS_ID="unknown"
        OS_NAME="Unknown Linux"
    fi
    
    # Determine package manager
    case "${OS_ID}" in
        ubuntu|debian|linuxmint|pop)
            PKG_MANAGER="apt"
            QEMU_GA_PKG="qemu-guest-agent"
            ;;
        rhel|centos|rocky|almalinux|fedora|ol)
            if command -v dnf &> /dev/null; then
                PKG_MANAGER="dnf"
            else
                PKG_MANAGER="yum"
            fi
            QEMU_GA_PKG="qemu-guest-agent"
            ;;
        opensuse*|suse|sles)
            PKG_MANAGER="zypper"
            QEMU_GA_PKG="qemu-guest-agent"
            ;;
        arch|manjaro)
            PKG_MANAGER="pacman"
            QEMU_GA_PKG="qemu-guest-agent"
            ;;
        alpine)
            PKG_MANAGER="apk"
            QEMU_GA_PKG="qemu-guest-agent"
            ;;
        *)
            # Check ID_LIKE for derivatives
            if echo "${OS_ID_LIKE}" | grep -qE "debian|ubuntu"; then
                PKG_MANAGER="apt"
                QEMU_GA_PKG="qemu-guest-agent"
            elif echo "${OS_ID_LIKE}" | grep -qE "rhel|fedora|centos"; then
                PKG_MANAGER="dnf"
                QEMU_GA_PKG="qemu-guest-agent"
            elif echo "${OS_ID_LIKE}" | grep -q "suse"; then
                PKG_MANAGER="zypper"
                QEMU_GA_PKG="qemu-guest-agent"
            elif echo "${OS_ID_LIKE}" | grep -q "arch"; then
                PKG_MANAGER="pacman"
                QEMU_GA_PKG="qemu-guest-agent"
            else
                PKG_MANAGER="none"
                QEMU_GA_PKG=""
            fi
            ;;
    esac
    
    log_info "Detected OS: ${OS_NAME} (${OS_ID})"
    log_info "Package manager: ${PKG_MANAGER}"
}

# Install QEMU Guest Agent
install_qemu_ga() {
    log_info "Installing QEMU Guest Agent..."
    
    # Check if already installed and running
    if systemctl is-active --quiet qemu-guest-agent 2>/dev/null; then
        log_info "QEMU Guest Agent already running"
        return 0
    fi
    
    case "${PKG_MANAGER}" in
        apt)
            apt-get update -qq
            apt-get install -y -qq qemu-guest-agent
            ;;
        dnf)
            dnf install -y -q qemu-guest-agent
            ;;
        yum)
            yum install -y -q qemu-guest-agent
            ;;
        zypper)
            zypper install -y --no-confirm qemu-guest-agent
            ;;
        pacman)
            pacman -S --noconfirm qemu-guest-agent
            ;;
        apk)
            apk add --quiet qemu-guest-agent
            ;;
        none)
            log_warn "No package manager detected. Please install qemu-guest-agent manually."
            return 1
            ;;
    esac
    
    # Enable and start QEMU GA
    if command -v systemctl &> /dev/null; then
        systemctl enable qemu-guest-agent 2>/dev/null || true
        systemctl start qemu-guest-agent 2>/dev/null || true
    elif command -v rc-service &> /dev/null; then
        rc-update add qemu-guest-agent default 2>/dev/null || true
        rc-service qemu-guest-agent start 2>/dev/null || true
    fi
    
    log_info "QEMU Guest Agent installed"
}

# Configure QEMU GA to allow file operations
configure_qemu_ga() {
    log_info "Configuring QEMU Guest Agent for file operations..."
    
    local qga_config="/etc/qemu/qemu-ga.conf"
    local qga_config_dir="/etc/qemu"
    
    # Create config directory if needed
    mkdir -p "${qga_config_dir}"
    
    # Check if config exists and if we need to update it
    if [ -f "${qga_config}" ] && grep -q "allowed-rpcs" "${qga_config}"; then
        log_info "QEMU GA already configured"
        return 0
    fi
    
    # Create or update config to allow file operations
    # This enables the one-click update feature from the Dashboard
    cat > "${qga_config}" << 'EOFCONFIG'
# Quantix KVM Agent configuration for QEMU Guest Agent
# Allows file operations for remote agent installation and updates

[general]
# Allow these RPCs for Quantix integration
# guest-file-open, guest-file-write, guest-file-close: file transfer
# guest-exec, guest-exec-status: command execution
# Default: all RPCs are allowed

# If you want to restrict:
# blocked-rpcs=guest-get-time,guest-set-time
EOFCONFIG
    
    # Restart QEMU GA to apply changes
    if command -v systemctl &> /dev/null; then
        systemctl restart qemu-guest-agent 2>/dev/null || true
    elif command -v rc-service &> /dev/null; then
        rc-service qemu-guest-agent restart 2>/dev/null || true
    fi
    
    log_info "QEMU GA configured for file operations"
}

# Install Quantix KVM Agent
install_quantix_agent() {
    log_info "Installing Quantix KVM Agent..."
    
    # Create directories
    mkdir -p /etc/quantix-kvm/pre-freeze.d
    mkdir -p /etc/quantix-kvm/post-thaw.d
    mkdir -p /var/log/quantix-kvm
    
    # Try to install via package first
    local installed=false
    
    # Check for DEB package
    if [ "${PKG_MANAGER}" = "apt" ] && [ -f "${SCRIPT_DIR}/quantix-kvm-agent_*_${ARCH}.deb" ]; then
        local deb_file
        deb_file=$(ls "${SCRIPT_DIR}"/quantix-kvm-agent_*_${ARCH}.deb 2>/dev/null | head -1)
        if [ -n "${deb_file}" ] && [ -f "${deb_file}" ]; then
            log_info "Installing from DEB package..."
            dpkg -i "${deb_file}" || apt-get install -f -y
            installed=true
        fi
    fi
    
    # Check for RPM package
    if [ ! "${installed}" = true ] && { [ "${PKG_MANAGER}" = "dnf" ] || [ "${PKG_MANAGER}" = "yum" ]; }; then
        local rpm_arch
        case "${ARCH}" in
            amd64) rpm_arch="x86_64" ;;
            arm64) rpm_arch="aarch64" ;;
            *) rpm_arch="${ARCH}" ;;
        esac
        local rpm_file
        rpm_file=$(ls "${SCRIPT_DIR}"/quantix-kvm-agent-*."${rpm_arch}".rpm 2>/dev/null | head -1)
        if [ -n "${rpm_file}" ] && [ -f "${rpm_file}" ]; then
            log_info "Installing from RPM package..."
            rpm -Uvh "${rpm_file}" || ${PKG_MANAGER} install -y "${rpm_file}"
            installed=true
        fi
    fi
    
    # Fall back to binary installation
    if [ ! "${installed}" = true ]; then
        log_info "Installing from static binary..."
        
        local binary_file="${SCRIPT_DIR}/quantix-kvm-agent-${ARCH}"
        if [ ! -f "${binary_file}" ]; then
            log_error "Binary not found: ${binary_file}"
            log_error "Available files in ${SCRIPT_DIR}:"
            ls -la "${SCRIPT_DIR}"
            exit 1
        fi
        
        # Copy binary
        cp "${binary_file}" /usr/local/bin/quantix-kvm-agent
        chmod 755 /usr/local/bin/quantix-kvm-agent
        
        # Fix SELinux context if SELinux is enabled
        if command -v getenforce &> /dev/null && [ "$(getenforce)" != "Disabled" ]; then
            log_info "Fixing SELinux context..."
            if command -v chcon &> /dev/null; then
                chcon -t bin_t /usr/local/bin/quantix-kvm-agent 2>/dev/null || true
            fi
            if command -v restorecon &> /dev/null; then
                restorecon -v /usr/local/bin/quantix-kvm-agent 2>/dev/null || true
            fi
        fi
        
        # Create systemd service
        if command -v systemctl &> /dev/null; then
            cat > /etc/systemd/system/quantix-kvm-agent.service << 'EOFSVC'
[Unit]
Description=Quantix KVM Guest Agent
Documentation=https://github.com/Quantix-KVM/LimiQuantix
After=network.target
ConditionVirtualization=vm

[Service]
Type=simple
ExecStart=/usr/local/bin/quantix-kvm-agent
Restart=always
RestartSec=5
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOFSVC
            systemctl daemon-reload
            systemctl enable quantix-kvm-agent
        elif command -v rc-service &> /dev/null; then
            # OpenRC (Alpine, etc.)
            cat > /etc/init.d/quantix-kvm-agent << 'EOFINIT'
#!/sbin/openrc-run

name="quantix-kvm-agent"
description="Quantix KVM Guest Agent"
command="/usr/local/bin/quantix-kvm-agent"
command_background="yes"
pidfile="/run/${RC_SVCNAME}.pid"
output_log="/var/log/quantix-kvm/agent.log"
error_log="/var/log/quantix-kvm/agent.err"

depend() {
    need net
    after firewall
}
EOFINIT
            chmod +x /etc/init.d/quantix-kvm-agent
            rc-update add quantix-kvm-agent default 2>/dev/null || true
        fi
    fi
    
    # Start the agent
    if command -v systemctl &> /dev/null; then
        systemctl restart quantix-kvm-agent 2>/dev/null || true
    elif command -v rc-service &> /dev/null; then
        rc-service quantix-kvm-agent restart 2>/dev/null || true
    fi
    
    log_info "Quantix KVM Agent installed"
}

# Verify installation
verify_installation() {
    log_info "Verifying installation..."
    
    local success=true
    
    # Check QEMU GA
    if command -v systemctl &> /dev/null; then
        if systemctl is-active --quiet qemu-guest-agent 2>/dev/null; then
            log_info "✓ QEMU Guest Agent: running"
        else
            log_warn "✗ QEMU Guest Agent: not running"
            success=false
        fi
        
        if systemctl is-active --quiet quantix-kvm-agent 2>/dev/null; then
            log_info "✓ Quantix KVM Agent: running"
        else
            log_warn "✗ Quantix KVM Agent: not running"
            success=false
        fi
    fi
    
    # Check if virtio-serial device exists
    if [ -c /dev/virtio-ports/org.quantix.agent.0 ] || [ -c /dev/virtio-ports/org.quantix.agent.0 ]; then
        log_info "✓ Virtio-serial channel: available"
    else
        log_warn "✗ Virtio-serial channel: not found (will be available after VM restart)"
    fi
    
    if [ "${success}" = true ]; then
        echo ""
        log_info "============================================="
        log_info "Installation complete!"
        log_info "============================================="
        log_info ""
        log_info "The Quantix Dashboard should show this VM as 'Connected' within seconds."
        log_info ""
        log_info "Check status:"
        log_info "  systemctl status quantix-kvm-agent"
        log_info "  systemctl status qemu-guest-agent"
        log_info ""
    else
        echo ""
        log_warn "Installation completed with warnings."
        log_warn "Some services may need to be started manually."
    fi
}

# Main
main() {
    echo ""
    log_info "============================================="
    log_info "Quantix KVM Agent Tools Installer"
    log_info "============================================="
    echo ""
    
    detect_os
    install_qemu_ga
    configure_qemu_ga
    install_quantix_agent
    verify_installation
}

main "$@"
EOFINSTALL
    
    chmod +x "${BUILD_DIR}/linux/install.sh"
    log_info "Created: linux/install.sh"
}

# Create README files
create_readme_files() {
    log_step "Creating README files..."
    
    # Main README
    cat > "${BUILD_DIR}/README.txt" << EOF
=============================================
Quantix KVM Agent Tools ISO
Version: ${VERSION}
=============================================

This ISO contains everything needed to install the Quantix KVM Agent
in your virtual machine. The agent enables:

  * Real-time monitoring (CPU, memory, disk, network)
  * Remote command execution
  * File transfer without SSH
  * Graceful shutdown/reboot
  * Password reset
  * Filesystem quiescing for snapshots
  * Display resize for desktop VMs
  * Clipboard sharing

INSTALLATION
------------

Linux:
  1. Mount this ISO to your VM's CD-ROM
  2. Open a terminal in the VM
  3. Run: sudo /mnt/cdrom/linux/install.sh
     (or wherever your CD-ROM is mounted)

Windows (coming soon):
  1. Mount this ISO to your VM's CD-ROM
  2. Open the D: drive (or your CD-ROM drive letter)
  3. Run: windows\\quantix-kvm-agent-setup.exe

CONTENTS
--------

linux/
  install.sh              - Universal installer (recommended)
  quantix-kvm-agent-amd64 - Static binary for x86_64
  quantix-kvm-agent-arm64 - Static binary for ARM64 (if available)
  *.deb                   - Debian/Ubuntu packages
  *.rpm                   - RHEL/CentOS/Fedora packages

windows/
  quantix-kvm-agent-setup.exe - Windows installer (coming soon)

SUPPORTED DISTRIBUTIONS
-----------------------

Linux (all with single installer):
  * Ubuntu 18.04+
  * Debian 10+
  * Rocky Linux 8+
  * CentOS 7+
  * RHEL 7+
  * Fedora 35+
  * openSUSE Leap 15+
  * Arch Linux
  * Alpine Linux 3.14+
  * Any other Linux (binary install)

Windows (coming soon):
  * Windows Server 2016+
  * Windows 10/11

TROUBLESHOOTING
---------------

If the agent doesn't connect after installation:

1. Check if the service is running:
   systemctl status quantix-kvm-agent

2. Check for SELinux issues (RHEL-based):
   sudo restorecon -v /usr/local/bin/quantix-kvm-agent

3. Verify virtio-serial device exists:
   ls -la /dev/virtio-ports/

4. Check agent logs:
   journalctl -u quantix-kvm-agent -n 50

SUPPORT
-------

Documentation: https://github.com/Quantix-KVM/LimiQuantix
Issues: https://github.com/Quantix-KVM/LimiQuantix/issues

=============================================
EOF
    
    # Windows README
    cat > "${BUILD_DIR}/windows/README.txt" << EOF
=============================================
Quantix KVM Agent - Windows Installation
=============================================

Windows support is coming soon!

For now, Windows VMs can use basic QEMU Guest Agent:
  1. Download virtio-win drivers ISO
  2. Install qemu-guest-agent from the ISO

Full Quantix KVM Agent for Windows will include:
  * All features of the Linux agent
  * Native Windows service
  * MSI installer

=============================================
EOF
    
    # VERSION file
    echo "${VERSION}" > "${BUILD_DIR}/VERSION"
    
    log_info "Created README files"
}

# Copy binaries to ISO structure
copy_binaries() {
    log_step "Copying binaries to ISO structure..."
    
    local amd64_binary="${ROOT_DIR}/agent/target/x86_64-unknown-linux-musl/release/quantix-kvm-agent"
    
    if [ -f "${amd64_binary}" ]; then
        cp "${amd64_binary}" "${BUILD_DIR}/linux/quantix-kvm-agent-amd64"
        chmod 755 "${BUILD_DIR}/linux/quantix-kvm-agent-amd64"
        log_info "Copied amd64 binary"
    else
        log_error "amd64 binary not found: ${amd64_binary}"
        exit 1
    fi
    
    # ARM64 binary (optional)
    local arm64_binary="${ROOT_DIR}/agent/target/aarch64-unknown-linux-musl/release/quantix-kvm-agent"
    if [ -f "${arm64_binary}" ]; then
        cp "${arm64_binary}" "${BUILD_DIR}/linux/quantix-kvm-agent-arm64"
        chmod 755 "${BUILD_DIR}/linux/quantix-kvm-agent-arm64"
        log_info "Copied arm64 binary"
    else
        log_warn "arm64 binary not available (optional)"
    fi
}

# Create the ISO
create_iso() {
    log_step "Creating ISO image..."
    
    local iso_tool
    if command -v genisoimage &> /dev/null; then
        iso_tool="genisoimage"
    elif command -v mkisofs &> /dev/null; then
        iso_tool="mkisofs"
    else
        log_error "No ISO creation tool found (genisoimage or mkisofs)"
        exit 1
    fi
    
    local iso_file="${OUTPUT_DIR}/${ISO_NAME}-${VERSION}.iso"
    
    ${iso_tool} \
        -o "${iso_file}" \
        -V "QUANTIX_AGENT_TOOLS" \
        -J \
        -r \
        -l \
        "${BUILD_DIR}"
    
    log_info "Created: ${iso_file}"
    
    # Show ISO info
    ls -lh "${iso_file}"
    
    # Calculate checksum
    if command -v sha256sum &> /dev/null; then
        sha256sum "${iso_file}" > "${iso_file}.sha256"
        log_info "Checksum: ${iso_file}.sha256"
    fi
}

# Main
main() {
    check_prerequisites
    create_iso_structure
    
    # Build binaries
    local amd64_binary
    amd64_binary=$(build_linux_amd64)
    
    # Copy binaries
    copy_binaries
    
    # Build packages
    build_deb_package "amd64" "${amd64_binary}"
    build_rpm_package "amd64" "${amd64_binary}"
    
    # ARM64 (optional)
    if build_linux_arm64 2>/dev/null; then
        local arm64_binary="${ROOT_DIR}/agent/target/aarch64-unknown-linux-musl/release/quantix-kvm-agent"
        if [ -f "${arm64_binary}" ]; then
            build_deb_package "arm64" "${arm64_binary}"
            build_rpm_package "arm64" "${arm64_binary}"
        fi
    fi
    
    # Create install script and README
    create_install_script
    create_readme_files
    
    # Create the ISO
    create_iso
    
    echo ""
    log_info "============================================="
    log_info "ISO build complete!"
    log_info "============================================="
    log_info "Output: ${OUTPUT_DIR}/${ISO_NAME}-${VERSION}.iso"
    echo ""
}

main "$@"
