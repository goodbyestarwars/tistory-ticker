"""Build five-year public chart archives on a PC/Actions runner, never on the VM.

Daily price bars retain their existing provider and currency. Monthly/quarterly
FRED observations are not interpolated. Existing archives survive source errors.
"""
import ast
import csv
import io
import json
import math
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'chart-history'
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
TODAY = datetime.now(timezone(timedelta(hours=9))).date()
try:
    CUTOFF = TODAY.replace(year=TODAY.year - 5)
except ValueError:
    CUTOFF = TODAY.replace(year=TODAY.year - 5, day=28)
START, END = CUTOFF.strftime('%Y%m%d'), TODAY.strftime('%Y%m%d')


def get(url, encoding='utf-8', user_agent=True):
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': UA} if user_agent else {})
            with urllib.request.urlopen(request, timeout=25) as response:
                return response.read().decode(encoding, errors='replace')
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1 + attempt)


def assignments(filename, name):
    tree = ast.parse((ROOT / 'scripts' / 'cloud-vm' / filename).read_text(encoding='utf-8'))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise ValueError(name)


def old_archive(group):
    path = OUT / (group + '.js')
    if not path.exists():
        return {}
    text = path.read_text(encoding='utf-8')
    return json.loads(text.rsplit(' = ', 1)[1].rstrip(';\n'))['series']


def merge(old, new):
    rows = {r[0]: r for r in old if START <= r[0] <= END}
    for row in new:
        if START <= row[0] <= END and all(math.isfinite(float(v)) for v in row[1:]):
            rows[row[0]] = row
    return [rows[d] for d in sorted(rows)]


def naver(category, code, domestic=False):
    url = 'https://api.stock.naver.com/chart/%s/%s/%s/day?startDateTime=%s&endDateTime=%s' % (
        'domestic' if domestic else 'foreign', category, code, START, END)
    rows = json.loads(get(url))
    return [[r['localDate']] + [float(r[k]) for k in (
        ('openPrice', 'highPrice', 'lowPrice', 'closePrice') if domestic else ('closePrice',))] for r in rows]


def upbit(symbol, existing):
    rows, before = [], None
    # Incremental updates need only one page; first build pages back to the cutoff.
    stop = existing[-30][0] if len(existing) >= 30 else START
    for _ in range(11):
        query = {'market': 'KRW-' + symbol, 'count': 200}
        if before:
            query['to'] = before + 'Z'  # to is exclusive, explicitly UTC.
        page = json.loads(get('https://api.upbit.com/v1/candles/days?' + urllib.parse.urlencode(query)))
        if not page:
            break
        rows.extend([[r['candle_date_time_kst'][:10].replace('-', ''), float(r['trade_price'])] for r in page])
        before = page[-1]['candle_date_time_utc']
        if rows[-1][0] <= stop:
            break
        time.sleep(.25)
    return rows


def fx(existing):
    rows = []
    for page in range(1, 24 if not existing else 3):
        data = json.loads(get('https://api.stock.naver.com/marketindex/exchange/FX_USDKRW/prices?page=%d&pageSize=60' % page))
        if not data:
            break
        rows.extend([[r['localTradedAt'].replace('-', ''), float(str(r['closePrice']).replace(',', ''))] for r in data])
        if rows[-1][0] <= START:
            break
        time.sleep(.25)
    return rows


def ktb(existing):
    # Naver's replacement for retired IRR_GOVT03Y: KFIA103000 (same 3Y close).
    rows = []
    for page in range(1, 24 if not existing else 3):
        data = json.loads(get('https://api.stock.naver.com/marketindex/domesticInterest/KFIA103000/prices?page=%d&pageSize=60' % page))
        if not data:
            break
        rows.extend([[r['localTradedAt'][:10].replace('-', ''), float(str(r['closePrice']).replace(',', ''))] for r in data])
        if rows[-1][0] <= START:
            break
        time.sleep(.25)
    return rows


def fred(series):
    text = get('https://fred.stlouisfed.org/graph/fredgraph.csv?' + urllib.parse.urlencode({
        'id': series, 'cosd': CUTOFF.isoformat(), 'coed': TODAY.isoformat()}), user_agent=False)
    return [[r[0].replace('-', ''), float(r[1])] for r in list(csv.reader(io.StringIO(text)))[1:]
            if len(r) == 2 and r[1] not in ('', '.')]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    failures = []
    groups = {g: old_archive(g) for g in ('domestic', 'global', 'crypto', 'macro')}
    jobs = []
    for symbol, (category, code) in assignments('domestic_futures.py', 'CHART_SYMBOLS').items():
        jobs.append(('domestic', symbol, lambda c=category, s=code: naver(c, s, True), 'Naver'))
    for meta in assignments('foreign_futures.py', 'SYMBOLS'):
        jobs.append(('global', meta['key'], lambda m=meta: naver(m['category'], m['code']), 'Naver'))
    jobs += [('global', 'USDKRW', lambda: fx(groups['global'].get('USDKRW', [])), 'Naver'),
             ('global', 'KTB3Y', lambda: ktb(groups['global'].get('KTB3Y', [])), 'Naver')]
    for symbol, meta in assignments('bond_yield.py', 'FRED_SYMBOLS').items():
        jobs.append(('global' if symbol in ('US2Y', 'US10Y', 'US30Y') else 'macro', symbol,
                     lambda m=meta: fred(m['series']), 'FRED'))
    for symbol in ('BTC', 'ETH'):
        jobs.append(('crypto', symbol, lambda s=symbol: upbit(s, groups['crypto'].get(s, [])), 'Upbit KRW'))
    sources = {g: {} for g in groups}
    for group, symbol, collect, source in jobs:
        try:
            fresh = collect()
            if not fresh:
                raise ValueError('empty history')
            groups[group][symbol] = merge(groups[group].get(symbol, []), fresh)
            rows = groups[group][symbol]
            print(symbol, len(rows), rows[0][0], rows[-1][0], flush=True)
        except Exception as error:
            failures.append(symbol)
            print(symbol, 'FAILED', type(error).__name__, flush=True)
        sources[group][symbol] = source
    for group, series in groups.items():
        payload = {'updatedAt': TODAY.isoformat(), 'from': START, 'to': END, 'years': 5, 'sources': sources[group], 'series': series}
        content = 'window.MARKET_HISTORY_ARCHIVES = window.MARKET_HISTORY_ARCHIVES || {};\nwindow.MARKET_HISTORY_ARCHIVES["%s"] = %s;\n' % (group, json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
        (OUT / (group + '.js')).write_text(content, encoding='utf-8', newline='\n')
    if failures:
        raise SystemExit('Sources failed (previous rows retained): ' + ', '.join(failures))


if __name__ == '__main__':
    main()
