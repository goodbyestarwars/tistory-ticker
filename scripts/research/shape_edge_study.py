# -*- coding: utf-8 -*-
"""사람이 보는 일봉 모양(auto-wave.shapeOf) × 두 숫자 필터의 "100개 중 몇 개 오르나" 연구 (연구용, 2026-11-13).

입력: edge_factor_study 캐시 + shape_edge_batch.js 결과 TSV(종목·날짜별 40/80/120봉 모양).
진입 t+1 시가, 비용 0.7% 차감. 집계(학습/검증/시험 기간별):
  up20/up60     20·60거래일 뒤 종가 기준 수익 종목 비율(%)
  hit10_20      20거래일 안에 고가가 +10%에 닿은 비율(%)
  first_up      +10%와 -10% 중 +10%를 먼저 찍은 비율(%, 120거래일 안, 같은 날 둘 다면 -10% 우선)
  ex20          같은 날 유니버스 대비 20일 초과수익(%p, 이상치 완화 위해 날짜별 ±100% 절단)
두 숫자 점수 = (1 - ivol60 백분위) + (1 - upvol20 백분위), 날짜별 백분위 상위 30%를 '조용함'으로 본다.
실행: python shape_edge_study.py <작업 폴더> <shape.tsv> <out.json>
"""
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import edge_factor_study as S  # noqa: E402

MAXD = 120


def paths_table(lab, keys):
    """(code, d) -> 경로 지표. 진입 t+1 시가."""
    out = []
    by_code = keys.groupby('code').d.apply(set).to_dict()
    for code, dset in by_code.items():
        px = json.load(open(os.path.join(lab, 'cache', code + '.json')))['px']
        ds = [r[0] for r in px]
        a = np.array([r[1:5] for r in px], float)
        o, h, l, c = a[:, 0], a[:, 1], a[:, 2], a[:, 3]
        for i, d in enumerate(ds):
            if d not in dset or i + 61 >= len(c) or o[i + 1] <= 0:
                continue
            e = o[i + 1]
            end = min(len(c), i + 1 + MAXD)
            hh, ll = h[i + 1:end] / e - 1, l[i + 1:end] / e - 1
            up = int(np.argmax(hh >= 0.10)) if (hh >= 0.10).any() else 10 ** 6
            dn = int(np.argmax(ll <= -0.10)) if (ll <= -0.10).any() else 10 ** 6
            out.append((code, d, c[i + 20] / e - 1, c[i + 60] / e - 1, up < 20,
                        1 if up < dn and up < 10 ** 6 else (0 if dn <= up and dn < 10 ** 6 else np.nan)))
    return pd.DataFrame(out, columns=['code', 'd', 'r20', 'r60', 'hit10_20', 'first_up'])


def stats(g):
    if len(g) < 200:
        return None
    return {'n': int(len(g)), 'up20': round(float((g.r20 - S.COST > 0).mean()) * 100, 1),
            'up60': round(float((g.r60 - S.COST > 0).mean()) * 100, 1),
            'hit10_20': round(float(g.hit10_20.mean()) * 100, 1),
            'first_up': round(float(g.first_up.mean()) * 100, 1),
            'ex20': round(float(g.ex20c.mean()) * 100, 2)}


def main(lab, shape_tsv, out_path):
    warnings.filterwarnings('ignore')
    np.seterr(all='ignore')
    df = S.prep(S.load(lab))
    df['score'] = (1 - df.p_ivol60) + (1 - df.p_upvol20)
    df['quiet'] = df.groupby('date').score.rank(pct=True) > 0.7
    df['ex20c'] = df.ex20.clip(-1, 1)
    df = df[['code', 'd', 'date', 'period', 'quiet', 'ex20c']]
    sh = pd.read_csv(shape_tsv, sep='\t', dtype={'code': str, 'd': str})
    df = df.merge(sh, on=['code', 'd'], how='inner')
    pt = paths_table(lab, df[['code', 'd']])
    df = df.merge(pt, on=['code', 'd'], how='inner')
    res = {'rows': int(len(df))}
    for per in ('train', 'valid', 'test', 'all'):
        g0 = df if per == 'all' else df[df.period == per]
        r = {'base': stats(g0), 'base_quiet': stats(g0[g0.quiet])}
        for w in (40, 80, 120):
            for t, gt in g0.groupby('t%d' % w):
                r['%s_%d' % (t, w)] = stats(gt)
                r['%s_%d_quiet' % (t, w)] = stats(gt[gt.quiet])
            clear = g0[(g0['t%d' % w] == 'up') & (g0['c%d' % w] >= 0.75)]
            r['up_clear_%d' % w] = stats(clear)
            r['up_clear_%d_quiet' % w] = stats(clear[clear.quiet])
        # 여러 시간 규모가 모두 상승(멀리서 봐도·가까이서 봐도 오름)
        multi = g0[(g0.t40 == 'up') & (g0.t120 == 'up')]
        r['up_40_and_120'] = stats(multi)
        r['up_40_and_120_quiet'] = stats(multi[multi.quiet])
        # 큰 흐름 상승 + 최근 눌림·반등
        pb = g0[(g0.t120 == 'up') & g0.t40.isin(['pullback', 'rebound'])]
        r['up120_pullback40'] = stats(pb)
        r['up120_pullback40_quiet'] = stats(pb[pb.quiet])
        res[per] = {k: v for k, v in r.items() if v}
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done', res['rows'], flush=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
