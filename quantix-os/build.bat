@echo off
REM ============================================================================
REM Quantix-OS Build Script for Windows (Batch wrapper)
REM ============================================================================
REM Simple wrapper that calls the PowerShell build script
REM
REM Usage:
REM   build.bat              - Build ISO
REM   build.bat squashfs     - Build update image only
REM   build.bat clean        - Clean artifacts
REM ============================================================================

setlocal enabledelayedexpansion

echo.
echo ============================================================
echo              QUANTIX-OS BUILD SYSTEM
echo ============================================================
echo.

REM Check if Docker is available
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker not found!
    echo.
    echo Please install Docker Desktop for Windows:
    echo   https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

REM Get the directory of this script
set SCRIPT_DIR=%~dp0

REM Parse arguments
set TARGET=%1
if "%TARGET%"=="" set TARGET=iso

if /i "%TARGET%"=="help" (
    echo USAGE:
    echo   build.bat [target]
    echo.
    echo TARGETS:
    echo   iso       - Build bootable ISO ^(default^)
    echo   squashfs  - Build update image only
    echo   clean     - Remove build artifacts
    echo   help      - Show this help
    echo.
    exit /b 0
)

if /i "%TARGET%"=="clean" (
    echo [INFO] Cleaning build artifacts...
    if exist "%SCRIPT_DIR%output" rmdir /s /q "%SCRIPT_DIR%output"
    docker rmi quantix-os-builder 2>nul
    echo [OK] Clean complete
    exit /b 0
)

REM Run PowerShell script for full build
echo [INFO] Running build with target: %TARGET%
echo.
powershell.exe -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build.ps1" -Target %TARGET%

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

echo.
echo [SUCCESS] Build complete!
pause
