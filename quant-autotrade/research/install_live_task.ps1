# Registers the intraday paper-trading job (virtual fills only, NO order code) as a scheduled task: Mon-Fri 08:50 KST + 2 minutes after logon.
# The job itself checks the KRX calendar (holidays) and exits on non-trading days; it also halts if LIVE_SELL is on in .env.
# Run ONLY after approval - this copies code into <data dir>\research_app (shared with the research job) and registers 'AutotraderLivePaper'.
# Usage: powershell -ExecutionPolicy Bypass -File quant-autotrade\research\install_live_task.ps1     Remove: uninstall_live_task.ps1
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dataDir = if ($env:AUTOTRADER_DIR) { $env:AUTOTRADER_DIR } else { Join-Path $env:USERPROFILE 'autotrader' }
$app = Join-Path $dataDir 'research_app'
$map = @{ 'quant-autotrade\backtest' = '*.py'; 'quant-autotrade\research' = '*.py'; 'quant-autotrade\local_bot' = 'server.py'; 'scripts\analysis' = '*.py'; 'scripts\cloud-vm' = '*.py' }
foreach ($rel in $map.Keys) {
  $dst = Join-Path $app $rel
  New-Item -ItemType Directory -Force $dst | Out-Null
  Copy-Item (Join-Path $repo "$rel\$($map[$rel])") $dst -Force
}
$script = Join-Path $app 'quant-autotrade\research\live_paper_job.py'
if (-not (Test-Path $script)) { throw "live_paper_job.py was not copied: $script" }
$venv = Join-Path $repo '.venv\Scripts\pythonw.exe'
$pyw = if (Test-Path $venv) { $venv } else { (Get-Command pythonw.exe -ErrorAction Stop).Source }
$py = Join-Path (Split-Path $pyw) 'python.exe'
& $py -c "import sqlite3, ssl, json; print('python ok')"
if ($LASTEXITCODE -ne 0) { throw "python check failed: $py" }
$action = New-ScheduledTaskAction -Execute $pyw -Argument ('"' + $script + '"') -WorkingDirectory $app
$t1 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 08:50
$user = "$env:USERDOMAIN\$env:USERNAME"
$t2 = New-ScheduledTaskTrigger -AtLogOn -User $user
$t2.Delay = 'PT2M'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 8) -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun:$false
$desc = 'Autotrader intraday PAPER trading (virtual fills, no orders). Mon-Fri 08:50 KST; exits 15:50 or on non-trading days.'
$mode = 'S4U (runs when logged off)'
try {
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
  Register-ScheduledTask -TaskName 'AutotraderLivePaper' -Action $action -Trigger @($t1, $t2) -Settings $settings -Principal $principal -Description $desc -Force | Out-Null
} catch {
  $mode = 'interactive only (S4U was refused: ' + $_.Exception.Message + ')'
  Register-ScheduledTask -TaskName 'AutotraderLivePaper' -Action $action -Trigger @($t1, $t2) -Settings $settings -Description $desc -Force | Out-Null
}
Write-Host "Registered AutotraderLivePaper - logon mode: $mode"
Write-Host "Next run: $((Get-ScheduledTaskInfo -TaskName 'AutotraderLivePaper').NextRunTime)"
