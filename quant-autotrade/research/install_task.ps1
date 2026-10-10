# Registers the read-only research job as a Windows scheduled task (Mon-Fri 20:15 KST, plus a catch-up run 2 minutes after logon).
# No order code. Credentials stay in the local .env; nothing here reads or prints them.
# Usage (PowerShell, from anywhere):  powershell -ExecutionPolicy Bypass -File quant-autotrade\research\install_task.ps1
# Remove: uninstall_task.ps1
#
# - Code is copied to <data dir>\research_app so switching git branches never changes the scheduled code. Re-run this script after code changes.
# - <data dir> = $env:AUTOTRADER_DIR if set, otherwise $env:USERPROFILE\autotrader (research data, logs and status.json live in <data dir>\research).
# - Runs whether or not the user is logged on (S4U logon: local resources and outbound internet only, no stored password).
#   If S4U registration is refused (needs elevation on some PCs) the script falls back to "only when logged on" and says so.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dataDir = if ($env:AUTOTRADER_DIR) { $env:AUTOTRADER_DIR } else { Join-Path $env:USERPROFILE 'autotrader' }
$app = Join-Path $dataDir 'research_app'

# 1) source folders -> stable copy (same relative layout, so the modules' repo-relative imports keep working)
$map = @{ 'quant-autotrade\backtest' = '*.py'; 'quant-autotrade\research' = '*.py'; 'quant-autotrade\local_bot' = 'server.py'; 'scripts\analysis' = '*.py'; 'scripts\cloud-vm' = '*.py' }
foreach ($rel in $map.Keys) {
  $dst = Join-Path $app $rel
  New-Item -ItemType Directory -Force $dst | Out-Null
  Copy-Item (Join-Path $repo "$rel\$($map[$rel])") $dst -Force
}
$script = Join-Path $app 'quant-autotrade\research\research_job.py'
if (-not (Test-Path $script)) { throw "research_job.py was not copied: $script" }

# 2) interpreter: project virtualenv first, then the Python on PATH (pythonw = no console window)
$venv = Join-Path $repo '.venv\Scripts\pythonw.exe'
$pyw = if (Test-Path $venv) { $venv } else { (Get-Command pythonw.exe -ErrorAction Stop).Source }
$py = Join-Path (Split-Path $pyw) 'python.exe'
& $py -c "import sqlite3, ssl, json; print('python ok', __import__('sys').version.split()[0])"
if ($LASTEXITCODE -ne 0) { throw "python check failed: $py" }

# 3) task: weekdays 20:15 + 2 minutes after logon (the job itself decides whether the current time is inside the watch window).
#    A boot-time trigger needs administrator rights, so the catch-up trigger is logon based; with S4U the task also runs while logged off.
$action = New-ScheduledTaskAction -Execute $pyw -Argument ('"' + $script + '"') -WorkingDirectory $app
$t1 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 20:15
$user = "$env:USERDOMAIN\$env:USERNAME"
$t2 = New-ScheduledTaskTrigger -AtLogOn -User $user
$t2.Delay = 'PT2M'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 13) -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun:$false
$desc = 'Autotrader research candidates (read-only, Mon-Fri 20:15 KST; poll every 10 min until 08:15)'
$mode = 'S4U (runs when logged off)'
try {
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
  Register-ScheduledTask -TaskName 'AutotraderResearch' -Action $action -Trigger @($t1, $t2) -Settings $settings -Principal $principal -Description $desc -Force | Out-Null
} catch {
  $mode = 'interactive only (S4U was refused: ' + $_.Exception.Message + ')'
  Register-ScheduledTask -TaskName 'AutotraderResearch' -Action $action -Trigger @($t1, $t2) -Settings $settings -Description $desc -Force | Out-Null
}
$info = Get-ScheduledTaskInfo -TaskName 'AutotraderResearch'
Write-Host "Registered AutotraderResearch - logon mode: $mode"
Write-Host "Next run: $($info.NextRunTime)"
Write-Host "Data/log folder: $(Join-Path $dataDir 'research')"
