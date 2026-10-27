"""Index membership breadth, fetched twice per shared cache refresh (no per-symbol calls)."""
import json
import math
import threading
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import urllib.error
import urllib.request

SOURCE = 'TradingView index components'
INDEXES = {'SP500': ('SP:SPX', 'S&P 500'), 'NASDAQ': ('NASDAQ:IXIC', '나스닥 종합')}
_lock = threading.Lock()
_cache = {'at': 0, 'data': None, 'attempt': 0}


def parse_breadth(payload):
    expected = payload.get('totalCount')
    rows = payload.get('data')
    if not isinstance(expected, int) or expected <= 0 or not isinstance(rows, list) or len(rows) != expected:
        raise ValueError('incomplete index membership')
    seen = set()
    up = down = flat = missing = 0
    delay = 0
    for row in rows:
        symbol = row.get('s')
        values = row.get('d') or []
        if not symbol or symbol in seen or len(values) < 2:
            raise ValueError('invalid index member')
        seen.add(symbol)
        change = values[0]
        if isinstance(change, bool) or not isinstance(change, (int, float)) or not math.isfinite(change):
            missing += 1
        elif change > 0:
            up += 1
        elif change < 0:
            down += 1
        else:
            flat += 1
        mode = str(values[1] or '')
        if mode.startswith('delayed_streaming_'):
            delay = max(delay, int(mode.rsplit('_', 1)[1]))
    if up + down + flat == 0:
        raise ValueError('no valid prices')
    return {'up': up, 'down': down, 'flat': flat, 'missing': missing, 'total': expected,
            'delaySeconds': delay, 'timeBasis': 'retrieval'}


def _fetch(index):
    payload = {
        'columns': ['change', 'update_mode'],
        'symbols': {'groups': [{'type': 'index', 'values': [index]}]},
        'range': [0, 10000],
    }
    request = urllib.request.Request('https://scanner.tradingview.com/america/scan',
                                     data=json.dumps(payload).encode('utf-8'),
                                     headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'},
                                     method='POST')
    with urllib.request.urlopen(request, timeout=7) as response:
        entry = parse_breadth(json.load(response))
    entry['retrievedAt'] = datetime.now(timezone.utc).isoformat()
    return entry


def get_breadth(now=None):
    now = time.time() if now is None else now
    clock = datetime.fromtimestamp(now, ZoneInfo('America/New_York'))
    active = clock.weekday() < 5 and 570 <= clock.hour * 60 + clock.minute < 960
    ttl = 120 if active else 3600
    with _lock:
        if _cache['data'] is not None and now - _cache['at'] < ttl:
            return _cache['data']
        # Failed refreshes also back off; visits never multiply provider requests.
        if now - _cache['attempt'] < 60:
            return _stale(now)
        _cache['attempt'] = now
        entries = {}
        for key, (index, label) in INDEXES.items():
            try:
                entries[key] = dict(_fetch(index), label=label, status='ok')
            except (urllib.error.URLError, OSError, ValueError, TypeError, KeyError):
                old = ((_cache['data'] or {}).get('byIndex') or {}).get(key)
                if old and now - old.get('cachedAt', 0) < 900:
                    entries[key] = dict(old, status='stale')
                else:
                    entries[key] = {'label': label, 'status': 'unavailable'}
            if entries[key]['status'] == 'ok':
                entries[key]['cachedAt'] = now
        result = {'source': SOURCE, 'byIndex': entries, 'timeBasis': 'retrieval'}
        _cache.update(at=now, data=result)
        # Retry failures after 60 seconds, rather than treating an error as an hour-long cache hit.
        if any(entry['status'] != 'ok' for entry in entries.values()):
            _cache['at'] = now - ttl
        return result


def _stale(now):
    entries = {}
    for key, (_, label) in INDEXES.items():
        old = ((_cache['data'] or {}).get('byIndex') or {}).get(key)
        entries[key] = dict(old, status='stale') if old and now - old.get('cachedAt', 0) < 900 else {'label': label, 'status': 'unavailable'}
    return {'source': SOURCE, 'byIndex': entries, 'timeBasis': 'retrieval'}
