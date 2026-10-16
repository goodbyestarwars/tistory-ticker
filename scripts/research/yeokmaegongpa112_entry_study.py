# -*- coding: utf-8 -*-
"""역매공파 112 진입 시점 조건 시험(연구용, 실전 연결 없음 - 2026-10-17).

yeokmaegongpa112_backtest.py 의 신호(셋업)는 "조건이 갖춰진 날 다음 날 시가에 바로 진입"(E0)이었다. 여기서는 영상이 말하는
"올라갔다가 눌러줄 때 눌림목을 잡는다"를 기계 조건으로 옮겨, 셋업 뒤 일정 기간 안에 첫 번째로 맞는 날 다음 날 시가에 진입한다:
  E0 바로 진입(비교 기준)
  E1 눌림목: 셋업 후 15봉 안에, 셋업일 20일선 +3% 이상까지 올랐다가(push), 저가가 20일선 +1% 이내로 내려오고 종가가 20일선의 98% 이상·60일선 위,
     거래량이 직전 20일 평균 이하(거래 마름). 구조 손절 = 그날 포함 5봉 최저가 -0.5%
  E2 공구리 지지 재확인: 셋업 후 15봉 안에, 저가가 공구리 저점(셋업일 기준 최근 20봉 최저가)의 +2% 이내로 내려오고 그 저점 위에서 양봉 마감.
     구조 손절 = 공구리 저점 -0.5%
  E3 112일선 돌파 확인: 셋업 후 20봉 안에, 전날 종가 <= 112일선이었다가 종가가 112일선 위로 올라서고 거래량이 평균의 1.5배 이상. 구조 손절 = 5봉 최저가 -0.5%
청산 규칙·비용·모사 방식은 yeokmaegongpa112_backtest.py 와 같다(R1 고정 3.5% / R2 구조 손절(8% 초과는 진입 포기), 목표 +20%, 최대 40봉).
자료: 일봉 캐시 디렉터리(종목당 JSON [[date, open, high, low, close, volume], ...]). 신호일 기준 시장 상태 = 전 종목 동일가중 지수 대 그 60일 이동평균.
실행: python yeokmaegongpa112_entry_study.py <일봉 캐시 디렉터리> <out.json>
"""

import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import yeokmaegongpa112_backtest as bt  # noqa: E402

PUSH_PCT = 0.03
WINDOWS = {'E1': 15, 'E2': 15, 'E3': 20}
STRUCT_RULES = ('R1', 'R2')
VARIANT_ENTRIES = {'V0': ('E0',), 'V1': ('E0', 'E1', 'E2', 'E3'), 'V2': ('E0', 'E1', 'E2', 'E3'), 'V4': ('E0', 'E1', 'E2', 'E3')}


def load_rows(path):
    raw = json.load(open(path, encoding='utf-8'))
    return [(r[0], r[1], r[2], r[3], r[4], r[5]) for r in raw if r[1] and r[2] and r[3] and r[4]]


def find_entries(rows, s, tools):
    """셋업일 s 뒤의 진입 시점들 {entry: (진입 신호 인덱스 k, support|None)}."""
    n = len(rows)
    close = [r[4] for r in rows]
    pre20, pre60, pre112, vol_pre = tools['p20'], tools['p60'], tools['p112'], tools['vol']
    ma20_s = bt.sma_at(pre20, s, 20)
    base_low = min(r[3] for r in rows[s - 19:s + 1])
    out = {'E0': (s, None)}
    max_close = close[s]
    found = {}
    for k in range(s + 1, min(n - 1, s + max(WINDOWS.values())) + 1):
        d, o, h, l, c, v = rows[k]
        avg20 = (vol_pre[k] - vol_pre[k - 20]) / 20
        ma20 = bt.sma_at(pre20, k, 20)
        ma60 = bt.sma_at(pre60, k, 60)
        if 'E1' not in found and k >= s + 2 and k - s <= WINDOWS['E1']:
            pushed = max_close >= ma20_s * (1 + PUSH_PCT)
            if pushed and l <= ma20 * 1.01 and c >= ma20 * 0.98 and c > ma60 and v <= avg20:
                found['E1'] = (k, min(r[3] for r in rows[k - 4:k + 1]))
        if 'E2' not in found and k - s <= WINDOWS['E2']:
            if l <= base_low * 1.02 and c > base_low and c > o:
                found['E2'] = (k, base_low)
        if 'E3' not in found and k - s <= WINDOWS['E3']:
            m112, m112_prev = bt.sma_at(pre112, k, 112), bt.sma_at(pre112, k - 1, 112)
            if m112 is not None and m112_prev is not None and close[k - 1] <= m112_prev and c > m112 and avg20 > 0 and v >= 1.5 * avg20:
                found['E3'] = (k, min(r[3] for r in rows[k - 4:k + 1]))
        max_close = max(max_close, c)
    out.update(found)
    return out


def main(cache_dir, out_path):
    files = sorted(f for f in os.listdir(cache_dir) if f.endswith('.json'))
    # 1) 시장 지수(동일가중)
    ret_sum, ret_cnt = defaultdict(float), defaultdict(int)
    for f in files:
        rows = load_rows(os.path.join(cache_dir, f))
        for k in range(1, len(rows)):
            if rows[k - 1][4] > 0:
                r = rows[k][4] / rows[k - 1][4] - 1
                if -0.3 < r < 0.3:
                    ret_sum[rows[k][0]] += r
                    ret_cnt[rows[k][0]] += 1
    dates = sorted(ret_sum)
    level, vals = 100.0, []
    for d in dates:
        level *= 1 + ret_sum[d] / max(1, ret_cnt[d])
        vals.append(level)
    ipre = bt.prefix(vals)
    pos = {d: j for j, d in enumerate(dates)}

    def regime(d):
        j = pos.get(d)
        if j is None or j < 60:
            return 'n/a'
        return 'up' if vals[j] >= (ipre[j + 1] - ipre[j + 1 - 60]) / 60 else 'down'

    # 2) 셋업·진입·청산
    results = defaultdict(list)     # (variant, entry, rule) -> [trade + date]
    scanned = 0
    for f in files:
        rows = load_rows(os.path.join(cache_dir, f))
        if len(rows) < 230:
            continue
        scanned += 1
        sigs = bt.scan_stock(f[:-5], rows, None)
        if not sigs:
            continue
        close = [r[4] for r in rows]
        tools = {'p20': bt.prefix(close), 'p60': bt.prefix(close), 'p112': bt.prefix(close), 'vol': bt.prefix([float(r[5] or 0) for r in rows])}
        mas = {'p112': tools['p112']}
        for name, s, info in sigs:
            if name not in VARIANT_ENTRIES:
                continue
            entries = find_entries(rows, s, tools) if name != 'V0' else {'E0': (s, None)}
            for entry in VARIANT_ENTRIES[name]:
                if entry not in entries:
                    continue
                k, support = entries[entry]
                for rule in STRUCT_RULES:
                    res = bt.simulate(rows, k, rule, mas, support=support)
                    if res:
                        res['date'] = rows[k][0]
                        results[(name, entry, rule)].append(res)
    out = {'scanned': scanned, 'range': [dates[0], dates[-1]], 'cells': {}, 'byYear': {}, 'byRegime': {}}
    for (name, entry, rule), trades in sorted(results.items()):
        key = '%s_%s_%s' % (name, entry, rule)
        out['cells'][key] = bt.stats(trades)
        by_y, by_r = defaultdict(list), defaultdict(list)
        for t in trades:
            by_y[t['date'][:4]].append(t)
            by_r[regime(t['date'])].append(t)
        out['byYear'][key] = {y: bt.stats(v) for y, v in sorted(by_y.items())}
        out['byRegime'][key] = {r: bt.stats(v) for r, v in sorted(by_r.items())}
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done scanned=%d cells=%d' % (scanned, len(out['cells'])))


if __name__ == '__main__':
    main(*sys.argv[1:3])
