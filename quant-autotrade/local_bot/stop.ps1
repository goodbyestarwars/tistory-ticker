# Stops the local bot on purpose. Leaves a NO_AUTOSTART marker so the scheduled watchdog task (AutotraderBot) does not start it again until you run restart.bat / run.bat.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Content -Path (Join-Path $dir 'planned_stop.flag') -Value (Get-Date -Format s) -Encoding ascii
Set-Content -Path (Join-Path $dir 'NO_AUTOSTART') -Value (Get-Date -Format s) -Encoding ascii
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
  $procs = Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'python.exe' -or $_.Name -eq 'pythonw.exe') -and $_.CommandLine -match 'main\.py' }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force; Write-Host ('Stopped PID ' + $p.ProcessId); $stopped += $p.ProcessId }
}
if (-not $stopped) { Write-Host 'Not running.' }
Write-Host 'Auto-start is paused until restart.bat / run.bat.'
