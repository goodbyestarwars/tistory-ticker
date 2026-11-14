# -*- coding: utf-8 -*-
"""시간차 매집 연구: "거래량(매집)이 먼저, 주가는 나중" (연구용, 실전 연결 없음 - 2026-11-13).

가설(사용자): 세력은 오늘 거래량을 올리며 오늘 주가를 올리지 않는다. 미리 매집하고 때가 되면 올린다.
선행 연구(ACCUMULATION_BAR_CONTEXT_2026-10-17)는 '봉 하나'의 대량 양봉만 봤다. 여기서는 몇 주~몇 달의 시간차를 본다.

t일 종가까지의 정의:
  vol_up    최근 60봉 거래량 중앙값 / 그 이전 190봉(t-249~t-60) 중앙값      (거래량 체제 상승 = 누군가 거래 중)
  box60     최근 60봉 (최고 종가 - 최저 종가) / 종가                       (주가는 박스에 갇힘)
  drift60   |종가 / 60봉 전 종가 - 1|                                     (주가는 제자리)
  dry10     최근 10봉 거래량 중앙값 / 최근 60봉 중앙값                     (매집 뒤 거래 마름 = 물량 소진)
  sm60      외국인+기관 60일 순매수 / 60일 거래량                           (수급 매집)
  dnv60     60봉 중 하락일 거래량 / 상승일 거래량 (낮으면 내릴 때 거래가 없음 = 물량 안 나옴)
조건(날짜별 백분위): 매집 상태 A = vol_up 상위 20% & box60 하위 40% & drift60 < 10%.
  B = A + dry10 하위 30%, C = A + sm60 상위 30%, D = A + dnv60 하위 30%, E = B + C.
결과: 진입 t+1 시가, 100개 중 20/60/120거래일 뒤 수익(비용 0.7%), 60거래일 안 +30% 도달, +10%·-10% 선도달.
기간: 학습 2021-10~2023 / 검증 2024~2025-06 / 시험 2025-07~.
실행: python accumulation_lead_study.py <작업 폴더(cache/)> <out.json>
"""
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

COST = 0.007


def frame(code, data):
    px = [r for r in data['px'] if r[0] < '20261113' and r[1] > 0 and r[4] > 0]
    fl = data.get('flow')
    if len(px) < 400 or not fl:
        return None
    df = pd.DataFrame([r[:6] for r in px], columns=['d', 'o', 'h', 'l', 'c', 'v'])
    df['sm'] = [sum(x for x in (fl.get(d) or [None, None])[:2] if x is not None) if fl.get(d) else np.nan for d in df.d]
    c, v = df.c, df.v
    f = pd.DataFrame({'d': df.d, 'code': code, 'close': c})
    f['amt20'] = (c * v).rolling(20).mean()
    med60 = v.rolling(60).median()
    f['vol_up'] = med60 / v.shift(60).rolling(190).median()
    f['box60'] = (c.rolling(60).max() - c.rolling(60).min()) / c
    f['drift60'] = (c / c.shift(60) - 1).abs()
    f['dry10'] = v.rolling(10).median() / med60
    f['sm60'] = df.sm.rolling(60).sum() / v.rolling(60).sum()
    up = c > c.shift(1)
    dn = c < c.shift(1)
    f['dnv60'] = v.where(dn, 0).rolling(60).sum() / v.where(up, 0).rolling(60).sum().replace(0, np.nan)
    o, h, l, cv = df.o.values, df.h.values, df.l.values, c.values
    n = len(cv)
    res = np.full((n, 6), np.nan)
    for i in range(n - 121):
        e = o[i + 1]
        if e <= 0:
            continue
        hh, ll = h[i + 1:i + 61] / e - 1, l[i + 1:i + 61] / e - 1
        u = np.argmax(hh >= .1) if (hh >= .1).any() else 99
        dw = np.argmax(ll <= -.1) if (ll <= -.1).any() else 99
        res[i] = [cv[i + 20] / e - 1 - COST > 0, cv[i + 60] / e - 1 - COST > 0, cv[i + 120] / e - 1 - COST > 0,
                  hh.max() >= .3, np.nan if u == dw == 99 else float(u < dw), cv[i + 60] / e - 1 - COST]
    for k, name in enumerate(['up20', 'up60', 'up120', 'hit30', 'first_up', 'ret60']):
        f[name] = res[:, k]
    return f


def summarize(g):
    return {'n': int(len(g)), 'up20': round(float(g.up20.mean()) * 100, 1), 'up60': round(float(g.up60.mean()) * 100, 1),
            'up120': round(float(g.up120.mean()) * 100, 1), 'hit30_60': round(float(g.hit30.mean()) * 100, 1),
            'first_up': round(float(g.first_up.mean()) * 100, 1), 'ret60_med': round(float(g.ret60.median()) * 100, 1)}


def main(lab, out_path):
    warnings.filterwarnings('ignore')
    frames = []
    for fn in sorted(os.listdir(os.path.join(lab, 'cache'))):
        if fn.endswith('.json'):
            fr = frame(fn[:-5], json.load(open(os.path.join(lab, 'cache', fn))))
            if fr is not None:
                frames.append(fr)
    df = pd.concat(frames, ignore_index=True)
    df = df[(df.d >= '20211001') & (df.amt20 >= 3e9) & (df.close >= 1000) & df.up120.notna() & df.vol_up.notna() & df.sm60.notna()]
    df['period'] = np.select([df.d <= '20231231', df.d <= '20250630'], ['train', 'valid'], 'test')
    for k in ('vol_up', 'box60', 'dry10', 'sm60', 'dnv60'):
        df['p_' + k] = df.groupby('d')[k].rank(pct=True)
    A = (df.p_vol_up >= .8) & (df.p_box60 <= .4) & (df.drift60 < .10)
    B = A & (df.p_dry10 <= .3)
    C = A & (df.p_sm60 >= .7)
    D = A & (df.p_dnv60 <= .3)
    conds = {'아무 종목': df.index == df.index,
             '거래량 체제만 상승(vol_up 상위20%)': df.p_vol_up >= .8,
             'A 매집 상태(거래량↑·주가 박스)': A,
             'B = A + 최근 거래 마름': B,
             'C = A + 외국인·기관 순매수': C,
             'D = A + 하락일 거래 적음': D,
             'E = A + 거래 마름 + 순매수': B & (df.p_sm60 >= .7),
             'F = A + 마름 + 순매수 + 하락일 거래 적음': B & (df.p_sm60 >= .7) & (df.p_dnv60 <= .3)}
    res = {name: {per: summarize(df[m & (df.period == per)]) for per in ('train', 'valid', 'test')} for name, m in conds.items()}
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    rows = [dict(조건=k, 기간=p, **v) for k, d in res.items() for p, v in d.items()]
    pd.set_option('display.width', 250); pd.set_option('display.max_rows', 60)
    print(pd.DataFrame(rows).set_index(['조건', '기간']))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
