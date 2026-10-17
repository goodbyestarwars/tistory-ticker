# -*- coding: utf-8 -*-
"""12번 추세전환(밥그릇 3번) 검색기 도입 가능성 연구(연구용, 읽기 전용, 실전 연결·활성화 없음 - 2026-10-18).

스캔 시점은 기존 시스템과 같다: D-1 장 마감 뒤 확정 일봉으로 신호를 만들고(이 파일의 t = D-1), D일 시가(t+1 시가)에 진입한다.
신호는 t일 종가까지의 자료만 쓴다. 돌파 뒤 "지지 확인 후 진입"은 돌파일 b 이후 실제로 지나간 k봉(b+1..b+k)이 모두 지지됐을 때만
t = b+k 일 종가에서 신호를 확정하고 b+k+1 시가에 진입한다(경과하지 않은 날을 쓰지 않는다).

신호 가족(가설, 확정 조건 아님):
  T112  : 하락 추세(직전 120봉 중 70% 이상 종가가 224일선 아래)였고 직전 30봉이 25% 이내 횡보 뒤 종가가 112일선을 처음 상향 돌파
  T224  : 같은 전제에서 종가가 224일선을 처음 상향 돌파
  TREC  : 직전 60봉 중 224일선 대비 이격이 -15% 이하까지 벌어졌다가, 종가가 224일선의 -3% 안으로 회복(전날은 -3% 아래)
  TECH  : (단순 기술적 반등 비교용) 같은 하락 추세에서 5일선이 20일선을 상향 교차하되 종가는 112일선 아래
  BOX   : 직전 60봉 고점(박스 상단)을 종가로 처음 돌파
진입 방식: E0 돌파 확정 다음 날 시가 / E3 돌파 후 3봉 지지 확인 뒤 / E5 5봉 확인 뒤(지지 = 각 봉 종가 >= 돌파선 98%, 저가 >= 97%) /
  PB BOX 돌파 후 10봉 안에 박스 상단 +2% 안까지 눌렸다 종가가 상단 99% 이상에서 마감한 첫날의 다음 날 시가.
맥락(B): ACCA 최근 60봉 안에 기존 정의 매집봉(2.5배·몸통 2%·종가 위치 0.6) / ACCB 윗꼬리 대량형(2배·윗꼬리 40%·몸통 3% 이내) / NOACC 둘 다 없음 /
  NEARHIGH 종가가 직전 250~30봉 고점의 95% 이상(전고점 매물대 접근·돌파).
기준선: 같은 날짜·같은 가격 위치(250봉 저고점 5분위)·같은 변동성(15봉 범위 5분위)의 유동성 충족 전 종목 평균(accumulation_precursor_study와 같은 방식).
학습 2021~2023에서 조건을 고르고 검증 2024~2026-10에서 평가한다. 비용 왕복 0.7%를 빼기 전·후 보고. 최소 거래대금(20일 평균) 30억원.
기존 11개 검색기와의 중복은 운영 `scan_hits`(공개 /scan-performance-public 응답을 저장한 JSON, 2026-09-03 이후)와 같은 종목·날짜로 대조한다.
실행: python trend_reversal_study.py <일봉 캐시 디렉터리> <out.json> [existing_hits.json]
한계: 생존 편향(현재 상장 종목만), 다중비교(수십 개 칸), 일봉 모사, 기존 검색기 이력은 약 6주뿐.
"""

import json
import os
import sys
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import accumulation_precursor_study as pre  # noqa: E402

roll, csum, window_mean, lag = pre.roll, pre.csum, pre.window_mean, pre.lag
swv = pre.swv

COOLDOWN = 20
START = pre.START
FAMILIES = ('T112', 'T224', 'TREC', 'TECH', 'BOX')
ENTRIES = {'T112': ('E0', 'E3', 'E5'), 'T224': ('E0', 'E3', 'E5'), 'TREC': ('E0', 'E3', 'E5'), 'TECH': ('E0',), 'BOX': ('E0', 'PB')}
CONTEXTS = ('ALL', 'ACCA', 'ACCB', 'NOACC', 'NEARHIGH')
BAR_FOR = {'T112': 'ma112', 'T224': 'ma224', 'TREC': 'ma224'}


def thin(flag, cooldown=COOLDOWN):
    """True 인 날 중 직전 신호 뒤 cooldown 봉이 지난 것만 남긴다."""
    out = np.zeros(len(flag), dtype=bool)
    last = -10 ** 9
    for i in np.where(flag)[0]:
        if i - last >= cooldown:
            out[i] = True
            last = i
    return out


def wick_bars(o, h, l, c, v):
    """윗꼬리 대량형(사용자 제안): 거래량 직전 20일 평균의 2배 이상·윗꼬리 40% 이상·몸통 3% 이내·거래대금 30억원."""
    n = len(c)
    cs_v = csum(v)
    prev_avg = np.full(n, np.nan)
    if n > 20:
        prev_avg[20:] = (cs_v[20:n] - cs_v[:n - 20]) / 20
    rng = h - l
    with np.errstate(invalid='ignore', divide='ignore'):
        upper = np.where(rng > 0, (h - np.maximum(o, c)) / np.where(rng > 0, rng, 1), 0)
        body = np.abs(c / o - 1) * 100
        return (v >= 2.0 * prev_avg) & (upper >= 0.4) & (body < 3.0) & (c * v >= 3e9) & (rng > 0)


def any_within(flag, window):
    """t 에서 flag[t-window+1..t] 중 하나라도 True."""
    cs = csum(flag.astype(float))
    out = np.zeros(len(flag), dtype=bool)
    idx = np.arange(len(flag))
    lo = np.maximum(idx - window + 1, 0)
    out = (cs[idx + 1] - cs[lo]) > 0
    return out


def reversal_flags(o, h, l, c, v):
    """한 종목의 신호 가족별 돌파일 배열(쿨다운 적용)과 진입 배열. 미래 봉을 쓰지 않는다. 반환: dict name -> bool 배열(길이 n)."""
    n = len(c)
    cs = csum(c)
    ma5, ma20 = window_mean(cs, 5), window_mean(cs, 20)
    ma112, ma224 = window_mean(cs, 112), window_mean(cs, 224)
    with np.errstate(invalid='ignore', divide='ignore'):
        below = np.nan_to_num((c < ma224).astype(float))
        csb = csum(below)
        frac = np.full(n, np.nan)
        frac[120:] = (csb[120:n] - csb[0:n - 120]) / 120          # t-120..t-1 중 224일선 아래 비율
        downtrend = frac >= 0.7
        hi30, lo30 = lag(roll(h, 30, 'max'), 1), lag(roll(l, 30, 'min'), 1)
        base = (hi30 - lo30) / lo30 <= 0.25
        cross112 = (c > ma112) & (lag(c, 1) <= lag(ma112, 1))
        cross224 = (c > ma224) & (lag(c, 1) <= lag(ma224, 1))
        dev = c / ma224 - 1
        mindev = lag(roll(dev, 60, 'min'), 1)
        trec = (mindev <= -0.15) & (dev >= -0.03) & (lag(dev, 1) < -0.03)
        tech = (ma5 > ma20) & (lag(ma5, 1) <= lag(ma20, 1)) & (c < ma112) & downtrend
        boxtop = lag(roll(h, 60, 'max'), 1)
        box = (c > boxtop) & (lag(c, 1) <= lag(boxtop, 1))
    raw = {'T112': cross112 & downtrend & base, 'T224': cross224 & downtrend & base, 'TREC': trec, 'TECH': tech, 'BOX': box}
    out = {}
    levels = {'ma112': ma112, 'ma224': ma224}
    for fam in FAMILIES:
        brk = thin(np.nan_to_num(raw[fam].astype(float)).astype(bool))
        out[fam + '_E0'] = brk
        if fam in BAR_FOR:
            lvl = levels[BAR_FOR[fam]]
            with np.errstate(invalid='ignore'):
                okbar = (c >= 0.98 * lvl) & (l >= 0.97 * lvl)
            okbar = np.nan_to_num(okbar.astype(float)).astype(bool)
            for k in (3, 5):
                conf = np.zeros(n, dtype=bool)
                for b in np.where(brk)[0]:
                    if b + k <= n - 1 and okbar[b + 1:b + k + 1].all():
                        conf[b + k] = True                          # b+k 일 종가에서 확정, 진입은 다음 날 시가
                out['%s_E%d' % (fam, k)] = conf
        if fam == 'BOX':
            pb = np.zeros(n, dtype=bool)
            for b in np.where(brk)[0]:
                level = boxtop[b]
                for k in range(b + 1, min(n, b + 11)):
                    if c[k] < level * 0.97:
                        break                                       # 지지 실패
                    if l[k] <= level * 1.02 and c[k] >= level * 0.99:
                        pb[k] = True
                        break
            out['BOX_PB'] = pb
    return out


def build(stocks, dates, pos, mk_down):
    keys = ['code', 'date', 'bucket', 'range15', 'ret5', 'ret10', 'ret20', 'ret40', 'mae20', 'mfe20', 'mfe40', 'd10']
    flag_names = ['%s_%s' % (fam, e) for fam in FAMILIES for e in ENTRIES[fam]]
    ctx_names = ['ACCA', 'ACCB', 'NOACC', 'NEARHIGH']
    cols = {k: [] for k in keys + flag_names + ctx_names}
    for si, (code, ds, a) in enumerate(stocks):
        o, h, l, c, v = a[:, 0], a[:, 1], a[:, 2], a[:, 3], a[:, 4]
        n = len(c)
        didx = np.array([pos[d] for d in ds])
        flags = reversal_flags(o, h, l, c, v)
        acca = pre.accumulation_bars(o, h, l, c, v)
        accb = wick_bars(o, h, l, c, v)
        a60, b60 = any_within(acca, 61), any_within(accb, 61)
        hi_prior = lag(roll(h, 221, 'max'), 30)                      # t-250..t-30
        with np.errstate(invalid='ignore'):
            near = c >= 0.95 * hi_prior
        cs_a = csum(c * v)
        amt20 = window_mean(cs_a, 20)
        low250, high250 = roll(l, 250, 'min'), roll(h, 250, 'max')
        range15 = (roll(h, 15, 'max') - roll(l, 15, 'min')) / c
        with np.errstate(invalid='ignore', divide='ignore'):
            posn = (c - low250) / (high250 - low250)
        bucket = np.clip(np.floor(posn * 5), 0, 4)
        t = np.arange(START, n - 1)
        e = o[t + 1]
        ok = (amt20[t] >= pre.MIN_AMOUNT) & np.isfinite(bucket[t]) & (e > 0) & np.isfinite(range15[t])
        t, e = t[ok], e[ok]
        if len(t) == 0:
            continue
        for hz in pre.HORIZONS:
            r = np.full(len(t), np.nan)
            okh = t + 1 + hz <= n - 1
            r[okh] = c[t[okh] + 1 + hz] / e[okh] - 1
            cols['ret%d' % hz].append(r)
        mae = np.full(len(t), np.nan)
        mfe = np.full(len(t), np.nan)
        mfe40 = np.full(len(t), np.nan)
        ok20 = t + 21 <= n - 1
        lw, hw = swv(l, 21).min(axis=1), swv(h, 21).max(axis=1)
        mae[ok20] = lw[t[ok20] + 1] / e[ok20] - 1
        mfe[ok20] = hw[t[ok20] + 1] / e[ok20] - 1
        d10 = np.full(len(t), np.nan)
        ok41 = t + 41 <= n - 1
        hw41 = swv(h, 41)
        sel = np.where(ok41)[0]
        if len(sel):
            win = hw41[t[sel] + 1]
            mfe40[sel] = win.max(axis=1) / e[sel] - 1
            hit = win >= (e[sel] * 1.10)[:, None]
            d10[sel] = np.where(hit.any(axis=1), hit.argmax(axis=1), np.nan)
        cols['mae20'].append(mae)
        cols['mfe20'].append(mfe)
        cols['mfe40'].append(mfe40)
        cols['d10'].append(d10)
        cols['code'].append(np.full(len(t), si, dtype=np.int32))
        cols['date'].append(didx[t])
        cols['bucket'].append(bucket[t].astype(np.int8))
        cols['range15'].append(range15[t])
        for name in flag_names:
            cols[name].append(flags[name][t])
        cols['ACCA'].append(a60[t])
        cols['ACCB'].append(b60[t])
        cols['NOACC'].append(~(a60[t] | b60[t]))
        cols['NEARHIGH'].append(np.nan_to_num(near[t].astype(float)).astype(bool))
    ev = {k: np.concatenate(v) for k, v in cols.items()}
    n_rows = len(ev['date'])
    ev['acc20'] = np.full(n_rows, np.nan)          # pre.subset_stats 호환(이 연구에서는 쓰지 않는다)
    ev['accdays'] = np.full(n_rows, np.nan)
    return ev, flag_names


def run(cache_dir, out_path, existing_path=None):
    stocks = pre.load(cache_dir)
    dates, pos, mk20, mk_down = pre.market_index(stocks)
    ev, flag_names = build(stocks, dates, pos, mk_down)
    nd = len(dates)
    date_arr = np.array(dates)
    train = date_arr[ev['date']] < pre.SPLIT
    split_sel = (train, ~train)
    ex_vm, ex_plain = {}, {}
    for hz in pre.HORIZONS:
        valid = np.isfinite(ev['ret%d' % hz])
        ex_vm[hz], _ = pre.baseline_excess(ev, nd, 'ret%d' % hz, valid, vol_matched=True)
        ex_plain[hz], _ = pre.baseline_excess(ev, nd, 'ret%d' % hz, valid)
    res = {'events': int(len(ev['date'])), 'stocks': len(stocks), 'range': [dates[0], dates[-1]], 'baseline': pre.subset_stats(ev, np.ones(len(ev['date']), dtype=bool), ex_vm, dates, split_sel), 'cells': {}}
    for name in flag_names:
        for ctx in CONTEXTS:
            sel = ev[name] & (ev[ctx] if ctx != 'ALL' else True)
            if sel.sum() < 30:
                res['cells']['%s|%s' % (name, ctx)] = {'all': {'n': int(sel.sum())}}
                continue
            st = pre.subset_stats(ev, sel, ex_vm, dates, split_sel)
            for part, rows in (('all', sel), ('train', sel & split_sel[0]), ('valid', sel & split_sel[1])):
                t_stat, mean_ex = pre.month_t(ex_plain[20], ev, dates, rows)
                st[part]['plainExcess20'] = round(mean_ex * 100, 2) if np.isfinite(mean_ex) else None
                st[part]['plainT20'] = round(t_stat, 2) if np.isfinite(t_stat) else None
            res['cells']['%s|%s' % (name, ctx)] = st
    if existing_path and os.path.exists(existing_path):
        res['overlap'] = overlap(ev, flag_names, stocks, dates, json.load(open(existing_path, encoding='utf-8')))
    json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done events=%d cells=%d' % (res['events'], len(res['cells'])))


def overlap(ev, flag_names, stocks, dates, existing):
    """신규 신호(D-1 확정)가 같은 날짜에 기존 검색기가 찍은 종목과 겹치는 비율. existing: {'hits': [{scanDate, scanner, code, returns}]}."""
    codes = [c for c, _, _ in stocks]
    by_date = defaultdict(set)
    for hit in existing:
        by_date[(hit['scanDate'], hit['code'])].add(hit['scanner'])
    first = min(h['scanDate'] for h in existing)
    from datetime import date as _d, timedelta as _td
    def nxt(s):
        y, m, d = map(int, s.split('-'))
        return (_d(y, m, d) + _td(days=1)).isoformat()
    out = {'existingSince': first, 'existingHits': len(existing), 'byFlag': {}}
    date_arr = np.array(dates)
    in_window = date_arr[ev['date']] >= first
    for name in flag_names:
        rows = np.where(ev[name] & in_window)[0]
        matched = np.zeros(len(rows), dtype=bool)
        for k, r in enumerate(rows):
            code = codes[ev['code'][r]]
            d0 = dates[ev['date'][r]]
            matched[k] = ((d0, code) in by_date) or ((nxt(d0), code) in by_date)
        r5 = ev['ret5'][rows]
        r10 = ev['ret10'][rows]
        def stat(mask):
            x = r10[mask]
            x = x[np.isfinite(x)]
            return {'n': int(mask.sum()), 'ret10Mean': round(float(x.mean() * 100), 2) if len(x) else None, 'ret10Median': round(float(np.median(x) * 100), 2) if len(x) else None, 'n10': int(len(x))}
        out['byFlag'][name] = {'n': int(len(rows)), 'overlap': int(matched.sum()), 'overlapRate': round(float(matched.mean() * 100), 1) if len(rows) else None,
                               'overlapped': stat(matched), 'notOverlapped': stat(~matched)}
    return out


if __name__ == '__main__':
    run(*sys.argv[1:4])
