# =============================================================================
# Quantix-vDC Build System
# =============================================================================
#
# Usage:
#   make iso           - Build complete installation ISO (auto-increments version)
#   make iso-no-bump   - Build ISO without incrementing version
#   make ova           - Build OVA virtual appliance
#   make rootfs        - Build rootfs only
#   make test-qemu     - Test ISO in QEMU
#   make test-qemu-install - Test installer with virtual disk
#   make clean         - Clean build artifacts
#   make version       - Show current version
#   make version-bump  - Increment patch version
#   make version-set V=X.Y.Z - Set specific version
#   make help          - Show this help
#
# =============================================================================

.PHONY: all iso iso-no-bump ova rootfs test-qemu test-qemu-install test-qemu-uefi \
        clean clean-all help docker-builder docker-node scripts-executable \
        backend frontend deploy-usb version version-bump version-set fix-perms

# Version - read from VERSION file
VERSION := $(shell cat VERSION 2>/dev/null || echo "0.0.1")
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
# Version Management
# =============================================================================

# Show current version
version:
	@echo "Quantix-vDC v$(VERSION)"

# Increment patch version
version-bump:
	@chmod +x builder/version.sh 2>/dev/null || true
	@NEW_VER=$$(./builder/version.sh increment) && \
		echo "Version bumped: $(VERSION) → $$NEW_VER"

# Set specific version
version-set:
ifndef V
	$(error Usage: make version-set V=X.Y.Z)
endif
	@chmod +x builder/version.sh 2>/dev/null || true
	@./builder/version.sh set $(V)
	@echo "Version set to: $(V)"

# =============================================================================
# Main Targets
# =============================================================================

all: iso

# Build complete installation ISO (auto-increment version)
iso: version-bump docker-builder backend frontend scripts-executable
	$(eval VERSION := $(shell cat VERSION))
	$(eval ISO_NAME := quantix-vdc-$(VERSION).iso)
	@echo "🔨 Building installation ISO v$(VERSION)..."
	@mkdir -p $(OUTPUT_DIR)
	@# Copy installer scripts to output directory to work around Docker volume issues
	@mkdir -p $(OUTPUT_DIR)/installer-scripts
	@echo "Copying installer scripts..."
	@cp -v $(BUILD_DIR)/installer/install.sh $(OUTPUT_DIR)/installer-scripts/ || echo "Failed to copy install.sh"
	@cp -v $(BUILD_DIR)/installer/tui.sh $(OUTPUT_DIR)/installer-scripts/ || echo "Failed to copy tui.sh"
	@cp -v $(BUILD_DIR)/installer/firstboot.sh $(OUTPUT_DIR)/installer-scripts/ || echo "Failed to copy firstboot.sh"
	@chmod +x $(OUTPUT_DIR)/installer-scripts/*.sh 2>/dev/null || true
	@# Convert CRLF to LF in case scripts have Windows line endings
	@sed -i 's/\r$$//' $(OUTPUT_DIR)/installer-scripts/*.sh 2>/dev/null || true
	@echo "Installer scripts in output:"
	@ls -la $(OUTPUT_DIR)/installer-scripts/
	@# Copy database migrations to output directory (Docker volume workaround)
	@mkdir -p $(OUTPUT_DIR)/migrations
	@echo "Copying database migrations..."
	@if [ -d "$(PROJECT_ROOT)/backend/migrations" ]; then \
		cp -v $(PROJECT_ROOT)/backend/migrations/*.up.sql $(OUTPUT_DIR)/migrations/ 2>/dev/null || echo "No .up.sql files found"; \
		echo "Migrations copied:"; \
		ls -la $(OUTPUT_DIR)/migrations/; \
	else \
		echo "⚠️  WARNING: Migrations directory not found at $(PROJECT_ROOT)/backend/migrations"; \
	fi
	docker run --rm --privileged \
		-v "$(BUILD_DIR):/work" \
		-v "$(OUTPUT_DIR):/output" \
		-w /work \
		$(BUILDER_IMAGE) \
		/bin/bash -c "./builder/build-rootfs.sh $(VERSION) && ./builder/build-iso.sh $(VERSION)"
	@echo "✅ ISO built: $(OUTPUT_DIR)/$(ISO_NAME)"

# Build ISO without incrementing version
iso-no-bump: docker-builder backend frontend scripts-executable
	@echo "🔨 Building installation ISO v$(VERSION) (no version bump)..."
	@mkdir -p $(OUTPUT_DIR)
	@# Copy installer scripts to output directory (workaround for Docker volume issues)
	@mkdir -p $(OUTPUT_DIR)/installer-scripts
	@echo "Copying installer scripts..."
	@cp -v $(BUILD_DIR)/installer/install.sh $(OUTPUT_DIR)/installer-scripts/ || echo "Failed to copy install.sh"
	@cp -v $(BUILD_DIR)/installer/tui.sh $(OUTPUT_DIR)/installer-scripts/ || echo "Failed to copy tui.sh"
	@cp -v $(BUILD_DIR)/installer/firstboot.sh $(OUTPUT_DIR)/installer-scripts/ || echo "Failed to copy firstboot.sh"
	@chmod +x $(OUTPUT_DIR)/installer-scripts/*.sh 2>/dev/null || true
	@# Convert CRLF to LF in case scripts have Windows line endings
	@sed -i 's/\r$$//' $(OUTPUT_DIR)/installer-scripts/*.sh 2>/dev/null || true
	@echo "Installer scripts in output:"
	@ls -la $(OUTPUT_DIR)/installer-scripts/
	@# Copy database migrations to output directory (Docker volume workaround)
	@mkdir -p $(OUTPUT_DIR)/migrations
	@echo "Copying database migrations..."
	@if [ -d "$(PROJECT_ROOT)/backend/migrations" ]; then \
		cp -v $(PROJECT_ROOT)/backend/migrations/*.up.sql $(OUTPUT_DIR)/migrations/ 2>/dev/null || echo "No .up.sql files found"; \
		echo "Migrations copied:"; \
		ls -la $(OUTPUT_DIR)/migrations/; \
	else \
		echo "⚠️  WARNING: Migrations directory not found at $(PROJECT_ROOT)/backend/migrations"; \
	fi
	docker run --rm --privileged \
		-v "$(BUILD_DIR):/work" \
		-v "$(OUTPUT_DIR):/output" \
		-w /work \
		$(BUILDER_IMAGE) \
		/bin/bash -c "./builder/build-rootfs.sh $(VERSION) && ./builder/build-iso.sh $(VERSION)"
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
			golang:alpine \
			sh -c "apk add --no-cache git && go build -ldflags='-s -w' -o /app/qx-controlplane ./cmd/controlplane && chmod 755 /app/qx-controlplane" || { echo "❌ Backend build failed!"; exit 1; }; \
		if [ -f "$(PROJECT_ROOT)/backend/qx-controlplane" ]; then \
			cp $(PROJECT_ROOT)/backend/qx-controlplane $(OVERLAY_DIR)/usr/bin/ 2>/dev/null || \
				sudo cp $(PROJECT_ROOT)/backend/qx-controlplane $(OVERLAY_DIR)/usr/bin/; \
			rm -f $(PROJECT_ROOT)/backend/qx-controlplane; \
			chmod +x $(OVERLAY_DIR)/usr/bin/qx-controlplane 2>/dev/null || \
				sudo chmod +x $(OVERLAY_DIR)/usr/bin/qx-controlplane; \
			echo "✅ Backend built successfully"; \
		else \
			echo "❌ Backend binary not found after build!"; \
			exit 1; \
		fi; \
	else \
		echo "❌ Backend not found at $(PROJECT_ROOT)/backend!"; \
		exit 1; \
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
			sh -c "npm ci && npx vite build" && \
		if [ -d "$(PROJECT_ROOT)/frontend/dist" ] && [ -f "$(PROJECT_ROOT)/frontend/dist/index.html" ]; then \
			cp -r $(PROJECT_ROOT)/frontend/dist/* $(OVERLAY_DIR)/usr/share/quantix-vdc/dashboard/; \
			echo "✅ Frontend built"; \
		else \
			echo "⚠️  Frontend build produced no output, creating placeholder..."; \
			echo '<!DOCTYPE html><html><head><title>Quantix-vDC</title></head><body><h1>Quantix-vDC Dashboard</h1><p>Dashboard not available.</p></body></html>' > $(OVERLAY_DIR)/usr/share/quantix-vdc/dashboard/index.html; \
		fi; \
	else \
		echo "⚠️  Frontend not found at $(PROJECT_ROOT)/frontend, creating placeholder..."; \
		echo '<!DOCTYPE html><html><head><title>Quantix-vDC</title></head><body><h1>Quantix-vDC Dashboard</h1><p>Frontend not found.</p></body></html>' > $(OVERLAY_DIR)/usr/share/quantix-vdc/dashboard/index.html; \
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

# Fix permissions on overlay directory (for Docker volume mounts)
fix-perms:
	@echo "🔧 Fixing overlay permissions..."
	@mkdir -p $(OVERLAY_DIR)/usr/bin
	@chmod -R 755 $(OVERLAY_DIR) 2>/dev/null || sudo chmod -R 755 $(OVERLAY_DIR)
	@chmod +x builder/*.sh installer/*.sh 2>/dev/null || true

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

# Deploy ISO to USB drive
# Usage: make deploy-usb DEVICE=/dev/sdb [ISO_VERSION=x.y.z]
deploy-usb:
	@echo "💾 Deploying ISO to USB drive..."
	@if [ -z "$(DEVICE)" ]; then \
		echo "❌ No device specified. Usage: make deploy-usb DEVICE=/dev/sdX"; \
		echo ""; \
		echo "Available devices:"; \
		lsblk -d -o NAME,SIZE,TYPE,MODEL | grep -E "disk|NAME"; \
		exit 1; \
	fi
	@echo ""
	@echo "📀 Available ISO versions in $(OUTPUT_DIR):"
	@echo "─────────────────────────────────────────────"
	@ls -1 $(OUTPUT_DIR)/quantix-vdc-*.iso 2>/dev/null | while read iso; do \
		ver=$$(basename "$$iso" | sed 's/quantix-vdc-\(.*\)\.iso/\1/'); \
		size=$$(du -h "$$iso" | cut -f1); \
		date=$$(stat -c '%y' "$$iso" 2>/dev/null | cut -d' ' -f1 || stat -f '%Sm' "$$iso" 2>/dev/null | cut -d' ' -f1-3); \
		echo "  v$$ver  ($$size, $$date)"; \
	done || echo "  No ISOs found. Run 'make iso' first."
	@echo "─────────────────────────────────────────────"
	@if [ -z "$(ISO_VERSION)" ]; then \
		echo ""; \
		echo "💡 Specify version with: make deploy-usb DEVICE=$(DEVICE) ISO_VERSION=x.y.z"; \
		echo "   Or use 'latest' for most recent: make deploy-usb DEVICE=$(DEVICE) ISO_VERSION=latest"; \
		echo ""; \
		read -p "Enter version to deploy (or 'latest'): " VER; \
		if [ "$$VER" = "latest" ]; then \
			SELECTED_ISO=$$(ls -t $(OUTPUT_DIR)/quantix-vdc-*.iso 2>/dev/null | head -1); \
		else \
			SELECTED_ISO="$(OUTPUT_DIR)/quantix-vdc-$$VER.iso"; \
		fi; \
		if [ ! -f "$$SELECTED_ISO" ]; then \
			echo "❌ ISO not found: $$SELECTED_ISO"; \
			exit 1; \
		fi; \
		echo "📀 Selected: $$SELECTED_ISO"; \
		sudo $(BUILD_DIR)/builder/deploy-usb.sh $(DEVICE) "$$SELECTED_ISO"; \
	else \
		if [ "$(ISO_VERSION)" = "latest" ]; then \
			SELECTED_ISO=$$(ls -t $(OUTPUT_DIR)/quantix-vdc-*.iso 2>/dev/null | head -1); \
		else \
			SELECTED_ISO="$(OUTPUT_DIR)/quantix-vdc-$(ISO_VERSION).iso"; \
		fi; \
		if [ ! -f "$$SELECTED_ISO" ]; then \
			echo "❌ ISO not found: $$SELECTED_ISO"; \
			exit 1; \
		fi; \
		echo "📀 Selected: $$SELECTED_ISO"; \
		sudo $(BUILD_DIR)/builder/deploy-usb.sh $(DEVICE) "$$SELECTED_ISO"; \
	fi

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
	@echo "║    make iso           - Build installation ISO (auto-bump version)║"
	@echo "║    make iso-no-bump   - Build ISO without version increment       ║"
	@echo "║    make ova           - Build OVA virtual appliance              ║"
	@echo "║    make rootfs        - Build rootfs only                        ║"
	@echo "║    make backend       - Build Go control plane                   ║"
	@echo "║    make frontend      - Build React dashboard                    ║"
	@echo "║                                                                  ║"
	@echo "║  Version Commands:                                                ║"
	@echo "║    make version       - Show current version                      ║"
	@echo "║    make version-bump  - Increment patch version                   ║"
	@echo "║    make version-set V=X.Y.Z - Set specific version               ║"
	@echo "║                                                                  ║"
	@echo "║  Test Commands:                                                  ║"
	@echo "║    make test-qemu     - Test ISO in QEMU (BIOS)                  ║"
	@echo "║    make test-qemu-uefi- Test ISO in QEMU (UEFI)                  ║"
	@echo "║    make test-qemu-install - Test installer with virtual disk     ║"
	@echo "║                                                                  ║"
	@echo "║  Deployment Commands:                                            ║"
	@echo "║    make deploy-usb DEVICE=/dev/sdX                               ║"
	@echo "║         - Lists available ISOs and prompts for version           ║"
	@echo "║    make deploy-usb DEVICE=/dev/sdX ISO_VERSION=0.0.2             ║"
	@echo "║         - Deploy specific version                                 ║"
	@echo "║    make deploy-usb DEVICE=/dev/sdX ISO_VERSION=latest            ║"
	@echo "║         - Deploy most recent ISO                                  ║"
	@echo "║                                                                  ║"
	@echo "║  Docker Commands:                                                ║"
	@echo "║    make docker-builder    - Build base builder image             ║"
	@echo "║                                                                  ║"
	@echo "║  Cleanup Commands:                                               ║"
	@echo "║    make clean         - Clean build artifacts                    ║"
	@echo "║    make clean-all     - Clean artifacts and Docker images        ║"
	@echo "║                                                                  ║"
	@echo "║  Current Version: v$(VERSION)                                     ║"
	@echo "╚══════════════════════════════════════════════════════════════════╝"
	@echo ""
