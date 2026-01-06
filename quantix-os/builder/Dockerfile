# =============================================================================
# Quantix-OS Builder Dockerfile
# =============================================================================
# This container provides the build environment for creating Quantix-OS images.
# Based on Alpine Linux for consistency with the target OS.
#
# Usage:
#   docker build -t quantix-builder -f builder/Dockerfile builder/
#   docker run --rm -v $(pwd):/work quantix-builder ./builder/build-squashfs.sh
# =============================================================================

FROM alpine:3.20

LABEL maintainer="Quantix-KVM Team"
LABEL description="Build environment for Quantix-OS"

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
    # Misc
    curl \
    wget \
    ca-certificates \
    openssl \
    rsync \
    && rm -rf /var/cache/apk/*

# Create working directories
RUN mkdir -p /work /output /rootfs /iso

# Set working directory
WORKDIR /work

# Default command
CMD ["/bin/bash"]
