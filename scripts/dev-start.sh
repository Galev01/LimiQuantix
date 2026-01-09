#!/usr/bin/env bash
#
# Quantix-KVM Local Development Environment
#
# This script starts all components needed to test Quantix-OS ↔ Quantix-vDC
# communication locally without building ISOs.
#
# Usage:
#   ./dev-start.sh              # Start all components
#   ./dev-start.sh docker       # Start only Docker services
#   ./dev-start.sh backend      # Start only Go backend
#   ./dev-start.sh node         # Start only Rust node daemon
#   ./dev-start.sh frontend     # Start only React frontend
#   ./dev-start.sh hostui       # Start only Quantix-OS UI
#   ./dev-start.sh stop         # Stop all services
#   ./dev-start.sh status       # Show status
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# PID file locations
PID_DIR="$PROJECT_ROOT/.dev-pids"
mkdir -p "$PID_DIR"

header() {
    echo -e "\n${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
}

step() {
    echo -e "${GREEN}▶ $1${NC}"
}

info() {
    echo -e "${GRAY}  $1${NC}"
}

warn() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

err() {
    echo -e "${RED}✖ $1${NC}"
}

success() {
    echo -e "${GREEN}✔ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    step "Checking prerequisites..."
    
    local missing=()
    
    if ! command -v docker &> /dev/null; then
        missing+=("Docker (https://docker.com)")
    fi
    
    if ! command -v go &> /dev/null; then
        missing+=("Go 1.21+ (https://go.dev)")
    fi
    
    if ! command -v node &> /dev/null; then
        missing+=("Node.js 18+ (https://nodejs.org)")
    fi
    
    if ! command -v cargo &> /dev/null; then
        missing+=("Rust (https://rustup.rs)")
    fi
    
    if [ ${#missing[@]} -gt 0 ]; then
        err "Missing prerequisites:"
        for item in "${missing[@]}"; do
            echo -e "  ${RED}- $item${NC}"
        done
        exit 1
    fi
    
    success "All prerequisites found"
}

# Start Docker services
start_docker() {
    step "Starting Docker services (PostgreSQL, etcd, Redis)..."
    
    cd "$PROJECT_ROOT/backend"
    
    # Check if services are already running
    if docker compose ps --format json 2>/dev/null | grep -q "running"; then
        info "Docker services already running"
    else
        docker compose up -d
        info "Waiting for services to be healthy..."
        sleep 5
    fi
    
    success "Docker services ready"
    info "  PostgreSQL: localhost:5432"
    info "  etcd:       localhost:2379"
    info "  Redis:      localhost:6379"
}

# Start Go backend
start_backend() {
    step "Starting Go backend (Control Plane)..."
    
    cd "$PROJECT_ROOT/backend"
    
    # Build if needed
    if [ ! -f "controlplane" ]; then
        info "Building backend..."
        go build -o controlplane ./cmd/controlplane
    fi
    
    # Start in background
    ./controlplane --dev > "$PID_DIR/backend.log" 2>&1 &
    echo $! > "$PID_DIR/backend.pid"
    
    success "Backend started (PID: $(cat "$PID_DIR/backend.pid"))"
    info "  API:  http://localhost:8080"
    info "  Logs: tail -f $PID_DIR/backend.log"
    
    sleep 2
}

# Start Rust node daemon
start_node() {
    step "Starting Rust node daemon (Quantix-OS)..."
    
    cd "$PROJECT_ROOT/agent"
    
    # Build if needed (debug for faster builds)
    local bin_path="target/debug/limiquantix-node"
    if [ ! -f "$bin_path" ]; then
        info "Building node daemon (this may take a while first time)..."
        cargo build --package limiquantix-node
    fi
    
    # Start in background
    "$bin_path" --http-port 8443 --grpc-port 9443 > "$PID_DIR/node.log" 2>&1 &
    echo $! > "$PID_DIR/node.pid"
    
    success "Node daemon started (PID: $(cat "$PID_DIR/node.pid"))"
    info "  HTTP/REST: https://localhost:8443"
    info "  gRPC:      localhost:9443"
    info "  Logs: tail -f $PID_DIR/node.log"
    
    sleep 2
}

# Start frontend (vDC Dashboard)
start_frontend() {
    step "Starting React frontend (vDC Dashboard)..."
    
    cd "$PROJECT_ROOT/frontend"
    
    # Install deps if needed
    if [ ! -d "node_modules" ]; then
        info "Installing dependencies..."
        npm install
    fi
    
    # Start dev server in background
    npm run dev > "$PID_DIR/frontend.log" 2>&1 &
    echo $! > "$PID_DIR/frontend.pid"
    
    success "Frontend started (PID: $(cat "$PID_DIR/frontend.pid"))"
    info "  URL:  http://localhost:5173"
    info "  Logs: tail -f $PID_DIR/frontend.log"
}

# Start host UI (Quantix-OS UI)
start_hostui() {
    step "Starting React host UI (Quantix-OS UI)..."
    
    cd "$PROJECT_ROOT/quantix-host-ui"
    
    # Install deps if needed
    if [ ! -d "node_modules" ]; then
        info "Installing dependencies..."
        npm install
    fi
    
    # Start dev server in background
    npm run dev > "$PID_DIR/hostui.log" 2>&1 &
    echo $! > "$PID_DIR/hostui.pid"
    
    success "Host UI started (PID: $(cat "$PID_DIR/hostui.pid"))"
    info "  URL:  http://localhost:3001"
    info "  Logs: tail -f $PID_DIR/hostui.log"
}

# Stop all services
stop_all() {
    step "Stopping all development services..."
    
    # Stop background processes
    for pidfile in "$PID_DIR"/*.pid; do
        if [ -f "$pidfile" ]; then
            pid=$(cat "$pidfile")
            if kill -0 "$pid" 2>/dev/null; then
                info "Stopping PID $pid..."
                kill "$pid" 2>/dev/null || true
            fi
            rm -f "$pidfile"
        fi
    done
    
    # Stop Docker services
    cd "$PROJECT_ROOT/backend"
    docker compose down 2>/dev/null || true
    
    success "All services stopped"
}

# Show status
show_status() {
    header "Development Environment Status"
    
    step "Background Processes:"
    for pidfile in "$PID_DIR"/*.pid; do
        if [ -f "$pidfile" ]; then
            name=$(basename "$pidfile" .pid)
            pid=$(cat "$pidfile")
            if kill -0 "$pid" 2>/dev/null; then
                echo -e "  ${GREEN}●${NC} $name (PID: $pid)"
            else
                echo -e "  ${RED}●${NC} $name (stopped)"
            fi
        fi
    done
    
    echo ""
    step "Docker Services:"
    cd "$PROJECT_ROOT/backend"
    docker compose ps 2>/dev/null || echo "  Not running"
    
    echo ""
    step "Access URLs:"
    info "  vDC Dashboard:    http://localhost:5173"
    info "  vDC API:          http://localhost:8080"
    info "  Quantix-OS UI:    http://localhost:3001"
    info "  Node Daemon API:  https://localhost:8443"
    echo ""
}

# Print help
print_help() {
    header "Quantix-KVM Local Development Environment"
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  (none)    Start all components"
    echo "  docker    Start only Docker services (PostgreSQL, etcd, Redis)"
    echo "  backend   Start only Go backend (Control Plane)"
    echo "  node      Start only Rust node daemon"
    echo "  frontend  Start only React frontend (vDC Dashboard)"
    echo "  hostui    Start only React host UI (Quantix-OS UI)"
    echo "  stop      Stop all services"
    echo "  status    Show status of all services"
    echo "  help      Show this help message"
    echo ""
}

# Main
header "Quantix-KVM Local Development Environment"

case "${1:-all}" in
    docker)
        check_prerequisites
        start_docker
        ;;
    backend)
        check_prerequisites
        start_backend
        ;;
    node)
        check_prerequisites
        start_node
        ;;
    frontend)
        check_prerequisites
        start_frontend
        ;;
    hostui)
        check_prerequisites
        start_hostui
        ;;
    stop)
        stop_all
        ;;
    status)
        show_status
        ;;
    help|--help|-h)
        print_help
        ;;
    all)
        check_prerequisites
        start_docker
        start_backend
        start_node
        start_frontend
        start_hostui
        show_status
        
        header "Development Environment Ready!"
        echo -e "${GRAY}Quick Commands:
  View logs:         tail -f $PID_DIR/<service>.log
  Stop all:          $0 stop
  Check status:      $0 status

Testing Host Registration:
  1. Open vDC Dashboard: http://localhost:5173
  2. Go to Hosts → Add Host
  3. Enter: localhost:8443
  4. The node daemon will register with the control plane
${NC}"
        ;;
    *)
        err "Unknown command: $1"
        print_help
        exit 1
        ;;
esac
