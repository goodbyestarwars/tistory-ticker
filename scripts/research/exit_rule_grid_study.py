# -*- coding: utf-8 -*-
"""'대형 주도 + 120봉 상승 뒤 눌림 + 조용함' 후보의 손절·익절 규칙 비교 (연구용, 실전 연결 없음 - 2026-11-13).

후보: 거래대금 날짜별 상위 15% · auto-wave.shapeOf 120봉 pullback/rebound · 두 숫자 점수 상위 30%. 같은 종목은 청산 전 재진입 금지.
진입 t+1 시가. 일봉 순서상 같은 날 손절·익절이 모두 닿으면 손절로 처리(보수적). 왕복 비용 0.7%. 최대 보유 60거래일(시간 청산 종가).
규칙: 고정 손절(-5/-7/-10/-15%) × 고정 익절(+10/+15/+20/+30%/없음), ATR 손절(진입 시 ATR14 × 2), 구조 손절(진입 전 20봉 최저가 -1%),
      추적 손절(보유 중 최고 종가 대비 -10/-15%), 구조 손절 + 추적 -15%.
비교 기준: 같은 규칙을 '아무 종목'(같은 날짜 무작위 동수 표본)에 적용.
결과(기간별): 100번 거래 중 수익 거래 수, 거래당 평균 순수익, 평균 보유일, 최악 10% 거래 평균.
실행: python exit_rule_grid_study.py <작업 폴더(prep.pkl·shape.tsv·cache/)> <out.json>
"""
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

COST, MAXH = 0.007, 60


def rules():
    out = {}
    for sl in (0.05, 0.07, 0.10, 0.15):
        for tp in (0.10, 0.15, 0.20, 0.30, None):
            out['손절-%d%%/익절%s' % (sl * 100, '+%d%%' % (tp * 100) if tp else '없음')] = ('fix', sl, tp)
    out['ATR×2 손절/익절없음'] = ('atr', 2.0, None)
    out['ATR×2 손절/익절+20%'] = ('atr', 2.0, 0.20)
    out['구조(20봉 저점) 손절/익절없음'] = ('struct', None, None)
    out['구조 손절/익절+20%'] = ('struct', None, 0.20)
    out['추적 -10%'] = ('trail', 0.10, None)
    out['추적 -15%'] = ('trail', 0.15, None)
    out['구조 손절+추적 -15%'] = ('struct_trail', 0.15, None)
    out['손절없음/60일 보유'] = ('none', None, None)
    return out


def simulate(o, h, l, c, atr, i, rule):
    kind, a, tp = rule
    e = o[i + 1]
    if kind == 'fix':
        stop = e * (1 - a)
    elif kind == 'atr':
        stop = e - a * atr[i]
    elif kind in ('struct', 'struct_trail'):
        stop = l[max(0, i - 19):i + 1].min() * 0.99
    else:
        stop = -np.inf
    target = e * (1 + tp) if tp else np.inf
    peak = e
    end = min(len(c) - 1, i + MAXH)
    for j in range(i + 1, end + 1):
        if kind in ('trail', 'struct_trail'):
            stop = max(stop, peak * (1 - a))
        if o[j] <= stop and j > i + 1:
            return o[j] / e - 1 - COST, j - i
        if l[j] <= stop:
            return stop / e - 1 - COST, j - i
        if h[j] >= target:
            return max(target, o[j]) / e - 1 - COST, j - i
        peak = max(peak, c[j])
    return c[end] / e - 1 - COST, end - i


def main(lab, out_path):
    warnings.filterwarnings('ignore')
    df = pd.read_pickle(os.path.join(lab, 'prep.pkl'))[['code', 'd', 'period', 'p_score', 'p_logamt']]
    sh = pd.read_csv(os.path.join(lab, 'shape.tsv'), sep='\t', dtype={'code': str, 'd': str}, usecols=['code', 'd', 't120'])
    df = df.merge(sh, on=['code', 'd'])
    cand = (df.p_logamt > .85) & df.t120.isin(['pullback', 'rebound']) & (df.p_score > .7)
    rng = np.random.default_rng(7)
    picks = df[cand].copy()
    picks['grp'] = 'cand'
    # 대조군: 같은 날짜에서 같은 수의 무작위 종목
    need = cand.groupby(df.d).sum()
    parts = []
    for d, g in df.groupby('d'):
        k = int(need.get(d, 0))
        if k:
            parts.append(g.sample(n=min(len(g), k), random_state=int(rng.integers(1e9))))
    ctrl = pd.concat(parts)
    ctrl = ctrl.copy()
    ctrl['grp'] = 'ctrl'
    sel = pd.concat([picks, ctrl])
    R = rules()
    rows = []
    for code, g in sel.groupby('code'):
        px = json.load(open(os.path.join(lab, 'cache', code + '.json')))['px']
        px = [r for r in px if r[0] < '20261113']
        pos = {r[0]: k for k, r in enumerate(px)}
        a = np.array([r[1:5] for r in px], float)
        o, h, l, c = a.T
        tr = np.maximum(h - l, np.maximum(np.abs(h - np.r_[c[0], c[:-1]]), np.abs(l - np.r_[c[0], c[:-1]])))
        atr = pd.Series(tr).rolling(14).mean().values
        for grp, gg in g.groupby('grp'):
            busy_until = {}
            for d, per in zip(gg.d.sort_values(), gg.sort_values('d').period):
                i = pos.get(d)
                if i is None or i + MAXH >= len(c) or o[i + 1] <= 0 or not np.isfinite(atr[i]):
                    continue
                for name, rule in R.items():
                    if busy_until.get(name, -1) >= i:
                        continue
                    ret, held = simulate(o, h, l, c, atr, i, rule)
                    busy_until[name] = i + held
                    rows.append((grp, per, name, ret, held))
    t = pd.DataFrame(rows, columns=['grp', 'period', 'rule', 'ret', 'held'])
    t['ret'] = t.ret.clip(-0.9, 3.0)
    res = []
    for (grp, per, rule), g in t.groupby(['grp', 'period', 'rule']):
        q = g.ret.quantile(0.1)
        res.append({'grp': grp, 'period': per, 'rule': rule, 'n': len(g), 'wins_per100': round(float((g.ret > 0).mean()) * 100, 1),
                    'avg_net': round(float(g.ret.mean()) * 100, 2), 'avg_hold': round(float(g.held.mean()), 1),
                    'worst10_avg': round(float(g.ret[g.ret <= q].mean()) * 100, 1)})
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    r = pd.DataFrame(res)
    pv = r.pivot_table(index='rule', columns=['grp', 'period'], values=['wins_per100', 'avg_net'])
    pd.set_option('display.width', 300); pd.set_option('display.max_columns', 30); pd.set_option('display.max_rows', 60)
    print(pv.round(1))
    print(r[r.grp == 'cand'].pivot_table(index='rule', columns='period', values=['avg_hold', 'worst10_avg', 'n']).round(1))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
