!include "LogicLib.nsh"

# Distribuili always-on setup (runs elevated: perMachine installer).
# Password-less machine setup only — the Windows password (needed for
# auto-logon) is collected later by the app itself via an elevated helper,
# which is far more robust than an NSIS custom page.

!define DISTRIBUILI_STOP_SCRIPT "${__FILEDIR__}/stop-distribuili-server.ps1"

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    # Electron Builder expands customHeader before its install section.
    # Run only when installation starts, before the old uninstaller or extraction.
    Section "-Stop previous Distribuili server"
      ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
      ReadRegStr $1 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
      ${If} $0 == ""
      ${AndIf} $1 == ""
      ${AndIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ${AndIfNot} ${FileExists} "$INSTDIR\resources\client\bin\cloudflared.exe"
        Goto stopDistribuiliDone
      ${EndIf}

      InitPluginsDir
      File "/oname=$PLUGINSDIR\stop-distribuili-server.ps1" "${DISTRIBUILI_STOP_SCRIPT}"
      System::Call 'kernel32::SetEnvironmentVariableW(w "DISTRIBUILI_INSTALL_MACHINE", w r0)'
      System::Call 'kernel32::SetEnvironmentVariableW(w "DISTRIBUILI_INSTALL_USER", w r1)'
      System::Call 'kernel32::SetEnvironmentVariableW(w "DISTRIBUILI_INSTALL_TARGET", w "$INSTDIR")'
      System::Call 'kernel32::SetEnvironmentVariableW(w "DISTRIBUILI_INSTALL_EXE", w "${APP_EXECUTABLE_FILENAME}")'

      DetailPrint "Stopping the previous Distribuili server..."
      nsExec::ExecToLog /TIMEOUT=30000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-distribuili-server.ps1"'
      Pop $0
      ${If} $0 != "0"
        DetailPrint "Could not stop the previous Distribuili server (result: $0)."
        MessageBox MB_OK|MB_ICONSTOP "Setup could not stop the previous Distribuili server. Restart Windows and run setup again." /SD IDOK
        SetErrorLevel 1
        Quit
      ${EndIf}
    stopDistribuiliDone:
    SectionEnd
  !endif
!macroend

!macro customInstall
  # Shop server must never nap: no sleep/hibernate on AC power.
  nsExec::ExecToLog 'powercfg /change standby-timeout-ac 0'
  nsExec::ExecToLog 'powercfg /change hibernate-timeout-ac 0'
  # Marker: only OUR keys are ever removed on uninstall.
  WriteRegStr HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" "DistribuiliAutoLogon" "1"
  # LAN reachability: allow the app through Windows Firewall (private + public
  # profiles) so phones/tablets can reach the server. Without this the desktop
  # works on localhost but is "not reachable" from the network, and users
  # blame the installer. Rule name is namespaced for clean removal below.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Distribuili Local"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Distribuili Local" dir=in action=allow program="$INSTDIR\Distribuili Local.exe" enable=yes profile=private,public description="Distribuili shop server (LAN + phones)"'
!macroend

!macro customUnInstall
  # Remove our firewall rule + auto-logon marker (never touch customer setup).
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Distribuili Local"'
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" "DistribuiliAutoLogon"
  ${If} $0 == "1"
    DeleteRegValue HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" "AutoAdminLogon"
    DeleteRegValue HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" "DefaultUserName"
    DeleteRegValue HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" "DefaultDomainName"
    DeleteRegValue HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" "DefaultPassword"
    DeleteRegValue HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" "DistribuiliAutoLogon"
  ${EndIf}
!macroend
