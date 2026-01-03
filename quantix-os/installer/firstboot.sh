#!/bin/sh
# ============================================================================
# Quantix-OS First Boot Script
# ============================================================================
# This script runs on first boot after installation to complete setup.
# It is called by the quantix-firstboot OpenRC service.
#
# Tasks:
# - Generate unique node ID
# - Create TLS certificates
# - Initialize storage pools
# - Configure networking
# - Start services
# ============================================================================

set -e

# Configuration
CONFIG_DIR="/quantix"
CERT_DIR="${CONFIG_DIR}/certificates"
DATA_DIR="/data"

# Logging
log_info() { echo "[FIRSTBOOT] $1"; }
log_error() { echo "[FIRSTBOOT] ERROR: $1" >&2; }

# ============================================================================
# Generate Node Identity
# ============================================================================
generate_node_id() {
    log_info "Generating node identity..."
    
    NODE_ID=$(cat /proc/sys/kernel/random/uuid)
    
    if [ -f "${CONFIG_DIR}/node.yaml" ]; then
        sed -i "s/^  id: \"\"/  id: \"${NODE_ID}\"/" "${CONFIG_DIR}/node.yaml"
    else
        mkdir -p "${CONFIG_DIR}"
        cat > "${CONFIG_DIR}/node.yaml" << EOF
node:
  id: "${NODE_ID}"
  hostname: "$(hostname)"
  description: "Quantix Hypervisor Node"
EOF
    fi
    
    log_info "Node ID: ${NODE_ID}"
}

# ============================================================================
# Generate TLS Certificates
# ============================================================================
generate_certificates() {
    log_info "Generating TLS certificates..."
    
    mkdir -p "${CERT_DIR}"
    
    # Get management IP
    MGMT_IP=$(ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '127.0.0.1' | head -1)
    HOSTNAME=$(hostname)
    
    # Generate CA key and certificate
    if [ ! -f "${CERT_DIR}/ca.key" ]; then
        openssl genrsa -out "${CERT_DIR}/ca.key" 4096 2>/dev/null
        openssl req -new -x509 -days 3650 \
            -key "${CERT_DIR}/ca.key" \
            -out "${CERT_DIR}/ca.crt" \
            -subj "/CN=Quantix-CA/O=Quantix" 2>/dev/null
    fi
    
    # Generate node key and certificate
    if [ ! -f "${CERT_DIR}/node.key" ]; then
        openssl genrsa -out "${CERT_DIR}/node.key" 2048 2>/dev/null
        
        # Create CSR config with SANs
        cat > /tmp/node-csr.conf << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = req_ext

[dn]
CN = ${HOSTNAME}
O = Quantix

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${HOSTNAME}
DNS.2 = ${HOSTNAME}.local
DNS.3 = localhost
IP.1 = ${MGMT_IP:-127.0.0.1}
IP.2 = 127.0.0.1
EOF
        
        # Generate CSR
        openssl req -new \
            -key "${CERT_DIR}/node.key" \
            -out "${CERT_DIR}/node.csr" \
            -config /tmp/node-csr.conf 2>/dev/null
        
        # Sign certificate
        cat > /tmp/node-ext.conf << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${HOSTNAME}
DNS.2 = ${HOSTNAME}.local
DNS.3 = localhost
IP.1 = ${MGMT_IP:-127.0.0.1}
IP.2 = 127.0.0.1
EOF
        
        openssl x509 -req -days 365 \
            -in "${CERT_DIR}/node.csr" \
            -CA "${CERT_DIR}/ca.crt" \
            -CAkey "${CERT_DIR}/ca.key" \
            -CAcreateserial \
            -out "${CERT_DIR}/node.crt" \
            -extfile /tmp/node-ext.conf 2>/dev/null
        
        # Cleanup
        rm -f "${CERT_DIR}/node.csr" /tmp/node-csr.conf /tmp/node-ext.conf
    fi
    
    # Set permissions
    chmod 600 "${CERT_DIR}"/*.key
    chmod 644 "${CERT_DIR}"/*.crt
    
    log_info "Certificates generated"
}

# ============================================================================
# Initialize Storage
# ============================================================================
initialize_storage() {
    log_info "Initializing storage..."
    
    # Create storage directories
    mkdir -p "${DATA_DIR}/vms"
    mkdir -p "${DATA_DIR}/isos"
    mkdir -p "${DATA_DIR}/images"
    mkdir -p "${DATA_DIR}/backups"
    mkdir -p "${DATA_DIR}/snapshots"
    
    # Set permissions
    chmod 755 "${DATA_DIR}"/*
    
    # Initialize libvirt default pool
    if command -v virsh >/dev/null 2>&1; then
        # Check if pool exists
        if ! virsh pool-info default >/dev/null 2>&1; then
            virsh pool-define-as default dir --target "${DATA_DIR}/vms"
            virsh pool-autostart default
            virsh pool-start default
        fi
    fi
    
    log_info "Storage initialized"
}

# ============================================================================
# Initialize Open vSwitch
# ============================================================================
initialize_ovs() {
    log_info "Initializing Open vSwitch..."
    
    if command -v ovs-vsctl >/dev/null 2>&1; then
        # Wait for OVS to be ready
        local count=0
        while ! ovs-vsctl show >/dev/null 2>&1; do
            sleep 1
            count=$((count + 1))
            if [ $count -ge 30 ]; then
                log_error "OVS not ready after 30 seconds"
                return 1
            fi
        done
        
        # Create integration bridge
        ovs-vsctl --may-exist add-br br-int
        
        # Set fail-mode to standalone (allows local switching without controller)
        ovs-vsctl set-fail-mode br-int standalone
        
        log_info "OVS initialized with br-int bridge"
    fi
}

# ============================================================================
# Sync Time
# ============================================================================
sync_time() {
    log_info "Synchronizing time..."
    
    # Try NTP sync (best effort)
    if command -v ntpd >/dev/null 2>&1; then
        ntpd -d -q -n -p pool.ntp.org 2>/dev/null || true
    elif command -v chronyd >/dev/null 2>&1; then
        chronyd -q 'server pool.ntp.org iburst' 2>/dev/null || true
    fi
    
    # Set hardware clock
    hwclock -w 2>/dev/null || true
    
    log_info "Time synchronized"
}

# ============================================================================
# Complete First Boot
# ============================================================================
complete_firstboot() {
    log_info "Completing first boot setup..."
    
    # Remove first boot marker
    rm -f "${CONFIG_DIR}/.firstboot"
    
    # Record installation timestamp
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "${CONFIG_DIR}/.installed_at"
    
    # Record version
    if [ -f /etc/quantix-release ]; then
        cp /etc/quantix-release "${CONFIG_DIR}/.version"
    fi
    
    log_info "First boot complete!"
}

# ============================================================================
# Main
# ============================================================================
main() {
    log_info "=========================================="
    log_info "Quantix-OS First Boot Configuration"
    log_info "=========================================="
    
    # Check if already configured
    if [ ! -f "${CONFIG_DIR}/.firstboot" ] && [ -f "${CONFIG_DIR}/node.yaml" ]; then
        log_info "Already configured, skipping first boot"
        exit 0
    fi
    
    generate_node_id
    generate_certificates
    initialize_storage
    initialize_ovs
    sync_time
    complete_firstboot
    
    log_info "=========================================="
    log_info "First boot configuration complete!"
    log_info "=========================================="
}

main "$@"
