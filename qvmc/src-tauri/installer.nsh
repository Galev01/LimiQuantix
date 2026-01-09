; qvmc NSIS Installer Script Hooks
; This file adds custom registry entries for the qvmc:// protocol handler

!macro customInstall
  ; Register qvmc:// protocol handler
  WriteRegStr HKCU "SOFTWARE\Classes\qvmc" "" "URL:qvmc Protocol"
  WriteRegStr HKCU "SOFTWARE\Classes\qvmc" "URL Protocol" ""
  WriteRegStr HKCU "SOFTWARE\Classes\qvmc\shell\open\command" "" '"$INSTDIR\qvmc.exe" "%1"'
  
  ; Add application capabilities
  WriteRegStr HKCU "SOFTWARE\qvmc" "" ""
  WriteRegStr HKCU "SOFTWARE\qvmc\Capabilities" "ApplicationDescription" "Quantix Virtual Machine Remote Console"
  WriteRegStr HKCU "SOFTWARE\qvmc\Capabilities" "ApplicationName" "qvmc"
  WriteRegStr HKCU "SOFTWARE\qvmc\Capabilities\UrlAssociations" "qvmc" "qvmc"
  
  ; Register with Windows app list
  WriteRegStr HKCU "SOFTWARE\RegisteredApplications" "qvmc" "SOFTWARE\qvmc\Capabilities"
!macroend

!macro customUnInstall
  ; Remove qvmc:// protocol handler
  DeleteRegKey HKCU "SOFTWARE\Classes\qvmc"
  
  ; Remove application capabilities
  DeleteRegKey HKCU "SOFTWARE\qvmc"
  
  ; Remove from Windows app list
  DeleteRegValue HKCU "SOFTWARE\RegisteredApplications" "qvmc"
!macroend
