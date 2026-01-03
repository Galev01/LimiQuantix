<#
.SYNOPSIS
    Quantix-OS Build Script for Windows

.DESCRIPTION
    Builds the Quantix-OS ISO using Docker Desktop.
    
    Prerequisites:
    - Docker Desktop for Windows (with Linux containers mode)

.PARAMETER Target
    Build target: iso, squashfs, builder (default: iso)

.PARAMETER Version
    Set version number (default: 1.0.0)

.PARAMETER Clean
    Remove build artifacts

.PARAMETER Help
    Show help message

.EXAMPLE
    .\build.ps1
    Build the ISO with default settings

.EXAMPLE
    .\build.ps1 -Target squashfs -Version 1.2.0
    Build update image with custom version
#>

param(
    [string]$Target = "iso",
    [string]$Version = "1.0.0",
    [switch]$Clean,
    [switch]$Help
)

# Use SilentlyContinue to prevent Docker's stderr output from being treated as errors
$ErrorActionPreference = "SilentlyContinue"

# Configuration
$BUILDER_IMAGE = "quantix-os-builder"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# Helper functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Magenta
}

# Banner
function Show-Banner {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "          QUANTIX-OS BUILD SYSTEM (Windows)                     " -ForegroundColor Cyan
    Write-Host "                   Version $Version                             " -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""
}

# Help
function Show-Help {
    Show-Banner
    Write-Host "USAGE:"
    Write-Host "    .\build.ps1 [options]"
    Write-Host ""
    Write-Host "OPTIONS:"
    Write-Host "    -Target [target]    Build target: iso, squashfs, builder (default: iso)"
    Write-Host "    -Version [version]  Set version number (default: 1.0.0)"
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
    
    # Check if docker command exists
    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCmd) {
        Write-Err "Docker not found! Please install Docker Desktop for Windows."
        Write-Host ""
        Write-Host "Download from: https://www.docker.com/products/docker-desktop/"
        Write-Host ""
        exit 1
    }
    
    $dockerVersion = docker --version 2>$null
    Write-Info "Docker found: $dockerVersion"
    
    # Check if Docker daemon is running
    $null = docker info 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Docker is not running! Please start Docker Desktop."
        Write-Host ""
        exit 1
    }
    Write-Success "Docker is running"
    
    # Check Linux container mode
    $dockerInfo = docker info 2>$null
    if ($dockerInfo -match "OSType: windows") {
        Write-Err "Docker is in Windows container mode!"
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
    
    # Get paths - Docker Desktop on Windows handles Windows paths directly
    $profilesPath = Join-Path $SCRIPT_DIR "profiles"
    $overlayPath = Join-Path $SCRIPT_DIR "overlay"
    $installerPath = Join-Path $SCRIPT_DIR "installer"
    $brandingPath = Join-Path $SCRIPT_DIR "branding"
    
    Write-Info "Output directory: $outputDir"
    Write-Info "This will take several minutes..."
    Write-Host ""
    
    # Create a temporary batch file to run Docker (avoids path issues with spaces)
    $batchFile = Join-Path $env:TEMP "quantix-build-$([guid]::NewGuid().ToString('N').Substring(0,8)).bat"
    
    # Write batch file with proper quoting
    $batchContent = @"
@echo off
docker run --rm --privileged ^
  -v "$outputDir:/output" ^
  -v "$profilesPath:/profiles:ro" ^
  -v "$overlayPath:/overlay:ro" ^
  -v "$installerPath:/installer:ro" ^
  -v "$brandingPath:/branding:ro" ^
  -e VERSION=$Version ^
  -e ARCH=x86_64 ^
  $BUILDER_IMAGE
exit /b %ERRORLEVEL%
"@
    
    Set-Content -Path $batchFile -Value $batchContent -Encoding ASCII
    
    Write-Info "Running Docker build..."
    
    # Execute the batch file
    & cmd /c $batchFile
    $exitCode = $LASTEXITCODE
    
    # Clean up batch file
    Remove-Item -Path $batchFile -Force -ErrorAction SilentlyContinue
    
    if ($exitCode -ne 0) {
        Write-Err "ISO build failed with exit code: $exitCode"
        Write-Host ""
        Write-Host "To debug, run interactively:" -ForegroundColor Yellow
        Write-Host "  docker run --rm -it --privileged -v `"$outputDir`":/output -v `"$profilesPath`":/profiles:ro $BUILDER_IMAGE /bin/bash" -ForegroundColor Gray
        Write-Host ""
        exit 1
    }
    
    $isoPath = Join-Path $outputDir "quantix-os-$Version.iso"
    if (Test-Path $isoPath) {
        $isoSize = (Get-Item $isoPath).Length / 1MB
        Write-Success "ISO built successfully!"
        Write-Host ""
        Write-Host "================================================================" -ForegroundColor Green
        Write-Host "                    BUILD COMPLETE!                             " -ForegroundColor Green
        Write-Host "================================================================" -ForegroundColor Green
        Write-Host "  ISO: $isoPath" -ForegroundColor Green
        Write-Host "  Size: $([math]::Round($isoSize, 2)) MB" -ForegroundColor Green
        Write-Host "================================================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Yellow
        Write-Host "  1. Write ISO to USB: Use Rufus or balenaEtcher"
        Write-Host "  2. Boot server from USB"
        Write-Host "  3. Follow the installer"
        Write-Host ""
    }
    else {
        Write-Err "ISO file not found at expected location!"
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
    
    $profilesPath = Join-Path $SCRIPT_DIR "profiles"
    $overlayPath = Join-Path $SCRIPT_DIR "overlay"
    
    docker run --rm --privileged `
        -v "${outputDir}:/output" `
        -v "${profilesPath}:/profiles:ro" `
        -v "${overlayPath}:/overlay:ro" `
        -e "VERSION=$Version" `
        -e "ARCH=x86_64" `
        $BUILDER_IMAGE `
        /build/build-squashfs.sh
    
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Squashfs build failed!"
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
            Write-Err "Unknown target: $Target"
            Write-Host "Valid targets: iso, squashfs, builder"
            exit 1
        }
    }
}

Main
