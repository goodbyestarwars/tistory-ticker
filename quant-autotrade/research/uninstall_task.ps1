Unregister-ScheduledTask -TaskName 'AutotraderResearch' -Confirm:$false -ErrorAction SilentlyContinue
Write-Host 'Task removed (copied research_app and research records are kept).'
