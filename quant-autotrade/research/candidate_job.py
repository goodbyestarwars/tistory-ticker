# -*- coding: utf-8 -*-
"""Read-only nightly scanner ingestion. No paper trades, broker access, or orders."""
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import candidate_gen as cg

KST = timezone(timedelta(hours=9))


def run(conn, now_fn=None, sleep_fn=time.sleep, interval=60):
    now_fn = now_fn or (lambda: datetime.now(KST))
    start = now_fn()
    end = start.replace(hour=8, minute=15, second=0, microsecond=0)
    if start >= end:
        end += timedelta(days=1)
    while now_fn() < end:
        now = now_fn()
        try:
            ok, reason, created = cg.generate(conn, cg.fetch_scan(), now, now_epoch=now.timestamp())
            if ok:
                return {'ok': True, 'reason': reason, 'created': created}
        except Exception as exc:
            reason = type(exc).__name__
        sleep_fn(interval)
    return {'ok': False, 'reason': reason if 'reason' in locals() else 'NO_SCAN', 'created': 0}


def main():
    root = os.environ.get('AUTOTRADER_DIR') or os.path.expanduser('~/autotrader')
    out_dir = os.path.join(root, 'research')
    os.makedirs(out_dir, exist_ok=True)
    db = os.path.join(out_dir, 'research.db')
    conn = cg.connect(db)
    try:
        result = run(conn)
        print('candidate ingestion: %s (%s), new=%d' % ('ok' if result['ok'] else 'waiting ended', result['reason'], result['created']))
    finally:
        conn.close()


if __name__ == '__main__':
    main()
