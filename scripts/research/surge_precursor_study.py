# -*- coding: utf-8 -*-
"""급등 직전의 패턴·이상치 탐색(연구용, 실전 연결 없음 - 2026-10-18).

질문: "주가가 급등하기 전에 나오는 패턴이나 이상치를 감별할 수 있는가?" 사용 자료는 네이버 5년 일봉 캐시(2,568종목)뿐이다.

설계(미래 비참조): t일 종가까지 확정된 값으로 피처를 만들고 t+1 시가 진입 가정으로 급등을 정의한다.
  급등 정의 3개
    S15_5   t+1 시가 대비 5거래일 안 고가가 +15% 이상 (전체 기록 목적, 실현 가능 이익이 아니다)
    S30_10  10거래일 안 고가가 +30% 이상
    CLEAN15 5거래일 안에 +15%에 먼저 닿고 -7%에는 먼저 닿지 않음(같은 날 둘 다 닿으면 실패 처리)
  피처 30여 개: 수익률·거래량 이상치·변동성 압축·봉 모양·고점 근접·이동평균 정렬·연속 상승/하락·거래량 건조 등.
  평가: 날짜별 백분위 5분위로 나눈 칸마다 급등 확률 / 같은 날짜·가격 위치(250봉 5분위)의 기준 확률 = lift. 학습 2021~2023, 검증 2024~2026-10.
  다중비교: 피처×5분위×급등정의 약 640칸을 보므로 월 묶음 t 4 이상 + 학습·검증 같은 방향일 때만 "후보"로 본다.
  다변량: 피처 전부를 날짜별 백분위로 바꿔 로지스틱 회귀를 학습 기간에서만 맞추고 검증 기간 AUC·상위 1%·5% 정밀도·사후 수익을 본다.
한계: 생존 편향(현재 상장 종목), 일봉 한계(장중 선후 불명), 시장 국면 편중, 급등의 상당수는 공시·뉴스 등 일봉에 없는 원인이다.
실행: python surge_precursor_study.py <일봉 캐시 폴더> <out.json>
"""
import json
import os
import sys

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view as swv

START = 250
SPLIT = '2024-01-01'
MIN_AMOUNT = 3e9
COST = 0.7
TARGETS = ('S15_5', 'S30_10', 'CLEAN15', 'D15_5')
VOL_FEATURES = ('range_pct', 'range_vs_atr', 'atr_ratio', 'bb_ratio', 'nr7', 'rng15', 'atr14')


def csum(x):
    return np.concatenate(([0.0], np.cumsum(x)))


def wmean(cs, w):
    out = np.full(len(cs) - 1, np.nan)
    if len(cs) - 1 >= w:
        out[w - 1:] = (cs[w:] - cs[:-w]) / w
    return out


def roll(x, w, fn):
    out = np.full(len(x), np.nan)
    if len(x) >= w:
        out[w - 1:] = getattr(swv(x, w), fn)(axis=1)
    return out


def lag(x, k):
    out = np.full(len(x), np.nan)
    out[k:] = x[:-k]
    return out


def load(cache_dir):
    stocks = []
    for f in sorted(os.listdir(cache_dir)):
        if not (f.endswith('.json') and len(f) == 11):
            continue
        rows = [r for r in json.load(open(os.path.join(cache_dir, f), encoding='utf-8')) if r[1] and r[2] and r[3] and r[4]]
        if len(rows) < START + 40:
            continue
        stocks.append((f[:-5], [r[0] for r in rows], np.array([r[1:6] for r in rows], dtype=float)))
    return stocks


def market_series(stocks, pos, ndates):
    ret_sum, cnt = np.zeros(ndates), np.zeros(ndates)
    for _, ds, a in stocks:
        c = a[:, 3]
        r = c[1:] / c[:-1] - 1
        ok = np.abs(r) < 0.3
        idx = np.array([pos[d] for d in ds[1:]])
        np.add.at(ret_sum, idx[ok], r[ok])
        np.add.at(cnt, idx[ok], 1)
    level = np.cumprod(1 + ret_sum / np.maximum(cnt, 1))
    m20 = np.full(ndates, np.nan)
    m20[20:] = level[20:] / level[:-20] - 1
    return m20


def streak(up):
    """연속으로 True 인 횟수(오늘 포함)."""
    out = np.zeros(len(up))
    run = 0
    for i, u in enumerate(up):
        run = run + 1 if u else 0
        out[i] = run
    return out


def features(o, h, l, c, v, mkt20):
    n = len(c)
    cs_c, cs_v = csum(c), csum(v)
    ma5, ma20, ma60, ma224 = wmean(cs_c, 5), wmean(cs_c, 20), wmean(cs_c, 60), wmean(cs_c, 224)
    with np.errstate(invalid='ignore', divide='ignore'):
        prev_c = lag(c, 1)
        tr = np.maximum(h - l, np.maximum(np.abs(h - prev_c), np.abs(l - prev_c)))
        cs_tr = csum(np.nan_to_num(tr))
        atr14, atr60 = wmean(cs_tr, 14) / c, wmean(cs_tr, 60) / c
        rng = (h - l) / c
        prev_avg20 = np.full(n, np.nan)
        prev_avg20[20:] = (cs_v[20:n] - cs_v[:n - 20]) / 20
        v5, v20, v60 = wmean(cs_v, 5), wmean(cs_v, 20), wmean(cs_v, 60)
        std20 = np.full(n, np.nan)
        if n >= 20:
            std20[19:] = swv(c, 20).std(axis=1)
        bb = 4 * std20 / ma20
        bb_avg120 = wmean(csum(np.nan_to_num(bb)), 120)
        rng_min7 = roll(rng, 7, 'min')
        hi20, hi60 = roll(h, 20, 'max'), roll(h, 60, 'max')
        low250, high250 = roll(l, 250, 'min'), roll(h, 250, 'max')
        up = c > prev_c
        upvol = csum(np.where(up, v, 0.0))
        upvol20 = np.full(n, np.nan)
        upvol20[19:] = (upvol[20:] - upvol[:-20]) / np.where((cs_v[20:] - cs_v[:-20]) > 0, (cs_v[20:] - cs_v[:-20]), np.nan)
        volratio = v / prev_avg20
        ratio_series = np.where(np.isfinite(volratio), volratio, np.nan)
        vdry = roll(np.nan_to_num(ratio_series, nan=1.0), 5, 'min')
        vmax60 = roll(v, 60, 'max')
        ret20 = c / lag(c, 20) - 1
        feat = {
            'ret1': c / prev_c - 1, 'ret5': c / lag(c, 5) - 1, 'ret20': ret20, 'ret60': c / lag(c, 60) - 1,
            'volr': volratio, 'v5_20': v5 / v20, 'v5_60': v5 / v60, 'v_vs_max60': v / vmax60, 'vdry5': vdry,
            'range_pct': rng, 'range_vs_atr': rng / atr14, 'atr_ratio': atr14 / atr60, 'bb_ratio': bb / bb_avg120, 'nr7': (rng <= rng_min7).astype(float),
            'closepos': np.where(h > l, (c - l) / (h - l), 0.5), 'gap': o / prev_c - 1, 'upper_wick': np.where(h > l, (h - np.maximum(o, c)) / (h - l), 0.0),
            'body': (c - o) / o, 'd20h': c / hi20 - 1, 'd60h': c / hi60 - 1, 'pos250': (c - low250) / (high250 - low250), 'd224': c / ma224 - 1,
            'ma_align': (ma5 > ma20).astype(float) + (ma20 > ma60).astype(float), 'ma20_slope': ma20 / lag(ma20, 5) - 1,
            'up_streak': streak(up), 'down_streak': streak(c < prev_c), 'upvol20': upvol20, 'rel20': ret20 - mkt20,
            'big_up_prev': (c / prev_c - 1 >= 0.10).astype(float), 'above_ma20': c / ma20 - 1,
            'rng15': (roll(h, 15, 'max') - roll(l, 15, 'min')) / c, 'atr14': atr14,
        }
    return feat, wmean(csum(c * v), 20), (low250, high250)


def labels(o, h, l, c, t):
    """t(0-based 정수 배열)별 t+1 시가 진입 가정 레이블과 5일 종가 수익."""
    n = len(c)
    m = len(t)
    e = o[t + 1]
    out = {k: np.full(m, np.nan) for k in TARGETS + ('ret5c',)}
    ok5 = t + 6 <= n - 1
    ok10 = t + 11 <= n - 1
    hw5, lw5 = swv(h, 5), swv(l, 5)
    hw10 = swv(h, 10)
    i5 = np.where(ok5)[0]
    if len(i5):
        H = hw5[t[i5] + 1]
        L = lw5[t[i5] + 1]
        ee = e[i5][:, None]
        reach = H >= ee * 1.15
        stop = L <= ee * 0.93
        first_reach = np.where(reach.any(axis=1), reach.argmax(axis=1), 99)
        first_stop = np.where(stop.any(axis=1), stop.argmax(axis=1), 99)
        out['S15_5'][i5] = (H.max(axis=1) >= e[i5] * 1.15).astype(float)
        out['CLEAN15'][i5] = ((first_reach < 99) & (first_reach < first_stop)).astype(float)
        out['ret5c'][i5] = c[t[i5] + 5] / e[i5] - 1
        out['D15_5'][i5] = (L.min(axis=1) <= e[i5] * 0.85).astype(float)      # 같은 기간 -15% 급락(방향 비대칭 확인용)
    i10 = np.where(ok10)[0]
    if len(i10):
        out['S30_10'][i10] = (hw10[t[i10] + 1].max(axis=1) >= e[i10] * 1.30).astype(float)
    return out


def build(stocks, dates, pos, mkt20):
    names = None
    cols = {}
    for si, (code, ds, a) in enumerate(stocks):
        o, h, l, c, v = a[:, 0], a[:, 1], a[:, 2], a[:, 3], a[:, 4]
        n = len(c)
        didx = np.array([pos[d] for d in ds])
        feat, amt20, (low250, high250) = features(o, h, l, c, v, mkt20[didx])
        t = np.arange(START, n - 1)
        ok = (amt20[t] >= MIN_AMOUNT) & np.isfinite(feat['pos250'][t]) & (o[t + 1] > 0)
        t = t[ok]
        if not len(t):
            continue
        lab = labels(o, h, l, c, t)
        if names is None:
            names = list(feat)
            cols = {k: [] for k in names + list(lab) + ['date', 'bucket']}
        for k in names:
            cols[k].append(feat[k][t])
        for k, vv in lab.items():
            cols[k].append(vv)
        cols['date'].append(didx[t])
        cols['bucket'].append(np.clip(np.floor(feat['pos250'][t] * 5), 0, 4).astype(np.int8))
    return {k: np.concatenate(v) for k, v in cols.items()}, names


def date_percentile(date_idx, x):
    """날짜별 백분위(0~1). 결측은 NaN. 같은 날짜 안 순위로만 비교해 시장 전체 요동을 걷어 낸다."""
    out = np.full(len(x), np.nan)
    order = np.lexsort((x, date_idx))
    d_sorted = date_idx[order]
    x_sorted = x[order]
    ok = np.isfinite(x_sorted)
    starts = np.flatnonzero(np.r_[True, d_sorted[1:] != d_sorted[:-1]])
    ends = np.r_[starts[1:], len(order)]
    for s, e in zip(starts, ends):
        seg = np.flatnonzero(ok[s:e]) + s
        if len(seg) < 20:
            continue
        out[order[seg]] = (np.arange(len(seg)) + 0.5) / len(seg)
    return out


def baseline_prob(date_idx, bucket, y, valid, vb=None):
    """같은 날짜·가격 위치(5분위) 평균. vb 를 주면 변동성(15봉 고저 범위 5분위)까지 같은 종목만 기준선으로 쓴다."""
    key = date_idx.astype(np.int64) * 5 + bucket
    size = (date_idx.max() + 1) * 5
    if vb is not None:
        key = key * 5 + vb
        size *= 5
    s = np.bincount(key, weights=np.where(valid, y, 0.0), minlength=size)
    c = np.bincount(key, weights=valid.astype(float), minlength=size)
    with np.errstate(invalid='ignore', divide='ignore'):
        p = s / c
    return p[key]


def month_t(excess, date_idx, dates, sel):
    months = np.array([d[:7] for d in dates])
    mi = np.unique(months, return_inverse=True)[1][date_idx[sel]]
    ex = excess[sel]
    ok = np.isfinite(ex)
    if ok.sum() < 50:
        return None
    s = np.bincount(mi[ok], weights=ex[ok])
    k = np.bincount(mi[ok])
    m = s[k > 0] / k[k > 0]
    if len(m) < 6 or m.std(ddof=1) == 0:
        return None
    return float(m.mean() / (m.std(ddof=1) / np.sqrt(len(m))))


def auc(score, y):
    ok = np.isfinite(score) & np.isfinite(y)
    s, yy = score[ok], y[ok]
    order = np.argsort(s)
    ranks = np.empty(len(s))
    ranks[order] = np.arange(1, len(s) + 1)
    pos = yy == 1
    n1, n0 = pos.sum(), (~pos).sum()
    return float((ranks[pos].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)) if n1 and n0 else None


def fit_logistic(X, y, iters=300, lr=0.5, l2=1e-3):
    w = np.zeros(X.shape[1])
    b = np.log(y.mean() / (1 - y.mean()))
    for _ in range(iters):
        z = np.clip(X @ w + b, -30, 30)
        p = 1 / (1 + np.exp(-z))
        g = X.T @ (p - y) / len(y) + l2 * w
        w -= lr * g
        b -= lr * float((p - y).mean())
    return w, b


def run(cache_dir, out_path):
    stocks = load(cache_dir)
    dates = sorted({d for _, ds, _ in stocks for d in ds})
    pos = {d: i for i, d in enumerate(dates)}
    mkt20 = market_series(stocks, pos, len(dates))
    ev, names = build(stocks, dates, pos, mkt20)
    n = len(ev['date'])
    date_idx = ev['date'].astype(np.int64)
    date_arr = np.array(dates)
    train = date_arr[date_idx] < SPLIT
    pct = {k: date_percentile(date_idx, ev[k]) for k in names}
    res = {'events': int(n), 'stocks': len(stocks), 'range': [dates[0], dates[-1]], 'targets': {}, 'features': names}
    vb = np.digitize(ev['rng15'], np.nanquantile(ev['rng15'], [0.2, 0.4, 0.6, 0.8])).astype(np.int64)
    probs = {}
    for tgt in TARGETS:
        y = ev[tgt]
        valid = np.isfinite(y)
        base = baseline_prob(date_idx, ev['bucket'], y, valid)
        base_vm = baseline_prob(date_idx, ev['bucket'], y, valid, vb)
        probs[tgt] = base
        tres = {'rate': {'train': float(np.nanmean(y[train])), 'valid': float(np.nanmean(y[~train]))}, 'cells': []}
        for k in names:
            q = np.floor(pct[k] * 5)
            for qi in range(5):
                row = {'feature': k, 'q': qi + 1}
                for part, mask in (('train', train), ('valid', ~train)):
                    sel = valid & (q == qi) & mask
                    if sel.sum() < 300:
                        row[part] = None
                        continue
                    lift = float(np.nansum(y[sel]) / np.nansum(base[sel]))
                    lift_vm = float(np.nansum(y[sel]) / np.nansum(base_vm[sel]))
                    row[part] = {'n': int(sel.sum()), 'rate': round(float(np.nanmean(y[sel])) * 100, 3), 'lift': round(lift, 3), 'lift_vm': round(lift_vm, 3),
                                 't': (lambda t_: round(t_, 2) if t_ is not None else None)(month_t(y - base, date_idx, dates, sel)),
                                 't_vm': (lambda t_: round(t_, 2) if t_ is not None else None)(month_t(y - base_vm, date_idx, dates, sel))}
                tres['cells'].append(row)
        res['targets'][tgt] = tres
    # 다변량(로지스틱): 학습 기간만 맞추고 검증 기간에서 평가. 대상: CLEAN15. 모형 둘: 전체 피처 / 변동성 피처를 뺀 것
    tgt = 'CLEAN15'
    valid = np.isfinite(ev[tgt])
    tr, va = valid & train, valid & ~train
    base_vm_c = baseline_prob(date_idx, ev['bucket'], ev[tgt], valid, vb)
    res['multivariate'] = {}
    for label, drop in (('all_features', ()), ('without_volatility_features', VOL_FEATURES)):
        use = [k for k in names if k not in drop]
        X = np.column_stack([np.nan_to_num(pct[k] - 0.5, nan=0.0) for k in use])
        sub = np.flatnonzero(tr)
        rng = np.random.default_rng(1)
        if len(sub) > 400000:
            sub = rng.choice(sub, 400000, replace=False)
        w, b = fit_logistic(X[sub], ev[tgt][sub])
        score = X @ w + b
        out_m = {'features_used': len(use), 'auc_train': auc(score[tr], ev[tgt][tr]), 'auc_valid': auc(score[va], ev[tgt][va]),
                 'weights': {k: round(float(x), 3) for k, x in sorted(zip(use, w), key=lambda kv: -abs(kv[1]))[:10]}}
        for top in (0.01, 0.05):
            cut = np.nanquantile(score[va], 1 - top)
            sel = va & (score >= cut)
            base_rate = float(np.nanmean(ev[tgt][va]))
            down = ev['D15_5'][sel]
            out_m['top%d' % int(top * 100)] = {
                'n': int(sel.sum()), 'precision': round(float(np.nanmean(ev[tgt][sel])) * 100, 2), 'base_rate': round(base_rate * 100, 2),
                'lift': round(float(np.nanmean(ev[tgt][sel]) / base_rate), 2),
                'lift_vol_matched': round(float(np.nansum(ev[tgt][sel]) / np.nansum(base_vm_c[sel])), 2),
                'crash15_rate': round(float(np.nanmean(down)) * 100, 2), 'crash15_base': round(float(np.nanmean(ev['D15_5'][va])) * 100, 2),
                'ret5_mean_net': round(float(np.nanmean(ev['ret5c'][sel]) * 100 - COST), 2),
                'ret5_mean_all_net': round(float(np.nanmean(ev['ret5c'][va]) * 100 - COST), 2),
                'ret5_median': round(float(np.nanmedian(ev['ret5c'][sel]) * 100), 2)}
        res['multivariate'][label] = out_m
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done events=%d' % n)


if __name__ == '__main__':
    run(*sys.argv[1:3])
