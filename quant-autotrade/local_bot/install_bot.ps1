# Installs / updates the local bot on this PC and registers the auto-start watchdog task "AutotraderBot".
#   powershell -ExecutionPolicy Bypass -File quant-autotrade\local_bot\install_bot.ps1            sync files + register task + restart the bot
#   ... -NoRestart   sync files + register task only        ... -NoTask   sync files (+restart) only
# - Bot folder = $env:AUTOTRADER_DIR, otherwise %USERPROFILE%\autotrader. Never touches .env, .token, config.json, *.db, logs (your keys and data stay as they are).
# - Files that would be overwritten are first copied to <bot folder>\backup_<time>\.
# - The task runs "pythonw main.py --watchdog" at logon (+1 min) and every 5 minutes. main.py exits quietly when the bot already runs (bot.lock), so this only
#   revives a bot that died or was killed. stop.bat leaves a NO_AUTOSTART marker that pauses it until restart.bat / run.bat. Runs as the current user (no admin rights).
# - Also refreshes research\candidate_gen.py in <bot folder>\research_app (candidate selection reasons) WITHOUT re-registering the research task.
param([switch]$NoTask, [switch]$NoRestart)
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $src '..\..')).Path
$botDir = if ($env:AUTOTRADER_DIR) { $env:AUTOTRADER_DIR } else { Join-Path $env:USERPROFILE 'autotrader' }
New-Item -ItemType Directory -Force $botDir | Out-Null

# 1) sync runtime files (tests, fake servers and secrets are never copied)
$files = Get-ChildItem $src -File | Where-Object {
  ($_.Extension -in '.py', '.bat', '.ps1', '.vbs', '.txt', '.example') -and $_.Name -notmatch '^(test_|fake_|install_bot)' -and $_.Name -ne '.env'
}
if ((Resolve-Path $src).Path -ne (Resolve-Path $botDir).Path) {
  $backup = Join-Path $botDir ('backup_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
  $changed = 0
  foreach ($f in $files) {
    $dst = Join-Path $botDir $f.Name
    if (Test-Path $dst) {
      if ((Get-FileHash $dst).Hash -eq (Get-FileHash $f.FullName).Hash) { continue }
      New-Item -ItemType Directory -Force $backup | Out-Null
      Copy-Item $dst $backup -Force
    }
    Copy-Item $f.FullName $dst -Force
    $changed++
  }
  $note = if (Test-Path $backup) { " (previous versions: $backup)" } else { '' }
  Write-Host "Synced $changed file(s) to $botDir$note"
}
$cg = Join-Path $repo 'quant-autotrade\research\candidate_gen.py'
$cgDst = Join-Path $botDir 'research_app\quant-autotrade\research'
if ((Test-Path $cg) -and (Test-Path $cgDst)) { Copy-Item $cg $cgDst -Force; Write-Host 'Refreshed research_app candidate_gen.py' }

# 2) watchdog task
if (-not $NoTask) {
  $pyw = (Get-Command pythonw.exe -ErrorAction Stop).Source
  $user = "$env:USERDOMAIN\$env:USERNAME"
  $action = New-ScheduledTaskAction -Execute $pyw -Argument 'main.py --watchdog' -WorkingDirectory $botDir
  $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
  $logon.Delay = 'PT1M'
  $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName 'AutotraderBot' -Action $action -Trigger @($logon, $repeat) -Settings $settings -Principal $principal `
    -Description 'Autotrader local bot watchdog (logon + every 5 min; exits quietly if already running)' -Force | Out-Null
  Write-Host 'Registered task AutotraderBot (at logon + every 5 minutes from now, current user, no admin rights)'
}

# 3) restart so the new code is active
if (-not $NoRestart) {
  & (Join-Path $botDir 'restart.ps1')
}
Write-Host 'Done. Telegram: run telegram_setup.bat once (token + pairing), then the bot sends alerts on its own.'
