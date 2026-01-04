# Workflow State: Fix Slint GUI Build for Alpine

## Problem (RESOLVED)

Building `qx-console-gui` with `--target x86_64-unknown-linux-musl` fails because:
1. `libudev-sys` requires system libraries that can't be cross-compiled
2. pkg-config can't find musl-compatible udev libraries on the Ubuntu host

## Solution Applied

Build the GUI binary **inside an Alpine Docker container** that has all the correct musl-based libraries pre-installed.

### Files Created/Modified

1. **`builder/Dockerfile.rust-gui`** (NEW):
   - Alpine 3.20 + Rust 1.83
   - All Slint LinuxKMS dependencies pre-installed (eudev-dev, libxkbcommon-dev, etc.)
   - Builds natively with musl libc

2. **`Makefile`** (UPDATED):
   - Added `rust-gui-builder` target to build the Docker image
   - Changed `console-gui-binary` to build inside the Docker container
   - Updated help text and distclean target

3. **`console-gui/Cargo.toml`** (PREVIOUS UPDATE):
   - Changed `linuxkms` feature to use `renderer-femtovg` (pure Rust, no Skia)

## How It Works

```
make console-gui-binary
  └── make rust-gui-builder (builds quantix-rust-gui-builder Docker image)
  └── docker run ... cargo build --release --no-default-features --features linuxkms
  └── Copies binary to overlay/usr/bin/qx-console-gui
```

## Next Steps for User

```bash
cd ~/LimiQuantix/quantix-os

# Clean old binary
rm -f overlay/usr/bin/qx-console-gui

# Build the GUI binary (this will build the Docker image automatically)
make console-gui-binary

# Build the ISO
make iso
```

## Status: COMPLETE
