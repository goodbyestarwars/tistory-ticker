"""Read-only 9Pay live signal intake. No broker or order imports.

The VM health endpoint carries research signals. This adapter accepts only
fresh, complete events and fails closed on partial/outdated rank coverage.
"""

from datetime import datetime, timedelta, timezone
import json
import re
import time
from urllib.request import urlopen

KST = timezone(timedelta(hours=9))
CODE = re.compile(r'^\d{6}$')
SIGNAL_ID = re.compile(r'^\d{4}-\d{2}-\d{2}:\d{6}$')
URL = 'https://goodbyestar.cloud/health/realtime'
MAX_SIGNAL_AGE_SEC = 10
MAX_RANK_AGE_SEC = 120


class SignalFeedUnavailable(RuntimeError):
    pass


def valid_signals(payload, now=None):
    now = time.time() if now is None else float(now)
    root = payload.get('data') if isinstance(payload, dict) else None
    state = root.get('ninePayResearch') if isinstance(root, dict) else None
    if not isinstance(state, dict) or not state.get('running') or not state.get('active'):
        raise SignalFeedUnavailable('observer inactive')
    if state.get('rankError') or state.get('amountFallback'):
        raise SignalFeedUnavailable('ranking incomplete')
    try:
        rank_at = datetime.fromisoformat(state['rankAt'].replace('Z', '+00:00')).timestamp()
    except (KeyError, AttributeError, TypeError, ValueError):
        raise SignalFeedUnavailable('ranking timestamp missing') from None
    if not 0 <= now - rank_at <= MAX_RANK_AGE_SEC:
        raise SignalFeedUnavailable('ranking stale')
    today = datetime.fromtimestamp(now, KST).strftime('%Y-%m-%d')
    accepted = []
    for item in state.get('signals') or []:
        if not isinstance(item, dict):
            continue
        code, sid = str(item.get('code') or ''), str(item.get('signalId') or '')
        if not CODE.fullmatch(code) or not SIGNAL_ID.fullmatch(sid) or sid != today + ':' + code:
            continue
        if item.get('volumeMissing') is not False:
            continue
        if item.get('source') not in ('Kiwoom WebSocket', 'KIS rank polling'):
            continue
        try:
            at, price = float(item['at']), float(item['price'])
        except (KeyError, TypeError, ValueError):
            continue
        if not 0 <= now - at <= MAX_SIGNAL_AGE_SEC or price <= 0:
            continue
        accepted.append({'signalId': sid, 'code': code, 'at': at,
                         'price': price, 'source': item['source']})
    return accepted


def fetch_signals(url=URL, now=None, opener=urlopen):
    try:
        with opener(url, timeout=2) as response:
            payload = json.load(response)
    except Exception as exc:
        raise SignalFeedUnavailable(type(exc).__name__) from None
    return valid_signals(payload, now)
