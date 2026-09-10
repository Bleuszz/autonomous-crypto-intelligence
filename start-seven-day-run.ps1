[CmdletBinding()]
param([switch]$Build)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\scripts\seven-day-common.ps1"

Write-RecoveryLog 'Seven-day startup requested.'
Import-SevenDayEnv
Wait-Docker
$env:APP_COMMIT = (git -C $RepoRoot rev-parse HEAD).Trim()

$imageExists = docker images -q autonomous-crypto-intelligence-app:latest
if ($Build -or -not $imageExists) {
  docker compose -f $ComposeFile build app
  if ($LASTEXITCODE -ne 0) { throw 'Docker app build failed.' }
}
docker compose -f $ComposeFile up -d
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose startup failed.' }

Wait-Url -Url 'http://127.0.0.1:18080/healthz' -Headers @{}
Wait-Url -Url 'http://127.0.0.1:18080/' -Headers (Get-BasicAuthHeader)
$baseline = Join-Path $RepoRoot 'backups\seven-day-baseline'
if (-not (Test-Path -LiteralPath $baseline)) {
  & "$PSScriptRoot\backup-seven-day-run.ps1" -Baseline
}
$publicUrl = Update-PublicUrl
Wait-Url -Url $publicUrl -Headers (Get-BasicAuthHeader)
Set-Content -LiteralPath $PublicUrlFile -Value $publicUrl
Write-RecoveryLog "Cloudflare URL verified: $publicUrl"
Write-RecoveryLog 'Startup and local/public smoke checks succeeded.'
& "$PSScriptRoot\status-seven-day-run.ps1"
