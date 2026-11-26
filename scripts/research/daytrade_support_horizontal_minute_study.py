# -*- coding: utf-8 -*-
"""수평 지지선 진입 분봉 백테스트 v2 (연구 전용, 주문·자동매매 연결 없음 - 2026-11-26).

판정 기준은 결과를 보기 전에 `docs/SUPPORT_HORIZONTAL_MINUTE_STUDY_2026-11-26.md`에 고정했다.
지지선 `S`를 "60거래일 안에서 서로 5일 이상 떨어져 ±1.5% 안에 2번 이상 시험받은 수평 저점대"로 정의한다.
진입·청산·통계·분봉 수집은 v1(`daytrade_support_pullback_minute_study.py`)을 재사용한다.

서브명령
  cand    <일봉 cache 폴더> <후보.csv>
  fetch   <후보.csv> <분봉 cache 폴더>        (KIS_APPKEY/KIS_APPSECRET 환경변수)
  analyze <후보.csv> <분봉 cache 폴더> <out.json>
"""
import csv
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daytrade_support_pullback_minute_study as P  # noqa: E402

WINDOW = 60          # 지지선을 찾는 거래일 수
PIVOT_SPAN = 2       # 저점 후보: 앞뒤 2거래일보다 낮거나 같은 날
TOL = 0.015          # 같은 수평대로 묶는 저가 허용 오차 ±1.5%
MIN_GAP = 5          # 터치 사이 최소 거래일
MIN_TOUCH = 2
RECENT = 20          # 마지막 터치가 이 거래일 이내
BREAK = 0.97         # 첫 터치 이후 일중 저가가 S×0.97 아래로 내려가면 무너진 지지
NEAR_LOW, NEAR_HIGH = 0.985, 1.10   # t-1 종가가 S 대비 이 범위 안
RECLAIM_MIN = 15     # E2: 첫 이탈 후 15분 안에 복귀
PRIMARY_V2 = [('E1', 'Y2_struct'), ('E2', 'Y2_struct')]


def horizontal_support(l, c, t):
    """t 일 장 시작 전(t-1 까지의 일봉)에 보이는 수평 지지선. 없으면 None."""
    end = t - 1
    start = max(PIVOT_SPAN, end - WINDOW + 1)
    piv = []
    for i in range(start, end - PIVOT_SPAN + 1):            # 확정에 뒤 2일이 필요하므로 end-2 까지
        if l[i] > 0 and l[i] <= min(l[i - PIVOT_SPAN:i + PIVOT_SPAN + 1]):   # 거래정지 등 0 가격 행은 저점으로 쓰지 않는다
            piv.append(i)
    best = None
    for j in piv:
        members = []
        for i in piv:
            if abs(l[i] / l[j] - 1) <= TOL and (not members or i - members[-1] >= MIN_GAP):
                members.append(i)
        if len(members) < MIN_TOUCH:
            continue
        lows = [l[i] for i in members]
        if max(lows) / min(lows) - 1 > 2 * TOL:
            continue
        key = (float(np.median(lows)), -len(members))        # 가장 낮은 수평대(= 바닥), 같으면 터치 많은 쪽
        if best is None or key < best[0]:
            best = (key, members, lows)
    if best is None:
        return None
    _, members, lows = best
    S = float(np.median(lows))
    if end - members[-1] > RECENT:
        return None
    if min(l[start:end + 1]) < S * BREAK:                   # 60거래일 안에 이보다 낮은 저점이 있으면 바닥이 아니다
        return None
    if not (S * NEAR_LOW <= c[end] <= S * NEAR_HIGH):
        return None
    return {'S': S, 'touches': len(members), 'last_touch': members[-1], 'first_touch': members[0]}


def candidates(code, px, since=''):
    n = len(px)
    if n < 100:
        return []
    d = [str(r[0]) for r in px]
    o, h, l, c, v = (np.array([r[i] for r in px], float) for i in range(1, 6))
    cs, vs = pd.Series(c), pd.Series(v)
    amt20 = (cs * vs).rolling(20).mean().values
    ret = np.r_[np.nan, c[1:] / c[:-1] - 1]
    surge60 = pd.Series(ret).rolling(59).max().values
    vmean5 = vs.rolling(5).mean().values
    out = []
    for t in range(80, n):
        if d[t] < since:
            continue
        if not (amt20[t - 1] >= P.MIN_AMT):
            continue
        if not (surge60[t - 2] >= 0.15):
            continue
        if not (vmean5[t - 2] > 0 and v[t - 1] >= 2 * vmean5[t - 2]):
            continue
        hs = horizontal_support(l, c, t)
        if not hs:
            continue
        out.append({'code': code, 'd': d[t], 'S': hs['S'], 'prev_close': float(c[t - 1]),
                    'prev_high': float(h[t - 1]), 'day_high': float(h[t]), 'day_low': float(l[t]),
                    'day_open': float(o[t]), 'touches': hs['touches']})
    return out


def cmd_cand(daily_dir, out_csv):
    rows = []
    for f in sorted(os.listdir(daily_dir)):
        if not f.endswith('.json'):
            continue
        try:
            px = json.load(open(os.path.join(daily_dir, f), encoding='utf-8'))['px']
        except Exception:
            continue
        rows.extend(candidates(f[:-5], px, P.SINCE))
    cols = ['code', 'd', 'S', 'prev_close', 'prev_high', 'day_high', 'day_low', 'day_open', 'touches']
    with open(out_csv, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print('candidates', len(rows), 'days', len({r['d'] for r in rows}), 'codes', len({r['code'] for r in rows}))


def cmd_analyze(cand_csv, minute_dir, out_path):
    events, skips = [], {}
    cands = P.load_candidates(cand_csv)
    for c in cands:
        bars = P.B._load_bars(minute_dir, c['code'], c['d'])
        r = P.simulate(bars, c, reclaim_minutes=RECLAIM_MIN) if bars else {'skip': 'no_minute'}
        if 'skip' in r:
            skips[r['skip']] = skips.get(r['skip'], 0) + 1
            continue
        r['code'], r['d'] = c['code'], c['d']
        events.append(r)
    out = {'candidates': len(cands), 'usable': len(events), 'skips': skips, 'cost': P.COST,
           'result': P.summarize(events, PRIMARY_V2)}
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    a = sys.argv
    if len(a) >= 4 and a[1] == 'cand':
        cmd_cand(a[2], a[3])
    elif len(a) >= 4 and a[1] == 'fetch':
        P.cmd_fetch(a[2], a[3])
    elif len(a) >= 5 and a[1] == 'analyze':
        cmd_analyze(a[2], a[3], a[4])
    else:
        raise SystemExit(__doc__)
