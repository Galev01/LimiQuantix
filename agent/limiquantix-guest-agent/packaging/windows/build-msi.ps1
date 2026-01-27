# Quantix KVM Guest Agent MSI Build Script
# 
# Prerequisites:
#   - Rust with windows-msvc toolchain
#   - WiX Toolset v4 (winget install WixToolset.WiXToolset)
#   - Visual Studio Build Tools with C++ workload
#
# Usage:
#   .\build-msi.ps1 [-Version "0.1.0"] [-Configuration "release"]

param(
    [string]$Version = "0.1.0",
    [string]$Configuration = "release"
)

$ErrorActionPreference = "Stop"

Write-Host "Building Quantix KVM Guest Agent MSI v$Version" -ForegroundColor Cyan

# Paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\..\..\.."
$AgentRoot = Resolve-Path "$ScriptDir\..\.."
$WixDir = "$ScriptDir\wix"
$OutputDir = "$ScriptDir\output"

# Create output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# Step 1: Build the Rust agent for Windows
Write-Host "`nStep 1: Building Rust agent..." -ForegroundColor Yellow
Push-Location $AgentRoot

$CargoArgs = @("build", "--release", "--target", "x86_64-pc-windows-msvc")
if ($Configuration -eq "debug") {
    $CargoArgs = @("build", "--target", "x86_64-pc-windows-msvc")
}

cargo $CargoArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Cargo build failed"
    Pop-Location
    exit 1
}

Pop-Location

# Find the built executable
$ExePath = if ($Configuration -eq "release") {
    "$ProjectRoot\agent\target\x86_64-pc-windows-msvc\release\quantix-kvm-agent.exe"
} else {
    "$ProjectRoot\agent\target\x86_64-pc-windows-msvc\debug\quantix-kvm-agent.exe"
}

if (-not (Test-Path $ExePath)) {
    Write-Error "Built executable not found at: $ExePath"
    exit 1
}

Write-Host "Built: $ExePath" -ForegroundColor Green

# Step 2: Copy files to WiX source directory
Write-Host "`nStep 2: Preparing WiX source files..." -ForegroundColor Yellow

Copy-Item $ExePath "$WixDir\quantix-kvm-agent.exe" -Force

# Create a simple icon if one doesn't exist
$IconPath = "$WixDir\icon.ico"
if (-not (Test-Path $IconPath)) {
    Write-Host "Note: Using placeholder icon. Replace $IconPath with actual icon." -ForegroundColor DarkYellow
    # Create a minimal valid ICO file (16x16 blue square)
    # In production, replace this with an actual icon
    $iconBytes = [byte[]](0,0,1,0,1,0,16,16,0,0,1,0,32,0,104,4,0,0,22,0,0,0)
    [System.IO.File]::WriteAllBytes($IconPath, $iconBytes)
}

# Step 3: Build MSI with WiX
Write-Host "`nStep 3: Building MSI with WiX..." -ForegroundColor Yellow

Push-Location $WixDir

# Check if WiX is available
$wixPath = Get-Command "wix" -ErrorAction SilentlyContinue
if (-not $wixPath) {
    Write-Host "WiX not found. Installing via winget..." -ForegroundColor Yellow
    winget install WixToolset.WiXToolset --silent
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# Build the MSI
$MsiName = "quantix-kvm-agent-$Version-x64.msi"
wix build main.wxs -o "$OutputDir\$MsiName" -define Version=$Version
if ($LASTEXITCODE -ne 0) {
    Write-Error "WiX build failed"
    Pop-Location
    exit 1
}

Pop-Location

# Step 4: Verify output
$MsiPath = "$OutputDir\$MsiName"
if (Test-Path $MsiPath) {
    $size = (Get-Item $MsiPath).Length / 1MB
    Write-Host "`nSuccess! MSI created:" -ForegroundColor Green
    Write-Host "  Path: $MsiPath" -ForegroundColor White
    Write-Host "  Size: $([math]::Round($size, 2)) MB" -ForegroundColor White
} else {
    Write-Error "MSI file not found after build"
    exit 1
}

Write-Host "`nTo install on a Windows VM:" -ForegroundColor Cyan
Write-Host "  msiexec /i $MsiName /quiet /log install.log" -ForegroundColor White
Write-Host "`nTo uninstall:" -ForegroundColor Cyan
Write-Host "  msiexec /x $MsiName /quiet" -ForegroundColor White
