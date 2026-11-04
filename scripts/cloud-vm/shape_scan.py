"""Bounded, DB-only morphology selection for the public web scanner.
Legacy patterns, signal reviews, hits, tracks and order feeds are untouched.
"""
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
from datetime import datetime, timezone
import db_schema
import daily_scan_cache
import pattern_detect as pd

VERSION = 'shape-selection-v1'
GROUPS = ('liveFlow', 'trendBreakout', 'bottomFormation', 'pullbackRebreak', 'longTermQuality')


def eligible(stock, rows, basis):
    if not rows or len(rows) < 24 or rows[-1].get('date') != basis or pd.is_excluded_stock(stock, rows):
        return False
    dates = [r.get('date', '') for r in rows]
    if not all(dates) or dates != sorted(set(dates)):
        return False
    try:
        for r in rows:
            if any(isinstance(r[k], bool) or not isinstance(r[k], (int, float)) or not math.isfinite(r[k])
                   for k in ('open', 'high', 'low', 'close', 'volume')):
                return False
            if not (0 < r['low'] <= min(r['open'], r['close']) <= max(r['open'], r['close']) <= r['high']) or r['volume'] < 0:
                return False
        cap = float(stock.get('market_cap_eok') or 0)
        value = sum(r['close'] * r['volume'] for r in rows[-20:]) / 20
        return math.isfinite(cap) and cap >= pd.COMMON_MARKET_CAP_MIN_EOK and value >= pd.MIN_AVG_TRADING_VALUE_20D
    except (KeyError, TypeError, ValueError):
        return False


def refresh():
    import rescan_patterns
    with open(daily_scan_cache.OUTPUT_FILE, encoding='utf-8') as f:
        original = json.load(f)
    basis = original.get('dataDate') or str(original.get('generatedAt') or '')[:10]
    from datetime import timedelta
    from zoneinfo import ZoneInfo
    from market_calendar import is_kr_trading_day
    now = datetime.now(ZoneInfo('Asia/Seoul'))
    completed = now if now.hour >= 20 else now - timedelta(days=1)
    while not is_kr_trading_day(completed):
        completed -= timedelta(days=1)
    if basis != completed.date().isoformat():
        raise ValueError('Daily basis is not the latest completed trading day')
    names, etfs = rescan_patterns.load_universe_metadata()
    caps = rescan_patterns.load_market_cap_cache()
    funds = rescan_patterns.load_fundamentals_cache()
    conn = db_schema.get_conn()
    coverage = dict(universe=0, eligible=0, skipped=0)
    here = Path(__file__).resolve().parent
    repo = here if (here / 'scripts' / 'cloud-vm').is_dir() else here.parent.parent
    runner = repo / 'scripts' / 'cloud-vm' / 'shape_scan.js'
    try:
        with tempfile.TemporaryDirectory(prefix='ninepay-shape-') as tmp:
            incoming = Path(tmp) / 'input.jsonl'
            with incoming.open('w', encoding='utf-8') as stream:
                for code, in conn.execute('SELECT DISTINCT code FROM daily_prices ORDER BY code'):
                    coverage['universe'] += 1
                    name = names.get(code)
                    stock = dict(code=code, name=name or code, is_etf=(name in etfs), market_cap_eok=caps.get(code))
                    daily = db_schema.load_daily_prices(conn, code)[-224:]
                    if not name or not eligible(stock, daily, basis):
                        coverage['skipped'] += 1
                        continue
                    coverage['eligible'] += 1
                    probe = dict(price=daily[-1]['close'], longTermLiquidity=pd.long_term_liquidity(daily, stock['market_cap_eok']))
                    financial = pd.long_term_financial_check(probe, funds.get(code))
                    stream.write(json.dumps(dict(code=code, name=name, daily=daily, financialScreen=financial, longTermLiquidity=probe['longTermLiquidity']), ensure_ascii=False) + '\n')
            if not coverage['eligible']:
                raise ValueError('No eligible current daily data; preserve prior snapshot')
            result = subprocess.run(['node', str(runner), str(incoming)], capture_output=True,
                                    text=True, encoding='utf-8', timeout=300, check=True)
            groups = json.loads(result.stdout)
    finally:
        conn.close()
    at = datetime.now(timezone.utc).isoformat()
    for items in groups.values():
        for item in items:
            item.update(scannedAt=at, lastObservedAt=at, dataAsOf=basis)
            item['patternDetail']['scanned_at'] = at
    snapshot = dict(version=VERSION, mode='observation', orderAuthorized=False, status='ok',
                    scannedAt=at, dataDate=basis, coverage=coverage, groups=groups)
    def apply(cache):
        if cache.get('dataDate') != original.get('dataDate') or cache.get('generatedAt') != original.get('generatedAt'):
            raise ValueError('Daily snapshot changed during shape scan')
        cache['shapeSelection'] = snapshot
    daily_scan_cache.update(apply)
    return snapshot



def public_snapshot(snapshot, now=None, basis=None):
    """Expose web observations only; recheck the existing financial expiry gate."""
    if not isinstance(snapshot, dict) or snapshot.get('version') != VERSION or snapshot.get('orderAuthorized') is not False or snapshot.get('mode') != 'observation':
        return None
    if basis is not None and snapshot.get('dataDate') != basis:
        return None
    try:
        evaluated = datetime.fromisoformat(snapshot['scannedAt'])
        age = ((now or datetime.now(timezone.utc)) - evaluated).total_seconds()
        if not 0 <= age <= 36 * 3600:
            return None
    except (KeyError, TypeError, ValueError):
        return None
    import copy
    out = copy.deepcopy(snapshot)
    if not isinstance(out.get('groups'), dict) or any(not isinstance(out['groups'].get(k), list) for k in GROUPS):
        return None
    summary = dict(version=1, excludedItems=[], reasonCounts={}, technical=len(out['groups']['longTermQuality']))
    valid, _ = pd.validated_long_term_snapshot(
        {'patterns': {'longTermQuality': out['groups']['longTermQuality']}, 'longTermFilter': summary}, now=now)
    out['groups']['longTermQuality'] = valid
    return out

if __name__ == '__main__':
    result = refresh()
    print(json.dumps(dict(version=result['version'], coverage=result['coverage'],
                          counts={k: len(v) for k, v in result['groups'].items()})))
