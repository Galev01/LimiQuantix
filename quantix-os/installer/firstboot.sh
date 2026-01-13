#!/bin/bash
# =============================================================================
# Quantix-OS First Boot Script
# =============================================================================
# Runs on first boot to perform initial system configuration.
# This script is called by the quantix-firstboot OpenRC service.
# =============================================================================

set -e

MARKER_FILE="/quantix/.setup_complete"
LOG_FILE="/var/log/quantix-firstboot.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check if first boot
if [ -f "$MARKER_FILE" ]; then
    log "First boot already completed, skipping..."
    exit 0
fi

log "Starting Quantix-OS first boot configuration..."

# -----------------------------------------------------------------------------
# Generate SSH host keys
# -----------------------------------------------------------------------------
generate_ssh_keys() {
    log "Generating SSH host keys..."
    
    if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
        ssh-keygen -t rsa -b 4096 -f /etc/ssh/ssh_host_rsa_key -N "" -q
    fi
    
    if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then
        ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N "" -q
    fi
    
    if [ ! -f /etc/ssh/ssh_host_ecdsa_key ]; then
        ssh-keygen -t ecdsa -b 521 -f /etc/ssh/ssh_host_ecdsa_key -N "" -q
    fi
    
    log "SSH host keys generated"
}

# -----------------------------------------------------------------------------
# Generate TLS certificates
# -----------------------------------------------------------------------------
generate_tls_certs() {
    log "Generating TLS certificates..."
    
    CERT_DIR="/quantix/certificates"
    mkdir -p "$CERT_DIR"
    
    if [ ! -f "$CERT_DIR/server.key" ]; then
        # Generate private key
        openssl genrsa -out "$CERT_DIR/server.key" 4096
        
        # Get hostname
        HOSTNAME=$(hostname)
        
        # Generate self-signed certificate
        openssl req -new -x509 \
            -key "$CERT_DIR/server.key" \
            -out "$CERT_DIR/server.crt" \
            -days 3650 \
            -subj "/CN=${HOSTNAME}/O=Quantix-KVM/OU=Hypervisor" \
            -addext "subjectAltName=DNS:${HOSTNAME},DNS:localhost,IP:127.0.0.1"
        
        chmod 600 "$CERT_DIR/server.key"
        chmod 644 "$CERT_DIR/server.crt"
    fi
    
    log "TLS certificates generated"
}

# -----------------------------------------------------------------------------
# Mount installer-configured storage pools
# -----------------------------------------------------------------------------
mount_storage_pools() {
    log "Mounting installer-configured storage pools..."
    
    POOLS_FSTAB="/quantix/fstab.pools"
    if [ -f "$POOLS_FSTAB" ]; then
        log "Found storage pools fstab: $POOLS_FSTAB"
        
        # Read each line and mount
        while IFS= read -r line || [ -n "$line" ]; do
            # Skip empty lines and comments
            [ -z "$line" ] && continue
            echo "$line" | grep -q "^#" && continue
            
            # Extract mount point
            MOUNT_POINT=$(echo "$line" | awk '{print $2}')
            
            if [ -n "$MOUNT_POINT" ]; then
                log "Creating mount point: $MOUNT_POINT"
                mkdir -p "$MOUNT_POINT"
                
                # Try to mount
                if mount -a -T "$POOLS_FSTAB" 2>/dev/null; then
                    log "Mounted storage pools from fstab"
                else
                    # Fallback: mount individually
                    log "Fallback: mounting $MOUNT_POINT"
                    mount $(echo "$line" | awk '{print "UUID="$1}' | sed 's/UUID=UUID=/UUID=/') "$MOUNT_POINT" 2>/dev/null || true
                fi
            fi
        done < "$POOLS_FSTAB"
        
        # Append to system fstab if not already there
        if ! grep -q "# Quantix storage pools" /etc/fstab 2>/dev/null; then
            echo "" >> /etc/fstab
            echo "# Quantix storage pools (installer-configured)" >> /etc/fstab
            cat "$POOLS_FSTAB" >> /etc/fstab
        fi
    fi
    
    log "Storage pools mounted"
}

# -----------------------------------------------------------------------------
# Initialize libvirt
# -----------------------------------------------------------------------------
init_libvirt() {
    log "Initializing libvirt..."
    
    # Create default storage pool
    if ! virsh pool-info default &>/dev/null; then
        virsh pool-define-as default dir --target /data/vms
        virsh pool-autostart default
        virsh pool-start default
    fi
    
    # Create default network (if not using OVS)
    if ! virsh net-info default &>/dev/null; then
        cat > /tmp/default-network.xml << 'EOF'
<network>
  <name>default</name>
  <forward mode='nat'>
    <nat>
      <port start='1024' end='65535'/>
    </nat>
  </forward>
  <bridge name='virbr0' stp='on' delay='0'/>
  <ip address='192.168.122.1' netmask='255.255.255.0'>
    <dhcp>
      <range start='192.168.122.2' end='192.168.122.254'/>
    </dhcp>
  </ip>
</network>
EOF
        virsh net-define /tmp/default-network.xml
        virsh net-autostart default
        virsh net-start default
        rm /tmp/default-network.xml
    fi
    
    log "Libvirt initialized"
}

# -----------------------------------------------------------------------------
# Register installer-configured storage pools with libvirt
# -----------------------------------------------------------------------------
register_storage_pools() {
    log "Registering installer-configured storage pools with libvirt..."
    
    POOLS_CONFIG="/quantix/limiquantix/storage-pools.yaml"
    if [ ! -f "$POOLS_CONFIG" ]; then
        log "No installer-configured storage pools found"
        return 0
    fi
    
    # Parse YAML and create libvirt pools
    # Extract pool names and mount points using simple shell parsing
    # Format in YAML:
    #   - name: pool-name
    #     mount_point: /data/pools/pool-name
    
    POOL_NAME=""
    MOUNT_POINT=""
    
    while IFS= read -r line || [ -n "$line" ]; do
        # Check for name field
        if echo "$line" | grep -q "name:"; then
            POOL_NAME=$(echo "$line" | sed 's/.*name:[[:space:]]*//' | tr -d ' ')
        fi
        
        # Check for mount_point field
        if echo "$line" | grep -q "mount_point:"; then
            MOUNT_POINT=$(echo "$line" | sed 's/.*mount_point:[[:space:]]*//' | tr -d ' ')
            
            # If we have both name and mount_point, create the pool
            if [ -n "$POOL_NAME" ] && [ -n "$MOUNT_POINT" ]; then
                log "Registering storage pool: $POOL_NAME at $MOUNT_POINT"
                
                # Check if pool already exists
                if virsh pool-info "$POOL_NAME" &>/dev/null; then
                    log "Pool $POOL_NAME already exists, skipping"
                else
                    # Create directory structure
                    mkdir -p "${MOUNT_POINT}/vms"
                    mkdir -p "${MOUNT_POINT}/images"
                    mkdir -p "${MOUNT_POINT}/isos"
                    
                    # Define and start the pool
                    virsh pool-define-as "$POOL_NAME" dir --target "$MOUNT_POINT"
                    virsh pool-autostart "$POOL_NAME"
                    virsh pool-start "$POOL_NAME" || log "Warning: Could not start pool $POOL_NAME (disk may not be mounted)"
                    
                    log "Storage pool $POOL_NAME registered"
                fi
                
                # Reset for next pool
                POOL_NAME=""
                MOUNT_POINT=""
            fi
        fi
    done < "$POOLS_CONFIG"
    
    log "Storage pools registered"
}

# -----------------------------------------------------------------------------
# Initialize OVS
# -----------------------------------------------------------------------------
init_ovs() {
    log "Initializing Open vSwitch..."
    
    # Create integration bridge if not exists
    if ! ovs-vsctl br-exists br-int 2>/dev/null; then
        ovs-vsctl add-br br-int
        log "Created OVS integration bridge: br-int"
    fi
    
    log "Open vSwitch initialized"
}

# -----------------------------------------------------------------------------
# Create default configuration
# -----------------------------------------------------------------------------
create_default_config() {
    log "Creating default configuration..."
    
    # Create node.yaml if not exists
    if [ ! -f /quantix/node.yaml ]; then
        cat > /quantix/node.yaml << EOF
# Quantix-OS Node Configuration
# Generated on first boot: $(date -u +%Y-%m-%dT%H:%M:%SZ)

node:
  # Node identifier (generated on first boot)
  id: "$(cat /proc/sys/kernel/random/uuid)"
  # Hostname (set via console wizard)
  hostname: "$(hostname)"

# Network configuration
network:
  management_interface: ""
  use_dhcp: true

# Security settings
security:
  ssh_enabled: false

# Cluster settings
cluster:
  control_plane_address: ""
  registration_token: ""
EOF
        chmod 600 /quantix/node.yaml
    fi
    
    log "Default configuration created"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

main() {
    log "============================================"
    log "Quantix-OS First Boot Configuration"
    log "============================================"
    
    generate_ssh_keys
    generate_tls_certs
    mount_storage_pools  # Mount installer-configured pools first
    init_libvirt
    register_storage_pools  # Register pools with libvirt after init
    init_ovs
    create_default_config
    
    # Note: We don't create the marker file here
    # The console wizard creates it after user completes setup
    
    log "First boot configuration complete"
    log "Waiting for user to complete setup wizard..."
}

main "$@"
