# -*- coding: utf-8 -*-
"""지지 구간 방어 후 거래량 재폭발 + 전일 고가 돌파 단타 백테스트 (연구 전용, 주문·자동매매 연결 없음 - 2026-11-26).

근거: 2026-11-26 한국화장품제조·로킷헬스케어·루닛 사례. 사용자가 합의한 5개 조건을 일봉으로 옮긴다.
신호일 t 에서 쓰는 값은 t-1 종가까지(= 장 시작 전에 아는 값)와 t 일의 '전일 고가 돌파' 한 가지뿐이다.

  SUP    t-10~t-1 최저가가 112일선 또는 224일선(t-1 기준)의 -5% ~ +6% 안 (지지선 터치·이탈 후 복귀 포함)
  HOLD   최근 5봉(t-5~t-1) 최저가 >= 그 앞 20봉(t-25~t-6) 최저가 (눌림 저점을 다시 깨지 않음)
  SURGE  t-60~t-2 사이 일간 상승률 +15% 이상이 한 번 이상 (앞선 급등 이력)
  VOLX   어제(t-1) 거래량 >= 직전 5일(t-6~t-2) 평균의 2배
  BRK    t 일 고가 > t-1 일 고가 (전일 고가 돌파)
  LIQ    t-1 까지 20일 평균 거래대금 >= 20억 (너무 얇은 종목 제외)

진입: 전일 고가에 걸어 둔 지정가를 돌파하는 순간 체결로 가정 = max(t 시가, t-1 고가). 시가가 전일 종가 +15% 이상 갭이면
  이미 달린 종목이라 제외. 일봉에는 장중 순서가 없으므로 같은 날 손절·고점 순서는 손절 우선(보수적).
청산(모두 진입가 기준, 왕복비용 0.4% 차감):
  D0종가        t 일 종가
  D1시가        t+1 일 시가
  D1종가        t+1 일 종가
  D3종가        t+3 일 종가
  TPx_SLy       당일 +x% 익절 / -y% 손절, 안 걸리면 종가. 일봉은 순서를 모르므로 낙관(_opt)·비관(_pes) 두 경계로 보고
  고가상한(MFE)  t 일 고가/진입가 (참고용 최대치, 실현 불가)
비교: BASE(LIQ+BRK 만), 조건 하나씩 뺀 변형, 시장 국면(균등가중 지수 60일선 t-1 기준).

실행: python daytrade_support_breakout_study.py <cache 폴더> <out.json>
"""
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings('ignore')
COST = 0.004
MIN_AMT = 2e9
GAP_MAX = 0.15


def rolling_min(a, w):
    return pd.Series(a).rolling(w).min().values


def per_code(code, px):
    d = np.array([r[0] for r in px])
    o, h, l, c, v = (np.array([r[i] for r in px], float) for i in range(1, 6))
    n = len(c)
    if n < 260:
        return None
    cs, vs = pd.Series(c), pd.Series(v)
    ma112 = cs.rolling(112).mean().values
    ma224 = cs.rolling(224).mean().values
    amt20 = (cs * vs).rolling(20).mean().values
    ret = np.r_[np.nan, c[1:] / c[:-1] - 1]
    surge60 = pd.Series(ret).rolling(59).max().values  # t-60..t-2 를 보려면 한 칸 민다(아래 shift)
    low10 = rolling_min(l, 10)
    low5 = rolling_min(l, 5)
    low20 = rolling_min(l, 20)
    vmean5 = vs.rolling(5).mean().values
    out = []
    for t in range(240, n - 3):
        if not (h[t] > h[t - 1]):
            continue
        if not (amt20[t - 1] >= MIN_AMT):
            continue
        ep = max(o[t], h[t - 1])
        if o[t] >= c[t - 1] * (1 + GAP_MAX) or ep > h[t]:
            continue
        m1, m2 = ma112[t - 1], ma224[t - 1]
        lo10 = low10[t - 1]
        sup = False
        for m in (m1, m2):
            if m == m and m > 0:
                r = lo10 / m - 1
                if -0.05 <= r <= 0.06:
                    sup = True
        hold = low5[t - 1] >= low20[t - 6]
        surge = surge60[t - 2] >= 0.15
        volx = v[t - 1] >= 2 * vmean5[t - 2] if vmean5[t - 2] > 0 else False
        r0 = c[t] / ep - 1
        open_entry = o[t] >= h[t - 1]  # 시가가 전일 고가 이상이면 시가 진입(손절 판정에 당일 저가를 쓸 수 있음)
        # 익절/손절 경계(일봉은 순서를 모른다). 고가는 진입 뒤에 나온 값이라 익절 도달은 확실하다.
        # 낙관: 익절 우선, 손절은 종가가 손절선 이하이거나 시가 진입 후 저가 이탈일 때만(익절 없을 때).
        # 비관: 저가가 손절선 이하면 무조건 손절 우선(돌파 진입은 저가가 진입 전일 수도 있어 과도하게 보수적).
        tp = {}
        for name, (tpv, slv) in {'TP3_SL3': (0.03, 0.03), 'TP5_SL3': (0.05, 0.03), 'TP5_SL5': (0.05, 0.05),
                                 'TP8_SL5': (0.08, 0.05)}.items():
            hit_tp = h[t] >= ep * (1 + tpv)
            cert_sl = (c[t] <= ep * (1 - slv)) or (open_entry and l[t] <= ep * (1 - slv))
            poss_sl = l[t] <= ep * (1 - slv)
            opt = tpv if hit_tp else (-slv if cert_sl else r0)
            pes = -slv if poss_sl else (tpv if hit_tp else r0)
            tp[name + '_opt'] = opt - COST
            tp[name + '_pes'] = pes - COST
        out.append((code, d[t], sup, hold, surge, volx, open_entry,
                    r0 - COST, o[t + 1] / ep - 1 - COST, c[t + 1] / ep - 1 - COST,
                    c[t + 3] / ep - 1 - COST, h[t] / ep - 1 - COST, *tp.values()))
    return out, pd.Series(ret, index=d)


TPN = [a + b for a in ('TP3_SL3', 'TP5_SL3', 'TP5_SL5', 'TP8_SL5') for b in ('_opt', '_pes')]
COLS = ['code', 'd', 'SUP', 'HOLD', 'SURGE', 'VOLX', 'OPEN_ENTRY', 'D0', 'D1open', 'D1close', 'D3close', 'MFE'] + TPN
HOR = ['D0', 'D1open', 'D1close', 'D3close'] + TPN


def stats(df):
    res = {'n': int(len(df)), 'days': int(df.d.nunique())}
    if len(df) == 0:
        return res
    for k in HOR:
        x = df[k].values
        w, ls = x[x > 0], x[x <= 0]
        res[k] = {
            'win': round(float((x > 0).mean()) * 100, 1),
            'mean': round(float(x.mean()) * 100, 2),
            'median': round(float(np.median(x)) * 100, 2),
            'avgWin': round(float(w.mean()) * 100, 2) if len(w) else None,
            'avgLoss': round(float(ls.mean()) * 100, 2) if len(ls) else None,
            'pf': round(float(w.sum() / -ls.sum()), 2) if len(ls) and ls.sum() < 0 else None,
        }
    res['MFEmean'] = round(float(df.MFE.mean()) * 100, 2)
    return res


def main(cache_dir, out_path):
    rows, rets = [], {}
    files = sorted(f for f in os.listdir(cache_dir) if f.endswith('.json'))
    for f in files:
        code = f[:-5]
        try:
            px = json.load(open(os.path.join(cache_dir, f), encoding='utf-8'))['px']
        except Exception:
            continue
        r = per_code(code, px)
        if not r:
            continue
        rows.extend(r[0])
        rets[code] = r[1]
    df = pd.DataFrame(rows, columns=COLS)
    # 시장 국면: KOSPI 종가가 t-1 에서 60일선 위인가 (lab5y/kospi_naver.json, 2019-12~)
    R = pd.DataFrame(rets).sort_index()
    kp = json.load(open(os.path.join(os.path.dirname(os.path.abspath(cache_dir.rstrip('/\\'))), 'kospi_naver.json'),
                        encoding='utf-8'))['rows']
    idx = pd.Series({r['date']: float(r['close']) for r in kp}).sort_index()
    up = (idx > idx.rolling(60).mean()).shift(1)
    df['UP'] = df.d.map(up).fillna(False).astype(bool)
    df['year'] = df.d.str[:4]
    full = df[df.SUP & df.HOLD & df.SURGE & df.VOLX]
    out = {
        'meta': {'codes': len(rets), 'range': [str(R.index.min()), str(R.index.max())], 'cost': COST,
                 'minAmt': MIN_AMT, 'gapMax': GAP_MAX, 'baseSignals': int(len(df))},
        'FULL': stats(full),
        'FULL_marketUp': stats(full[full.UP]),
        'FULL_marketDown': stats(full[~full.UP]),
        'BASE': stats(df),
    }
    for drop in ('SUP', 'HOLD', 'SURGE', 'VOLX'):
        m = np.ones(len(df), bool)
        for k in ('SUP', 'HOLD', 'SURGE', 'VOLX'):
            if k != drop:
                m &= df[k].values
        out['minus_' + drop] = stats(df[m])
    for k in ('SUP', 'HOLD', 'SURGE', 'VOLX'):
        out['only_' + k] = stats(df[df[k]])
    out['FULL_openEntry'] = stats(full[full.OPEN_ENTRY])
    out['FULL_breakoutEntry'] = stats(full[~full.OPEN_ENTRY])
    out['BASE_marketUp'] = stats(df[df.UP])
    out['byYear_FULL'] = {y: stats(g) for y, g in full.groupby('year')}
    out['topDays_FULL'] = full.d.value_counts().head(5).to_dict()
    out['latest_FULL'] = full.sort_values('d').tail(15)[['code', 'd', 'D0', 'D1close', 'D3close']].round(4).to_dict('records')
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    full.to_csv(out_path.replace('.json', '_full.csv'), index=False)
    print(json.dumps({k: out[k] for k in ('meta', 'FULL', 'BASE')}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
