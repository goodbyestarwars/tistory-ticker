"""On-demand, persistent adjusted-price history for the two domestic stock charts."""
import logging
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import db_schema
import kiwoom_market

KST = timezone(timedelta(hours=9))
MAX_ROWS = 1550
_gate = threading.BoundedSemaphore(1)
_locks = {}
_locks_guard = threading.Lock()


class ChartHistoryBusy(Exception):
    """Cold integrated history could not acquire the existing upstream slot."""


def _connect(market):
    if market == 'KRX':
        return db_schema.get_conn()
    if market != 'UN':
        raise ValueError('invalid chart market')
    conn = db_schema.get_conn(str(Path(db_schema.DB_FILE).with_name('ohlc_chart_un.db')))
    try:
        conn.executescript(db_schema.CHART_HISTORY_SCHEMA)
        return conn
    except Exception:
        conn.close()
        raise


def _un_recent(now, checked_at):
    if not checked_at or checked_at > now:
        return False
    age = now - checked_at
    start = now.replace(hour=8, minute=0, second=0, microsecond=0)
    final = now.replace(hour=20, minute=10, second=0, microsecond=0)
    if now.weekday() < 5 and start <= now < final:
        return checked_at >= start and age < timedelta(minutes=5)
    if now.weekday() < 5 and now >= final:
        return checked_at >= final and age < timedelta(minutes=60)
    return age < timedelta(minutes=60)


def _fetch(token_getter, code, pages, market):
    kwargs = {'max_days': None, 'max_pages': pages}
    if market == 'UN':
        kwargs['market'] = 'UN'
    return kiwoom_market.fetch_daily_ohlc(token_getter(), code, **kwargs)


def _lock(code):
    with _locks_guard:
        return _locks.setdefault(code, threading.Lock())


def _load(conn, code):
    rows = conn.execute('SELECT date,open,high,low,close,volume FROM chart_daily_prices '
                        'WHERE code=? ORDER BY date', (code,)).fetchall()
    return [dict(zip(('date', 'open', 'high', 'low', 'close', 'volume'), r)) for r in rows]


def _valid(row):
    try:
        o, h, l, c, v = (float(row[k]) for k in ('open', 'high', 'low', 'close', 'volume'))
        datetime.strptime(row['date'], '%Y-%m-%d')
        return l > 0 and l <= min(o, c) <= max(o, c) <= h and v >= 0
    except (ValueError, TypeError, KeyError):
        return False


def _save(conn, code, rows):
    valid = [r for r in rows if _valid(r)]
    if valid:
        conn.executemany('INSERT INTO chart_daily_prices VALUES (?,?,?,?,?,?,?) '
                         'ON CONFLICT(code,date) DO UPDATE SET open=excluded.open,high=excluded.high,'
                         'low=excluded.low,close=excluded.close,volume=excluded.volume',
                         [(code, r['date'], r['open'], r['high'], r['low'], r['close'], r['volume']) for r in valid])
        # Keep only five calendar years plus indicator warm-up, bounded for short-listed stocks.
        cutoff = (datetime.now(KST).date() - timedelta(days=5 * 366 + 260)).isoformat()
        conn.execute('DELETE FROM chart_daily_prices WHERE code=? AND date<?', (code, cutoff))
        conn.execute('DELETE FROM chart_daily_prices WHERE code=? AND date NOT IN '
                     '(SELECT date FROM chart_daily_prices WHERE code=? ORDER BY date DESC LIMIT ?)',
                     (code, code, MAX_ROWS))
        conn.commit()


def get_daily(code, extended=False, token_getter=None, *, market='KRX'):
    """Read SQLite first; one stock at a time may request missing Kiwoom pages."""
    with _lock((market, code)):
        conn = _connect(market)
        try:
            conn.execute('PRAGMA busy_timeout=5000')
            rows = _load(conn, code)
            if not rows and market == 'KRX':
                # The batch cache has identical Kiwoom adjusted-price policy.
                rows = db_schema.load_daily_prices(conn, code)
                _save(conn, code, rows)
                rows = _load(conn, code)
            now = datetime.now(KST)
            state = conn.execute('SELECT extended,checked_at FROM chart_history_state WHERE code=?',
                                 (code,)).fetchone()
            last_date = rows[-1]['date'] if rows else None
            # Today's candle changes during trading. A matching date alone does not
            # make it fresh; use the last successful check as the refresh boundary.
            checked_at = datetime.fromisoformat(state[1]) if state and state[1] else None
            refresh_minutes = 5 if now.weekday() < 5 and 9 <= now.hour < 16 else 60
            recent_check = bool(checked_at and now - checked_at < timedelta(minutes=refresh_minutes))
            fresh = (last_date == now.date().isoformat() and recent_check) or (
                now.hour < 9 and last_date == (now.date() - timedelta(days=1)).isoformat())
            if market == 'UN':
                recent_check = _un_recent(now, checked_at)
                fresh = recent_check
            needs_history = extended and not (state and state[0])
            needs_latest = not fresh and not recent_check
            quota_ok = not needs_history or conn.execute(
                'SELECT COUNT(*) FROM chart_history_fetches WHERE date=?',
                (now.date().isoformat(),)).fetchone()[0] < 20
            if market == 'UN' and not quota_ok:
                needs_history = False
                quota_ok = True
            needs_fetch = quota_ok and (needs_history or needs_latest or not rows)
            cold_integrated = market == 'UN' and not rows
            acquired = needs_fetch and (_gate.acquire(timeout=3) if cold_integrated else _gate.acquire(blocking=False))
            if needs_fetch and cold_integrated and not acquired:
                raise ChartHistoryBusy()
            if acquired:
                try:
                    fetched = _fetch(token_getter, code, 3 if needs_history else 1, market)
                    if market == 'UN' and (not fetched or not all(_valid(row) for row in fetched)):
                        raise ValueError('invalid integrated daily response')
                    # A split can revise adjusted prices across the entire series. Do not
                    # combine pre-split old pages with newly adjusted recent pages.
                    if not needs_history and state and state[0] and fetched:
                        stored = {r['date']: r['close'] for r in rows}
                        revised = any(date in stored and stored[date] and
                                      abs(float(r['close']) / float(stored[date]) - 1) > 0.01
                                      for r in fetched for date in [r['date']])
                        if revised:
                            fetched = _fetch(token_getter, code, 3, market)
                            if market == 'UN' and (not fetched or not all(_valid(row) for row in fetched)):
                                raise ValueError('invalid integrated history response')
                    _save(conn, code, fetched)
                    conn.execute('INSERT INTO chart_history_state(code,earliest,extended,checked_at) '
                                 'VALUES (?,?,?,?) ON CONFLICT(code) DO UPDATE SET '
                                 'earliest=excluded.earliest,extended=MAX(extended,excluded.extended),'
                                 'checked_at=excluded.checked_at',
                                 (code, fetched[0]['date'] if fetched else None,
                                  int(bool(needs_history and fetched)), now.isoformat()))
                    if needs_history and fetched:
                        conn.execute('INSERT OR IGNORE INTO chart_history_fetches VALUES (?,?)',
                                     (now.date().isoformat(), code))
                        conn.execute('DELETE FROM chart_history_fetches WHERE date<?',
                                     ((now.date() - timedelta(days=7)).isoformat(),))
                    conn.commit()
                    rows = _load(conn, code)
                except Exception as exc:
                    logging.getLogger('chart_history').warning('history %s: %s', code, type(exc).__name__)
                finally:
                    _gate.release()
            return rows
        finally:
            conn.close()


def history_attempted(code, *, market='KRX'):
    conn = _connect(market)
    try:
        row = conn.execute('SELECT extended FROM chart_history_state WHERE code=?', (code,)).fetchone()
        return bool(row and row[0])
    finally:
        conn.close()
