# qvmc Protocol Handler Registration Script
# Run this script as Administrator to register the qvmc:// protocol handler

param(
    [string]$InstallPath = "$env:LOCALAPPDATA\qvmc"
)

$ExePath = "$InstallPath\qvmc.exe"

# Check if qvmc is installed
if (-not (Test-Path $ExePath)) {
    Write-Host "qvmc not found at: $ExePath" -ForegroundColor Red
    Write-Host "Please provide the correct installation path using -InstallPath parameter" -ForegroundColor Yellow
    Write-Host "Example: .\register-protocol.ps1 -InstallPath 'C:\Program Files\qvmc'" -ForegroundColor Gray
    exit 1
}

Write-Host "Registering qvmc:// protocol handler..." -ForegroundColor Cyan
Write-Host "Executable: $ExePath" -ForegroundColor Gray

try {
    # Register protocol handler in HKCU (current user - no admin required)
    New-Item -Path "HKCU:\SOFTWARE\Classes\qvmc" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\SOFTWARE\Classes\qvmc" -Name "(Default)" -Value "URL:qvmc Protocol"
    Set-ItemProperty -Path "HKCU:\SOFTWARE\Classes\qvmc" -Name "URL Protocol" -Value ""
    
    # Set the default icon
    New-Item -Path "HKCU:\SOFTWARE\Classes\qvmc\DefaultIcon" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\SOFTWARE\Classes\qvmc\DefaultIcon" -Name "(Default)" -Value "`"$ExePath`",0"
    
    # Set the shell open command
    New-Item -Path "HKCU:\SOFTWARE\Classes\qvmc\shell\open\command" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\SOFTWARE\Classes\qvmc\shell\open\command" -Name "(Default)" -Value "`"$ExePath`" `"%1`""
    
    Write-Host ""
    Write-Host "✓ Protocol handler registered successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now use qvmc:// URLs to open qvmc." -ForegroundColor White
    Write-Host "Test by clicking a qvmc://connect?... link in your browser." -ForegroundColor Gray
    
} catch {
    Write-Host "Failed to register protocol handler: $_" -ForegroundColor Red
    exit 1
}
