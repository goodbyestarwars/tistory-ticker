# -*- coding: utf-8 -*-
"""edge_factor_study 의 상위 단일 특성(고유 변동성 ivol60·상승일 거래량 비중 upvol20) 강건성 점검 (연구용, 2026-11-13).

1) 규모(거래대금 3분위) 안에서도 효과가 남는가 — 대형주 효과의 대리인지 확인
2) 연도별 IC — 특정 해에만 나온 결과인지
3) 두 숫자 점수 score = (1 - p_ivol60) + (1 - p_upvol20) 날짜별 10분위 → 기간별 초과수익·비용 차감 승률·급락률
4) 시장 국면(유니버스 20일 평균 수익 > 0 / <= 0)별 상위 10분위 성과
5) 실제 매매 가정: 상위 10분위 동일가중, 20거래일마다 교체(겹침 없음), 왕복 비용 0.7% 차감 → 기간별 누적·연환산·MDD vs 유니버스 동일가중
실행: python edge_factor_robust.py <작업 폴더> <out.json>
"""
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import edge_factor_study as S  # noqa: E402


def ic_by(df, feat, h, by):
    out = {}
    for key, g in df[df['ex%d' % h].notna()].groupby(by):
        ic = g.groupby('date').apply(lambda x: x['p_' + feat].corr(x['ex%d' % h].rank(pct=True)), include_groups=False)
        t, n = S.tstat(ic, h)
        out[str(key)] = {'ic': round(float(ic.mean()), 4), 't': round(float(t), 2), 'dates': n}
    return out


def backtest(df, mask_col, h=20):
    """h일마다 리밸런스(t+1 시가 진입~t+h 종가), 같은 날짜 상위군 동일가중. 비용 왕복 0.7%."""
    dates = np.sort(df.date.unique())[::h]
    rows = []
    for d in dates:
        g = df[(df.date == d) & df['fwd%d' % h].notna()]
        if len(g) < 50:
            continue
        sel = g[g[mask_col]]
        rows.append({'date': d, 'port': sel['fwd%d' % h].mean() - S.COST if len(sel) else np.nan,
                     'uni': g['fwd%d' % h].mean() - S.COST, 'n': len(sel)})
    bt = pd.DataFrame(rows).dropna()
    res = {}
    for per, g in bt.groupby(np.select([bt.date <= pd.Timestamp(S.TRAIN[1]), bt.date <= pd.Timestamp(S.VALID[1])], ['train', 'valid'], 'test')):
        r = {}
        for col in ('port', 'uni'):
            eq = (1 + g[col]).cumprod()
            yrs = len(g) * h / 250
            r[col] = {'cum': round(float(eq.iloc[-1] - 1) * 100, 1), 'cagr': round(float(eq.iloc[-1] ** (1 / yrs) - 1) * 100, 1),
                      'mdd': round(float((eq / eq.cummax() - 1).min()) * 100, 1), 'hit': round(float((g[col] > 0).mean()) * 100, 1)}
        r['beat'] = round(float((g.port > g.uni).mean()) * 100, 1)
        r['periods'] = int(len(g))
        r['avg_n'] = round(float(g.n.mean()), 1)
        res[per] = r
    return res


def main(lab, out_path):
    warnings.filterwarnings('ignore')
    np.seterr(all='ignore')
    df = S.prep(S.load(lab))
    df['year'] = df.date.dt.year
    df['size3'] = df.groupby('date').logamt.transform(lambda s: pd.qcut(s.rank(method='first'), 3, labels=False))
    mkt20 = df.groupby('date').rev20.transform('mean')
    df['regime'] = np.where(mkt20 > 0, 'up', 'down')
    df['score'] = (1 - df.p_ivol60) + (1 - df.p_upvol20)
    df['sp'] = df.groupby('date').score.rank(pct=True)
    df['dec'] = np.minimum((df.sp * 10).astype(int), 9)
    df['top'] = df.sp > 0.9
    df['bot'] = df.sp <= 0.1
    res = {}
    for f in ('ivol60', 'upvol20'):
        res[f] = {'by_size': ic_by(df, f, 20, 'size3'), 'by_year': ic_by(df, f, 20, 'year')}
    res['score_by_year'] = ic_by(df.assign(p_score=df.sp), 'score', 20, 'year')
    dec = {}
    for per in ('train', 'valid', 'test'):
        g = df[(df.period == per) & df.ex20.notna()]
        dec[per] = [S.cell_stats(g[g.dec == i], 20) for i in range(10)]
        td = g[g.top].groupby('date').ex20.mean() - g[g.bot].groupby('date').ex20.mean()
        dec[per + '_spread_t'] = round(float(S.tstat(td, 20)[0]), 2)
    res['score_deciles'] = dec
    res['score_regime'] = {f'{per}_{rg}': S.cell_stats(df[(df.period == per) & (df.regime == rg) & df.top & df.ex20.notna()], 20)
                           for per in ('train', 'valid', 'test') for rg in ('up', 'down')}
    res['score_regime_base'] = {f'{per}_{rg}': S.cell_stats(df[(df.period == per) & (df.regime == rg) & df.ex20.notna()], 20)
                                for per in ('train', 'valid', 'test') for rg in ('up', 'down')}
    res['backtest_top10'] = backtest(df, 'top')
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=float)
    print('done', flush=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
