# -*- coding: utf-8 -*-
"""거래량 급등 다음날 단타 · 52주 저점 종목 검증 (연구용, 실전 연결 없음 - 2026-11-13).

자료: edge_factor_study 캐시 일봉(체결강도 이력은 없음 - 실시간 순위만 운영 중).
A. 단타(다음 거래일 하루): t일 조건 → t+1 시가 매수, t+1 안에 청산. 비용 왕복 0.3%(세금·수수료, 슬리피지 별도).
   목표가 지정(+3%/+5%)은 t+1 고가가 닿으면 체결, 손절(-3%)과 같은 날 모두 닿으면 손절 먼저(보수적), 둘 다 아니면 종가 청산.
   조건: 아무 종목 / 거래량 3배+5% 이상 상승 / 거래량 5배+10~29% 상승 / 위 + 강마감(종가가 당일 범위 상위 20%) /
         상한가 근처(+29% 이상) / 거래량 5배 + -5% 이하 급락.
B. 52주 저점: 신저가(종가 < 직전 250봉 최저 종가) / 250봉 저가 대비 5% 이내 / 최근 10봉 안 신저가 후 반등 확인
   (오늘 양봉·종가 > 5일선) / 반등 확인 + 조용함(두 숫자 점수 상위 30%). 진입 t+1 시가, 비용 0.7%.
기간: 학습 2021-10~2023 / 검증 2024~2025-06 / 시험 2025-07~.
실행: python daytrade_low52_study.py <작업 폴더(cache/·prep.pkl)> <out.json>
"""
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

DT_COST, SW_COST = 0.003, 0.007


def frame(code, px):
    df = pd.DataFrame([r[:6] for r in px if r[0] < '20261113' and r[1] > 0 and r[4] > 0], columns=['d', 'o', 'h', 'l', 'c', 'v'])
    if len(df) < 300:
        return None
    o, h, l, c, v = df.o, df.h, df.l, df.c, df.v
    f = pd.DataFrame({'d': df.d, 'code': code, 'close': c})
    f['amt20'] = (c * v).rolling(20).mean()
    f['r1'] = c / c.shift(1) - 1
    f['vr'] = v / v.shift(1).rolling(20).mean()
    f['pos'] = (c - l) / (h - l).replace(0, np.nan)
    low250 = c.shift(1).rolling(250).min()
    f['newlow'] = c < low250
    f['near_low'] = c <= l.rolling(250).min() * 1.05
    f['recent_low'] = f.newlow.rolling(10).max().astype(bool)
    f['rebound'] = f.recent_low & (c > o) & (c > c.rolling(5).mean())
    no, nh, nl, nc = o.shift(-1), h.shift(-1), l.shift(-1), c.shift(-1)
    f['n_hi'] = nh / no - 1
    f['n_lo'] = nl / no - 1
    f['n_cl'] = nc / no - 1
    for tp in (0.03, 0.05):
        stop = f.n_lo <= -0.03
        hit = f.n_hi >= tp
        f['dt_tp%d' % int(tp * 100)] = np.where(stop, -0.03, np.where(hit, tp, f.n_cl)) - DT_COST
    f['dt_close'] = f.n_cl - DT_COST
    for k in (5, 20, 60):
        f['up%d' % k] = (c.shift(-k) / no - 1 - SW_COST > 0).where(c.shift(-k).notna())
    hh = pd.concat([h.shift(-j) for j in range(1, 21)], axis=1).max(axis=1)
    f['hit10_20'] = (hh / no - 1 >= 0.10).where(c.shift(-20).notna())
    f['ret20'] = c.shift(-20) / no - 1 - SW_COST
    return f


def dt_stats(g):
    return {'n': int(len(g)), '고가+3%닿음': round(float((g.n_hi >= .03).mean()) * 100, 1), '고가+5%닿음': round(float((g.n_hi >= .05).mean()) * 100, 1),
            '종가>시가': round(float((g.dt_close > 0).mean()) * 100, 1), '종가청산평균': round(float(g.dt_close.mean()) * 100, 2),
            '익절3손절3_이긴수': round(float((g.dt_tp3 > 0).mean()) * 100, 1), '익절3손절3_평균': round(float(g.dt_tp3.mean()) * 100, 2),
            '익절5손절3_평균': round(float(g.dt_tp5.mean()) * 100, 2), '시가대비-3%닿음': round(float((g.n_lo <= -.03).mean()) * 100, 1)}


def sw_stats(g):
    return {'n': int(len(g)), 'up5': round(float(g.up5.mean()) * 100, 1), 'up20': round(float(g.up20.mean()) * 100, 1),
            'up60': round(float(g.up60.mean()) * 100, 1), 'hit10_20': round(float(g.hit10_20.mean()) * 100, 1),
            'ret20_med': round(float(g.ret20.median()) * 100, 1)}


def main(lab, out_path):
    warnings.filterwarnings('ignore')
    frames = []
    for fn in sorted(os.listdir(os.path.join(lab, 'cache'))):
        if fn.endswith('.json'):
            fr = frame(fn[:-5], json.load(open(os.path.join(lab, 'cache', fn)))['px'])
            if fr is not None:
                frames.append(fr)
    df = pd.concat(frames, ignore_index=True)
    df = df[(df.d >= '20211001') & (df.amt20 >= 3e9) & (df.close >= 1000) & df.n_cl.notna() & (df.n_hi < 0.35) & (df.n_lo > -0.35)]
    df['period'] = np.select([df.d <= '20231231', df.d <= '20250630'], ['train', 'valid'], 'test')
    sc = pd.read_pickle(os.path.join(lab, 'prep.pkl'))[['code', 'd', 'p_ivol60', 'p_upvol20']]
    sc['quiet'] = (((1 - sc.p_ivol60) + (1 - sc.p_upvol20)).groupby(sc.d).rank(pct=True)) > 0.7
    df = df.merge(sc[['code', 'd', 'quiet']], on=['code', 'd'], how='left')
    dt = {'아무 종목': df.index == df.index,
          '거래량3배+5%이상': (df.vr >= 3) & (df.r1 >= .05),
          '거래량5배+10~29%': (df.vr >= 5) & (df.r1 >= .10) & (df.r1 < .29),
          '거래량5배+10~29%+강마감': (df.vr >= 5) & (df.r1 >= .10) & (df.r1 < .29) & (df.pos >= .8),
          '상한가근처(+29%이상)': df.r1 >= .29,
          '거래량5배+-5%이하급락': (df.vr >= 5) & (df.r1 <= -.05)}
    sw = {'아무 종목': df.index == df.index, '52주 신저가(당일)': df.newlow, '52주 저가 5%이내': df.near_low,
          '신저가 후 반등 확인': df.rebound, '반등 확인+조용함': df.rebound & (df.quiet == True)}  # noqa: E712
    res = {'daytrade': {k: {p: dt_stats(df[m & (df.period == p)]) for p in ('train', 'valid', 'test')} for k, m in dt.items()},
           'low52': {k: {p: sw_stats(df[m & (df.period == p) & df.up60.notna()]) for p in ('train', 'valid', 'test')} for k, m in sw.items()}}
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    pd.set_option('display.width', 250); pd.set_option('display.max_columns', 20)
    for part in ('daytrade', 'low52'):
        rows = [dict(조건=k, 기간=p, **v) for k, d in res[part].items() for p, v in d.items()]
        print(pd.DataFrame(rows).set_index(['조건', '기간']).to_string())


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
