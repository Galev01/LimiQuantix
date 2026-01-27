; =============================================================================
; Quantix KVM Guest Agent Inno Setup Script
; =============================================================================
; Alternative to MSI installer for users who prefer EXE installers.
;
; Build Requirements:
;   - Inno Setup 6.x (https://jrsoftware.org/isinfo.php)
;   - Run: iscc setup.iss
;
; Usage:
;   quantix-kvm-agent-setup.exe /SILENT /LOG="install.log"
; =============================================================================

#define MyAppName "Quantix KVM Guest Agent"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Quantix KVM"
#define MyAppURL "https://github.com/Quantix-KVM/LimiQuantix"
#define MyAppExeName "quantix-kvm-agent.exe"
#define MyServiceName "QuantixKVMAgent"

[Setup]
; Application info
AppId={{550E8400-E29B-41D4-A716-446655440001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases

; Installation settings
DefaultDirName={autopf}\Quantix-KVM\Agent
DefaultGroupName=Quantix-KVM
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

; Output settings
OutputDir=..\output
OutputBaseFilename=quantix-kvm-agent-{#MyAppVersion}-setup
Compression=lzma2
SolidCompression=yes

; UI settings
WizardStyle=modern
SetupIconFile=..\wix\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}

; Versioning
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=Quantix KVM Guest Agent Installer
VersionInfoCopyright=Copyright (C) 2024-2026 Quantix KVM

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Main executable
Source: "..\wix\quantix-kvm-agent.exe"; DestDir: "{app}"; Flags: ignoreversion

; Configuration file
Source: "..\wix\config.yaml.template"; DestDir: "{commonappdata}\Quantix-KVM"; DestName: "agent.yaml"; Flags: onlyifdoesntexist

[Dirs]
; Create data directories
Name: "{commonappdata}\Quantix-KVM"
Name: "{commonappdata}\Quantix-KVM\Logs"
Name: "{commonappdata}\Quantix-KVM\pre-freeze.d"
Name: "{commonappdata}\Quantix-KVM\post-thaw.d"

[Run]
; Install and start the service
Filename: "sc.exe"; Parameters: "create {#MyServiceName} binPath= ""{app}\{#MyAppExeName}"" start= auto DisplayName= ""{#MyAppName}"""; Flags: runhidden waituntilterminated
Filename: "sc.exe"; Parameters: "description {#MyServiceName} ""Provides VM integration for Quantix KVM hypervisor"""; Flags: runhidden waituntilterminated
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
    MsgBox('Quantix KVM Guest Agent has been installed and started.' + #13#10 + #13#10 +
           'Configuration: ' + ExpandConstant('{commonappdata}') + '\Quantix-KVM\agent.yaml' + #13#10 +
           'Logs: ' + ExpandConstant('{commonappdata}') + '\Quantix-KVM\Logs\agent.log' + #13#10 + #13#10 +
           'To check status: sc query {#MyServiceName}',
           mbInformation, MB_OK);
  end;
end;
