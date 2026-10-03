#Requires -RunAsAdministrator
<#
  Office-PC setup for Distribuili (run ONCE as Administrator).
  Makes reboots fully hands-free:
    1. Auto-logon  → Windows logs the shop account in by itself after reboot
    2. No sleep/hibernate on AC power → the server never naps mid-day
    3. The Distribuili app itself auto-starts on login + stays in the tray
       (built into the EXE since v0.1.0+).

  SAFER ALTERNATIVE for the password part: Microsoft Sysinternals Autologon
  (encrypts the password with LSA instead of registry plaintext):
    https://learn.microsoft.com/sysinternals/downloads/autologon
#>

$ErrorActionPreference = "Stop"

# --- 0. Must run elevated ---
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Run this script as Administrator (right-click > Run as administrator)." -ForegroundColor Red
  exit 1
}

# --- 1. Auto-logon for the current user ---
$username = $env:USERNAME
$secure = Read-Host "Windows password for $username (for automatic logon after reboot)" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
)
if (-not $plain) { Write-Host "Empty password — cancelled." -ForegroundColor Yellow; exit 1 }

$wl = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
Set-ItemProperty -Path $wl -Name "AutoAdminLogon" -Value "1" -Type String
Set-ItemProperty -Path $wl -Name "DefaultUserName" -Value $username -Type String
Set-ItemProperty -Path $wl -Name "DefaultPassword" -Value $plain -Type String
Set-ItemProperty -Path $wl -Name "DefaultDomainName" -Value $env:COMPUTERNAME -Type String -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $wl -Name "AutoLogonCount" -ErrorAction SilentlyContinue
Write-Host "[ok] auto-logon enabled for $username" -ForegroundColor Green

# --- 2. Never sleep on AC power (a sleeping PC = dead server) ---
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
powercfg /hibernate off 2>$null | Out-Null
Write-Host "[ok] sleep/hibernate disabled on AC power" -ForegroundColor Green

# --- 3. Reminder ---
Write-Host ""
Write-Host "Done. After any reboot: Windows logs in by itself, Distribuili" -ForegroundColor Green
Write-Host "starts by itself (tray icon), server comes back on the SAME port." -ForegroundColor Green
Write-Host "Phones keep working with their saved address — nobody touches anything." -ForegroundColor Green
