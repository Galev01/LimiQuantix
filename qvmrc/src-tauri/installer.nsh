; QVMRC NSIS Installer Script Hooks
; This file adds custom registry entries for the qvmrc:// protocol handler

!macro customInstall
  ; Register qvmrc:// protocol handler
  WriteRegStr HKCU "SOFTWARE\Classes\qvmrc" "" "URL:QVMRC Protocol"
  WriteRegStr HKCU "SOFTWARE\Classes\qvmrc" "URL Protocol" ""
  WriteRegStr HKCU "SOFTWARE\Classes\qvmrc\shell\open\command" "" '"$INSTDIR\QVMRC.exe" "%1"'
  
  ; Add application capabilities
  WriteRegStr HKCU "SOFTWARE\QVMRC" "" ""
  WriteRegStr HKCU "SOFTWARE\QVMRC\Capabilities" "ApplicationDescription" "Quantix Virtual Machine Remote Console"
  WriteRegStr HKCU "SOFTWARE\QVMRC\Capabilities" "ApplicationName" "QVMRC"
  WriteRegStr HKCU "SOFTWARE\QVMRC\Capabilities\UrlAssociations" "qvmrc" "qvmrc"
  
  ; Register with Windows app list
  WriteRegStr HKCU "SOFTWARE\RegisteredApplications" "QVMRC" "SOFTWARE\QVMRC\Capabilities"
!macroend

!macro customUnInstall
  ; Remove qvmrc:// protocol handler
  DeleteRegKey HKCU "SOFTWARE\Classes\qvmrc"
  
  ; Remove application capabilities
  DeleteRegKey HKCU "SOFTWARE\QVMRC"
  
  ; Remove from Windows app list
  DeleteRegValue HKCU "SOFTWARE\RegisteredApplications" "QVMRC"
!macroend
