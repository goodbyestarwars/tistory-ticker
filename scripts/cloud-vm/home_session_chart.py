"""Home price charts: existing US quote observations and actual night minute bars."""
import math
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import db_schema

US_SPOT = {'NASDAQ_INDEX', 'SP500_INDEX'}
US_FUTURES = {'NASDAQ100', 'SP500'}
KR_SPOT = {'KOSPI', 'KOSDAQ'}
SYMBOLS = US_SPOT | US_FUTURES | KR_SPOT
NY = ZoneInfo('America/New_York')
KST = timezone(timedelta(hours=9))


def session(symbol, moment):
    zone = KST if symbol == 'KOSPI200_NIGHT' or symbol in KR_SPOT else NY
    local = moment.astimezone(zone)
    minute = local.hour * 60 + local.minute
    if symbol in US_SPOT | KR_SPOT:
        opening, closing = (540, 930) if symbol in KR_SPOT else (570, 960)
        if local.weekday() >= 5 or not opening <= minute <= closing:
            return None
        if symbol in KR_SPOT:
            import market_clock
            if not market_clock.is_kr_trading_day(local):
                return None
        start = local.replace(hour=opening // 60, minute=opening % 60, second=0, microsecond=0)
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
        moment = datetime.fromisoformat(str(quote.get('traded_at') or '').replace('Z', '+00:00'))
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
    # Keep the actual quote's previous-close basis with its own session.
    # Missing change is not zero; never borrow a reference from another day.
    try:
        change = float(quote['change'])
        reference = price - change
        if math.isfinite(change) and math.isfinite(reference) and reference > 0:
            conn.execute("""INSERT INTO home_session_reference(symbol,session,reference,ts)
                VALUES(?,?,?,?) ON CONFLICT(symbol,session) DO UPDATE SET
                reference=excluded.reference,ts=excluded.ts WHERE excluded.ts>=ts""",
                (symbol, meta['date'], reference, ts))
    except (KeyError, TypeError, ValueError):
        pass
    conn.execute('DELETE FROM home_session_reference WHERE session < ?',
                 ((now - timedelta(days=14)).strftime('%Y-%m-%d'),))
    conn.commit()
    return True


# ---- 야간선물 시세 관측(2026-10-22) ----
# 야간선물 분봉(KIS 분봉 조회)이 자정 이후 멈춰 홈 차트가 23:58에서 끊긴 일이 있었다(시세 틱은 06:00까지 계속 들어왔다).
# 그래서 이미 잘 들어오는 실시간 시세 틱을 30분 구간 관측값으로도 남기고, 분봉이 없는 구간만 차트에서 이 관측값으로 채운다.
# 틱마다 DB 에 쓰지 않도록 구간별로 모아 두었다가 구간이 바뀌거나 _NIGHT_FLUSH_SEC 가 지나면 한 번에 쓴다.
_NIGHT = 'KOSPI200_NIGHT'
_NIGHT_FLUSH_SEC = 10.0
_night_pending = None
_night_flushed_at = 0.0


def _flush_night(conn):
    global _night_pending, _night_flushed_at
    p = _night_pending
    if not p:
        return False
    conn.execute('''INSERT INTO home_session_prices
        (symbol,session,slot,open,high,low,close,ts) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(symbol,session,slot) DO UPDATE SET
        high=MAX(high,excluded.high),low=MIN(low,excluded.low),
        close=CASE WHEN excluded.ts>=ts THEN excluded.close ELSE close END,
        ts=MAX(ts,excluded.ts)''',
        (_NIGHT, p['session'], p['slot'], p['open'], p['high'], p['low'], p['close'], p['ts']))
    conn.commit()
    _night_flushed_at = time.monotonic()
    p['dirty'] = False
    return True


def record_night_tick(conn, price, moment=None, flush_sec=None):
    """야간선물 실시간 틱 가격을 30분 구간 관측값으로 쌓는다. 야간 세션 시간 밖·비정상 값은 버린다."""
    global _night_pending
    try:
        price = float(price)
    except (TypeError, ValueError):
        return False
    if not math.isfinite(price) or price <= 0:
        return False
    moment = moment or datetime.now(timezone.utc)
    meta = session(_NIGHT, moment)
    if not meta:
        return False
    ts = int(moment.timestamp())
    p = _night_pending
    if p and (p['session'], p['slot']) == (meta['date'], meta['slot']):
        p['high'] = max(p['high'], price)
        p['low'] = min(p['low'], price)
        p['close'] = price
        p['ts'] = max(p['ts'], ts)
        p['dirty'] = True
    else:
        if p and p.get('dirty'):
            _flush_night(conn)           # 이전 구간을 먼저 저장
        _night_pending = dict(session=meta['date'], slot=meta['slot'], open=price, high=price, low=price,
                              close=price, ts=ts, dirty=True)
        _flush_night(conn)               # 새 구간의 첫 관측은 바로 저장
        return True
    limit = _NIGHT_FLUSH_SEC if flush_sec is None else flush_sec
    if time.monotonic() - _night_flushed_at >= limit:
        _flush_night(conn)
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
            ref = conn.execute('SELECT reference FROM home_session_reference WHERE symbol=? AND session=?',
                               (symbol, meta['date'])).fetchone() if meta else None
            output.append(dict(symbol=symbol, rows=points, session=meta,
                               reference=ref[0] if ref else None,
                               basis='시세 수집 관측값 · 공급자 지연 가능', intervalMinutes=30))
        night = db_schema.load_future_chart_minute(conn, 'KOSPI200_NIGHT')
        # Preserve the previous home chart's live-price tail between minute
        # collections. Only a newer quote from the very same session is valid.
        quote = next((p for p in db_schema.load_all_future_prices(conn)
                      if p['symbol'] == 'KOSPI200_NIGHT'), None)
        if night and quote:
            try:
                moment = datetime.fromisoformat(quote['updated_at'].replace('Z', '+00:00'))
                ts, price = int(moment.timestamp()), float(quote['price'])
                old_session = session('KOSPI200_NIGHT', datetime.fromtimestamp(night[-1]['ts'], timezone.utc))
                quote_session = session('KOSPI200_NIGHT', moment)
                if (moment.tzinfo and old_session and quote_session
                        and old_session['date'] == quote_session['date']
                        and ts > night[-1]['ts'] and math.isfinite(price) and price > 0
                        and -60 <= (datetime.now(timezone.utc) - moment).total_seconds() <= 1200):
                    night.append(dict(ts=ts, open=price, high=price, low=price, close=price))
            except (KeyError, TypeError, ValueError, OverflowError):
                pass
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
        # 분봉이 없는 구간은 실시간 시세 관측값으로 채운다. 분봉이 있는 구간은 분봉을 우선한다.
        if not latest:
            last_tick = conn.execute('SELECT MAX(ts) FROM home_session_prices WHERE symbol=?', (_NIGHT,)).fetchone()
            if last_tick and last_tick[0]:
                latest = session(_NIGHT, datetime.fromtimestamp(float(last_tick[0]), timezone.utc))
        if latest:
            for slot, o, h, l, c, ts in conn.execute('''SELECT slot,open,high,low,close,ts FROM home_session_prices
                    WHERE symbol=? AND session=? ORDER BY slot''', (_NIGHT, latest['date'])).fetchall():
                if slot not in buckets:
                    buckets[slot] = dict(ts=ts, open=o, high=h, low=l, close=c, slot=slot)
        # 야간 차트 기준선: 같은 세션의 시세가 담고 있는 전일 종가(price - change). 다른 세션의 값은 빌리지 않는다.
        # 이 값이 없으면 홈 차트가 모든 막대를 중립(회색)으로 칠했다(2026-10-23 확인).
        night_reference = None
        try:
            if quote and latest and quote.get('change') is not None:
                quote_session = session('KOSPI200_NIGHT', datetime.fromisoformat(str(quote['updated_at']).replace('Z', '+00:00')))
                ref = float(quote['price']) - float(quote['change'])
                if quote_session and quote_session['date'] == latest['date'] and math.isfinite(ref) and ref > 0:
                    night_reference = ref
        except (KeyError, TypeError, ValueError):
            night_reference = None
        output.append(dict(symbol='KOSPI200_NIGHT', rows=sorted(buckets.values(), key=lambda r: r['slot']), session=latest,
                           reference=night_reference,
                           basis='실제 분봉 + 분봉이 없는 구간은 시세 수집 관측값 + 같은 세션 최신 시세', intervalMinutes=30))
        return output
    finally:
        conn.close()
