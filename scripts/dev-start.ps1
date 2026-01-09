<#
.SYNOPSIS
    Start the Quantix-KVM local development environment.

.DESCRIPTION
    This script starts all components needed to test Quantix-OS to Quantix-vDC
    communication locally without building ISOs.

    Components started:
    - Docker services (PostgreSQL, etcd, Redis)
    - Go backend (Control Plane) on port 8080
    - Rust node daemon (Quantix-OS) on port 8443
    - React frontend (vDC Dashboard) on port 5173
    - React host UI (Quantix-OS UI) on port 3001

.PARAMETER Component
    Start only a specific component: docker, backend, node, frontend, hostui, all

.PARAMETER Stop
    Stop all running development services

.EXAMPLE
    .\dev-start.ps1
    Start all components

.EXAMPLE
    .\dev-start.ps1 -Component backend
    Start only the Go backend

.EXAMPLE
    .\dev-start.ps1 -Stop
    Stop all services
#>

param(
    [ValidateSet("docker", "backend", "node", "frontend", "hostui", "all")]
    [string]$Component = "all",
    
    [switch]$Stop,
    [switch]$Help
)

# Get project root (parent of scripts directory)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# Colors for output
function Write-Header { 
    param($msg) 
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step { 
    param($msg) 
    Write-Host "[>] $msg" -ForegroundColor Green 
}

function Write-Info { 
    param($msg) 
    Write-Host "    $msg" -ForegroundColor Gray 
}

function Write-Warn { 
    param($msg) 
    Write-Host "[!] $msg" -ForegroundColor Yellow 
}

function Write-Err { 
    param($msg) 
    Write-Host "[X] $msg" -ForegroundColor Red 
}

function Write-Success { 
    param($msg) 
    Write-Host "[OK] $msg" -ForegroundColor Green 
}

if ($Help) {
    Get-Help $PSCommandPath -Detailed
    exit 0
}

Write-Header "Quantix-KVM Local Development Environment"

# Check prerequisites
function Test-Prerequisites {
    Write-Step "Checking prerequisites..."
    
    $missing = @()
    
    # Docker
    if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
        $missing += "Docker (https://docker.com)"
    }
    
    # Go
    if (!(Get-Command go -ErrorAction SilentlyContinue)) {
        $missing += "Go 1.21+ (https://go.dev)"
    }
    
    # Node.js
    if (!(Get-Command node -ErrorAction SilentlyContinue)) {
        $missing += "Node.js 18+ (https://nodejs.org)"
    }
    
    # Rust/Cargo
    if (!(Get-Command cargo -ErrorAction SilentlyContinue)) {
        $missing += "Rust (https://rustup.rs)"
    }
    
    if ($missing.Count -gt 0) {
        Write-Err "Missing prerequisites:"
        $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        exit 1
    }
    
    Write-Success "All prerequisites found"
}

# Start Docker services
function Start-DockerServices {
    Write-Step "Starting Docker services (PostgreSQL, etcd, Redis)..."
    
    Push-Location "$ProjectRoot\backend"
    try {
        # Start services (docker compose handles already running containers)
        $env:DOCKER_CLI_HINTS = "false"
        $output = docker compose up -d 2>&1
        Write-Info "Waiting for services to be healthy..."
        Start-Sleep -Seconds 5
        
        Write-Success "Docker services ready"
        Write-Info "PostgreSQL: localhost:5432"
        Write-Info "etcd:       localhost:2379"
        Write-Info "Redis:      localhost:6379"
    }
    catch {
        Write-Err "Failed to start Docker services: $_"
        Write-Info "Make sure Docker Desktop is running"
    }
    finally {
        Pop-Location
    }
}

# Start Go backend
function Start-Backend {
    Write-Step "Starting Go backend (Control Plane)..."
    
    Push-Location "$ProjectRoot\backend"
    try {
        # Build if needed
        if (!(Test-Path "controlplane.exe")) {
            Write-Info "Building backend..."
            go build -o controlplane.exe ./cmd/controlplane
        }
        
        # Start in background
        $job = Start-Job -ScriptBlock {
            param($path)
            Set-Location $path
            & .\controlplane.exe --dev 2>&1
        } -ArgumentList (Get-Location).Path
        
        Write-Success "Backend started (Job ID: $($job.Id))"
        Write-Info "API:  http://localhost:8080"
        Write-Info "Logs: Receive-Job -Id $($job.Id)"
        
        # Give it a moment to start
        Start-Sleep -Seconds 2
    }
    finally {
        Pop-Location
    }
}

# Start Rust node daemon
function Start-NodeDaemon {
    Write-Step "Starting Rust node daemon (Quantix-OS)..."
    
    Push-Location "$ProjectRoot\agent"
    try {
        # Build if needed (debug for faster builds)
        $binPath = "target\debug\limiquantix-node.exe"
        if (!(Test-Path $binPath)) {
            Write-Info "Building node daemon (this may take a while first time)..."
            cargo build --package limiquantix-node
        }
        
        # Start in background
        $fullBinPath = (Resolve-Path $binPath).Path
        $job = Start-Job -ScriptBlock {
            param($path, $bin)
            Set-Location $path
            & $bin --http-port 8443 --grpc-port 9443 2>&1
        } -ArgumentList (Get-Location).Path, $fullBinPath
        
        Write-Success "Node daemon started (Job ID: $($job.Id))"
        Write-Info "HTTP/REST: https://localhost:8443"
        Write-Info "gRPC:      localhost:9443"
        Write-Info "Logs: Receive-Job -Id $($job.Id)"
        
        Start-Sleep -Seconds 2
    }
    finally {
        Pop-Location
    }
}

# Start frontend (vDC Dashboard)
function Start-Frontend {
    Write-Step "Starting React frontend (vDC Dashboard)..."
    
    Push-Location "$ProjectRoot\frontend"
    try {
        # Install deps if needed
        if (!(Test-Path "node_modules")) {
            Write-Info "Installing dependencies..."
            npm install
        }
        
        # Start dev server in background
        $job = Start-Job -ScriptBlock {
            param($path)
            Set-Location $path
            npm run dev 2>&1
        } -ArgumentList (Get-Location).Path
        
        Write-Success "Frontend started (Job ID: $($job.Id))"
        Write-Info "URL:  http://localhost:5173"
        Write-Info "Logs: Receive-Job -Id $($job.Id)"
    }
    finally {
        Pop-Location
    }
}

# Start host UI (Quantix-OS UI)
function Start-HostUI {
    Write-Step "Starting React host UI (Quantix-OS UI)..."
    
    Push-Location "$ProjectRoot\quantix-host-ui"
    try {
        # Install deps if needed
        if (!(Test-Path "node_modules")) {
            Write-Info "Installing dependencies..."
            npm install
        }
        
        # Start dev server in background
        $job = Start-Job -ScriptBlock {
            param($path)
            Set-Location $path
            npm run dev 2>&1
        } -ArgumentList (Get-Location).Path
        
        Write-Success "Host UI started (Job ID: $($job.Id))"
        Write-Info "URL:  http://localhost:3001"
        Write-Info "Logs: Receive-Job -Id $($job.Id)"
    }
    finally {
        Pop-Location
    }
}

# Stop all services
function Stop-AllServices {
    Write-Step "Stopping all development services..."
    
    # Stop PowerShell background jobs
    Get-Job | Where-Object { $_.State -eq 'Running' } | Stop-Job
    Get-Job | Remove-Job -Force
    
    # Stop Docker services
    Push-Location "$ProjectRoot\backend"
    try {
        docker compose down 2>$null
    }
    catch {}
    finally {
        Pop-Location
    }
    
    Write-Success "All services stopped"
}

# Show status
function Show-Status {
    Write-Header "Development Environment Status"
    
    Write-Step "Background Jobs:"
    Get-Job | Format-Table Id, Name, State, HasMoreData -AutoSize
    
    Write-Step "Docker Services:"
    Push-Location "$ProjectRoot\backend"
    try {
        docker compose ps
    }
    finally {
        Pop-Location
    }
    
    Write-Host ""
    Write-Step "Access URLs:"
    Write-Info "vDC Dashboard:    http://localhost:5173"
    Write-Info "vDC API:          http://localhost:8080"
    Write-Info "Quantix-OS UI:    http://localhost:3001"
    Write-Info "Node Daemon API:  https://localhost:8443"
    Write-Host ""
}

# Main execution
if ($Stop) {
    Stop-AllServices
    exit 0
}

Test-Prerequisites

switch ($Component) {
    "docker" {
        Start-DockerServices
    }
    "backend" {
        Start-Backend
    }
    "node" {
        Start-NodeDaemon
    }
    "frontend" {
        Start-Frontend
    }
    "hostui" {
        Start-HostUI
    }
    "all" {
        Start-DockerServices
        Start-Backend
        Start-NodeDaemon
        Start-Frontend
        Start-HostUI
        Show-Status
    }
}

Write-Header "Development Environment Ready!"
Write-Host @"
Quick Commands:
  View job logs:     Receive-Job -Id <JobId>
  Stop all:          .\dev-start.ps1 -Stop
  Check status:      Get-Job

Testing Host Registration:
  1. Open vDC Dashboard: http://localhost:5173
  2. Go to Hosts -> Add Host
  3. Enter: localhost:8443
  4. The node daemon will register with the control plane

"@ -ForegroundColor Gray
