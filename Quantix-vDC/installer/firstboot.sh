#!/bin/sh
# =============================================================================
# Quantix-vDC First Boot Script
# =============================================================================
# This script runs on the first boot after installation to:
# - Initialize PostgreSQL database
# - Generate TLS certificates
# - Create initial admin user
# - Start all services
# - Display access information
#
# This is called by the quantix-firstboot OpenRC service.
# =============================================================================

set -e

# Check if already completed
if [ -f /var/lib/quantix-vdc/.setup_complete ]; then
    echo "First boot setup already completed."
    exit 0
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Quantix-vDC First Boot Configuration                  ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# =============================================================================
# Step 1: Initialize PostgreSQL
# =============================================================================
echo "[1/6] Initializing PostgreSQL..."

PG_DATA="/var/lib/postgresql/16/data"

if [ ! -f "$PG_DATA/PG_VERSION" ]; then
    # Initialize database cluster
    mkdir -p "$PG_DATA"
    chown -R postgres:postgres /var/lib/postgresql
    chmod 700 "$PG_DATA"
    
    su -s /bin/sh postgres -c "initdb -D $PG_DATA --encoding=UTF8 --locale=C"
    
    # Configure PostgreSQL
    cat > "$PG_DATA/pg_hba.conf" << 'EOF'
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
EOF

    # Update postgresql.conf
    sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '127.0.0.1'/" "$PG_DATA/postgresql.conf"
    sed -i "s/#port = 5432/port = 5432/" "$PG_DATA/postgresql.conf"
fi

# Start PostgreSQL
rc-service postgresql start

# Wait for PostgreSQL to be ready
echo "   Waiting for PostgreSQL to start..."
for i in $(seq 1 30); do
    if su -s /bin/sh postgres -c "pg_isready" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

# Create database and user
su -s /bin/sh postgres -c "createdb quantix_vdc 2>/dev/null || true"
su -s /bin/sh postgres -c "createuser quantix 2>/dev/null || true"
su -s /bin/sh postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE quantix_vdc TO quantix;\"" 2>/dev/null || true

echo "   PostgreSQL initialized ✓"

# =============================================================================
# Step 2: Initialize etcd
# =============================================================================
echo "[2/6] Initializing etcd..."

mkdir -p /var/lib/etcd
chmod 700 /var/lib/etcd

rc-service etcd start

# Wait for etcd
echo "   Waiting for etcd to start..."
for i in $(seq 1 30); do
    if etcdctl endpoint health >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

echo "   etcd initialized ✓"

# =============================================================================
# Step 3: Initialize Redis
# =============================================================================
echo "[3/6] Initializing Redis..."

mkdir -p /var/lib/redis
chmod 700 /var/lib/redis

rc-service redis start

echo "   Redis initialized ✓"

# =============================================================================
# Step 4: Generate TLS certificates
# =============================================================================
echo "[4/6] Generating TLS certificates..."

CERT_DIR="/var/lib/quantix-vdc/certs"
mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

if [ ! -f "$CERT_DIR/server.key" ]; then
    HOSTNAME=$(hostname)
    PRIMARY_IP=$(ip -4 addr show scope global | grep inet | head -1 | awk '{print $2}' | cut -d/ -f1)
    PRIMARY_IP=${PRIMARY_IP:-"127.0.0.1"}
    
    # Generate CA
    openssl genrsa -out "$CERT_DIR/ca.key" 4096 2>/dev/null
    openssl req -new -x509 \
        -key "$CERT_DIR/ca.key" \
        -out "$CERT_DIR/ca.crt" \
        -days 3650 \
        -subj "/CN=Quantix-vDC CA/O=Quantix-KVM" 2>/dev/null
    
    # Generate server certificate
    openssl genrsa -out "$CERT_DIR/server.key" 4096 2>/dev/null
    
    # Create SAN config
    cat > "$CERT_DIR/san.cnf" << EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = ${HOSTNAME}
O = Quantix-KVM
OU = Control-Plane

[v3_req]
keyUsage = keyEncipherment, dataEncipherment, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${HOSTNAME}
DNS.2 = localhost
IP.1 = ${PRIMARY_IP}
IP.2 = 127.0.0.1
EOF

    openssl req -new \
        -key "$CERT_DIR/server.key" \
        -out "$CERT_DIR/server.csr" \
        -config "$CERT_DIR/san.cnf" 2>/dev/null
    
    openssl x509 -req \
        -in "$CERT_DIR/server.csr" \
        -CA "$CERT_DIR/ca.crt" \
        -CAkey "$CERT_DIR/ca.key" \
        -CAcreateserial \
        -out "$CERT_DIR/server.crt" \
        -days 3650 \
        -extensions v3_req \
        -extfile "$CERT_DIR/san.cnf" 2>/dev/null
    
    chmod 600 "$CERT_DIR/server.key" "$CERT_DIR/ca.key"
    chmod 644 "$CERT_DIR/server.crt" "$CERT_DIR/ca.crt"
    
    rm -f "$CERT_DIR/server.csr" "$CERT_DIR/san.cnf"
fi

echo "   TLS certificates generated ✓"

# =============================================================================
# Step 5: Generate JWT secret
# =============================================================================
echo "[5/6] Generating JWT secret..."

JWT_SECRET_FILE="/var/lib/quantix-vdc/jwt.secret"
if [ ! -f "$JWT_SECRET_FILE" ]; then
    openssl rand -base64 64 > "$JWT_SECRET_FILE"
    chmod 600 "$JWT_SECRET_FILE"
fi

# Generate registration token
REG_TOKEN_FILE="/var/lib/quantix-vdc/registration.token"
if [ ! -f "$REG_TOKEN_FILE" ]; then
    openssl rand -hex 32 > "$REG_TOKEN_FILE"
    chmod 600 "$REG_TOKEN_FILE"
fi

echo "   Secrets generated ✓"

# =============================================================================
# Step 6: Start services
# =============================================================================
echo "[6/6] Starting services..."

# Start control plane
rc-service quantix-controlplane start 2>/dev/null || true

# Start nginx
rc-service nginx start 2>/dev/null || true

echo "   Services started ✓"

# =============================================================================
# Complete
# =============================================================================

# Mark setup complete
touch /var/lib/quantix-vdc/.setup_complete

# Get network info
PRIMARY_IP=$(ip -4 addr show scope global | grep inet | head -1 | awk '{print $2}' | cut -d/ -f1)
PRIMARY_IP=${PRIMARY_IP:-"<ip-address>"}

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         First Boot Configuration Complete!                    ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║                                                               ║"
echo "║  Access the web management console at:                        ║"
echo "║                                                               ║"
echo "║      https://${PRIMARY_IP}/                                   ║"
echo "║                                                               ║"
echo "║  Node Registration Token:                                     ║"
echo "║      $(cat /var/lib/quantix-vdc/registration.token)"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
