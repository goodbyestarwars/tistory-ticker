"""One-off UN daily history staging. Never modifies the production database.

Run only on the existing Oracle host with its existing Kiwoom credentials.
No scheduler, scanner, trade feed or automatic promotion is installed.
"""
import argparse
import math
import os
import re
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import db_schema
import kiwoom_client
import kiwoom_market

KST = timezone(timedelta(hours=9))
FIELDS = ('date', 'open', 'high', 'low', 'close', 'volume')
SCHEMA = """
CREATE TABLE IF NOT EXISTS integrated_daily (
    code TEXT NOT NULL, date TEXT NOT NULL, open REAL NOT NULL,
    high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
    volume REAL NOT NULL, PRIMARY KEY(code,date)
);
CREATE TABLE IF NOT EXISTS integrated_status (
    code TEXT PRIMARY KEY, basis TEXT NOT NULL, state TEXT NOT NULL,
    row_count INTEGER NOT NULL, missing_count INTEGER NOT NULL,
    checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS integrated_meta (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
);
"""


def source_dates(conn, code, basis):
    return {r[0] for r in conn.execute(
        'SELECT date FROM daily_prices WHERE code=? AND date<=? UNION '
        'SELECT date FROM chart_daily_prices WHERE code=? AND date<=?',
        (code, basis, code, basis))}


def checked_rows(rows, basis, required):
    """Require complete coverage of existing dates; no silent partial promotion."""
    selected = []
    previous = ''
    for r in rows:
        d = r['date']
        if date.fromisoformat(d).isoformat() != d or d <= previous:
            raise ValueError('invalid or unordered date')
        previous = d
        if d > basis:
            continue
        o, h, l, c, v = (r[k] for k in FIELDS[1:])
        if any(isinstance(x, bool) or not isinstance(x, (int, float)) or
               not math.isfinite(x) for x in (o, h, l, c, v)):
            raise ValueError('invalid numeric field')
        if not (0 < l <= min(o, c) <= max(o, c) <= h and v >= 0):
            raise ValueError('invalid OHLCV')
        selected.append(r)
    actual = {r['date'] for r in selected}
    # A suspended/delisted name may lack the target day. Record as incomplete;
    # never synthesize its latest close or mark it ready.
    missing = required - actual
    if basis not in actual:
        missing.add(basis)
    return selected, missing


def open_stage(source, stage, basis):
    source, stage = Path(source).resolve(), Path(stage).resolve()
    if source == stage or (stage.exists() and source.samefile(stage)):
        raise ValueError('staging path must not be production DB')
    conn = sqlite3.connect(stage, timeout=5)
    try:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        if tables - {'integrated_daily', 'integrated_status', 'integrated_meta'}:
            raise ValueError('not a dedicated staging database')
        conn.executescript(SCHEMA)
        meta = dict(conn.execute('SELECT key,value FROM integrated_meta'))
        if meta and meta != {'market': 'UN', 'provider': 'kiwoom-ka10081',
                             'basis': basis}:
            raise ValueError('stage metadata mismatch; use a new file')
        with conn:
            conn.executemany('INSERT OR IGNORE INTO integrated_meta VALUES (?,?)',
                             [('market', 'UN'), ('provider', 'kiwoom-ka10081'),
                              ('basis', basis)])
        return conn
    except Exception:
        conn.close()
        raise


def save_result(conn, code, basis, rows, missing, state):
    with conn:
        if state == 'coverage-ok':
            conn.execute('DELETE FROM integrated_daily WHERE code=?', (code,))
            conn.executemany('INSERT INTO integrated_daily VALUES (?,?,?,?,?,?,?)',
                             [(code, *(r[k] for k in FIELDS)) for r in rows])
        conn.execute('INSERT OR REPLACE INTO integrated_status VALUES (?,?,?,?,?,?)',
                     (code, basis, state, len(rows), len(missing),
                      datetime.now(KST).isoformat()))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', default=str(db_schema.DB_FILE))
    p.add_argument('--stage', required=True)
    p.add_argument('--basis', required=True, help='Confirmed trading day YYYY-MM-DD')
    p.add_argument('--code', action='append', help='Limit to explicit sample codes')
    p.add_argument('--limit', type=int, help='Bound number of symbols for a test')
    args = p.parse_args()
    target = date.fromisoformat(args.basis)
    now = datetime.now(KST)
    if target > now.date() or (target == now.date() and
                              (now.hour, now.minute) < (20, 10)):
        p.error('basis must be after the final market session')
    if args.limit is not None and args.limit < 1:
        p.error('limit must be positive')
    if args.code and any(not re.fullmatch(r'[0-9A-Z]{6}', c) for c in args.code):
        p.error('invalid base code')
    # Reuse the existing local environment reader, not a new secret path.
    from daily_scan import load_dotenv
    load_dotenv()
    key, secret = os.environ.get('KIWOOM_APPKEY'), os.environ.get('KIWOOM_SECRETKEY')
    if not key or not secret:
        p.error('existing Kiwoom credentials unavailable')
    source = db_schema.get_conn(args.source, read_only=True)
    stage = None
    try:
        stage = open_stage(args.source, args.stage, args.basis)
        codes = [r[0] for r in source.execute(
            'SELECT code FROM daily_prices WHERE date<=? UNION '
            'SELECT code FROM chart_daily_prices WHERE date<=? ORDER BY code',
            (args.basis, args.basis))]
        if args.code:
            absent = set(args.code) - set(codes)
            if absent:
                p.error('sample code not present in source history')
            codes = [c for c in codes if c in args.code]
        if args.limit:
            codes = codes[:args.limit]
        if not codes:
            p.error('source universe is empty')
        counts = {'coverage-ok': 0, 'incomplete': 0, 'failed': 0}
        for code in codes:
            required = source_dates(source, code, args.basis)
            # Revalidate staged date coverage on each resume.
            existing = {r[0] for r in stage.execute(
                'SELECT date FROM integrated_daily WHERE code=?', (code,))}
            status = stage.execute('SELECT state FROM integrated_status WHERE code=?',
                                   (code,)).fetchone()
            if status and status[0] == 'coverage-ok' and required | {args.basis} <= existing:
                counts['coverage-ok'] += 1
                continue
            try:
                token = kiwoom_client.get_token(key, secret)
                data = kiwoom_market.fetch_daily_ohlc(
                    token, code, max_days=None, max_pages=5, market='UN')
                rows, missing = checked_rows(data, args.basis, required)
                state = 'incomplete' if missing else 'coverage-ok'
                save_result(stage, code, args.basis, rows, missing, state)
            except Exception as exc:
                state = 'failed'
                save_result(stage, code, args.basis, [], required, state)
                print(code, type(exc).__name__, flush=True)
            finally:
                time.sleep(.35)
            counts[state] += 1
        print('UN staging, source symbols:', len(codes), counts,
              'coverage only; no market reconciliation or production promotion', flush=True)
        return 0 if counts['coverage-ok'] == len(codes) else 1
    finally:
        if stage is not None:
            stage.close()
        source.close()


if __name__ == '__main__':
    raise SystemExit(main())
