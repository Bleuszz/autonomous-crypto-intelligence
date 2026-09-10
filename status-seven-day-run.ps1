$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\scripts\seven-day-common.ps1"
Import-SevenDayEnv
Wait-Docker -TimeoutSeconds 30

Write-Host '=== CONTAINERS ==='
docker compose -f $ComposeFile ps
Write-Host '=== RESTART POLICIES ==='
docker compose -f $ComposeFile ps -q | ForEach-Object { docker inspect --format '{{.Name}} restart={{.HostConfig.RestartPolicy.Name}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' $_ }
Write-Host '=== HEALTH ==='
try { Invoke-WebRequest 'http://127.0.0.1:18080/healthz' -UseBasicParsing -TimeoutSec 10 | Select-Object StatusCode }
catch { Write-Warning $_.Exception.Message }
try { Invoke-WebRequest 'http://127.0.0.1:18080/engine-healthz' -UseBasicParsing -TimeoutSec 10 | Select-Object StatusCode }
catch { Write-Warning $_.Exception.Message }
Write-Host '=== PUBLIC URL ==='
if (Test-Path -LiteralPath $PublicUrlFile) { Get-Content -LiteralPath $PublicUrlFile } else { Write-Warning 'Not discovered yet.' }
Write-Host '=== DATABASE / EXPERIMENT ==='
docker compose -f $ComposeFile exec -T postgres psql -U aether -d aether -c "select current_database(), pg_size_pretty(pg_database_size(current_database())) as size; select id,started_at,starting_equity_usd,starting_open_positions,starting_completed_trades,starting_resolved_experiences,interruption_count from experiments; select job,status,last_attempt_at,last_success_at from runtime_heartbeats order by job; select equity_usd,cash_usd,realized_pnl_usd from paper_portfolios where id='paper-default';"
Write-Host '=== DISK ==='
$drive = Get-PSDrive -Name ((Split-Path $RepoRoot -Qualifier).TrimEnd(':'))
$freeGb = [math]::Round($drive.Free / 1GB, 2)
Write-Host "Free disk: $freeGb GB"
if ($freeGb -lt 15) { Write-Warning 'Free disk is below the 15 GB safety threshold.' }
Write-Host '=== RECENT ERRORS ==='
docker compose -f $ComposeFile logs --no-color --tail 80 app cloudflared | Select-String -Pattern 'error|failed|fatal' -CaseSensitive:$false
