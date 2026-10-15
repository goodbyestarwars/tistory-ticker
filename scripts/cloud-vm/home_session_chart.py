"""Home price charts: existing US quote observations and actual night minute bars."""
import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import db_schema

US_SPOT = {'NASDAQ_INDEX', 'SP500_INDEX'}
US_FUTURES = {'NASDAQ100', 'SP500'}
SYMBOLS = US_SPOT | US_FUTURES
NY = ZoneInfo('America/New_York')
KST = timezone(timedelta(hours=9))


def session(symbol, moment):
    zone = KST if symbol == 'KOSPI200_NIGHT' else NY
    local = moment.astimezone(zone)
    minute = local.hour * 60 + local.minute
    if symbol in US_SPOT:
        if local.weekday() >= 5 or not 570 <= minute <= 960:
            return None
        start = local.replace(hour=9, minute=30, second=0, microsecond=0)
        duration = 390
    else:
        if symbol == 'KOSPI200_NIGHT':
            if 360 <= minute < 1080:
                return None
            duration = 720
        else:
            if symbol not in US_FUTURES or 1020 < minute < 1080:
                return None
            duration = 1380
        start = local.replace(hour=18, minute=0, second=0, microsecond=0)
        if minute < 1080:
            start -= timedelta(days=1)
        if symbol in US_FUTURES and start.weekday() in (4, 5):
            return None
    elapsed = int((local.timestamp() - start.timestamp()) // 60)
    if not 0 <= elapsed <= duration:
        return None
    return {'date': start.strftime('%Y-%m-%d'), 'start': start.isoformat(),
            'end': (start + timedelta(minutes=duration)).isoformat(),
            'slotCount': duration // 30 + 1, 'slot': elapsed // 30,
            'timeZone': 'Asia/Seoul' if zone == KST else 'America/New_York'}


def record(conn, symbol, quote, now=None):
    if symbol not in SYMBOLS or quote.get('market_status') != 'OPEN':
        return False
    try:
        moment = datetime.fromisoformat(quote['traded_at'].replace('Z', '+00:00'))
        price = float(quote['price'])
        if moment.tzinfo is None or not math.isfinite(price) or price <= 0:
            return False
        now = now or datetime.now(timezone.utc)
        if not -60 <= (now - moment).total_seconds() <= 1200:
            return False
    except (KeyError, ValueError, TypeError):
        return False
    meta = session(symbol, moment)
    if not meta:
        return False
    ts = int(moment.timestamp())
    conn.execute('''INSERT INTO home_session_prices
        (symbol,session,slot,open,high,low,close,ts) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(symbol,session,slot) DO UPDATE SET
        high=MAX(high,excluded.high),low=MIN(low,excluded.low),
        close=CASE WHEN excluded.ts>=ts THEN excluded.close ELSE close END,
        ts=MAX(ts,excluded.ts)''',
        (symbol, meta['date'], meta['slot'], price, price, price, price, ts))
    conn.execute('DELETE FROM home_session_prices WHERE session < ?',
                 ((now - timedelta(days=14)).strftime('%Y-%m-%d'),))
    conn.commit()
    return True


def get_results():
    conn = db_schema.get_conn()
    try:
        output = []
        for symbol in sorted(SYMBOLS):
            rows = conn.execute('''SELECT slot,open,high,low,close,ts FROM home_session_prices
                WHERE symbol=? AND session=(SELECT MAX(session) FROM home_session_prices WHERE symbol=?)
                ORDER BY slot''', (symbol, symbol)).fetchall()
            points = [dict(zip(('slot', 'open', 'high', 'low', 'close', 'ts'), r)) for r in rows]
            meta = session(symbol, datetime.fromtimestamp(points[-1]['ts'], timezone.utc)) if points else None
            output.append(dict(symbol=symbol, rows=points, session=meta,
                               basis='시세 수집 관측값 · 공급자 지연 가능', intervalMinutes=30))
        night = db_schema.load_future_chart_minute(conn, 'KOSPI200_NIGHT')
        valid = []
        for row in night:
            try:
                meta = session('KOSPI200_NIGHT', datetime.fromtimestamp(float(row['ts']), timezone.utc))
                values = [float(row[k]) for k in ('open', 'high', 'low', 'close')]
                if meta and all(math.isfinite(v) and v > 0 for v in values):
                    valid.append((meta, row))
            except (KeyError, ValueError, TypeError, OverflowError):
                continue
        latest = valid[-1][0] if valid else None
        buckets = {}
        for meta, row in valid:
            if meta['date'] != latest['date']:
                continue
            slot = meta['slot']
            if slot not in buckets:
                buckets[slot] = dict(row, slot=slot)
            else:
                point = buckets[slot]
                point.update(high=max(point['high'], row['high']), low=min(point['low'], row['low']),
                             close=row['close'], ts=row['ts'])
        output.append(dict(symbol='KOSPI200_NIGHT', rows=list(buckets.values()), session=latest,
                           basis='기존 실제 분봉 집계', intervalMinutes=30))
        return output
    finally:
        conn.close()
