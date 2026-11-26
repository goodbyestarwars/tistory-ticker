# -*- coding: utf-8 -*-
"""종가배팅 검색식 부품 조합 구간 분할 검증 v2 (연구 전용, 주문·자동매매 연결 없음 - 2026-11-27).

판정 기준은 결과를 보기 전에 `docs/CLOSING_BET_COMBO_STUDY_2026-11-27.md`에 고정했다.
조건·청산·비용·겹침 제거는 `closing_bet_formula_study`(S)를 그대로 재사용한다.

실행: python closing_bet_combo_study.py <일봉 cache 폴더> <out.json>
"""
import itertools
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import closing_bet_formula_study as S  # noqa: E402

PARTS = ('B', 'CD', 'nE', 'F')
SPLIT = S.SPLIT_DATE
MIN_SELECT, MIN_CONFIRM, TOP_N = 300, 100, 3
CONF_LO, CONF_HI = 100 * (0.05 / TOP_N / 2), 100 * (1 - 0.05 / TOP_N / 2)      # 99.17% 구간(%)


def combos():
    return [tuple(p for p, on in zip(PARTS, bits) if on) for bits in itertools.product((0, 1), repeat=len(PARTS))]


def name(c):
    return 'A' + ''.join('+' + p for p in c)


def cluster_ci_alpha(values, days, lo=CONF_LO, hi=CONF_HI, n=2000, seed=7):
    by = {}
    for v, d in zip(values, days):
        by.setdefault(d, []).append(v)
    keys = list(by)
    if len(keys) < 5:
        return None
    rng = np.random.default_rng(seed)
    sums = np.array([sum(by[k]) for k in keys])
    cnts = np.array([len(by[k]) for k in keys])
    means = [sums[p].sum() / cnts[p].sum() for p in (rng.integers(0, len(keys), len(keys)) for _ in range(n))]
    return [round(float(np.percentile(means, lo)) * 100, 2), round(float(np.percentile(means, hi)) * 100, 2)]


def collect(cache_dir):
    ev = {c: {k: {'vals': [], 'days': []} for k in ('P1', 'P2')} for c in combos()}
    day_sum = {k: {} for k in ('P1', 'P2')}
    for code in sorted(f[:-5] for f in os.listdir(cache_dir) if f.endswith('.json') and f[0].isdigit()):
        rows = S.load_px(cache_dir, code)
        if not rows:
            continue
        dates = [r[0] for r in rows]
        o, h, l, c, v = (np.array([r[i] for r in rows], float) for i in (1, 2, 3, 4, 5))
        cond = S.conditions(o, h, l, c, v)
        rets = S.exit_returns(o, h, l, c)
        for k in ('P1', 'P2'):
            for i in np.flatnonzero(cond['gate']):
                if not np.isnan(rets[k][i]):
                    s = day_sum[k].setdefault(dates[i], [0.0, 0])
                    s[0] += rets[k][i] - S.COST
                    s[1] += 1
        base = cond['gate'] & cond['parts']['A']
        for cb in combos():
            mask = base.copy()
            for p in cb:
                mask &= cond['parts'][p]
            for i in np.flatnonzero(S.dedupe(mask)):
                for k in ('P1', 'P2'):
                    x = rets[k][i]
                    if not np.isnan(x):
                        ev[cb][k]['vals'].append(float(x - S.COST))
                        ev[cb][k]['days'].append(dates[i])
    base_of = {k: {d: s[0] / s[1] for d, s in day_sum[k].items()} for k in day_sum}
    return ev, base_of


def part(e, base_of, k, sel):
    pick = [j for j, d in enumerate(e['days']) if sel(d)]
    vals = [e['vals'][j] for j in pick]
    days = [e['days'][j] for j in pick]
    s = S.stat_rows(vals, days)
    s['baselineMean'] = round(float(np.mean([base_of[k][d] for d in days])) * 100, 2) if days else None
    return s, vals, days


def confirm_verdict(vals, days, stats):
    if stats.get('n', 0) < MIN_CONFIRM:
        return '판정 불가'
    ci = cluster_ci_alpha(vals, days)
    stats['ci9917'] = ci
    ok = (stats['mean'] > 0 and ci and ci[0] > 0 and stats['meanNoTop5'] is not None
          and stats['meanNoTop5'] > 0 and stats['mean'] > stats['baselineMean'])
    return '좋은 조합 있음' if ok else '없음'


def rank_corr(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return round(float(np.corrcoef(ra, rb)[0, 1]), 2) if len(a) > 2 else None


def run(cache_dir):
    ev, base_of = collect(cache_dir)
    table = {}
    for cb in combos():
        sel, _, _ = part(ev[cb]['P1'], base_of, 'P1', lambda d: d < SPLIT)
        con, _, _ = part(ev[cb]['P1'], base_of, 'P1', lambda d: d >= SPLIT)
        con2, _, _ = part(ev[cb]['P2'], base_of, 'P2', lambda d: d >= SPLIT)
        table[name(cb)] = {'select_P1': sel, 'confirm_P1': con, 'confirm_P2': con2}
    ranked = sorted((cb for cb in combos() if table[name(cb)]['select_P1'].get('n', 0) >= MIN_SELECT),
                    key=lambda cb: -table[name(cb)]['select_P1']['mean'])
    chosen, verdicts = ranked[:TOP_N], {}
    for cb in chosen:
        st, vals, days = part(ev[cb]['P1'], base_of, 'P1', lambda d: d >= SPLIT)
        verdicts[name(cb)] = {'select': table[name(cb)]['select_P1'], 'confirm': st,
                              'verdict': confirm_verdict(vals, days, st)}
    pairs = [(table[name(c)]['select_P1']['mean'], table[name(c)]['confirm_P1']['mean']) for c in ranked
             if table[name(c)]['confirm_P1'].get('n', 0) >= MIN_CONFIRM]
    return {'cost': S.COST, 'split': SPLIT, 'chosen': [name(c) for c in chosen], 'verdicts': verdicts,
            'rankCorr': rank_corr([p[0] for p in pairs], [p[1] for p in pairs]), 'table': table}


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    out = run(sys.argv[1])
    json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != 'table'}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
