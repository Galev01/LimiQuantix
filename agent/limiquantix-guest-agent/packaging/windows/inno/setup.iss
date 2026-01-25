; =============================================================================
; LimiQuantix Guest Agent Inno Setup Script
; =============================================================================
; Alternative to MSI installer for users who prefer EXE installers.
;
; Build Requirements:
;   - Inno Setup 6.x (https://jrsoftware.org/isinfo.php)
;   - Run: iscc setup.iss
;
; Usage:
;   limiquantix-agent-setup.exe /SILENT /LOG="install.log"
; =============================================================================

#define MyAppName "LimiQuantix Guest Agent"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "LimiQuantix"
#define MyAppURL "https://limiquantix.io"
#define MyAppExeName "limiquantix-agent.exe"
#define MyServiceName "LimiQuantixAgent"

[Setup]
; Application info
AppId={{550E8400-E29B-41D4-A716-446655440001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/support
AppUpdatesURL={#MyAppURL}/downloads

; Installation settings
DefaultDirName={autopf}\LimiQuantix\Agent
DefaultGroupName=LimiQuantix
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

; Output settings
OutputDir=..\output
OutputBaseFilename=limiquantix-agent-{#MyAppVersion}-setup
Compression=lzma2
SolidCompression=yes

; UI settings
WizardStyle=modern
SetupIconFile=..\wix\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}

; Versioning
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=LimiQuantix Guest Agent Installer
VersionInfoCopyright=Copyright (C) 2024-2026 LimiQuantix

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Main executable
Source: "..\wix\limiquantix-agent.exe"; DestDir: "{app}"; Flags: ignoreversion

; Configuration file
Source: "..\wix\config.yaml.template"; DestDir: "{commonappdata}\LimiQuantix"; DestName: "agent.yaml"; Flags: onlyifdoesntexist

[Dirs]
; Create data directories
Name: "{commonappdata}\LimiQuantix"
Name: "{commonappdata}\LimiQuantix\Logs"
Name: "{commonappdata}\LimiQuantix\pre-freeze.d"
Name: "{commonappdata}\LimiQuantix\post-thaw.d"

[Run]
; Install and start the service
Filename: "sc.exe"; Parameters: "create {#MyServiceName} binPath= ""{app}\{#MyAppExeName}"" start= auto DisplayName= ""{#MyAppName}"""; Flags: runhidden waituntilterminated
Filename: "sc.exe"; Parameters: "description {#MyServiceName} ""Provides VM integration for LimiQuantix hypervisor"""; Flags: runhidden waituntilterminated
Filename: "sc.exe"; Parameters: "start {#MyServiceName}"; Flags: runhidden waituntilterminated

[UninstallRun]
; Stop and remove the service
Filename: "sc.exe"; Parameters: "stop {#MyServiceName}"; Flags: runhidden waituntilterminated; RunOnceId: "StopService"
Filename: "sc.exe"; Parameters: "delete {#MyServiceName}"; Flags: runhidden waituntilterminated; RunOnceId: "DeleteService"

[Code]
// Check if service exists and stop it before installation
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  // Stop existing service if running
  Exec('sc.exe', 'stop {#MyServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // Small delay to allow service to stop
  Sleep(2000);
  // Delete existing service
  Exec('sc.exe', 'delete {#MyServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// Show message after installation
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    MsgBox('LimiQuantix Guest Agent has been installed and started.' + #13#10 + #13#10 +
           'Configuration: ' + ExpandConstant('{commonappdata}') + '\LimiQuantix\agent.yaml' + #13#10 +
           'Logs: ' + ExpandConstant('{commonappdata}') + '\LimiQuantix\Logs\agent.log' + #13#10 + #13#10 +
           'To check status: sc query {#MyServiceName}',
           mbInformation, MB_OK);
  end;
end;
