$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'pythonw.exe' -and $_.CommandLine -match 'main.py' }
if (-not $procs) { Write-Host 'Not running.' }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force; Write-Host ('Stopped PID ' + $p.ProcessId) }
