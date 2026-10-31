"""Sanitized, read-only systemd schedule snapshot for the owner dashboard."""
import os
import re
import subprocess
import threading
import time
import json
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))
JOBS = (
    ('deploy', 'VM 배포·점검'),
    ('dailyscan', '기본 패턴·일봉'),
    ('etfstrategyscan', 'ETF 일별'),
    ('anglemomentumscan', '각도 모멘텀'),
    ('gongpasanscan', '공파산'),
    ('week52', '52주'),
    ('batch', '재무·수급 배치'),
    ('strategyscan', '비ETF 주별'),
    ('volumebreakout', '장중 거래량'),
    ('scanreaper', '스캔 마감'),
    ('swingmonitor', '스윙 후속'),
)
_lock = threading.Lock()
_cache = {'at': 0.0, 'data': None}
_TIME = re.compile(r'\b(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) UTC\b')
_SLOW_SEC = {'dailyscan': 2 * 3600, 'etfstrategyscan': 3600,
             'anglemomentumscan': 3600, 'gongpasanscan': 3600,
             'week52': 3600, 'batch': 2 * 3600, 'strategyscan': 2 * 3600}
# Heartbeat age limits: daily jobs record even on holidays; weekly/weekday timers get their gap.
_STALE_SEC = {'deploy': 10**9, 'strategyscan': 8 * 86400, 'volumebreakout': 4 * 86400}


def _kst_stamp(value):
    hit = _TIME.search(value or '')
    if not hit:
        return None
    return datetime.fromisoformat('T'.join(hit.groups())).replace(tzinfo=timezone.utc).astimezone(KST).isoformat(timespec='seconds')


def _read_units():
    names = [f'kiwoom-{key}.{suffix}' for key, _ in JOBS for suffix in ('service', 'timer')]
    completed = subprocess.run(['systemctl', 'show', *names, '-p', 'Id', '-p', 'ActiveState',
                                '-p', 'Result', '-p', 'ExecMainStatus', '-p', 'ExecMainStartTimestamp',
                                '-p', 'ExecMainExitTimestamp', '-p', 'NextElapseUSecRealtime',
                                '--no-pager'], capture_output=True, text=True, timeout=5, check=True)
    out = {}
    for block in completed.stdout.strip().split('\n\n'):
        fields = dict(line.split('=', 1) for line in block.splitlines() if '=' in line)
        if fields.get('Id'):
            out[fields['Id']] = fields
    return out


def collect(app_dir=None, now=None, units=None):
    now = now or datetime.now(KST)
    units = _read_units() if units is None else units
    rows = []
    from scheduled_job import CONTRACTS
    try:
        with open(os.path.join(app_dir or os.path.dirname(__file__), 'scheduled_jobs.json'), encoding='utf-8') as stream:
            executions = json.load(stream)
    except (OSError, ValueError):
        executions = {}
    for key, label in JOBS:
        service = units.get(f'kiwoom-{key}.service', {})
        timer = units.get(f'kiwoom-{key}.timer', {})
        started = _kst_stamp(service.get('ExecMainStartTimestamp'))
        finished = _kst_stamp(service.get('ExecMainExitTimestamp'))
        duration = None
        if started and finished:
            duration = max(0, int((datetime.fromisoformat(finished) - datetime.fromisoformat(started)).total_seconds()))
        active = timer.get('ActiveState') == 'active'
        result = service.get('Result')
        state = ('미확인' if not timer else '의도적 비활성화' if not active else
                 '오류' if result and result != 'success' else '정상' if finished else '미확인')
        if state == '정상' and duration is not None and duration > _SLOW_SEC.get(key, 10**9):
            state = '지연'
        execution = executions.get(key) or {}
        # scheduled_jobs.json is the heartbeat: every terminal record overwrites finishedAt.
        beat = execution.get('finishedAt')
        if (active and beat and service.get('ActiveState') != 'activating'
                and (now - datetime.fromisoformat(beat)).total_seconds() > _STALE_SEC.get(key, 26 * 3600)):
            state = '멈춤'
        progress = None
        try:
            with open(os.path.join(app_dir or os.path.dirname(__file__), 'scan_progress_' + key + '.json'), encoding='utf-8') as stream:
                candidate = json.load(stream)
            if (candidate.get('runStartedAt') == execution.get('startedAt')
                    and execution.get('state') == 'running'
                    and isinstance(candidate.get('processed'), int)
                    and isinstance(candidate.get('total'), int)
                    and 0 <= candidate['processed'] <= candidate['total']
                    and candidate['total'] > 0):
                progress = {field: candidate.get(field) for field in
                            ('runStartedAt', 'updatedAt', 'phase', 'processed', 'total', 'unit')}
        except (OSError, ValueError, AttributeError, TypeError):
            pass
        rows.append({'progress': progress, 'id': key, 'name': label, 'state': state, 'lastStartedAt': started,
                     'lastSuccessAt': finished if result == 'success' else None,
                     'lastResult': result, 'nextRunAt': _kst_stamp(timer.get('NextElapseUSecRealtime')),
                     'elapsedSec': duration, 'contract': CONTRACTS.get(key),
                     'lastExecution': executions.get(key)})
    marker = os.path.join(app_dir or os.path.dirname(__file__), '.off_hours_maintenance_last_run_date')
    try:
        with open(marker, encoding='ascii') as stream:
            last_date = stream.read().strip()
        datetime.strptime(last_date, '%Y-%m-%d')
    except (OSError, ValueError):
        last_date = None
    days_old = (now.date() - datetime.fromisoformat(last_date).date()).days if last_date else None
    maintenance_state = '미확인' if days_old is None else '오류' if days_old > 1 else '정상'
    next_maintenance = now.replace(hour=3, minute=0, second=0, microsecond=0)
    if now >= next_maintenance:
        next_maintenance += timedelta(days=1)
    rows.append({'id': 'maintenance', 'name': '장외 백업·정리', 'state': maintenance_state,
                 'lastSuccessAt': last_date, 'nextRunAt': next_maintenance.isoformat(timespec='seconds'),
                 'lastResult': 'success' if last_date else None, 'elapsedSec': None,
                 'contract': CONTRACTS['maintenance'], 'lastExecution': executions.get('maintenance')})
    return {'asOf': now.isoformat(timespec='seconds'), 'jobs': rows}


def snapshot():
    now = time.monotonic()
    with _lock:
        if _cache['data'] is not None and now - _cache['at'] < 60:
            return _cache['data']
        try:
            data = collect()
        except (OSError, subprocess.SubprocessError, ValueError):
            data = {'asOf': datetime.now(KST).isoformat(timespec='seconds'), 'jobs': [], 'state': '미확인'}
        _cache.update(at=now, data=data)
        return data
