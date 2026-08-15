param(
  [int]$Port = 3000,
  [string]$Screen = "",
  [switch]$NoWatchdog
)

# ---------------------------------------------------------------------------
# MasjidTV kiosk launcher
# Starts the signage server (if not already running) and opens the display in
# Microsoft Edge fullscreen kiosk mode. With the watchdog enabled (default)
# it keeps both processes alive and restarts them if they die.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'

# Normalize PATH: some Windows setups carry duplicate Path/PATH entries that
# break Start-Process (Argument exception "Item has already been added").
if (Test-Path Env:PATH) { Remove-Item Env:PATH -ErrorAction SilentlyContinue }
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$LogDir = Join-Path $Root 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$ServerOut = Join-Path $LogDir 'server.out.log'
$ServerErr = Join-Path $LogDir 'server.err.log'

$NodeExe = (Get-Command node -ErrorAction Stop).Source
$EdgeCandidates = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
)
$EdgeExe = $EdgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $EdgeExe) {
  Write-Error 'Microsoft Edge was not found. MasjidTV kiosk mode requires Edge (installed by default on Windows 10/11).'
}

# Server entry: prefer the single binary (if packaged), else the built JS.
$Binary = Join-Path $Root 'masjidtv.exe'
$ServerEntry = Join-Path $Root 'packages\server\dist\index.js'
$HealthUrl = "http://localhost:$Port/api/health"
$DisplayUrl = "http://localhost:$Port/display"
if ($Screen) {
  $DisplayUrl += "?screen=$([Uri]::EscapeDataString($Screen))"
}

# Resolve the display key from the local SQLite DB (via a helper script) and
# inject it into the kiosk display URL.
try {
  $KeyReader = Join-Path $PSScriptRoot 'read-display-key.cjs'
  if (Test-Path $KeyReader) {
    $key = (& $NodeExe $KeyReader)
    if ($key) {
      $sep = if ($DisplayUrl.Contains('?')) { '&' } else { '?' }
      $DisplayUrl += "${sep}key=$([Uri]::EscapeDataString([string]$key))"
    }
  }
} catch {
  # Display key unavailable — continue without (compat mode).
}

function Test-Server {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 3
    return $r.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Start-Server {
  Write-Output "[kiosk] Starting MasjidTV server on port $Port ..."
  if (Test-Path $Binary) {
    return Start-Process -FilePath $Binary -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $ServerOut -RedirectStandardError $ServerErr
  }
  return Start-Process -FilePath $NodeExe -ArgumentList $ServerEntry `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $ServerOut -RedirectStandardError $ServerErr
}

function Wait-ForServer {
  for ($i = 0; $i -lt 40; $i++) {
    if (Test-Server) { return $true }
    Start-Sleep -Milliseconds 750
  }
  return $false
}

function Start-KioskEdge {
  Write-Output "[kiosk] Opening Edge kiosk -> $DisplayUrl"
  $edgeArgs = @(
    '--kiosk', $DisplayUrl,
    '--edge-kiosk-type=fullscreen',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=TranslateUI,msEdgeFirstRunExperience'
  )
  return Start-Process -FilePath $EdgeExe -ArgumentList $edgeArgs -PassThru -WindowStyle Hidden
}

# ---------------------------------------------------------------------------

$ServerProc = $null
if (Test-Server) {
  Write-Output "[kiosk] Server already running on port $Port."
} else {
  $ServerProc = Start-Server
  if (-not (Wait-ForServer)) {
    Write-Error "Server did not become ready. Check $ServerErr"
  }
}

$EdgeProc = Start-KioskEdge
Write-Output "[kiosk] Kiosk started. Watchdog active: $(-not $NoWatchdog)"

if ($NoWatchdog) { exit 0 }

# Watchdog: verify both processes every 10 seconds and restart as needed.
while ($true) {
  Start-Sleep -Seconds 10

  if (-not (Test-Server)) {
    Write-Output '[kiosk] Server not responding — restarting.'
    if ($ServerProc -and -not $ServerProc.HasExited) {
      Stop-Process -Id $ServerProc.Id -Force -ErrorAction SilentlyContinue
    }
    $ServerProc = Start-Server
    Wait-ForServer | Out-Null
  }

  if (-not $EdgeProc -or $EdgeProc.HasExited) {
    Write-Output '[kiosk] Edge closed — reopening.'
    $EdgeProc = Start-KioskEdge
  }
}
