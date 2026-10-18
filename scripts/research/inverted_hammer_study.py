# -*- coding: utf-8 -*-
"""역망치(긴 윗꼬리) 매집·세력 탈출 가설 일봉 검증(연구용, 실전 연결 없음 - 2026-10-19 사용자 정의).

사용자 정의(2026-10-19): 보통 역망치가 매집봉이다. 역배열에서 나온 역망치가 이평선과 1:1 이상으로 뚫고(꼬리가 이평선 위로 나갔다가) 도로 빠져야 한다.
224일선 **위**에서 같은 역망치가 나오면 매집이 아니라 탈출이다. 저점에서 거래량이 터지고 고점에서 거래량이 없으면 세력 이탈이 없는 것이다.
해석(문서에 명시, 사용자 정의의 숫자화): 
  역망치 = 범위 2% 이상, 윗꼬리 >= 범위 60%, 아랫꼬리 <= 범위 15%, 몸통 <= 범위 30%(양·음봉 무관).
  대량 = 거래량 >= 직전 20일 평균 x 2.5 이고 거래대금 30억원 이상(기존 대량거래 표시와 같은 기준). 고점 무거래량 대조는 거래량 < 평균.
  역배열 = MA5 < MA20 < MA60 < MA120(그날 종가 기준).
  뚫고 빠짐(1:1) = MA20·MA60·MA120 중 하나가 봉의 범위 안(저가 < MA < 고가)이고 MA 위 길이(고가-MA) >= MA 아래 길이(MA-저가), 종가는 MA 아래.
모두 그날 종가까지 아는 값이다. 성과 = 다음 거래일 시가(+0.10% 슬리피지) 매수, N거래일 뒤 종가(-0.15%) 매도, 비용 0.7% 뺀 순수익과 비용 전 총수익. 기준선 = 같은 날짜 유동 종목(거래대금 30억 이상) 평균 총수익.
**짧게 팔 수 있다는 뜻이 아니다**: 탈출 패턴의 총수익이 기준선보다 낮으면 '이후 하락'의 증거일 뿐이고 공매도 수익은 대차 가능·비용 때문에 별도다.
"""
import json
import math
import os
import sys
from collections import defaultdict

HORIZONS = (5, 10, 20, 60)
SLIP_BUY, SLIP_SELL, COST = 0.10, 0.15, 0.7
AMOUNT_MIN = 3e9
VOL_MULT = 2.5
SPLIT = '2025-01-01'


def shape_inverted_hammer(o, h, l, c):
    rng = h - l
    if rng <= 0 or c <= 0 or rng / c < 0.02:
        return False
    body, upper, lower = abs(c - o), h - max(o, c), min(o, c) - l
    return upper / rng >= 0.6 and lower / rng <= 0.15 and body / rng <= 0.3


def pierce_back(h, l, c, ma):
    """봉 범위가 이평선을 가로지르고, 위로 나간 길이 >= 아래 길이(1:1 이상), 종가는 이평선 아래(뚫고 빠짐)."""
    return l < ma < h and (h - ma) >= (ma - l) and c < ma


def analyze_stock(rows):
    """rows: [[date, o, h, l, c, v]...] -> (패턴별 [(date, 총수익 dict, mfe20)], 날짜별 기준선 총수익 {date: {h: ret}})"""
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
    for i in range(224, n - 1):
        entry = o[i + 1] * (1 + SLIP_BUY / 100)
        if entry <= 0:
            continue
        gross = {}
        for hz in HORIZONS:
            j = i + hz
            if j < n:
                gross[hz] = (c[j] * (1 - SLIP_SELL / 100) / entry - 1) * 100
        if not gross or c[i] * v[i] < AMOUNT_MIN:
            continue
        base[rows[i][0]] = gross
        avg20 = (vs[i] - vs[i - 20]) / 20
        if avg20 <= 0:
            continue
        mfe = (max(hi[i + 1:min(n, i + 21)]) / entry - 1) * 100 if i + 1 < n else None
        m5, m20, m60, m120, m224 = ma(i, 5), ma(i, 20), ma(i, 60), ma(i, 120), ma(i, 224)
        vol_big = v[i] >= VOL_MULT * avg20
        hammer = shape_inverted_hammer(o[i], hi[i], lo[i], c[i])
        pos = (c[i] - min(lo[i - 249:i + 1])) / (max(hi[i - 249:i + 1]) - min(lo[i - 249:i + 1])) if i >= 249 and max(hi[i - 249:i + 1]) > min(lo[i - 249:i + 1]) else None
        rev = m5 < m20 < m60 < m120
        pierce = any(pierce_back(hi[i], lo[i], c[i], m) for m in (m20, m60, m120))
        tags = []
        if hammer and vol_big and rev and pierce:
            tags.append('ACC_역배열_뚫고빠짐')
        if hammer and vol_big and rev:
            tags.append('ACC_역배열(뚫기 무관)')
        if hammer and vol_big and rev and not pierce:
            tags.append('ACC_역배열_뚫기 없음')
        if hammer and vol_big and c[i] > m224:
            tags.append('EXIT_224선 위')
            if c[i] / m224 - 1 >= 0.2:
                tags.append('EXIT_224선 +20% 이상')
        if hammer and not vol_big and v[i] < avg20 and c[i] > m224:
            tags.append('CONTRAST_고점 무거래량(224선 위)')
        if hammer and vol_big and c[i] < m224 and not rev:
            tags.append('CONTRAST_224선 아래·역배열 아님')
        top250 = max(hi[i - 249:i + 1]) if i >= 249 else None
        if top250 and c[i] >= 0.95 * top250:                     # 사용자 가설: 고점권에서 거래량이 안 터지면 우상향이 이어진다
            tags.append('HIGH_고점권 전체(종가>=250일 고가의 95%)')
            tags.append('HIGH_고점권 대량(>=2.5배)' if vol_big else ('HIGH_고점권 무거래량(<평균)' if v[i] < avg20 else 'HIGH_고점권 보통(평균~2.5배)'))
        if vol_big and pos is not None and pos <= 0.2 and not hammer:
            tags.append('CONTRAST_저점 대량(역망치 아님)')
        for t in tags:
            out[t].append((rows[i][0], gross, mfe))
    return out, base


def t_stat(vals):
    if len(vals) < 3:
        return None
    m = sum(vals) / len(vals)
    sd = math.sqrt(sum((x - m) ** 2 for x in vals) / (len(vals) - 1))
    return m / (sd / math.sqrt(len(vals))) if sd else None


def summarize(events, base_day, hz, part):
    """events: [(date, gross, mfe)] -> 건수, 총수익 평균·중앙값, 순수익 평균, 승률, 기준선 대비 초과(날짜 묶음 t)."""
    rows = [(d, g[hz], m) for d, g, m in events if hz in g and (part == 'all' or (part == 'train') == (d < SPLIT))]
    if not rows:
        return {'n': 0}
    gross = [r[1] for r in rows]
    by_day = defaultdict(list)
    for d, g, _ in rows:
        b = base_day.get(d, {}).get(hz)
        if b is not None:
            by_day[d].append(g - b)
    day_means = [sum(x) / len(x) for x in by_day.values()]
    s = sorted(gross)
    return {'n': len(rows), 'gross_mean': sum(gross) / len(gross), 'gross_median': s[len(s) // 2], 'net_mean': sum(gross) / len(gross) - COST,
            'win_net': sum(1 for g in gross if g - COST > 0) / len(gross) * 100,
            'excess_mean': (sum(day_means) / len(day_means)) if day_means else None, 'excess_days': len(day_means), 'excess_t': t_stat(day_means)}


def run(cache_dir, out_path):
    events = defaultdict(list)
    base_sum = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    files = [f for f in os.listdir(cache_dir) if f.endswith('.json') and f[0].isdigit()]
    for f in files:
        try:
            rows = json.load(open(os.path.join(cache_dir, f), encoding='utf-8'))
        except (OSError, ValueError):
            continue
        rows = [r for r in rows if r[1] and r[2] and r[3] and r[4]]
        if len(rows) < 300:
            continue
        ev, base = analyze_stock(rows)
        for t, lst in ev.items():
            events[t].extend((d, g, m, f[:-5]) for d, g, m in lst)
        for d, g in base.items():
            for hz, val in g.items():
                s = base_sum[d][hz]
                s[0] += val
                s[1] += 1
    base_day = {d: {hz: s[0] / s[1] for hz, s in per.items() if s[1] >= 20} for d, per in base_sum.items()}
    res = {'stocks': len(files), 'tags': {}}
    for t, lst in events.items():
        ev3 = [(d, g, m) for d, g, m, code in lst]
        res['tags'][t] = {'codes': len({code for *_, code in lst}), 'mfe20_mean': (sum(m for _, _, m in ev3 if m is not None) / max(1, sum(1 for _, _, m in ev3 if m is not None)))}
        for part in ('all', 'train', 'valid'):
            res['tags'][t][part] = {str(hz): summarize(ev3, base_day, hz, part) for hz in HORIZONS}
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return res


if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2])
    print('done')
