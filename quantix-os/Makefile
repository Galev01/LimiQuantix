# Quantix-OS Build System
# ========================
# Build the immutable hypervisor operating system

.PHONY: all iso squashfs console builder rust-gui-builder webui clean help

VERSION ?= 1.0.0
ARCH ?= x86_64
OUTPUT_DIR := output
BUILDER_IMAGE := quantix-os-builder
RUST_GUI_BUILDER_IMAGE := quantix-rust-gui-builder

# Default target
all: iso

# Build the Docker builder image (for ISO/squashfs)
builder:
	@echo "==> Building builder Docker image..."
	docker build --no-cache -t $(BUILDER_IMAGE) builder/

# Build the Docker image for Rust GUI compilation (Alpine + Slint deps)
rust-gui-builder:
	@echo "==> Building Rust GUI builder Docker image..."
	docker build -t $(RUST_GUI_BUILDER_IMAGE) -f builder/Dockerfile.rust-gui builder/

# Build the bootable ISO installer
iso: builder console-binary console-gui-binary webui
	@echo "==> Building Quantix-OS $(VERSION) ISO..."
	@mkdir -p $(OUTPUT_DIR)
	docker run --rm --privileged \
		-v $(PWD)/output:/output \
		-v $(PWD)/profiles:/profiles:ro \
		-v $(PWD)/overlay:/overlay:ro \
		-v $(PWD)/installer:/installer:ro \
		-v $(PWD)/branding:/branding:ro \
		-e VERSION=$(VERSION) \
		-e ARCH=$(ARCH) \
		$(BUILDER_IMAGE) /build/build-iso.sh
	@echo "==> ISO built: $(OUTPUT_DIR)/quantix-os-$(VERSION).iso"

# Build just the root filesystem squashfs (for updates)
squashfs: builder console-binary console-gui-binary webui
	@echo "==> Building system squashfs..."
	@mkdir -p $(OUTPUT_DIR)
	docker run --rm --privileged \
		-v $(PWD)/output:/output \
		-v $(PWD)/profiles:/profiles:ro \
		-v $(PWD)/overlay:/overlay:ro \
		-e VERSION=$(VERSION) \
		-e ARCH=$(ARCH) \
		$(BUILDER_IMAGE) /build/build-squashfs.sh
	@echo "==> Squashfs built: $(OUTPUT_DIR)/system-$(VERSION).squashfs"

# Build the Rust console TUI (fallback)
console-binary:
	@echo "==> Building qx-console (Rust TUI - fallback)..."
	cd console && cargo build --release --target x86_64-unknown-linux-musl
	@mkdir -p overlay/usr/local/bin
	cp console/target/x86_64-unknown-linux-musl/release/qx-console overlay/usr/local/bin/

# Build the Slint console GUI (primary)
# Built inside an Alpine Docker container to ensure musl compatibility
# The container has all LinuxKMS dependencies pre-installed
# Includes framebuffer fallback for VGA-only VMs without DRM/KMS
console-gui-binary: rust-gui-builder
	@echo "==> Building qx-console-gui (Slint GUI + Framebuffer fallback) in Alpine container..."
	@mkdir -p overlay/usr/bin
	docker run --rm \
		-v $(PWD)/console-gui:/build:rw \
		-v $(PWD)/overlay/usr/bin:/output \
		-w /build \
		$(RUST_GUI_BUILDER_IMAGE) \
		sh -c "cargo build --release --no-default-features --features linuxkms,framebuffer && \
		       cp target/release/qx-console-gui /output/ && \
		       chmod 755 /output/qx-console-gui"
	@echo "==> GUI binary copied to overlay/usr/bin/qx-console-gui"

# Build the node daemon (from agent crate)
node-binary:
	@echo "==> Building qx-node (Node Daemon)..."
	cd ../agent && cargo build --release --target x86_64-unknown-linux-musl -p limiquantix-node
	@mkdir -p overlay/usr/local/bin
	cp ../agent/target/x86_64-unknown-linux-musl/release/limiquantix-node overlay/usr/local/bin/qx-node

# Build the Web UI (React SPA for remote management)
webui:
	@echo "==> Building Quantix Host UI (Web Management Interface)..."
	@mkdir -p overlay/usr/share/quantix/webui
	cd ../quantix-host-ui && npm ci && npm run build
	cp -r ../quantix-host-ui/dist/* overlay/usr/share/quantix/webui/
	@echo "==> Web UI built: overlay/usr/share/quantix/webui/"

# Build all binaries
binaries: console-binary console-gui-binary node-binary

# Run the ISO in QEMU for testing
test-iso:
	@echo "==> Testing ISO in QEMU..."
	qemu-system-x86_64 \
		-enable-kvm \
		-m 4G \
		-cpu host \
		-smp 2 \
		-cdrom $(OUTPUT_DIR)/quantix-os-$(VERSION).iso \
		-boot d \
		-serial stdio

# Clean build artifacts
clean:
	@echo "==> Cleaning build artifacts..."
	rm -rf $(OUTPUT_DIR)/*
	rm -f overlay/usr/local/bin/qx-console
	rm -f overlay/usr/local/bin/qx-node
	rm -f overlay/usr/bin/qx-console-gui
	rm -rf overlay/usr/share/quantix/webui/*
	cd console && cargo clean
	cd console-gui && cargo clean
	cd ../quantix-host-ui && rm -rf node_modules dist 2>/dev/null || true

# Deep clean including Docker images
distclean: clean
	docker rmi $(BUILDER_IMAGE) 2>/dev/null || true
	docker rmi $(RUST_GUI_BUILDER_IMAGE) 2>/dev/null || true

# Show help
help:
	@echo "Quantix-OS Build System"
	@echo "======================="
	@echo ""
	@echo "Targets:"
	@echo "  make              - Build bootable ISO (default)"
	@echo "  make iso          - Build bootable ISO installer"
	@echo "  make squashfs     - Build update image only"
	@echo "  make console-binary     - Build TUI console (fallback)"
	@echo "  make console-gui-binary - Build Slint GUI console (in Docker)"
	@echo "  make webui        - Build Web UI (React SPA for remote management)"
	@echo "  make node-binary  - Build node daemon"
	@echo "  make binaries     - Build all Rust binaries"
	@echo "  make builder      - Build Docker builder image (ISO/squashfs)"
	@echo "  make rust-gui-builder   - Build Docker image for Slint GUI compilation"
	@echo "  make test-iso     - Test ISO in QEMU"
	@echo "  make clean        - Remove build artifacts"
	@echo "  make distclean    - Remove all including Docker images"
	@echo ""
	@echo "Variables:"
	@echo "  VERSION=x.y.z     - Set version (default: 1.0.0)"
	@echo "  ARCH=x86_64       - Set architecture (default: x86_64)"
	@echo ""
	@echo "Examples:"
	@echo "  make VERSION=1.2.0 iso"
	@echo "  make squashfs"
