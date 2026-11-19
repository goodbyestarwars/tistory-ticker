# -*- coding: utf-8 -*-
"""검색기 메뉴 성적표 1단계 평가 (연구 전용, 실전·주문 연결 없음 - 2026-11-20).

입력: menu_replay_batch.js 신호 TSV(들), 5년 일봉 캐시, KOSPI 일봉(참고 관문용).
매매: 신호일 t 종가까지 보고 t+1 시가 매수, 비용 0.7%. 같은 (메뉴, 종류, 매도 규칙, 종목)은 보유 중 재진입하지 않는다.
매도: E20(20거래일째 종가, 판정용) · exit-v1(S10/MA20/60) · exit-v2(S10/MA60/250)(참고). 계산은 exit_rule_study.simulate를 재사용한다.
기준선: 전체 종목-일 고정 시드 5% 표본을 같은 규칙으로 산 결과.
판정 기준은 docs/SCANNER_MENU_SCORECARD_2026-11-20.md(결과 보기 전 고정).
실행: python menu_scorecard_study.py <작업 폴더> <out.json> <신호.tsv> [신호.tsv ...]
"""
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exit_rule_study as R  # noqa: E402

COST = 0.007
WIN = 224
PERIODS = (('train', '20210101', '20231231'), ('valid', '20240101', '20250630'), ('test', '20250701', '20260831'))
EXITS = {'E20': None, 'exit-v1': ('S10', 'MA20', 60, 'NO'), 'exit-v2': ('S10', 'MA60', 250, 'NO')}
BASE_RATE = 0.05
SEED = 20261120
CUTOFF = '20261113'


def period_of(d):
    for name, a, b in PERIODS:
        if a <= d <= b:
            return name
    return None


def e20(o, c, i):
    """20거래일째 종가. 자료가 모자라면 None(미완료 신호는 제외하고 수를 센다)."""
    if i + 20 >= len(c):
        return None
    return c[i + 20] / o[i + 1] - 1 - COST, 20


def run_exit(o, h, l, c, m20, m60, i, name):
    if name == 'E20':
        return e20(o, c, i)
    ret, hd, cens = R.simulate(o, h, l, c, np.zeros(len(c)), m20, m60, i, EXITS[name])
    return (None if cens else (ret, hd))


def sequential(idx_list, o, h, l, c, m20, m60, name):
    """한 종목의 신호 위치(오름차순)를 보유 중 재진입 없이 처리. [(i, ret, hold)], 미완료 수."""
    out, until, skipped = [], -1, 0
    for i in idx_list:
        if i <= until or i + 1 >= len(c):
            continue
        r = run_exit(o, h, l, c, m20, m60, i, name)
        if r is None:
            skipped += 1
            until = len(c)
            continue
        out.append((i, r[0], r[1]))
        until = i + r[1]
    return out, skipped


def summarize(rets):
    tr = np.asarray(rets, dtype=float)
    if not len(tr):
        return {'trades': 0}
    w, ls = tr[tr > 0], tr[tr <= 0]
    return {'trades': int(len(tr)), 'win': round(float((tr > 0).mean()) * 100, 1), 'avg': round(float(tr.mean()) * 100, 2),
            'pf': round(float(w.sum() / -ls.sum()), 2) if len(ls) and ls.sum() < 0 else None}


def kospi_up(path):
    rows = json.load(open(path, encoding='utf-8')).get('rows') or []
    idx = pd.Series({str(r['date']).replace('-', '')[:8]: float(r['close']) for r in rows if r.get('close')}).sort_index()
    m60 = idx.rolling(60).mean()
    return {d: bool(v) for d, v in ((idx > m60) & m60.notna()).items()}


def verdict(cells):
    ex = {p: cells.get(p, {}).get('excess') for p in ('train', 'valid', 'test')}
    good = lambda p: (ex[p] is not None and ex[p] >= 1.0 and (cells[p].get('pf') or 0) >= 1.2 and cells[p].get('trades', 0) >= 100)
    if good('valid') and good('test') and ex['train'] is not None and ex['train'] > 0:
        return '살림'
    pos = sum(1 for p in ex if ex[p] is not None and ex[p] > 0)
    return '고침' if pos >= 2 else '숨김 후보'


def main(lab, out_path, sig_paths):
    sig = pd.concat([pd.read_csv(p, sep='\t', dtype={'code': str, 'd': str}) for p in sig_paths], ignore_index=True)
    sig = sig[sig.d < CUTOFF]
    up = kospi_up(os.path.join(lab, 'kospi_naver.json'))
    rng = np.random.default_rng(SEED)
    keys = sorted(set(zip(sig.group, sig.kind)))
    res = {(g, k, e, gate): {p: [] for p, _, _ in PERIODS} for g, k in keys + [('BASE', 'all')] for e in EXITS for gate in ('ALL', 'K60')}
    skipped = {}
    by_code = {code: g for code, g in sig.groupby('code')}
    files = sorted(f for f in os.listdir(os.path.join(lab, 'cache')) if f.endswith('.json'))
    for n, f in enumerate(files, 1):
        code = f[:6]
        px = [r for r in json.load(open(os.path.join(lab, 'cache', f), encoding='utf-8'))['px']
              if r[0] < CUTOFF and r[1] > 0 and r[2] > 0 and r[3] > 0 and r[4] > 0]
        if len(px) <= WIN:
            continue
        dates = [r[0] for r in px]
        o, h, l, c = (np.array([r[k] for r in px], dtype=float) for k in (1, 2, 3, 4))
        cs = pd.Series(c)
        m20, m60 = cs.rolling(20).mean().values, cs.rolling(60).mean().values
        pos = {d: i for i, d in enumerate(dates)}
        jobs = []
        g = by_code.get(code)
        if g is not None:
            for (grp, kind), gg in g.groupby(['group', 'kind']):
                jobs.append(((grp, kind), sorted({pos[d] for d in gg.d if d in pos})))
        cand = np.arange(WIN - 1, len(c) - 1)
        jobs.append((('BASE', 'all'), sorted(cand[rng.random(len(cand)) < BASE_RATE].tolist())))
        for (grp, kind), idx in jobs:
            for e in EXITS:
                for gate in ('ALL', 'K60'):
                    use = idx if gate == 'ALL' else [i for i in idx if up.get(dates[i])]
                    trades, sk = sequential(use, o, h, l, c, m20, m60, e)
                    skipped[(grp, kind, e, gate)] = skipped.get((grp, kind, e, gate), 0) + sk
                    for i, r, _ in trades:
                        p = period_of(dates[i])
                        if p:
                            res[(grp, kind, e, gate)][p].append(r)
        if n % 300 == 0:
            print(n, 'files', flush=True)
    table = {}
    for (grp, kind, e, gate), per in res.items():
        table['|'.join((grp, kind, e, gate))] = {p: summarize(v) for p, v in per.items()}
    for key, cells in table.items():
        grp, kind, e, gate = key.split('|')
        base = table['|'.join(('BASE', 'all', e, gate))]
        for p in cells:
            if cells[p].get('trades') and base[p].get('trades'):
                cells[p]['excess'] = round(cells[p]['avg'] - base[p]['avg'], 2)
        if grp != 'BASE' and e == 'E20' and gate == 'ALL':
            cells['verdict'] = verdict(cells)
    out = {'signals': {'|'.join(k): int(((sig.group == k[0]) & (sig.kind == k[1])).sum()) for k in keys},
           'skippedIncomplete': {'|'.join(k): v for k, v in skipped.items() if v}, 'table': table}
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for key in sorted(table):
        grp, kind, e, gate = key.split('|')
        if e != 'E20' and not (grp != 'BASE' and kind == 'primary'):
            continue
        cells = table[key]
        line = ' | '.join('%s n%s avg%s pf%s ex%s' % (p, cells[p].get('trades'), cells[p].get('avg'), cells[p].get('pf'), cells[p].get('excess'))
                          for p in ('train', 'valid', 'test'))
        print(key, line, cells.get('verdict', ''))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
