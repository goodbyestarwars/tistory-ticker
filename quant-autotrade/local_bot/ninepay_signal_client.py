"""Read-only 9Pay live signal intake. No broker or order imports.

The VM health endpoint carries research signals. This adapter accepts only
fresh, complete events and fails closed on partial/outdated rank coverage.
"""

from datetime import datetime, timedelta, timezone
import json
import math
import re
import time
from urllib.request import urlopen
from urllib.error import HTTPError

KST = timezone(timedelta(hours=9))
CODE = re.compile(r'^\d{6}$')
SIGNAL_ID = re.compile(r'^\d{4}-\d{2}-\d{2}:\d{6}$')
URL = 'https://goodbyestar.cloud/health/9pay'
MAX_SIGNAL_AGE_SEC = 10
ENTRY_END_MINUTE = 14 * 60  # must match the VM observer's cutoff (was 09:30)
MAX_RANK_AGE_SEC = 120
RULE_VERSION = 'ab70-v1'


def valid_evidence(item, now):
    """Require current A/B evidence, observed before the 14:00 cutoff (2026-10-23: was 09:30)."""
    try:
        first = float(item['first70At'])
        at = float(item['at'])
        price = float(item['price'])
        ratio = float(item['volumeRatio'])
        first_day = datetime.fromtimestamp(first, KST)
        signal_day = datetime.fromtimestamp(at, KST)
    except (KeyError, TypeError, ValueError, OverflowError, OSError):
        return False
    branches = item.get('branches')
    return (item.get('ruleVersion') == RULE_VERSION
            and item.get('volumeMissing') is False
            # Observer contract: explicit null = no exclusion reason; string = excluded.
            # A missing field remains invalid, rather than silently authorizing entry.
            and 'excluded' in item and (item['excluded'] is None or item['excluded'] is False)
            and isinstance(branches, list) and bool(branches)
            and all(b in ('A', 'B') for b in branches)
            and all(math.isfinite(v) for v in (first, at, price, ratio))
            and price > 0 and ratio >= .7 and first <= at <= now
            and 0 <= now-at <= MAX_SIGNAL_AGE_SEC
            and first_day.date() == signal_day.date() == datetime.fromtimestamp(now, KST).date()
            and 540 <= first_day.hour * 60 + first_day.minute < ENTRY_END_MINUTE)


class SignalFeedUnavailable(RuntimeError):
    def __init__(self, reason='', *, http_status=None):
        super().__init__(reason)
        self.http_status = http_status


def valid_signals(payload, now=None):
    now = time.time() if now is None else float(now)
    root = payload.get('data') if isinstance(payload, dict) else None
    state = root.get('ninePayResearch') if isinstance(root, dict) else None
    if not isinstance(state, dict) or not state.get('running') or not state.get('active'):
        raise SignalFeedUnavailable('observer inactive')
    if state.get('ruleVersion') != RULE_VERSION or state.get('persistenceError') or state.get('queueDropped'):
        raise SignalFeedUnavailable('rule/evidence unavailable')
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
        if not valid_evidence(item, now):
            continue
        if item.get('source') not in ('Kiwoom WebSocket', 'KIS rank polling'):
            continue
        try:
            at, price = float(item['at']), float(item['price'])
        except (KeyError, TypeError, ValueError):
            continue
        if not 0 <= now - at <= MAX_SIGNAL_AGE_SEC or price <= 0:
            continue
        accepted.append({key: item[key] for key in (
            'signalId', 'code', 'at', 'price', 'source', 'ruleVersion',
            'volumeMissing', 'excluded', 'branches', 'first70At', 'volumeRatio')})
    return accepted


def fetch_signals(url=URL, now=None, opener=urlopen):
    try:
        with opener(url, timeout=2) as response:
            payload = json.load(response)
    except HTTPError as exc:
        raise SignalFeedUnavailable('HTTPError', http_status=exc.code) from None
    except Exception as exc:
        raise SignalFeedUnavailable(type(exc).__name__) from None
    return valid_signals(payload, now)
