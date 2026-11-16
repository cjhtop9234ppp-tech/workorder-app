; 작업지시서 설치 프로그램
; 빌드는 tools\build_installer.py 가 한다 (버전은 app\version.js 에서 가져와 /D 로 넘긴다).

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppName "작업지시서"
#define MyAppExeName "WorkOrder.exe"

[Setup]
AppId={{D147D377-AFCA-4B7C-8CF4-830E6ED7015D}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=자체 배포
DefaultDirName={autopf}\WorkOrder
DefaultGroupName=작업지시서
DisableProgramGroupPage=yes
OutputDir=installer_output
OutputBaseFilename=WorkOrder_Setup_{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면 아이콘 만들기"; GroupDescription: "추가 작업:"

[Files]
Source: "dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "app\*"; DestDir: "{app}\web"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "작업지시서 실행"; Flags: nowait postinstall skipifsilent
