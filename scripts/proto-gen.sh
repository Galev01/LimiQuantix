#!/bin/bash
# =============================================================================
# LimiQuantix Proto Generation Script
# =============================================================================
#
# This script generates code from protobuf definitions using either Buf (preferred)
# or direct protoc commands as a fallback.
#
# Usage:
#   ./scripts/proto-gen.sh [options]
#
# Options:
#   --buf          Use Buf for generation (default)
#   --protoc       Use direct protoc commands
#   --go-only      Only generate Go code
#   --ts-only      Only generate TypeScript code
#   --rust-only    Only generate Rust code
#   --clean        Clean output directories first
#   --help         Show this help message
#
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Default options
USE_BUF=true
GEN_GO=true
GEN_TS=true
GEN_RUST=false
CLEAN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --buf)
            USE_BUF=true
            shift
            ;;
        --protoc)
            USE_BUF=false
            shift
            ;;
        --go-only)
            GEN_GO=true
            GEN_TS=false
            GEN_RUST=false
            shift
            ;;
        --ts-only)
            GEN_GO=false
            GEN_TS=true
            GEN_RUST=false
            shift
            ;;
        --rust-only)
            GEN_GO=false
            GEN_TS=false
            GEN_RUST=true
            shift
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --buf          Use Buf for generation (default)"
            echo "  --protoc       Use direct protoc commands"
            echo "  --go-only      Only generate Go code"
            echo "  --ts-only      Only generate TypeScript code"
            echo "  --rust-only    Only generate Rust code"
            echo "  --clean        Clean output directories first"
            echo "  --help         Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if $USE_BUF; then
        if ! command -v buf &> /dev/null; then
            log_error "buf is not installed. Run 'make setup-buf' or install from https://buf.build"
            exit 1
        fi
        log_success "buf $(buf --version) found"
    else
        if ! command -v protoc &> /dev/null; then
            log_error "protoc is not installed. Install from https://github.com/protocolbuffers/protobuf/releases"
            exit 1
        fi
        log_success "protoc $(protoc --version) found"
        
        if $GEN_GO; then
            if ! command -v protoc-gen-go &> /dev/null; then
                log_error "protoc-gen-go is not installed. Run 'make setup-go'"
                exit 1
            fi
            log_success "protoc-gen-go found"
        fi
    fi
}

# Clean output directories
clean_output() {
    log_info "Cleaning output directories..."
    rm -rf "$ROOT_DIR/backend/pkg/api/limiquantix"
    rm -rf "$ROOT_DIR/frontend/src/api/limiquantix"
    rm -rf "$ROOT_DIR/agent/src/proto"
    rm -rf "$ROOT_DIR/docs/api/api-reference.md"
    log_success "Cleaned output directories"
}

# Generate with Buf
generate_with_buf() {
    log_info "Generating code with Buf..."
    
    cd "$ROOT_DIR/proto"
    
    # Lint first
    log_info "Linting protobuf definitions..."
    if ! buf lint; then
        log_error "Linting failed!"
        exit 1
    fi
    log_success "Linting passed"
    
    # Generate
    log_info "Running buf generate..."
    buf generate
    
    log_success "Code generation complete!"
}

# Generate with protoc
generate_with_protoc() {
    log_info "Generating code with protoc..."
    
    PROTO_DIR="$ROOT_DIR/proto"
    PROTO_FILES=$(find "$PROTO_DIR" -name "*.proto" -type f)
    
    if $GEN_GO; then
        log_info "Generating Go code..."
        
        mkdir -p "$ROOT_DIR/backend/pkg/api"
        
        protoc \
            --go_out="$ROOT_DIR/backend/pkg/api" \
            --go_opt=paths=source_relative \
            --go-grpc_out="$ROOT_DIR/backend/pkg/api" \
            --go-grpc_opt=paths=source_relative \
            -I"$PROTO_DIR" \
            $PROTO_FILES
        
        log_success "Go code generated"
    fi
    
    if $GEN_TS; then
        log_info "Generating TypeScript code..."
        
        if [ -d "$ROOT_DIR/frontend" ]; then
            mkdir -p "$ROOT_DIR/frontend/src/api"
            
            cd "$ROOT_DIR/frontend"
            npx protoc \
                --plugin=./node_modules/.bin/protoc-gen-ts_proto \
                --ts_proto_out=./src/api \
                --ts_proto_opt=esModuleInterop=true,forceLong=string,useOptionals=messages \
                -I"$PROTO_DIR" \
                $PROTO_FILES
            
            log_success "TypeScript code generated"
        else
            log_warn "frontend/ directory not found, skipping TypeScript generation"
        fi
    fi
    
    if $GEN_RUST; then
        log_info "Generating Rust code..."
        
        if [ -d "$ROOT_DIR/agent" ]; then
            mkdir -p "$ROOT_DIR/agent/src/proto"
            log_warn "Rust generation requires build.rs setup - see agent/README.md"
        else
            log_warn "agent/ directory not found, skipping Rust generation"
        fi
    fi
    
    log_success "Code generation complete!"
}

# Main execution
main() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║              LimiQuantix Proto Generation                       ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    
    check_prerequisites
    
    if $CLEAN; then
        clean_output
    fi
    
    if $USE_BUF; then
        generate_with_buf
    else
        generate_with_protoc
    fi
    
    echo ""
    log_success "All done! Generated files:"
    echo ""
    
    if $GEN_GO && [ -d "$ROOT_DIR/backend/pkg/api/limiquantix" ]; then
        echo "  📁 backend/pkg/api/limiquantix/"
        find "$ROOT_DIR/backend/pkg/api/limiquantix" -name "*.go" | head -5 | sed 's|'"$ROOT_DIR"'/|     |'
    fi
    
    if $GEN_TS && [ -d "$ROOT_DIR/frontend/src/api/limiquantix" ]; then
        echo "  📁 frontend/src/api/limiquantix/"
        find "$ROOT_DIR/frontend/src/api/limiquantix" -name "*.ts" | head -5 | sed 's|'"$ROOT_DIR"'/|     |'
    fi
    
    echo ""
}

main "$@"

