# -*- coding: utf-8 -*-
"""사용자 정의 매집봉 후보(2026-10-19): 직전 20일 평균 거래량 5배 이상 + 장대양봉 의 일봉 검증(연구용).

장대양봉(숫자화는 해석): 양봉이고 몸통(종가/시가-1) >= 5%, 종가가 그날 범위 상위 40%. 변형: 몸통 >= 3%, 거래량 3배.
위치별: 바닥권(250일 범위 하위 30%), 중간, 고점권(종가 >= 250일 고가의 90%).
성과·기준선·비용은 inverted_hammer_study 와 같다(다음 날 시가 +0.10% 매수, N거래일 뒤 종가 -0.15%, 같은 날짜 유동 종목 평균 대비 초과, 날짜 묶음 t).
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inverted_hammer_study import AMOUNT_MIN, HORIZONS, SLIP_BUY, SLIP_SELL, summarize  # noqa: E402


def analyze_stock(rows):
    n = len(rows)
    o = [r[1] for r in rows]; hi = [r[2] for r in rows]; lo = [r[3] for r in rows]; c = [r[4] for r in rows]; v = [r[5] for r in rows]
    vs = [0.0]
    for x in v:
        vs.append(vs[-1] + x)
    out, base = defaultdict(list), {}
    for i in range(250, n - 1):
        if c[i] * v[i] < AMOUNT_MIN or o[i + 1] <= 0:
            continue
        entry = o[i + 1] * (1 + SLIP_BUY / 100)
        g = {hz: (c[i + hz] * (1 - SLIP_SELL / 100) / entry - 1) * 100 for hz in HORIZONS if i + hz < n}
        if not g:
            continue
        base[rows[i][0]] = g
        avg20 = (vs[i] - vs[i - 20]) / 20
        if avg20 <= 0 or hi[i] <= lo[i] or c[i] <= o[i]:
            continue
        r = v[i] / avg20
        body = (c[i] / o[i] - 1) * 100
        closepos = (c[i] - lo[i]) / (hi[i] - lo[i])
        top, bot = max(hi[i - 249:i + 1]), min(lo[i - 249:i + 1])
        pos = (c[i] - bot) / (top - bot) if top > bot else 0.5
        zone = '고점권(신고가권)' if c[i] >= 0.9 * top else ('바닥권' if pos <= 0.3 else '중간')
        for name, ok in (('5배+ 장대양봉(몸통5%+, 종가 상위40%)', r >= 5 and body >= 5 and closepos >= 0.6),
                         ('5배+ 양봉(몸통3%+)', r >= 5 and body >= 3),
                         ('3배+ 장대양봉(몸통5%+)', r >= 3 and body >= 5 and closepos >= 0.6)):
            if ok:
                out[name].append((rows[i][0], g, None))
                out[name + ' / ' + zone].append((rows[i][0], g, None))
    return out, base


def run(cache_dir, out_path):
    events = defaultdict(list)
    base_sum = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    for f in os.listdir(cache_dir):
        if not (f.endswith('.json') and f[0].isdigit()):
            continue
        try:
            rows = [r for r in json.load(open(os.path.join(cache_dir, f), encoding='utf-8')) if r[1] and r[2] and r[3] and r[4]]
        except (OSError, ValueError):
            continue
        if len(rows) < 400:
            continue
        ev, base = analyze_stock(rows)
        for t, lst in ev.items():
            events[t].extend(lst)
        for d, g in base.items():
            for hz, val in g.items():
                s = base_sum[d][hz]
                s[0] += val
                s[1] += 1
    base_day = {d: {hz: s[0] / s[1] for hz, s in per.items() if s[1] >= 20} for d, per in base_sum.items()}
    res = {t: {p: {str(hz): summarize(lst, base_day, hz, p) for hz in HORIZONS} for p in ('all', 'train', 'valid')} for t, lst in events.items()}
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return res


if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2])
    print('done')
