# Keep one read-only candidate producer (AutotraderResearch) and its paper analysis.
# Backs up both task definitions and the installed source before changing tasks.
param([string]$RollbackPath)
$ErrorActionPreference = 'Stop'
$dataDir = if ($env:AUTOTRADER_DIR) { $env:AUTOTRADER_DIR } else { Join-Path $env:USERPROFILE 'autotrader' }
$app = Join-Path $dataDir 'research_app'
$names = @('AutotraderResearch', 'AutotraderCandidates')

if ($RollbackPath) {
  $backup = (Resolve-Path -LiteralPath $RollbackPath).Path
  if (-not (Test-Path -LiteralPath (Join-Path $backup 'AutotraderResearch.xml'))) { throw 'Invalid scheduler backup' }
  foreach ($name in $names) {
    $xml = Get-Content -LiteralPath (Join-Path $backup "$name.xml") -Raw
    Register-ScheduledTask -TaskName $name -Xml $xml -Force | Out-Null
  }
  $old = Join-Path $backup 'installed-research'
  if (Test-Path -LiteralPath $old) {
    Get-ChildItem -LiteralPath $old -Filter '*.py' | Copy-Item -Destination (Join-Path $app 'quant-autotrade\research') -Force
  }
  Write-Host "Restored task definitions and installed research source from $backup"
  return
}

foreach ($name in $names) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction Stop
  if ($task.State -eq 'Running') { throw "$name is running; retry after it exits." }
}
$backup = Join-Path $dataDir ('scheduler-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
foreach ($name in $names) {
  Export-ScheduledTask -TaskName $name | Set-Content -LiteralPath (Join-Path $backup "$name.xml") -Encoding UTF8
}
$installed = Join-Path $app 'quant-autotrade\research'
if (Test-Path -LiteralPath $installed) {
  $old = Join-Path $backup 'installed-research'
  New-Item -ItemType Directory -Path $old | Out-Null
  Get-ChildItem -LiteralPath $installed -Filter '*.py' | Copy-Item -Destination $old
}
$db = Join-Path $dataDir 'research\research.db'
if (Test-Path -LiteralPath $db) {
  $python = (Get-Command python.exe -ErrorAction Stop).Source
  & $python -c 'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); assert d.execute("pragma integrity_check").fetchone()[0]=="ok"; d.close(); s.close()' $db (Join-Path $backup 'research.db')
  if ($LASTEXITCODE -ne 0) { throw "Database backup failed; tasks unchanged. Backup: $backup" }
}

try {
  & (Join-Path $PSScriptRoot 'install_task.ps1')
  Disable-ScheduledTask -TaskName 'AutotraderCandidates' | Out-Null
  $research = Get-ScheduledTask -TaskName 'AutotraderResearch'
  $logons = @($research.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' })
  if ($logons.Count -ne 1 -or $research.State -eq 'Disabled') { throw 'Research trigger verification failed' }
  if ((Get-ScheduledTask -TaskName 'AutotraderCandidates').State -ne 'Disabled') { throw 'Candidate task is still enabled' }
  Write-Host "Consolidated: one research logon trigger, redundant candidate task disabled. Backup: $backup"
} catch {
  foreach ($name in $names) {
    $xml = Get-Content -LiteralPath (Join-Path $backup "$name.xml") -Raw
    Register-ScheduledTask -TaskName $name -Xml $xml -Force | Out-Null
  }
  $old = Join-Path $backup 'installed-research'
  if (Test-Path -LiteralPath $old) {
    Get-ChildItem -LiteralPath $old -Filter '*.py' | Copy-Item -Destination $installed -Force
  }
  throw "Task update failed and task definitions and research source were restored. Backup: $backup. $($_.Exception.Message)"
}
