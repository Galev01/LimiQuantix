# Building qvmc Installers

This guide explains how to build qvmc installers for Windows (.exe) and macOS (.dmg).

## Prerequisites

### All Platforms
- [Rust](https://rustup.rs/) 1.70+
- [Node.js](https://nodejs.org/) 18+
- npm or pnpm

### Windows
```bash
# Visual Studio Build Tools 2022
winget install Microsoft.VisualStudio.2022.BuildTools

# NSIS (for .exe installer) - Tauri downloads this automatically
# Or install manually: https://nsis.sourceforge.io/Download
```

### macOS
```bash
# Xcode Command Line Tools
xcode-select --install

# For code signing (optional but recommended for distribution):
# You need an Apple Developer account and signing certificate
```

## Step 1: Generate Icons

Tauri requires icons in specific formats. You can generate them from a single 1024x1024 PNG:

### Option A: Use Tauri Icon Generator (Recommended)
```bash
cd qvmc

# Install tauri-cli if not installed
npm install -g @tauri-apps/cli

# Generate icons from a source image
# First, create a 1024x1024 PNG called "app-icon.png" in qvmc/
tauri icon app-icon.png
```

### Option B: Create Icons Manually
Place these files in `qvmc/src-tauri/icons/`:
- `32x32.png` - 32x32 pixels
- `128x128.png` - 128x128 pixels  
- `128x128@2x.png` - 256x256 pixels (for Retina displays)
- `icon.icns` - macOS icon bundle
- `icon.ico` - Windows icon

## Step 2: Install Dependencies

```bash
cd qvmc
npm install
```

## Step 3: Build for Windows (.exe)

### On Windows Machine:
```bash
cd qvmc
npm run tauri build
```

This produces:
- `src-tauri/target/release/qvmc.exe` - Standalone executable
- `src-tauri/target/release/bundle/nsis/qvmc_0.1.0_x64-setup.exe` - NSIS Installer
- `src-tauri/target/release/bundle/msi/qvmc_0.1.0_x64_en-US.msi` - MSI Installer

### Cross-compile from other platforms:
Cross-compilation for Windows is complex. It's recommended to build on Windows.

## Step 4: Build for macOS (.dmg)

### On macOS Machine:
```bash
cd qvmc
npm run tauri build
```

This produces:
- `src-tauri/target/release/bundle/macos/qvmc.app` - macOS Application
- `src-tauri/target/release/bundle/dmg/qvmc_0.1.0_x64.dmg` - DMG Installer

### For Universal Binary (Intel + Apple Silicon):
```bash
# Add both targets
rustup target add x86_64-apple-darwin
rustup target add aarch64-apple-darwin

# Build universal binary
npm run tauri build -- --target universal-apple-darwin
```

### Code Signing (Required for Distribution):
For users to install without security warnings:

```bash
# Sign the app
codesign --deep --force --verify --verbose --sign "Developer ID Application: Your Name (TEAM_ID)" \
  "src-tauri/target/release/bundle/macos/qvmc.app"

# Notarize with Apple
xcrun notarytool submit "src-tauri/target/release/bundle/dmg/qvmc_0.1.0_x64.dmg" \
  --apple-id "your@email.com" \
  --team-id "TEAM_ID" \
  --password "app-specific-password" \
  --wait
```

## Step 5: Build for Linux

```bash
cd qvmc
npm run tauri build
```

This produces:
- `src-tauri/target/release/bundle/appimage/qvmc_0.1.0_amd64.AppImage`
- `src-tauri/target/release/bundle/deb/qvmc_0.1.0_amd64.deb`

## Troubleshooting

### "Icons not found" error
Generate icons with `tauri icon` command or manually create them.

### Windows: "NSIS not found"
Tauri should download NSIS automatically. If not:
```bash
choco install nsis
# or
winget install NSIS.NSIS
```

### macOS: "Code signing failed"
For unsigned builds (testing only):
```bash
npm run tauri build -- --no-bundle
# Then manually create DMG without signing
```

### Linux: "webkit2gtk not found"
```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.0-dev

# Fedora
sudo dnf install webkit2gtk4.0-devel
```

## Output Files Summary

| Platform | File | Type |
|----------|------|------|
| Windows | `qvmc_0.1.0_x64-setup.exe` | NSIS Installer |
| Windows | `qvmc_0.1.0_x64_en-US.msi` | MSI Installer |
| macOS | `qvmc_0.1.0_x64.dmg` | DMG Disk Image |
| macOS | `qvmc.app` | Application Bundle |
| Linux | `qvmc_0.1.0_amd64.AppImage` | AppImage |
| Linux | `qvmc_0.1.0_amd64.deb` | Debian Package |
