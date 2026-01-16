# =============================================================================
# Quantix-vDC Update Publisher (PowerShell)
# =============================================================================
# Builds and publishes Quantix-vDC (Control Plane) updates to the update server.
#
# Usage:
#   .\publish-vdc-update.ps1                         # Build all and publish to dev
#   .\publish-vdc-update.ps1 -Channel beta           # Publish to beta channel
#   .\publish-vdc-update.ps1 -Component dashboard    # Build only dashboard
#   .\publish-vdc-update.ps1 -DryRun                 # Build but don't upload
#
# Components:
#   controlplane  - Go backend server
#   dashboard     - React frontend
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
    $VersionFile = Join-Path $ProjectRoot "Quantix-vDC\VERSION"
    if (Test-Path $VersionFile) {
        $Version = (Get-Content $VersionFile -Raw).Trim()
    } else {
        # Try backend version
        $goMod = Join-Path $ProjectRoot "backend\go.mod"
        if (Test-Path $goMod) {
            # Default version if not found
            $Version = "0.0.1"
        }
    }
}

# Staging directory
$StagingDir = Join-Path $env:TEMP "quantix-vdc-update-staging"

# Colors
function Write-Info { Write-Host "[INFO] $args" -ForegroundColor Green }
function Write-Warn { Write-Host "[WARN] $args" -ForegroundColor Yellow }
function Write-Err { Write-Host "[ERROR] $args" -ForegroundColor Red }
function Write-Step { Write-Host "[STEP] $args" -ForegroundColor Cyan }

function Show-Usage {
    @"
Quantix-vDC Update Publisher

Usage: .\publish-vdc-update.ps1 [OPTIONS]

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
  controlplane  Go backend server (requires Go)
  dashboard     React frontend (requires Node.js)

Examples:
  .\publish-vdc-update.ps1                              # Build all, publish to dev
  .\publish-vdc-update.ps1 -Channel beta -Version 0.0.5 # Publish to beta
  .\publish-vdc-update.ps1 -Component dashboard -DryRun # Build dashboard only

Note: Control plane requires cross-compilation for Linux. Use -GOOS=linux -GOARCH=amd64.
"@
}

if ($Help) {
    Show-Usage
    exit 0
}

# Default to all components
if ($Component.Count -eq 0) {
    $Component = @("controlplane", "dashboard")
}

# Header
Write-Host ""
Write-Host "======================================================================" -ForegroundColor Magenta
Write-Host "              Quantix-vDC Update Publisher                            " -ForegroundColor Magenta
Write-Host "======================================================================" -ForegroundColor Magenta
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
            "controlplane" {
                Write-Info "Building controlplane (Go)..."
                
                $backendDir = Join-Path $ProjectRoot "backend"
                if (-not (Test-Path $backendDir)) {
                    Write-Err "Backend directory not found: $backendDir"
                    continue
                }
                
                Push-Location $backendDir
                try {
                    # Check if Go is available
                    $goAvailable = Get-Command go -ErrorAction SilentlyContinue
                    if (-not $goAvailable) {
                        Write-Err "Go is not installed. Please install Go 1.22+."
                        continue
                    }
                    
                    # Build for Linux
                    Write-Info "Cross-compiling for Linux amd64..."
                    $env:GOOS = "linux"
                    $env:GOARCH = "amd64"
                    $env:CGO_ENABLED = "0"
                    
                    $outputPath = Join-Path $StagingDir "quantix-controlplane"
                    go build -ldflags="-w -s -X main.Version=$Version" -o $outputPath ./cmd/server
                    
                    # Reset env
                    Remove-Item Env:GOOS -ErrorAction SilentlyContinue
                    Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
                    Remove-Item Env:CGO_ENABLED -ErrorAction SilentlyContinue
                    
                    if (Test-Path $outputPath) {
                        Write-Info "Packaging controlplane..."
                        $artifact = Join-Path $StagingDir "controlplane.tar.gz"
                        
                        Push-Location $StagingDir
                        tar -czf "controlplane.tar.gz" "quantix-controlplane"
                        Remove-Item "quantix-controlplane" -Force
                        Pop-Location
                        
                        $Artifacts["controlplane"] = $artifact
                        $size = [math]::Round((Get-Item $artifact).Length / 1MB, 2)
                        Write-Info "  Created: controlplane.tar.gz (${size}MB)"
                    } else {
                        Write-Err "Build failed - binary not created!"
                    }
                } catch {
                    Write-Err "Build failed: $_"
                } finally {
                    Pop-Location
                }
            }
            
            "dashboard" {
                Write-Info "Building dashboard (React)..."
                
                $frontendDir = Join-Path $ProjectRoot "frontend"
                if (-not (Test-Path $frontendDir)) {
                    Write-Err "Frontend directory not found: $frontendDir"
                    continue
                }
                
                Push-Location $frontendDir
                try {
                    # Check if npm is available
                    $npmAvailable = Get-Command npm -ErrorAction SilentlyContinue
                    if (-not $npmAvailable) {
                        Write-Err "npm is not installed. Please install Node.js."
                        continue
                    }
                    
                    Write-Info "Installing dependencies..."
                    npm install 2>&1 | Out-Null
                    
                    Write-Info "Building production bundle..."
                    npm run build 2>&1 | Out-Null
                    
                    $distPath = Join-Path $frontendDir "dist"
                    if (Test-Path $distPath) {
                        Write-Info "Packaging dashboard..."
                        $artifact = Join-Path $StagingDir "dashboard.tar.gz"
                        
                        Push-Location $distPath
                        tar -czf $artifact *
                        Pop-Location
                        
                        $Artifacts["dashboard"] = $artifact
                        $size = [math]::Round((Get-Item $artifact).Length / 1MB, 2)
                        Write-Info "  Created: dashboard.tar.gz (${size}MB)"
                    } else {
                        Write-Err "Build failed - dist directory not found!"
                    }
                } catch {
                    Write-Err "Build failed: $_"
                } finally {
                    Pop-Location
                }
            }
            
            default {
                Write-Warn "Unknown component: $comp"
            }
        }
    }
}

# Check if we have any artifacts
if ($Artifacts.Count -eq 0) {
    Write-Err "No artifacts built! Cannot publish."
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
        "controlplane" { "/usr/bin/quantix-controlplane" }
        "dashboard" { "/usr/share/quantix-vdc/dashboard" }
    }
    
    $restartService = switch ($comp) {
        "controlplane" { "quantix-controlplane" }
        "dashboard" { $null }
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
        requires_db_migration = ($comp -eq "controlplane")
    }
}

$Manifest = @{
    product = "quantix-vdc"
    version = $Version
    channel = $Channel
    release_date = $ReleaseDate
    update_type = "component"
    components = $Components
    min_version = "0.0.1"
    release_notes = "Quantix-vDC $Version update"
    requires_maintenance_window = $true
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

# Build multipart form using curl (more reliable for file uploads)
$curlAvailable = Get-Command curl.exe -ErrorAction SilentlyContinue
if ($curlAvailable) {
    $curlArgs = @(
        "-X", "POST",
        "-H", "Authorization: Bearer $Token",
        "-F", "manifest=@$ManifestPath"
    )
    
    foreach ($comp in $Artifacts.Keys) {
        $artifactPath = $Artifacts[$comp]
        $artifactName = Split-Path -Leaf $artifactPath
        $curlArgs += "-F"
        $curlArgs += "$artifactName=@$artifactPath"
    }
    
    $curlArgs += "$Server/api/v1/quantix-vdc/publish"
    
    $result = & curl.exe @curlArgs 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "======================================================================" -ForegroundColor Magenta
        Write-Host "                    Publish Complete!                                 " -ForegroundColor Magenta
        Write-Host "======================================================================" -ForegroundColor Magenta
        Write-Host "  Product: Quantix-vDC" -ForegroundColor Magenta
        Write-Host "  Version: $Version" -ForegroundColor Magenta
        Write-Host "  Channel: $Channel" -ForegroundColor Magenta
        Write-Host "  Server:  $Server" -ForegroundColor Magenta
        Write-Host ""
        Write-Host "  Components published:" -ForegroundColor Magenta
        foreach ($comp in $Artifacts.Keys) {
            Write-Host "    - $comp" -ForegroundColor Magenta
        }
        Write-Host "======================================================================" -ForegroundColor Magenta
    } else {
        Write-Err "Upload failed!"
        Write-Host $result
        exit 1
    }
} else {
    Write-Err "curl not found. Please install curl or use WSL."
    exit 1
}

# Cleanup
Remove-Item -Recurse -Force $StagingDir -ErrorAction SilentlyContinue
