# -*- coding: utf-8 -*-
"""상승 구간 해부 7단계: 매수는 QLP로 고정하고 매도 규칙만 비교 (연구 전용, 실전·주문 연결 없음 - 2026-11-19).

매수: pullback_combo_study.prepare의 QLP & 기존 하락장 제외(유니버스 동일가중 60일선 규칙) 신호일 t, t+1 시가 e.
매도 규칙 격자 54개 = 손절 3 × 수익 보호 3 × 최대 보유 3 × 절반 익절 2:
  손절   S7(-7%) · S10(-10%) · SATR(e - 2×ATR14[t]). 저가가 닿으면 min(그날 시가, 손절가)에 판다(갭 하락 반영).
  보호   +10% 고가 도달 뒤에만 작동. MA20(종가 < 20일선) · MA60(종가 < 60일선) · TR15(종가 < 진입 뒤 최고 종가×0.85) -> 다음 시가.
  보유   H60 · H120 · H250 거래일째 종가. 자료가 먼저 끝나면 마지막 종가(중도 절단, censored 수 기록).
  절반   NO · HALF(고가가 +20%에 닿으면 절반을 +20%에 실현, 나머지는 같은 규칙).
  같은 날 우선순위: 손절 > 절반 익절 > 보호. 비용 0.7%(왕복, 매매당 1회).
exit-v1(기존 combo)과 같은 S10·MA20·H60·NO도 이 격자 안에서 같은 갭 규칙으로 다시 계산해 기준선으로 쓴다.
선정: 학습 기간 PF 최고(매매 50건 이상) 규칙 1개만 고르고, 검증·시험에서는 그 하나만 확인한다.
누적 낙폭(MDD) = 진입일 순으로 매매 수익(%)을 더한 누적선의 최대 낙폭(%p, 동일 금액 단순 합).
실행: python exit_rule_study.py <작업 폴더> <shape.tsv> <out.json>
"""
import itertools
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pullback_combo_study as P  # noqa: E402
from spring_index_study import atr14  # noqa: E402

STOPS = ('S7', 'S10', 'SATR')
PROTECTS = ('MA20', 'MA60', 'TR15')
HOLDS = (60, 120, 250)
HALVES = ('NO', 'HALF')
BASE = ('S10', 'MA20', 60, 'NO')


def simulate(o, h, l, c, atr, m20, m60, i, rule):
    """신호일 i(종가까지 관측) 다음 시가 진입. 반환 (수익률, 보유일, 중도 절단 여부). i 이후 봉만 쓴다."""
    stop, prot, hold, half = rule
    n = len(c)
    e = o[i + 1]
    sp = e * 0.93 if stop == 'S7' else e * 0.9 if stop == 'S10' else e - 2 * atr[i]
    armed, peak, half_done, real = False, -np.inf, False, 0.0
    for k in range(i + 1, min(i + 1 + hold, n)):
        days = k - i
        if l[k] <= sp:
            px = min(o[k], sp)
            return _ret(e, px, half_done, real), days, False
        if half == 'HALF' and not half_done and h[k] >= e * 1.2:
            half_done, real = True, 0.2
        if h[k] >= e * 1.1:
            armed = True
        peak = max(peak, c[k])
        if armed:
            bad = (c[k] < m20[k]) if prot == 'MA20' else (c[k] < m60[k]) if prot == 'MA60' else (c[k] < peak * 0.85)
            if bad and k + 1 < n:
                return _ret(e, o[k + 1], half_done, real), days + 1, False
    k = min(i + hold, n - 1)
    return _ret(e, c[k], half_done, real), k - i, i + hold > n - 1


def _ret(e, px, half_done, real):
    r = px / e - 1
    return (0.5 * real + 0.5 * r if half_done else r) - P.COST


def mdd(tr):
    cum = np.cumsum(np.asarray(tr) * 100)
    return float(np.max(np.maximum.accumulate(np.r_[0, cum])[1:] - cum)) if len(cum) else 0.0


def summarize(rows):
    """rows: [(d, code, i, ret, hold, cens)] -> 보유 중 재진입 금지 적용 뒤 통계."""
    keep, until = [], {}
    for d, code, i, r, hd, cs in sorted(rows):
        if code in until and i <= until[code]:
            continue
        keep.append((r, cs))
        until[code] = i + hd
    tr = np.array([k[0] for k in keep])
    if not len(tr):
        return {'trades': 0}
    w, ls = tr[tr > 0], tr[tr <= 0]
    return {'trades': int(len(tr)), 'win': round(float((tr > 0).mean()) * 100, 1), 'avg': round(float(tr.mean()) * 100, 2),
            'pf': round(float(w.sum() / -ls.sum()), 2) if len(ls) and ls.sum() < 0 else None,
            'mdd': round(mdd(tr), 1), 'best': round(float(tr.max()) * 100, 1), 'worst': round(float(tr.min()) * 100, 1),
            'censored': int(sum(k[1] for k in keep))}


def main(lab, shape_tsv, out_path):
    df, groups, up_side, data, src = P.prepare(lab, shape_tsv)
    qlp = groups['QLP 주도주 조용한 눌림(기존)']
    sig = df[(qlp & up_side).values if hasattr(qlp & up_side, 'values') else (qlp & up_side)][['d', 'code', 'i_', 'period']]
    rules = list(itertools.product(STOPS, PROTECTS, HOLDS, HALVES))
    out = {r: {'train': [], 'valid': [], 'test': []} for r in rules}
    for code, g in sig.groupby('code'):
        px = data[code]
        o, h, l, c = (np.array([r[k] for r in px], dtype=float) for k in (1, 2, 3, 4))
        atr = atr14(h, l, c)
        cs = pd.Series(c)
        m20, m60 = cs.rolling(20).mean().values, cs.rolling(60).mean().values
        for d, i, per in zip(g.d, g.i_, g.period):
            for r in rules:
                ret, hd, cens = simulate(o, h, l, c, atr, m20, m60, int(i), r)
                out[r][per].append((d, code, int(i), ret, hd, cens))
    table = {'/'.join(map(str, r)): {p: summarize(v) for p, v in d.items()} for r, d in out.items()}
    base = '/'.join(map(str, BASE))
    ok = {k: v for k, v in table.items() if v['train'].get('trades', 0) >= 50 and v['train'].get('pf')}
    pick = max(ok, key=lambda k: ok[k]['train']['pf'])
    res = {'regime_source': src, 'signals': {p: int((sig.period == p).sum()) for p in ('train', 'valid', 'test')},
           'base': base, 'pick': pick, 'table': table}
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('신호', res['signals'], '· 기준선', base, '· 학습 선정', pick)
    rows = [dict(규칙=k, 기간=p, **v[p]) for k, v in sorted(table.items(), key=lambda kv: -(kv[1]['train'].get('pf') or 0)) for p in ('train', 'valid', 'test')]
    pd.set_option('display.width', 220)
    pd.set_option('display.max_rows', 400)
    print(pd.DataFrame(rows).set_index(['규칙', '기간']))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
