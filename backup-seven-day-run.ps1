[CmdletBinding()]
param([switch]$Baseline)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\scripts\seven-day-common.ps1"
Import-SevenDayEnv
Wait-Docker -TimeoutSeconds 60
$folder = if ($Baseline) { Join-Path $RepoRoot 'backups\seven-day-baseline' } else { Join-Path $RepoRoot 'backups\daily' }
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$target = Join-Path $folder "aci-$stamp.sql"
$dump = docker compose -f $ComposeFile exec -T postgres pg_dump -U aether -d aether --no-owner --no-privileges
if ($LASTEXITCODE -ne 0) { throw 'Database backup command failed.' }
[IO.File]::WriteAllLines($target, [string[]]$dump, (New-Object Text.UTF8Encoding($false)))
if (-not (Test-Path -LiteralPath $target) -or (Get-Item -LiteralPath $target).Length -lt 1024) { throw 'Database backup failed validation.' }
$listing = Get-Content -Raw -LiteralPath $target
if ($listing -notmatch 'CREATE TABLE public\.paper_portfolios' -or $listing -notmatch 'COPY public\.experiments') { throw 'Backup content validation failed.' }
Get-ChildItem -LiteralPath (Join-Path $RepoRoot 'backups\daily') -Filter '*.sql' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -Skip 10 | Remove-Item -Force
Write-RecoveryLog "Database backup verified: $target"
Write-Host $target
