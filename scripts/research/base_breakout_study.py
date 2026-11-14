# -*- coding: utf-8 -*-
"""장기 바닥 응축 → 박스 돌파 연구 (연구용, 실전 연결 없음 - 2026-11-13).

사용자 차트(현대차·LG전자·코스맥스)에서 읽은 사람 눈의 모양:
  ① 오랜 기간 거의 수평인 바닥(224일선이 평평하고 종가가 그 주변에 머묾)
  ② 5·20·60·112·224일선 밀집(이평선 수렴)
  ③ 1년 거래량이 현재 가격대(매물대)에 몰림
  ④ 박스 상단(이전 120거래일 최고 종가) 위로 종가 돌파
정의(모두 t일 종가까지, 진입 t+1 시가, 비용 0.7%):
  base_frac  최근 250봉 중 |종가/224일선 - 1| < 15% 비율          (① 바닥 기간)
  flat224    |224일선 / 60봉 전 224일선 - 1|                      (① 수평)
  ma_disp    (5·20·60·112·224일선 최대 - 최소) / 종가               (② 수렴)
  vp_share   250봉 거래량 중 종가가 현재가 ±10% 안에서 거래된 비율  (③ 매물대)
  brk        종가 > 직전 120봉 최고 종가 (그 전날은 아님)            (④ 돌파 첫날)
비교: 같은 기간 '아무 종목', '그냥 120일 신고가 돌파', '바닥 응축 돌파'(①②④, ①②③④)의 100개 중 결과.
실행: python base_breakout_study.py <작업 폴더(cache/)> <out.json>
"""
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

TRAIN_END, VALID_END = '20231231', '20250630'
COST = 0.007


def frame(code, px):
    df = pd.DataFrame([r[:6] for r in px if r[0] < '20261113' and r[1] > 0 and r[4] > 0], columns=['d', 'o', 'h', 'l', 'c', 'v'])
    if len(df) < 320:
        return None
    c, v = df.c, df.v
    ma = {w: c.rolling(w).mean() for w in (5, 20, 60, 112, 224)}
    mas = pd.concat(ma.values(), axis=1)
    f = pd.DataFrame({'d': df.d, 'code': code})
    f['amt20'] = (c * v).rolling(20).mean()
    f['close'] = c
    f['base_frac'] = ((c / ma[224] - 1).abs() < 0.15).astype(float).rolling(250).mean()
    f['flat224'] = (ma[224] / ma[224].shift(60) - 1).abs()
    f['ma_disp'] = (mas.max(axis=1) - mas.min(axis=1)) / c
    cv, vv = c.values, v.values
    vp = np.full(len(c), np.nan)
    for i in range(250, len(c)):
        win_c, win_v = cv[i - 249:i + 1], vv[i - 249:i + 1]
        tot = win_v.sum()
        if tot > 0:
            vp[i] = win_v[(win_c >= cv[i] * 0.9) & (win_c <= cv[i] * 1.1)].sum() / tot
    f['vp_share'] = vp
    prior_hi = c.shift(1).rolling(120).max()
    f['brk'] = (c > prior_hi) & (c.shift(1) <= prior_hi.shift(1))
    o, h, l = df.o.values, df.h.values, df.l.values
    n = len(c)
    hit30, up60, up20, first_up = [np.nan] * n, [np.nan] * n, [np.nan] * n, [np.nan] * n
    for i in range(n - 61):
        e = o[i + 1]
        if e <= 0:
            continue
        hh, ll = h[i + 1:i + 61] / e - 1, l[i + 1:i + 61] / e - 1
        hit30[i] = float(hh.max() >= 0.3)
        up20[i] = float(cv[i + 20] / e - 1 - COST > 0)
        up60[i] = float(cv[i + 60] / e - 1 - COST > 0)
        u = np.argmax(hh >= .1) if (hh >= .1).any() else 99
        dn = np.argmax(ll <= -.1) if (ll <= -.1).any() else 99
        first_up[i] = np.nan if u == dn == 99 else float(u < dn)
    f['hit30'], f['up20'], f['up60'], f['first_up'] = hit30, up20, up60, first_up
    return f


def summarize(g):
    return {'n': int(len(g)), 'up20': round(float(g.up20.mean()) * 100, 1), 'up60': round(float(g.up60.mean()) * 100, 1),
            'hit30_60': round(float(g.hit30.mean()) * 100, 1), 'first_up': round(float(g.first_up.mean()) * 100, 1)}


def main(lab, out_path):
    warnings.filterwarnings('ignore')
    frames = []
    for fn in sorted(os.listdir(os.path.join(lab, 'cache'))):
        if fn.endswith('.json'):
            fr = frame(fn[:-5], json.load(open(os.path.join(lab, 'cache', fn)))['px'])
            if fr is not None:
                frames.append(fr)
    df = pd.concat(frames, ignore_index=True)
    df = df[(df.d >= '20211001') & (df.amt20 >= 3e9) & (df.close >= 1000) & df.up60.notna() & df.ma_disp.notna()]
    df['period'] = np.select([df.d <= TRAIN_END, df.d <= VALID_END], ['train', 'valid'], 'test')
    df['p_disp'] = df.groupby('d').ma_disp.rank(pct=True)
    df['p_vp'] = df.groupby('d').vp_share.rank(pct=True)
    base = (df.base_frac >= 0.8) & (df.flat224 < 0.10)
    squeeze = df.p_disp <= 0.3
    conds = {
        '아무 종목': df.index == df.index,
        '120일 신고가 돌파(첫날)': df.brk,
        '바닥(①)+돌파': base & df.brk,
        '바닥+이평 수렴(①②)+돌파': base & squeeze & df.brk,
        '바닥+수렴+매물대 집중(①②③)+돌파': base & squeeze & (df.p_vp >= 0.7) & df.brk,
    }
    res = {}
    for name, m in conds.items():
        res[name] = {per: summarize(df[m & (df.period == per)]) for per in ('train', 'valid', 'test')}
    cases = df[base & squeeze & df.brk & df.code.isin(['005380', '066570', '192820'])][['code', 'd', 'close', 'base_frac', 'flat224', 'ma_disp', 'p_vp', 'hit30', 'up60']]
    res['user_case_signals'] = cases.round(3).to_dict('records')
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for k, v in res.items():
        print(k, v if k != 'user_case_signals' else '')
    print(cases.to_string())


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
