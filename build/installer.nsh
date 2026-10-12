!include "LogicLib.nsh"

# Distribuili always-on setup (runs elevated: perMachine installer).
# Password-less machine setup only — the Windows password (needed for
# auto-logon) is collected later by the app itself via an elevated helper,
# which is far more robust than an NSIS custom page.

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
