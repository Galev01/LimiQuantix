# =============================================================================
# Quantix-vDC Builder Dockerfile
# =============================================================================
# This container provides the build environment for creating Quantix-vDC
# appliance images. Based on Alpine Linux for consistency.
#
# Usage:
#   docker build -t quantix-vdc-builder -f builder/Dockerfile builder/
#   docker run --rm -v $(pwd):/work quantix-vdc-builder ./builder/build-rootfs.sh
# =============================================================================

FROM alpine:3.20

LABEL maintainer="Quantix-KVM Team"
LABEL description="Build environment for Quantix-vDC"

# Install build dependencies
RUN apk add --no-cache \
    # Core build tools
    alpine-sdk \
    bash \
    coreutils \
    findutils \
    grep \
    sed \
    gawk \
    # Filesystem tools
    squashfs-tools \
    dosfstools \
    e2fsprogs \
    xfsprogs \
    parted \
    util-linux \
    multipath-tools \
    # Bootloader
    grub \
    grub-efi \
    grub-bios \
    # ISO creation
    xorriso \
    mtools \
    # Alpine tools
    apk-tools \
    alpine-conf \
    mkinitfs \
    # Compression
    xz \
    zstd \
    gzip \
    # Disk image tools
    qemu-img \
    # OVA/OVF tools
    tar \
    # Networking tools for testing
    curl \
    wget \
    ca-certificates \
    openssl \
    rsync \
    # Dialog for TUI
    dialog \
    ncurses \
    # UUID generation
    libuuid \
    && rm -rf /var/cache/apk/*

# Create working directories
RUN mkdir -p /work /output /rootfs /iso

# Set working directory
WORKDIR /work

# Default command
CMD ["/bin/bash"]
