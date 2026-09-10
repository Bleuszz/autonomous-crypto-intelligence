$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\scripts\seven-day-common.ps1"
try {
  Import-SevenDayEnv
  Wait-Docker -TimeoutSeconds 180
  $unhealthy = docker compose -f $ComposeFile ps --status running --services
  if ($unhealthy -notcontains 'postgres' -or $unhealthy -notcontains 'app' -or $unhealthy -notcontains 'engine' -or $unhealthy -notcontains 'cloudflared') {
    Write-RecoveryLog 'Watchdog found a stopped service; invoking idempotent startup.'
    & "$PSScriptRoot\start-seven-day-run.ps1"
    exit
  }
  try { Invoke-WebRequest 'http://127.0.0.1:18080/engine-healthz' -UseBasicParsing -TimeoutSec 15 | Out-Null }
  catch {
    Write-RecoveryLog 'Watchdog found a stale engine; restarting app once.'
    docker compose -f $ComposeFile restart app
  }
  $publicUrl = Update-PublicUrl -TimeoutSeconds 30
  Wait-Url -Url $publicUrl -Headers (Get-BasicAuthHeader) -TimeoutSeconds 30
  Set-Content -LiteralPath $PublicUrlFile -Value $publicUrl
  Write-RecoveryLog 'Watchdog check OK.'
} catch {
  Write-RecoveryLog "Watchdog FAILED: $($_.Exception.Message)"
  exit 1
}
