"""Index membership breadth, fetched twice per shared cache refresh (no per-symbol calls)."""
import json
import math
import statistics
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
MARKETS = {'us': ('america', 'America/New_York', 570, 960, INDEXES),
           'domestic': ('korea', 'Asia/Seoul', 540, 930, {'KOSPI': ('KRX:KOSPI', '코스피'), 'KOSDAQ': ('KRX:KOSDAQ', '코스닥')})}
_caches = {'us': _cache, 'domestic': {'at': 0, 'data': None, 'attempt': 0}}
_locks = {'us': _lock, 'domestic': threading.Lock()}


def parse_breadth(payload):
    expected = payload.get('totalCount')
    rows = payload.get('data')
    if not isinstance(expected, int) or expected <= 0 or not isinstance(rows, list) or len(rows) != expected:
        raise ValueError('incomplete index membership')
    seen = set()
    up = down = flat = missing = 0
    delay = 0
    relative_volumes = []
    volume_pairs = []
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
        relative = values[2] if len(values) > 2 else None
        if not isinstance(relative, bool) and isinstance(relative, (int, float)) and math.isfinite(relative) and relative >= 0:
            relative_volumes.append(relative)
        current_volume = values[3] if len(values) > 3 else None
        if (not isinstance(relative, bool) and isinstance(relative, (int, float)) and math.isfinite(relative) and relative > 0
                and not isinstance(current_volume, bool) and isinstance(current_volume, (int, float)) and math.isfinite(current_volume) and current_volume >= 0):
            volume_pairs.append((current_volume, current_volume / relative))
        mode = str(values[1] or '')
        if mode.startswith('delayed_streaming_'):
            delay = max(delay, int(mode.rsplit('_', 1)[1]))
    if up + down + flat == 0:
        raise ValueError('no valid prices')
    current_volume = sum(pair[0] for pair in volume_pairs)
    baseline_volume = sum(pair[1] for pair in volume_pairs)
    volume_ok = math.isfinite(current_volume) and math.isfinite(baseline_volume) and baseline_volume > 0 and len(volume_pairs) / expected >= .95
    return {'up': up, 'down': down, 'flat': flat, 'missing': missing, 'total': expected,
            'volumeIndex': {'current': current_volume, 'baseline': baseline_volume,
                            'index100': current_volume / baseline_volume * 100 if volume_ok else None,
                            'eligible': len(volume_pairs), 'total': expected, 'basis': 'same-time-5m-volume-sum',
                            'lookbackDays': 10, 'status': 'ok' if volume_ok else 'unavailable'},
            'delaySeconds': delay, 'timeBasis': 'retrieval',
            'volumeParticipation': {'eligible': len(relative_volumes), 'total': expected,
                                    'increased': sum(value > 1 for value in relative_volumes),
                                    'ratio': sum(value > 1 for value in relative_volumes) / len(relative_volumes) if relative_volumes else None,
                                    'median': statistics.median(relative_volumes) if relative_volumes else None,
                                    'basis': 'same-time-5m', 'lookbackDays': 10,
                                    'status': 'ok' if relative_volumes else 'unavailable'}}


def _fetch(index, region='america'):
    payload = {
        'columns': ['change', 'update_mode', 'relative_volume_intraday|5', 'volume|5'],
        'symbols': {'groups': [{'type': 'index', 'values': [index]}]},
        'range': [0, 10000],
    }
    request = urllib.request.Request('https://scanner.tradingview.com/' + region + '/scan',
                                     data=json.dumps(payload).encode('utf-8'),
                                     headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'},
                                     method='POST')
    with urllib.request.urlopen(request, timeout=7) as response:
        entry = parse_breadth(json.load(response))
    entry['retrievedAt'] = datetime.now(timezone.utc).isoformat()
    return entry


def get_breadth(now=None, market='us'):
    now = time.time() if now is None else now
    region, zone, start, end, indexes = MARKETS[market]
    cache = _caches[market]
    clock = datetime.fromtimestamp(now, ZoneInfo(zone))
    active = clock.weekday() < 5 and start <= clock.hour * 60 + clock.minute < end + (10 if market == 'domestic' else 0)
    ttl = 120 if active else 3600
    with _locks[market]:
        if cache['data'] is not None and now - cache['at'] < ttl:
            return cache['data']
        # Failed refreshes also back off; visits never multiply provider requests.
        if now - cache['attempt'] < 60:
            return _stale(now, market)
        cache['attempt'] = now
        entries = {}
        for key, (index, label) in indexes.items():
            try:
                entries[key] = dict(_fetch(index, region), label=label, status='ok')
            except (urllib.error.URLError, OSError, ValueError, TypeError, KeyError):
                old = ((cache['data'] or {}).get('byIndex') or {}).get(key)
                if old and now - old.get('cachedAt', 0) < 900:
                    entries[key] = dict(old, status='stale')
                else:
                    entries[key] = {'label': label, 'status': 'unavailable'}
            if entries[key]['status'] == 'ok':
                entries[key]['cachedAt'] = now
            if market == 'domestic':
                from domestic_turnover import fetch_turnover
                entries[key]['turnoverIndex'] = fetch_turnover(key, now)
        result = {'source': SOURCE, 'byIndex': entries, 'timeBasis': 'retrieval'}
        cache.update(at=now, data=result)
        # Retry failures after 60 seconds, rather than treating an error as an hour-long cache hit.
        if any(entry['status'] != 'ok' for entry in entries.values()):
            cache['at'] = now - ttl
        return result


def _stale(now, market='us'):
    cache = _caches[market]
    indexes = MARKETS[market][4]
    entries = {}
    for key, (_, label) in indexes.items():
        old = ((cache['data'] or {}).get('byIndex') or {}).get(key)
        entries[key] = dict(old, status='stale') if old and now - old.get('cachedAt', 0) < 900 else {'label': label, 'status': 'unavailable'}
        if entries[key].get('turnoverIndex'):
            entries[key]['turnoverIndex'] = dict(entries[key]['turnoverIndex'], status='stale')
    return {'source': SOURCE, 'byIndex': entries, 'timeBasis': 'retrieval'}
