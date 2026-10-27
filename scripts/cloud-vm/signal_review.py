"""Read-only confirmation evidence. This contract can never authorize an order.

No network, broker, worker or credential access. Thresholds are research
assumptions, not demonstrated trading advantages.
"""
from datetime import datetime, timedelta, timezone
import math

KST = timezone(timedelta(hours=9))
VERSION = 'confirmation-shadow-v1'
CONFIRMED = {'BREAKOUT_NEW', 'BREAKOUT_CONFIRMED', 'SUPPORT_CONFIRMED', 'REBOUND'}


def number(value):
    return (float(value) if not isinstance(value, bool) and isinstance(value, (int, float))
            and math.isfinite(value) else None)


def _level(detail, keys):
    for key in keys:
        value = detail.get(key)
        if isinstance(value, dict):
            value = value.get('price')
        value = number(value)
        if value is not None and value > 0:
            return value
    return None


def closed_bars(rows, as_of):
    """Never silently slice away future, unordered, duplicate or malformed input."""
    dates = [r.get('date', '') for r in rows]
    if dates != sorted(set(dates)):
        return []
    valid = []
    for row in rows:
        try:
            day = datetime.strptime(row['date'], '%Y-%m-%d').date()
        except (ValueError, TypeError, KeyError):
            return []
        values = [number(row.get(k)) for k in ('open', 'high', 'low', 'close', 'volume')]
        if any(v is None for v in values):
            return []
        o, h, l, c, v = values
        if not (0 < l <= min(o, c) <= max(o, c) <= h and v >= 0):
            return []
        if day > as_of.date() or (day == as_of.date() and as_of.hour * 60 + as_of.minute < 930):
            return []
        valid.append(row)
    return valid


def _period_closes(rows, as_of, weekly):
    # A current calendar week/month is deliberately omitted. Friday's close
    # is accepted after 15:30; never turn a Wednesday into a completed week.
    groups = {}
    for row in rows:
        day = datetime.strptime(row['date'], '%Y-%m-%d').date()
        end = day + timedelta(days=4-day.weekday()) if weekly else None
        complete = (end < as_of.date() or end == as_of.date() and as_of.hour * 60 + as_of.minute >= 930) if weekly else (day.year, day.month) < (as_of.year, as_of.month)
        if day == as_of.date() and as_of.hour*60+as_of.minute >= 930:
            import market_calendar
            following = as_of + timedelta(days=1)
            while not market_calendar.is_kr_trading_day(following):
                following += timedelta(days=1)
            # A holiday/weekend must not force a completed period to wait
            # for the next calendar week/month to begin.
            complete = complete or (following.isocalendar()[:2] != day.isocalendar()[:2] if weekly
                                    else (following.year, following.month) != (day.year, day.month))
        if complete:
            key = day.isocalendar()[:2] if weekly else (day.year, day.month)
            groups[key] = row['close']
    return list(groups.values())


def daily_review(rows, detail, *, as_of=None, strategy='swing', benchmark=None):
    as_of = as_of or datetime.now(KST)
    as_of = as_of.astimezone(KST)
    bars = closed_bars(rows, as_of)
    result = {'version': VERSION, 'mode': 'shadow', 'orderAuthorized': False,
              'strategy': strategy, 'confirmed': False, 'entryValid': False,
              'confirmedAt': None, 'signalPrice': None, 'invalidationPrice': None,
              'checks': {}, 'reasons': [], 'profitabilityProven': False}
    if len(bars) < 61:
        result['reasons'] = ['CLOSED_HISTORY_UNAVAILABLE']
        return result
    close = bars[-1]['close']
    support = _level(detail, ('support_price', 'support', 'pullbackLow', 'latest_low', 'ma20', 'baseLow'))
    resistance = _level(detail, ('resistance', 'recent_resistance', 'neckline', 'breakout_price', 'breakoutLevel', 'baseHigh'))
    ma20 = sum(r['close'] for r in bars[-20:])/20
    prev20 = sum(r['close'] for r in bars[-21:-1])/20
    avgvol = sum(r['volume'] for r in bars[-21:-1])/20
    up = [r['volume'] for a, r in zip(bars[-21:-1], bars[-20:]) if r['close'] > a['close']]
    down = [r['volume'] for a, r in zip(bars[-21:-1], bars[-20:]) if r['close'] < a['close']]
    benchmark_bars = closed_bars(benchmark or [], as_of)
    rs = None
    if len(benchmark_bars) >= 21 and [r['date'] for r in benchmark_bars[-21:]] == [r['date'] for r in bars[-21:]]:
        rs = close/bars[-21]['close'] - benchmark_bars[-1]['close']/benchmark_bars[-21]['close']
    checks = {
        'completedPattern': detail.get('status') in CONFIRMED or detail.get('entrySignal') is True,
        'dailyTrend': close >= ma20 >= prev20,
        'support': support is not None and close > support,
        'stopDistance': support is not None and 0 < (close-support)/close <= .08,
        'chase': resistance is not None and 0 <= close/resistance-1 <= .03 if strategy != 'long' else True,
        'volumeStructure': bool(up and down and sum(up)/len(up) >= sum(down)/len(down) and avgvol > 0),
        'relativeStrength': rs is not None and rs >= 0,
    }
    if strategy == 'long':
        weeks, months = _period_closes(bars, as_of, True), _period_closes(bars, as_of, False)
        checks.update(weeklyTrend=len(weeks) >= 5 and weeks[-1] >= sum(weeks[-5:])/5 and weeks[-1] >= weeks[-2],
                      monthlyTrend=len(months) >= 3 and months[-1] >= months[-2] >= months[-3],
                      longAverage=len(bars) >= 244 and close >= sum(r['close'] for r in bars[-224:])/224 >= sum(r['close'] for r in bars[-244:-20])/224,
                      longBreakout=resistance is not None and close >= resistance,
                      marketRegime=len(benchmark_bars) >= 21 and benchmark_bars[-1]['close'] >= sum(r['close'] for r in benchmark_bars[-20:])/20,
                      financials=detail.get('financialScreen', {}).get('passed') is True)
    result.update(checks=checks, reasons=[k for k, v in checks.items() if not v],
                  confirmed=all(checks.values()), dataAsOf=bars[-1]['date'],
                  signalPrice=close, invalidationPrice=support,
                  evaluatedAt=as_of.isoformat(), relativeStrength=rs)
    # This is a completed-bar assessment, never a real-time executable quote.
    if result['confirmed']:
        result['confirmedAt'] = as_of.isoformat()
    return result


def intraday_review(item, state, now):
    checks = {}
    at, price = number(item.get('sampleAt', item.get('at'))), number(item.get('price'))
    first, ratio = number(item.get('first70At')), number(item.get('volumeRatio'))
    support = number(item.get('pullbackLow'))
    rank = state.get('rankAt')
    try:
        rank_age = now-datetime.fromisoformat(rank.replace('Z', '+00:00')).timestamp()
    except (TypeError, ValueError, AttributeError):
        rank_age = math.inf
    try:
        first_day = datetime.fromtimestamp(first, KST) if first is not None else None
        sample_day = datetime.fromtimestamp(at, KST) if at is not None else None
        current_day = datetime.fromtimestamp(now, KST)
        market_window = (first_day is not None and sample_day is not None
                         and first_day.date() == sample_day.date() == current_day.date()
                         and 540 <= first_day.hour*60+first_day.minute < 840
                         and 540 <= current_day.hour*60+current_day.minute < 840)
    except (ValueError, OverflowError, OSError):
        market_window = False
    checks.update(fresh=at is not None and 0 <= now-at <= 10,
                  rankFresh=0 <= rank_age <= 120,
                  complete=state.get('running') is True and state.get('active') is True and not any(state.get(k) for k in ('rankError', 'amountFallback', 'queueDropped', 'persistenceError')),
                  source=item.get('source') in ('Kiwoom WebSocket', 'KIS rank polling'),
                  volume=item.get('volumeMissing') is False and ratio is not None and ratio >= .7,
                  valid=item.get('entryInvalid') is not True and item.get('excluded') is None and 'excluded' in item,
                  evidence=first is not None and at is not None and first <= at and item.get('ruleVersion') == 'ab70-v1',
                  marketWindow=market_window,
                  stopDistance=price is not None and price > 0 and support is not None and support > 0 and 0 < (price-support)/price <= .03,
                  # Missing book/flow is unknown, not an invented positive.
                  liquidity=item.get('liquidityVerified') is True,
                  flow=item.get('buyFlowVerified') is True)
    confirmed = all(checks.values())
    return {'version': VERSION, 'mode': 'shadow', 'orderAuthorized': False,
            'strategy': 'short', 'confirmed': confirmed, 'entryValid': confirmed,
            'confirmedAt': now if confirmed else None, 'signalPrice': price,
            'invalidationPrice': support, 'checks': checks,
            'reasons': [k for k,v in checks.items() if not v], 'profitabilityProven': False}


def review_groups(conn, groups, as_of):
    """Reuse stored daily bars and benchmark; no provider calls, bounded by results.

    Legacy arrays and status are untouched. A missing benchmark is an explicit
    failed check. Store one immutable comparison per signal/data day/version.
    """
    import json
    import db_schema
    import market_calendar
    expected = as_of
    if expected.hour*60+expected.minute < 930:
        expected -= timedelta(days=1)
    while not market_calendar.is_kr_trading_day(expected):
        expected -= timedelta(days=1)
    conn.execute(db_schema.SIGNAL_REVIEW_SCHEMA)
    raw = db_schema.load_future_chart_since(conn, 'KOSPI', '')
    benchmark = []
    for r in raw:
        d = str(r.get('date', '')).replace('-', '')
        c = number(r.get('close'))
        if len(d) == 8 and c is not None and c > 0:
            benchmark.append(dict(date=d[:4]+'-'+d[4:6]+'-'+d[6:], open=c, high=c, low=c, close=c, volume=0))
    benchmark = sorted(benchmark, key=lambda r:r['date'])
    for key, items in groups.items():
        for item in items:
            # A saved signal is assessed with its own data cutoff, never later
            # bars present in the DB at the time of a rescan.
            cutoff = str(item.get('date', ''))
            rows = [r for r in db_schema.load_daily_prices(conn, item['code']) if r['date'] <= cutoff]
            detail = dict(item.get('patternDetail') or {})
            detail['financialScreen'] = item.get('financialScreen') or detail.get('financialScreen', {})
            try:
                basis_time = datetime.strptime(cutoff, '%Y-%m-%d').replace(hour=15, minute=30, tzinfo=KST)
            except ValueError:
                basis_time = as_of
            review = daily_review(rows, detail, as_of=min(as_of, basis_time),
                                  strategy='long' if key in ('maCloudBreakout', 'longTermQuality') else 'swing',
                                  benchmark=[r for r in benchmark if r['date'] <= cutoff])
            review['evaluatedAt'] = as_of.isoformat()
            review['checks']['dataFresh'] = cutoff == expected.date().isoformat()
            if not review['checks']['dataFresh']:
                review['reasons'].append('dataFresh')
                review['confirmed'] = False
                review['confirmedAt'] = None
            if review['confirmed']:
                review['confirmedAt'] = as_of.isoformat()
            sid = ':'.join((str(item.get('date')), item['code'], key, VERSION))
            review['signalId'] = sid
            review['legacyConfirmed'] = detail.get('status') in CONFIRMED or detail.get('entrySignal') is True
            conn.execute('INSERT OR IGNORE INTO signal_reviews VALUES(?,?,?,?)',
                         (sid, str(item.get('date')), as_of.isoformat(), json.dumps(review, allow_nan=False)))
            # First evaluation is immutable across rescan/restart; do not create
            # a new confirmation timestamp from the same historical bar.
            saved = conn.execute('SELECT payload FROM signal_reviews WHERE signal_id=?', (sid,)).fetchone()
            item['signalReview'] = json.loads(saved[0])
    # Bound the additional evidence table; prior scan_hits remain unchanged.
    conn.execute('DELETE FROM signal_reviews WHERE data_date < ?',
                 ((as_of.date()-timedelta(days=180)).isoformat(),))
    conn.commit()
