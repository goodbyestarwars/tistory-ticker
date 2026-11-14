# -*- coding: utf-8 -*-
"""최종 권고안 점검(연구용, 2026-11-14): 평단가 기준 % 로 결과를 낸다.
전략 A 주도주 조용한 눌림: 거래대금 상위15% · shapeOf 120봉 눌림/반등 · 두 숫자 상위30%.
전략 B 52주 신저가 다음날: 종가가 직전 250봉 최저 종가 아래, 거래대금 30억+.
매도: 평단가 -10% 손절, 매수 후 최고 종가 대비 -15% 내려오면 매도, 최대 60거래일(B는 20거래일).
시장 쉬기: 신호일 KOSPI 종가 < KOSPI 60일선이면 신규 매수 안 함.
같은 종목은 매도 전 재매수 안 함. 비용 0.7% 포함. 결과: 10번 매매 중 이긴 횟수, 평균 수익%, 이긴 매매 평균%, 진 매매 평균%.
실행: python final_plan_check.py <작업 폴더(prep.pkl·shape.tsv·cache/)>
"""
import json, os, re, sys, urllib.request, warnings
import numpy as np, pandas as pd

def kospi():
    u = 'https://fchart.stock.naver.com/siseJson.naver?symbol=KOSPI&requestType=1&startTime=20200101&endTime=20261113&timeframe=day'
    t = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read().decode()
    rows = re.findall(r'\["(\d{8})",\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+)', t)
    s = pd.Series([float(c) for _, c in rows], index=[d for d, _ in rows])
    return (s > s.rolling(60).mean())

def trade(px, i, maxh):
    o = px[:, 0]; l = px[:, 2]; c = px[:, 3]
    e = o[i + 1]; peak = e
    for j in range(i + 1, min(len(c), i + 1 + maxh)):
        stop = max(e * 0.90, peak * 0.85)
        if l[j] <= stop:
            return min(o[j], stop) / e - 1 - 0.007, j
        peak = max(peak, c[j])
    j = min(len(c), i + 1 + maxh) - 1
    return c[j] / e - 1 - 0.007, j

def main(lab):
    warnings.filterwarnings('ignore')
    up = kospi()
    pre = pd.read_pickle(os.path.join(lab, 'prep.pkl'))[['code', 'd', 'period', 'p_score', 'p_logamt']]
    sh = pd.read_csv(os.path.join(lab, 'shape.tsv'), sep='\t', dtype={'code': str, 'd': str}, usecols=['code', 'd', 't120'])
    pre = pre.merge(sh, on=['code', 'd'])
    A = pre[(pre.p_logamt > .85) & pre.t120.isin(['pullback', 'rebound']) & (pre.p_score > .7)][['code', 'd', 'period']]
    rows = []
    codes = set(A.code) | set(pre.code)
    for code in sorted(codes):
        raw = [r for r in json.load(open(os.path.join(lab, 'cache', code + '.json')))['px'] if r[0] < '20261113' and r[1] > 0]
        ds = [r[0] for r in raw]; px = np.array([r[1:5] for r in raw], float); pos = {d: k for k, d in enumerate(ds)}
        c = px[:, 3]
        sigs = [('A', d) for d in A[A.code == code].d]
        low = pd.Series(c).shift(1).rolling(250).min().values
        amt = pd.Series(c * np.array([r[5] for r in raw])).rolling(20).mean().values
        sigs += [('B', ds[k]) for k in range(len(c)) if ds[k] >= '20211001' and c[k] < low[k] and amt[k] >= 3e9 and c[k] >= 1000]
        for strat in ('A', 'B'):
            for filt in (False, True):
                busy = -1
                for s, d in sorted(x for x in sigs if x[0] == strat):
                    k = pos[d]
                    if k <= busy or k + 2 >= len(c) or (filt and not up.get(d, False)):
                        continue
                    r, j = trade(px, k, 60 if strat == 'A' else 20)
                    busy = j
                    per = 'train' if d <= '20231231' else ('valid' if d <= '20250630' else 'test')
                    rows.append((strat, filt, per, r))
    t = pd.DataFrame(rows, columns=['strat', 'filt', 'per', 'r'])
    out = t.groupby(['strat', 'filt', 'per']).r.agg(n='size', win10=lambda x: (x > 0).mean() * 10, avg=lambda x: x.mean() * 100,
                                                       win_avg=lambda x: x[x > 0].mean() * 100, loss_avg=lambda x: x[x <= 0].mean() * 100)
    print(out.round(1).to_string())

if __name__ == '__main__':
    main(sys.argv[1])
