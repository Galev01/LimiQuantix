#!/bin/bash
# QvDC Database Troubleshooting Script
# Run this on the QvDC appliance to diagnose and fix database issues
#
# Usage: ./qvdc-db-troubleshoot.sh [check|fix|reset]
#   check - Check database status (default)
#   fix   - Attempt to fix common issues
#   reset - Reset database completely (DESTRUCTIVE!)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_NAME="quantix_vdc"
MIGRATIONS_DIR="/usr/share/quantix-vdc/migrations"
PGDATA="/var/lib/postgresql/16/data"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================================================
# CHECK FUNCTIONS
# ============================================================================

check_postgresql_service() {
    log_info "Checking PostgreSQL service..."
    if rc-service postgresql status >/dev/null 2>&1; then
        log_ok "PostgreSQL service is running"
        return 0
    else
        log_error "PostgreSQL service is NOT running"
        return 1
    fi
}

check_postgresql_listening() {
    log_info "Checking if PostgreSQL is listening on port 5432..."
    if netstat -tlnp 2>/dev/null | grep -q ":5432" || ss -tlnp 2>/dev/null | grep -q ":5432"; then
        log_ok "PostgreSQL is listening on port 5432"
        return 0
    else
        log_error "PostgreSQL is NOT listening on port 5432"
        return 1
    fi
}

check_postgresql_connection() {
    log_info "Testing PostgreSQL connection..."
    if su -s /bin/sh postgres -c "psql -c 'SELECT 1'" >/dev/null 2>&1; then
        log_ok "PostgreSQL connection successful"
        return 0
    else
        log_error "Cannot connect to PostgreSQL"
        return 1
    fi
}

check_database_exists() {
    log_info "Checking if database '$DB_NAME' exists..."
    if su -s /bin/sh postgres -c "psql -lqt" | grep -qw "$DB_NAME"; then
        log_ok "Database '$DB_NAME' exists"
        return 0
    else
        log_warn "Database '$DB_NAME' does NOT exist"
        return 1
    fi
}

check_tables_exist() {
    log_info "Checking if tables exist..."
    local table_count
    table_count=$(su -s /bin/sh postgres -c "psql -d $DB_NAME -tAc \"SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'\"" 2>/dev/null || echo "0")
    
    if [ "$table_count" -gt 0 ]; then
        log_ok "Found $table_count tables in database"
        return 0
    else
        log_warn "No tables found in database"
        return 1
    fi
}

check_migrations() {
    log_info "Checking migrations status..."
    
    # Check if schema_migrations table exists
    if su -s /bin/sh postgres -c "psql -d $DB_NAME -tAc \"SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations'\"" 2>/dev/null | grep -q "1"; then
        local version
        version=$(su -s /bin/sh postgres -c "psql -d $DB_NAME -tAc 'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'" 2>/dev/null || echo "none")
        log_ok "Migrations applied. Current version: $version"
        return 0
    else
        log_warn "No migrations have been applied (schema_migrations table missing)"
        return 1
    fi
}

check_node_data() {
    log_info "Checking for registered nodes..."
    local node_count
    node_count=$(su -s /bin/sh postgres -c "psql -d $DB_NAME -tAc 'SELECT count(*) FROM nodes'" 2>/dev/null || echo "0")
    
    if [ "$node_count" -gt 0 ]; then
        log_ok "Found $node_count registered node(s)"
        echo ""
        echo "Registered Nodes:"
        su -s /bin/sh postgres -c "psql -d $DB_NAME -c 'SELECT id, hostname, management_ip, phase FROM nodes'" 2>/dev/null || true
    else
        log_info "No nodes registered yet"
    fi
}

check_control_plane() {
    log_info "Checking control plane service..."
    if rc-service quantix-controlplane status >/dev/null 2>&1; then
        log_ok "Control plane service is running"
        return 0
    else
        log_warn "Control plane service is NOT running"
        return 1
    fi
}

# ============================================================================
# FIX FUNCTIONS
# ============================================================================

fix_postgresql_service() {
    log_info "Starting PostgreSQL service..."
    rc-service postgresql start
    sleep 2
    check_postgresql_service
}

fix_create_database() {
    log_info "Creating database '$DB_NAME'..."
    su -s /bin/sh postgres -c "createdb $DB_NAME" 2>/dev/null || true
    check_database_exists
}

fix_run_migrations() {
    log_info "Running database migrations..."
    
    if [ ! -d "$MIGRATIONS_DIR" ]; then
        log_error "Migrations directory not found: $MIGRATIONS_DIR"
        log_info "Trying alternative location..."
        MIGRATIONS_DIR="/opt/quantix-vdc/migrations"
    fi
    
    if [ ! -d "$MIGRATIONS_DIR" ]; then
        log_error "Cannot find migrations directory"
        return 1
    fi
    
    log_info "Using migrations from: $MIGRATIONS_DIR"
    
    # Run migrations using golang-migrate if available
    if command -v migrate >/dev/null 2>&1; then
        migrate -path "$MIGRATIONS_DIR" -database "postgres://postgres@localhost/$DB_NAME?sslmode=disable" up
    else
        # Manual migration execution
        log_info "Running migrations manually..."
        for migration in "$MIGRATIONS_DIR"/*.up.sql; do
            if [ -f "$migration" ]; then
                log_info "Applying: $(basename "$migration")"
                su -s /bin/sh postgres -c "psql -d $DB_NAME -f '$migration'" 2>&1 || true
            fi
        done
    fi
    
    check_tables_exist
}

fix_restart_control_plane() {
    log_info "Restarting control plane service..."
    rc-service quantix-controlplane restart 2>/dev/null || true
    sleep 3
    check_control_plane
}

# ============================================================================
# RESET FUNCTION (DESTRUCTIVE!)
# ============================================================================

reset_database() {
    log_warn "This will DELETE ALL DATA in the database!"
    echo -n "Are you sure? Type 'yes' to confirm: "
    read -r confirm
    
    if [ "$confirm" != "yes" ]; then
        log_info "Aborted"
        return 1
    fi
    
    log_info "Stopping control plane..."
    rc-service quantix-controlplane stop 2>/dev/null || true
    
    log_info "Dropping database..."
    su -s /bin/sh postgres -c "dropdb $DB_NAME" 2>/dev/null || true
    
    log_info "Creating fresh database..."
    su -s /bin/sh postgres -c "createdb $DB_NAME"
    
    log_info "Running migrations..."
    fix_run_migrations
    
    log_info "Starting control plane..."
    rc-service quantix-controlplane start
    
    log_ok "Database reset complete"
}

# ============================================================================
# MAIN
# ============================================================================

run_checks() {
    echo ""
    echo "=========================================="
    echo "  QvDC Database Troubleshooting"
    echo "=========================================="
    echo ""
    
    local errors=0
    
    check_postgresql_service || ((errors++))
    check_postgresql_listening || ((errors++))
    check_postgresql_connection || ((errors++))
    check_database_exists || ((errors++))
    check_tables_exist || ((errors++))
    check_migrations || ((errors++))
    check_node_data
    check_control_plane || ((errors++))
    
    echo ""
    echo "=========================================="
    if [ $errors -eq 0 ]; then
        log_ok "All checks passed!"
    else
        log_warn "$errors issue(s) found. Run with 'fix' to attempt repairs."
    fi
    echo "=========================================="
    
    return $errors
}

run_fixes() {
    echo ""
    echo "=========================================="
    echo "  QvDC Database Auto-Fix"
    echo "=========================================="
    echo ""
    
    # Check and fix PostgreSQL service
    if ! check_postgresql_service; then
        fix_postgresql_service
    fi
    
    # Check and fix database
    if ! check_database_exists; then
        fix_create_database
    fi
    
    # Check and fix tables
    if ! check_tables_exist; then
        fix_run_migrations
    fi
    
    # Restart control plane
    fix_restart_control_plane
    
    echo ""
    log_info "Running final checks..."
    run_checks
}

# Parse arguments
case "${1:-check}" in
    check)
        run_checks
        ;;
    fix)
        run_fixes
        ;;
    reset)
        reset_database
        ;;
    *)
        echo "Usage: $0 [check|fix|reset]"
        echo "  check - Check database status (default)"
        echo "  fix   - Attempt to fix common issues"
        echo "  reset - Reset database completely (DESTRUCTIVE!)"
        exit 1
        ;;
esac
