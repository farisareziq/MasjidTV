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

# ---------------------------------------------------------------------------
# Pre-provision ffmpeg (optional but recommended): kalau ffmpeg tiada pada
# sistem, muat turun binaan statik ke folder data MasjidTV supaya stream
# RTSP/RTMP/ONVIF berfungsi tanpa winget/install manual. Pelayan juga buat
# ini secara automatik semasa boot — langkah ini cuma mempercepatkan
# pemasangan pertama.
# ---------------------------------------------------------------------------
$DataDir = Join-Path $env:APPDATA 'MasjidTV'
$FfmpegBin = Join-Path $DataDir 'bin\ffmpeg.exe'
$HasSystemFfmpeg = [bool](Get-Command ffmpeg -ErrorAction SilentlyContinue)
if (-not $HasSystemFfmpeg -and -not (Test-Path $FfmpegBin)) {
  Write-Output '[install] ffmpeg not found — downloading static build (~100MB, one time)...'
  $NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
  if ($NodeExe) {
    & $NodeExe -e "import('./packages/server/dist/ensure-ffmpeg.js').then(m => m.ensureFfmpeg(process.env.APPDATA + '/MasjidTV')).then(r => console.log('[install] ' + r.message))"
  } else {
    Write-Output '[install] node not found — server will auto-download ffmpeg on first boot.'
  }
} elseif ($HasSystemFfmpeg) {
  Write-Output '[install] ffmpeg found on system PATH.'
} else {
  Write-Output '[install] ffmpeg already provisioned at data dir.'
}


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
