# -*- coding: utf-8 -*-
"""분봉 익절/손절 선터치 연구 (연구 전용 - 2026-11-27).

기준은 결과 확인 전 `docs/KIS_DEFAULT_STRATEGIES_V2_STUDY_2026-11-27.md` 3번에 고정했다.
데이터는 이전 연구가 모은 종목일 위주의 1분봉이라 일반 종목일이 아니다(선택 편향).

실행: python kis_minute_firsttouch_study.py <분봉 cache 폴더> <out.json>
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrade_support_breakout_minute_study as B  # noqa: E402
import daytrade_support_pullback_minute_study as P  # noqa: E402

COSTS = (0.004, 0.007)
TIMES = ('0905', '0930', '1000', '1100', '1300', '1400')
EXITS = ((0.03, 0.02), (0.03, 0.03), (0.05, 0.03))
LAST = '1520'


def load_day(path):
    try:
        x = json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError):
        return None
    bars = [b for b in x.get('bars', []) if b[0] >= '090000' and b[0] <= '153000' and b[1] and b[2] and b[3] and b[4]]
    if len(bars) < 200:
        return None
    return x['date'], bars


def touch(bars, i, tp, sl):
    """i번째 분봉 종가 진입. 이후 분봉에서 선터치. 반환: (결과 'tp'|'sl'|'none', 수익률)."""
    entry = bars[i][4]
    up, dn = entry * (1 + tp), entry * (1 - sl)
    for b in bars[i + 1:]:
        if b[0][:4] > LAST:
            break
        if b[3] <= dn:
            return 'sl', dn / entry - 1
        if b[2] >= up:
            return 'tp', up / entry - 1
    last = [b for b in bars[i + 1:] if b[0][:4] <= LAST]
    if not last:
        return None
    return 'none', last[-1][4] / entry - 1


def entry_index(bars, rule):
    if rule == 'ORB':
        hi = max((b[2] for b in bars if b[0] < '093000'), default=None)
        if hi is None:
            return None
        for i, b in enumerate(bars):
            if '093000' <= b[0] <= '145900' and b[4] > hi:
                return i
        return None
    for i, b in enumerate(bars):
        if b[0][:4] >= rule:
            return i if b[0][:4] <= LAST else None
    return None


def main():
    cache, outp = sys.argv[1:3]
    rules = list(TIMES) + ['ORB']
    rec = {(r, e, c): [] for r in rules for e in EXITS for c in COSTS}
    outc = {(r, e): {'tp': 0, 'sl': 0, 'none': 0} for r in rules for e in EXITS}
    nday = 0
    for f in sorted(os.listdir(cache)):
        if not f.endswith('.json'):
            continue
        d = load_day(os.path.join(cache, f))
        if not d:
            continue
        date, bars = d
        nday += 1
        for r in rules:
            i = entry_index(bars, r)
            if i is None:
                continue
            for e in EXITS:
                res = touch(bars, i, *e)
                if not res:
                    continue
                outc[(r, e)][res[0]] += 1
                for c in COSTS:
                    rec[(r, e, c)].append((date, res[1] - c))
    out = {'stockDays': nday, 'results': {}}
    dates_all = sorted({d for v in rec.values() for d, _ in v})
    mid = dates_all[len(dates_all) // 2] if dates_all else ''
    for (r, e, c), v in rec.items():
        if not v:
            continue
        vals = [x for _, x in v]
        days = [d for d, _ in v]
        st = B.stat(vals)
        st['clusterCi95'] = P.cluster_ci(vals, days)
        h1 = [x for d, x in v if d < mid]
        h2 = [x for d, x in v if d >= mid]
        oc = outc[(r, e)]
        tot = sum(oc.values()) or 1
        item = {'n': len(vals), 'mean': st.get('mean'), 'clusterCi95': st['clusterCi95'], 'meanNoTop5': st.get('meanNoTop5'),
                'tpPct': round(oc['tp'] / tot * 100, 1), 'slPct': round(oc['sl'] / tot * 100, 1), 'nonePct': round(oc['none'] / tot * 100, 1),
                'half1': round(float(np.mean(h1)) * 100, 3) if h1 else None, 'half2': round(float(np.mean(h2)) * 100, 3) if h2 else None}
        ok = (item['n'] >= 100 and item['mean'] > 0 and item['clusterCi95'] and item['clusterCi95'][0] > 0
              and item['half1'] and item['half2'] and item['half1'] > 0 and item['half2'] > 0)
        item['verdict'] = '신호 있음' if ok else '신호 없음'
        out['results']['%s|tp%d/sl%d|cost%.1f' % (r, e[0] * 100, e[1] * 100, c * 100)] = item
    json.dump(out, open(outp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for k, v in out['results'].items():
        if k.endswith('cost0.4'):
            print(k, v['verdict'], 'n=%s mean=%s tp=%s%% sl=%s%% none=%s%% halves=%s/%s' % (v['n'], v['mean'], v['tpPct'], v['slPct'], v['nonePct'], v['half1'], v['half2']))


if __name__ == '__main__':
    main()
