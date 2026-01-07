# =============================================================================
# Quantix-OS Build System
# =============================================================================
#
# Usage:
#   make iso           - Build complete bootable ISO
#   make squashfs      - Build rootfs squashfs only
#   make console-gui   - Build Slint GUI console
#   make console-tui   - Build ratatui TUI console
#   make host-ui       - Build Host UI web interface
#   make test-qemu     - Test ISO in QEMU
#   make clean         - Clean build artifacts
#   make help          - Show this help
#
# =============================================================================

.PHONY: all iso squashfs initramfs console-gui console-tui host-ui \
        node-daemon test-qemu test-qemu-uefi clean help \
        docker-builder docker-rust-gui docker-rust-tui scripts-executable \
        deploy-usb list-usb

# Version
VERSION ?= 1.0.0
ISO_NAME := quantix-os-$(VERSION).iso
SQUASHFS_NAME := system-$(VERSION).squashfs

# Directories - use CURDIR instead of PWD for better compatibility
BUILD_DIR := $(CURDIR)
OUTPUT_DIR := $(BUILD_DIR)/output
OVERLAY_DIR := $(BUILD_DIR)/overlay
ROOTFS_DIR := $(BUILD_DIR)/.rootfs
ISO_DIR := $(BUILD_DIR)/.iso

# Docker images
BUILDER_IMAGE := quantix-builder
RUST_GUI_IMAGE := quantix-rust-gui-builder
RUST_TUI_IMAGE := quantix-rust-tui-builder

# =============================================================================
# Main Targets
# =============================================================================

all: iso

# Build complete bootable ISO
iso: squashfs console-gui console-tui host-ui node-daemon scripts-executable
	@echo "🔨 Building bootable ISO..."
	@mkdir -p $(OUTPUT_DIR)
	docker run --rm --privileged \
		-v "$(BUILD_DIR):/work" \
		-v "$(OUTPUT_DIR):/output" \
		-w /work \
		$(BUILDER_IMAGE) \
		/bin/bash ./builder/build-iso.sh $(VERSION)
	@echo "✅ ISO built: $(OUTPUT_DIR)/$(ISO_NAME)"

# Build rootfs squashfs
squashfs: docker-builder scripts-executable
	@echo "🔨 Building rootfs squashfs..."
	@mkdir -p $(OUTPUT_DIR)
	docker run --rm --privileged \
		-v "$(BUILD_DIR):/work" \
		-v "$(OUTPUT_DIR):/output" \
		-w /work \
		$(BUILDER_IMAGE) \
		/bin/bash ./builder/build-squashfs.sh $(VERSION)
	@echo "✅ Squashfs built: $(OUTPUT_DIR)/$(SQUASHFS_NAME)"

# Build initramfs
initramfs: docker-builder scripts-executable
	@echo "🔨 Building initramfs..."
	docker run --rm --privileged \
		-v "$(BUILD_DIR):/work" \
		-v "$(OUTPUT_DIR):/output" \
		-w /work \
		$(BUILDER_IMAGE) \
		/bin/bash ./builder/build-initramfs.sh
	@echo "✅ Initramfs built"

# =============================================================================
# Console Builds
# =============================================================================

# Build Slint GUI console (in Alpine container for musl compatibility)
console-gui: docker-rust-gui
	@echo "🔨 Building Slint GUI console..."
	@mkdir -p $(OVERLAY_DIR)/usr/bin
	docker run --rm \
		-v "$(BUILD_DIR)/console-gui:/build:rw" \
		-v "$(OVERLAY_DIR)/usr/bin:/output" \
		-w /build \
		$(RUST_GUI_IMAGE) \
		sh -c "cargo build --release --no-default-features --features linuxkms && \
		       cp target/release/qx-console-gui /output/ 2>/dev/null || \
		       echo 'Note: GUI binary will be built when source exists'"
	@echo "✅ GUI console built"

# Build ratatui TUI console
console-tui: docker-rust-tui
	@echo "🔨 Building TUI console..."
	@mkdir -p $(OVERLAY_DIR)/usr/local/bin
	docker run --rm --network=host \
		-v "$(BUILD_DIR)/console-tui:/build:rw" \
		-v "$(OVERLAY_DIR)/usr/local/bin:/output" \
		-w /build \
		$(RUST_TUI_IMAGE) \
		sh -c "cargo build --release && \
		       cp target/release/qx-console /output/ 2>/dev/null || \
		       echo 'Note: TUI binary will be built when source exists'"
	@echo "✅ TUI console built"

# =============================================================================
# Host UI & Node Daemon
# =============================================================================

# Build Host UI web interface (uses Docker for consistent builds)
host-ui:
	@echo "🔨 Building Host UI..."
	@mkdir -p $(OVERLAY_DIR)/usr/share/quantix-host-ui
	@if [ -d "../quantix-host-ui" ]; then \
		docker run --rm \
			-v "$$(cd .. && pwd)/quantix-host-ui:/app:rw" \
			-w /app \
			node:20-alpine \
			sh -c "npm install && npm run build"; \
		cp -r ../quantix-host-ui/dist/* $(OVERLAY_DIR)/usr/share/quantix-host-ui/; \
		echo "✅ Host UI built"; \
	else \
		echo "⚠️  quantix-host-ui not found, skipping..."; \
	fi

# Build node daemon (uses Docker for musl cross-compilation)
node-daemon: docker-rust-tui
	@echo "🔨 Building node daemon..."
	@mkdir -p $(OVERLAY_DIR)/usr/bin
	@if [ -d "../agent/limiquantix-node" ]; then \
		docker run --rm --network=host \
			-v "$$(cd .. && pwd)/agent:/build:rw" \
			-w /build \
			$(RUST_TUI_IMAGE) \
			sh -c "cargo build --release -p limiquantix-node --features libvirt && \
			       cp target/release/limiquantix-node /build/limiquantix-node-musl"; \
		cp ../agent/limiquantix-node-musl $(OVERLAY_DIR)/usr/bin/qx-node; \
		rm -f ../agent/limiquantix-node-musl; \
		chmod +x $(OVERLAY_DIR)/usr/bin/qx-node; \
		echo "✅ Node daemon built (musl)"; \
	else \
		echo "⚠️  limiquantix-node not found, skipping..."; \
	fi

# =============================================================================
# Docker Image Builds
# =============================================================================

docker-builder:
	@echo "🐳 Building Docker image: $(BUILDER_IMAGE)..."
	docker build -t $(BUILDER_IMAGE) -f builder/Dockerfile builder/

docker-rust-gui:
	@echo "🐳 Building Docker image: $(RUST_GUI_IMAGE)..."
	docker build -t $(RUST_GUI_IMAGE) -f builder/Dockerfile.rust-gui builder/

docker-rust-tui:
	@echo "🐳 Building Docker image: $(RUST_TUI_IMAGE)..."
	docker build -t $(RUST_TUI_IMAGE) -f builder/Dockerfile.rust-tui builder/

# =============================================================================
# Utility Targets
# =============================================================================

# Make all scripts executable
scripts-executable:
	@echo "🔧 Making scripts executable..."
	@chmod +x builder/*.sh 2>/dev/null || true
	@chmod +x installer/*.sh 2>/dev/null || true
	@chmod +x overlay/usr/local/bin/* 2>/dev/null || true
	@chmod +x overlay/etc/init.d/* 2>/dev/null || true
	@chmod +x overlay/etc/local.d/*.start 2>/dev/null || true
	@chmod +x initramfs/init 2>/dev/null || true

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
		-netdev user,id=net0,hostfwd=tcp::8443-:8443

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
		echo "   Searched: /usr/share/OVMF/, /usr/share/edk2/ovmf/, /usr/share/qemu/"; \
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
		-netdev user,id=net0,hostfwd=tcp::8443-:8443

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
		-netdev user,id=net0,hostfwd=tcp::8443-:8443

# =============================================================================
# USB Deployment
# =============================================================================

# Deploy ISO to USB drive
# Usage: make deploy-usb USB=/dev/sdb
#        make deploy-usb USB=/dev/sdb VERIFY=1
deploy-usb: scripts-executable
	@if [ -z "$(USB)" ]; then \
		echo ""; \
		echo "❌ Error: USB device not specified"; \
		echo ""; \
		echo "Usage: make deploy-usb USB=/dev/sdX"; \
		echo "       make deploy-usb USB=/dev/sdX VERIFY=1"; \
		echo ""; \
		echo "Run 'make list-usb' to see available USB devices"; \
		exit 1; \
	fi
	@if [ ! -f "$(OUTPUT_DIR)/$(ISO_NAME)" ]; then \
		echo "❌ ISO not found: $(OUTPUT_DIR)/$(ISO_NAME)"; \
		echo "   Run 'make iso' first."; \
		exit 1; \
	fi
	@VERIFY_FLAG=""; \
	if [ "$(VERIFY)" = "1" ]; then \
		VERIFY_FLAG="--verify"; \
	fi; \
	sudo ./builder/deploy-usb.sh $$VERIFY_FLAG $(USB) $(OUTPUT_DIR)/$(ISO_NAME)

# List available USB devices
list-usb:
	@sudo ./builder/deploy-usb.sh --list

# =============================================================================
# Cleanup
# =============================================================================

clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf $(OUTPUT_DIR)/*.iso
	rm -rf $(OUTPUT_DIR)/*.squashfs
	rm -rf $(OUTPUT_DIR)/test-disk.qcow2
	rm -rf $(ROOTFS_DIR)
	rm -rf $(ISO_DIR)
	rm -rf console-gui/target
	rm -rf console-tui/target
	@echo "✅ Clean complete"

clean-all: clean
	@echo "🧹 Cleaning Docker images..."
	docker rmi $(BUILDER_IMAGE) 2>/dev/null || true
	docker rmi $(RUST_GUI_IMAGE) 2>/dev/null || true
	docker rmi $(RUST_TUI_IMAGE) 2>/dev/null || true
	@echo "✅ Full clean complete"

# =============================================================================
# Help
# =============================================================================

help:
	@echo ""
	@echo "╔══════════════════════════════════════════════════════════════════╗"
	@echo "║                   Quantix-OS Build System                        ║"
	@echo "╠══════════════════════════════════════════════════════════════════╣"
	@echo "║                                                                  ║"
	@echo "║  Build Commands:                                                 ║"
	@echo "║    make iso           - Build complete bootable ISO              ║"
	@echo "║    make squashfs      - Build rootfs squashfs only               ║"
	@echo "║    make console-gui   - Build Slint GUI console                  ║"
	@echo "║    make console-tui   - Build ratatui TUI console                ║"
	@echo "║    make host-ui       - Build Host UI web interface              ║"
	@echo "║    make node-daemon   - Build node daemon                        ║"
	@echo "║                                                                  ║"
	@echo "║  Deploy Commands:                                                ║"
	@echo "║    make list-usb              - List available USB devices       ║"
	@echo "║    make deploy-usb USB=/dev/X - Deploy ISO to USB drive          ║"
	@echo "║                                                                  ║"
	@echo "║  Test Commands:                                                  ║"
	@echo "║    make test-qemu     - Test ISO in QEMU (BIOS)                  ║"
	@echo "║    make test-qemu-uefi- Test ISO in QEMU (UEFI)                  ║"
	@echo "║    make test-qemu-install - Test installer with virtual disk     ║"
	@echo "║                                                                  ║"
	@echo "║  Docker Commands:                                                ║"
	@echo "║    make docker-builder    - Build base builder image             ║"
	@echo "║    make docker-rust-gui   - Build Rust GUI builder image         ║"
	@echo "║    make docker-rust-tui   - Build Rust TUI builder image         ║"
	@echo "║                                                                  ║"
	@echo "║  Cleanup Commands:                                               ║"
	@echo "║    make clean         - Clean build artifacts                    ║"
	@echo "║    make clean-all     - Clean artifacts and Docker images        ║"
	@echo "║                                                                  ║"
	@echo "╚══════════════════════════════════════════════════════════════════╝"
	@echo ""
