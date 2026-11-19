# -*- coding: utf-8 -*-
"""검색기 메뉴 성적표 3단계: 자동매매가 사는 스윙 검색기 4개 (연구 전용, 실전·주문 연결 없음 - 2026-11-20).

1단계(menu_scorecard_study)의 기간·기준선·재진입 금지·E20/exit-v2를 재사용하고,
자동매매 엔진 관문(rank_candidates)과 엔진 매도 규칙의 일봉 근사(LIVE)를 더한다.
판정 기준: docs/SCANNER_MENU_SCORECARD_2026-11-20.md 3단계(결과 보기 전 고정).
실행: python legacy_scorecard_study.py <작업 폴더> <out.json> <신호.tsv> [신호.tsv ...]
"""
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import menu_scorecard_study as M  # noqa: E402

EXITS = ('LIVE', 'E20', 'exit-v2')
STOP, EMERG, ARM, TRAIL, HOLD = 0.03, 0.05, 0.03, 0.025, 250


def live_exit(o, h, l, c, i):
    """엔진 규칙 일봉 근사. 반환 (수익률, 보유일) 또는 None(자료 끝까지 보유 중)."""
    n = len(c)
    e = o[i + 1]
    peak, armed = None, False
    for k in range(i + 1, min(i + 1 + HOLD, n)):
        days = k - i
        if l[k] <= e * (1 - EMERG):
            return min(o[k], e * (1 - EMERG)) / e - 1 - M.COST, days
        if l[k] <= e * (1 - STOP):
            return min(o[k], e * (1 - STOP)) / e - 1 - M.COST, days
        if armed and l[k] <= peak * (1 - TRAIL):
            return min(o[k], peak * (1 - TRAIL)) / e - 1 - M.COST, days
        peak = h[k] if peak is None else max(peak, h[k])
        if peak >= e * (1 + ARM):
            armed = True
        if armed and c[k] <= peak * (1 - TRAIL):
            return c[k] / e - 1 - M.COST, days
    if i + HOLD <= n - 1:
        return c[i + HOLD] / e - 1 - M.COST, HOLD
    return None


def engine_ok(o, h, l, c, v, i):
    """live_engine.rank_candidates 관문 + 다음 날 시가 +2% 추격 금지. i까지(신호일) 자료와 i+1 시가만 쓴다."""
    if i < 20 or i + 1 >= len(c):
        return False
    cl, hi, lo, vo = c[i - 19:i + 1], h[i - 19:i + 1], l[i - 19:i + 1], v[i - 19:i + 1]
    if cl.min() <= 0:
        return False
    if (cl * vo).mean() < 1e9:
        return False
    if not 0.01 <= ((hi - lo) / cl).mean() <= 0.08:
        return False
    if cl[-1] / cl.mean() - 1 <= 0:
        return False
    return o[i + 1] < c[i] * 1.02


def run(o, h, l, c, m20, m60, i, name):
    if name == 'LIVE':
        return live_exit(o, h, l, c, i)
    return M.run_exit(o, h, l, c, m20, m60, i, name)


def sequential(idx, o, h, l, c, m20, m60, name):
    out, until = [], -1
    for i in idx:
        if i <= until or i + 1 >= len(c):
            continue
        r = run(o, h, l, c, m20, m60, i, name)
        if r is None:
            until = len(c)
            continue
        out.append((i, r[0], r[1]))
        until = i + r[1]
    return out


def main(lab, out_path, sig_paths):
    sig = pd.concat([pd.read_csv(p, sep='\t', dtype={'code': str, 'd': str}) for p in sig_paths], ignore_index=True)
    sig = sig[sig.d < M.CUTOFF]
    rng = np.random.default_rng(M.SEED)
    keys = sorted(sig.scanner.unique()) + ['BASE']
    res = {(k, e): {p: [] for p, _, _ in M.PERIODS} for k in keys for e in EXITS}
    by_code = {code: g for code, g in sig.groupby('code')}
    files = sorted(f for f in os.listdir(os.path.join(lab, 'cache')) if f.endswith('.json'))
    for n, f in enumerate(files, 1):
        code = f[:6]
        px = [r for r in json.load(open(os.path.join(lab, 'cache', f), encoding='utf-8'))['px']
              if r[0] < M.CUTOFF and r[1] > 0 and r[2] > 0 and r[3] > 0 and r[4] > 0]
        if len(px) <= M.WIN:
            continue
        dates = [r[0] for r in px]
        o, h, l, c, v = (np.array([r[k] or 0 for r in px], dtype=float) for k in (1, 2, 3, 4, 5))
        cs = pd.Series(c)
        m20, m60 = cs.rolling(20).mean().values, cs.rolling(60).mean().values
        pos = {d: i for i, d in enumerate(dates)}
        jobs = []
        g = by_code.get(code)
        if g is not None:
            for scanner, gg in g.groupby('scanner'):
                jobs.append((scanner, sorted({pos[d] for d in gg.d if d in pos})))
        cand = np.arange(M.WIN - 1, len(c) - 1)
        jobs.append(('BASE', sorted(cand[rng.random(len(cand)) < M.BASE_RATE].tolist())))
        for key, idx in jobs:
            idx = [i for i in idx if engine_ok(o, h, l, c, v, i)]
            for e in EXITS:
                for i, r, _ in sequential(idx, o, h, l, c, m20, m60, e):
                    p = M.period_of(dates[i])
                    if p:
                        res[(key, e)][p].append(r)
        if n % 300 == 0:
            print(n, 'files', flush=True)
    table = {'%s|%s' % k: {p: M.summarize(v) for p, v in per.items()} for k, per in res.items()}
    for key, cells in table.items():
        scanner, e = key.split('|')
        base = table['BASE|' + e]
        for p in ('train', 'valid', 'test'):
            if cells[p].get('trades') and base[p].get('trades'):
                cells[p]['excess'] = round(cells[p]['avg'] - base[p]['avg'], 2)
        if scanner != 'BASE' and e == 'LIVE':
            cells['verdict'] = '유지' if M.verdict(cells) == '살림' else '교체 검토'
    for scanner in keys:
        if scanner == 'BASE':
            continue
        lv, v2 = table[scanner + '|LIVE'], table[scanner + '|exit-v2']
        better = all((v2[p].get('pf') or 0) > (lv[p].get('pf') or 0) for p in ('valid', 'test'))
        lv['exitV2Better'] = better
    json.dump({'signals': {k: int((sig.scanner == k).sum()) for k in keys if k != 'BASE'}, 'table': table},
              open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for key in sorted(table):
        cells = table[key]
        print(key, ' | '.join('%s n%s avg%s pf%s ex%s' % (p, cells[p].get('trades'), cells[p].get('avg'), cells[p].get('pf'),
                                                         cells[p].get('excess')) for p in ('train', 'valid', 'test')),
              cells.get('verdict', ''), 'v2better' if cells.get('exitV2Better') else '')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
