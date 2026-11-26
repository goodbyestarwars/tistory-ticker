# -*- coding: utf-8 -*-
"""「누구나 따라할 수 있는 종가배팅&스윙 검색식」 일봉 검증 (연구 전용, 주문·자동매매 연결 없음 - 2026-11-27).

판정 기준은 결과를 보기 전에 `docs/CLOSING_BET_FORMULA_STUDY_2026-11-27.md`에 고정했다.
통계는 기존 `daytrade_support_breakout_minute_study`(B.stat)와 `daytrade_support_pullback_minute_study`(P.cluster_ci)를 재사용한다.

실행: python closing_bet_formula_study.py <일봉 cache 폴더> <out.json>
"""
import json
import os
import sys

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrade_support_breakout_minute_study as B  # noqa: E402
import daytrade_support_pullback_minute_study as P  # noqa: E402

COST = 0.004
MIN_BARS = 480
MIN_AMOUNT = 5e8
LIMIT_UP = 0.29
DEDUP = 5
SPLIT_DATE = '20240901'
MIN_EVENTS = 100
EXITS = ('P1', 'P2', 'D1', 'S')
PRIMARY = ('P1', 'P2')
VARIANTS = ('full', 'dropA', 'dropB', 'dropCD', 'dropE', 'dropF', 'Bprime')


def load_px(cache_dir, code):
    try:
        rows = json.load(open(os.path.join(cache_dir, code + '.json'), encoding='utf-8'))['px']
    except (OSError, ValueError, KeyError):
        return None
    rows = [r for r in rows if r[1] and r[2] and r[3] and r[4] and r[2] >= r[3]]
    return rows if len(rows) >= MIN_BARS + 30 else None


def sma(x, n):
    out = np.full(len(x), np.nan)
    if len(x) >= n:
        cs = np.cumsum(np.insert(x, 0, 0.0))
        out[n - 1:] = (cs[n:] - cs[:-n]) / n
    return out


def rolling(x, n, fn):
    out = np.full(len(x), np.nan)
    if len(x) >= n:
        out[n - 1:] = fn(sliding_window_view(x, n), axis=1)
    return out


def conditions(o, h, l, c, v):
    """신호일 t 종가까지의 자료로만 계산한 조건 배열 (모두 bool, 길이 n)."""
    n = len(c)
    prev_v = np.concatenate(([np.nan], v[:-1]))
    spike = (prev_v > 0) & (v >= prev_v * 3)
    a_cnt = rolling(spike.astype(float), 40, np.sum)
    cond_a = a_cnt >= 3
    hi20 = rolling(h, 20, np.max)
    lo20 = rolling(l, 20, np.min)
    cond_b = (hi20 / lo20 - 1) >= 0.10
    bar_range = np.where(l > 0, h / np.where(l > 0, l, 1) - 1, 0.0)
    cond_bp = rolling(bar_range, 20, np.max) >= 0.10
    ma240, ma480 = sma(c, 240), sma(c, 480)
    cond_c = (c >= ma240) & (c <= ma240 * 1.2)
    cond_d = (c >= ma480) & (c <= ma480 * 1.2)
    ma5, ma10, ma20 = sma(c, 5), sma(c, 10), sma(c, 20)
    cond_e = (ma5 < ma10) & (ma10 < ma20)
    prev_c = np.concatenate(([np.nan], c[:-1]))
    chg = c / prev_c - 1
    cond_f = chg >= -0.03
    gate = (c * v >= MIN_AMOUNT) & (chg < LIMIT_UP)
    valid = np.arange(n) >= MIN_BARS
    nan = lambda x: np.nan_to_num(x.astype(float)).astype(bool)  # noqa: E731
    a, b, bp, cd, ne, f = nan(cond_a), nan(cond_b), nan(cond_bp), nan(cond_c | cond_d), ~nan(cond_e), nan(cond_f)
    base = gate & valid
    return {
        'parts': {'A': a, 'B': b, 'CD': cd, 'nE': ne, 'F': f},
        'gate': base,
        'full': base & a & b & cd & ne & f,
        'dropA': base & b & cd & ne & f,
        'dropB': base & a & cd & ne & f,
        'dropCD': base & a & b & ne & f,
        'dropE': base & a & b & cd & f,
        'dropF': base & a & b & cd & ne,
        'Bprime': base & a & bp & cd & ne & f,
    }


def exit_returns(o, h, l, c):
    """신호일 종가 매수 기준 청산별 수익률(비용 차감 전, 계산 불가는 NaN)."""
    n = len(c)
    out = {k: np.full(n, np.nan) for k in EXITS}
    if n > 1:
        out['P1'][:-1] = o[1:] / c[:-1] - 1
        out['D1'][:-1] = c[1:] / c[:-1] - 1
    if n > 5:
        out['P2'][:-5] = c[5:] / c[:-5] - 1
    if n > 20:
        m = n - 20
        base = c[:m]
        stop, tp = base * 0.95, base * 1.10
        res = np.full(m, np.nan)
        done = np.zeros(m, bool)
        for k in range(1, 21):
            ok, hk, lk = o[k:k + m], h[k:k + m], l[k:k + m]
            for mask, val in ((ok <= stop, ok / base - 1), (lk <= stop, np.full(m, -0.05)),
                              (ok >= tp, ok / base - 1), (hk >= tp, np.full(m, 0.10))):
                hit = ~done & mask
                res[hit] = val[hit]
                done |= hit
        end = ~done
        res[end] = c[20:20 + m][end] / base[end] - 1
        out['S'][:m] = res
    return out


def dedupe(mask):
    keep = mask.copy()
    idx = np.flatnonzero(mask)
    for i in idx:
        if mask[max(0, i - DEDUP):i].any():
            keep[i] = False
    return keep


def stat_rows(vals, days):
    if not vals:
        return {'n': 0}
    s = B.stat(vals)
    s['days'] = len(set(days))
    s['clusterCi95'] = P.cluster_ci(vals, days)
    return s


def verdict(events, base_mean):
    s = stat_rows(events['vals'], events['days'])
    if s['n'] < MIN_EVENTS:
        return '판정 불가'
    ok = (s['mean'] > 0 and s['clusterCi95'] and s['clusterCi95'][0] > 0
          and s['meanNoTop5'] is not None and s['meanNoTop5'] > 0 and s['mean'] > base_mean)
    return '신호 있음' if ok else '신호 없음'


def run(cache_dir):
    codes = sorted(f[:-5] for f in os.listdir(cache_dir) if f.endswith('.json') and f[0].isdigit())
    day_sum = {k: {} for k in EXITS}                       # 기준선: 날짜별 거래 가능 전종목 합·건수
    ev = {v: {k: {'vals': [], 'days': [], 'dates': []} for k in EXITS} for v in VARIANTS}
    usable = 0
    for code in codes:
        rows = load_px(cache_dir, code)
        if not rows:
            continue
        usable += 1
        dates = [r[0] for r in rows]
        o, h, l, c, v = (np.array([r[i] for r in rows], float) for i in (1, 2, 3, 4, 5))
        cond = conditions(o, h, l, c, v)
        rets = exit_returns(o, h, l, c)
        gate_idx = np.flatnonzero(cond['gate'])
        for k in EXITS:
            r = rets[k]
            for i in gate_idx:
                if not np.isnan(r[i]):
                    s = day_sum[k].setdefault(dates[i], [0.0, 0])
                    s[0] += r[i] - COST
                    s[1] += 1
        for var in VARIANTS:
            keep = dedupe(cond[var])
            for i in np.flatnonzero(keep):
                for k in EXITS:
                    x = rets[k][i]
                    if not np.isnan(x):
                        ev[var][k]['vals'].append(float(x - COST))
                        ev[var][k]['days'].append(dates[i])
    base_of = {k: {d: s[0] / s[1] for d, s in day_sum[k].items()} for k in EXITS}
    out = {'stocks': usable, 'cost': COST, 'variants': {}, 'verdict': {}}
    for var in VARIANTS:
        out['variants'][var] = {}
        for k in EXITS:
            e = ev[var][k]
            base = [base_of[k][d] for d in e['days']]
            ex = [a - b for a, b in zip(e['vals'], base)]
            item = {'stat': stat_rows(e['vals'], e['days']),
                    'baselineMean': round(float(np.mean(base)) * 100, 2) if base else None,
                    'excess': stat_rows(ex, e['days'])}
            if var == 'full':
                for name, sel in (('early', lambda d: d < SPLIT_DATE), ('late', lambda d: d >= SPLIT_DATE)):
                    pick = [j for j, d in enumerate(e['days']) if sel(d)]
                    item[name] = stat_rows([e['vals'][j] for j in pick], [e['days'][j] for j in pick])
            out['variants'][var][k] = item
    for k in PRIMARY:
        bm = out['variants']['full'][k]['baselineMean']
        out['verdict'][k] = verdict(ev['full'][k], (bm or 0) / 100)
    return out


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    out = run(sys.argv[1])
    json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
