# -*- coding: utf-8 -*-
"""상승 전 선행 특성 탐색 — 가격 지표 vs 수급(외국인·기관·개인) 연구 (연구용, 실전 연결 없음 - 2026-11-13).

질문: "주가가 오르기 전에 분명한 특정 행동이 있는가? 숫자 1~2개로 줄일 수 있는가?"
선행 연구(docs/SURGE_PRECURSOR_STUDY_2026-10-18.md)는 일봉만으로는 방향 신호가 없다고 결론냈고, 다음 단계로 수급 자료를 제안했다.

자료: fetch_naver_flow_cache.py 캐시(종목별 OHLCV+외국인소진율, 일별 외국인·기관·개인 순매수 주식 수).
설계(미래 비참조):
  - 피처는 t일 종가·t일 확정 수급까지. 진입 t+1 시가, 청산 t+h 종가 (h=5, 20).
  - 목표 = 같은 날짜 유니버스 평균을 뺀 초과수익(시장 국면 제거) + 비용 0.7% 차감 절대수익(승률).
  - 유니버스: 20일 평균 거래대금 30억원 이상, 종가 1,000원 이상, 250봉 이력.
  - 날짜별 백분위로 바꾼 뒤 5분위/10분위 비교와 순위 IC(Spearman). 겹침 제거: h일마다 한 날짜만 써서 t값 계산.
  - 기간: 학습 2021-10~2023-12 / 검증 2024-01~2025-06 / 시험 2025-07~ (시험은 마지막에 한 번만 본다).
  - 다중비교: 단일 피처 + 2개 조합 격자 전부를 본 뒤 학습 t값에 Benjamini-Hochberg(FDR 10%) 보정, 검증·시험 같은 방향만 인정.
  - 비선형: LightGBM(학습 적합·검증 조기종료) → 시험 기간 상위 10%/1% 성과.
한계: 생존 편향(현재 상장 종목만), 기관 순매수는 금융투자·연기금 등 합계, 수급 공표 시각(장 마감 후)을 t일 종가 뒤로 가정.
실행: python edge_factor_study.py <작업 폴더(cache/ 포함)> <out.json>
"""
import json
import os
import sys

import numpy as np
import pandas as pd

MIN_AMOUNT = 3e9
COST = 0.007
H = (5, 20)
TRAIN = ('2021-10-01', '2023-12-31')
VALID = ('2024-01-01', '2025-06-30')
TEST = ('2025-07-01', '2099-12-31')
CUTOFF = '2026-11-13'  # 당일(장중·미확정) 제외

PRICE_FEATS = ['mom12_1', 'mom6', 'rev5', 'rev20', 'd52h', 'd52l', 'vcomp', 'bbw', 'rsi14', 'bb_pctb',
               'ma20d', 'ma60d', 'ma224d', 'ichi', 'vsurge', 'upvol20', 'ivol60', 'illiq', 'logamt']
FLOW_FEATS = ['f5', 'f20', 'f60', 'o5', 'o20', 'o60', 'i20', 'fo_streak', 'dfr20', 'fo20']
FEATS = PRICE_FEATS + FLOW_FEATS
LABEL = {
    'mom12_1': '12-1개월 모멘텀', 'mom6': '6개월 수익률', 'rev5': '5일 수익률', 'rev20': '20일 수익률',
    'd52h': '52주 고가 대비 위치', 'd52l': '52주 저가 대비 위치', 'vcomp': '변동성 압축(ATR10/ATR120)',
    'bbw': '볼린저 폭/120일 평균', 'rsi14': 'RSI14', 'bb_pctb': '볼린저 %b', 'ma20d': '20일선 이격',
    'ma60d': '60일선 이격', 'ma224d': '224일선 이격', 'ichi': '일목 구름 대비 위치(ATR)', 'vsurge': '거래량 5일/60일',
    'upvol20': '20일 상승일 거래량 비중', 'ivol60': '60일 고유 변동성', 'illiq': '비유동성(Amihud)',
    'logamt': '거래대금 규모(log)', 'f5': '외국인 5일 순매수/거래량', 'f20': '외국인 20일 순매수/거래량',
    'f60': '외국인 60일 순매수/거래량', 'o5': '기관 5일 순매수/거래량', 'o20': '기관 20일 순매수/거래량',
    'o60': '기관 60일 순매수/거래량', 'i20': '개인 20일 순매수/거래량', 'fo_streak': '외국인+기관 동시 순매수 연속일',
    'dfr20': '외국인 지분율 20일 변화(%p)', 'fo20': '외국인+기관 20일 순매수/거래량',
}


def rsum(x, w):
    return x.rolling(w, min_periods=w).sum()


def stock_frame(code, data):
    px = [r for r in data['px'] if r[0] < CUTOFF.replace('-', '') and r[1] and r[2] and r[3] and r[4]]
    if len(px) < 300:
        return None
    df = pd.DataFrame(px, columns=['d', 'o', 'h', 'l', 'c', 'v', 'fr'])
    fl = data.get('flow') or {}
    df['fn'] = [(fl.get(d) or [None] * 3)[0] for d in df['d']]
    df['on'] = [(fl.get(d) or [None] * 3)[1] for d in df['d']]
    df['inn'] = [(fl.get(d) or [None] * 3)[2] for d in df['d']]
    for k in ('fn', 'on', 'inn', 'fr'):
        df[k] = pd.to_numeric(df[k], errors='coerce')
    o, h, l, c, v = df.o, df.h, df.l, df.c, df.v
    pc = c.shift(1)
    r1 = c / pc - 1
    tr = pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    atr10, atr120 = tr.rolling(10).mean(), tr.rolling(120).mean()
    ma20, ma60, ma224 = c.rolling(20).mean(), c.rolling(60).mean(), c.rolling(224).mean()
    sd20 = c.rolling(20).std(ddof=0)
    bbw = 4 * sd20 / ma20
    up = r1.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    dn = (-r1).clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    # 일목: 전환(9)·기준(26)·선행1/2를 26봉 앞에 그리므로 t일 구름 = 26봉 전 값
    tenkan = (h.rolling(9).max() + l.rolling(9).min()) / 2
    kijun = (h.rolling(26).max() + l.rolling(26).min()) / 2
    spanA = ((tenkan + kijun) / 2).shift(26)
    spanB = ((h.rolling(52).max() + l.rolling(52).min()) / 2).shift(26)
    ctop, cbot = np.maximum(spanA, spanB), np.minimum(spanA, spanB)
    atr14 = tr.rolling(14).mean()
    ichi = np.where(c > ctop, (c - ctop) / atr14, np.where(c < cbot, (c - cbot) / atr14, 0.0))
    amt = c * v
    upv = v.where(r1 > 0, 0.0)
    vol20 = rsum(v, 20)
    f = pd.DataFrame({'d': df.d})
    f['code'] = code
    f['mom12_1'] = c.shift(20) / c.shift(250) - 1
    f['mom6'] = c / c.shift(120) - 1
    f['rev5'] = c / c.shift(5) - 1
    f['rev20'] = c / c.shift(20) - 1
    f['d52h'] = c / h.rolling(250).max()
    f['d52l'] = c / l.rolling(250).min()
    f['vcomp'] = atr10 / atr120
    f['bbw'] = bbw / bbw.rolling(120).mean()
    f['rsi14'] = 100 - 100 / (1 + up / dn.replace(0, np.nan))
    f['bb_pctb'] = (c - (ma20 - 2 * sd20)) / (4 * sd20).replace(0, np.nan)
    f['ma20d'] = c / ma20 - 1
    f['ma60d'] = c / ma60 - 1
    f['ma224d'] = c / ma224 - 1
    f['ichi'] = ichi
    f['vsurge'] = v.rolling(5).mean() / v.rolling(60).mean()
    f['upvol20'] = rsum(upv, 20) / vol20
    f['r1'] = r1
    f['illiq'] = (r1.abs() / amt.replace(0, np.nan)).rolling(20).mean() * 1e9
    f['amt20'] = amt.rolling(20).mean()
    f['logamt'] = np.log(f['amt20'])
    for w in (5, 20, 60):
        vw = rsum(v, w)
        f['f%d' % w] = rsum(df.fn, w) / vw
        f['o%d' % w] = rsum(df.on, w) / vw
    f['i20'] = rsum(df.inn, 20) / vol20
    f['fo20'] = rsum(df.fn + df.on, 20) / vol20
    both = ((df.fn > 0) & (df.on > 0)).astype(int)
    f['fo_streak'] = both.groupby((both == 0).cumsum()).cumsum().where(df.fn.notna() & df.on.notna())
    f['dfr20'] = df.fr - df.fr.shift(20)
    f['close'] = c
    for hh in H:
        f['fwd%d' % hh] = c.shift(-hh) / o.shift(-1) - 1
    f['dd20'] = l.shift(-1).iloc[::-1].rolling(20, min_periods=1).min().iloc[::-1].shift(0) / o.shift(-1) - 1
    return f


def load(lab):
    cache = os.path.join(lab, 'cache')
    frames = []
    for fn in sorted(os.listdir(cache)):
        if not fn.endswith('.json'):
            continue
        try:
            fr = stock_frame(fn[:-5], json.load(open(os.path.join(cache, fn))))
        except Exception:
            continue
        if fr is not None:
            frames.append(fr)
    df = pd.concat(frames, ignore_index=True)
    df['date'] = pd.to_datetime(df['d'])
    return df


def prep(df):
    # 시장(동일가중) 일간 수익 → 고유 변동성
    df = df[np.isfinite(df.r1) & (df.r1.abs() < 0.31)].copy()
    mkt = df.groupby('date').r1.transform('mean')
    df['ivol60'] = (df.r1 - mkt).groupby(df.code).transform(lambda s: s.rolling(60).std())
    uni = (df.amt20 >= MIN_AMOUNT) & (df.close >= 1000) & df.mom12_1.notna()
    df = df[uni & (df.date >= TRAIN[0])].copy()
    for hh in H:
        df['ex%d' % hh] = df['fwd%d' % hh] - df.groupby('date')['fwd%d' % hh].transform('mean')
    df['period'] = np.select([df.date <= TRAIN[1], df.date <= VALID[1]], ['train', 'valid'], 'test')
    pct = df.groupby('date')[FEATS].rank(pct=True)
    for k in FEATS:
        df['p_' + k] = pct[k]
    return df


def nonoverlap_dates(dates, h):
    u = np.sort(dates.unique())
    return set(u[::h])


def tstat(x):
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    if len(x) < 5:
        return np.nan, len(x)
    return x.mean() / (x.std(ddof=1) / np.sqrt(len(x))), len(x)


def cell_stats(sub, h):
    ex, fw = sub['ex%d' % h], sub['fwd%d' % h]
    return {'n': int(len(sub)), 'ex': round(float(ex.mean()) * 100, 3), 'win_ex': round(float((ex > 0).mean()) * 100, 1),
            'win_net': round(float((fw - COST > 0).mean()) * 100, 1), 'net': round(float((fw - COST).mean()) * 100, 3),
            'crash': round(float((sub.dd20 < -0.15).mean()) * 100, 1)}


def univariate(df):
    out = {}
    for k in FEATS:
        res = {}
        for per in ('train', 'valid', 'test'):
            s = df[(df.period == per) & df['p_' + k].notna()]
            r = {}
            for h in H:
                s2 = s[s['ex%d' % h].notna()]
                keep = nonoverlap_dates(s2.date, h)
                s3 = s2[s2.date.isin(keep)]
                ic = s3.groupby('date').apply(lambda g: g['p_' + k].corr(g['ex%d' % h].rank(pct=True)), include_groups=False)
                q = pd.cut(s3['p_' + k], [0, .2, .4, .6, .8, 1.0001], labels=False)
                spread = s3[q == 4].groupby('date')['ex%d' % h].mean() - s3[q == 0].groupby('date')['ex%d' % h].mean()
                t_ic, nd = tstat(ic)
                t_sp, _ = tstat(spread)
                r['h%d' % h] = {'ic': round(float(ic.mean()), 4), 't_ic': round(float(t_ic), 2), 'dates': nd,
                                'q_ex': [round(float(s2[pd.cut(s2['p_' + k], [0, .2, .4, .6, .8, 1.0001], labels=False) == i]['ex%d' % h].mean()) * 100, 3) for i in range(5)],
                                'spread': round(float(spread.mean()) * 100, 3), 't_spread': round(float(t_sp), 2)}
            res[per] = r
        out[k] = res
    return out


def bh(pvals, q=0.10):
    p = np.asarray(pvals)
    order = np.argsort(p)
    m = len(p)
    thr = np.zeros(m, bool)
    passed = np.where(p[order] <= q * (np.arange(1, m + 1) / m))[0]
    if len(passed):
        thr[order[:passed.max() + 1]] = True
    return thr


def norm_p(t):
    from math import erfc, sqrt
    return erfc(abs(t) / sqrt(2)) if np.isfinite(t) else 1.0


def pair_grid(df, h=20, top=25):
    """두 피처 5x5 격자 전체를 학습 기간에서 보고 BH 보정 → 상위 칸의 검증·시험 성과."""
    cells = []
    q = {k: pd.cut(df['p_' + k], [0, .2, .4, .6, .8, 1.0001], labels=False) for k in FEATS}
    tr_mask = (df.period == 'train') & df['ex%d' % h].notna()
    keep = nonoverlap_dates(df[tr_mask].date, h)
    trn = tr_mask & df.date.isin(keep)
    for i, a in enumerate(FEATS):
        for b in FEATS[i + 1:]:
            key = q[a] * 5 + q[b]
            g = df[trn].assign(key=key[trn]).groupby(['date', 'key'])['ex%d' % h].mean().unstack()
            for cell in g.columns:
                if not np.isfinite(cell):
                    continue
                t, nd = tstat(g[cell])
                if nd < 30:
                    continue
                cells.append((a, b, int(cell) // 5, int(cell) % 5, float(g[cell].mean()), t, nd))
    p = [norm_p(c[5]) for c in cells]
    sig = bh(p)
    cand = sorted([c for c, s in zip(cells, sig) if s and c[5] > 0], key=lambda c: -c[5])[:top]
    rows = []
    for a, b, qa, qb, m, t, nd in cand:
        mask = (q[a] == qa) & (q[b] == qb)
        row = {'a': a, 'b': b, 'qa': qa + 1, 'qb': qb + 1, 'train_t': round(t, 2), 'train_dates': nd}
        for per in ('train', 'valid', 'test'):
            row[per] = cell_stats(df[mask & (df.period == per) & df['ex%d' % h].notna()], h)
        rows.append(row)
    base = {per: cell_stats(df[(df.period == per) & df['ex%d' % h].notna()], h) for per in ('train', 'valid', 'test')}
    return {'cells_tested': len(cells), 'bh_pass_pos': int(sum(1 for c, s in zip(cells, sig) if s and c[5] > 0)),
            'bh_pass_neg': int(sum(1 for c, s in zip(cells, sig) if s and c[5] < 0)), 'top': rows, 'base': base}


def gbm(df, h=20, feats=None, tag='all'):
    import lightgbm as lgb
    feats = feats or FEATS
    cols = ['p_' + k for k in feats]
    y = 'ex%d' % h
    tr = df[(df.period == 'train') & df[y].notna()]
    va = df[(df.period == 'valid') & df[y].notna()]
    te = df[(df.period == 'test') & df[y].notna()]
    # 목표: 날짜별 초과수익 백분위(이상치 완화)
    ytr = tr.groupby('date')[y].rank(pct=True)
    yva = va.groupby('date')[y].rank(pct=True)
    params = dict(objective='regression', learning_rate=0.03, num_leaves=31, min_data_in_leaf=2000, feature_fraction=0.7,
                  bagging_fraction=0.7, bagging_freq=1, lambda_l2=10.0, verbose=-1, seed=7, num_threads=4)
    dtr = lgb.Dataset(tr[cols], ytr)
    dva = lgb.Dataset(va[cols], yva)
    m = lgb.train(params, dtr, 2000, valid_sets=[dva], callbacks=[lgb.early_stopping(100, verbose=False)])
    out = {'tag': tag, 'best_iter': m.best_iteration,
           'importance': sorted([(f[2:], round(float(g), 1)) for f, g in zip(cols, m.feature_importance('gain'))], key=lambda x: -x[1])[:15]}
    for per, s in (('valid', va), ('test', te)):
        s = s.copy()
        s['score'] = m.predict(s[cols], num_iteration=m.best_iteration)
        s['sp'] = s.groupby('date').score.rank(pct=True)
        keep = nonoverlap_dates(s.date, h)
        s3 = s[s.date.isin(keep)]
        ic = s3.groupby('date').apply(lambda g: g.score.corr(g[y].rank(pct=True)), include_groups=False)
        t_ic, nd = tstat(ic)
        r = {'ic': round(float(ic.mean()), 4), 't_ic': round(float(t_ic), 2), 'dates': nd, 'all': cell_stats(s, h)}
        for name, lo in (('top10', 0.9), ('top1', 0.99), ('bottom10', None)):
            sub = s[s.sp <= 0.1] if lo is None else s[s.sp > lo]
            r[name] = cell_stats(sub, h)
            td = s3[(s3.sp <= 0.1) if lo is None else (s3.sp > lo)].groupby('date')[y].mean()
            r[name]['t'] = round(float(tstat(td)[0]), 2)
        out[per] = r
    return out


def main(lab, out_path):
    df = prep(load(lab))
    info = {'rows': int(len(df)), 'stocks': int(df.code.nunique()), 'dates': [str(df.date.min().date()), str(df.date.max().date())],
            'flow_coverage': round(float(df.f20.notna().mean()), 3),
            'periods': {p: int((df.period == p).sum()) for p in ('train', 'valid', 'test')}}
    print(json.dumps(info), flush=True)
    res = {'info': info, 'labels': LABEL}
    res['univariate'] = univariate(df)
    print('univariate done', flush=True)
    res['gbm_all'] = gbm(df, 20, FEATS, 'all')
    res['gbm_price'] = gbm(df, 20, PRICE_FEATS, 'price_only')
    res['gbm_flow'] = gbm(df, 20, FLOW_FEATS, 'flow_only')
    res['gbm_all_h5'] = gbm(df, 5, FEATS, 'all_h5')
    print('gbm done', flush=True)
    res['pairs_h20'] = pair_grid(df, 20)
    print('pairs done', flush=True)
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=float)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
