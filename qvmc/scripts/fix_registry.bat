@echo off
set "EXE_PATH=c:\Users\GalLe\Cursor projects\Quantix-KVM\LimiQuantix\qvmc\src-tauri\target\release\qvmc.exe"

echo Registering qvmc protocol...
reg add "HKCU\Software\Classes\qvmc" /ve /d "URL:qvmc Protocol" /f
if %errorlevel% neq 0 echo Failed to add root key & exit /b 1

reg add "HKCU\Software\Classes\qvmc" /v "URL Protocol" /d "" /f
if %errorlevel% neq 0 echo Failed to add URL Protocol value & exit /b 1

reg add "HKCU\Software\Classes\qvmc\DefaultIcon" /ve /d "\"%EXE_PATH%\",0" /f
if %errorlevel% neq 0 echo Failed to add DefaultIcon & exit /b 1

reg add "HKCU\Software\Classes\qvmc\shell\open\command" /ve /d "\"%EXE_PATH%\" \"%%1\"" /f
if %errorlevel% neq 0 echo Failed to add command & exit /b 1

echo Registration successful!
