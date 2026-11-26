# -*- coding: utf-8 -*-
"""KIS Strategy Builder 기본 전략 10개 일봉 백테스트 (연구 전용, 주문·자동매매 연결 없음 - 2026-11-27).

판정 기준은 결과를 보기 전에 `docs/KIS_DEFAULT_STRATEGIES_STUDY_2026-11-27.md`에 고정했다.
통계는 `closing_bet_formula_study`(load_px·stat_rows → B.stat, P.cluster_ci)를 재사용한다.

실행: python kis_default_strategies_study.py <일봉 cache 폴더> <out.json>
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import closing_bet_formula_study as S  # noqa: E402

COST = 0.007
STOP = 0.05
MAX_HOLD = 60
MIN_AMOUNT = 5e8
SPLIT = '20240901'
MIN_EVENTS = 100


def sma(x, n):
    return S.sma(x, n)


def roll_max_prev(x, n):
    """오늘을 제외한 직전 n개 최대값."""
    out = np.full(len(x), np.nan)
    if len(x) > n:
        win = np.lib.stride_tricks.sliding_window_view(x, n).max(axis=1)
        out[n:] = win[:-1]
    return out


def streak(c, up=True):
    n = len(c)
    out = np.zeros(n)
    for i in range(1, n):
        ok = c[i] > c[i - 1] if up else c[i] < c[i - 1]
        out[i] = out[i - 1] + 1 if ok else 0
    return out


def signals(o, h, l, c):
    """전략별 (매수신호, 매도신호) bool 배열. 신호일 t 종가까지의 자료만 쓴다."""
    n = len(c)
    nz = lambda x: np.nan_to_num(x.astype(float)).astype(bool)  # noqa: E731
    ma5, ma20 = sma(c, 5), sma(c, 20)
    prev = lambda x: np.concatenate(([np.nan], x[:-1]))  # noqa: E731
    cross_up = nz((prev(ma5) < prev(ma20)) & (ma5 > ma20))
    cross_dn = nz((prev(ma5) > prev(ma20)) & (ma5 < ma20))
    roc60 = np.full(n, np.nan)
    roc60[60:] = (c[60:] / c[:-60] - 1) * 100
    hi252, hi20 = roll_max_prev(h, 252), roll_max_prev(h, 20)
    disp = lambda k: c / sma(c, k) * 100  # noqa: E731
    chg = (c / prev(c) - 1) * 100
    ret = c / prev(c) - 1
    vol10 = np.full(n, np.nan)
    if n > 11:
        w = np.lib.stride_tricks.sliding_window_view(ret[1:], 10)
        vol10[10:] = np.std(w, axis=1, ddof=1)
    rng = h - l
    ibs = np.where(rng > 0, (c - l) / np.where(rng > 0, rng, 1), np.nan)
    return {
        'goldenCross': (cross_up, cross_dn),
        'momentum': (nz(roc60 > 30), nz(roc60 < -20)),
        'high52w': (nz(c > hi252), nz(c < hi252)),
        'consecutive': (streak(c, True) >= 5, streak(c, False) >= 5),
        'disparity': (nz(disp(20) < 90), nz(disp(20) > 110)),
        'breakoutFail': (nz(c < hi20), nz(c > hi20)),
        'strongClose': (nz(ibs >= 0.8), nz(ibs < 0.5)),
        'volatility': (nz((vol10 < 0.02) & (chg >= 3)), nz(chg <= -3)),
        'meanReversion': (nz(disp(5) <= 97), nz(disp(5) >= 103)),
    }


def simulate(o, h, l, c, buy, sell, valid):
    """신호 다음 날 시가 진입, 매도 신호 다음 날 시가 청산, 진입가 -5% 손절, 최대 60거래일. 종목당 동시 1포지션."""
    n = len(c)
    trades = []
    i = 0
    while i < n - 2:
        if not (valid[i] and buy[i]):
            i += 1
            continue
        e = i + 1
        entry = o[e]
        stop = entry * (1 - STOP)
        exit_px, exit_i = None, None
        for k in range(e, min(n, e + MAX_HOLD)):
            if k > e and o[k] <= stop:                      # 갭하락 시가가 손절선 아래면 시가 체결
                exit_px, exit_i = o[k], k
                break
            if l[k] <= stop:
                exit_px, exit_i = stop, k
                break
            if sell[k] and k + 1 < n:
                exit_px, exit_i = o[k + 1], k + 1
                break
        if exit_px is None:
            exit_i = min(n - 1, e + MAX_HOLD - 1)
            exit_px = c[exit_i]
            if exit_i == n - 1 and exit_i - e + 1 < MAX_HOLD:
                break                                    # 아직 끝나지 않은 마지막 포지션은 세지 않는다
        trades.append((e, exit_i, exit_px / entry - 1 - COST))
        i = exit_i + 1
    return trades


def run(cache_dir):
    names = ['goldenCross', 'momentum', 'high52w', 'consecutive', 'disparity', 'breakoutFail', 'strongClose', 'volatility', 'meanReversion']
    ev = {k: {'vals': [], 'days': [], 'hold': []} for k in names}
    usable = 0
    for code in sorted(f[:-5] for f in os.listdir(cache_dir) if f.endswith('.json') and f[0].isdigit()):
        rows = S.load_px(cache_dir, code)
        if not rows:
            continue
        usable += 1
        dates = [r[0] for r in rows]
        o, h, l, c, v = (np.array([r[i] for r in rows], float) for i in (1, 2, 3, 4, 5))
        valid = (c * v >= MIN_AMOUNT) & (np.arange(len(c)) >= 260)
        for name, (b, s) in signals(o, h, l, c).items():
            for e, x, r in simulate(o, h, l, c, b, s, valid):
                ev[name]['vals'].append(float(r))
                ev[name]['days'].append(dates[e])
                ev[name]['hold'].append(x - e + 1)
    out = {'stocks': usable, 'cost': COST, 'stop': STOP, 'maxHold': MAX_HOLD, 'strategies': {}}
    for name in names:
        e = ev[name]
        item = {'all': S.stat_rows(e['vals'], e['days']), 'avgHold': round(float(np.mean(e['hold'])), 1) if e['hold'] else None}
        parts = {}
        for tag, sel in (('early', lambda d: d < SPLIT), ('late', lambda d: d >= SPLIT)):
            pick = [j for j, d in enumerate(e['days']) if sel(d)]
            parts[tag] = S.stat_rows([e['vals'][j] for j in pick], [e['days'][j] for j in pick])
        item.update(parts)

        def ok(st):
            return (st.get('n', 0) >= MIN_EVENTS and st['mean'] > 0 and st.get('clusterCi95') and st['clusterCi95'][0] > 0
                    and st.get('meanNoTop5') is not None and st['meanNoTop5'] > 0)
        if min(item['early'].get('n', 0), item['late'].get('n', 0)) < MIN_EVENTS:
            item['verdict'] = '판정 불가'
        else:
            item['verdict'] = '신호 있음' if ok(item['early']) and ok(item['late']) else '신호 없음'
        out['strategies'][name] = item
    return out


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    out = run(sys.argv[1])
    json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for k, v in out['strategies'].items():
        print(k, v['verdict'], 'n=%s' % v['all'].get('n'), 'mean=%s' % v['all'].get('mean'), 'early=%s late=%s' % (v['early'].get('mean'), v['late'].get('mean')), 'hold=%s' % v['avgHold'])


if __name__ == '__main__':
    main()
