# Restarts the local bot (dry-run unless LIVE_SELL=true in .env). Stops the running bot (bot.lock PID, or any python/pythonw running main.py from an older start),
# marks the stop as planned (so the Telegram monitor reports "restart complete" instead of "abnormal exit"), clears the NO_AUTOSTART marker and starts the bot hidden.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Content -Path (Join-Path $dir 'planned_stop.flag') -Value (Get-Date -Format s) -Encoding ascii
Remove-Item -Path (Join-Path $dir 'NO_AUTOSTART') -ErrorAction SilentlyContinue
$lock = Join-Path $dir 'bot.lock'
$stopped = @()
if (Test-Path $lock) {
  $pidText = (Get-Content $lock -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($pidText -match '^\d+$') {
    $p = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -match '^pythonw?$') { Stop-Process -Id $p.Id -Force; $stopped += $p.Id; Write-Host ('Stopped PID ' + $p.Id) }
  }
}
if (-not $stopped) {
  # Bots started before bot.lock existed: fall back to the command-line match.
  $procs = Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'python.exe' -or $_.Name -eq 'pythonw.exe') -and $_.CommandLine -match 'main\.py' }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force; Write-Host ('Stopped PID ' + $p.ProcessId) }
}
Start-Sleep -Seconds 2
$pyw = (Get-Command pythonw.exe -ErrorAction Stop).Source
Start-Process -FilePath $pyw -ArgumentList 'main.py' -WorkingDirectory $dir -WindowStyle Hidden
Start-Sleep -Seconds 4
$ok = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'pythonw.exe' -and $_.CommandLine -match 'main\.py' }
if ($ok) { Write-Host 'Bot is running (hidden). Log: logs folder' } else { Write-Host 'Bot did not start - run check.bat and read the message' }
