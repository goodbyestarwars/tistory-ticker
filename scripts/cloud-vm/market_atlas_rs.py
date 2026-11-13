"""Market Atlas RS — cached daily closes only; no upstream API calls or writes.

The map's axes are percentage-point excess returns vs each stock's own
KOSPI/KOSDAQ benchmark over 20 / 250 benchmark trading sessions.
Only exact aligned dates are used; missing history stays missing.
"""
from math import isfinite


def _close(value):
    try:
        n = float(value)
        return n if isfinite(n) and n > 0 else None
    except (ValueError, TypeError):
        return None


def _benchmark(snapshot, last_stock_day):
    rows = {}
    for item in (snapshot or {}).get('rows') or []:
        day = str(item.get('date') or '')
        close = _close(item.get('close'))
        if close is not None and len(day) == 10 and day <= last_stock_day and item.get('confirmed') is not False:
            rows[day] = close
    dates = sorted(rows)
    if not dates:
        return {'status': 'missing', 'asOf': None, 'base1m': None, 'base1y': None,
                'index1m': None, 'index1y': None}
    end = dates[-1]
    p0 = rows[end]
    p20 = rows[dates[-21]] if len(dates) >= 21 else None
    p250 = rows[dates[-251]] if len(dates) >= 251 else None
    return {
        'status': 'ready' if p20 is not None and p250 is not None else 'partial',
        'asOf': end, 'base1m': dates[-21] if p20 else None,
        'base1y': dates[-251] if p250 else None,
        'index1m': round((p0 / p20 - 1) * 100, 5) if p20 else None,
        'index1y': round((p0 / p250 - 1) * 100, 5) if p250 else None,
    }


def read_snapshot(conn, codes, snapshots):
    """Return exact-date closes and benchmark return metadata; at most 300 codes.

    The frontend selects the correct benchmark using the existing quote.market
    (not an inferred symbol code or a client-supplied classification).
    """
    codes = list(dict.fromkeys(codes))
    if len(codes) > 300 or any(len(c) != 6 or not c.isdigit() for c in codes):
        raise ValueError('invalid codes')
    if not codes:
        return {'benchmarks': {}, 'prices': {}, 'basis': 'confirmed_daily_close'}
    marks = ','.join('?' for _ in codes)
    last = conn.execute(
        'SELECT MAX(date) FROM daily_prices WHERE code IN (' + marks + ')',
        codes
    ).fetchone()[0]
    if not last:
        return {'benchmarks': {}, 'prices': {}, 'basis': 'confirmed_daily_close'}
    benchmarks = {
        market: _benchmark((snapshots or {}).get(market), last)
        for market in ('KOSPI', 'KOSDAQ')
    }
    targets = set()
    for benchmark in benchmarks.values():
        for key in ('asOf', 'base1m', 'base1y'):
            if benchmark.get(key):
                targets.add(benchmark[key])
    prices = {}
    if targets:
        day_marks = ','.join('?' for _ in targets)
        sql = ('SELECT code,date,close FROM daily_prices WHERE code IN (' + marks
               + ') AND date IN (' + day_marks + ')')
        for code, day, close in conn.execute(sql, codes + sorted(targets)):
            value = _close(close)
            if value is not None:
                prices.setdefault(code, {})[day] = value
    return {
        'basis': 'confirmed_daily_close',
        'method': 'stock_return_minus_benchmark_return_pp',
        'windows': {'1m': 20, '1y': 250},
        'benchmarks': benchmarks,
        'prices': prices,
    }
