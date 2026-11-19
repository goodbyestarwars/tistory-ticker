# -*- coding: utf-8 -*-
"""상승 구간 해부: 오른 구간을 먼저 뽑고, 출발점의 공통 분모를 찾는다 (연구 전용, 실전·주문 연결 없음 - 2026-11-19).

사용자 지시(2026-11-19): "상승 구간(상승률)을 백데이터에서 먼저 뽑고, 거기서 공통 분모를 찾는 것이 더 빠르다."
선행 연구 SURGE_PRECURSOR_STUDY_2026-10-18은 5~10일 단기 급등과 숫자 피처 하나씩을 봤다. 여기서는
  (1) 추세 한 다리(바닥 -> 고점, +RALLY_GAIN 이상, RALLY_MAX_BARS 안, 중간에 바닥 이탈 없음)를 뽑고
  (2) 출발 바닥 T0까지의 차트 모양(직전 PRE봉 가격 경로)을 PCA + k-평균으로 원형(archetype)으로 묶고
  (3) 같은 날 오르지 않은 종목(대조군)과 비교해 lift = 상승 구간 비율 / 대조군 비율 을 본다.
대조군이 핵심이다: 오른 종목에 흔한 특징이 안 오른 종목에도 똑같이 흔하면 공통 분모가 아니다.

정의 v2 기본 UNIT=atr: 상승 = 바닥 대비 >= 8 x ATR%, 실패 = < 3 x ATR% (변동성 단위, 정의가 변동성을 편들지 않게).
  피처 lift는 ATR% 3분위 안 비교의 가중 평균(lift_volctl)도 함께 낸다. 모양 원형은 경로를 ATR 단위로 바꿔 크기 아닌 형태로 묶는다.
정의 v1(UNIT=pct, 초안):
  RALLY_GAIN=0.30, RALLY_MAX_BARS=60 : 바닥 종가 대비 60봉 안 최고 종가 +30% 이상, 그 사이 바닥 종가 아래 마감 없음
  바닥 = 0차원 지속성 >= 2 x ATR14 인 저점(spring_index_study.persistent_extrema 재사용, 라벨링이라 전체 구간 사용)
  대조군(기본 CONTROL=trough) = 같은 기준의 의미 있는 바닥이었지만 RALLY_MAX_BARS 안 최고 상승이 FAIL_GAIN(10%) 미만에 그친 '실패한 바닥'.
    바닥은 정의상 '내려오다 멈춘' 모양이라 아무 날과 비교하면 하락 흔적만 공통 분모로 잡힌다(1차 합성 실행에서 확인).
    질문은 '비슷한 바닥 중 무엇이 날아오르고 무엇이 실패하는가'다. CONTROL=random 은 같은 날 무작위 종목 비교(참고용).
피처(T0 종가까지만): 250(가용 120+)봉 고점 대비 낙폭, 120봉 위치, 60봉 박스폭·위치변화, 직전 20/60봉 수익률, 시장 대비 60봉 상대강도,
  거래량 체제(60/이전120 중앙값)·최근 마름(10/60), 고유 변동성 60, 상승일 거래량 비중 20, ATR14/ATR60, 20/60/120일선 대비, 60일선 기울기,
  바닥 상승(spring floor_geometry, 120봉). 날짜별 백분위 5분위로 비교한다.
2단계 수급 피처(2026-11-19, 캐시에 flow·소진율이 있을 때): f20·o20(20일 외국인/기관 순매수/거래량), fo60, dfr20(외국인 소진율 20일 변화). 결측은 lift 계산에서 빠진다.
주의(관측 가능성): T0는 지나고 나서야 바닥으로 확정된다. 이 연구는 '무엇이 공통인가'를 찾는 1단계이며, 실전 규칙은
  공통 분모를 T0 이후 관측 가능한 시점(예: 바닥 +5% 회복)에 다시 대조군과 검증하는 2단계가 필요하다.
실행: python rally_anatomy_study.py <작업 폴더(cache/)> <out.json>
  환경변수: RALLY_GAIN, RALLY_MAX_BARS, PRE(기본 60), K(원형 수, 기본 6), SPRING_INDEX(KOSPI 지수 파일, 국면 표시용)
"""
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spring_index_study import atr14, floor_geometry, persistent_extrema, regime_by_date  # noqa: E402
from pullback_combo_study import EARN_KEYS, earn_cols, event_cols, flow_cols, load_earn, load_events  # noqa: E402

RALLY_GAIN = float(os.environ.get('RALLY_GAIN', '0.30'))
RALLY_MAX_BARS = int(os.environ.get('RALLY_MAX_BARS', '60'))
PRE = int(os.environ.get('PRE', '60'))
K = int(os.environ.get('K', '6'))
CTRL_PER_DAY = 20
CONTROL = os.environ.get('CONTROL', 'trough')
FAIL_GAIN = float(os.environ.get('FAIL_GAIN', '0.10'))
# v2(2026-11-19): 변동성 단위 정의. v1은 바닥 조건(지속성 >= 2 x ATR)과 실패 기준(+10% 미만)이 충돌해
# ATR 5% 이상 종목은 실패 바닥이 될 수 없었다 -> '변동성 큼 = 상승'이 정의에서 만들어졌다(실데이터 v1 확인).
# UNIT=atr(기본): 상승 = 바닥 대비 최고 상승 >= RALLY_ATR x (ATR14/종가), 실패 = < FAIL_ATR x (ATR14/종가). UNIT=pct 는 v1.
UNIT = os.environ.get('UNIT', 'atr')
RALLY_ATR = float(os.environ.get('RALLY_ATR', '8'))
FAIL_ATR = float(os.environ.get('FAIL_ATR', '3'))
MIN_AMT = 3e9
SEED = 7
FEATURES = ('evw_earn', 'evw_contract', 'evw_any', 'evp_any', 'e_op_sym', 'e_rev_yoy', 'e_opm_chg', 'e_turn', 'f20', 'o20', 'fo60', 'dfr20', 'dd250', 'pos120', 'box60', 'drift60', 'ret20', 'rs60', 'vol_up', 'dry10', 'ivol60', 'upvol20',
            'atr_ratio', 'c_ma20', 'c_ma60', 'c_ma120', 'ma60_slope', 'rising')


def load(lab):
    out = {}
    earn = load_earn(os.environ.get('EARN_FILE', os.path.join(lab, 'earn.json')))
    events = load_events(os.environ.get('EVENTS_FILE', os.path.join(lab, 'events.json')))
    for fn in sorted(os.listdir(os.path.join(lab, 'cache'))):
        if fn.endswith('.json'):
            raw = json.load(open(os.path.join(lab, 'cache', fn), encoding='utf-8'))
            px = [r for r in raw['px'] if r[1] > 0 and r[4] > 0]
            if len(px) >= PRE + 130:
                df = pd.DataFrame([r[:6] for r in px], columns=['d', 'o', 'h', 'l', 'c', 'v'])
                fr = [r[6] if len(r) > 6 else None for r in px]
                fl = flow_cols(list(df.d), df.v.values.astype(float), raw.get('flow'), fr if any(x is not None for x in fr) else None)
                for k in fl.columns:
                    df[k] = fl[k].values
                ec = earn_cols(list(df.d), earn.get(fn[:-5]))
                for k in ec.columns:
                    df[k] = ec[k].values
                df.attrs['events'] = None if events is None else events.get(fn[:-5], [])
                out[fn[:-5]] = df
    return out


def find_troughs(df):
    """의미 있는 바닥(지속성 >= 2 x ATR)마다 RALLY_MAX_BARS 안, 바닥 종가 미만 마감 전까지의 최고 상승률."""
    c, l = df.c.values.astype(float), df.l.values.astype(float)
    atr = atr14(df.h.values.astype(float), l, c)
    out = []
    for i in persistent_extrema(c, 0):
        if i < PRE + 120 or i + RALLY_MAX_BARS >= len(c) or not np.isfinite(atr[i]):
            continue
        # 지속성 문턱(2 x ATR)은 그 저점의 ATR로 판정
        left = np.where(c[:i] < c[i])[0]
        lp = c[left[-1]:i].max() - c[i] if len(left) else np.inf
        right = np.where(c[i + 1:] < c[i])[0]
        rp = c[i + 1:i + 1 + right[0]].max() - c[i] if len(right) else c[i + 1:].max() - c[i]
        if min(lp, rp) < 2 * atr[i]:
            continue
        seg = c[i + 1:i + 1 + RALLY_MAX_BARS]
        if not len(seg):
            out.append({'t0': i, 'peak': i, 'gain': 0.0, 'bars': 0, 'g_atr': 0.0})
            continue
        broke = np.where(seg < c[i])[0]
        seg = seg[:broke[0]] if len(broke) else seg
        if not len(seg):
            out.append({'t0': i, 'peak': i, 'gain': 0.0, 'bars': 0, 'g_atr': 0.0})
            continue
        j = int(np.argmax(seg))
        g = seg[j] / c[i] - 1
        out.append({'t0': i, 'peak': i + 1 + j, 'gain': g, 'bars': j + 1, 'g_atr': g / (atr[i] / c[i])})
    return out


def find_rallies(df):
    """바닥 T0 -> RALLY_MAX_BARS 안 최고 종가 +RALLY_GAIN 이상, 그 사이 바닥 종가 미만 마감 없음. 겹치면 앞 다리만."""
    rallies, busy_until = [], -1
    for r in find_troughs(df):
        if r['t0'] > busy_until and (r['g_atr'] >= RALLY_ATR if UNIT == 'atr' else r['gain'] >= RALLY_GAIN):
            rallies.append(r)
            busy_until = r['peak']
    return rallies


def features(df, mret):
    o, h, l, c, v = (df[k].values.astype(float) for k in 'ohlcv')
    cs, vs = pd.Series(c), pd.Series(v)
    f = pd.DataFrame({'d': df.d})
    f['amt20'] = (cs * vs).rolling(20).mean()
    f['dd250'] = c / cs.rolling(250, min_periods=120).max() - 1
    lo120, hi120 = cs.rolling(120).min(), cs.rolling(120).max()
    f['pos120'] = (cs - lo120) / (hi120 - lo120)
    f['box60'] = (cs.rolling(60).max() - cs.rolling(60).min()) / cs
    f['drift60'] = cs / cs.shift(60) - 1
    f['ret20'] = cs / cs.shift(20) - 1
    f['ret60'] = f['drift60']  # rs60 계산용. 피처 목록에서는 drift60과 같은 값이라 뺀다(v2 실데이터에서 중복 확인)
    r = cs.pct_change()
    m = pd.Series(df.d.map(mret).values)
    f['rs60'] = f.ret60 - ((1 + m).rolling(60).apply(np.prod, raw=True) - 1)
    med60 = vs.rolling(60).median()
    f['vol_up'] = med60 / vs.shift(60).rolling(120).median()
    f['dry10'] = vs.rolling(10).median() / med60
    f['ivol60'] = (r - m).rolling(60).std()
    up = (cs > cs.shift(1))
    f['upvol20'] = vs.where(up, 0).rolling(20).sum() / vs.rolling(20).sum()
    atr = pd.Series(atr14(h, l, c))
    f['atr_ratio'] = atr / atr.rolling(60).mean()
    for w in (20, 60, 120):
        f['c_ma%d' % w] = cs / cs.rolling(w).mean() - 1
    ma60 = cs.rolling(60).mean()
    f['ma60_slope'] = ma60 / ma60.shift(20) - 1
    f['rising'] = np.nan
    for k in ('f20', 'o20', 'fo60', 'dfr20') + EARN_KEYS:
        f[k] = df[k].values if k in df else np.nan
    # 4단계 사건(사후 서술용: evw_*는 T0 뒤 10거래일까지 포함하므로 '상승 출발에 사건이 있었나'를 묘사할 뿐 매매 규칙이 아니다)
    ev = event_cols(list(df.d), c, atr.values, df.attrs.get('events'))
    for k in ('evw_earn', 'evw_contract', 'evw_any', 'evp_any'):
        f[k] = ev[k].values
    return f, atr.values


def path(c, i, scale=1.0):
    p = np.log(c[i - PRE + 1:i + 1] / c[i]) / scale
    return p if len(p) == PRE and np.isfinite(p).all() else None


def kmeans(X, k, iters=60):
    rng = np.random.default_rng(SEED)
    cent = X[rng.choice(len(X), k, replace=False)]
    for _ in range(iters):
        lab = np.argmin(((X[:, None, :] - cent[None]) ** 2).sum(-1), axis=1)
        new = np.array([X[lab == j].mean(0) if (lab == j).any() else cent[j] for j in range(k)])
        if np.allclose(new, cent):
            break
        cent = new
    return lab, cent


def main(lab, out_path):
    warnings.filterwarnings('ignore')
    data = load(lab)
    closes = pd.DataFrame({code: df.set_index('d').c for code, df in data.items()}).sort_index()
    mret = closes.pct_change().mean(axis=1).to_dict()
    rows, rally_meta = [], []
    rally_days = {}
    feats = {}
    failed = []
    for code, df in data.items():
        f, atr = features(df, mret)
        feats[code] = (f, atr)
        if CONTROL == 'trough':
            failed += [(code, r['t0']) for r in find_troughs(df) if (r['g_atr'] < FAIL_ATR if UNIT == 'atr' else r['gain'] < FAIL_GAIN)]
        for r in find_rallies(df):
            rally_meta.append(dict(code=code, d=df.d.iat[r['t0']], gain=r['gain'], bars=r['bars'], t0=r['t0']))
            rally_days.setdefault(df.d.iat[r['t0']], set()).add(code)
    rally_set = {(m['code'], m['t0']) for m in rally_meta}
    near = {}
    for m in rally_meta:
        near.setdefault(m['code'], []).append(m['t0'])
    rng = np.random.default_rng(SEED)
    for m in rally_meta:
        rows.append(('rally', m['code'], m['t0']))
    pos_of = {code: {d: i for i, d in enumerate(df.d)} for code, df in data.items()}
    codes = list(data)
    if CONTROL == 'trough':
        rows += [('control', code, i) for code, i in failed]
    for d in (sorted(rally_days) if CONTROL != 'trough' else []):
        picked = 0
        for code in rng.permutation(codes):
            if picked >= CTRL_PER_DAY:
                break
            i = pos_of[code].get(d)
            if i is None or i < PRE + 120:
                continue
            if any(abs(i - t) <= RALLY_MAX_BARS for t in near.get(code, [])):
                continue
            if not (feats[code][0].amt20.iat[i] >= MIN_AMT):
                continue
            rows.append(('control', code, i))
            picked += 1
    recs, paths = [], []
    for kind, code, i in rows:
        f, atr = feats[code]
        if not (f.amt20.iat[i] >= MIN_AMT):
            continue
        df = data[code]
        c = df.c.values.astype(float)
        atrp = atr[i] / c[i] if np.isfinite(atr[i]) and atr[i] > 0 else np.nan
        if not np.isfinite(atrp):
            continue
        # 모양은 크기(변동성)가 아니라 형태로 묶는다: 경로를 T0의 ATR%로 나눈 ATR 단위
        p = path(c, i, atrp if UNIT == 'atr' else 1.0)
        if p is None:
            continue
        rec = {'kind': kind, 'code': code, 'd': df.d.iat[i], 'atrp': atrp}
        for k in FEATURES[:-1]:
            rec[k] = f[k].iat[i]
        if np.isfinite(atr[i]) and atr[i] > 0:
            rec['rising'] = float(floor_geometry(df.l.values[i - 119:i + 1].astype(float), df.h.values[i - 119:i + 1].astype(float), atr[i])[0])
        recs.append(rec)
        paths.append(p)
    t = pd.DataFrame(recs)
    P = np.array(paths)
    is_r = (t.kind == 'rally').values
    res = {'params': dict(UNIT=UNIT, RALLY_ATR=RALLY_ATR, FAIL_ATR=FAIL_ATR, CONTROL=CONTROL, FAIL_GAIN=FAIL_GAIN, RALLY_GAIN=RALLY_GAIN, RALLY_MAX_BARS=RALLY_MAX_BARS, PRE=PRE, K=K, CTRL_PER_DAY=CTRL_PER_DAY, MIN_AMT=MIN_AMT),
           'counts': {'rallies': int(is_r.sum()), 'controls': int((~is_r).sum()), 'stocks': len(data),
                      'date_range': [str(t.d.min()), str(t.d.max())]}}
    rm = pd.DataFrame(rally_meta)
    rm = rm[rm.apply(lambda x: (x.code, x.d) in set(zip(t[is_r].code, t[is_r].d)), axis=1)]
    res['rally_shape'] = {'gain_median': round(float(rm.gain.median()) * 100, 1), 'bars_median': float(rm.bars.median()),
                          'gain_q75': round(float(rm.gain.quantile(.75)) * 100, 1)}
    reg, src = regime_by_date(t.d.values, pd.concat([df.assign(code=code)[['d', 'code', 'c']].rename(columns={'c': 'close'})
                                                      for code, df in data.items()], ignore_index=True))
    t['regime'] = reg
    res['regime_source'] = src
    res['by_regime'] = {str(g): {'rallies': int(((t.regime == g) & is_r).sum()), 'controls': int(((t.regime == g) & ~is_r).sum())}
                        for g in ('상승', '횡보', '하락')}
    # 피처: 같은 날 대조군 기준 5분위 경계로 나눠 lift
    lifts = {}
    for k in FEATURES:
        x = t[k]
        if k == 'rising':
            a, b = x[is_r].mean(), x[~is_r].mean()
            lifts[k] = {'rally_share': round(float(a) * 100, 1), 'control_share': round(float(b) * 100, 1), 'lift': round(float(a / b), 2) if b else None}
            continue
        ok = x.notna()
        if ok.sum() < 50:
            continue
        if k in ('e_turn', 'evw_earn', 'evw_contract', 'evw_any', 'evp_any'):  # 0/1 피처: 5분위 대신 비율 비교, ATR% 3분위 통제
            vq = np.digitize(t.atrp, np.nanquantile(t.atrp, [1 / 3, 2 / 3]))
            a, b = x[is_r & ok].mean(), x[~is_r & ok].mean()
            num = den = 0.0
            for g in range(3):
                m_r, m_c = is_r & ok & (vq == g), ~is_r & ok & (vq == g)
                if m_r.sum() >= 20 and m_c.sum() >= 20 and x[m_c].mean() > 0:
                    num += m_r.sum() * x[m_r].mean() / x[m_c].mean()
                    den += m_r.sum()
            lifts[k] = {'rally_share': round(float(a) * 100, 1), 'control_share': round(float(b) * 100, 1),
                        'lift': round(float(a / b), 2) if b else None, 'max_lift_volctl': round(float(num / den), 2) if den else None,
                        'n_rally': int((is_r & ok).sum()), 'n_control': int((~is_r & ok).sum())}
            continue
        edges = np.nanquantile(x[ok & ~is_r], [.2, .4, .6, .8])
        q = np.digitize(x, edges)
        cells = []
        for j in range(5):
            a = ((q == j) & is_r & ok).sum() / max((is_r & ok).sum(), 1)
            b = ((q == j) & ~is_r & ok).sum() / max((~is_r & ok).sum(), 1)
            cells.append({'q': j + 1, 'rally_share': round(a * 100, 1), 'lift': round(a / b, 2) if b else None})
        # 변동성 통제: ATR% 3분위 안에서 같은 5분위 비율을 비교해 상승 구간 수로 가중 평균
        vq = np.digitize(t.atrp, np.nanquantile(t.atrp, [1 / 3, 2 / 3]))
        ctl = []
        for j in range(5):
            num = den = 0.0
            for b in range(3):
                m_r, m_c = is_r & ok & (vq == b), ~is_r & ok & (vq == b)
                if m_r.sum() < 20 or m_c.sum() < 20:
                    continue
                a = ((q == j) & m_r).sum() / m_r.sum()
                bb = ((q == j) & m_c).sum() / m_c.sum()
                if bb > 0:
                    num += m_r.sum() * a / bb
                    den += m_r.sum()
            ctl.append(round(float(num / den), 2) if den else None)
        lifts[k] = {'median_rally': round(float(x[is_r].median()), 4), 'median_control': round(float(x[~is_r].median()), 4),
                    'quintiles': cells, 'max_lift': max(c['lift'] or 0 for c in cells), 'lift_volctl': ctl,
                    'max_lift_volctl': max([v for v in ctl if v is not None] or [0])}
    res['features'] = dict(sorted(lifts.items(), key=lambda kv: -(kv[1].get('max_lift_volctl') or kv[1].get('lift') or 0)))
    res['atrp_median'] = {'rally': round(float(t.atrp[is_r].median()) * 100, 2), 'control': round(float(t.atrp[~is_r].median()) * 100, 2)}
    # 모양 원형: PCA(설명력) + k-평균, 같은 공간에서 상승/대조 비율
    Pc = P - P.mean(0)
    _, s, _ = np.linalg.svd(Pc, full_matrices=False)
    res['pca_explained'] = [round(float(x), 3) for x in (s ** 2 / (s ** 2).sum())[:5]]
    lab_, cent = kmeans(P, K)
    idx = np.linspace(0, PRE - 1, 10).astype(int)
    arche = []
    for j in range(K):
        a = ((lab_ == j) & is_r).sum() / max(is_r.sum(), 1)
        b = ((lab_ == j) & ~is_r).sum() / max((~is_r).sum(), 1)
        arche.append({'id': j, 'rally_share': round(a * 100, 1), 'control_share': round(b * 100, 1), 'lift': round(a / b, 2) if b else None,
                      'n_min_side': int(min(((lab_ == j) & is_r).sum(), ((lab_ == j) & ~is_r).sum())),
                      ('path_atr_vs_T0' if UNIT == 'atr' else 'path_pct_vs_T0'):
                          [round(float(cent[j][i]), 1) if UNIT == 'atr' else round(float(np.exp(cent[j][i]) - 1) * 100, 1) for i in idx]})
    res['archetypes'] = sorted(arche, key=lambda x: -(x['lift'] or 0))
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
    print(json.dumps({k: res[k] for k in ('params', 'counts', 'rally_shape', 'atrp_median', 'regime_source', 'by_regime', 'pca_explained')}, ensure_ascii=False))
    print('모양 원형(상승 비율 / 실패 비율 / lift / 적은 쪽 n / T0 대비 직전 경로, ATR 단위면 ATR 배수):')
    for a in res['archetypes']:
        print(' ', a['id'], a['rally_share'], a['control_share'], a['lift'], a['n_min_side'], a.get('path_atr_vs_T0') or a.get('path_pct_vs_T0'))
    print('피처(변동성 통제 최대 lift / 통제 전 / 5분위별 통제 lift / 상승·실패 중앙값):')
    for k, v in res['features'].items():
        print(' ', k, v.get('max_lift_volctl', v.get('lift')), v.get('max_lift'), v.get('lift_volctl'), v.get('median_rally'), v.get('median_control'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
