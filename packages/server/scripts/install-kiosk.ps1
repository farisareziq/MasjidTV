param(
  [switch]$AtStartup,
  [int]$Port = 3000,
  [string]$Screen = ""
)

# ---------------------------------------------------------------------------
# Registers the MasjidTV kiosk as a Windows Scheduled Task so it starts
# automatically when the operator logs on (default) or at system startup.
# Run:  powershell -ExecutionPolicy Bypass -File .\packages\server\scripts\install-kiosk.ps1
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
$TaskName = 'MasjidTV Kiosk'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Launcher = Join-Path $Root 'packages\server\scripts\start-kiosk.ps1'

$argLine = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Launcher`" -Port $Port"
if ($Screen) { $argLine += " -Screen `"$Screen`"" }

$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argLine

if ($AtStartup) {
  $Trigger = New-ScheduledTaskTrigger -AtStartup
  Write-Output "[install] Kiosk will start at system startup."
} else {
  $Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  Write-Output "[install] Kiosk will start when $env:USERNAME logs on."
}

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

try {
  Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
  Write-Output "[install] Scheduled task '$TaskName' registered."
  Write-Output "[install] Start it now with:  Start-ScheduledTask -TaskName '$TaskName'"
} catch {
  Write-Error "Failed to register scheduled task. Try running PowerShell as Administrator. Details: $($_.Exception.Message)"
}
