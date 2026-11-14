# -*- coding: utf-8 -*-
"""52주 신저가 장기 보유 · 224일선+일목 구름대 돌파(추세 전환) 점검 (연구용, 2026-11-14).
진입 t+1 시가, 손절 없이 N거래일 뒤 종가(비용 0.7%) 기준 100개 중 수익 종목 수와 중앙값.
신호: (A) 52주 신저가 당일, (B) 224일선 아래 60봉 이상 머문 뒤 종가가 224일선과 일목 구름 상단을 처음 함께 넘은 날,
(C) B + 거래량 20일 평균 1.5배 이상, (D) B + 224일선 기울기 상승 전환(20봉 전보다 높음).
같은 종목 60거래일 안 반복 신호는 첫 신호만(독립 사건). 기간: 학습~2023 / 검증 2024~2025-06 / 시험 2025-07~.
실행: python reversal_check.py <작업 폴더(cache/)>
"""
import json, os, sys, warnings
import numpy as np, pandas as pd

def main(lab):
    warnings.filterwarnings('ignore')
    rows = []
    for fn in sorted(os.listdir(os.path.join(lab, 'cache'))):
        px = [r for r in json.load(open(os.path.join(lab, 'cache', fn)))['px'] if r[0] < '20261113' and r[1] > 0 and r[4] > 0]
        if len(px) < 400: continue
        d = pd.DataFrame([r[:6] for r in px], columns=['d', 'o', 'h', 'l', 'c', 'v'])
        c, h, l, v = d.c, d.h, d.l, d.v
        amt = (c * v).rolling(20).mean()
        ma224 = c.rolling(224).mean()
        tenkan = (h.rolling(9).max() + l.rolling(9).min()) / 2; kijun = (h.rolling(26).max() + l.rolling(26).min()) / 2
        top = np.maximum(((tenkan + kijun) / 2).shift(26), ((h.rolling(52).max() + l.rolling(52).min()) / 2).shift(26))
        above = (c > ma224) & (c > top)
        below_run = (c < ma224).astype(int).rolling(60).sum() >= 55
        B = above & ~above.shift(1, fill_value=False) & below_run.shift(1, fill_value=False)
        sig = {'A 52주 신저가': c < c.shift(1).rolling(250).min(), 'B 224일선+구름 첫 돌파': B,
               'C B+거래량 1.5배': B & (v >= 1.5 * v.shift(1).rolling(20).mean()), 'D B+224일선 상승 전환': B & (ma224 > ma224.shift(20)),
               '기준 아무 날': pd.Series(True, index=c.index)}
        o = d.o.values; cv = c.values; n = len(cv)
        for name, m in sig.items():
            last = -999
            for i in np.where(m.values)[0]:
                if d.d[i] < '20211001' or i + 121 >= n or amt[i] < 3e9 or cv[i] < 1000: continue
                if name != '기준 아무 날' and i - last < 60: continue
                if name == '기준 아무 날' and i % 20: continue
                last = i; e = o[i + 1]
                per = 'train' if d.d[i] <= '20231231' else ('valid' if d.d[i] <= '20250630' else 'test')
                rows.append((name, per, *(cv[i + k] / e - 1 - 0.007 for k in (20, 60, 120))))
    t = pd.DataFrame(rows, columns=['sig', 'per', 'r20', 'r60', 'r120'])
    f = lambda g: pd.Series({'n': len(g), '20일 100개중': round((g.r20 > 0).mean() * 100), '60일(3개월)': round((g.r60 > 0).mean() * 100),
                             '120일(6개월)': round((g.r120 > 0).mean() * 100), '6개월 중앙값%': round(g.r120.median() * 100, 1)})
    pd.set_option('display.width', 200)
    print(t.groupby(['sig', 'per']).apply(f).to_string())

if __name__ == '__main__':
    main(sys.argv[1])
