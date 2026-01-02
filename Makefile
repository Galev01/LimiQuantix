# =============================================================================
# Quantixkvm Makefile
# =============================================================================
# 
# Usage:
#   make proto         - Generate code from protobuf definitions
#   make proto-lint    - Lint protobuf definitions
#   make proto-breaking - Check for breaking changes
#   make proto-format  - Format protobuf files
#   make proto-clean   - Clean generated files
#   make setup         - Install all dependencies
#
# =============================================================================

.PHONY: all proto proto-lint proto-breaking proto-format proto-clean setup \
        setup-go setup-node setup-buf help

# Default target
all: help

# =============================================================================
# PROTO GENERATION
# =============================================================================

# Generate all code from protobuf definitions
proto: proto-lint
	@echo "🔨 Generating code from protobuf definitions..."
	@cd proto && buf generate
	@echo "✅ Code generation complete!"

# Alternative: Direct protoc generation (without Buf)
proto-direct:
	@echo "🔨 Generating Go code..."
	@mkdir -p backend/pkg/api/compute/v1
	@mkdir -p backend/pkg/api/storage/v1
	@mkdir -p backend/pkg/api/network/v1
	@protoc \
		--go_out=./backend/pkg/api --go_opt=paths=source_relative \
		--go-grpc_out=./backend/pkg/api --go-grpc_opt=paths=source_relative \
		-I./proto \
		./proto/Quantixkvm/compute/v1/*.proto \
		./proto/Quantixkvm/storage/v1/*.proto \
		./proto/Quantixkvm/network/v1/*.proto
	@echo "✅ Go code generation complete!"
	@echo ""
	@echo "🔨 Generating TypeScript code..."
	@mkdir -p frontend/src/api/Quantixkvm/compute/v1
	@mkdir -p frontend/src/api/Quantixkvm/storage/v1
	@mkdir -p frontend/src/api/Quantixkvm/network/v1
	@cd frontend && npx protoc \
		--plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_out=./src/api \
		--ts_proto_opt=esModuleInterop=true,forceLong=string,useOptionals=messages,outputServices=nice-grpc,outputServices=generic-definitions \
		-I../proto \
		../proto/Quantixkvm/compute/v1/*.proto \
		../proto/Quantixkvm/storage/v1/*.proto \
		../proto/Quantixkvm/network/v1/*.proto
	@echo "✅ TypeScript code generation complete!"

# Lint protobuf definitions
proto-lint:
	@echo "🔍 Linting protobuf definitions..."
	@cd proto && buf lint
	@echo "✅ Linting passed!"

# Check for breaking changes
proto-breaking:
	@echo "🔍 Checking for breaking changes..."
	@cd proto && buf breaking --against '.git#branch=main'
	@echo "✅ No breaking changes detected!"

# Format protobuf files
proto-format:
	@echo "📐 Formatting protobuf files..."
	@cd proto && buf format -w
	@echo "✅ Formatting complete!"

# Clean generated files
proto-clean:
	@echo "🧹 Cleaning generated files..."
	@rm -rf backend/pkg/api/Quantixkvm
	@rm -rf frontend/src/api/Quantixkvm
	@rm -rf docs/api/api-reference.md
	@echo "✅ Clean complete!"

# =============================================================================
# SETUP
# =============================================================================

# Install all dependencies
setup: setup-buf setup-go setup-node
	@echo "✅ All dependencies installed!"

# Install Buf CLI
setup-buf:
	@echo "📦 Installing Buf CLI..."
	@if ! command -v buf &> /dev/null; then \
		echo "Installing buf..."; \
		brew install bufbuild/buf/buf || \
		(curl -sSL "https://github.com/bufbuild/buf/releases/latest/download/buf-$$(uname -s)-$$(uname -m)" -o /usr/local/bin/buf && chmod +x /usr/local/bin/buf); \
	else \
		echo "buf already installed: $$(buf --version)"; \
	fi

# Install Go protobuf plugins
setup-go:
	@echo "📦 Installing Go protobuf plugins..."
	@go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
	@go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
	@echo "✅ Go plugins installed!"

# Install Node.js protobuf plugins
setup-node:
	@echo "📦 Installing Node.js protobuf plugins..."
	@if [ -d "frontend" ]; then \
		cd frontend && npm install --save-dev ts-proto @bufbuild/protobuf @connectrpc/connect; \
	else \
		echo "⚠️  frontend/ directory not found, skipping Node.js setup"; \
	fi

# =============================================================================
# DEVELOPMENT
# =============================================================================

# Start development environment
dev:
	@echo "🚀 Starting development environment..."
	@echo "TODO: Implement dev environment startup"

# Run tests
test:
	@echo "🧪 Running tests..."
	@if [ -d "backend" ]; then cd backend && go test ./...; fi
	@if [ -d "frontend" ]; then cd frontend && npm test; fi
	@if [ -d "agent" ]; then cd agent && cargo test; fi

# Build all components
build:
	@echo "🔨 Building all components..."
	@if [ -d "backend" ]; then cd backend && go build ./...; fi
	@if [ -d "frontend" ]; then cd frontend && npm run build; fi
	@if [ -d "agent" ]; then cd agent && cargo build --release; fi

# =============================================================================
# HELP
# =============================================================================

help:
	@echo ""
	@echo "╔══════════════════════════════════════════════════════════════════╗"
	@echo "║                     Quantixkvm Makefile                        ║"
	@echo "╠══════════════════════════════════════════════════════════════════╣"
	@echo "║                                                                  ║"
	@echo "║  Proto Commands:                                                ║"
	@echo "║    make proto          - Generate code from protobuf            ║"
	@echo "║    make proto-lint     - Lint protobuf definitions              ║"
	@echo "║    make proto-breaking - Check for breaking changes             ║"
	@echo "║    make proto-format   - Format protobuf files                  ║"
	@echo "║    make proto-clean    - Clean generated files                  ║"
	@echo "║                                                                  ║"
	@echo "║  Setup Commands:                                                ║"
	@echo "║    make setup          - Install all dependencies               ║"
	@echo "║    make setup-buf      - Install Buf CLI                        ║"
	@echo "║    make setup-go       - Install Go protobuf plugins            ║"
	@echo "║    make setup-node     - Install Node.js protobuf plugins       ║"
	@echo "║                                                                  ║"
	@echo "║  Development Commands:                                          ║"
	@echo "║    make dev            - Start development environment          ║"
	@echo "║    make test           - Run all tests                          ║"
	@echo "║    make build          - Build all components                   ║"
	@echo "║                                                                  ║"
	@echo "╚══════════════════════════════════════════════════════════════════╝"
	@echo ""

