# ============================================================================
# Quantix-OS Build Script for Windows
# ============================================================================
# Builds the Quantix-OS ISO using Docker Desktop
#
# Prerequisites:
#   - Docker Desktop for Windows (with Linux containers mode)
#
# Usage:
#   .\build.ps1              # Build ISO
#   .\build.ps1 -Target iso  # Build ISO (explicit)
#   .\build.ps1 -Target squashfs  # Build update image only
#   .\build.ps1 -Clean       # Clean build artifacts
# ============================================================================

param(
    [string]$Target = "iso",
    [string]$Version = "1.0.0",
    [switch]$Clean,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# Configuration
$BUILDER_IMAGE = "quantix-os-builder"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# Colors
function Write-Info { Write-Host "ℹ️  $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "✅ $args" -ForegroundColor Green }
function Write-Warning { Write-Host "⚠️  $args" -ForegroundColor Yellow }
function Write-Error { Write-Host "❌ $args" -ForegroundColor Red }
function Write-Step { Write-Host "`n🔧 $args" -ForegroundColor Magenta }

# Banner
function Show-Banner {
    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║              QUANTIX-OS BUILD SYSTEM (Windows)                ║" -ForegroundColor Cyan
    Write-Host "║                     Version $Version                              ║" -ForegroundColor Cyan
    Write-Host "╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

# Help
function Show-Help {
    Show-Banner
    Write-Host "USAGE:"
    Write-Host "    .\build.ps1 [options]"
    Write-Host ""
    Write-Host "OPTIONS:"
    Write-Host "    -Target <target>    Build target: iso, squashfs, builder (default: iso)"
    Write-Host "    -Version <version>  Set version number (default: 1.0.0)"
    Write-Host "    -Clean              Remove build artifacts"
    Write-Host "    -Help               Show this help message"
    Write-Host ""
    Write-Host "EXAMPLES:"
    Write-Host "    .\build.ps1                    # Build the ISO"
    Write-Host "    .\build.ps1 -Target squashfs   # Build update image only"
    Write-Host "    .\build.ps1 -Version 1.2.0     # Build with custom version"
    Write-Host "    .\build.ps1 -Clean             # Clean artifacts"
    Write-Host ""
    Write-Host "PREREQUISITES:"
    Write-Host "    - Docker Desktop for Windows"
    Write-Host "    - Docker must be running in Linux container mode"
    Write-Host ""
}

# Check Docker
function Test-Docker {
    Write-Step "Checking Docker..."
    
    try {
        $dockerVersion = docker --version
        Write-Info "Docker found: $dockerVersion"
    }
    catch {
        Write-Error "Docker not found! Please install Docker Desktop for Windows."
        Write-Host ""
        Write-Host "Download from: https://www.docker.com/products/docker-desktop/"
        Write-Host ""
        exit 1
    }
    
    # Check if Docker is running
    try {
        docker info | Out-Null
        Write-Success "Docker is running"
    }
    catch {
        Write-Error "Docker is not running! Please start Docker Desktop."
        exit 1
    }
    
    # Check Linux container mode
    $dockerInfo = docker info 2>&1
    if ($dockerInfo -match "OSType: windows") {
        Write-Error "Docker is in Windows container mode!"
        Write-Host ""
        Write-Host "Please switch to Linux containers:"
        Write-Host "  1. Right-click Docker Desktop icon in system tray"
        Write-Host "  2. Select 'Switch to Linux containers...'"
        Write-Host ""
        exit 1
    }
    
    Write-Success "Docker is in Linux container mode"
}

# Build builder image
function Build-BuilderImage {
    Write-Step "Building builder Docker image..."
    
    Push-Location $SCRIPT_DIR
    try {
        docker build -t $BUILDER_IMAGE builder/
        if ($LASTEXITCODE -ne 0) { throw "Failed to build Docker image" }
        Write-Success "Builder image created: $BUILDER_IMAGE"
    }
    finally {
        Pop-Location
    }
}

# Build ISO
function Build-ISO {
    Write-Step "Building Quantix-OS $Version ISO..."
    
    # Create output directory
    $outputDir = Join-Path $SCRIPT_DIR "output"
    if (-not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir | Out-Null
    }
    
    # Convert Windows paths to Docker-compatible format
    $dockerOutputPath = $outputDir -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
    $dockerProfilesPath = (Join-Path $SCRIPT_DIR "profiles") -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
    $dockerOverlayPath = (Join-Path $SCRIPT_DIR "overlay") -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
    $dockerInstallerPath = (Join-Path $SCRIPT_DIR "installer") -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
    $dockerBrandingPath = (Join-Path $SCRIPT_DIR "branding") -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
    
    Write-Info "Output directory: $outputDir"
    
    # Run the build in Docker
    docker run --rm --privileged `
        -v "${dockerOutputPath}:/output" `
        -v "${dockerProfilesPath}:/profiles:ro" `
        -v "${dockerOverlayPath}:/overlay:ro" `
        -v "${dockerInstallerPath}:/installer:ro" `
        -v "${dockerBrandingPath}:/branding:ro" `
        -e "VERSION=$Version" `
        -e "ARCH=x86_64" `
        $BUILDER_IMAGE /build/build-iso.sh
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "ISO build failed!"
        exit 1
    }
    
    $isoPath = Join-Path $outputDir "quantix-os-$Version.iso"
    if (Test-Path $isoPath) {
        $isoSize = (Get-Item $isoPath).Length / 1MB
        Write-Success "ISO built successfully!"
        Write-Host ""
        Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
        Write-Host "║                      BUILD COMPLETE!                          ║" -ForegroundColor Green
        Write-Host "╠═══════════════════════════════════════════════════════════════╣" -ForegroundColor Green
        Write-Host "║  ISO: $isoPath" -ForegroundColor Green
        Write-Host "║  Size: $([math]::Round($isoSize, 2)) MB" -ForegroundColor Green
        Write-Host "╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Yellow
        Write-Host "  1. Write ISO to USB: Use Rufus or balenaEtcher"
        Write-Host "  2. Boot server from USB"
        Write-Host "  3. Follow the installer"
        Write-Host ""
    }
    else {
        Write-Error "ISO file not found at expected location!"
        exit 1
    }
}

# Build squashfs only
function Build-Squashfs {
    Write-Step "Building Quantix-OS $Version squashfs (update image)..."
    
    $outputDir = Join-Path $SCRIPT_DIR "output"
    if (-not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir | Out-Null
    }
    
    $dockerOutputPath = $outputDir -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
    $dockerProfilesPath = (Join-Path $SCRIPT_DIR "profiles") -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
    $dockerOverlayPath = (Join-Path $SCRIPT_DIR "overlay") -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
    
    docker run --rm --privileged `
        -v "${dockerOutputPath}:/output" `
        -v "${dockerProfilesPath}:/profiles:ro" `
        -v "${dockerOverlayPath}:/overlay:ro" `
        -e "VERSION=$Version" `
        -e "ARCH=x86_64" `
        $BUILDER_IMAGE /build/build-squashfs.sh
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Squashfs build failed!"
        exit 1
    }
    
    Write-Success "Squashfs built: output/system-$Version.squashfs"
}

# Clean
function Invoke-Clean {
    Write-Step "Cleaning build artifacts..."
    
    $outputDir = Join-Path $SCRIPT_DIR "output"
    if (Test-Path $outputDir) {
        Remove-Item -Recurse -Force $outputDir
        Write-Success "Removed: $outputDir"
    }
    
    # Remove Docker image
    docker rmi $BUILDER_IMAGE 2>$null
    Write-Success "Removed Docker image: $BUILDER_IMAGE"
    
    Write-Success "Clean complete"
}

# Main
function Main {
    if ($Help) {
        Show-Help
        return
    }
    
    Show-Banner
    
    if ($Clean) {
        Invoke-Clean
        return
    }
    
    Test-Docker
    
    switch ($Target.ToLower()) {
        "builder" {
            Build-BuilderImage
        }
        "squashfs" {
            Build-BuilderImage
            Build-Squashfs
        }
        "iso" {
            Build-BuilderImage
            Build-ISO
        }
        default {
            Write-Error "Unknown target: $Target"
            Write-Host "Valid targets: iso, squashfs, builder"
            exit 1
        }
    }
}

Main
