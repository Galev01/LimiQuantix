# =============================================================================
# Quantix Update Server - Start Script (Windows)
# =============================================================================
# Starts the Update Server Admin UI locally via Docker
#
# Usage:
#   .\start.ps1           # Start in foreground
#   .\start.ps1 -d        # Start detached (background)
#   .\start.ps1 -build    # Rebuild and start
# =============================================================================

param(
    [switch]$d,
    [switch]$build,
    [switch]$stop,
    [switch]$logs
)

# Change to script directory
Push-Location $PSScriptRoot

try {
    if ($stop) {
        Write-Host "Stopping Update Server..." -ForegroundColor Yellow
        docker-compose down
        exit 0
    }

    if ($logs) {
        Write-Host "Showing logs..." -ForegroundColor Yellow
        docker-compose logs -f
        exit 0
    }

    # Check if Docker is running (suppress stderr warnings)
    $null = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Docker is not running. Please start Docker Desktop first." -ForegroundColor Red
        exit 1
    }

    if ($build) {
        Write-Host "Building Update Server..." -ForegroundColor Cyan
        docker-compose build
    }

    if ($d) {
        Write-Host "Starting Update Server (detached)..." -ForegroundColor Green
        docker-compose up -d
        Write-Host ""
        Write-Host "Update Server is running!" -ForegroundColor Green
        Write-Host "Admin UI: http://localhost:9000" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Commands:" -ForegroundColor Yellow
        Write-Host "  .\start.ps1 -logs    View logs"
        Write-Host "  .\start.ps1 -stop    Stop server"
    } else {
        Write-Host "Starting Update Server..." -ForegroundColor Green
        Write-Host "Admin UI will be available at: http://localhost:9000" -ForegroundColor Cyan
        Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
        Write-Host ""
        docker-compose up
    }
} finally {
    Pop-Location
}
