# Restarts the local bot (dry-run unless LIVE_SELL=true in .env). Stops any python/pythonw running main.py from this folder, then starts it hidden.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$procs = Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'python.exe' -or $_.Name -eq 'pythonw.exe') -and $_.CommandLine -match 'main\.py' }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force; Write-Host ('Stopped PID ' + $p.ProcessId) }
Start-Sleep -Seconds 2
$pyw = (Get-Command pythonw.exe -ErrorAction Stop).Source
Start-Process -FilePath $pyw -ArgumentList 'main.py' -WorkingDirectory $dir -WindowStyle Hidden
Start-Sleep -Seconds 3
$ok = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'pythonw.exe' -and $_.CommandLine -match 'main\.py' }
if ($ok) { Write-Host 'Bot is running (hidden). Log: logs folder' } else { Write-Host 'Bot did not start - run check.bat and read the message' }
