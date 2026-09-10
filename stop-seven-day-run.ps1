$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\scripts\seven-day-common.ps1"
Wait-Docker -TimeoutSeconds 30
docker compose -f $ComposeFile stop
if ($LASTEXITCODE -ne 0) { throw 'Could not stop the stack.' }
Write-RecoveryLog 'Stack stopped safely; volumes and backups retained.'
Write-Host 'Stopped. PostgreSQL volume, experiment state, logs, and backups were preserved.'
