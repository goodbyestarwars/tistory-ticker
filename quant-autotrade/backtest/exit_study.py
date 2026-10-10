# -*- coding: utf-8 -*-
"""퀀트 자동매매 2.0 Phase 1 - 검색기별 진입·청산 조합 성과 검증 (2026-10-11, 오프라인 전용, 운영 VM·계좌 무관).

신호 판정은 daily[:D+1]만 사용(미래 데이터 없음). 진입은 D+1 시가 지정가(시가*1.002) 또는 D+1 종가(close1).
D+1 시가가 D 종가 대비 +2% 이상이면 매수하지 않는다. 손절은 갭하락 시 시가로 체결(손절가 체결 보장 없음).
비용: 왕복 0.4% + 청산 슬리피지 0.3%. 일봉 근사라 같은 봉에서 손절·익절이 모두 가능하면 손절 먼저.

청산 변형: fix3_5 / fix5_10 / atr2_4 / trail_atr / partial / tech / time5 / time10.
진입 시각별 성과(09:10~10:30 등)는 분봉이 없어 이 스크립트로 검증할 수 없다 - open/close1 비교는 거친 대용치일 뿐이다.
통과 기준(전부 충족해야 '후보'): 개발·검증 구간 평균 모두 > 0, 검증 구간 n >= 100, 검증 평균의 z-하한(평균-3.2*SE) > 0
(변형 수가 많아 Bonferroni 근사로 엄격하게 잡음), 같은 변형의 기준선(아무 날 진입) 대비 초과 > 0.
사용: python exit_study.py --db bt.db --kospi ks11.json --out study.json
"""
import argparse
import json
import math
import os
import sqlite3
import sys
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'scripts', 'cloud-vm'))
sys.path.insert(0, os.path.join(REPO, 'scripts', 'analysis'))
sys.path.insert(0, HERE)

import signal_backtest as sb  # noqa: E402

COOLDOWN = 5
GAP_SKIP = 0.02
ENTRY_SLIP = 0.002
EXIT_SLIP = 0.003
COST = 0.004
SCANNERS = ('maCloudBreakout', 'doubleBottom', 'invHeadShoulders', 'pullback', 'shortTermMaBreakout')
MIN_SCORE = {'doubleBottom': 70, 'invHeadShoulders': 70, 'pullback': 80}
VARIANTS = ('fix3_5', 'fix5_10', 'atr2_4', 'trail_atr', 'partial', 'tech', 'time5', 'time10')
ENTRIES = ('open', 'close1')
BASE_STEP = 6


def atr14(daily, i):
    trs = []
    for k in range(max(1, i - 13), i + 1):
        h, l, pc = daily[k]['high'], daily[k]['low'], daily[k - 1]['close']
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    return sum(trs) / len(trs) if trs else 0


def simulate(daily, i, variant, entry_mode):
    """반환 (ret, exit_idx) 또는 None."""
    if i + 2 >= len(daily):
        return None
    prev_close, open1 = daily[i]['close'], daily[i + 1]['open']
    if not prev_close or not open1 or open1 / prev_close - 1 >= GAP_SKIP:
        return None
    atr = atr14(daily, i)
    if entry_mode == 'open':
        entry, start = open1 * (1 + ENTRY_SLIP), i + 1
    else:
        entry, start = daily[i + 1]['close'] * (1 + ENTRY_SLIP), i + 2
    if not atr or entry <= 0 or start >= len(daily):
        return None
    stop = tp = None
    max_hold = 10
    trail = False
    partial = False
    if variant == 'fix3_5':
        stop, tp, max_hold = entry * 0.97, entry * 1.05, 10
    elif variant == 'fix5_10':
        stop, tp, max_hold = entry * 0.95, entry * 1.10, 15
    elif variant == 'atr2_4':
        stop, tp, max_hold = entry - 2 * atr, entry + 4 * atr, 15
    elif variant == 'trail_atr':
        stop, max_hold, trail = entry - 2.5 * atr, 30, True
    elif variant == 'partial':
        stop, tp, max_hold, trail, partial = entry - 2.5 * atr, entry * 1.05, 30, True, True
    elif variant == 'tech':
        sup = min(daily[k]['low'] for k in range(max(0, i - 4), i + 1))
        risk = entry - sup
        if risk <= 0 or risk / entry < 0.015 or risk / entry > 0.10:
            return None
        stop, tp, max_hold = sup, entry + 2 * risk, 15
    elif variant == 'time5':
        max_hold = 5
    elif variant == 'time10':
        max_hold = 10
    last = min(len(daily) - 1, start + max_hold - 1)
    hh = entry
    half_ret = None
    for k in range(start, last + 1):
        bar = daily[k]
        o, lo, hi, cl = bar['open'], bar['low'], bar['high'], bar['close']
        if stop is not None and lo <= stop:
            fill = min(o, stop) * (1 - EXIT_SLIP)
            return _fin(fill, entry, half_ret, partial), k
        if tp is not None and hi >= tp:
            if partial and half_ret is None:
                half_ret = max(o, tp) * (1 - EXIT_SLIP / 3) / entry - 1
                tp = None
            elif not partial:
                return _fin(max(o, tp) * (1 - EXIT_SLIP / 3), entry, None, False), k
        if trail:
            hh = max(hh, hi)
            stop = max(stop, hh - 2.5 * atr)
        if k == last:
            return _fin(cl * (1 - EXIT_SLIP / 3), entry, half_ret, partial), k
    return None


def _fin(exit_price, entry, half_ret, partial):
    r = exit_price / entry - 1
    if partial and half_ret is not None:
        r = (half_ret + r) / 2
    elif partial:
        r = r  # 첫 목표 미도달 -> 전량 같은 값
    return r - COST


def regime_map(kospi):
    closes = [x['close'] for x in kospi]
    out = {}
    for k, row in enumerate(kospi):
        if k < 120:
            continue
        ma = sum(closes[k - 119:k + 1]) / 120
        gap = closes[k] / ma - 1
        out[row['date']] = 'up' if gap > 0.03 else ('down' if gap < -0.03 else 'flat')
    return out


def for_stock(args):
    db, code, kpath = args
    import pattern_detect as pdx
    kospi = json.load(open(kpath, encoding='utf-8'))
    kidx = {x['date']: x['close'] for x in kospi}
    reg = regime_map(kospi)
    conn = sqlite3.connect(db)
    daily = sb.load(conn, code)
    conn.close()
    n = len(daily)
    if n < 160 or pdx.is_excluded_stock({'code': code, 'name': ''}, daily):
        return []
    detectors = {'maCloudBreakout': pdx.detect_ma_cloud_breakout, 'doubleBottom': pdx.detect_double_bottom,
                 'invHeadShoulders': pdx.detect_inv_head_shoulders, 'pullback': pdx.detect_pullback,
                 'shortTermMaBreakout': pdx.detect_short_ma_breakout}
    sigs, last_signal = [], {}
    for i in range(120, n - 2):
        if i % BASE_STEP == 0:
            sigs.append(('BASELINE', i))
        window = daily[:i + 1]
        for name, fn in detectors.items():
            if i + 1 < sb.MIN_HISTORY[name] or i - last_signal.get(name, -999) <= COOLDOWN:
                continue
            try:
                d = fn(window)
            except Exception:
                d = None
            if d is not None and not d.get('breakout') and (d.get('score') or 0) >= MIN_SCORE.get(name, 0):
                last_signal[name] = i
                sigs.append((name, i))
    out = []
    for name, i in sigs:
        date = daily[i]['date']
        rg = reg.get(date, 'na')
        k0 = kidx.get(date)
        for var in VARIANTS:
            for em in ENTRIES:
                res = simulate(daily, i, var, em)
                if not res:
                    continue
                ret, kx = res
                k1 = kidx.get(daily[kx]['date'])
                kret = (k1 / k0 - 1) if (k0 and k1) else None
                out.append((name, var, em, date, round(ret, 5), None if kret is None else round(kret, 5), rg))
    return out


def stats(rets):
    n = len(rets)
    if n == 0:
        return {'n': 0}
    avg = sum(rets) / n
    wins = [x for x in rets if x > 0]
    losses = [x for x in rets if x <= 0]
    sd = math.sqrt(sum((x - avg) ** 2 for x in rets) / (n - 1)) if n > 1 else 0
    se = sd / math.sqrt(n) if n else 0
    gp, gl = sum(wins), -sum(losses)
    return {'n': n, 'avg': avg, 'se': se, 'zlow': avg - 3.2 * se, 'win': len(wins) / n,
            'payoff': (sum(wins) / len(wins)) / (-sum(losses) / len(losses)) if wins and losses else None,
            'pf': gp / gl if gl > 0 else None}


def mdd(rows):
    """거래당 자본 10% 투입, 신호일 순으로 누적(겹침 무시) - 대략적인 낙폭 지표."""
    eq, peak, worst = 1.0, 1.0, 0.0
    for r in sorted(rows, key=lambda x: x[3]):
        eq *= 1 + 0.10 * r[4]
        peak = max(peak, eq)
        worst = min(worst, eq / peak - 1)
    return worst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--kospi', required=True)
    ap.add_argument('--out', default='study.json')
    ap.add_argument('--workers', type=int, default=4)
    args = ap.parse_args()
    conn = sqlite3.connect(args.db)
    codes = [r[0] for r in conn.execute('SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) >= 250 ORDER BY code')]
    conn.close()
    rows = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for k, res in enumerate(pool.map(for_stock, [(args.db, c, args.kospi) for c in codes], chunksize=2)):
            rows.extend(res)
            if (k + 1) % 30 == 0:
                print('%d/%d' % (k + 1, len(codes)), len(rows), flush=True)
    dates = sorted({r[3] for r in rows})
    cut = dates[int(len(dates) * 0.55)]
    table = {}
    for sc in ('BASELINE',) + SCANNERS:
        for var in VARIANTS:
            for em in ENTRIES:
                sub = [r for r in rows if r[0] == sc and r[1] == var and r[2] == em]
                dev = [r[4] for r in sub if r[3] < cut]
                val = [r[4] for r in sub if r[3] >= cut]
                ex = [r[4] - r[5] for r in sub if r[5] is not None]
                byreg = {g: stats([r[4] for r in sub if r[6] == g]) for g in ('up', 'flat', 'down')}
                table['%s|%s|%s' % (sc, var, em)] = {'all': stats([r[4] for r in sub]), 'dev': stats(dev), 'val': stats(val),
                                                     'mdd': mdd(sub) if sub else None, 'excessKospi': (sum(ex) / len(ex)) if ex else None,
                                                     'regime': byreg}
    # 통과 판정
    cands = []
    for key, v in table.items():
        sc, var, em = key.split('|')
        if sc == 'BASELINE':
            continue
        b = table['BASELINE|%s|%s' % (var, em)]['all'].get('avg')
        if (v['dev'].get('avg', -1) > 0 and v['val'].get('avg', -1) > 0 and v['val'].get('n', 0) >= 100
                and v['val'].get('zlow', -1) > 0 and b is not None and v['all']['avg'] > b):
            cands.append(key)
    json.dump({'stocks': len(codes), 'cut': cut, 'params': {'gap': GAP_SKIP, 'cost': COST, 'exitSlip': EXIT_SLIP, 'zBonferroni': 3.2},
               'tests': len(table) - len(VARIANTS) * len(ENTRIES), 'passed': cands, 'table': table},
              open(args.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done rows=%d passed=%s' % (len(rows), cands))


if __name__ == '__main__':
    main()
