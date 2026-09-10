$ErrorActionPreference = 'Stop'
powercfg /change standby-timeout-ac 30
powercfg /change hibernate-timeout-ac 180
powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE
powercfg /query SCHEME_CURRENT SUB_SLEEP HIBERNATEIDLE
Write-Host 'Restored AC sleep to 30 minutes and AC hibernation to 180 minutes. Display settings were not changed.'
