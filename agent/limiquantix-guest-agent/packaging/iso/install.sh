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
#   sudo ./install.sh [OPTIONS]
#
# Options:
#   --skip-qemu-ga    Don't install/configure QEMU Guest Agent
#   --binary-only     Only install the binary (no packages)
#   --uninstall       Remove the Quantix KVM Agent
#   --help            Show this help message
#
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[Quantix]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[Quantix]${NC} $1"; }
log_error() { echo -e "${RED}[Quantix]${NC} $1"; }
log_step() { echo -e "${BLUE}[Quantix]${NC} $1"; }

# Configuration
SKIP_QEMU_GA=false
BINARY_ONLY=false
UNINSTALL=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-qemu-ga)
            SKIP_QEMU_GA=true
            shift
            ;;
        --binary-only)
            BINARY_ONLY=true
            shift
            ;;
        --uninstall)
            UNINSTALL=true
            shift
            ;;
        --help|-h)
            echo "Quantix KVM Agent Tools - Universal Installer"
            echo ""
            echo "Usage: sudo ./install.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --skip-qemu-ga    Don't install/configure QEMU Guest Agent"
            echo "  --binary-only     Only install the binary (no packages)"
            echo "  --uninstall       Remove the Quantix KVM Agent"
            echo "  --help            Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            log_error "Use --help for usage information"
            exit 1
            ;;
    esac
done

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

# Detect OS family and package manager
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID="${ID}"
        OS_ID_LIKE="${ID_LIKE:-}"
        OS_NAME="${PRETTY_NAME:-${NAME}}"
        OS_VERSION="${VERSION_ID:-}"
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
        ubuntu|debian|linuxmint|pop|kali|elementary|zorin)
            PKG_MANAGER="apt"
            ;;
        rhel|centos|rocky|almalinux|fedora|ol|scientific|amzn)
            if command -v dnf &> /dev/null; then
                PKG_MANAGER="dnf"
            else
                PKG_MANAGER="yum"
            fi
            ;;
        opensuse*|suse|sles)
            PKG_MANAGER="zypper"
            ;;
        arch|manjaro|endeavouros|garuda)
            PKG_MANAGER="pacman"
            ;;
        alpine)
            PKG_MANAGER="apk"
            ;;
        gentoo)
            PKG_MANAGER="emerge"
            ;;
        void)
            PKG_MANAGER="xbps"
            ;;
        *)
            # Check ID_LIKE for derivatives
            if echo "${OS_ID_LIKE}" | grep -qE "debian|ubuntu"; then
                PKG_MANAGER="apt"
            elif echo "${OS_ID_LIKE}" | grep -qE "rhel|fedora|centos"; then
                if command -v dnf &> /dev/null; then
                    PKG_MANAGER="dnf"
                else
                    PKG_MANAGER="yum"
                fi
            elif echo "${OS_ID_LIKE}" | grep -q "suse"; then
                PKG_MANAGER="zypper"
            elif echo "${OS_ID_LIKE}" | grep -q "arch"; then
                PKG_MANAGER="pacman"
            else
                PKG_MANAGER="none"
            fi
            ;;
    esac
}

# Install QEMU Guest Agent
install_qemu_ga() {
    if [ "${SKIP_QEMU_GA}" = true ]; then
        log_info "Skipping QEMU Guest Agent installation (--skip-qemu-ga)"
        return 0
    fi
    
    log_step "Installing QEMU Guest Agent..."
    
    # Check if already installed and running
    if systemctl is-active --quiet qemu-guest-agent 2>/dev/null || \
       rc-service qemu-guest-agent status &>/dev/null 2>&1; then
        log_info "QEMU Guest Agent already running"
        return 0
    fi
    
    case "${PKG_MANAGER}" in
        apt)
            apt-get update -qq 2>/dev/null || true
            DEBIAN_FRONTEND=noninteractive apt-get install -y -qq qemu-guest-agent
            ;;
        dnf)
            dnf install -y -q qemu-guest-agent 2>/dev/null
            ;;
        yum)
            yum install -y -q qemu-guest-agent 2>/dev/null
            ;;
        zypper)
            zypper install -y --no-confirm qemu-guest-agent 2>/dev/null
            ;;
        pacman)
            pacman -S --noconfirm qemu-guest-agent 2>/dev/null
            ;;
        apk)
            apk add --quiet qemu-guest-agent 2>/dev/null
            ;;
        xbps)
            xbps-install -y qemu-ga 2>/dev/null
            ;;
        none)
            log_warn "No package manager detected. Please install qemu-guest-agent manually."
            return 1
            ;;
        *)
            log_warn "Package manager '${PKG_MANAGER}' not supported for QEMU GA. Install manually."
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
    elif command -v service &> /dev/null; then
        service qemu-guest-agent start 2>/dev/null || true
    fi
    
    log_info "QEMU Guest Agent installed and started"
}

# Configure QEMU GA to allow file operations
configure_qemu_ga() {
    if [ "${SKIP_QEMU_GA}" = true ]; then
        return 0
    fi
    
    log_step "Configuring QEMU Guest Agent..."
    
    local qga_config="/etc/qemu/qemu-ga.conf"
    
    # Create config directory if needed
    mkdir -p "$(dirname "${qga_config}")"
    
    # Only create config if it doesn't exist or doesn't have our marker
    if [ ! -f "${qga_config}" ] || ! grep -q "Quantix KVM" "${qga_config}"; then
        cat > "${qga_config}" << 'EOF'
# Quantix KVM Agent configuration for QEMU Guest Agent
# This enables file transfer and command execution for remote management

[general]
# All RPCs are allowed by default
# To restrict specific commands, uncomment and modify:
# blocked-rpcs=guest-get-time,guest-set-time

# Freeze hook scripts directory
# fsfreeze-hook=/etc/qemu/fsfreeze-hook
EOF
        
        # Restart QEMU GA to apply changes
        if command -v systemctl &> /dev/null; then
            systemctl restart qemu-guest-agent 2>/dev/null || true
        elif command -v rc-service &> /dev/null; then
            rc-service qemu-guest-agent restart 2>/dev/null || true
        fi
        
        log_info "QEMU GA configured"
    fi
}

# Install Quantix KVM Agent
install_quantix_agent() {
    log_step "Installing Quantix KVM Agent..."
    
    # Create directories
    mkdir -p /etc/quantix-kvm/pre-freeze.d
    mkdir -p /etc/quantix-kvm/post-thaw.d
    mkdir -p /var/log/quantix-kvm
    
    # Determine installation method
    local installed=false
    
    # Try DEB package first (if apt and not binary-only)
    if [ "${BINARY_ONLY}" = false ] && [ "${PKG_MANAGER}" = "apt" ]; then
        local deb_file
        deb_file=$(find "${SCRIPT_DIR}" -maxdepth 1 -name "quantix-kvm-agent_*_${ARCH}.deb" 2>/dev/null | head -1)
        if [ -n "${deb_file}" ] && [ -f "${deb_file}" ]; then
            log_info "Installing from DEB package: $(basename "${deb_file}")"
            dpkg -i "${deb_file}" 2>/dev/null || apt-get install -f -y -qq
            installed=true
        fi
    fi
    
    # Try RPM package (if dnf/yum and not binary-only)
    if [ "${installed}" = false ] && [ "${BINARY_ONLY}" = false ]; then
        if [ "${PKG_MANAGER}" = "dnf" ] || [ "${PKG_MANAGER}" = "yum" ]; then
            local rpm_arch
            case "${ARCH}" in
                amd64) rpm_arch="x86_64" ;;
                arm64) rpm_arch="aarch64" ;;
                *) rpm_arch="${ARCH}" ;;
            esac
            local rpm_file
            rpm_file=$(find "${SCRIPT_DIR}" -maxdepth 1 -name "quantix-kvm-agent-*.${rpm_arch}.rpm" 2>/dev/null | head -1)
            if [ -n "${rpm_file}" ] && [ -f "${rpm_file}" ]; then
                log_info "Installing from RPM package: $(basename "${rpm_file}")"
                rpm -Uvh --replacepkgs "${rpm_file}" 2>/dev/null || ${PKG_MANAGER} install -y "${rpm_file}"
                installed=true
            fi
        fi
    fi
    
    # Fall back to binary installation
    if [ "${installed}" = false ]; then
        log_info "Installing from static binary..."
        
        # Find the binary
        local binary_file="${SCRIPT_DIR}/quantix-kvm-agent-${ARCH}"
        if [ ! -f "${binary_file}" ]; then
            # Try alternative names
            binary_file="${SCRIPT_DIR}/quantix-kvm-agent-${ARCH}"
            if [ ! -f "${binary_file}" ]; then
                binary_file="${SCRIPT_DIR}/quantix-kvm-agent"
                if [ ! -f "${binary_file}" ]; then
                    log_error "Binary not found in ${SCRIPT_DIR}"
                    log_error "Expected: quantix-kvm-agent-${ARCH}"
                    ls -la "${SCRIPT_DIR}" || true
                    exit 1
                fi
            fi
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
        
        # Create service file
        create_service_file
    fi
    
    # Enable and start the agent
    start_agent
    
    log_info "Quantix KVM Agent installed"
}

# Create systemd/OpenRC service file
create_service_file() {
    if command -v systemctl &> /dev/null; then
        # systemd service
        cat > /etc/systemd/system/quantix-kvm-agent.service << 'EOF'
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
ReadWritePaths=/var/log/quantix-kvm /etc/quantix-kvm /dev

[Install]
WantedBy=multi-user.target
EOF
        systemctl daemon-reload
        systemctl enable quantix-kvm-agent
    elif command -v rc-service &> /dev/null; then
        # OpenRC service (Alpine, Gentoo, etc.)
        cat > /etc/init.d/quantix-kvm-agent << 'EOF'
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
EOF
        chmod +x /etc/init.d/quantix-kvm-agent
        rc-update add quantix-kvm-agent default 2>/dev/null || true
    elif [ -d /etc/sv ]; then
        # Runit (Void Linux)
        mkdir -p /etc/sv/quantix-kvm-agent
        cat > /etc/sv/quantix-kvm-agent/run << 'EOF'
#!/bin/sh
exec /usr/local/bin/quantix-kvm-agent 2>&1
EOF
        chmod +x /etc/sv/quantix-kvm-agent/run
        ln -sf /etc/sv/quantix-kvm-agent /var/service/ 2>/dev/null || true
    fi
}

# Start the agent
start_agent() {
    if command -v systemctl &> /dev/null; then
        systemctl restart quantix-kvm-agent 2>/dev/null || systemctl start quantix-kvm-agent 2>/dev/null || true
    elif command -v rc-service &> /dev/null; then
        rc-service quantix-kvm-agent restart 2>/dev/null || rc-service quantix-kvm-agent start 2>/dev/null || true
    elif command -v sv &> /dev/null; then
        sv restart quantix-kvm-agent 2>/dev/null || sv start quantix-kvm-agent 2>/dev/null || true
    elif command -v service &> /dev/null; then
        service quantix-kvm-agent restart 2>/dev/null || service quantix-kvm-agent start 2>/dev/null || true
    fi
}

# Uninstall the agent
uninstall_agent() {
    log_step "Uninstalling Quantix KVM Agent..."
    
    # Stop and disable service
    if command -v systemctl &> /dev/null; then
        systemctl stop quantix-kvm-agent 2>/dev/null || true
        systemctl disable quantix-kvm-agent 2>/dev/null || true
        rm -f /etc/systemd/system/quantix-kvm-agent.service
        systemctl daemon-reload
    elif command -v rc-service &> /dev/null; then
        rc-service quantix-kvm-agent stop 2>/dev/null || true
        rc-update del quantix-kvm-agent 2>/dev/null || true
        rm -f /etc/init.d/quantix-kvm-agent
    fi
    
    # Remove binary
    rm -f /usr/local/bin/quantix-kvm-agent
    
    # Optionally remove config (keep logs)
    # rm -rf /etc/quantix-kvm
    
    log_info "Quantix KVM Agent uninstalled"
    log_info "Configuration preserved in /etc/quantix-kvm"
    log_info "Logs preserved in /var/log/quantix-kvm"
}

# Verify installation
verify_installation() {
    log_step "Verifying installation..."
    
    echo ""
    
    # Check QEMU GA
    if [ "${SKIP_QEMU_GA}" = false ]; then
        if systemctl is-active --quiet qemu-guest-agent 2>/dev/null || \
           rc-service qemu-guest-agent status &>/dev/null 2>&1; then
            log_info "✓ QEMU Guest Agent: running"
        else
            log_warn "✗ QEMU Guest Agent: not running"
        fi
    fi
    
    # Check Quantix Agent
    if systemctl is-active --quiet quantix-kvm-agent 2>/dev/null || \
       rc-service quantix-kvm-agent status &>/dev/null 2>&1; then
        log_info "✓ Quantix KVM Agent: running"
    else
        log_warn "✗ Quantix KVM Agent: not running"
    fi
    
    # Check virtio-serial device
    local virtio_found=false
    for port in /dev/virtio-ports/org.quantix.agent.*; do
        if [ -c "${port}" ]; then
            log_info "✓ Virtio-serial: ${port}"
            virtio_found=true
            break
        fi
    done
    
    if [ "${virtio_found}" = false ]; then
        log_warn "✗ Virtio-serial channel not found (available after VM restart with channel configured)"
    fi
    
    echo ""
    log_info "============================================="
    log_info "Installation complete!"
    log_info "============================================="
    echo ""
    log_info "The Quantix Dashboard should show this VM as"
    log_info "'Connected' within seconds."
    echo ""
    log_info "Useful commands:"
    log_info "  systemctl status quantix-kvm-agent"
    log_info "  journalctl -u quantix-kvm-agent -f"
    echo ""
}

# Main
main() {
    echo ""
    log_info "============================================="
    log_info "Quantix KVM Agent Tools Installer"
    log_info "============================================="
    echo ""
    
    if [ "${UNINSTALL}" = true ]; then
        uninstall_agent
        exit 0
    fi
    
    log_info "Architecture: ${ARCH}"
    detect_os
    log_info "OS: ${OS_NAME}"
    log_info "Package Manager: ${PKG_MANAGER}"
    echo ""
    
    install_qemu_ga
    configure_qemu_ga
    install_quantix_agent
    verify_installation
}

main "$@"
