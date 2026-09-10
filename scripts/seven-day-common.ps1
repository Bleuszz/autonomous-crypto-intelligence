$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $RepoRoot 'infra\docker-compose.yml'
$RuntimeDir = Join-Path $RepoRoot 'runtime'
$EnvFile = Join-Path $RuntimeDir 'seven-day.env'
$PublicUrlFile = Join-Path $RuntimeDir 'CURRENT_PUBLIC_URL.txt'
$RecoveryLog = Join-Path $RuntimeDir 'recovery.log'

function Write-RecoveryLog([string]$Message) {
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  Add-Content -LiteralPath $RecoveryLog -Value "$(Get-Date -Format o) $Message"
}

function Import-SevenDayEnv {
  if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Missing $EnvFile" }
  Get-Content -LiteralPath $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2], 'Process')
    }
  }
}

function Get-BasicAuthHeader {
  $pair = "$env:DASHBOARD_USERNAME`:$env:DASHBOARD_PASSWORD"
  return @{ Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair)))" }
}

function Wait-Docker([int]$TimeoutSeconds = 300) {
  $desktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  if (-not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $desktop)) {
    Start-Process -FilePath $desktop -WindowStyle Hidden
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)
  throw 'Docker did not become available before the timeout.'
}

function Wait-Url([string]$Url, [hashtable]$Headers, [int]$TimeoutSeconds = 300) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -Headers $Headers -UseBasicParsing -TimeoutSec 15
      if ($response.StatusCode -eq 200) { return }
    } catch { Start-Sleep -Seconds 5 }
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Url"
}

function Update-PublicUrl([int]$TimeoutSeconds = 180) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $logs = docker compose -f $ComposeFile logs --no-color cloudflared 2>$null
    $match = [regex]::Match(($logs -join "`n"), 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($match.Success) {
      return $match.Value
    }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)
  throw 'Cloudflare Quick Tunnel URL was not found in container logs.'
}
