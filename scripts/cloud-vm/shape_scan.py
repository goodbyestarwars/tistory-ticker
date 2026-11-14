"""Bounded, DB-only morphology selection for the public web scanner.
Legacy patterns, signal reviews, hits, tracks and order feeds are untouched.
Selected rows are also kept as observation tracks under their own
`pattern:shape:<group>` keys so the menus can be judged by later highs.
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
TRACK_PREFIX = 'pattern:shape:'
BENCHMARKS = ('KOSPI', 'KOSDAQ')
EDGE_PREFIX = 'pattern:edge:'
EDGE_KEYS = ('surgeNextDay', 'gapVolumeClose', 'rsHighResidual', 'quietLeaderPullback', 'timeLagAccumulation')


def record_tracks(snapshot, conn=None):
    """Reuse pattern_tracker for observation-only follow-up of each selected row.

    Separate scanner keys keep legacy tracker statistics unchanged; existing open
    tracks and same-day reruns are left as they are (record_new is idempotent).
    """
    import pattern_tracker
    own = conn is None
    conn = conn or db_schema.get_conn()
    try:
        # Track every shape candidate (before the relative-strength filter) so the
        # filter itself can be judged later from patternDetail.myWay.
        groups = snapshot.get('observed') or snapshot.get('groups') or {}
        prefix = 'pattern:shape-v2:' if snapshot.get('strategyVersion') == 'chart-first-v2' else TRACK_PREFIX
        out = {key: pattern_tracker.record_new(conn, snapshot['dataDate'], prefix + key,
                                               [r for r in groups.get(key) or [] if not (r.get('patternDetail') or {}).get('edgeOnly')
                                                and not (r.get('patternDetail') or {}).get('promotedEdge')])
               for key in GROUPS}
        # Research tags (edge-v1) get their own scanner keys so menu statistics stay unchanged.
        for edge in EDGE_KEYS:
            rows, seen = [], set()
            for key in GROUPS:
                # 승격된 연구 태그(promotedEdge)는 공개 groups에 있으므로 함께 읽어 같은 연구 키로 추적한다.
                for r in (groups.get(key) or []) + (snapshot.get('groups', {}).get(key) or []) + (snapshot.get('research', {}).get(key) or []):
                    tags = (r.get('patternDetail') or {}).get('edgeSignals') or []
                    if r.get('code') not in seen and any(t.get('key') == edge for t in tags):
                        seen.add(r.get('code')); rows.append(r)
            out[EDGE_PREFIX + edge] = pattern_tracker.record_new(conn, snapshot['dataDate'], EDGE_PREFIX + edge, rows)
        return out
    finally:
        if own:
            conn.close()


def load_benchmarks(conn, basis):
    """Stored KOSPI/KOSDAQ daily closes (same source as signal_review); no provider call.

    An index without the basis-day close is left out so the worker reports the
    relative-strength check as missing instead of judging against stale data.
    """
    out = {}
    for symbol in BENCHMARKS:
        rows = []
        for r in db_schema.load_future_chart_since(conn, symbol, ''):
            d = str(r.get('date', '')).replace('-', '')
            c = r.get('close')
            if len(d) == 8 and isinstance(c, (int, float)) and math.isfinite(c) and c > 0:
                rows.append(dict(date=d[:4] + '-' + d[4:6] + '-' + d[6:], close=float(c)))
        rows.sort(key=lambda r: r['date'])
        if rows and rows[-1]['date'] == basis:
            out[symbol] = rows[-260:]  # 120-day beta for edgeSignalsOf needs 141 aligned closes
    return out if len(out) == len(BENCHMARKS) else {}


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
    try:
        # 2026-11-14 주도주 조용한 눌림 업종 중복 제한용 WICS 업종(기존 공용 정적 자산). 실패하면 업종 미확인으로 진행한다.
        import market_board
        wics = market_board.load_wics_map() or {}
    except Exception:
        wics = {}
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
                    # 2026-11-14 시간차 매집: 기존 확정 수급 저장분(investor_flow_daily, 주 단위) 최근 70일만 읽는다. 새 호출 없음.
                    # 조회 실패·미보유는 빈 목록 → 매집 판정만 '미확인'으로 건너뛰고 모양 선정은 그대로 진행한다.
                    try:
                        flow = [[r['date'], r['foreign_net'] + r['inst_net']]
                                for r in db_schema.load_investor_flow_daily(conn, code, limit=70)
                                if isinstance(r.get('foreign_net'), (int, float)) and isinstance(r.get('inst_net'), (int, float))]
                    except Exception:
                        flow = []
                    stream.write(json.dumps(dict(code=code, name=name, daily=daily, flow=flow, industry=(wics.get(code) or {}).get('industry'), financialScreen=financial, longTermLiquidity=probe['longTermLiquidity']), ensure_ascii=False) + '\n')
            if not coverage['eligible']:
                raise ValueError('No eligible current daily data; preserve prior snapshot')
            try:
                benchmarks = load_benchmarks(conn, basis)
            except Exception:
                benchmarks = {}
            bench_file = Path(tmp) / 'benchmarks.json'
            bench_file.write_text(json.dumps(benchmarks), encoding='utf-8')
            result = subprocess.run(['node', str(runner), str(incoming), str(bench_file)], capture_output=True,
                                    text=True, encoding='utf-8', timeout=300, check=True)
            worker = json.loads(result.stdout)
            groups = worker['groups']
            observed = worker.get('observed') or groups
            relative_strength = worker.get('relativeStrength') or dict(status='missing')
            edge_signals = worker.get('edgeSignals') or dict(version='edge-v1', status='missing')
            extended = worker.get('extended') or {key: [] for key in GROUPS}
            research = worker.get('research') or {key: [] for key in GROUPS}
            quiet = worker.get('quiet') or dict(version='quiet-v1', role='advisory', status='missing')
    finally:
        conn.close()
    at = datetime.now(timezone.utc).isoformat()
    for bucket in (groups, observed, extended, research):
        for items in bucket.values():
            for item in items:
                item.update(scannedAt=at, lastObservedAt=at, dataAsOf=basis)
                item['patternDetail']['scanned_at'] = at
    snapshot = dict(version=VERSION, mode='observation', orderAuthorized=False, status='ok',
                    scannedAt=at, dataDate=basis, coverage=coverage, groups=groups,
                    relativeStrength=relative_strength, edgeSignals=edge_signals,
                    strategyVersion=worker.get('strategyVersion'), extended=extended, research=research, quiet=quiet)
    def apply(cache):
        if cache.get('dataDate') != original.get('dataDate') or cache.get('generatedAt') != original.get('generatedAt'):
            raise ValueError('Daily snapshot changed during shape scan')
        cache['shapeSelection'] = snapshot
    daily_scan_cache.update(apply)
    try:
        # Pre-filter candidates go only to the tracker, not to the cached public snapshot.
        record_tracks(dict(snapshot, observed=observed))
    except Exception as error:
        # Tracking is a follow-up record; never lose the published snapshot over it.
        import logging
        logging.getLogger('shape_scan').warning('shape track record failed: %s', type(error).__name__)
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
    for name in ('extended', 'research'):
        if name in out and (not isinstance(out[name], dict) or any(not isinstance(out[name].get(k), list) for k in GROUPS)):
            return None
        if name in out:
            # A separate bucket must never bypass the long-term financial expiry gate.
            check = dict(version=1, excludedItems=[], reasonCounts={}, technical=len(out[name]['longTermQuality']))
            out[name]['longTermQuality'], _ = pd.validated_long_term_snapshot(
                {'patterns': {'longTermQuality': out[name]['longTermQuality']}, 'longTermFilter': check}, now=now)
    summary = dict(version=1, excludedItems=[], reasonCounts={}, technical=len(out['groups']['longTermQuality']))
    valid, _ = pd.validated_long_term_snapshot(
        {'patterns': {'longTermQuality': out['groups']['longTermQuality']}, 'longTermFilter': summary}, now=now)
    out['groups']['longTermQuality'] = valid
    return out

if __name__ == '__main__':
    result = refresh()
    print(json.dumps(dict(version=result['version'], coverage=result['coverage'],
                          counts={k: len(v) for k, v in result['groups'].items()})))
