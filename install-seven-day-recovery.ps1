$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$start = Join-Path $repo 'start-seven-day-run.ps1'
$watch = Join-Path $repo 'watch-seven-day-run.ps1'
$backup = Join-Path $repo 'backup-seven-day-run.ps1'
$pwsh = (Get-Command powershell.exe).Source

$startAction = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$start`""
$startTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'AutonomousCryptoIntelligenceRecovery' -Action $startAction -Trigger $startTrigger -Settings $settings -Description 'Recover the seven-day Aether Docker paper-research run after Windows logon.' -Force | Out-Null

$watchAction = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watch`""
$watchTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(2)) -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'AutonomousCryptoIntelligenceWatchdog' -Action $watchAction -Trigger $watchTrigger -Settings $settings -Description 'Check and recover Aether containers and engine heartbeat.' -Force | Out-Null

$backupAction = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backup`""
$backupTrigger = New-ScheduledTaskTrigger -Daily -At '03:30'
Register-ScheduledTask -TaskName 'AutonomousCryptoIntelligenceDailyBackup' -Action $backupAction -Trigger $backupTrigger -Settings $settings -Description 'Daily rolling PostgreSQL backup for the Aether experiment.' -Force | Out-Null

Get-ScheduledTask -TaskName 'AutonomousCryptoIntelligenceRecovery','AutonomousCryptoIntelligenceWatchdog','AutonomousCryptoIntelligenceDailyBackup' | Select-Object TaskName,State
