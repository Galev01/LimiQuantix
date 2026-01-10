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
        docker-builder docker-rust-gui docker-rust-tui scripts-executable

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

# Build ratatui TUI console (optional - may not have source)
console-tui: docker-rust-tui
	@echo "🔨 Building TUI console..."
	@mkdir -p $(OVERLAY_DIR)/usr/local/bin
	@if [ -f "$(BUILD_DIR)/console-tui/Cargo.toml" ]; then \
	docker run --rm --network=host \
		-v "$(BUILD_DIR)/console-tui:/build:rw" \
		-v "$(OVERLAY_DIR)/usr/local/bin:/output" \
		-w /build \
		$(RUST_TUI_IMAGE) \
			sh -c "set -e && cargo build --release && cp target/release/qx-console /output/" && \
		echo "✅ TUI console built"; \
	else \
		echo "⚠️  Console TUI source not found, skipping (optional component)"; \
	fi

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
			sh -c "npm install && npm run build" && \
		cp -r ../quantix-host-ui/dist/* $(OVERLAY_DIR)/usr/share/quantix-host-ui/ && \
		echo "   Generating BUILD_INFO.json..." && \
		NODE_VERSION=$$(grep -m1 '"version"' ../quantix-host-ui/package.json 2>/dev/null | sed 's/.*"\([^"]*\)".*/\1/' || echo "0.1.0") && \
		DAEMON_VERSION=$$(grep -m1 '^version' ../agent/limiquantix-node/Cargo.toml 2>/dev/null | sed 's/.*"\(.*\)".*/\1/' || echo "0.1.0") && \
		BUILD_DATE=$$(date -u +"%Y-%m-%dT%H:%M:%SZ") && \
		BUILD_COMMIT=$$(cd .. && git rev-parse --short HEAD 2>/dev/null || echo "unknown") && \
		BUILD_BRANCH=$$(cd .. && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown") && \
		echo "{" > $(OVERLAY_DIR)/usr/share/quantix-host-ui/BUILD_INFO.json && \
		echo "  \"product\": \"Quantix-OS\"," >> $(OVERLAY_DIR)/usr/share/quantix-host-ui/BUILD_INFO.json && \
		echo "  \"version\": \"$$DAEMON_VERSION\"," >> $(OVERLAY_DIR)/usr/share/quantix-host-ui/BUILD_INFO.json && \
		echo "  \"hostUiVersion\": \"$$NODE_VERSION\"," >> $(OVERLAY_DIR)/usr/share/quantix-host-ui/BUILD_INFO.json && \
		echo "  \"nodeDaemonVersion\": \"$$DAEMON_VERSION\"," >> $(OVERLAY_DIR)/usr/share/quantix-host-ui/BUILD_INFO.json && \
		echo "  \"buildDate\": \"$$BUILD_DATE\"," >> $(OVERLAY_DIR)/usr/share/quantix-host-ui/BUILD_INFO.json && \
		echo "  \"buildCommit\": \"$$BUILD_COMMIT\"," >> $(OVERLAY_DIR)/usr/share/quantix-host-ui/BUILD_INFO.json && \
		echo "  \"buildBranch\": \"$$BUILD_BRANCH\"," >> $(OVERLAY_DIR)/usr/share/quantix-host-ui/BUILD_INFO.json && \
		echo "  \"apiVersion\": \"v1\"," >> $(OVERLAY_DIR)/usr/share/quantix-host-ui/BUILD_INFO.json && \
		echo "  \"registrationApiSupported\": true" >> $(OVERLAY_DIR)/usr/share/quantix-host-ui/BUILD_INFO.json && \
		echo "}" >> $(OVERLAY_DIR)/usr/share/quantix-host-ui/BUILD_INFO.json && \
		cat $(OVERLAY_DIR)/usr/share/quantix-host-ui/BUILD_INFO.json && \
		echo "✅ Host UI built"; \
	else \
		echo "❌ quantix-host-ui not found!"; \
		exit 1; \
	fi

# Build node daemon (uses Docker for Alpine native compilation)
node-daemon: docker-rust-tui
	@echo "🔨 Building node daemon..."
	@mkdir -p $(OVERLAY_DIR)/usr/bin
	@if [ -d "../agent/limiquantix-node" ]; then \
		echo "   Compiling node daemon (this may take several minutes)..."; \
		docker run --rm --network=host \
			-v "$$(cd .. && pwd)/agent:/build:rw" \
			-w /build \
			$(RUST_TUI_IMAGE) \
			sh -c "set -e && \
			       echo '   Building limiquantix-node...' && \
			       cargo build --release -p limiquantix-node --features libvirt 2>&1 && \
			       echo '   Copying binary...' && \
			       cp target/release/limiquantix-node /build/limiquantix-node-alpine" || { \
			echo "❌ Node daemon build FAILED! See errors above."; \
			exit 1; \
		}; \
		if [ ! -f "../agent/limiquantix-node-alpine" ]; then \
			echo "❌ Node daemon binary not found after build!"; \
			exit 1; \
		fi; \
		cp ../agent/limiquantix-node-alpine $(OVERLAY_DIR)/usr/bin/qx-node; \
		rm -f ../agent/limiquantix-node-alpine; \
		chmod +x $(OVERLAY_DIR)/usr/bin/qx-node; \
		ls -lh $(OVERLAY_DIR)/usr/bin/qx-node; \
		echo "✅ Node daemon built successfully"; \
	else \
		echo "❌ limiquantix-node source not found at ../agent/limiquantix-node!"; \
		exit 1; \
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
	docker build --network=host -t $(RUST_TUI_IMAGE) -f builder/Dockerfile.rust-tui builder/

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
		-netdev user,id=net0,hostfwd=tcp::8080-:8080,hostfwd=tcp::8443-:8443

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
		-netdev user,id=net0,hostfwd=tcp::8080-:8080,hostfwd=tcp::8443-:8443

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
		-netdev user,id=net0,hostfwd=tcp::8080-:8080,hostfwd=tcp::8443-:8443

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
