# -*- coding: utf-8 -*-
"""Local real-account entry point. --check is read-only; --run needs dated approval."""
import os
import json
import sqlite3
import sys
import time
from urllib.error import URLError
from http.client import RemoteDisconnected
from datetime import datetime, timedelta, timezone

from live_engine import Ledger, readiness, trade_once
from ninepay_signal_client import SignalFeedUnavailable, fetch_signals
from ninepay_trade import trade_signal_once

KST = timezone(timedelta(hours=9))
HERE = os.path.dirname(os.path.abspath(__file__))


class FeedDiagnostics:
    """Bounded transition log with fixed reasons only; never stores response bodies."""
    REASONS = frozenset(('observer inactive', 'rule/evidence unavailable', 'ranking incomplete',
                         'ranking timestamp missing', 'ranking stale', 'HTTPError', 'URLError',
                         'TimeoutError', 'JSONDecodeError', 'ConnectionResetError',
                         'RemoteDisconnected', 'SSLError', 'OSError'))

    def __init__(self, folder, clock=None):
        self.folder = folder
        self.clock = clock or (lambda: datetime.now(KST))
        self.latest = {}
        self._last_key = None
        self._last_at = 0

    def __call__(self, state, error=None):
        now = self.clock()
        reason = str(error) if error is not None else None
        if error is not None and reason not in self.REASONS:
            reason = 'unclassified'
        status = getattr(error, 'http_status', None)
        status = status if isinstance(status, int) and 100 <= status <= 599 else None
        self.latest = {'checked_at': now.isoformat(), 'state': state,
                       'reason': reason, 'http_status': status}
        key = (now.date(), state, reason, status)
        if key == self._last_key and (state == 'OK' or now.timestamp() - self._last_at < 60):
            return
        try:
            folder = os.path.join(self.folder, 'logs')
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, 'ninepay-feed-' + now.strftime('%Y%m%d') + '.jsonl')
            if os.path.exists(path) and os.path.getsize(path) > 1024 * 1024:
                os.replace(path, path + '.1')
            with open(path, 'a', encoding='utf-8') as stream:
                stream.write(json.dumps(self.latest, ensure_ascii=False) + '\n')
            self._last_key, self._last_at = key, now.timestamp()
        except OSError:
            pass  # Diagnostics must never stop position/exit checks.


def research_path():
    installed = os.path.join(HERE, 'research_app', 'quant-autotrade', 'research')
    return installed if os.path.exists(installed) else os.path.abspath(os.path.join(HERE, '..', 'research'))


def candidates(now):
    import krx_calendar
    if not krx_calendar.is_trading_day(now.date()):
        return []
    expected = krx_calendar.prev_trading_day(now.date()).isoformat()
    path = os.path.join(HERE, 'research', 'research.db')
    if not os.path.exists(path):
        return []
    with sqlite3.connect(path) as db:
        db.row_factory = sqlite3.Row
        return [dict(r) for r in db.execute(
            "SELECT scan_date,scanner,code,base_price,status FROM candidates "
            "WHERE scan_date=? AND status='NEW'", (expected,))]


def run_cycle(client, ledger, daily, folder, now, existing_due, *,
              engine_cycle=trade_once, signal_fetch=fetch_signals,
              signal_trade=trade_signal_once, get_candidates=candidates, feed_report=None):
    """Single runner: exits once per 30s, then 9Pay, then legacy entries.

    A failed 9Pay feed blocks legacy entries while 9Pay is enabled, but never
    prevents the scheduled exit check. No separate ledger/budget is created.
    """
    state = 'WAIT'
    if existing_due:
        state = engine_cycle(client, ledger, [], daily, folder, now,
                             allow_entries=False)
        if state != 'EXITS_CHECKED':
            return state
    if os.environ.get('NINEPAY_LIVE_TRADING') == '1':
        try:
            signals = signal_fetch(now=now.timestamp())
        except SignalFeedUnavailable as exc:
            if feed_report is not None:
                feed_report('UNAVAILABLE', exc)
            return '9PAY_FEED_UNAVAILABLE'
        if feed_report is not None:
            feed_report('OK')
        for signal in signals:
            state = signal_trade(client, ledger, signal, folder, now)
            if state != '9PAY_BUY_SENT':
                ledger.skip(now.strftime('%Y-%m-%d'), signal.get('code') or '*',
                            '9PAY_' + state, 'signal_id=' + str(signal.get('signalId') or ''))
            if state in ('9PAY_BUY_SENT', 'DISABLED_OR_UNCERTAIN', 'PENDING_ORDERS',
                         'BUY_FILL_UNCONFIRMED', 'SELL_FILL_UNCONFIRMED', 'FOREIGN_HOLDINGS'):
                return state
    if existing_due:
        rows = get_candidates(now)
        return engine_cycle(client, ledger, rows, daily, folder, now,
                            manage_exits=False)
    return state


def cycle_error_state(exc, ledger):
    """Retry transport failures only before any uncertain order; never resend orders."""
    if isinstance(exc, (TimeoutError, ConnectionError, URLError, RemoteDisconnected)):
        if ledger.has_uncertain():
            return 'DISABLED_OR_UNCERTAIN'
        return 'NETWORK_RETRY_' + type(exc).__name__
    return 'ERROR_' + type(exc).__name__


def main():
    from live_kiwoom import KiwoomClient
    from main import load_env
    load_env()
    if research_path() not in sys.path:
        sys.path.insert(0, research_path())
    client = KiwoomClient(os.environ.get('KIWOOM_APPKEY'), os.environ.get('KIWOOM_SECRETKEY'))
    if '--check' in sys.argv:
        state = readiness(client, HERE, datetime.now(KST))
        for key, val in state.items():
            print('%s: %s' % (key, 'OK' if val else 'WAIT'))
        return 0
    if '--run' not in sys.argv:
        raise SystemExit('Use --check or --run')
    import krx_calendar
    ledger = Ledger(os.path.join(HERE, 'live_orders.db'))
    daily_cache = {}
    feed_report = FeedDiagnostics(HERE)
    next_existing_cycle = 0.0
    result = 'WAIT'
    def daily(code):
        if code not in daily_cache:
            daily_cache[code] = client.daily(code)
        return daily_cache[code]
    while True:
        now = datetime.now(KST)
        if now.hour > 15 or (now.hour == 15 and now.minute > 20) or now.hour < 8:
            return 0
        if not krx_calendar.is_trading_day(now.date()):
            return 0
        if 540 <= now.hour * 60 + now.minute <= 920:
            existing_due = time.monotonic() >= next_existing_cycle
            if existing_due:
                next_existing_cycle = time.monotonic() + 30
            try:
                result = run_cycle(client, ledger, daily, HERE, now, existing_due,
                                   feed_report=feed_report)
            except Exception as exc:
                result = cycle_error_state(exc, ledger)
                next_existing_cycle = 0.0
            with open(os.path.join(HERE, 'live_status.json'), 'w', encoding='utf-8') as f:
                json.dump({'checked_at': now.isoformat(), 'state': result,
                           'feed': feed_report.latest}, f)
            if result in ('DISABLED_OR_UNCERTAIN', 'BUY_FILL_UNCONFIRMED',
                          'SELL_FILL_UNCONFIRMED', 'FOREIGN_HOLDINGS') or result.startswith('ERROR_'):
                return 0
        time.sleep(15 if result.startswith('NETWORK_RETRY_') else 3)


if __name__ == '__main__':
    raise SystemExit(main())
