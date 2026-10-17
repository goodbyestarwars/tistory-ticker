# -*- coding: utf-8 -*-
"""매집 선행 징후 연구(연구용, 읽기 전용, 실전 연결 없음 - 2026-10-17).

질문: 매집봉이 나오기 전(또는 실제 상승 전) 5~20거래일에 가격·거래량·수급 변화가 먼저 나타나는가? 신호는 검증할 가설이다(확정 조건 아님).
  S1 가격 안정   : 최근 15봉 고저 범위 <= 종가의 15% 이고, 최근 10봉 최저가가 그 앞 20봉(t-29~t-10) 최저가 아래로 내려가지 않음(저점 이탈 없음)
  S2 거래량 압축 : 최근 5일 평균 거래량 <= 20일 평균의 70%
  S3 OBV 다이버전스: 15봉 전 대비 가격 변화 +-5% 이내(횡보)인데 OBV 가 15봉 전보다 높음
  S4 CMF(20)     : CMF20 >= 0 이고 최근 5일 평균 CMF 가 그 앞 5일 평균보다 높음(개선)
  S5 상대강도    : 최근 20일 수익률이 시장보다 높음. 시장 = 전 종목 동일가중 지수(코스피·코스닥 지수 자료가 일봉 캐시에 없고 새 외부 호출을 하지 않아 대리값을 쓴다)
모든 신호는 t일 종가까지의 자료만 쓴다. 진입은 t+1 시가, 청산 비교는 t+1+h 종가(h = 5·10·20·40), 최소 거래대금(20일 평균) 30억원.
기준선: 같은 날짜·같은 가격 위치(250봉 저고점 범위 안의 5분위)의 유동성 충족 전 종목 평균. 초과수익 = 이벤트 수익률 - 기준선 평균(월별 평균의 t 값으로 군집 상관을 줄인다).
학습 2021~2023 / 검증 2024~2026-10. 비용은 왕복 0.7%(이슈 #697 가정)를 빼기 전·후 모두 보고한다.
실행: python accumulation_precursor_study.py <일봉 캐시 디렉터리> <out.json>
한계: 현재 상장 종목만(생존 편향), 시장 대리 지수, 일봉 모사, 31개 조합 x 4개 기간을 비교하므로 다중비교 위험이 있다(검증 기간 재현으로만 판단).
"""

import itertools
import json
import os
import sys

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view as swv

HORIZONS = (5, 10, 20, 40)
MIN_AMOUNT = 3_000_000_000
COST = 0.7
SIGNALS = ('S1', 'S2', 'S3', 'S4', 'S5')
SPLIT = '2024-01-01'
START = 250


def roll(x, w, fn):
    """길이 n 배열, 인덱스 t 에 x[t-w+1..t] 의 fn(min/max) - 앞쪽은 NaN."""
    out = np.full(len(x), np.nan)
    if len(x) >= w:
        out[w - 1:] = getattr(swv(x, w), fn)(axis=1)
    return out


def csum(x):
    return np.concatenate(([0.0], np.cumsum(x)))


def window_mean(cs, w):
    """cs = csum(x). 인덱스 t 에 x[t-w+1..t] 평균."""
    out = np.full(len(cs) - 1, np.nan)
    if len(cs) - 1 >= w:
        out[w - 1:] = (cs[w:] - cs[:-w]) / w
    return out


def lag(x, k):
    """x[t-k] (앞쪽 NaN)."""
    out = np.full(len(x), np.nan)
    out[k:] = x[:-k]
    return out


def signals(o, h, l, c, v, mk20):
    """종목 하나의 신호 불리언 배열 5개와 보조 값. mk20: 같은 길이, 시장(동일가중) 20일 수익률. 미래 자료를 쓰지 않는다."""
    n = len(c)
    cs_v = csum(v)
    avg5 = window_mean(cs_v, 5)
    avg20 = window_mean(cs_v, 20)
    with np.errstate(invalid='ignore', divide='ignore'):
        s2 = avg5 <= 0.7 * avg20
        range15 = (roll(h, 15, 'max') - roll(l, 15, 'min')) / c
        low10 = roll(l, 10, 'min')
        prev_low = lag(roll(l, 20, 'min'), 10)                      # t-29..t-10
        s1 = (range15 <= 0.15) & (low10 >= prev_low)
        obv = np.cumsum(np.sign(np.diff(c, prepend=c[0])) * v)
        flat = np.abs(c / lag(c, 15) - 1) <= 0.05
        s3 = flat & (obv > lag(obv, 15))
        rng = h - l
        mfm = np.where(rng > 0, ((c - l) - (h - c)) / np.where(rng > 0, rng, 1), 0.0)
        cs_mfv = csum(mfm * v)
        num = np.full(n, np.nan)
        den = np.full(n, np.nan)
        if n >= 20:
            num[19:] = cs_mfv[20:] - cs_mfv[:-20]
            den[19:] = cs_v[20:] - cs_v[:-20]
        cmf = np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)
        cs_cmf = csum(np.nan_to_num(cmf))
        cmf5 = window_mean(cs_cmf, 5)
        s4 = (cmf >= 0) & (cmf5 > lag(cmf5, 5))
        ret20 = c / lag(c, 20) - 1
        s5 = ret20 > mk20
    flags = np.stack([np.nan_to_num(s, nan=0).astype(bool) for s in (s1, s2, s3, s4, s5)])
    return flags, {'avg20': avg20, 'range15': range15, 'ret20': ret20, 'cmf': cmf}


def accumulation_bars(o, h, l, c, v):
    """검색기(volume_accumulation.find_accumulation_bar) 봉 하나 조건과 같다: 2.5배·몸통 2%·종가 위치 0.6·거래대금 30억."""
    n = len(c)
    cs_v = csum(v)
    prev_avg = np.full(n, np.nan)
    if n > 20:
        prev_avg[20:] = (cs_v[20:n] - cs_v[:n - 20]) / 20
    rng = h - l
    with np.errstate(invalid='ignore', divide='ignore'):
        pos = np.where(rng > 0, (c - l) / np.where(rng > 0, rng, 1), 0)
        return (v >= 2.5 * prev_avg) & (c > o) & ((c / o - 1) * 100 >= 2.0) & (pos >= 0.6) & (c * v >= 3e9) & (rng > 0)


def load(cache_dir):
    stocks = []
    for f in sorted(os.listdir(cache_dir)):
        if not f.endswith('.json'):
            continue
        rows = [r for r in json.load(open(os.path.join(cache_dir, f), encoding='utf-8')) if r[1] and r[2] and r[3] and r[4]]
        if len(rows) < START + 60:
            continue
        a = np.array([r[1:6] for r in rows], dtype=float)
        stocks.append((f[:-5], [r[0] for r in rows], a))
    return stocks


def market_index(stocks):
    dates = sorted({d for _, ds, _ in stocks for d in ds})
    pos = {d: i for i, d in enumerate(dates)}
    ret_sum = np.zeros(len(dates))
    cnt = np.zeros(len(dates))
    for _, ds, a in stocks:
        c = a[:, 3]
        r = c[1:] / c[:-1] - 1
        ok = np.abs(r) < 0.3
        idx = np.array([pos[d] for d in ds[1:]])
        np.add.at(ret_sum, idx[ok], r[ok])
        np.add.at(cnt, idx[ok], 1)
    level = np.cumprod(1 + ret_sum / np.maximum(cnt, 1)) * 100
    mk20 = np.full(len(dates), np.nan)
    mk20[20:] = level[20:] / level[:-20] - 1
    ma60 = np.full(len(dates), np.nan)
    cs = csum(level)
    ma60[59:] = (cs[60:] - cs[:-60]) / 60
    return dates, pos, mk20, level < ma60


def build_events(stocks, dates, pos, mk20, mk_down):
    cols = {k: [] for k in ('date', 'bucket', 'mask', 'premask', 'ret5', 'ret10', 'ret20', 'ret40', 'mae20', 'mfe20', 'mae40', 'mfe40',
                            'd10', 'acc20', 'acc520', 'accdays', 'isacc', 'lead', 'runup', 'range15', 'logamt', 'down')}
    lead_keys = []
    for code, ds, a in stocks:
        o, h, l, c, v = a[:, 0], a[:, 1], a[:, 2], a[:, 3], a[:, 4]
        n = len(c)
        didx = np.array([pos[d] for d in ds])
        flags, aux = signals(o, h, l, c, v, mk20[didx])
        acc = accumulation_bars(o, h, l, c, v)
        cs_a = csum(c * v)
        amt20 = window_mean(cs_a, 20)
        low250, high250 = roll(l, 250, 'min'), roll(h, 250, 'max')
        with np.errstate(invalid='ignore', divide='ignore'):
            posn = (c - low250) / (high250 - low250)
        bucket = np.clip(np.floor(posn * 5), 0, 4)
        t = np.arange(START, n - 1)
        e = o[t + 1]
        ok = (amt20[t] >= MIN_AMOUNT) & np.isfinite(bucket[t]) & (e > 0)
        t, e = t[ok], e[ok]
        if len(t) == 0:
            continue
        mask = np.zeros(len(t), dtype=np.int16)
        premask = np.zeros(len(t), dtype=np.int16)
        for j in range(5):
            mask |= (flags[j][t].astype(np.int16) << j)
            cs = csum(flags[j].astype(float))
            pre = (cs[t - 4] - cs[t - 20]) > 0                       # t-20 ~ t-5 중 한 번이라도
            premask |= (pre.astype(np.int16) << j)
        for hz in HORIZONS:
            r = np.full(len(t), np.nan)
            okh = t + 1 + hz <= n - 1
            r[okh] = c[t[okh] + 1 + hz] / e[okh] - 1
            cols['ret%d' % hz].append(r)
        for w, name in ((20, '20'), (40, '40')):
            mae = np.full(len(t), np.nan)
            mfe = np.full(len(t), np.nan)
            okw = t + 1 + w <= n - 1
            lw = swv(l, w + 1).min(axis=1)                         # 인덱스 s: l[s..s+w]
            hw = swv(h, w + 1).max(axis=1)
            mae[okw] = lw[t[okw] + 1] / e[okw] - 1
            mfe[okw] = hw[t[okw] + 1] / e[okw] - 1
            cols['mae' + name].append(mae)
            cols['mfe' + name].append(mfe)
        d10 = np.full(len(t), np.nan)
        ok41 = t + 41 <= n - 1
        hw41 = swv(h, 41)
        sel = np.where(ok41)[0]
        if len(sel):
            win = hw41[t[sel] + 1]
            hit = win >= (e[sel] * 1.10)[:, None]
            first = np.where(hit.any(axis=1), hit.argmax(axis=1), np.nan)
            d10[sel] = first
        cols['d10'].append(d10)
        acc_i = acc.astype(float)
        cs_acc = csum(acc_i)
        a20 = np.full(len(t), np.nan)
        a520 = np.full(len(t), np.nan)
        adays = np.full(len(t), np.nan)
        ok20 = t + 20 <= n - 1
        a20[ok20] = (cs_acc[t[ok20] + 21] - cs_acc[t[ok20] + 1]) > 0
        a520[ok20] = (cs_acc[t[ok20] + 21] - cs_acc[t[ok20] + 5]) > 0
        nxt = np.full(n + 2, 10 ** 9)                                # nxt[i] = i 이후(i 포함) 첫 매집봉 위치
        for i in range(n - 1, -1, -1):
            nxt[i] = i if acc[i] else nxt[i + 1]
        gap = nxt[t[ok20] + 1] - t[ok20]
        adays[ok20] = np.where(gap <= 20, gap, np.nan)
        cols['acc20'].append(a20)
        cols['acc520'].append(a520)
        cols['accdays'].append(adays)
        isacc = acc[t]
        cols['isacc'].append(isacc)
        # 매집봉 날의 신호별 선행 일수: t-20~t-5 중 신호가 처음 켜진 날부터 t 까지 며칠(클수록 먼저)
        lead = np.full((len(t), 5), np.nan)
        for ti in np.where(isacc)[0]:
            for j in range(5):
                seg = flags[j][t[ti] - 20:t[ti] - 4]
                if seg.any():
                    lead[ti, j] = 20 - seg.argmax()
        cols['lead'].append(lead)
        cols['date'].append(didx[t])
        cols['bucket'].append(bucket[t].astype(np.int8))
        cols['mask'].append(mask)
        cols['premask'].append(premask)
        cols['runup'].append(aux['ret20'][t])
        cols['range15'].append(aux['range15'][t])
        cols['logamt'].append(np.log10(amt20[t]))
        cols['down'].append(mk_down[didx[t]])
    out = {}
    for k, v in cols.items():
        out[k] = np.concatenate(v) if k != 'lead' else np.vstack(v)
    return out


def baseline_excess(ev, ndates, name, valid, vol_matched=False):
    """같은 날짜·같은 가격 위치(5분위) 기준선. vol_matched 면 15봉 고저 범위 5분위까지 같은 종목만 기준선으로 쓴다
    (가격 안정 신호가 '변동이 작은 종목'을 고르는 효과인지 가려 내기 위한 통제)."""
    if vol_matched:
        vb = np.digitize(ev['range15'], np.nanquantile(ev['range15'], [0.2, 0.4, 0.6, 0.8]))
        key = (ev['date'].astype(np.int64) * 5 + ev['bucket']) * 5 + vb
        size = ndates * 25
    else:
        key = ev['date'].astype(np.int64) * 5 + ev['bucket']
        size = ndates * 5
    x = ev[name]
    w = np.where(valid, x, 0.0)
    s = np.bincount(key, weights=w, minlength=size)
    c = np.bincount(key, weights=valid.astype(float), minlength=size)
    with np.errstate(invalid='ignore', divide='ignore'):
        base = s / c
    return x - base[key], base[key]


def month_t(excess, ev, dates, sel):
    months = np.array([d[:7] for d in dates])
    mi = np.unique(months, return_inverse=True)[1]
    m = mi[ev['date'][sel]]
    ex = excess[sel]
    ok = np.isfinite(ex)
    if ok.sum() < 30:
        return float('nan'), float('nan')
    s = np.bincount(m[ok], weights=ex[ok])
    k = np.bincount(m[ok])
    means = s[k > 0] / k[k > 0]
    if len(means) < 6:
        return float('nan'), float(np.nanmean(ex))
    return float(means.mean() / (means.std(ddof=1) / np.sqrt(len(means)))), float(np.nanmean(ex))


def subset_stats(ev, sel, ex, dates, split_sel):
    out = {}
    for name, rows in (('all', sel), ('train', sel & split_sel[0]), ('valid', sel & split_sel[1])):
        d = {'n': int(rows.sum())}
        for hz in HORIZONS:
            r = ev['ret%d' % hz][rows]
            r = r[np.isfinite(r)]
            if len(r) < 30:
                d['h%d' % hz] = None
                continue
            t_stat, mean_ex = month_t(ex[hz], ev, dates, rows)
            d['h%d' % hz] = {'n': int(len(r)), 'mean': round(float(r.mean() * 100), 2), 'median': round(float(np.median(r) * 100), 2),
                             'win': round(float((r > 0).mean() * 100), 1), 'excess': round(mean_ex * 100, 2), 't': round(t_stat, 2) if np.isfinite(t_stat) else None,
                             'netMean': round(float(r.mean() * 100 - COST), 2)}
        mae = ev['mae20'][rows]
        mfe = ev['mfe20'][rows]
        r20 = ev['ret20'][rows]
        d['mae20Median'] = round(float(np.nanmedian(mae) * 100), 2) if np.isfinite(mae).any() else None
        d['reach10'] = round(float((mfe[np.isfinite(mfe)] >= 0.10).mean() * 100), 1) if np.isfinite(mfe).any() else None
        d['reach20'] = round(float((mfe[np.isfinite(mfe)] >= 0.20).mean() * 100), 1) if np.isfinite(mfe).any() else None
        d['loss10'] = round(float((r20[np.isfinite(r20)] <= -0.10).mean() * 100), 1) if np.isfinite(r20).any() else None
        d10 = ev['d10'][rows]
        full = np.isfinite(ev['mfe40'][rows])
        d['d10Reach'] = round(float(np.isfinite(d10[full]).mean() * 100), 1) if full.any() else None      # 40일 안에 +10%에 닿은 비율
        d['d10Median'] = round(float(np.nanmedian(d10)), 1) if np.isfinite(d10).any() else None            # 닿은 경우 진입 후 며칠째
        a20 = ev['acc20'][rows]
        d['acc20'] = round(float(np.nanmean(a20) * 100), 2) if np.isfinite(a20).any() else None
        d['accDaysMedian'] = round(float(np.nanmedian(ev['accdays'][rows])), 1) if np.isfinite(ev['accdays'][rows]).any() else None
        out[name] = d
    return out


def main(cache_dir, out_path):
    stocks = load(cache_dir)
    dates, pos, mk20, mk_down = market_index(stocks)
    ev = build_events(stocks, dates, pos, mk20, mk_down)
    nd = len(dates)
    date_arr = np.array(dates)
    train = date_arr[ev['date']] < SPLIT
    split_sel = (train, ~train)
    ex = {}
    base_acc = None
    for hz in HORIZONS:
        valid = np.isfinite(ev['ret%d' % hz])
        ex[hz], _ = baseline_excess(ev, nd, 'ret%d' % hz, valid)
    ex_vm, _ = baseline_excess(ev, nd, 'ret20', np.isfinite(ev['ret20']), vol_matched=True)
    results = {'events': int(len(ev['date'])), 'stocks': len(stocks), 'range': [dates[0], dates[-1]], 'subsets': {}, 'baseline': {}}
    allsel = np.ones(len(ev['date']), dtype=bool)
    results['baseline'] = subset_stats(ev, allsel, ex, dates, split_sel)
    for k in range(1, 6):
        for combo in itertools.combinations(range(5), k):
            need = sum(1 << j for j in combo)
            sel = (ev['mask'] & need) == need
            name = '+'.join(SIGNALS[j] for j in combo)
            results['subsets'][name] = subset_stats(ev, sel, ex, dates, split_sel)
            vm = {}
            for part, rows in (('all', sel), ('train', sel & split_sel[0]), ('valid', sel & split_sel[1])):
                t_stat, mean_ex = month_t(ex_vm, ev, dates, rows)
                vm[part] = {'excess20': round(mean_ex * 100, 2) if np.isfinite(mean_ex) else None, 't': round(t_stat, 2) if np.isfinite(t_stat) else None}
            results['subsets'][name]['volMatched20'] = vm
    # 매집봉(기존 정의) 전 5~20봉 선행 분석: 신호가 한 번이라도 켜진 비율 대 같은 날짜·가격 위치 기준선, 선행 일수
    isacc = ev['isacc']
    acc_pre = {}
    for j, s in enumerate(SIGNALS):
        pre = ((ev['premask'] >> j) & 1).astype(float)
        key = ev['date'].astype(np.int64) * 5 + ev['bucket']
        sm = np.bincount(key, weights=pre, minlength=nd * 5)
        cn = np.bincount(key, minlength=nd * 5)
        with np.errstate(invalid='ignore', divide='ignore'):
            base = sm / cn
        p_acc = float(pre[isacc].mean()) if isacc.any() else float('nan')
        p_base = float(np.nanmean(base[key[isacc]])) if isacc.any() else float('nan')
        lead = ev['lead'][isacc, j]
        acc_pre[s] = {'pAcc': round(p_acc * 100, 1), 'pBaseline': round(p_base * 100, 1), 'lift': round(p_acc / p_base, 2) if p_base else None,
                      'leadMeanDays': round(float(np.nanmean(lead)), 1) if np.isfinite(lead).any() else None}
    results['accBeforeBar'] = {'accBars': int(isacc.sum()), 'perSignal': acc_pre}
    # 실패 사례 공통점(가장 낮은 다중비교 위험을 위해 검증 기간 평균 초과수익이 가장 높은 조합 한 개와 단독 S2 대조)
    results['failureProfile'] = {}
    for name in ('S2', 'S1+S2', 'S1+S2+S3+S4+S5'):
        need = sum(1 << SIGNALS.index(p) for p in name.split('+'))
        sel = ((ev['mask'] & need) == need) & np.isfinite(ev['ret20'])
        fail = sel & (ev['ret20'] <= -0.10)
        good = sel & (ev['ret20'] >= 0.10)
        def prof(m):
            if m.sum() < 30:
                return None
            return {'n': int(m.sum()), 'marketBelow60MA': round(float(ev['down'][m].mean() * 100), 1), 'bucketMean': round(float(ev['bucket'][m].mean()), 2),
                    'runup20Mean': round(float(np.nanmean(ev['runup'][m]) * 100), 1), 'range15Mean': round(float(np.nanmean(ev['range15'][m]) * 100), 1),
                    'logAmtMean': round(float(np.nanmean(ev['logamt'][m])), 2)}
        results['failureProfile'][name] = {'fail(<=-10%)': prof(fail), 'good(>=+10%)': prof(good)}
    json.dump(results, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done events=%d subsets=%d' % (results['events'], len(results['subsets'])))


if __name__ == '__main__':
    main(*sys.argv[1:3])
