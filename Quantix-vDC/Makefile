# =============================================================================
# Quantix-vDC Build System
# =============================================================================
#
# Usage:
#   make iso           - Build complete installation ISO
#   make ova           - Build OVA virtual appliance
#   make rootfs        - Build rootfs only
#   make test-qemu     - Test ISO in QEMU
#   make test-qemu-install - Test installer with virtual disk
#   make clean         - Clean build artifacts
#   make help          - Show this help
#
# =============================================================================

.PHONY: all iso ova rootfs test-qemu test-qemu-install test-qemu-uefi \
        clean clean-all help docker-builder docker-node scripts-executable \
        backend frontend

# Version
VERSION ?= 1.0.0
ISO_NAME := quantix-vdc-$(VERSION).iso
OVA_NAME := quantix-vdc-$(VERSION).ova

# Directories - use CURDIR instead of PWD for better compatibility
BUILD_DIR := $(CURDIR)
OUTPUT_DIR := $(BUILD_DIR)/output
OVERLAY_DIR := $(BUILD_DIR)/overlay
ROOTFS_DIR := $(BUILD_DIR)/.rootfs
ISO_DIR := $(BUILD_DIR)/.iso

# Docker images
BUILDER_IMAGE := quantix-vdc-builder
NODE_BUILDER_IMAGE := quantix-rust-tui-builder

# Project root (parent of Quantix-vDC)
PROJECT_ROOT := $(shell cd .. && pwd)

# =============================================================================
# Main Targets
# =============================================================================

all: iso

# Build complete installation ISO
iso: rootfs scripts-executable
	@echo "🔨 Building installation ISO..."
	@mkdir -p $(OUTPUT_DIR)
	docker run --rm --privileged \
		-v "$(BUILD_DIR):/work" \
		-v "$(OUTPUT_DIR):/output" \
		-w /work \
		$(BUILDER_IMAGE) \
		/bin/bash ./builder/build-iso.sh $(VERSION)
	@echo "✅ ISO built: $(OUTPUT_DIR)/$(ISO_NAME)"

# Build OVA virtual appliance
ova: rootfs scripts-executable
	@echo "🔨 Building OVA appliance..."
	@mkdir -p $(OUTPUT_DIR)
	docker run --rm --privileged \
		-v "$(BUILD_DIR):/work" \
		-v "$(OUTPUT_DIR):/output" \
		-w /work \
		$(BUILDER_IMAGE) \
		/bin/bash ./builder/build-ova.sh $(VERSION)
	@echo "✅ OVA built: $(OUTPUT_DIR)/$(OVA_NAME)"

# Build rootfs squashfs (for ISO)
rootfs: docker-builder backend frontend scripts-executable
	@echo "🔨 Building rootfs..."
	@mkdir -p $(OUTPUT_DIR)
	docker run --rm --privileged \
		-v "$(BUILD_DIR):/work" \
		-v "$(OUTPUT_DIR):/output" \
		-w /work \
		$(BUILDER_IMAGE) \
		/bin/bash ./builder/build-rootfs.sh $(VERSION)
	@echo "✅ Rootfs built"

# =============================================================================
# Component Builds
# =============================================================================

# Build Go backend (control plane)
backend:
	@echo "🔨 Building control plane backend..."
	@mkdir -p $(OVERLAY_DIR)/usr/bin
	@if [ -d "$(PROJECT_ROOT)/backend" ]; then \
		docker run --rm \
			-v "$(PROJECT_ROOT)/backend:/app:rw" \
			-w /app \
			-e CGO_ENABLED=0 \
			-e GOOS=linux \
			-e GOARCH=amd64 \
			golang:1.23-alpine \
			sh -c "apk add --no-cache git && go build -ldflags='-s -w' -o /app/qx-controlplane ./cmd/controlplane"; \
		cp $(PROJECT_ROOT)/backend/qx-controlplane $(OVERLAY_DIR)/usr/bin/; \
		rm -f $(PROJECT_ROOT)/backend/qx-controlplane; \
		chmod +x $(OVERLAY_DIR)/usr/bin/qx-controlplane; \
		echo "✅ Backend built"; \
	else \
		echo "⚠️  Backend not found at $(PROJECT_ROOT)/backend, skipping..."; \
	fi

# Build React frontend dashboard
frontend:
	@echo "🔨 Building frontend dashboard..."
	@mkdir -p $(OVERLAY_DIR)/usr/share/quantix-vdc/dashboard
	@if [ -d "$(PROJECT_ROOT)/frontend" ]; then \
		docker run --rm \
			-v "$(PROJECT_ROOT)/frontend:/app:rw" \
			-w /app \
			node:20-alpine \
			sh -c "npm ci && npm run build" && \
		cp -r $(PROJECT_ROOT)/frontend/dist/* $(OVERLAY_DIR)/usr/share/quantix-vdc/dashboard/ && \
		echo "✅ Frontend built" || \
		echo "⚠️  Frontend build failed, creating placeholder..."; \
		echo '<!DOCTYPE html><html><head><title>Quantix-vDC</title></head><body><h1>Quantix-vDC Dashboard</h1><p>Dashboard not available. Please rebuild with: make frontend</p></body></html>' > $(OVERLAY_DIR)/usr/share/quantix-vdc/dashboard/index.html; \
	else \
		echo "⚠️  Frontend not found at $(PROJECT_ROOT)/frontend, skipping..."; \
	fi

# =============================================================================
# Docker Image Builds
# =============================================================================

docker-builder:
	@echo "🐳 Building Docker image: $(BUILDER_IMAGE)..."
	docker build -t $(BUILDER_IMAGE) -f builder/Dockerfile builder/

docker-node:
	@echo "🐳 Building Rust builder image..."
	@if [ -f "../Quantix-OS/builder/Dockerfile.rust-tui" ]; then \
		docker build -t $(NODE_BUILDER_IMAGE) -f ../Quantix-OS/builder/Dockerfile.rust-tui ../Quantix-OS/builder/; \
	else \
		echo "⚠️  Rust builder Dockerfile not found"; \
	fi

# =============================================================================
# Utility Targets
# =============================================================================

# Make all scripts executable
scripts-executable:
	@echo "🔧 Making scripts executable..."
	@chmod +x builder/*.sh 2>/dev/null || true
	@chmod +x installer/*.sh 2>/dev/null || true
	@chmod +x overlay/etc/init.d/* 2>/dev/null || true

# =============================================================================
# Testing
# =============================================================================

# Test ISO in QEMU (BIOS mode)
test-qemu:
	@echo "🧪 Testing ISO in QEMU (BIOS)..."
	@if [ ! -f "$(OUTPUT_DIR)/$(ISO_NAME)" ]; then \
		echo "❌ ISO not found. Run 'make iso' first."; \
		exit 1; \
	fi
	qemu-system-x86_64 \
		-enable-kvm \
		-m 4G \
		-cpu host \
		-smp 2 \
		-cdrom $(OUTPUT_DIR)/$(ISO_NAME) \
		-boot d \
		-display gtk \
		-vga virtio \
		-device virtio-net-pci,netdev=net0 \
		-netdev user,id=net0,hostfwd=tcp::8080-:8080,hostfwd=tcp::8443-:443

# Test ISO in QEMU (UEFI mode)
test-qemu-uefi:
	@echo "🧪 Testing ISO in QEMU (UEFI)..."
	@if [ ! -f "$(OUTPUT_DIR)/$(ISO_NAME)" ]; then \
		echo "❌ ISO not found. Run 'make iso' first."; \
		exit 1; \
	fi
	@OVMF_CODE=""; \
	for path in \
		/usr/share/OVMF/OVMF_CODE.fd \
		/usr/share/OVMF/OVMF_CODE_4M.fd \
		/usr/share/edk2/ovmf/OVMF_CODE.fd \
		/usr/share/edk2-ovmf/x64/OVMF_CODE.fd \
		/usr/share/qemu/OVMF.fd; do \
		if [ -f "$$path" ]; then \
			OVMF_CODE="$$path"; \
			break; \
		fi; \
	done; \
	if [ -z "$$OVMF_CODE" ]; then \
		echo "❌ OVMF not found. Install ovmf package."; \
		exit 1; \
	fi; \
	echo "   Using OVMF: $$OVMF_CODE"; \
	qemu-system-x86_64 \
		-enable-kvm \
		-m 4G \
		-cpu host \
		-smp 2 \
		-drive if=pflash,format=raw,readonly=on,file="$$OVMF_CODE" \
		-cdrom $(OUTPUT_DIR)/$(ISO_NAME) \
		-boot d \
		-display gtk \
		-vga virtio \
		-device virtio-net-pci,netdev=net0 \
		-netdev user,id=net0,hostfwd=tcp::8080-:8080,hostfwd=tcp::8443-:443

# Test with virtual disk (for installer testing)
test-qemu-install:
	@echo "🧪 Testing installer in QEMU..."
	@if [ ! -f "$(OUTPUT_DIR)/$(ISO_NAME)" ]; then \
		echo "❌ ISO not found. Run 'make iso' first."; \
		exit 1; \
	fi
	@if [ ! -f "$(OUTPUT_DIR)/test-disk.qcow2" ]; then \
		qemu-img create -f qcow2 $(OUTPUT_DIR)/test-disk.qcow2 50G; \
	fi
	qemu-system-x86_64 \
		-enable-kvm \
		-m 4G \
		-cpu host \
		-smp 2 \
		-cdrom $(OUTPUT_DIR)/$(ISO_NAME) \
		-drive file=$(OUTPUT_DIR)/test-disk.qcow2,format=qcow2,if=virtio \
		-boot d \
		-display gtk \
		-vga virtio \
		-device virtio-net-pci,netdev=net0 \
		-netdev user,id=net0,hostfwd=tcp::18080-:8080,hostfwd=tcp::18443-:443

# =============================================================================
# Cleanup
# =============================================================================

clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf $(OUTPUT_DIR)/*.iso
	rm -rf $(OUTPUT_DIR)/*.ova
	rm -rf $(OUTPUT_DIR)/*.squashfs
	rm -rf $(OUTPUT_DIR)/test-disk.qcow2
	rm -rf $(ROOTFS_DIR)
	rm -rf $(ISO_DIR)
	rm -rf $(OVERLAY_DIR)/usr/bin/qx-controlplane
	rm -rf $(OVERLAY_DIR)/usr/share/quantix-vdc/dashboard/*
	@echo "✅ Clean complete"

clean-all: clean
	@echo "🧹 Cleaning Docker images..."
	docker rmi $(BUILDER_IMAGE) 2>/dev/null || true
	@echo "✅ Full clean complete"

# =============================================================================
# Help
# =============================================================================

help:
	@echo ""
	@echo "╔══════════════════════════════════════════════════════════════════╗"
	@echo "║                  Quantix-vDC Build System                        ║"
	@echo "╠══════════════════════════════════════════════════════════════════╣"
	@echo "║                                                                  ║"
	@echo "║  Build Commands:                                                 ║"
	@echo "║    make iso           - Build installation ISO                   ║"
	@echo "║    make ova           - Build OVA virtual appliance              ║"
	@echo "║    make rootfs        - Build rootfs only                        ║"
	@echo "║    make backend       - Build Go control plane                   ║"
	@echo "║    make frontend      - Build React dashboard                    ║"
	@echo "║                                                                  ║"
	@echo "║  Test Commands:                                                  ║"
	@echo "║    make test-qemu     - Test ISO in QEMU (BIOS)                  ║"
	@echo "║    make test-qemu-uefi- Test ISO in QEMU (UEFI)                  ║"
	@echo "║    make test-qemu-install - Test installer with virtual disk     ║"
	@echo "║                                                                  ║"
	@echo "║  Docker Commands:                                                ║"
	@echo "║    make docker-builder    - Build base builder image             ║"
	@echo "║                                                                  ║"
	@echo "║  Cleanup Commands:                                               ║"
	@echo "║    make clean         - Clean build artifacts                    ║"
	@echo "║    make clean-all     - Clean artifacts and Docker images        ║"
	@echo "║                                                                  ║"
	@echo "╚══════════════════════════════════════════════════════════════════╝"
	@echo ""
