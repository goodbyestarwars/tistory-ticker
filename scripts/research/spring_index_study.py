# -*- coding: utf-8 -*-
"""스프링 지수(Coil -> Ignition) 1차 검증 (연구 전용, 실전·주문 연결 없음 - 2026-11-19).

컨셉: docs/SPRING_INDEX_CONCEPT_2026-11-19.md. 사용자 확정 초안값(2026-11-19 "다 초안으로"):
  분출 = 종가 > 직전 60봉 최고 종가 & 거래량 >= 120봉 중앙값 x 2      (BREAK_VOL)
  분출 확률 기간 k = 10거래일                                          (K)
  의미 있는 저점 = 0차원 지속성 >= 1.0 x ATR14                          (PERSIST_ATR)
  바닥선 이탈 = 종가 < 바닥선 - 0.5 x ATR14                             (FLOOR_TOL_ATR)
  시초 감시 = 09:00~09:10, 시가 갭 상한 +8%                             (IGN_UNTIL, GAP_MAX)
  외국인+기관 순매수(sm60) = 필수 아님, 가점(위험률 모형 변수)

t일 종가까지만 사용(미래 참조 금지). 저점 지속성은 t까지의 창 안에서만 계산하므로 이후 봉이 과거 판정을 바꾸지 않는다.

① 매집: vol_up·box60·drift60·dry10·sm60(accumulation_lead_study와 같은 정의) + 가격 충격 비율
   lam_ratio = λ60/λ250, λ = cov(|r|, rv)/var(rv) (rv = 거래량/120봉 중앙값, |r| = 일간 절대 수익률)
② 바닥선: 최근 120봉 저가에서 지속성 저점 -> 아래쪽 볼록 껍질의 연속 상승 변들. 마지막 변을 t까지 연장 = 바닥선 F.
   rising = 마지막 변 기울기 > 0 & 상승 사슬의 저점 >= 3. 위쪽(고가) 껍질로 U, 폭 W = U - F, 꼭짓점까지 일수 apex.
상태: A(매집) = vol_up 상위20% & box60 하위40% & drift60 < 10% (날짜별 백분위), R = rising, S = A & R.
결과: 진입 t+1 시가, 20/60거래일 뒤 수익(비용 0.7%), K일 내 분출, 20일 내 바닥선 이탈, 분출까지 대기일.
위험률: 학습 기간 로지스틱 회귀(K일 내 분출) -> 검증·시험에서 확률 10분위 보정표와 상위 10% 성과.
③ 가설 H: open_volume_export.py의 events.csv(시초 30분 누적 거래량 >= 전일 x 수준)를 전일 상태와 결합해
   S 상태 종목의 시초 폭발 vs 나머지의 순수익 비교. 감지 09:10 이하·갭 <= 8%·수준 >= 100%를 초안 필터로 쓴다.
   (events는 시각 보정 강도 I(t)가 아니라 전일 대비 누적 비율이므로 근사다.)
기간: 학습 2021-10~2023 / 검증 2024~2025-06 / 시험 2025-07~ (기존 연구와 같음).
실행: python spring_index_study.py <작업 폴더(cache/)> <out.json> [events.csv]
"""
import csv
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

COST = 0.007
K = 10
BREAK_VOL = 2.0
PERSIST_ATR = 1.0
FLOOR_TOL_ATR = 0.5
WIN = 120
IGN_UNTIL = 910
GAP_MAX = 8.0
IGN_LEVEL = 100
FEATURES = ('lam_ratio', 'dry10', 'p_sm60', 'apex', 'floor_slope')


def atr14(h, l, c):
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    return pd.Series(tr).rolling(14).mean().values


def persistent_extrema(x, thr):
    """1차원 0차원 지속성(sublevel set). x의 국소 최저점 중 더 낮은 점과 합쳐지기까지 버틴 높이 >= thr인 위치.
    창의 전역 최저점은 무한 지속성으로 항상 포함. 창 끝(현재)은 아직 확정 아님 -> 오른쪽에 더 낮은 점이 없으면
    오른쪽 최대 상승(현재까지)을 지속성으로 쓴다(인과적)."""
    n = len(x)
    out = []
    for i in range(1, n - 1):
        if not (x[i] <= x[i - 1] and x[i] <= x[i + 1]):
            continue
        left = np.where(x[:i] < x[i])[0]
        right = np.where(x[i + 1:] < x[i])[0]
        lp = x[left[-1]:i].max() - x[i] if len(left) else np.inf
        rp = x[i + 1:i + 1 + right[0]].max() - x[i] if len(right) else x[i + 1:].max() - x[i]
        p = min(lp, rp) if len(left) else rp
        if p >= thr:
            out.append(i)
    return out


def lower_hull(px, py):
    pts = []
    for p in zip(px, py):
        while len(pts) >= 2 and (pts[-1][0] - pts[-2][0]) * (p[1] - pts[-2][1]) - (pts[-1][1] - pts[-2][1]) * (p[0] - pts[-2][0]) <= 0:
            pts.pop()
        pts.append(p)
    return pts


def floor_geometry(lo, hi, atr):
    """반환: (rising, floor_at_t, slope_per_bar_pct, apex_days, chain_lows)"""
    n = len(lo)
    idx = persistent_extrema(lo, PERSIST_ATR * atr)
    if len(idx) < 2:
        return False, np.nan, np.nan, np.nan, 0
    hull = lower_hull(idx, lo[idx])
    if len(hull) < 2:
        return False, np.nan, np.nan, np.nan, 0
    (x0, y0), (x1, y1) = hull[-2], hull[-1]
    slope = (y1 - y0) / (x1 - x0)
    j = len(hull) - 1
    while j > 0 and hull[j][1] > hull[j - 1][1]:
        j -= 1
    start = hull[j][0]
    chain = sum(1 for i in idx if i >= start and lo[i] - (y1 + slope * (i - x1)) <= 0.5 * atr)
    floor = y1 + slope * (n - 1 - x1)
    rising = slope > 0 and chain >= 3
    hidx = persistent_extrema(-hi, PERSIST_ATR * atr)
    apex = np.nan
    if len(hidx) >= 2:
        uh = lower_hull(hidx, -hi[hidx])
        (u0, v0), (u1, v1) = uh[-2], uh[-1]
        uslope = -(v1 - v0) / (u1 - u0)
        upper = -v1 + uslope * (n - 1 - u1)
        width = upper - floor
        if width > 0 and slope - uslope > 0:
            apex = width / (slope - uslope)
    return rising, floor, slope / max(floor, 1e-9) * 100, apex, chain


def rolling_lambda(absr, rv, w):
    a, b = pd.Series(absr), pd.Series(rv)
    return (a.rolling(w).cov(b) / b.rolling(w).var()).values


def frame(code, data):
    px = [r for r in data['px'] if r[1] > 0 and r[4] > 0]
    if len(px) < 400:
        return None
    fl = data.get('flow') or {}
    df = pd.DataFrame([r[:6] for r in px], columns=['d', 'o', 'h', 'l', 'c', 'v'])
    df['sm'] = [sum(x for x in (fl.get(d) or [None, None])[:2] if x is not None) if fl.get(d) else np.nan for d in df.d]
    o, h, l, c, v = (df[k].values.astype(float) for k in 'ohlcv')
    n = len(c)
    f = pd.DataFrame({'d': df.d, 'code': code, 'close': c})
    vs = pd.Series(v)
    cs = pd.Series(c)
    med60 = vs.rolling(60).median()
    med120 = vs.rolling(120).median().values
    f['amt20'] = (cs * vs).rolling(20).mean()
    f['vol_up'] = med60 / vs.shift(60).rolling(190).median()
    f['box60'] = (cs.rolling(60).max() - cs.rolling(60).min()) / cs
    f['drift60'] = (cs / cs.shift(60) - 1).abs()
    f['dry10'] = vs.rolling(10).median() / med60
    f['sm60'] = df.sm.rolling(60).sum() / vs.rolling(60).sum()
    absr = np.abs(np.r_[np.nan, c[1:] / c[:-1] - 1])
    rv = v / np.where(med120 > 0, med120, np.nan)
    f['lam_ratio'] = rolling_lambda(absr, rv, 60) / rolling_lambda(absr, rv, 250)
    atr = atr14(h, l, c)
    top60 = cs.shift(1).rolling(60).max().values
    brk = (c > top60) & (v >= BREAK_VOL * med120)
    f['break_today'] = brk
    # 결과(t+1 시가 진입)
    res = np.full((n, 5), np.nan)
    for i in range(n - 61):
        e = o[i + 1]
        if e <= 0:
            continue
        nxt = np.where(brk[i + 1:i + 1 + 60])[0]
        res[i] = [c[i + 20] / e - 1 - COST, c[i + 60] / e - 1 - COST, float(brk[i + 1:i + 1 + K].any()),
                  nxt[0] + 1 if len(nxt) else np.nan, np.nan]
    for k, name in enumerate(['ret20', 'ret60', 'brk_k', 'wait', 'floor_break20']):
        f[name] = res[:, k]
    f['floor'] = np.nan
    f['rising'] = False
    for name in ('floor_slope', 'apex', 'chain'):
        f[name] = np.nan
    return f, (o, h, l, c, atr)


def add_geometry(f, arrays, rows):
    o, h, l, c, atr = arrays
    n = len(c)
    for i in rows:
        if i < WIN or not np.isfinite(atr[i]) or atr[i] <= 0:
            continue
        rising, floor, slope, apex, chain = floor_geometry(l[i - WIN + 1:i + 1], h[i - WIN + 1:i + 1], atr[i])
        f.iat[i, f.columns.get_loc('rising')] = bool(rising)
        f.iat[i, f.columns.get_loc('floor')] = floor
        f.iat[i, f.columns.get_loc('floor_slope')] = slope
        f.iat[i, f.columns.get_loc('apex')] = apex
        f.iat[i, f.columns.get_loc('chain')] = chain
        if rising and i + 21 < n:
            fwd = np.arange(1, 21)
            line = floor + (slope / 100 * floor) * fwd
            f.iat[i, f.columns.get_loc('floor_break20')] = float((c[i + 1:i + 21] < line - FLOOR_TOL_ATR * atr[i]).any())


def logistic_fit(X, y, iters=25, l2=1e-3):
    X = np.c_[np.ones(len(X)), X]
    w = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-X @ w))
        g = X.T @ (y - p) - l2 * w
        H = (X * (p * (1 - p))[:, None]).T @ X + l2 * np.eye(len(w))
        w += np.linalg.solve(H, g)
    return w


def logistic_predict(w, X):
    return 1 / (1 + np.exp(-np.c_[np.ones(len(X)), X] @ w))


def summarize(g):
    if not len(g):
        return {'n': 0}
    ok = g.ret60.notna()
    return {'n': int(len(g)), 'win20': round(float((g.ret20 > 0).mean()) * 100, 1), 'win60': round(float((g.ret60[ok] > 0).mean()) * 100, 1),
            'ret20_mean': round(float(g.ret20.mean()) * 100, 2), 'ret60_med': round(float(g.ret60.median()) * 100, 2),
            'brk_k': round(float(g.brk_k.mean()) * 100, 1), 'wait_med': None if g.wait.notna().sum() == 0 else float(g.wait.median()),
            'floor_break20': None if g.floor_break20.notna().sum() == 0 else round(float(g.floor_break20.mean()) * 100, 1)}


def load_events(path):
    out = []
    with open(path, encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            def num(k):
                try:
                    return float(r[k])
                except (KeyError, TypeError, ValueError):
                    return None
            out.append({'code': r['code'], 'day': r['day'].replace('-', ''), 'level': num('level_pct'), 'gap': num('open_gap_pct'),
                        'hhmm': int(str(r.get('detect_time_hhmm') or '0').replace(':', '') or 0), 'day_close': num('net_day_close_pct'),
                        'd5': num('net_d5_pct'), 'distrib': r.get('DISTRIB') in ('1', 'True', 'true'), 'w': num('weight') or 1.0})
    return out


def main(lab, out_path, events_path=None):
    warnings.filterwarnings('ignore')
    frames, geo = [], []
    for fn in sorted(os.listdir(os.path.join(lab, 'cache'))):
        if not fn.endswith('.json'):
            continue
        got = frame(fn[:-5], json.load(open(os.path.join(lab, 'cache', fn), encoding='utf-8')))
        if got is not None:
            frames.append(got[0])
            geo.append(got[1])
    # 기하 계산은 비싸다: 날짜 백분위 전에 느슨한 매집 예비 조건(vol_up>=1.2, box60<=0.35) 날과 5일 간격 표본만 계산.
    for f, arrays in zip(frames, geo):
        rows = np.where(((f.vol_up >= 1.2) & (f.box60 <= .35)).values | (np.arange(len(f)) % 5 == 0))[0]
        add_geometry(f, arrays, rows)
    df = pd.concat(frames, ignore_index=True)
    df = df[(df.d >= '20211001') & (df.amt20 >= 3e9) & (df.close >= 1000) & df.ret20.notna() & df.vol_up.notna()]
    df['period'] = np.select([df.d <= '20231231', df.d <= '20250630'], ['train', 'valid'], 'test')
    for k in ('vol_up', 'box60', 'sm60'):
        df['p_' + k] = df.groupby('d')[k].rank(pct=True)
    A = (df.p_vol_up >= .8) & (df.p_box60 <= .4) & (df.drift60 < .10)
    R = df.rising.astype(bool)
    S = A & R
    geo_rows = df.chain.notna()
    conds = {'아무 종목': df.index == df.index, '기하 계산 표본(5일 간격 포함)': geo_rows, '① A 매집': A, '② R 바닥 상승': R,
             'S = A & R (용수철)': S, 'S + 가격충격 낮음(lam_ratio<1)': S & (df.lam_ratio < 1)}
    res = {'params': dict(K=K, BREAK_VOL=BREAK_VOL, PERSIST_ATR=PERSIST_ATR, FLOOR_TOL_ATR=FLOOR_TOL_ATR, WIN=WIN,
                          IGN_UNTIL=IGN_UNTIL, GAP_MAX=GAP_MAX, IGN_LEVEL=IGN_LEVEL, COST=COST),
           'groups': {name: {per: summarize(df[m & (df.period == per)]) for per in ('train', 'valid', 'test')} for name, m in conds.items()}}
    # 위험률 모형: S 후보 안에서 K일 내 분출 확률
    cand = df[S].copy()
    cand['p_sm60'] = cand.p_sm60.fillna(.5)
    cand['apex'] = cand.apex.clip(upper=250).fillna(250)
    cand = cand.dropna(subset=['lam_ratio', 'dry10', 'floor_slope'])
    tr = cand[cand.period == 'train']
    if len(tr) >= 200 and tr.brk_k.nunique() == 2:
        mu, sd = tr[list(FEATURES)].mean(), tr[list(FEATURES)].std().replace(0, 1)
        w = logistic_fit(((tr[list(FEATURES)] - mu) / sd).values, tr.brk_k.values)
        cand['p_hat'] = logistic_predict(w, ((cand[list(FEATURES)] - mu) / sd).values)
        cut = float(cand.loc[cand.period == 'train', 'p_hat'].quantile(.9))
        res['hazard'] = {'features': list(FEATURES), 'coef_std': [round(float(x), 3) for x in w], 'train_top10_cut': round(cut, 3)}
        for per in ('valid', 'test'):
            g = cand[cand.period == per]
            if not len(g):
                continue
            g = g.assign(dec=pd.qcut(g.p_hat.rank(method='first'), 10, labels=False))
            res['hazard'][per] = {'calibration': [{'decile': int(k), 'pred': round(float(x.p_hat.mean()) * 100, 1), 'actual': round(float(x.brk_k.mean()) * 100, 1)}
                                                  for k, x in g.groupby('dec')],
                                  'top10': summarize(g[g.p_hat >= cut]), 'rest': summarize(g[g.p_hat < cut])}
    # ③ 가설 H
    if events_path and os.path.exists(events_path):
        state = df.set_index(['code', 'd'])
        prev_day = {}
        for code, g in df.sort_values('d').groupby('code'):
            ds = list(g.d)
            for a, b in zip(ds[:-1], ds[1:]):
                prev_day[(code, b)] = a
        ev = [e for e in load_events(events_path) if e['level'] is not None and e['level'] >= IGN_LEVEL and e['hhmm'] <= IGN_UNTIL
              and (e['gap'] is None or e['gap'] <= GAP_MAX)]
        rows = []
        for e in ev:
            p = prev_day.get((e['code'], e['day']))
            if p is None or (e['code'], p) not in state.index:
                continue
            s = state.loc[(e['code'], p)]
            in_s = bool(((s.p_vol_up >= .8) & (s.p_box60 <= .4) & (s.drift60 < .10)) and s.rising)
            rows.append(dict(e, in_s=in_s, in_a=bool((s.p_vol_up >= .8) & (s.p_box60 <= .4) & (s.drift60 < .10)), in_r=bool(s.rising)))
        evd = pd.DataFrame(rows)

        def ev_sum(g):
            if not len(g):
                return {'n': 0}
            return {'n': int(len(g)), 'day_close_mean': round(float(g.day_close.mean()), 2), 'd5_mean': round(float(g.d5.mean()), 2),
                    'd5_win': round(float((g.d5 > 0).mean()) * 100, 1), 'distrib_share': round(float(g.distrib.mean()) * 100, 1)}
        if len(evd):
            res['ignition_H'] = {'filter': '수준>=%d%% · 감지<=%04d · 갭<=%.0f%%' % (IGN_LEVEL, IGN_UNTIL, GAP_MAX),
                                 '전체': ev_sum(evd), 'S 상태(①&②)': ev_sum(evd[evd.in_s]), '① A만': ev_sum(evd[evd.in_a]),
                                 '② R만': ev_sum(evd[evd.in_r]), '나머지': ev_sum(evd[~evd.in_s]),
                                 'S 상태 & 분배신호 없음': ev_sum(evd[evd.in_s & ~evd.distrib])}
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
    rows = [dict(조건=k, 기간=p, **v) for k, d in res['groups'].items() for p, v in d.items()]
    pd.set_option('display.width', 250)
    pd.set_option('display.max_rows', 80)
    print(pd.DataFrame(rows).set_index(['조건', '기간']))
    for key in ('hazard', 'ignition_H'):
        if key in res:
            print(key, json.dumps(res[key], ensure_ascii=False)[:2000])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
