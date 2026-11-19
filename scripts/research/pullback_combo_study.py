# -*- coding: utf-8 -*-
"""상승 구간 해부 2단계: 남은 세 신호 조합을 '관측 가능한 날'에 사서 검증 (연구 전용, 실전·주문 연결 없음 - 2026-11-19).

근거: docs/RALLY_ANATOMY_STUDY_2026-11-19.md v2 — 바닥 시점 모양은 구분력이 약하고, 남은 약한 방향은
  (1) 60일 추세 생존  (2) 20일선 아래 적당한 눌림  (3) 거래 마름. 이는 기존 승격 후보 quietLeaderPullback과 같은 그림이다.
여기서는 바닥을 사후에 고르지 않는다. 신호일 t 종가까지의 값으로만 조건을 판정하고 t+1 시가에 산다.

조건(t 종가까지, 날짜별 백분위는 그날 전 종목 기준):
  TREND  60일선 기울기(20일 전 대비) 날짜 백분위 >= 0.6 이고 과거 60봉 수익률(mom60, t 종가까지) > 0
  DIP    (종가/20일선 - 1) / (ATR14/종가) 가 -3 ~ -1 ATR (적당한 눌림; 해부 v2에서 가장 깊은 쪽·얕은 쪽은 불리)
  DRY    최근 10봉 거래량 중앙값 / 60봉 중앙값 날짜 백분위 <= 0.3
  TRIO   TREND & DIP & DRY,  TRIO_TURN = TRIO & 당일 양봉 마감(종가 > 전일 종가, 반등 시작 관측)
  QLP    기존 quietLeaderPullback 재현: 거래대금(20일) 날짜 백분위 > 0.85 & 조용함 점수 백분위 > 0.7
         (조용함 = (1-ivol60 백분위)+(1-upvol20 백분위) 재백분위, shape_scan.js QUIET와 같은 식) & 120봉 모양 pullback/rebound
         (모양은 사이트 공통 js/auto-wave.js shapeOf를 shape_edge_batch.js로 돌린 TSV 재사용. ivol60은 유니버스 동일가중 시장수익률 기준)
결과:
  ret20/ret60·ex20/ex60(같은 날 유니버스 평균 대비), t값은 날짜 군집(날짜별 평균 초과수익의 t)으로 계산해 겹침 과대를 줄인다.
  매매 규칙 exit-v1(기존 EXIT_PLAN): 손절 -10%, +10% 도달 뒤 종가 < 20일선이면 다음 시가 매도, 최대 60거래일, 비용 0.7%.
  같은 종목은 보유 중 재진입 금지(독립 매매). 승률·평균·손익비·Profit Factor·최대 연속 손실.
국면: SPRING_INDEX(KOSPI) 60일선 상승/횡보/하락. 사용자 원칙 '하락장은 무엇을 해도 떨어진다' -> 상승+횡보 진입만 따로 보고.
2단계(2026-11-19): 캐시에 flow(외국인·기관·개인 순매수)와 px[6] 외국인 소진율이 있으면 FLOW·FOREIGN·ORGAN·FR 및 QLP 결합 그룹을 추가한다.
3단계(2026-11-19): <작업 폴더>/earn.json(fetch_dart_quarterly_cache.py, 환경변수 EARN_FILE로 변경)이 있으면 DART 분기 실적 그룹
  EARN(영업이익 YoY 상위30%)·EARN_REV(매출 YoY 상위30%)·TURN(흑자 전환)·EARN_FRESH(EARN & 접수 20거래일 이내)와 QLP 결합을 추가한다.
4단계(2026-11-19): <작업 폴더>/events.json(fetch_dart_events_cache.py, EVENTS_FILE)이 있으면 공시 사건 그룹을 추가한다.
  신호일 = 접수일(휴장이면 다음 거래일) j의 다음 거래일 s. 반응 = (c[s]/c[j-1]-1)/(ATR14[j-1]/c[j-1]) (2일, ATR 배수). s+1 시가 매수.
5단계(2026-11-19): 오르기 시작한 뒤 따라붙기·업종 먼저. t 종가까지:
  rs120 = 120봉 수익률(날짜 백분위), up_low120 = 종가 / 120봉 최저가 - 1, nh250 = 종가 > 직전 250봉 최고가(52주 신고가 돌파).
  업종 = WICS industry(<작업 폴더>/wics.json 또는 WICS_FILE, 현재 분류 고정 - 과거 재분류 미반영 한계).
  업종 강도 = 그날 같은 업종(유동성 통과 5종목 이상) mom60 평균의 업종 간 백분위, 주도주 = 그 업종 안 20일 거래대금 1~2위.
실행: python pullback_combo_study.py <작업 폴더(cache/)> <shape.tsv> <out.json>   (SPRING_START, SPRING_SPLIT, SPRING_INDEX 공용)
"""
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spring_index_study import atr14, regime_by_date  # noqa: E402

COST = 0.007
MIN_AMT = 3e9


def flow_cols(dates, v, flow, fr=None):
    """2단계 수급 피처(t 종가까지). flow: {YYYYMMDD: [외국인, 기관, 개인] 순매수 주식 수}, fr: 외국인 소진율(%) 배열.
    f20/o20 = 20일 순매수 합 / 20일 거래량, fo60 = 외국인+기관 60일 / 60일 거래량, dfr20 = 외국인 소진율 20일 변화(%p).
    결측일이 창의 10%를 넘으면 NaN(0으로 채우지 않는다)."""
    out = pd.DataFrame(index=range(len(dates)))
    if not flow:
        for k in ('f20', 'o20', 'fo60', 'dfr20'):
            out[k] = np.nan
        return out
    fo = np.array([(flow.get(d) or [None, None])[0] for d in dates], dtype=float)
    og = np.array([(flow.get(d) or [None, None])[1] for d in dates], dtype=float)
    vs = pd.Series(v)
    for name, x, w in (('f20', fo, 20), ('o20', og, 20), ('fo60', fo + og, 60)):
        xs = pd.Series(x)
        ok = xs.notna().rolling(w).sum() >= 0.9 * w
        out[name] = (xs.rolling(w, min_periods=int(0.9 * w)).sum() / vs.rolling(w).sum()).where(ok)
    out['dfr20'] = (pd.Series(fr, dtype=float) - pd.Series(fr, dtype=float).shift(20)) if fr is not None else np.nan
    return out


EARN_KEYS = ('e_op_sym', 'e_rev_yoy', 'e_opm_chg', 'e_turn', 'e_age')
EARN_STALE = 200  # 가용일 뒤 이 거래일이 지나면 최신 실적이 아니라 결측으로 본다(다음 보고서 누락)


def load_earn(path):
    """fetch_dart_quarterly_cache.py build 결과(earn.json). 없으면 빈 dict."""
    if path and os.path.exists(path):
        return json.load(open(path, encoding='utf-8'))
    return {}


def earn_cols(dates, rows):
    """3단계 실적 피처(2026-11-19). rows: [[접수일, 연도, 보고서, fs, rev, rev_p, op, op_p, ni, ni_p], ...] 접수일 오름차순.
    t일에는 접수일 < t 인 마지막 보고서만 쓴다(접수일 당일 장후 공시 가능성 때문에 다음 날부터).
    e_op_sym  = 영업이익 3개월 전년 동기 대비 대칭 변화 (a-b)/((|a|+|b|)/2), -2~2 (적자 기저에도 안정)
    e_rev_yoy = 매출 3개월 전년 동기 대비 증가율 (전년 매출 > 0일 때)
    e_opm_chg = 영업이익률 변화 %p (op/rev - op_p/rev_p)
    e_turn    = 영업이익 흑자 전환(전년 동기 <= 0 이고 이번 > 0) 1/0
    e_age     = 그 보고서가 알려진 뒤 지난 거래일 수(0 = 접수 다음 날)"""
    n = len(dates)
    out = pd.DataFrame(index=range(n), columns=list(EARN_KEYS), dtype=float)
    if not rows:
        return out
    j, cur, since = 0, None, None
    for i, d in enumerate(dates):
        while j < len(rows) and rows[j][0] < d:
            cur, since = rows[j], i
            j += 1
        if cur is None or i - since > EARN_STALE:
            continue
        rev, rev_p, op, op_p = cur[4], cur[5], cur[6], cur[7]
        if op is not None and op_p is not None and (abs(op) + abs(op_p)) > 0:
            out.iat[i, 0] = (op - op_p) / ((abs(op) + abs(op_p)) / 2)
            out.iat[i, 3] = 1.0 if (op_p <= 0 < op) else 0.0
        if rev is not None and rev_p is not None and rev_p > 0:
            out.iat[i, 1] = rev / rev_p - 1
            if op is not None and op_p is not None and rev > 0:
                out.iat[i, 2] = (op / rev - op_p / rev_p) * 100
        out.iat[i, 4] = i - since
    return out


EV_KINDS = ('earn', 'contract', 'buyback', 'bonus', 'facility', 'rights')
EV_UP_ATR = 1.0  # 긍정 반응 = 2일 반응 >= 1 ATR (변동성 단위, 고정 %가 아님)


def event_cols(dates, c, atr, events):
    """4단계 공시 사건 피처(2026-11-19). events: [[접수일, 유형], ...].
    ev_<유형>  : 그 유형 사건의 신호일 s에만 2일 반응(ATR 배수), 그 외 NaN. s일 종가까지만 사용.
    ev_up20    : 최근 20거래일(신호일 기준, 오늘 포함) 안에 rights 외 사건이 긍정 반응(>= EV_UP_ATR)으로 신호됐으면 1, 아니면 0.
    사후 서술용(rally 전용, 미래 포함 - 매매 판정에 쓰지 않음):
    evw_<earn|contract|any> : 접수 거래일 j가 [i-5, i+10] 안이면 1,  evp_any : j가 [i-20, i] 안이면 1."""
    n = len(dates)
    out = {('ev_' + k): np.full(n, np.nan) for k in EV_KINDS}
    up = np.zeros(n)
    jw = {k: [] for k in ('earn', 'contract', 'any')}
    if events is None:
        for k in ('ev_up20', 'evw_earn', 'evw_contract', 'evw_any', 'evp_any'):
            out[k] = np.full(n, np.nan)
        return pd.DataFrame(out)
    idx = np.searchsorted(np.asarray(dates), [e[0] for e in events], side='left')
    for (d, kind), j in zip(events, idx):
        if j >= n or kind not in EV_KINDS:
            continue
        if kind != 'rights':
            jw['any'].append(j)
        if kind in jw:
            jw[kind].append(j)
        s = j + 1
        if j < 1 or s >= n or not (atr[j - 1] > 0) or not (c[j - 1] > 0):
            continue
        r = (c[s] / c[j - 1] - 1) / (atr[j - 1] / c[j - 1])
        col = out['ev_' + kind]
        col[s] = r if np.isnan(col[s]) else max(col[s], r)
        if kind != 'rights' and r >= EV_UP_ATR:
            up[s:min(s + 20, n)] = 1.0
    out['ev_up20'] = up
    for k, js in jw.items():
        w = np.zeros(n)
        for j in js:
            w[max(j - 10, 0):min(j + 6, n)] = 1.0  # i in [j-10, j+5]  <=>  j in [i-5, i+10]
        out['evw_' + k] = w
    p = np.zeros(n)
    for j in jw['any']:
        p[j:min(j + 21, n)] = 1.0  # i in [j, j+20]  <=>  j in [i-20, i]
    out['evp_any'] = p
    return pd.DataFrame(out)


def load_events(path):
    if path and os.path.exists(path):
        return json.load(open(path, encoding='utf-8'))
    return None


def frame(code, px, mret, flow=None, earn=None, events=None):
    df = pd.DataFrame([r[:6] for r in px], columns=['d', 'o', 'h', 'l', 'c', 'v'])
    o, h, l, c, v = (df[k].values.astype(float) for k in 'ohlcv')
    cs, vs = pd.Series(c), pd.Series(v)
    f = pd.DataFrame({'d': df.d, 'code': code})
    f['amt20'] = (cs * vs).rolling(20).mean()
    atr = atr14(h, l, c)
    ma20, ma60 = cs.rolling(20).mean(), cs.rolling(60).mean()
    f['ma60_slope'] = ma60 / ma60.shift(20) - 1
    # v1 버그(2026-11-19): 과거 60봉 수익률을 'ret60'에 넣고 아래에서 같은 이름에 미래 60일 수익률을 덮어써
    # TREND가 미래 수익을 조건으로 썼다. 과거 값은 mom60으로 분리한다.
    f['mom60'] = cs / cs.shift(60) - 1
    f['dip_atr'] = (cs / ma20 - 1) / (atr / c)
    f['dry10'] = vs.rolling(10).median() / vs.rolling(60).median()
    r = cs.pct_change()
    m = pd.Series(df.d.map(mret).values)
    f['ivol60'] = (r - m).rolling(60).std()
    f['upvol20'] = vs.where(cs > cs.shift(1), 0).rolling(20).sum() / vs.rolling(20).sum()
    f['upday'] = c > np.r_[np.nan, c[:-1]]
    f['rs120'] = cs / cs.shift(120) - 1
    f['up_low120'] = cs / pd.Series(l).rolling(120).min() - 1
    f['nh250'] = (cs > pd.Series(h).shift(1).rolling(250).max()).values
    fr = [r[6] if len(r) > 6 else None for r in px]
    fl = flow_cols(list(df.d), v, flow, fr if any(x is not None for x in fr) else None)
    for k in fl.columns:
        f[k] = fl[k].values
    ec = earn_cols(list(df.d), earn)
    for k in ec.columns:
        f[k] = ec[k].values
    ev = event_cols(list(df.d), c, atr, events)
    for k in ev.columns:
        if not k.startswith(('evw_', 'evp_')):  # 미래 포함 서술용 열은 매매 표에 넣지 않는다
            f[k] = ev[k].values
    n = len(c)
    res = np.full((n, 4), np.nan)
    trade = [None] * n
    m20 = ma20.values
    for i in range(n - 61):
        e = o[i + 1]
        if e <= 0:
            continue
        res[i, 0] = c[i + 20] / e - 1 - COST
        res[i, 1] = c[i + 60] / e - 1 - COST
        # exit-v1: 손절 -10%(장중 저가 기준, 같은 날 우선), +10% 도달 뒤 종가 < 20일선 -> 다음 시가, 최대 60봉 종가
        hit10, out, days = False, None, 0
        for k in range(i + 1, min(i + 61, n)):
            days = k - i
            if l[k] <= e * 0.9:
                out = e * 0.9
                break
            if h[k] >= e * 1.1:
                hit10 = True
            if hit10 and c[k] < m20[k] and k + 1 < n:
                out = o[k + 1]
                days += 1
                break
        if out is None:
            out = c[min(i + 60, n - 1)]
        trade[i] = (out / e - 1 - COST, days)
    f['ret20'], f['ret60'] = res[:, 0], res[:, 1]
    f['trade'] = [t[0] if t else np.nan for t in trade]
    f['hold'] = [t[1] if t else np.nan for t in trade]
    return f


def dedupe(g):
    """같은 종목 보유 중 재진입 금지: 신호일 + 보유일수 안의 다음 신호는 버린다."""
    keep, until = [], {}
    for idx, row in g.sort_values('d').iterrows():
        if row.code in until and row.i_ <= until[row.code]:
            continue
        keep.append(idx)
        until[row.code] = row.i_ + (row.hold if np.isfinite(row.hold) else 60)
    return g.loc[keep]


def stats(g, trades=True):
    if not len(g):
        return {'n': 0}
    daily = g.groupby('d').ex20.mean()
    out = {'n': int(len(g)), 'days': int(daily.size), 'win20': round(float((g.ret20 > 0).mean()) * 100, 1),
           'ret20': round(float(g.ret20.mean()) * 100, 2), 'ex20': round(float(g.ex20.mean()) * 100, 2),
           'ex20_t_by_date': round(float(daily.mean() / (daily.std() / np.sqrt(daily.size))), 2) if daily.size > 2 and daily.std() > 1e-9 else None,
           'ex60': round(float(g.ex60.mean()) * 100, 2)}
    if trades:
        t = dedupe(g)
        tr = t.trade.dropna()
        if len(tr):
            wins, losses = tr[tr > 0], tr[tr <= 0]
            streak = run = 0
            for x in tr:
                run = run + 1 if x <= 0 else 0
                streak = max(streak, run)
            out.update(trades=int(len(tr)), trade_win=round(float((tr > 0).mean()) * 100, 1), trade_avg=round(float(tr.mean()) * 100, 2),
                       payoff=round(float(wins.mean() / -losses.mean()), 2) if len(wins) and len(losses) and losses.mean() < 0 else None,
                       pf=round(float(wins.sum() / -losses.sum()), 2) if len(losses) and losses.sum() < 0 else None,
                       max_loss_streak=int(streak), hold_med=float(t.hold.median()))
    return out


def main(lab, shape_tsv, out_path):
    warnings.filterwarnings('ignore')
    data, flows = {}, {}
    earn = load_earn(os.environ.get('EARN_FILE', os.path.join(lab, 'earn.json')))
    events = load_events(os.environ.get('EVENTS_FILE', os.path.join(lab, 'events.json')))
    wics = load_events(os.environ.get('WICS_FILE', os.path.join(lab, 'wics.json'))) or {}
    for fn in sorted(os.listdir(os.path.join(lab, 'cache'))):
        if fn.endswith('.json'):
            px = [r for r in json.load(open(os.path.join(lab, 'cache', fn), encoding='utf-8'))['px'] if r[1] > 0 and r[4] > 0]
            if len(px) >= 200:
                data[fn[:-5]] = px
                flows[fn[:-5]] = json.load(open(os.path.join(lab, 'cache', fn), encoding='utf-8')).get('flow')
    closes = pd.DataFrame({code: pd.Series({r[0]: r[4] for r in px}) for code, px in data.items()}).sort_index()
    mret = closes.pct_change().mean(axis=1).to_dict()
    frames = []
    for code, px in data.items():
        f = frame(code, px, mret, flows.get(code), earn.get(code), None if events is None else events.get(code, []))
        f['i_'] = np.arange(len(f))
        frames.append(f)
    df = pd.concat(frames, ignore_index=True)
    sh = pd.read_csv(shape_tsv, sep='\t', dtype={'code': str, 'd': str}, usecols=['code', 'd', 't120'])
    df = df.merge(sh, on=['code', 'd'], how='left')
    start = os.environ.get('SPRING_START', '20210101')
    split1, split2 = os.environ.get('SPRING_SPLIT', '20231231,20250630').split(',')
    df = df[(df.d >= start) & (df.amt20 >= MIN_AMT) & df.ret20.notna() & df.ma60_slope.notna() & df.ivol60.notna()]
    df['period'] = np.select([df.d <= split1, df.d <= split2], ['train', 'valid'], 'test')
    df['ex20'] = df.ret20 - df.groupby('d').ret20.transform('mean')
    df['ex60'] = df.ret60 - df.groupby('d').ret60.transform('mean')
    for k in ('ma60_slope', 'dry10', 'amt20', 'ivol60', 'upvol20', 'f20', 'o20', 'fo60', 'dfr20', 'e_op_sym', 'e_rev_yoy', 'rs120'):
        df['p_' + k] = df.groupby('d')[k].rank(pct=True)
    df['quiet_raw'] = (1 - df.p_ivol60) + (1 - df.p_upvol20)
    df['p_quiet'] = df.groupby('d').quiet_raw.rank(pct=True)
    long = closes.stack().rename('close').reset_index().rename(columns={'level_0': 'd', 'level_1': 'code'})
    df['regime'], src = regime_by_date(df.d.values, long)
    TREND = (df.p_ma60_slope >= .6) & (df.mom60 > 0)
    DIP = df.dip_atr.between(-3, -1)
    DRY = df.p_dry10 <= .3
    TRIO = TREND & DIP & DRY
    QLP = (df.p_amt20 > .85) & (df.p_quiet > .7) & df.t120.isin(['pullback', 'rebound'])
    groups = {'아무 종목': df.index == df.index, 'TREND 60일 추세': TREND, 'DIP 적당한 눌림': DIP, 'DRY 거래 마름': DRY,
              'TREND&DIP': TREND & DIP, 'TRIO': TRIO, 'TRIO_TURN(양봉 반등)': TRIO & df.upday,
              'QLP 주도주 조용한 눌림(기존)': QLP, 'QLP & TRIO': QLP & TRIO, 'QLP & DIP': QLP & DIP}
    # 2단계 수급(2026-11-19): 외국인·기관 순매수 상위 30%(날짜 백분위). 수급 자료가 있는 날만 해당.
    FLOW = (df.p_fo60 >= .7)
    FFR = (df.p_dfr20 >= .7)
    if df.fo60.notna().any():
        groups.update({'FLOW 외국인+기관 60일 순매수 상위30%': FLOW, 'FOREIGN 외국인 20일 순매수 상위30%': df.p_f20 >= .7,
                       'ORGAN 기관 20일 순매수 상위30%': df.p_o20 >= .7, 'QLP & FLOW': QLP & FLOW})
    if df.dfr20.notna().any():
        groups.update({'FR 외국인 소진율 20일 증가 상위30%': FFR, 'QLP & FR': QLP & FFR})
    # 3단계 실적(2026-11-19): 접수 다음 날부터 쓰는 DART 분기 실적. 실적 자료가 있는 종목·날만 해당.
    if df.e_op_sym.notna().any():
        EARN = df.p_e_op_sym >= .7
        EARN_FRESH = EARN & (df.e_age <= 20)
        groups.update({'EARN 영업이익 YoY 상위30%': EARN, 'EARN_REV 매출 YoY 상위30%': df.p_e_rev_yoy >= .7,
                       'TURN 영업이익 흑자전환': df.e_turn == 1, 'EARN_FRESH 실적개선 접수 20일 이내': EARN_FRESH,
                       'QLP & EARN': QLP & EARN, 'QLP & EARN_FRESH': QLP & EARN_FRESH})
    # 4단계 공시 사건(2026-11-19): 신호일 s = 접수 거래일 다음 날, s 종가까지의 2일 반응으로 판정, s+1 시가 매수.
    if events is not None:
        evk = ['ev_' + k for k in EV_KINDS if k != 'rights']
        ANY_UP = (df[evk].max(axis=1) >= EV_UP_ATR)
        groups.update({'EV_EARN 잠정실적 공시': df.ev_earn.notna(), 'EV_EARN_UP 잠정실적 긍정반응': df.ev_earn >= EV_UP_ATR,
                       'EV_CONTRACT 공급계약 공시': df.ev_contract.notna(), 'EV_CONTRACT_UP 공급계약 긍정반응': df.ev_contract >= EV_UP_ATR,
                       'EV_BUYBACK 자사주 취득': df.ev_buyback.notna(), 'EV_BONUS 무상증자': df.ev_bonus.notna(),
                       'EV_FACILITY 시설투자': df.ev_facility.notna(), 'EV_RIGHTS 유상증자(참고)': df.ev_rights.notna(),
                       'EV_ANY_UP 사건 긍정반응': ANY_UP, 'QLP & EV_UP20 최근20일 긍정사건': QLP & (df.ev_up20 == 1)})
    # 5단계(2026-11-19): 오르기 시작한 뒤 따라붙기 + 주도 업종의 주도주.
    if wics:
        df['ind'] = df.code.map(lambda x: (wics.get(x) or {}).get('industry'))
        g = df[df.ind.notna()].groupby(['d', 'ind'])
        ind = g.mom60.agg(['mean', 'size']).reset_index()
        ind = ind[ind['size'] >= 5]
        ind['p_ind'] = ind.groupby('d')['mean'].rank(pct=True)
        df = df.merge(ind[['d', 'ind', 'p_ind']], on=['d', 'ind'], how='left')
        df['lead'] = df.groupby(['d', 'ind']).amt20.rank(ascending=False, method='first')
        MOM = (df.up_low120 >= .3) & (df.p_rs120 >= .9)
        NH = df.nh250 == True  # noqa: E712
        LEAD = (df.p_ind >= .8) & (df.lead <= 2)
        groups.update({'MOM 저점+30% & RS120 상위10%': MOM, 'NH 52주 신고가 돌파': NH, 'MOM & NH': MOM & NH,
                       'SEC_LEAD 주도업종 주도주': LEAD, 'SEC_LEAD & NH 주도업종 주도주 신고가': LEAD & NH,
                       'SEC_LEAD & MOM': LEAD & MOM})
        groups = {k: m.values if hasattr(m, 'values') else m for k, m in groups.items()}
    up_side = df.regime.isin(['상승', '횡보'])
    res = {'regime_source': src, 'shape_coverage': round(float(df.t120.notna().mean()) * 100, 1),
           'earn_coverage': round(float(df.e_op_sym.notna().mean()) * 100, 1),
           'periods': {p: [str(df[df.period == p].d.min()), str(df[df.period == p].d.max())] for p in ('train', 'valid', 'test')},
           'all_regimes': {k: {p: stats(df[m & (df.period == p)]) for p in ('train', 'valid', 'test')} for k, m in groups.items()},
           'up_sideways': {k: {p: stats(df[m & up_side & (df.period == p)]) for p in ('train', 'valid', 'test')} for k, m in groups.items()}}
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
    print('국면:', src, '· 모양 TSV 적용률 %:', res['shape_coverage'], '· 기간:', res['periods'])
    cols = ['n', 'days', 'win20', 'ex20', 'ex20_t_by_date', 'ex60', 'trades', 'trade_win', 'trade_avg', 'payoff', 'pf', 'max_loss_streak']
    pd.set_option('display.width', 260)
    pd.set_option('display.max_rows', 100)
    for key in ('up_sideways', 'all_regimes'):
        rows = [dict(그룹=k, 기간=p, **{c: v.get(c) for c in cols}) for k, d in res[key].items() for p, v in d.items()]
        print('\n==', '상승+횡보 진입' if key == 'up_sideways' else '전체 국면', '==')
        print(pd.DataFrame(rows).set_index(['그룹', '기간']))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
