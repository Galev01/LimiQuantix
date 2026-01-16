#!/bin/bash
# =============================================================================
# Quantix Update Server - Start Script (Linux/WSL)
# =============================================================================
# Starts the Update Server Admin UI locally via Docker
#
# Usage:
#   ./start.sh           # Start in foreground
#   ./start.sh -d        # Start detached (background)
#   ./start.sh --build   # Rebuild and start
#   ./start.sh --stop    # Stop the server
#   ./start.sh --logs    # View logs
# =============================================================================

set -e

cd "$(dirname "$0")"

# Parse arguments
DETACHED=false
BUILD=false
STOP=false
LOGS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--detach)
            DETACHED=true
            shift
            ;;
        --build)
            BUILD=true
            shift
            ;;
        --stop)
            STOP=true
            shift
            ;;
        --logs)
            LOGS=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [-d|--detach] [--build] [--stop] [--logs]"
            exit 1
            ;;
    esac
done

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "Error: Docker is not running. Please start Docker first."
    exit 1
fi

if [ "$STOP" = true ]; then
    echo "Stopping Update Server..."
    docker-compose down
    exit 0
fi

if [ "$LOGS" = true ]; then
    echo "Showing logs..."
    docker-compose logs -f
    exit 0
fi

if [ "$BUILD" = true ]; then
    echo "Building Update Server..."
    docker-compose build
fi

if [ "$DETACHED" = true ]; then
    echo "Starting Update Server (detached)..."
    docker-compose up -d
    echo ""
    echo "Update Server is running!"
    echo "Admin UI: http://localhost:9000"
    echo ""
    echo "Commands:"
    echo "  ./start.sh --logs    View logs"
    echo "  ./start.sh --stop    Stop server"
else
    echo "Starting Update Server..."
    echo "Admin UI will be available at: http://localhost:9000"
    echo "Press Ctrl+C to stop"
    echo ""
    docker-compose up
fi
