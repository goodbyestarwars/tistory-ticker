# -*- coding: utf-8 -*-
"""연구용(2026-11-13): 사용자 사례(현대차·LG전자·코스맥스·LS ELECTRIC·한국항공우주·에이피알)의 공통 상태(대형 주도·상승 뒤 눌림·모멘텀·조용함)를
같은 날 같은 상태였던 전 종목에 적용해 "100개 중 몇 개" 오르는지 대조한다. 입력: edge_factor_study prep 피클(prep.pkl), shape_edge_batch TSV, 캐시.
실행: python shape_case_control.py <작업 폴더(prep.pkl·shape.tsv·cache/)>"""
warnings.filterwarnings('ignore')
import numpy as np, pandas as pd
L = sys.argv[1]
df = pd.read_pickle(L + '/prep.pkl')[['code', 'd', 'date', 'period', 'p_score', 'p_logamt', 'p_mom12_1', 'p_d52h', 'p_f60']]
sh = pd.read_csv(L + '/shape.tsv', sep='\t', dtype={'code': str, 'd': str}, usecols=['code', 'd', 't40', 't80', 't120'])
df = df.merge(sh, on=['code', 'd'])
out = []
for code, g in df.groupby('code'):
    px = json.load(open(f'{L}/cache/{code}.json'))['px']
    pos = {r[0]: i for i, r in enumerate(px)}
    a = np.array([r[1:5] for r in px], float)
    o, h, l, c = a.T
    for d in g.d:
        i = pos[d]
        if i + 61 >= len(c) or o[i + 1] <= 0: continue
        e = o[i + 1]
        hh = h[i + 1:i + 61] / e - 1; ll = l[i + 1:i + 61] / e - 1
        up = np.argmax(hh >= .1) if (hh >= .1).any() else 99; dn = np.argmax(ll <= -.1) if (ll <= -.1).any() else 99
        out.append((code, d, hh.max() >= .3, hh[:20].max() >= .1, c[i + 20] / e - 1 - .007 > 0, c[i + 60] / e - 1 - .007 > 0,
                    np.nan if up == dn == 99 else float(up < dn)))
pt = pd.DataFrame(out, columns=['code', 'd', 'big30_60', 'hit10_20', 'up20', 'up60', 'first_up'])
df = df.merge(pt, on=['code', 'd'])
PB = ['pullback', 'rebound']
lead = df.p_logamt > .85
pb120 = df.t120.isin(PB)
pball = df.t40.isin(PB) & df.t80.isin(PB) & pb120
conds = {
    '전체': df.index == df.index,
    '대형 주도(거래대금 상위15%)': lead,
    '120봉 상승 뒤 눌림/반등': pb120,
    '40·80·120봉 모두 눌림/반등': pball,
    '주도 + 120봉 눌림': lead & pb120,
    '주도 + 3규모 모두 눌림': lead & pball,
    '주도 + 120봉 눌림 + 1년 모멘텀 상위30%': lead & pb120 & (df.p_mom12_1 > .7),
    '주도 + 120봉 눌림 + 52주 고가 근접 상위30%': lead & pb120 & (df.p_d52h > .7),
    '주도 + 120봉 눌림 + 조용함(두 숫자 상위30%)': lead & pb120 & (df.p_score > .7),
    '주도 + 120봉 눌림 + 모멘텀 + 조용함': lead & pb120 & (df.p_mom12_1 > .7) & (df.p_score > .7),
}
rows = []
for name, m in conds.items():
    for per in ('train', 'valid', 'test'):
        g = df[m & (df.period == per)]
        rows.append({'조건': name, '기간': per, 'n': len(g), '60일내+30%': round(g.big30_60.mean() * 100, 1),
                     '20일내+10%': round(g.hit10_20.mean() * 100, 1), '20일뒤 수익': round(g.up20.mean() * 100, 1),
                     '60일뒤 수익': round(g.up60.mean() * 100, 1), '+10%먼저': round(g.first_up.mean() * 100, 1)})
pd.set_option('display.width', 250); pd.set_option('display.max_columns', 20); pd.set_option('display.max_rows', 100)
r = pd.DataFrame(rows).set_index(['조건', '기간'])
print(r)
r.reset_index().to_json(L + '/case_ctrl.json', orient='records', force_ascii=False)
