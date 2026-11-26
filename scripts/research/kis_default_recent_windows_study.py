# -*- coding: utf-8 -*-
"""KIS 기본 전략 최근 30/60/90/365일 구간별 결과 (연구 전용, 서술 통계 - 2026-11-27).

v2 연구의 신호·필터·청산을 그대로 쓰고, 진입일이 마지막 자료일 기준 최근 N일(달력일) 안인 거래만 집계한다.
끝나지 않은 포지션은 마지막 종가로 평가(MTM)한다. 짧은 구간은 표본·검정력이 작아 판정하지 않는다.

실행: python kis_default_recent_windows_study.py <일봉 cache> <kospi_naver.json> <out.json>
"""
import datetime as dt
import json
import sys

import numpy as np

import kis_default_strategies_v2_study as V
import kis_default_strategies_study as K

V.MTM = True
WINDOWS = (30, 60, 90, 365)
FILTERS = ('F0', 'F2')
EXITS = ('X0', 'X1', 'X3')


def main():
    cache, kospi, outp = sys.argv[1:4]
    stocks, dates = V.load_all(cache)
    di, amt_top, ret_top = V.cross_section(stocks, dates)
    reg = V.regime(kospi, dates)
    last = dt.datetime.strptime(dates[-1], '%Y%m%d')
    cut = {w: (last - dt.timedelta(days=w)).strftime('%Y%m%d') for w in WINDOWS}
    kc = {r['date']: float(r['close']) for r in json.load(open(kospi, encoding='utf-8'))['rows'] if r.get('close')}
    kd = sorted(kc)
    bench = {}
    for w in WINDOWS:
        base = [d for d in kd if d <= cut[w]]
        bench[w] = round((kc[kd[-1]] / kc[base[-1]] - 1) * 100, 2) if base else None
    acc = {(n, f, x): [] for n in V.NAMES for f in FILTERS for x in EXITS}
    for s, (code, d, a) in enumerate(stocks):
        o, h, l, c, v = a[:, 0], a[:, 1], a[:, 2], a[:, 3], a[:, 4]
        idx = np.array([di[x] for x in d])
        valid = (c * v >= K.MIN_AMOUNT) & (np.arange(len(c)) >= 260)
        f_mask = {'F0': valid, 'F2': valid & reg[idx] & amt_top[s, idx]}
        sigs = K.signals(o, h, l, c)
        for name in V.NAMES:
            b, sl = sigs[name]
            for f in FILTERS:
                m = b & f_mask[f]
                if not m.any():
                    continue
                for x in EXITS:
                    for (ei, ki, r) in V.run_trades(o, h, l, c, m, x, sl):
                        if d[ei] >= cut[365]:
                            acc[(name, f, x)].append((d[ei], float(r)))
    res = {'lastDate': dates[-1], 'cost': V.COST, 'kospiPct': bench, 'rows': {}}
    for key, tr in acc.items():
        for w in WINDOWS:
            vals = [r - V.COST for dd, r in tr if dd >= cut[w]]
            gross = [r for dd, r in tr if dd >= cut[w]]
            if not vals:
                res['rows']['%s|%s|%s|%d' % (key + (w,))] = {'n': 0}
                continue
            res['rows']['%s|%s|%s|%d' % (key + (w,))] = {
                'n': len(vals), 'mean': round(float(np.mean(vals)) * 100, 2), 'gross': round(float(np.mean(gross)) * 100, 2),
                'median': round(float(np.median(vals)) * 100, 2), 'win': round(sum(1 for x in vals if x > 0) / len(vals) * 100, 1)}
    json.dump(res, open(outp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('last', dates[-1], 'KOSPI %', bench)
    for f in FILTERS:
        for x in EXITS:
            print('== %s %s (신호 9종 합산 평균 / 거래수)' % (f, x))
            for w in WINDOWS:
                tot = [(res['rows']['%s|%s|%s|%d' % (n, f, x, w)]) for n in V.NAMES]
                nn = sum(t['n'] for t in tot)
                mm = sum(t['mean'] * t['n'] for t in tot if t['n']) / nn if nn else None
                print('  %3d일 n=%d mean=%s' % (w, nn, None if mm is None else round(mm, 2)))
    for x in ('X0', 'X3'):
        print('== F2 %s 신호별' % x)
        for n in V.NAMES:
            print('  %-13s' % n, ' | '.join('%d일 n=%s %s%%' % (w, res['rows']['%s|F2|%s|%d' % (n, x, w)]['n'], res['rows']['%s|F2|%s|%d' % (n, x, w)].get('mean')) for w in WINDOWS))


if __name__ == '__main__':
    main()
