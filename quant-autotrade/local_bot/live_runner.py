# -*- coding: utf-8 -*-
"""Local real-account entry point. --check is read-only; --run needs dated approval."""
import os
import json
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone

from kiwoom import KiwoomClient
from live_engine import Ledger, readiness, trade_once
from main import load_env

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


def main():
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
        # The approval gate is checked again inside each cycle before every order.
        if 540 <= now.hour * 60 + now.minute <= 920:
            try:
                rows = candidates(now)
                result = trade_once(client, ledger, rows, daily, HERE, now)
            except Exception as exc:
                rows = []
                result = 'ERROR_' + type(exc).__name__
            with open(os.path.join(HERE, 'live_status.json'), 'w', encoding='utf-8') as f:
                json.dump({'checked_at': now.isoformat(), 'state': result,
                           'candidate_count': len(rows)}, f)
            if result in ('DISABLED_OR_UNCERTAIN', 'BUY_FILL_UNCONFIRMED',
                          'SELL_FILL_UNCONFIRMED', 'FOREIGN_HOLDINGS') or result.startswith('ERROR_'):
                return 0
        time.sleep(30)


if __name__ == '__main__':
    raise SystemExit(main())
