# -*- coding: utf-8 -*-
"""단기이평 돌파형 개선안 비교 백테스트(2026-10-10, 오프라인 전용 - 운영 검색기·VM은 건드리지 않는다).

A안: 기존 detect_short_ma_breakout(하락 추세선 첫 돌파) - 운영 코드를 그대로 호출한다.
B안: 5·20일선 골든크로스(최근 1~3거래일) + 종가가 5·20·60일선 위 + 5일선 상승 + 20일선 하락 둔화/상승 전환 + 공통 유동성.
     (B-과열제한: B + 종가 20일선 이격 <= 10%. 사전 선언한 단일 변형이며 개발 구간에서만 선택한다.)

공통 원칙: 신호일 D는 daily[:D+1]만 사용, 진입 D+1 시가, 5/10/20일 종가 수익률, MFE/MAE, 왕복 0.4% 비용,
같은 종목 5거래일 쿨다운, BASELINE(3일마다 아무 날 시가 진입)으로 시장 상승분 제거. 기간은 전체 날짜 55%/45%로
개발·검증 구간을 나누고 KOSPI 상태(상승/하락/횡보)별로도 본다.

사용: python short_ma_compare.py --db bt.db --index ks11.json --out result.json
"""
import argparse
import json
import os
import sqlite3
import statistics
import sys
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'cloud-vm'))
sys.path.insert(0, HERE)

import signal_backtest as sb  # noqa: E402

COST = sb.TRADING_COST
COOLDOWN = 5
OVERHEAT = 0.10


def sma(values, period):
    out = [None] * len(values)
    total = 0.0
    for i, v in enumerate(values):
        total += v
        if i >= period:
            total -= values[i - period]
        if i >= period - 1:
            out[i] = total / period
    return out


def detect_b(daily, i, ma5, ma20, ma60, tv_ok):
    """i일 종가 기준 B안 판정. (hit, overheat_ok, info)"""
    if i < 65 or ma60[i] is None or ma20[i - 3] is None:
        return None
    close = daily[i]['close']
    cross = None
    for k in (i, i - 1, i - 2):
        if ma5[k - 1] is not None and ma20[k - 1] is not None and ma5[k - 1] <= ma20[k - 1] and ma5[k] > ma20[k]:
            cross = i - k
            break
    if cross is None:
        return None
    if not (close > ma5[i] and close > ma20[i] and close > ma60[i]):
        return None
    if not ma5[i] > ma5[i - 1]:
        return None
    if not ma20[i] >= ma20[i - 3]:
        return None
    if not tv_ok:
        return None
    gap20 = close / ma20[i] - 1
    return {'cross_age': cross, 'gap20': gap20, 'gap60': close / ma60[i] - 1,
            'ma60_slope10': (ma60[i] / ma60[i - 10] - 1) if ma60[i - 10] else None}


def stop_ret(daily, i, n=10, stop=-0.05):
    entry = daily[i + 1]['open']
    for r in daily[i + 1:i + n + 1]:
        if r['low'] / entry - 1 <= stop:
            return stop
    return daily[i + n]['close'] / entry - 1 if i + n < len(daily) else None


def for_stock(args):
    db, code = args
    import pattern_detect as pdx
    conn = sqlite3.connect(db)
    daily = sb.load(conn, code)
    conn.close()
    n = len(daily)
    if n < 160 or pdx.is_excluded_stock({'code': code, 'name': ''}, daily):
        return []
    closes = [d['close'] for d in daily]
    ma5, ma20, ma60 = sma(closes, 5), sma(closes, 20), sma(closes, 60)
    found = []
    last = {'A': -999, 'B': -999, 'BH': -999}

    def record(kind, i, extra):
        res = sb.outcome(daily, i, daily[i]['close'])
        if not res:
            return
        st = stop_ret(daily, i)
        rec = {'scanner': kind, 'code': code, 'date': daily[i]['date']}
        rec.update(extra)
        rec.update(res)
        rec['stop10'] = st
        found.append(rec)

    for i in range(120, n - 1):
        if i % 3 == 0:
            base = sb.outcome(daily, i, daily[i]['close'])
            if base:
                base = dict(base, scanner='BASELINE', code=code, date=daily[i]['date'], stop10=stop_ret(daily, i))
                found.append(base)
        window = daily[:i + 1]
        if i - last['A'] > COOLDOWN:
            try:
                d = pdx.detect_short_ma_breakout(window)
            except Exception:
                d = None
            if d is not None and not d.get('breakout'):
                last['A'] = i
                record('A', i, {'score': d.get('score')})
        avg_tv, _ = pdx.trading_value_stats(window)
        tv_ok = avg_tv is not None and avg_tv >= pdx.SHORT_MA_MIN_TRADING_VALUE_20D
        b = detect_b(daily, i, ma5, ma20, ma60, tv_ok)
        if b is None:
            continue
        if i - last['B'] > COOLDOWN:
            last['B'] = i
            record('B', i, b)
        if b['gap20'] <= OVERHEAT and i - last['BH'] > COOLDOWN:
            last['BH'] = i
            record('BH', i, b)
    return found


def mean(v):
    v = [x for x in v if x is not None]
    return sum(v) / len(v) if v else None


def summarize(sigs):
    row = {'n': len(sigs)}
    for h in (5, 10, 20):
        r = [s['ret%d' % h] - COST for s in sigs if s.get('ret%d' % h) is not None]
        row['avg%d' % h] = mean(r)
        row['med%d' % h] = statistics.median(r) if r else None
        row['win%d' % h] = (sum(1 for x in r if x > 0) / len(r)) if r else None
        row['sd%d' % h] = statistics.pstdev(r) if len(r) > 1 else None
        row['n%d' % h] = len(r)
    r10 = [s['ret10'] - COST for s in sigs if s.get('ret10') is not None]
    wins = [x for x in r10 if x > 0]
    losses = [x for x in r10 if x <= 0]
    row['avgWin10'] = mean(wins)
    row['avgLoss10'] = mean(losses)
    row['payoff10'] = (mean(wins) / abs(mean(losses))) if wins and losses and mean(losses) else None
    row['mfe10'] = mean([s['mfe10'] for s in sigs if s.get('mfe10') is not None])
    row['mae10'] = mean([s['mae10'] for s in sigs if s.get('mae10') is not None])
    row['stop5_10'] = mean([s['stop10'] - COST for s in sigs if s.get('stop10') is not None])
    row['gapAvg'] = mean([s['gap'] for s in sigs if s.get('gap') is not None])
    row['gapOver3'] = (sum(1 for s in sigs if s.get('gap') is not None and s['gap'] > 0.03) / len([s for s in sigs if s.get('gap') is not None])) if sigs else None
    return row


def regimes(index_path):
    data = json.load(open(index_path, encoding='utf-8'))
    dates = [d['date'] for d in data]
    closes = [d['close'] for d in data]
    ma60 = sma(closes, 60)
    out = {}
    for i, date in enumerate(dates):
        if i < 70 or ma60[i] is None or ma60[i - 10] is None:
            continue
        up = ma60[i] > ma60[i - 10]
        out[date] = ('bull' if closes[i] > ma60[i] and up else 'bear' if closes[i] < ma60[i] and not up else 'side')
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--index', required=True)
    ap.add_argument('--out', default='short_ma_compare.json')
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()
    conn = sqlite3.connect(args.db)
    codes = [r[0] for r in conn.execute('SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) >= 250 ORDER BY code')]
    conn.close()
    if args.limit:
        codes = codes[:args.limit]
    sigs = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for k, res in enumerate(pool.map(for_stock, [(args.db, c) for c in codes], chunksize=4)):
            sigs.extend(res)
            if (k + 1) % 40 == 0:
                print('%d/%d' % (k + 1, len(codes)), len(sigs), flush=True)
    dates = sorted({s['date'] for s in sigs})
    cut = dates[int(len(dates) * 0.55)]
    reg = regimes(args.index)
    result = {'stocks': len(codes), 'cost': COST, 'cutDate': cut, 'firstDate': dates[0], 'lastDate': dates[-1], 'scanners': {}}
    for kind in ('A', 'B', 'BH', 'BASELINE'):
        s = [x for x in sigs if x['scanner'] == kind]
        entry = {'all': summarize(s),
                 'dev': summarize([x for x in s if x['date'] < cut]),
                 'val': summarize([x for x in s if x['date'] >= cut])}
        for name in ('bull', 'bear', 'side'):
            entry['regime_' + name] = summarize([x for x in s if reg.get(x['date']) == name])
        if kind in ('B', 'BH'):
            entry['byGap20'] = {}
            for lo, hi in ((-1, .03), (.03, .06), (.06, .10), (.10, .20), (.20, 9)):
                entry['byGap20']['%s~%s' % (lo, hi)] = summarize([x for x in s if lo <= x['gap20'] < hi])
            entry['byCrossAge'] = {str(a): summarize([x for x in s if x['cross_age'] == a]) for a in (0, 1, 2)}
        result['scanners'][kind] = entry
    json.dump(result, open(args.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(sigs, open(args.out + '.signals.json', 'w', encoding='utf-8'), ensure_ascii=False)
    print('done', len(sigs))


if __name__ == '__main__':
    main()
