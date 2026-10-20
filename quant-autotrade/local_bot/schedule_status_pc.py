"""Read-only, token-gated Windows task summary. Never returns actions or account data."""
import json
import os
import subprocess
import threading
import time
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
NAMES = ('AutotraderBot', 'AutotraderCandidates', 'AutotraderResearch',
         'AutotraderLivePaper', 'AutotraderLiveTrading')
_SCRIPT = r'''
$names = @('AutotraderBot','AutotraderCandidates','AutotraderResearch','AutotraderLivePaper','AutotraderLiveTrading')
$rows = @($names | ForEach-Object {
  $t = Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue
  if ($t) {
    $i = Get-ScheduledTaskInfo -TaskName $_
    [pscustomobject]@{
      name = $_; state = [string]$t.State; code = [int64]$i.LastTaskResult
      lastRunAt = if ($i.LastRunTime.Year -gt 2000) { $i.LastRunTime.ToString('o') } else { $null }
      nextRunAt = if ($i.NextRunTime.Year -gt 2000) { $i.NextRunTime.ToString('o') } else { $null }
      triggerCount = @($t.Triggers).Count
    }
  }
})
ConvertTo-Json -InputObject $rows -Compress -Depth 3
'''
_lock = threading.Lock()
_cache = {'at': 0.0, 'data': None}


def summarize(raw, research_status=None, now=None):
    now = now or datetime.now(KST)
    by_name = {row['name']: row for row in raw if row.get('name') in NAMES}
    research_status = research_status or {}
    jobs = []
    for name in NAMES:
        row = by_name.get(name)
        if not row:
            jobs.append({'id': name, 'name': name, 'state': '미확인', 'lastSuccessAt': None, 'nextRunAt': None})
            continue
        state = row.get('state')
        if state == 'Disabled':
            label = '의도적 비활성화'
        elif state == 'Running' or row.get('code') == 0:
            label = '정상'
        elif row.get('code') in (None, 267011):
            label = '미확인'
        else:
            label = '오류'
        last = row.get('lastRunAt') if row.get('code') == 0 else None
        if name == 'AutotraderResearch':
            last = research_status.get('lastSuccessAt')
            try:
                age = now - datetime.fromisoformat(last)
                if state != 'Disabled' and age > timedelta(days=2):
                    label = '지연'
            except (ValueError, TypeError):
                label = '미확인' if state != 'Disabled' else label
        jobs.append({'id': name, 'name': name, 'state': label, 'lastSuccessAt': last,
                     'nextRunAt': row.get('nextRunAt'), 'lastResultCode': row.get('code'),
                     'triggerCount': row.get('triggerCount')})
    return {'asOf': now.isoformat(timespec='seconds'), 'jobs': jobs}


def snapshot(research_dir):
    with _lock:
        at = time.monotonic()
        if _cache['data'] is not None and at - _cache['at'] < 60:
            return _cache['data']
        try:
            process = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', _SCRIPT],
                                     capture_output=True, text=True, timeout=12, check=True)
            raw = json.loads(process.stdout)
            try:
                with open(os.path.join(research_dir, 'status.json'), encoding='utf-8') as stream:
                    research = json.load(stream)
            except (OSError, ValueError):
                research = {}
            data = summarize(raw, research)
        except (OSError, ValueError, subprocess.SubprocessError):
            data = {'asOf': datetime.now(KST).isoformat(timespec='seconds'), 'jobs': [], 'state': '미확인'}
        _cache.update(at=at, data=data)
        return data
