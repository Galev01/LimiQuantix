#!/bin/sh
# =============================================================================
# Quantix-vDC Database Repair Script
# =============================================================================
# Run this script on the QvDC host to check and repair database issues.
#
# Usage: ./qvdc-db-repair.sh [check|repair|migrate]
#   check   - Check database status (default)
#   repair  - Repair missing tables
#   migrate - Run all migrations
# =============================================================================

set -e

ACTION="${1:-check}"
DB_NAME="quantix_vdc"
DB_USER="postgres"
MIGRATIONS_DIR="/usr/share/quantix-vdc/migrations"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Quantix-vDC Database Repair Tool                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------
run_sql() {
    su -s /bin/sh postgres -c "psql -d ${DB_NAME} -t -c \"$1\"" 2>/dev/null
}

table_exists() {
    result=$(run_sql "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '$1');")
    echo "$result" | tr -d ' ' | grep -q 't'
}

# -----------------------------------------------------------------------------
# Check PostgreSQL Service
# -----------------------------------------------------------------------------
echo "[1/4] Checking PostgreSQL service..."

if ! rc-status 2>/dev/null | grep -q "postgresql.*started"; then
    if ! rc-status 2>/dev/null | grep -q "postgresql16.*started"; then
        echo "${RED}   ✗ PostgreSQL is not running${NC}"
        echo "   Starting PostgreSQL..."
        rc-service postgresql start 2>/dev/null || rc-service postgresql16 start 2>/dev/null || {
            echo "${RED}   ✗ Failed to start PostgreSQL${NC}"
            exit 1
        }
        sleep 2
    fi
fi

# Wait for PostgreSQL to be ready
for i in $(seq 1 10); do
    if su -s /bin/sh postgres -c "pg_isready" >/dev/null 2>&1; then
        echo "${GREEN}   ✓ PostgreSQL is running${NC}"
        break
    fi
    sleep 1
done

# -----------------------------------------------------------------------------
# Check Database Exists
# -----------------------------------------------------------------------------
echo "[2/4] Checking database..."

if ! su -s /bin/sh postgres -c "psql -lqt" 2>/dev/null | cut -d \| -f 1 | grep -qw "${DB_NAME}"; then
    echo "${YELLOW}   ⚠ Database '${DB_NAME}' does not exist${NC}"
    if [ "$ACTION" = "repair" ] || [ "$ACTION" = "migrate" ]; then
        echo "   Creating database..."
        su -s /bin/sh postgres -c "createdb ${DB_NAME}"
        su -s /bin/sh postgres -c "createuser quantix 2>/dev/null || true"
        su -s /bin/sh postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO quantix;\""
        echo "${GREEN}   ✓ Database created${NC}"
    else
        echo "   Run with 'repair' to create it."
        exit 1
    fi
else
    echo "${GREEN}   ✓ Database '${DB_NAME}' exists${NC}"
fi

# -----------------------------------------------------------------------------
# Check Required Tables
# -----------------------------------------------------------------------------
echo "[3/4] Checking required tables..."

REQUIRED_TABLES="projects clusters nodes virtual_machines storage_pools volumes folders"
MISSING_TABLES=""

for table in $REQUIRED_TABLES; do
    if table_exists "$table"; then
        echo "${GREEN}   ✓ Table '$table' exists${NC}"
    else
        echo "${RED}   ✗ Table '$table' is MISSING${NC}"
        MISSING_TABLES="${MISSING_TABLES} ${table}"
    fi
done

# -----------------------------------------------------------------------------
# Check Migrations Directory
# -----------------------------------------------------------------------------
echo "[4/4] Checking migrations..."

if [ -d "$MIGRATIONS_DIR" ]; then
    MIGRATION_COUNT=$(ls -1 ${MIGRATIONS_DIR}/*.up.sql 2>/dev/null | wc -l)
    if [ "$MIGRATION_COUNT" -gt 0 ]; then
        echo "${GREEN}   ✓ Found ${MIGRATION_COUNT} migration files in ${MIGRATIONS_DIR}${NC}"
        echo "   Available migrations:"
        ls -1 ${MIGRATIONS_DIR}/*.up.sql | while read f; do echo "     - $(basename $f)"; done
    else
        echo "${RED}   ✗ No migration files found in ${MIGRATIONS_DIR}${NC}"
    fi
else
    echo "${RED}   ✗ Migrations directory not found: ${MIGRATIONS_DIR}${NC}"
fi

# -----------------------------------------------------------------------------
# Summary and Actions
# -----------------------------------------------------------------------------
echo ""
echo "═══════════════════════════════════════════════════════════════"

if [ -n "$MISSING_TABLES" ]; then
    echo "${RED}Missing tables:${MISSING_TABLES}${NC}"
    echo ""
    
    if [ "$ACTION" = "repair" ] || [ "$ACTION" = "migrate" ]; then
        echo "Running migrations to create missing tables..."
        echo ""
        
        if [ -d "$MIGRATIONS_DIR" ] && [ -n "$(ls -A ${MIGRATIONS_DIR}/*.up.sql 2>/dev/null)" ]; then
            for migration in $(ls -1 ${MIGRATIONS_DIR}/*.up.sql | sort); do
                MIGRATION_NAME=$(basename "$migration")
                echo "   Applying: ${MIGRATION_NAME}"
                
                if su -s /bin/sh postgres -c "psql -d ${DB_NAME} -f '$migration'" >/dev/null 2>&1; then
                    echo "${GREEN}   ✓ Applied${NC}"
                else
                    # Some errors are expected (table already exists, etc.)
                    echo "${YELLOW}   ⚠ Applied with warnings (may be OK if table already exists)${NC}"
                fi
            done
            
            # Grant permissions
            su -s /bin/sh postgres -c "psql -d ${DB_NAME} -c \"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO quantix;\"" 2>/dev/null || true
            su -s /bin/sh postgres -c "psql -d ${DB_NAME} -c \"GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO quantix;\"" 2>/dev/null || true
            
            echo ""
            echo "${GREEN}✓ Migrations applied. Restart the control plane:${NC}"
            echo "  rc-service quantix-controlplane restart"
        else
            echo "${RED}✗ Cannot repair - no migration files found${NC}"
            echo ""
            echo "Copy migrations to ${MIGRATIONS_DIR} and run again:"
            echo "  scp -r backend/migrations/*.up.sql root@qvdc:${MIGRATIONS_DIR}/"
            exit 1
        fi
    else
        echo "To fix, run:"
        echo "  $0 repair"
    fi
else
    echo "${GREEN}✓ All required tables exist!${NC}"
    echo ""
    echo "If you're still seeing errors, check:"
    echo "  1. Control plane service: rc-service quantix-controlplane status"
    echo "  2. Control plane logs: cat /var/log/quantix-controlplane.log"
    echo "  3. Database connection in config: cat /etc/quantix-vdc/config.yaml"
fi

echo ""
