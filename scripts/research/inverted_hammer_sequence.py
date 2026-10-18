# -*- coding: utf-8 -*-
"""역배열 대량 역망치 '이후' 흔적 검증: 매집이 있었다면 털고 나간 흔적(지지 이탈 뒤 회복) 또는 돌파가 이어진다는 가설(연구용, 2026-10-19).

사용자 논리: 세력은 손해 보고 나가지 않는다. 역배열 저점에서 거래량이 터진 역망치가 매집이면, 그 뒤에 털기(지지 이탈 뒤 회복) 또는 돌파 흔적이 있어야 한다.
정의(숫자화는 해석):
  A 매집 후보 = 역망치(범위 2%+, 윗꼬리 60%+, 아랫꼬리 15%-, 몸통 30%-) + 거래량 >= 직전 20일 평균 x 2.5 + 거래대금 30억원+ + 역배열(MA5<MA20<MA60<MA120) + 종가가 250일 범위 하위 40%.
  T1 돌파 = A 이후 20거래일 안에, 종가가 A 저가 아래로 내려간 적이 없이 처음으로 종가가 A 고가 위. 그날 종가 확정 후 다음 날 시가 진입.
  T2 털기 후 회복 = A 이후 20거래일 안에 종가가 A 저가 아래로 내려갔다가(지지 이탈=털기 후보), 그 뒤 10거래일 안에 종가가 A 종가 이상으로 회복. 회복일 다음 날 시가 진입.
  T3 이탈 후 미회복 = 종가가 A 저가 아래로 내려간 뒤 10거래일 안에 회복하지 못함(대조). 10거래일째 종가 다음 날 시가 진입.
  S 단기 정배열 = 트리거일 MA5 > MA10 > MA20.
성과·기준선·비용은 inverted_hammer_study 와 같다(다음 날 시가 +0.10% 매수, N거래일 뒤 종가 -0.15%, 총수익, 같은 날짜 유동 종목 평균 대비 초과, 날짜 묶음 t).
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inverted_hammer_study import AMOUNT_MIN, HORIZONS, SLIP_BUY, SLIP_SELL, VOL_MULT, shape_inverted_hammer, summarize  # noqa: E402

WAIT, RECOVER = 20, 10


def forward_gross(c, o, i, n):
    """i 일 종가 확정 후 다음 날 시가 진입. 반환 {hz: 총수익%} (없으면 빈 dict)."""
    if i + 1 >= n or o[i + 1] <= 0:
        return {}
    entry = o[i + 1] * (1 + SLIP_BUY / 100)
    return {hz: (c[i + hz] * (1 - SLIP_SELL / 100) / entry - 1) * 100 for hz in HORIZONS if i + hz < n}


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
    base, out = {}, defaultdict(list)
    for i in range(224, n - 1):
        g = forward_gross(c, o, i, n)
        if g and c[i] * v[i] >= AMOUNT_MIN:
            base[rows[i][0]] = g
    for i in range(250, n - WAIT - RECOVER - 2):
        avg20 = (vs[i] - vs[i - 20]) / 20
        if avg20 <= 0 or c[i] * v[i] < AMOUNT_MIN or v[i] < VOL_MULT * avg20 or not shape_inverted_hammer(o[i], hi[i], lo[i], c[i]):
            continue
        m5, m20, m60, m120 = ma(i, 5), ma(i, 20), ma(i, 60), ma(i, 120)
        top, bot = max(hi[i - 249:i + 1]), min(lo[i - 249:i + 1])
        if not (m5 < m20 < m60 < m120) or top <= bot or (c[i] - bot) / (top - bot) > 0.4:
            continue
        a_low, a_high, a_close = lo[i], hi[i], c[i]
        out['A_후보(역배열 저점 대량 역망치)'].append((rows[i][0], forward_gross(c, o, i, n), None))
        broke = None
        for k in range(i + 1, i + 1 + WAIT):
            if broke is None:
                if c[k] < a_low:
                    broke = k
                elif c[k] > a_high:
                    _add(out, 'T1_돌파(이탈 없이 A 고가 위 종가)', rows, c, o, k, n, ma)
                    break
            if broke is not None:
                break
        if broke is not None:
            rec = next((k for k in range(broke + 1, broke + 1 + RECOVER) if c[k] >= a_close), None)
            if rec is not None:
                _add(out, 'T2_털기 후 회복(저가 이탈 뒤 A 종가 회복)', rows, c, o, rec, n, ma)
            else:
                _add(out, 'T3_이탈 후 미회복(대조)', rows, c, o, broke + RECOVER, n, ma)
    return out, base


def _add(out, tag, rows, c, o, k, n, ma):
    g = forward_gross(c, o, k, n)
    if not g:
        return
    out[tag].append((rows[k][0], g, None))
    m5, m10, m20 = ma(k, 5), ma(k, 10), ma(k, 20)
    if m5 is not None and m10 is not None and m20 is not None and m5 > m10 > m20:
        out[tag + ' + S 단기 정배열'].append((rows[k][0], g, None))


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
    res = {}
    for t, lst in events.items():
        res[t] = {part: {str(hz): summarize(lst, base_day, hz, part) for hz in HORIZONS} for part in ('all', 'train', 'valid')}
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return res


if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2])
    print('done')
