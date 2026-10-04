# -*- coding: utf-8 -*-
"""차트검색기 8종 "다음 거래일 시가 진입" 수익률 백테스트 (2026-10-04, 사용자 지시: 첫째도 수익률).

원칙
- 신호 시점 D의 판정은 daily[:D+1]만 보고 한다(미래 봉 없음 -> 스윙 확정 지연·구름 shift look-ahead가 구조적으로 불가능).
- 진입가 = D+1 시가(장 마감 후 스캔이라 D 종가로는 못 산다). 수익률 = 종가(D+N) / 진입가 - 1, N=5/10/20.
- MFE/MAE = D+1~D+N 고가·저가 기준 최대 상승/하락. +5%/-5% 선도달은 10거래일 안에서 먼저 닿은 쪽(같은 봉에 둘 다면 보수적으로 LOSS).
- 실패 종목도 전부 포함(성과로 신호를 지우지 않는다). 같은 종목의 연속 신호는 COOLDOWN 거래일 안에 다시 뜨면 한 건(에피소드)로 센다.
- 비용: 왕복 TRADING_COST를 net 수익률에서 뺀다(gross도 함께 출력). 갭 = D+1 시가 / D 종가 - 1.
- 화면 표시 cap(20개)과 무관하게 모든 신호를 기록한다.

사용: python scripts/analysis/signal_backtest.py --db <daily_prices가 있는 sqlite> [--out result.json] [--workers 4]
(VM의 ohlc_snapshot.db를 주면 전종목으로 돌릴 수 있다. 종목이 적으면 표본이 작으니 건수를 함께 본다.)
"""
import argparse
import json
import math
import os
import sqlite3
import statistics
import sys
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'cloud-vm'))

COOLDOWN = 5
TRADING_COST = 0.004
HORIZONS = (5, 10, 20)
MIN_HISTORY = {'shortTermMaBreakout': 40, 'maCloudBreakout': 250, 'doubleBottom': 130, 'invHeadShoulders': 100,
               'boxRangeLow': 60, 'pullback': 250, 'angleMomentum': 50, 'gongpasan': 250}
MIN_SCORE = {'doubleBottom': 70, 'invHeadShoulders': 70, 'pullback': 80}   # scan_stock과 같은 게이트
DETAIL_FIELDS = {   # 조건별 성과 분석에 쓸 수치 필드
    'shortTermMaBreakout': ['breakoutPct', 'volumeRatio', 'tradingValueRatio', 'ma5SlopePct3d', 'closePosition'],
    'maCloudBreakout': ['ma224Distance', 'cloudTopDistance', 'maCloudDistance', 'cloudThickness', 'ma224Slope20', 'volumeRatio'],
    'doubleBottom': ['bottomDiffPct', 'reboundPct', 'necklineDistancePct', 'volumeRatioL2L1'],
    'invHeadShoulders': ['shoulderDiffPct', 'necklineDistancePct', 'volumeRatio'],
    'boxRangeLow': ['lowerPositionPct', 'closeRangePct', 'rsi14', 'volumeRatioPct', 'ma20Slope10Pct'],
    'pullback': ['risePct', 'pullbackPct', 'ma20Slope5Pct'],
    'angleMomentum': ['shortSlopePct', 'burstRatio', 'volumeRatio', 'dailyReturnPct'],
    'gongpasan': [],
}


def load(conn, code):
    return [dict(date=r[0], open=r[1], high=r[2], low=r[3], close=r[4], volume=r[5] or 0)
            for r in conn.execute('SELECT date,open,high,low,close,volume FROM daily_prices WHERE code=? AND close IS NOT NULL ORDER BY date', (code,))]


def outcome(daily, i, signal_close):
    """신호일 인덱스 i 기준 D+1 시가 진입 성과. D+1이 없으면 None."""
    if i + 1 >= len(daily):
        return None
    entry = daily[i + 1]['open']
    if not entry or entry <= 0:
        return None
    out = {'gap': entry / signal_close - 1 if signal_close else None}
    for n in HORIZONS:
        end = i + n
        if end >= len(daily):
            out['ret%d' % n] = out['mfe%d' % n] = out['mae%d' % n] = None
            continue
        window = daily[i + 1:end + 1]
        out['ret%d' % n] = daily[end]['close'] / entry - 1
        out['mfe%d' % n] = max(r['high'] for r in window) / entry - 1
        out['mae%d' % n] = min(r['low'] for r in window) / entry - 1
    first = 'NONE'
    for r in daily[i + 1:i + 11]:
        up, down = r['high'] / entry - 1 >= 0.05, r['low'] / entry - 1 <= -0.05
        if down:          # 같은 봉에 둘 다 닿으면 보수적으로 LOSS
            first = 'LOSS'
            break
        if up:
            first = 'WIN'
            break
    out['first5'] = first
    return out


def signals_for_stock(args):
    db, code = args
    import pattern_detect as pdx
    import angle_momentum_detect as amd
    conn = sqlite3.connect(db)
    daily = load(conn, code)
    conn.close()
    n = len(daily)
    if n < 120 or pdx.is_excluded_stock({'code': code, 'name': ''}, daily):
        return []
    found = []

    def keep(scanner, i, detail):
        if detail is None or detail.get('breakout'):
            return
        if (detail.get('score') or 0) < MIN_SCORE.get(scanner, 0):
            return
        res = outcome(daily, i, daily[i]['close'])
        if not res:
            return
        rec = {'scanner': scanner, 'code': code, 'date': daily[i]['date'], 'score': detail.get('score'), 'status': detail.get('status')}
        for f in DETAIL_FIELDS.get(scanner, []):
            v = detail.get(f)
            if v is None and isinstance(detail.get('criteria'), dict):
                v = detail['criteria'].get(f)
            if isinstance(v, (int, float)):
                rec[f] = v
        rec.update(res)
        found.append(rec)

    detectors = {
        'shortTermMaBreakout': pdx.detect_short_ma_breakout,
        'maCloudBreakout': pdx.detect_ma_cloud_breakout,
        'doubleBottom': pdx.detect_double_bottom,
        'invHeadShoulders': pdx.detect_inv_head_shoulders,
        'boxRangeLow': pdx.detect_box_range_low,
        'pullback': pdx.detect_pullback,
        'angleMomentum': amd.detect_angle_momentum,
    }
    last_signal = {}
    for i in range(120, n - 1):
        if i % 3 == 0:                  # 비교 기준(BASELINE): 같은 종목·같은 기간의 아무 날이나 D+1 시가에 샀을 때(시장 상승분 제거용)
            base = outcome(daily, i, daily[i]['close'])
            if base:
                found.append(dict({'scanner': 'BASELINE', 'code': code, 'date': daily[i]['date'], 'score': None, 'status': None}, **base))
        window = daily[:i + 1]          # 미래 봉을 보지 않는다
        for scanner, fn in detectors.items():
            if i + 1 < MIN_HISTORY[scanner]:
                continue
            if i - last_signal.get(scanner, -999) <= COOLDOWN:
                continue
            try:
                detail = fn(window)
            except Exception:
                detail = None
            if detail is not None and not detail.get('breakout') and (detail.get('score') or 0) >= MIN_SCORE.get(scanner, 0):
                last_signal[scanner] = i
                keep(scanner, i, detail)
    # 공파산: 벡터 계산(각 행이 과거 데이터만 사용) - entry_signal 행을 신호로 본다
    try:
        import gongpasan_strategy as gp
        df = gp.calculate_gongpasan_signal(code, rows=daily)
        last = -999
        for i in [int(k) for k in df.index[df['entry_signal']].tolist()]:
            if i - last <= COOLDOWN:
                continue
            last = i
            scored = gp.score_entry(df, i)
            res = outcome(daily, i, daily[i]['close'])
            if res:
                found.append(dict({'scanner': 'gongpasan', 'code': code, 'date': daily[i]['date'], 'score': scored[0] if scored else None,
                                   'status': df.loc[i, 'entry_status']}, **res))
    except Exception:
        pass
    return found


def mean(v):
    v = [x for x in v if x is not None]
    return sum(v) / len(v) if v else None


def median(v):
    v = [x for x in v if x is not None]
    return statistics.median(v) if v else None


def summarize(sigs):
    row = {'signals': len(sigs)}
    for n in HORIZONS:
        rets = [s['ret%d' % n] - TRADING_COST for s in sigs if s.get('ret%d' % n) is not None]
        gross = [s['ret%d' % n] for s in sigs if s.get('ret%d' % n) is not None]
        row['n%d' % n] = len(rets)
        row['avg%d' % n] = mean(rets)
        row['gross%d' % n] = mean(gross)
        row['med%d' % n] = median(rets)
        row['win%d' % n] = (sum(1 for r in rets if r > 0) / len(rets)) if rets else None
        row['mfe%d' % n] = mean([s['mfe%d' % n] for s in sigs if s.get('mfe%d' % n) is not None])
        row['mae%d' % n] = mean([s['mae%d' % n] for s in sigs if s.get('mae%d' % n) is not None])
        row['medMfe%d' % n] = median([s['mfe%d' % n] for s in sigs if s.get('mfe%d' % n) is not None])
        row['medMae%d' % n] = median([s['mae%d' % n] for s in sigs if s.get('mae%d' % n) is not None])
    r10 = [s['ret10'] - TRADING_COST for s in sigs if s.get('ret10') is not None]
    if r10:
        wins = [r for r in r10 if r > 0]
        losses = [r for r in r10 if r <= 0]
        row['profitFactor10'] = (sum(wins) / abs(sum(losses))) if losses and sum(losses) != 0 else None
        row['hit5in10'] = sum(1 for s in sigs if s.get('mfe10') is not None and s['mfe10'] >= 0.05) / len([s for s in sigs if s.get('mfe10') is not None])
        row['stop5in10'] = sum(1 for s in sigs if s.get('mae10') is not None and s['mae10'] <= -0.05) / len([s for s in sigs if s.get('mae10') is not None])
        top = sorted(r10, reverse=True)
        k = max(1, len(top) // 10)
        total_pos = sum(r for r in r10 if r > 0)
        row['top10pctShare'] = (sum(top[:k]) / total_pos) if total_pos > 0 else None
    fh = [s['first5'] for s in sigs if s.get('first5')]
    row['first5win'] = (fh.count('WIN') / len(fh)) if fh else None
    row['first5loss'] = (fh.count('LOSS') / len(fh)) if fh else None
    gaps = [s['gap'] for s in sigs if s.get('gap') is not None]
    row['avgGap'] = mean(gaps)
    return row


def bucket_table(sigs, key, edges):
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        sub = [s for s in sigs if s.get(key) is not None and lo <= s[key] < hi]
        if sub:
            r = summarize(sub)
            out.append({'range': '%s~%s' % (lo, hi), 'signals': len(sub), 'avg10': r['avg10'], 'med10': r['med10'], 'win10': r['win10'],
                        'mfe10': r['mfe10'], 'mae10': r['mae10']})
    return out


def quantile_edges(sigs, key, parts=3):
    vals = sorted(s[key] for s in sigs if s.get(key) is not None)
    if len(vals) < parts * 3:
        return None
    edges = [vals[0] - 1e-9] + [vals[int(len(vals) * k / parts)] for k in range(1, parts)] + [vals[-1] + 1e-9]
    return [round(e, 3) for e in edges]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--out', default='signal_backtest_result.json')
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()
    conn = sqlite3.connect(args.db)
    codes = [r[0] for r in conn.execute('SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) >= 250 ORDER BY code')]
    conn.close()
    if args.limit:
        codes = codes[:args.limit]
    all_sigs = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for k, res in enumerate(pool.map(signals_for_stock, [(args.db, c) for c in codes], chunksize=4)):
            all_sigs.extend(res)
            if (k + 1) % 20 == 0:
                print('%d/%d stocks, %d signals' % (k + 1, len(codes), len(all_sigs)), flush=True)
    result = {'stocks': len(codes), 'cost': TRADING_COST, 'cooldown': COOLDOWN, 'scanners': {}}
    for scanner in list(MIN_HISTORY) + ['BASELINE']:
        sigs = [s for s in all_sigs if s['scanner'] == scanner]
        entry = {'summary': summarize(sigs)}
        entry['byScore'] = bucket_table(sigs, 'score', [0, 70, 80, 90, 101])
        statuses = sorted({s['status'] for s in sigs if s.get('status')})
        entry['byStatus'] = {st: summarize([s for s in sigs if s.get('status') == st]) for st in statuses}
        entry['byGap'] = bucket_table(sigs, 'gap', [-1, 0, 0.02, 0.05, 0.10, 1])
        entry['byField'] = {}
        for f in DETAIL_FIELDS.get(scanner, []):
            edges = quantile_edges(sigs, f)
            if edges:
                entry['byField'][f] = bucket_table(sigs, f, edges)
        result['scanners'][scanner] = entry
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    with open(args.out + '.signals.json', 'w', encoding='utf-8') as f:
        json.dump(all_sigs, f, ensure_ascii=False)
    print('done', len(all_sigs), 'signals ->', args.out)


if __name__ == '__main__':
    main()
