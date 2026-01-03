# Quantix-OS Build System
# ========================
# Build the immutable hypervisor operating system

.PHONY: all iso squashfs console builder clean help

VERSION ?= 1.0.0
ARCH ?= x86_64
OUTPUT_DIR := output
BUILDER_IMAGE := quantix-os-builder

# Default target
all: iso

# Build the Docker builder image
builder:
	@echo "==> Building builder Docker image..."
	docker build --no-cache -t $(BUILDER_IMAGE) builder/

# Build the bootable ISO installer
iso: builder console-binary
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
squashfs: builder console-binary
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

# Build the Rust console TUI
console-binary:
	@echo "==> Building qx-console (Rust TUI)..."
	cd console && cargo build --release --target x86_64-unknown-linux-musl
	@mkdir -p overlay/usr/local/bin
	cp console/target/x86_64-unknown-linux-musl/release/qx-console overlay/usr/local/bin/

# Build the node daemon (from agent crate)
node-binary:
	@echo "==> Building qx-node (Node Daemon)..."
	cd ../agent && cargo build --release --target x86_64-unknown-linux-musl -p limiquantix-node
	@mkdir -p overlay/usr/local/bin
	cp ../agent/target/x86_64-unknown-linux-musl/release/limiquantix-node overlay/usr/local/bin/qx-node

# Build all binaries
binaries: console-binary node-binary

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
	cd console && cargo clean

# Deep clean including Docker image
distclean: clean
	docker rmi $(BUILDER_IMAGE) 2>/dev/null || true

# Show help
help:
	@echo "Quantix-OS Build System"
	@echo "======================="
	@echo ""
	@echo "Targets:"
	@echo "  make              - Build bootable ISO (default)"
	@echo "  make iso          - Build bootable ISO installer"
	@echo "  make squashfs     - Build update image only"
	@echo "  make console-binary - Build TUI console"
	@echo "  make node-binary  - Build node daemon"
	@echo "  make binaries     - Build all Rust binaries"
	@echo "  make builder      - Build Docker builder image"
	@echo "  make test-iso     - Test ISO in QEMU"
	@echo "  make clean        - Remove build artifacts"
	@echo "  make distclean    - Remove all including Docker image"
	@echo ""
	@echo "Variables:"
	@echo "  VERSION=x.y.z     - Set version (default: 1.0.0)"
	@echo "  ARCH=x86_64       - Set architecture (default: x86_64)"
	@echo ""
	@echo "Examples:"
	@echo "  make VERSION=1.2.0 iso"
	@echo "  make squashfs"
