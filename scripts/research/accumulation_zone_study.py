# -*- coding: utf-8 -*-
"""사용자 정의 매집봉(2026-10-19): 거래량 평소 대비 2~5배 이상 + 바닥권 또는 횡보(박스권), 신고가 구간 제외. 장기 역배열 x 단기 정배열 상태와 함께 일봉 검증(연구용).

정의(숫자화는 해석): 거래량 비율 r = 거래량 / 직전 20일 평균. 구간 2~5배, 5배 이상. 거래대금 30억원 이상.
  바닥권 = 종가가 250일 범위 하위 30%. 박스권 = 최근 60일 고저 폭 25% 이하이고 250일 범위 하위 60%. 신고가 구간 제외 = 종가 < 250일 고가의 90%.
  장기 역배열 LT = MA20 < MA60 < MA120 < MA224. 단기 정배열 ST = MA5 > MA10 > MA20 이고 종가 > MA5.
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
    cs = [0.0]
    for x in c:
        cs.append(cs[-1] + x)
    vs = [0.0]
    for x in v:
        vs.append(vs[-1] + x)

    def ma(i, p):
        return (cs[i + 1] - cs[i + 1 - p]) / p if i + 1 >= p else None
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
        if avg20 <= 0 or v[i] < 2 * avg20:
            continue
        r = v[i] / avg20
        top, bot = max(hi[i - 249:i + 1]), min(lo[i - 249:i + 1])
        if top <= bot or c[i] >= 0.9 * top:
            continue
        pos = (c[i] - bot) / (top - bot)
        h60, l60 = max(hi[i - 59:i + 1]), min(lo[i - 59:i + 1])
        zone = 'bottom' if pos <= 0.3 else ('box' if h60 / l60 - 1 <= 0.25 and pos <= 0.6 else None)
        if zone is None:
            continue
        lt = ma(i, 20) < ma(i, 60) < ma(i, 120) < ma(i, 224)
        st = ma(i, 5) > ma(i, 10) > ma(i, 20) and c[i] > ma(i, 5)
        band = '2~5배' if r < 5 else '5배+'
        shape = '양봉' if c[i] > o[i] else '음봉'
        zn = '바닥권' if zone == 'bottom' else '박스권'
        for key in (f'{zn} {band}', f'{zn} {band} {shape}', f'{zn} 전체 2배+', f'{zn} 2배+ LT', f'{zn} 2배+ LT+ST', f'{zn} 2배+ ST', f'{zn} 2배+ 비LT'):
            if key.endswith(' LT') and not lt:
                continue
            if key.endswith(' LT+ST') and not (lt and st):
                continue
            if key.endswith(' ST') and not (st and not key.endswith('LT+ST')):
                continue
            if key.endswith(' 비LT') and lt:
                continue
            out[key].append((rows[i][0], g, None))
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
