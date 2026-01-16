# =============================================================================
# Quantix-OS Update Publisher (PowerShell)
# =============================================================================
# Builds and publishes component updates to the update server.
#
# Usage:
#   .\publish-update.ps1                         # Build all and publish to dev
#   .\publish-update.ps1 -Channel beta           # Publish to beta channel
#   .\publish-update.ps1 -Component qx-node      # Build only qx-node
#   .\publish-update.ps1 -DryRun                 # Build but don't upload
#   .\publish-update.ps1 -SkipBuild              # Upload pre-built artifacts only
#
# Note: For cross-compilation to Linux, run in WSL or use Docker.
# =============================================================================

param(
    [ValidateSet("dev", "beta", "stable")]
    [string]$Channel = "dev",
    
    [string[]]$Component = @(),
    
    [string]$Server = $env:UPDATE_SERVER,
    
    [string]$Token = $env:PUBLISH_TOKEN,
    
    [string]$Version = "",
    
    [switch]$DryRun,
    
    [switch]$SkipBuild,
    
    [switch]$Help
)

# Set defaults
if (-not $Server) { $Server = "http://localhost:9000" }
if (-not $Token) { $Token = "dev-token" }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# Read version from file if not specified
if (-not $Version) {
    $VersionFile = Join-Path $ProjectRoot "Quantix-OS\VERSION"
    if (Test-Path $VersionFile) {
        $Version = (Get-Content $VersionFile -Raw).Trim()
    } else {
        $Version = "0.0.1"
    }
}

# Staging directory
$StagingDir = Join-Path $env:TEMP "quantix-update-staging"

# Colors
function Write-Info { Write-Host "[INFO] $args" -ForegroundColor Green }
function Write-Warn { Write-Host "[WARN] $args" -ForegroundColor Yellow }
function Write-Err { Write-Host "[ERROR] $args" -ForegroundColor Red }
function Write-Step { Write-Host "[STEP] $args" -ForegroundColor Cyan }

function Show-Usage {
    @"
Quantix-OS Update Publisher

Usage: .\publish-update.ps1 [OPTIONS]

Options:
  -Channel      Release channel (dev, beta, stable). Default: dev
  -Component    Build only specified component(s). Default: all
  -Server       Update server URL. Default: http://localhost:9000
  -Token        Authentication token. Default: dev-token
  -Version      Version to publish. Default: from VERSION file
  -DryRun       Build artifacts but don't upload
  -SkipBuild    Skip build, upload existing artifacts only
  -Help         Show this help

Components:
  qx-node       Node daemon (Rust)
  qx-console    Console TUI (Rust)
  host-ui       Host UI (React)

Examples:
  .\publish-update.ps1                              # Build all, publish to dev
  .\publish-update.ps1 -Channel beta -Version 0.0.5 # Publish to beta
  .\publish-update.ps1 -Component host-ui -DryRun   # Build host-ui only

Note: Rust components require cross-compilation for Linux. Consider using WSL or Docker.
"@
}

if ($Help) {
    Show-Usage
    exit 0
}

# Default to all components
if ($Component.Count -eq 0) {
    $Component = @("qx-node", "qx-console", "host-ui")
}

# Header
Write-Host ""
Write-Host "======================================================================" -ForegroundColor Blue
Write-Host "              Quantix-OS Update Publisher                             " -ForegroundColor Blue
Write-Host "======================================================================" -ForegroundColor Blue
Write-Host ""
Write-Info "Version:     $Version"
Write-Info "Channel:     $Channel"
Write-Info "Server:      $Server"
Write-Info "Components:  $($Component -join ', ')"
Write-Info "Dry run:     $DryRun"
Write-Info "Skip build:  $SkipBuild"
Write-Host ""

# Prepare staging directory
if (Test-Path $StagingDir) {
    Remove-Item -Recurse -Force $StagingDir
}
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null

$Artifacts = @{}

# =============================================================================
# Build Components
# =============================================================================

if (-not $SkipBuild) {
    Write-Step "Building components..."
    
    foreach ($comp in $Component) {
        switch ($comp) {
            "qx-node" {
                Write-Info "Building qx-node (Rust)..."
                Write-Warn "Rust cross-compilation to Linux not available on Windows."
                Write-Warn "Using WSL or Docker is recommended for building Linux binaries."
                
                # Try WSL if available
                $wslAvailable = Get-Command wsl -ErrorAction SilentlyContinue
                if ($wslAvailable) {
                    Write-Info "WSL detected, building via WSL..."
                    $wslPath = ($ProjectRoot -replace '\\', '/') -replace '^([A-Za-z]):', '/mnt/$1'.ToLower()
                    wsl bash -c "cd '$wslPath/agent' && cargo build --release -p limiquantix-node 2>&1 | tail -10"
                    
                    # Package
                    $binary = "$ProjectRoot\agent\target\release\limiquantix-node"
                    if (Test-Path $binary) {
                        Write-Info "Packaging qx-node..."
                        wsl bash -c "cd '$wslPath/agent/target/release' && tar -c limiquantix-node | gzip > /tmp/qx-node.tar.gz"
                        wsl bash -c "cp /tmp/qx-node.tar.gz '$wslPath/'"
                        $artifact = Join-Path $StagingDir "qx-node.tar.gz"
                        Move-Item "$ProjectRoot\qx-node.tar.gz" $artifact -Force
                        $Artifacts["qx-node"] = $artifact
                        Write-Info "  Created: qx-node.tar.gz"
                    } else {
                        Write-Warn "qx-node binary not found, skipping..."
                    }
                } else {
                    Write-Warn "WSL not available. Skipping qx-node build."
                    Write-Warn "To build Rust components, use: wsl ./scripts/publish-update.sh"
                }
            }
            
            "qx-console" {
                Write-Info "Building qx-console (Rust TUI)..."
                Write-Warn "Skipping - requires Linux build environment (use WSL)"
            }
            
            "host-ui" {
                Write-Info "Building host-ui (React)..."
                Push-Location (Join-Path $ProjectRoot "quantix-host-ui")
                try {
                    npm install 2>&1 | Out-Null
                    npm run build 2>&1 | Out-Null
                    
                    $distPath = Join-Path $ProjectRoot "quantix-host-ui\dist"
                    if (Test-Path $distPath) {
                        Write-Info "Packaging host-ui..."
                        $artifact = Join-Path $StagingDir "host-ui.tar.gz"
                        
                        # Use tar if available, otherwise create zip
                        $tarAvailable = Get-Command tar -ErrorAction SilentlyContinue
                        if ($tarAvailable) {
                            Push-Location $distPath
                            tar -czf $artifact *
                            Pop-Location
                            $Artifacts["host-ui"] = $artifact
                            Write-Info "  Created: host-ui.tar.gz"
                        } else {
                            # Fallback to zip
                            $zipArtifact = Join-Path $StagingDir "host-ui.zip"
                            Compress-Archive -Path "$distPath\*" -DestinationPath $zipArtifact -Force
                            $Artifacts["host-ui"] = $zipArtifact
                            Write-Info "  Created: host-ui.zip"
                        }
                    } else {
                        Write-Err "Host UI build failed - dist not found!"
                    }
                } finally {
                    Pop-Location
                }
            }
        }
    }
}

# Check if we have any artifacts
if ($Artifacts.Count -eq 0) {
    Write-Err "No artifacts built! Cannot publish."
    Write-Info "For Rust components, try: wsl ./scripts/publish-update.sh --channel $Channel --version $Version"
    exit 1
}

# =============================================================================
# Generate Manifest
# =============================================================================

Write-Step "Generating manifest..."

$ReleaseDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$Components = @()
foreach ($comp in $Artifacts.Keys) {
    $artifactPath = $Artifacts[$comp]
    $artifactName = Split-Path -Leaf $artifactPath
    $artifactSize = (Get-Item $artifactPath).Length
    $artifactHash = (Get-FileHash $artifactPath -Algorithm SHA256).Hash.ToLower()
    
    $installPath = switch ($comp) {
        "qx-node" { "/data/bin/qx-node" }
        "qx-console" { "/data/bin/qx-console" }
        "host-ui" { "/data/share/quantix-host-ui" }
    }
    
    $restartService = switch ($comp) {
        "qx-node" { "quantix-node" }
        "qx-console" { "quantix-console" }
        "host-ui" { $null }
    }
    
    $Components += @{
        name = $comp
        version = $Version
        artifact = $artifactName
        sha256 = $artifactHash
        size_bytes = $artifactSize
        install_path = $installPath
        restart_service = $restartService
        backup_before_update = $true
        permissions = "0755"
    }
}

$Manifest = @{
    product = "quantix-os"
    version = $Version
    channel = $Channel
    release_date = $ReleaseDate
    update_type = "component"
    components = $Components
    min_version = "0.0.1"
    release_notes = "Quantix-OS $Version update"
}

$ManifestPath = Join-Path $StagingDir "manifest.json"
$Manifest | ConvertTo-Json -Depth 10 | Set-Content $ManifestPath -Encoding UTF8

Write-Info "Manifest generated: $ManifestPath"

# =============================================================================
# Publish
# =============================================================================

if ($DryRun) {
    Write-Warn "Dry run - skipping upload"
    Write-Info "Artifacts staged in: $StagingDir"
    Write-Host ""
    Write-Host "Manifest contents:"
    Get-Content $ManifestPath
    exit 0
}

Write-Step "Publishing to $Server..."

# Build multipart form
$boundary = [System.Guid]::NewGuid().ToString()
$LF = "`r`n"

$bodyLines = @()

# Add manifest
$manifestContent = Get-Content $ManifestPath -Raw
$bodyLines += "--$boundary"
$bodyLines += "Content-Disposition: form-data; name=`"manifest`"; filename=`"manifest.json`""
$bodyLines += "Content-Type: application/json"
$bodyLines += ""
$bodyLines += $manifestContent

# Add artifacts
foreach ($comp in $Artifacts.Keys) {
    $artifactPath = $Artifacts[$comp]
    $artifactName = Split-Path -Leaf $artifactPath
    $artifactBytes = [System.IO.File]::ReadAllBytes($artifactPath)
    $artifactBase64 = [Convert]::ToBase64String($artifactBytes)
    
    $bodyLines += "--$boundary"
    $bodyLines += "Content-Disposition: form-data; name=`"$artifactName`"; filename=`"$artifactName`""
    $bodyLines += "Content-Type: application/octet-stream"
    $bodyLines += "Content-Transfer-Encoding: base64"
    $bodyLines += ""
    $bodyLines += $artifactBase64
}

$bodyLines += "--$boundary--"
$body = $bodyLines -join $LF

try {
    $response = Invoke-RestMethod -Uri "$Server/api/v1/quantix-os/publish" `
        -Method POST `
        -Headers @{ "Authorization" = "Bearer $Token" } `
        -ContentType "multipart/form-data; boundary=$boundary" `
        -Body $body
    
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host "                    Publish Complete!                                 " -ForegroundColor Green
    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host "  Version: $Version" -ForegroundColor Green
    Write-Host "  Channel: $Channel" -ForegroundColor Green
    Write-Host "  Server:  $Server" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Hosts can now update via Settings -> Updates" -ForegroundColor Green
    Write-Host "======================================================================" -ForegroundColor Green
} catch {
    Write-Err "Upload failed: $_"
    exit 1
}

# Cleanup
Remove-Item -Recurse -Force $StagingDir -ErrorAction SilentlyContinue
