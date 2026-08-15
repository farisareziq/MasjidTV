# Stops the MasjidTV server and kiosk Edge window, and removes the
# scheduled task. Only kills processes that belong to MasjidTV.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$TaskName = 'MasjidTV Kiosk'

# 1. Remove the scheduled task
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "[uninstall] Scheduled task removed."
} else {
  Write-Output "[uninstall] No scheduled task found."
}

# 2. Stop the MasjidTV server (matched by its own script path or binary)
$serverProcs = Get-CimInstance Win32_Process |
  Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'masjidtv.exe') -and $_.CommandLine -like "*$Root*" }
foreach ($p in $serverProcs) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  Write-Output "[uninstall] Stopped server process $($p.ProcessId)."
}

# 3. Stop the kiosk Edge window (matched by the display URL, never all Edge)
$edgeProcs = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*/display*' -and $_.CommandLine -like "*localhost*" }
foreach ($p in $edgeProcs) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  Write-Output "[uninstall] Stopped kiosk Edge process $($p.ProcessId)."
}

Write-Output "[uninstall] Done."
