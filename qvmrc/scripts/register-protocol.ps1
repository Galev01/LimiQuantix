# QVMRC Protocol Handler Registration Script
# Run this script as Administrator to register the qvmrc:// protocol handler

param(
    [string]$InstallPath = "$env:LOCALAPPDATA\QVMRC"
)

$ExePath = "$InstallPath\QVMRC.exe"

# Check if QVMRC is installed
if (-not (Test-Path $ExePath)) {
    Write-Host "QVMRC not found at: $ExePath" -ForegroundColor Red
    Write-Host "Please provide the correct installation path using -InstallPath parameter" -ForegroundColor Yellow
    Write-Host "Example: .\register-protocol.ps1 -InstallPath 'C:\Program Files\QVMRC'" -ForegroundColor Gray
    exit 1
}

Write-Host "Registering qvmrc:// protocol handler..." -ForegroundColor Cyan
Write-Host "Executable: $ExePath" -ForegroundColor Gray

try {
    # Register protocol handler in HKCU (current user - no admin required)
    New-Item -Path "HKCU:\SOFTWARE\Classes\qvmrc" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\SOFTWARE\Classes\qvmrc" -Name "(Default)" -Value "URL:QVMRC Protocol"
    Set-ItemProperty -Path "HKCU:\SOFTWARE\Classes\qvmrc" -Name "URL Protocol" -Value ""
    
    # Set the default icon
    New-Item -Path "HKCU:\SOFTWARE\Classes\qvmrc\DefaultIcon" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\SOFTWARE\Classes\qvmrc\DefaultIcon" -Name "(Default)" -Value "`"$ExePath`",0"
    
    # Set the shell open command
    New-Item -Path "HKCU:\SOFTWARE\Classes\qvmrc\shell\open\command" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\SOFTWARE\Classes\qvmrc\shell\open\command" -Name "(Default)" -Value "`"$ExePath`" `"%1`""
    
    Write-Host ""
    Write-Host "✓ Protocol handler registered successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now use qvmrc:// URLs to open QVMRC." -ForegroundColor White
    Write-Host "Test by clicking a qvmrc://connect?... link in your browser." -ForegroundColor Gray
    
} catch {
    Write-Host "Failed to register protocol handler: $_" -ForegroundColor Red
    exit 1
}
