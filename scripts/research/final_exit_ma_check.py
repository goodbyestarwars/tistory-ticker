# -*- coding: utf-8 -*-
"""주도주 조용한 눌림 - 익절 기준(이평선 이탈 등) 비교와 연간 매매 횟수 (연구용, 2026-11-14). 평단가 기준 %.
매수: 신호 다음날 시가. 공통 손절: 평단가 -10%(장중 저가가 닿으면 그 가격 또는 갭이면 시가). 최대 60거래일. 비용 0.7%.
익절 기준(종가로 판정 → 다음날 시가 매도):
  추적-15%        매수 후 최고 종가 대비 -15% (장중)
  5일선 이탈       종가 < 5일선
  +10% 뒤 5일선    수익 +10% 이상 찍은 뒤 종가 < 5일선
  +10% 뒤 10일선   수익 +10% 이상 찍은 뒤 종가 < 10일선
  +10% 뒤 20일선   수익 +10% 이상 찍은 뒤 종가 < 20일선
  20일선 이탈      종가 < 20일선
  +20% 절반+추적   +20% 닿으면 절반 매도, 나머지 추적-15%
같은 종목은 매도 전 재매수 없음. 결과: 10번 중 이긴 횟수, 평균%, 이긴 평균%, 진 평균%, 평균 보유일, 연간 매매 수·종목 수.
실행: python final_exit_ma_check.py <작업 폴더(prep.pkl·shape.tsv·cache/)>
"""
import json, os, sys, warnings
import numpy as np, pandas as pd

RULES = ['추적-15%', '5일선 이탈', '+10% 뒤 5일선', '+10% 뒤 10일선', '+10% 뒤 20일선', '20일선 이탈', '+20% 절반+추적']

def run(o, h, l, c, ma, i, rule):
    e = o[i + 1]; peak = e; best = 0.0; half = None
    end = min(len(c) - 1, i + 60)
    for j in range(i + 1, end + 1):
        stop = e * 0.90
        if rule in ('추적-15%', '+20% 절반+추적') or (rule == '+20% 절반+추적' and half):
            stop = max(stop, peak * 0.85)
        if l[j] <= stop:
            px = min(o[j], stop) if j > i + 1 else stop
            r = px / e - 1
            return (0.5 * half + 0.5 * r if half is not None else r) - 0.007, j - i
        if rule == '+20% 절반+추적' and half is None and h[j] >= e * 1.2:
            half = 0.2
        best = max(best, h[j] / e - 1)
        peak = max(peak, c[j])
        sell = False
        if rule == '5일선 이탈': sell = c[j] < ma[5][j]
        elif rule == '+10% 뒤 5일선': sell = best >= .10 and c[j] < ma[5][j]
        elif rule == '+10% 뒤 10일선': sell = best >= .10 and c[j] < ma[10][j]
        elif rule == '+10% 뒤 20일선': sell = best >= .10 and c[j] < ma[20][j]
        elif rule == '20일선 이탈': sell = c[j] < ma[20][j]
        if sell and j + 1 < len(c):
            return o[j + 1] / e - 1 - 0.007, j + 1 - i
    r = c[end] / e - 1
    return (0.5 * half + 0.5 * r if half is not None else r) - 0.007, end - i

def main(lab):
    warnings.filterwarnings('ignore')
    pre = pd.read_pickle(os.path.join(lab, 'prep.pkl'))[['code', 'd', 'p_score', 'p_logamt']]
    sh = pd.read_csv(os.path.join(lab, 'shape.tsv'), sep='\t', dtype={'code': str, 'd': str}, usecols=['code', 'd', 't120'])
    pre = pre.merge(sh, on=['code', 'd'])
    A = pre[(pre.p_logamt > .85) & pre.t120.isin(['pullback', 'rebound']) & (pre.p_score > .7)]
    print('신호 일수(종목-일) 연도별:', A.groupby(A.d.str[:4]).size().to_dict(), ' 신호 종목 수:', A.groupby(A.d.str[:4]).code.nunique().to_dict())
    rows = []
    for code, g in A.groupby('code'):
        raw = [r for r in json.load(open(os.path.join(lab, 'cache', code + '.json')))['px'] if r[0] < '20261113' and r[1] > 0]
        ds = [r[0] for r in raw]; pos = {d: k for k, d in enumerate(ds)}
        a = np.array([r[1:5] for r in raw], float); o, h, l, c = a.T
        ma = {w: pd.Series(c).rolling(w).mean().values for w in (5, 10, 20)}
        for rule in RULES:
            busy = -1
            for d in sorted(g.d):
                k = pos[d]
                if k <= busy or k + 2 >= len(c):
                    continue
                r, held = run(o, h, l, c, ma, k, rule)
                busy = k + held
                rows.append((rule, d[:4], code, r, held))
    t = pd.DataFrame(rows, columns=['rule', 'year', 'code', 'r', 'held'])
    t['per'] = np.select([t.year <= '2023', t.year <= '2025'], ['22~23 하락장', '24~25'], '26')
    f = lambda g: pd.Series({'매매수': len(g), '10번중승': round((g.r > 0).mean() * 10, 1), '평균%': round(g.r.mean() * 100, 1),
                             '이긴평균%': round(g.r[g.r > 0].mean() * 100, 1), '진평균%': round(g.r[g.r <= 0].mean() * 100, 1), '보유일': round(g.held.mean(), 1)})
    pd.set_option('display.width', 250)
    print(t.groupby(['rule', 'per']).apply(f).to_string())
    y = t[t.rule == '추적-15%'].groupby('year').agg(매매수=('r', 'size'), 종목수=('code', 'nunique'))
    print('연도별 매매 수(추적-15% 기준, 같은 종목 보유 중 재매수 없음):'); print(y.to_string())

if __name__ == '__main__':
    main(sys.argv[1])
