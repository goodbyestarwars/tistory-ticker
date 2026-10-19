# -*- coding: utf-8 -*-
"""Local real-account entry point. --check is read-only; --run needs dated approval."""
import os
import json
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone

from live_engine import Ledger, readiness, trade_once
from ninepay_signal_client import SignalFeedUnavailable, fetch_signals
from ninepay_trade import trade_signal_once

KST = timezone(timedelta(hours=9))
HERE = os.path.dirname(os.path.abspath(__file__))


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
              signal_trade=trade_signal_once, get_candidates=candidates):
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
        except SignalFeedUnavailable:
            return '9PAY_FEED_UNAVAILABLE'
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
    next_existing_cycle = 0.0
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
                result = run_cycle(client, ledger, daily, HERE, now, existing_due)
            except Exception as exc:
                result = 'ERROR_' + type(exc).__name__
            with open(os.path.join(HERE, 'live_status.json'), 'w', encoding='utf-8') as f:
                json.dump({'checked_at': now.isoformat(), 'state': result}, f)
            if result in ('DISABLED_OR_UNCERTAIN', 'BUY_FILL_UNCONFIRMED',
                          'SELL_FILL_UNCONFIRMED', 'FOREIGN_HOLDINGS') or result.startswith('ERROR_'):
                return 0
        time.sleep(3)


if __name__ == '__main__':
    raise SystemExit(main())
