# Quantix-OS Builder
# ==================
# Alpine-based build environment for creating Quantix-OS images
#
# This container includes all tools needed to:
# - Build Alpine rootfs with custom packages
# - Create squashfs images
# - Generate bootable ISOs with GRUB
# - Sign images for secure boot

FROM alpine:3.20

LABEL maintainer="Quantix Team <team@quantix.io>"
LABEL description="Build environment for Quantix-OS hypervisor operating system"

# Install build dependencies
RUN apk add --no-cache \
    # Core build tools
    alpine-sdk \
    build-base \
    abuild \
    sudo \
    # Alpine image creation
    alpine-conf \
    mkinitfs \
    squashfs-tools \
    # Bootloader and ISO tools
    grub \
    grub-efi \
    grub-bios \
    xorriso \
    mtools \
    dosfstools \
    # Filesystem tools
    e2fsprogs \
    xfsprogs \
    lvm2 \
    parted \
    # Utilities
    coreutils \
    util-linux \
    bash \
    curl \
    wget \
    rsync \
    tar \
    gzip \
    xz \
    cpio \
    # APK tools for custom repos
    apk-tools \
    # Signing and verification
    gnupg \
    openssl

# Create build directories
RUN mkdir -p /build /output /work /rootfs

# Copy build scripts
COPY build-iso.sh /build/
COPY build-squashfs.sh /build/

# Make scripts executable
RUN chmod +x /build/*.sh

# Create non-root builder user (for abuild)
RUN adduser -D builder && \
    addgroup builder abuild && \
    echo "builder ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# Set up abuild keys
RUN su - builder -c "abuild-keygen -a -i -n"

# Default environment
ENV VERSION=1.0.0
ENV ARCH=x86_64
ENV ALPINE_VERSION=3.20
ENV KERNEL_FLAVOR=lts

WORKDIR /build

# Default command
CMD ["/build/build-iso.sh"]
