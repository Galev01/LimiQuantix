# Quantixkvm Backend Makefile

.PHONY: all build run test lint clean proto migrate docker-up docker-down help

# Variables
BINARY_NAME=controlplane
BUILD_DIR=bin
VERSION=$(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT=$(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE=$(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
LDFLAGS=-ldflags "-X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.buildDate=$(BUILD_DATE)"

# Default target
all: build

## build: Build the control plane binary
build:
	@echo "Building $(BINARY_NAME)..."
	@mkdir -p $(BUILD_DIR)
	go build $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/controlplane

## run: Run the control plane (requires docker-compose services)
run:
	@echo "Starting control plane..."
	go run ./cmd/controlplane

## run-dev: Run with hot reload using Air (if installed)
run-dev:
	@if command -v air > /dev/null; then \
		air; \
	else \
		echo "Air not installed. Running normally..."; \
		go run ./cmd/controlplane; \
	fi

## test: Run all tests
test:
	@echo "Running tests..."
	go test -v -race -cover ./...

## test-unit: Run unit tests only
test-unit:
	@echo "Running unit tests..."
	go test -v -short ./internal/...

## test-short: Run tests without integration tests
test-short:
	@echo "Running short tests..."
	go test -v -short ./...

## test-integration: Run integration tests (requires running infrastructure)
test-integration:
	@echo "Running integration tests..."
	go test -v -tags=integration ./internal/repository/...

## test-e2e: Run E2E tests (requires running server)
test-e2e:
	@echo "Running E2E tests..."
	go test -v -tags=e2e ./tests/e2e/...

## test-coverage: Run tests with coverage report
test-coverage:
	@echo "Running tests with coverage..."
	go test -v -race -coverprofile=coverage.out ./internal/...
	go tool cover -html=coverage.out -o coverage.html
	go tool cover -func=coverage.out
	@echo ""
	@echo "Coverage report: coverage.html"

## benchmark: Run benchmark tests
benchmark:
	@echo "Running benchmarks..."
	go test -bench=. -benchmem ./internal/...

## test-all: Run all test types
test-all: test-unit test-integration test-e2e
	@echo "All tests completed!"

## lint: Run linters
lint:
	@echo "Running linters..."
	@if command -v golangci-lint > /dev/null; then \
		golangci-lint run; \
	else \
		echo "golangci-lint not installed. Skipping..."; \
	fi

## fmt: Format code
fmt:
	@echo "Formatting code..."
	go fmt ./...
	goimports -w .

## vet: Run go vet
vet:
	@echo "Running go vet..."
	go vet ./...

## tidy: Tidy go modules
tidy:
	@echo "Tidying modules..."
	go mod tidy

## proto: Generate protobuf code
proto:
	@echo "Generating proto code..."
	cd ../proto && buf generate

## migrate-up: Run database migrations
migrate-up:
	@echo "Running migrations..."
	go run ./cmd/migrate up

## migrate-down: Rollback database migrations
migrate-down:
	@echo "Rolling back migrations..."
	go run ./cmd/migrate down

## migrate-create: Create a new migration (usage: make migrate-create name=migration_name)
migrate-create:
	@echo "Creating migration $(name)..."
	migrate create -ext sql -dir migrations -seq $(name)

## docker-up: Start Docker Compose services
docker-up:
	@echo "Starting Docker services..."
	docker-compose up -d
	@echo "Waiting for services to be ready..."
	@sleep 5
	@echo "Services started!"

## docker-down: Stop Docker Compose services
docker-down:
	@echo "Stopping Docker services..."
	docker-compose down

## docker-logs: Show Docker Compose logs
docker-logs:
	docker-compose logs -f

## docker-build: Build Docker image
docker-build:
	@echo "Building Docker image..."
	docker build -t Quantixkvm/controlplane:$(VERSION) .
	docker tag Quantixkvm/controlplane:$(VERSION) Quantixkvm/controlplane:latest

## clean: Clean build artifacts
clean:
	@echo "Cleaning..."
	rm -rf $(BUILD_DIR)
	rm -f coverage.out coverage.html

## deps: Download dependencies
deps:
	@echo "Downloading dependencies..."
	go mod download

## check: Run all checks (test, lint, vet)
check: test lint vet

## help: Show this help message
help:
	@echo "Quantixkvm Backend Makefile"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@sed -n 's/^## //p' $(MAKEFILE_LIST) | column -t -s ':' | sed 's/^/  /'

