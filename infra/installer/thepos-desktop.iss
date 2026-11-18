#define MyAppName "ThePOS"
#define MyAppDisplayName "ระบบหน้าร้านสหกรณ์ (ThePOS)"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "ThePOS Cooperative"
#define MyAppExeName "thepos-desktop.exe"

[Setup]
AppId={{8D6B4C2A-9F7E-4B1D-8E5F-2C3A1B0D9E8A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppDisplayName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppDisplayName}
DisableDirPage=no
DisableProgramGroupPage=no
AllowNoIcons=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\..\apps\desktop\src-tauri\target\release\bundle\inno
OutputBaseFilename=ThePOS-Setup-{#MyAppVersion}
SetupIconFile=..\..\apps\desktop\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "resetdata"; Description: "ล้างข้อมูลการเชื่อมต่อเดิม (ตั้งค่าเริ่มต้นใหม่)"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\apps\desktop\src-tauri\target\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\logo.png"; DestDir: "{app}"; Flags: ignoreversion

[InstallDelete]
Type: filesandordirs; Name: "{userappdata}\coop.thepos.desktop"; Tasks: resetdata

[UninstallDelete]
Type: filesandordirs; Name: "{userappdata}\coop.thepos.desktop"
Type: filesandordirs; Name: "{localappdata}\coop.thepos.desktop"

[Icons]
Name: "{group}\{#MyAppDisplayName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\ถอนการติดตั้ง {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppDisplayName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppDisplayName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
