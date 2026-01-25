#!/bin/bash
# =============================================================================
# LimiQuantix Guest Agent Package Builder
# =============================================================================
# This script builds distribution packages for the Guest Agent.
#
# Usage:
#   ./build-packages.sh [target]
#
# Targets:
#   deb     - Build Debian/Ubuntu .deb package
#   rpm     - Build RHEL/CentOS/Fedora .rpm package
#   binary  - Build standalone binary
#   all     - Build all packages (default)
#
# Requirements:
#   - Rust toolchain (cargo, rustc)
#   - For deb: dpkg-deb, debhelper
#   - For rpm: rpmbuild
# =============================================================================

set -e

VERSION="0.1.0"
PACKAGE_NAME="limiquantix-guest-agent"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BUILD_DIR="${ROOT_DIR}/target/packages"

# Detect architecture
MACHINE_ARCH="$(uname -m)"
case "${MACHINE_ARCH}" in
    x86_64)
        ARCH="amd64"
        RUST_TARGET="x86_64-unknown-linux-gnu"
        ;;
    aarch64)
        ARCH="arm64"
        RUST_TARGET="aarch64-unknown-linux-gnu"
        ;;
    *)
        ARCH="${MACHINE_ARCH}"
        RUST_TARGET=""
        ;;
esac

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Build the Rust binary
build_binary() {
    log_info "Building limiquantix-agent binary..."
    
    cd "${ROOT_DIR}"
    cargo build --release -p limiquantix-guest-agent
    
    if [ -f "${ROOT_DIR}/target/release/limiquantix-agent" ]; then
        log_info "Binary built successfully"
    else
        log_error "Binary build failed"
        exit 1
    fi
}

# Build Debian package
build_deb() {
    log_info "Building Debian package for ${ARCH}..."
    
    # Ensure binary is built
    build_binary
    
    # Create package directory structure
    DEB_DIR="${BUILD_DIR}/deb/${PACKAGE_NAME}_${VERSION}_${ARCH}"
    rm -rf "${DEB_DIR}"
    mkdir -p "${DEB_DIR}/DEBIAN"
    mkdir -p "${DEB_DIR}/usr/bin"
    mkdir -p "${DEB_DIR}/lib/systemd/system"
    mkdir -p "${DEB_DIR}/etc/limiquantix"
    mkdir -p "${DEB_DIR}/etc/limiquantix/pre-freeze.d"
    mkdir -p "${DEB_DIR}/etc/limiquantix/post-thaw.d"
    mkdir -p "${DEB_DIR}/var/log/limiquantix"
    
    # Copy binary
    cp "${ROOT_DIR}/target/release/limiquantix-agent" "${DEB_DIR}/usr/bin/"
    chmod 755 "${DEB_DIR}/usr/bin/limiquantix-agent"
    
    # Copy systemd service
    cp "${SCRIPT_DIR}/systemd/limiquantix-agent.service" "${DEB_DIR}/lib/systemd/system/"
    
    # Copy default configuration
    cp "${SCRIPT_DIR}/config/agent.yaml" "${DEB_DIR}/etc/limiquantix/"
    
    # Create control file
    cat > "${DEB_DIR}/DEBIAN/control" << EOF
Package: ${PACKAGE_NAME}
Version: ${VERSION}
Architecture: ${ARCH}
Maintainer: LimiQuantix Team <team@limiquantix.io>
Depends: libc6
Description: LimiQuantix Guest Agent for VM Integration
 The LimiQuantix Guest Agent is a lightweight daemon that runs inside
 guest VMs to enable deep integration with the LimiQuantix hypervisor.
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
    
    # Create conffiles (mark config as conffile to preserve on upgrade)
    cat > "${DEB_DIR}/DEBIAN/conffiles" << EOF
/etc/limiquantix/agent.yaml
EOF
    
    # Copy maintainer scripts
    cp "${SCRIPT_DIR}/debian/postinst" "${DEB_DIR}/DEBIAN/"
    cp "${SCRIPT_DIR}/debian/prerm" "${DEB_DIR}/DEBIAN/"
    chmod 755 "${DEB_DIR}/DEBIAN/postinst"
    chmod 755 "${DEB_DIR}/DEBIAN/prerm"
    
    # Build the package
    dpkg-deb --build "${DEB_DIR}"
    
    # Move to output directory
    mv "${DEB_DIR}.deb" "${BUILD_DIR}/"
    
    log_info "Debian package built: ${BUILD_DIR}/${PACKAGE_NAME}_${VERSION}_${ARCH}.deb"
}

# Build RPM package
build_rpm() {
    log_info "Building RPM package..."
    
    # Ensure binary is built
    build_binary
    
    # Create RPM build directories
    RPM_DIR="${BUILD_DIR}/rpm"
    rm -rf "${RPM_DIR}"
    mkdir -p "${RPM_DIR}"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}
    
    # Create spec file
    cat > "${RPM_DIR}/SPECS/${PACKAGE_NAME}.spec" << EOF
Name:           ${PACKAGE_NAME}
Version:        ${VERSION}
Release:        1%{?dist}
Summary:        LimiQuantix Guest Agent for VM Integration

License:        Apache-2.0
URL:            https://github.com/limiquantix/limiquantix

%description
The LimiQuantix Guest Agent is a lightweight daemon that runs inside
guest VMs to enable deep integration with the LimiQuantix hypervisor.

%install
mkdir -p %{buildroot}/usr/bin
mkdir -p %{buildroot}/lib/systemd/system
install -m 755 ${ROOT_DIR}/target/release/limiquantix-agent %{buildroot}/usr/bin/
install -m 644 ${SCRIPT_DIR}/systemd/limiquantix-agent.service %{buildroot}/lib/systemd/system/

%post
systemctl daemon-reload
systemctl enable limiquantix-agent.service
systemctl start limiquantix-agent.service || true

%preun
if [ \$1 -eq 0 ]; then
    systemctl stop limiquantix-agent.service || true
    systemctl disable limiquantix-agent.service || true
fi

%files
/usr/bin/limiquantix-agent
/lib/systemd/system/limiquantix-agent.service
EOF
    
    # Build the RPM
    rpmbuild --define "_topdir ${RPM_DIR}" -bb "${RPM_DIR}/SPECS/${PACKAGE_NAME}.spec"
    
    # Copy to output directory
    find "${RPM_DIR}/RPMS" -name "*.rpm" -exec cp {} "${BUILD_DIR}/" \;
    
    log_info "RPM package built in ${BUILD_DIR}/"
}

# Build standalone binary tarball
build_standalone() {
    log_info "Building standalone binary tarball..."
    
    # Ensure binary is built
    build_binary
    
    # Create tarball directory
    TAR_DIR="${BUILD_DIR}/tar/${PACKAGE_NAME}-${VERSION}"
    rm -rf "${TAR_DIR}"
    mkdir -p "${TAR_DIR}"
    
    # Copy files
    cp "${ROOT_DIR}/target/release/limiquantix-agent" "${TAR_DIR}/"
    cp "${SCRIPT_DIR}/systemd/limiquantix-agent.service" "${TAR_DIR}/"
    cp "${ROOT_DIR}/limiquantix-guest-agent/README.md" "${TAR_DIR}/" 2>/dev/null || true
    
    # Create install script
    cat > "${TAR_DIR}/install.sh" << 'EOF'
#!/bin/bash
set -e

echo "Installing LimiQuantix Guest Agent..."

# Copy binary
sudo install -m 755 limiquantix-agent /usr/local/bin/

# Copy systemd service
sudo install -m 644 limiquantix-agent.service /etc/systemd/system/

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable limiquantix-agent
sudo systemctl start limiquantix-agent

echo "LimiQuantix Guest Agent installed and started!"
echo "Check status: systemctl status limiquantix-agent"
EOF
    chmod +x "${TAR_DIR}/install.sh"
    
    # Create tarball
    cd "${BUILD_DIR}/tar"
    tar -czf "${BUILD_DIR}/${PACKAGE_NAME}-${VERSION}-linux-${ARCH}.tar.gz" "${PACKAGE_NAME}-${VERSION}"
    
    log_info "Tarball built: ${BUILD_DIR}/${PACKAGE_NAME}-${VERSION}-linux-${ARCH}.tar.gz"
}

# Main
main() {
    TARGET="${1:-all}"
    
    mkdir -p "${BUILD_DIR}"
    
    case "${TARGET}" in
        deb)
            build_deb
            ;;
        rpm)
            build_rpm
            ;;
        binary)
            build_standalone
            ;;
        all)
            build_deb
            build_rpm
            build_standalone
            ;;
        *)
            log_error "Unknown target: ${TARGET}"
            echo "Usage: $0 [deb|rpm|binary|all]"
            exit 1
            ;;
    esac
    
    log_info "Build complete! Packages available in ${BUILD_DIR}/"
    ls -la "${BUILD_DIR}/"
}

main "$@"
