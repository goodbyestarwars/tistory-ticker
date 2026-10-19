# -*- coding: utf-8 -*-
"""시초 30분 거래량 돌파 · 매물 흡수 의심 · 분배 의심 연구(연구용, 실전 연결 없음 - 2026-10-18).

가설: 전일 하루 거래량이 당일 개장 후 30분 안에 터지면 강한 수급 이벤트이고, 그 뒤 저점이 높아지며 가격이 유지되면(매물 흡수 의심) 상승 확률이
높고, 고점을 찍고 상승분을 반납하며 긴 윗꼬리를 만들면(분배 의심) 위험하다. 거래량만으로 의도를 확정하지 않고 후속 수익률로만 평가한다.

자료: 키움 1분봉(open_volume_collect.py 가 받은 후보 종목일 + 날짜별 무작위 기준선 종목일), 네이버 5년 일봉(전일 거래량·일봉 맥락·5/10거래일 성과).
시점 규칙(미래 비참조): 분봉 라벨 hhmm 은 그 분의 시작이고 그 봉의 값은 hhmm+1분에 확정된다. 감지는 '누적 거래량이 전일 거래량의 X배를 처음 넘은 봉'이 확정된
시각이며 체결은 다음 봉 시가 + 슬리피지(매수 0.1%)다. 흡수·분배 판정은 09:30에 확정된 09:00~09:29 봉만으로 하고 진입은 09:30 봉 시가다.
비용: 왕복 0.7%(엔진 허용치) + 매도 슬리피지 0.15%. 기준선: 같은 날짜의 무작위 유동 종목일(비율 무관)을 같은 시각·같은 규칙으로 측정해 날짜 짝으로 뺀다.
학습 2026-05~07, 검증 2026-08~10. 후보 종목일은 '그날 하루 거래량 >= 전일 2배'라서 100%·150% 돌파는 빠짐없이, 30%·50% 돌파는 일부만 들어 있다(open_volume_collect.py 설명).
"""
import json
import os
import sys
from collections import defaultdict

COST_PCT = 0.7
SLIP_BUY, SLIP_SELL = 0.10, 0.15
LEVELS = (0.3, 0.5, 1.0, 1.5)
MILESTONES = ('0905', '0910', '0915', '0920', '0930')       # 이 시각까지(포함) 처음 넘었는지
SPLIT = '2026-08-01'
TP, SL = 4.0, 3.0
MIN_EVENT = 30


# ---- 자료 ----
def load_daily(cache_dir, code):
    try:
        rows = json.load(open(os.path.join(cache_dir, code + '.json'), encoding='utf-8'))
    except (OSError, ValueError):
        return []
    return [r for r in rows if r[1] and r[2] and r[3] and r[4]]


def load_bars(folder, code, day):
    try:
        d = json.load(open(os.path.join(folder, '%s_%s.json' % (code, day)), encoding='utf-8'))
    except (OSError, ValueError):
        return []
    return d.get('bars') or []


def minute_add(hhmm, k):
    h, m = int(hhmm[:2]), int(hhmm[2:])
    t = h * 60 + m + k
    return '%02d%02d' % (t // 60, t % 60)


# ---- 이벤트 감지 ----
def first_cross(bars, prev_vol, level):
    """누적 거래량이 prev_vol*level 이상이 되는 첫 봉 인덱스(09:30까지 확정된 봉만). 없으면 None. 반환 (index, 확정 시각 hhmm)."""
    target = prev_vol * level
    cum = 0.0
    for i, b in enumerate(bars):
        if b[0] >= '0930':
            break
        cum += b[5]
        if cum >= target:
            return i, minute_add(b[0], 1)
    return None


# ---- 흡수·분배 플래그 (09:00~09:29 봉만) ----
def flags(bars, daily_ctx):
    """09:30 확정 시점의 플래그. bars: 0900..0929 봉 [hhmm,o,h,l,c,v]. daily_ctx: 일봉 맥락(전일까지)."""
    early = [b for b in bars if b[0] < '0930']
    if len(early) < 25:
        return None
    o = early[0][1]
    hi = max(b[2] for b in early)
    lo = min(b[3] for b in early)
    price = early[-1][4]
    vol = sum(b[5] for b in early)
    vwap = sum(((b[2] + b[3] + b[4]) / 3) * b[5] for b in early) / vol if vol else price
    blocks = [early[i:i + 5] for i in range(0, 30, 5) if len(early[i:i + 5]) == 5]
    lows = [min(b[3] for b in blk) for blk in blocks]
    highs = [max(b[2] for b in blk) for blk in blocks]
    ih = max(range(len(early)), key=lambda i: early[i][2])
    after = early[ih + 1:]
    before = early[:ih + 1]
    last_blk = blocks[-1]
    last_rng = max(b[2] for b in last_blk) - min(b[3] for b in last_blk)
    last_pos = (last_blk[-1][4] - min(b[3] for b in last_blk)) / last_rng if last_rng > 0 else 0.5
    rise = (hi / o - 1) * 100
    out = {
        'A1_prior_lows_rising': bool(daily_ctx.get('lows_rising')),
        'A2_intraday_higher_lows': sum(1 for a, b in zip(lows[1:], lows[2:]) if b > a) >= 3 and lows[-1] >= lows[1],
        'A3_above_open_vwap': price > o and price > vwap,
        'A4_close_near_high': last_pos >= 0.6 and price >= hi * 0.98,
        'A5_pullback_volume_drop': (len(after) >= 3 and sum(b[5] for b in after) / len(after) < 0.8 * sum(b[5] for b in before) / len(before)),
        'A6_rebound_volume_up': (sum(b[5] for b in early[-3:]) > sum(b[5] for b in early[-6:-3]) and early[-1][4] > early[-4][4]),
        'A7_break_prior_high_hold': bool(daily_ctx.get('prev_high')) and hi > daily_ctx['prev_high'] and price >= hi * 0.98,
        'D1_drop_from_high': rise >= 3.0 and (hi / price - 1) * 100 >= 3.0,
        'D2_long_upper_wick': ((hi - max(o, price)) / (hi - lo) >= 0.4 and (hi / lo - 1) * 100 >= 2.0) if hi > lo else False,
        'D3_giveback_half': rise >= 3.0 and (hi - price) >= 0.5 * (hi - o),
        'D4_below_vwap': price < vwap,
        'D5_lower_highs': len(highs) >= 4 and highs[-1] < highs[-2] < max(highs[:-2] or [0]) and max(highs) > highs[-1],
        'P_high_zone': bool(daily_ctx.get('high_zone')),
    }
    out['ABSORB'] = out['A2_intraday_higher_lows'] and out['A3_above_open_vwap'] and out['A4_close_near_high']
    out['DISTRIB'] = out['D1_drop_from_high'] or out['D2_long_upper_wick'] or (out['D3_giveback_half'] and out['D4_below_vwap'])
    out['_rise_pct'] = rise
    out['_drawdown_pct'] = (hi / price - 1) * 100
    return out


def daily_context(daily, day):
    """전일까지의 일봉 맥락(미래 비참조)."""
    idx = next((i for i, r in enumerate(daily) if r[0] == day), None)
    if idx is None or idx < 260:
        return None
    prev = daily[:idx]
    lows = [r[3] for r in prev[-3:]]
    closes = [r[4] for r in prev]
    high250, low250 = max(r[2] for r in prev[-250:]), min(r[3] for r in prev[-250:])
    pos = (closes[-1] - low250) / (high250 - low250) if high250 > low250 else 0.5
    ret20 = closes[-1] / closes[-21] - 1
    vols = [r[5] for r in prev]
    return {'idx': idx, 'prev_vol': prev[-1][5], 'avg20_vol': sum(vols[-20:]) / 20, 'lows_rising': lows[0] < lows[1] < lows[2],
            'prev_high': prev[-1][2], 'prev_close': closes[-1], 'pos250': pos, 'ret20': ret20, 'high_zone': pos >= 0.8 or ret20 >= 0.25}


# ---- 후속 성과 ----
def forward(bars, entry_i, daily, d_ctx):
    """entry_i 번째 봉 시가로 진입(+슬리피지)했을 때의 후속 성과(비용 전 gross %, 순수익 net %)."""
    if entry_i is None or entry_i >= len(bars) - 2:
        return None
    e = bars[entry_i][1] * (1 + SLIP_BUY / 100)
    out = {'entry': e}

    def at(k):
        j = entry_i + k - 1
        return bars[j][4] if j < len(bars) else None
    for k in (5, 15, 30, 60):
        p = at(k)
        out['m%d' % k] = (p * (1 - SLIP_SELL / 100) / e - 1) * 100 if p else None
    rest = bars[entry_i:]
    out['day_high'] = (max(b[2] for b in rest) / e - 1) * 100
    out['day_low'] = (min(b[3] for b in rest) / e - 1) * 100
    close = bars[-1][4]
    out['day_close'] = (close * (1 - SLIP_SELL / 100) / e - 1) * 100
    # 같은 날 +TP% / -SL% 중 먼저 닿는 쪽(같은 봉에 둘 다면 손절로 처리)
    first = 'none'
    for b in rest[1:]:
        up, dn = b[2] >= e * (1 + TP / 100), b[3] <= e * (1 - SL / 100)
        if dn:
            first = 'sl'
            break
        if up:
            first = 'tp'
            break
    out['first'] = first
    # 다음 거래일 시가와 5·10거래일 종가(일봉)
    i = d_ctx['idx']
    if i + 10 < len(daily):
        out['next_open'] = (daily[i + 1][1] * (1 - SLIP_SELL / 100) / e - 1) * 100
        out['d5'] = (daily[i + 5][4] * (1 - SLIP_SELL / 100) / e - 1) * 100
        out['d10'] = (daily[i + 10][4] * (1 - SLIP_SELL / 100) / e - 1) * 100
    return out


def a_same_day(bars, entry_i):
    """엔진 규칙 A를 당일에 한정해 적용(다일 보유 미반영): 손절 -3%(연속 2회)·비상 -5%·고점 +3% 뒤 -2.5%(연속 2회), 15:20 이후 마지막 종가로 청산."""
    e = bars[entry_i][1] * (1 + SLIP_BUY / 100)
    peak, hits = e, 0
    for i in range(entry_i + 1, len(bars) - 1):
        b = bars[i]
        if not ('0901' <= b[0] <= '1520'):
            continue
        price = b[4]
        peak = max(peak, price)
        gain = (price / e - 1) * 100
        if gain <= -5.0:
            return (bars[i + 1][1] * (1 - SLIP_SELL / 100) / e - 1) * 100
        breach = gain <= -3.0 or ((peak / e - 1) * 100 >= 3.0 and price <= peak * (1 - 0.025))
        hits = hits + 1 if breach else 0
        if hits >= 2:
            return (bars[i + 1][1] * (1 - SLIP_SELL / 100) / e - 1) * 100
    return (bars[-1][4] * (1 - SLIP_SELL / 100) / e - 1) * 100


def net(x):
    return None if x is None else x - COST_PCT


def stats(rows, key):
    vals = [net(r[key]) for r in rows if r.get(key) is not None]
    if len(vals) < 1:
        return None
    srt = sorted(vals)
    return {'n': len(vals), 'mean': sum(vals) / len(vals), 'median': srt[len(srt) // 2], 'win': sum(1 for v in vals if v > 0) / len(vals) * 100}


def excess(rows, base_by_day, key):
    """이벤트 net - 같은 날짜 기준선 평균 net. 일 단위로 묶은 평균과 t."""
    per_day = defaultdict(list)
    for r in rows:
        v = net(r.get(key))
        b = base_by_day.get(r['day'], {}).get(key)
        if v is not None and b is not None:
            per_day[r['day']].append(v - b)
    days = [sum(v) / len(v) for v in per_day.values()]
    if len(days) < 5:
        return None
    m = sum(days) / len(days)
    sd = (sum((x - m) ** 2 for x in days) / (len(days) - 1)) ** 0.5
    return {'mean': m, 'days': len(days), 't': m / (sd / len(days) ** 0.5) if sd else None}


def defense_class(fl):
    """09:30 확정 시점의 가격 방어 분류(09:00~09:29 분봉만). DROPPED: 장중 +3% 이상 오른 뒤 고점 대비 3% 이상 하락(D1). DEFENDED: 시가·VWAP 위에서 고점 대비 2% 이내.
    MIXED: 그 밖. 사후(이후 가격)로 나누지 않는다 - 사후 구분은 신호가 아니라 설명용이다."""
    if fl['D1_drop_from_high']:
        return 'DROPPED'
    if fl['A3_above_open_vwap'] and fl['_drawdown_pct'] < 2.0:
        return 'DEFENDED'
    return 'MIXED'


def bucket(value, edges, labels):
    for e, lab in zip(edges, labels):
        if value < e:
            return lab
    return labels[-1]


def stratum(ratio):
    """당일 최종 거래량 / 전일 거래량 층. **표본 선정과 가중치에만 쓴다(장 마감 뒤에야 아는 값). 신호·플래그에는 쓰지 않는다.**"""
    return 'S0' if ratio < 0.3 else 'S1' if ratio < 0.5 else 'S2' if ratio < 1.0 else 'S3' if ratio < 1.5 else 'S4' if ratio < 2.0 else 'S5'


def wmean(pairs):
    """[(값, 가중치)] -> 가중 평균(없으면 None)."""
    tot = sum(w for v, w in pairs if v is not None)
    return sum(v * w for v, w in pairs if v is not None) / tot if tot else None


def load_records(bars_dir, cache_dir, population):
    """받은 모든 종목일을 읽어 레코드로 만든다. 층·가중치(N/n)·자료 품질 표시를 붙인다."""
    files = [f[:-5].split('_') for f in os.listdir(bars_dir) if f.endswith('.json') and f[0].isdigit() and '_' in f]
    daily_cache, records = {}, []
    quality_drop = 0
    for code, day in files:
        bars = [b for b in load_bars(bars_dir, code, day) if '0900' <= b[0] <= '1530']
        if len(bars) < 300 or bars[0][0] != '0900':
            continue
        daily = daily_cache.setdefault(code, load_daily(cache_dir, code))
        ctx = daily_context(daily, day)
        if not ctx or ctx['prev_vol'] <= 0:
            continue
        row = daily[ctx['idx']]
        # 자료 품질: 분봉 합계가 같은 날 일봉 거래량의 90~105%가 아니면(분봉 누락·수정주가 어긋남 등) 쓰지 않는다 - 일봉과 같은 시장·세션 기준인지 확인하는 용도
        q = sum(b[5] for b in bars) / row[5] if row[5] else 0
        if not 0.90 <= q <= 1.05:
            quality_drop += 1
            continue
        rec = {'code': code, 'day': day, 'prev_vol': ctx['prev_vol'], 'avg20': ctx['avg20_vol'], 'pos250': ctx['pos250'], 'ret20': ctx['ret20'],
               'open_gap': (bars[0][1] / ctx['prev_close'] - 1) * 100, 'stratum': stratum(row[5] / ctx['prev_vol']), 'quality': q}
        rec['cross'] = {}
        for lv in LEVELS:
            c = first_cross(bars, ctx['prev_vol'], lv)
            if c:
                k, t = c
                rec['cross'][str(lv)] = {'time': t, 'price': bars[k][4], 'rise_from_open': (bars[k][4] / bars[0][1] - 1) * 100,
                                         'cum_amount': sum(b[4] * b[5] for b in bars[:k + 1]), 'fwd': forward(bars, k + 1, daily, ctx)}
        e30 = next((i for i, b in enumerate(bars) if b[0] == '0930'), None)
        rec['fl'] = flags(bars, ctx)
        rec['fwd30'] = forward(bars, e30, daily, ctx) if e30 is not None else None
        rec['a_day'] = a_same_day(bars, e30) if e30 is not None else None
        records.append(rec)
    # 가중치: (날짜, 층) 칸의 모집단 수 N / 받은 수 n. 받은 수가 0 인 칸은 추정 불가.
    n_cell = defaultdict(int)
    for r in records:
        n_cell[(r['day'], r['stratum'])] += 1
    for r in records:
        pop_n = population.get(r['day'], {}).get(r['stratum'])
        r['w'] = (pop_n / n_cell[(r['day'], r['stratum'])]) if pop_n else None
    return records, n_cell, quality_drop


def run(bands_universe_path, bars_dir, cache_dir, out_path, hits_path=None):
    ub = json.load(open(bands_universe_path, encoding='utf-8')) if os.path.exists(bands_universe_path) else {}
    population = ub.get('population') or {}
    records, n_cell, quality_drop = load_records(bars_dir, cache_dir, population)
    have_pop = bool(population)
    for r in records:
        if r['w'] is None:
            r['w'] = 1.0
    out = {'records': len(records), 'quality_dropped': quality_drop, 'population_known': have_pop, 'levels': {}, 'flags': {}, 'milestones': {}}
    # 0) 층별 포착 범위: 모집단 N, 받은 n, 추출 비율, 층·날짜 칸 중 표본이 없는 칸(추정 불가)
    cover = {}
    for st in ('S0', 'S1', 'S2', 'S3', 'S4', 'S5'):
        n_tot = sum(v for (d, s), v in n_cell.items() if s == st)
        pop_tot = sum(v.get(st, 0) for v in population.values()) if have_pop else None
        empty_pop = sum(v.get(st, 0) for d, v in population.items() if n_cell.get((d, st), 0) == 0) if have_pop else None
        cover[st] = {'population': pop_tot, 'collected': n_tot, 'fraction': round(n_tot / pop_tot * 100, 1) if pop_tot else None,
                     'population_in_empty_cells': empty_pop}
    out['coverage'] = cover
    # 1) 돌파 수준별 이벤트 수와 모집단 추정(가중), 감지 후 성과
    for lv in LEVELS:
        evs = [(r, r['cross'][str(lv)]) for r in records if str(lv) in r['cross']]
        est = sum(r['w'] for r, c in evs) if have_pop else None
        out['levels'][str(lv)] = {'events_sample': len(evs), 'events_est_population': round(est, 1) if est is not None else None,
                                  'by_stratum': {st: sum(1 for r, c in evs if r['stratum'] == st) for st in ('S1', 'S2', 'S3', 'S4', 'S5')}}
        rows = [dict(c['fwd'], day=r['day'], w=r['w']) for r, c in evs if c['fwd']]
        for part, sel in (('all', rows), ('train', [e for e in rows if e['day'] < SPLIT]), ('valid', [e for e in rows if e['day'] >= SPLIT])):
            d = {k: stats(sel, k) for k in ('m5', 'm15', 'm30', 'm60', 'day_close', 'next_open', 'd5', 'd10')}
            for k in ('m60', 'day_close', 'd5'):
                d[k + '_weighted'] = wmean([(net(e.get(k)), e['w']) for e in sel])
            d['first'] = {x: sum(1 for e in sel if e['first'] == x) for x in ('tp', 'sl', 'none')}
            out['levels'][str(lv)][part] = d
    # 2) 감지 시각 구간(09:05~09:30) - 100% 돌파
    for ms in MILESTONES:
        rows = [dict(r['cross']['1.0']['fwd'], day=r['day'], w=r['w']) for r in records if '1.0' in r['cross'] and r['cross']['1.0']['time'] <= ms and r['cross']['1.0']['fwd']]
        out['milestones'][ms] = {'n': len(rows), 'm30': stats(rows, 'm30'), 'day_close': stats(rows, 'day_close'), 'd5': stats(rows, 'd5')}
    # 3) 기준선: 받은 모든 종목일(층 가중)의 09:30 진입 성과 - 같은 날짜끼리 빼서 쓴다
    keys = ('m30', 'm60', 'day_close', 'next_open', 'd5', 'd10', 'a_day')
    base_by_day = defaultdict(dict)
    by_day = defaultdict(list)
    for r in records:
        if r['fwd30']:
            by_day[r['day']].append(r)
    for day, rs in by_day.items():
        for k in keys:
            pairs = [((net(r['fwd30'].get(k)) if k != 'a_day' else net(r['a_day'])), r['w']) for r in rs]
            m = wmean(pairs)
            if m is not None:
                base_by_day[day][k] = m
    out['baseline'] = {k: wmean([((net(r['fwd30'].get(k)) if k != 'a_day' else net(r['a_day'])), r['w']) for r in records if r['fwd30']]) for k in keys}
    # 3-2) 수준별·기간별 초과수익(같은 날짜 기준선 대비)과 감지 시각·거래대금 분포
    for lv in LEVELS:
        evs = [(r, r['cross'][str(lv)]) for r in records if str(lv) in r['cross'] and r['cross'][str(lv)]['fwd']]
        # 기준선은 09:30 진입 기준이라 수준별 감지 후 진입과 시각이 다르다 - 같은 날짜 평균과의 단순 비교임을 보고서에 적는다
        for part, f in (('all', lambda d: True), ('train', lambda d: d < SPLIT), ('valid', lambda d: d >= SPLIT)):
            rows = [dict(c['fwd'], day=r['day']) for r, c in evs if f(r['day'])]
            out['levels'][str(lv)][part]['excess_vs_same_day_baseline'] = {k: excess(rows, base_by_day, k) for k in ('m60', 'day_close', 'd5')}
        times = sorted(c['time'] for r, c in evs)
        amounts = sorted(c['cum_amount'] for r, c in evs)
        if times:
            out['levels'][str(lv)]['detect'] = {'time_median': times[len(times) // 2], 'time_p25': times[len(times) // 4], 'time_p75': times[3 * len(times) // 4],
                                                'cum_amount_eok_median': round(amounts[len(amounts) // 2] / 1e8, 1),
                                                'cum_amount_eok_p25': round(amounts[len(amounts) // 4] / 1e8, 1)}
    # 4) 09:30 확정 플래그(이벤트 = 09:30 이전 100% 돌파)
    ev = [r for r in records if '1.0' in r['cross'] and r['fwd30'] and r['fl']]
    out['flags']['event_n'] = len(ev)
    names = sorted(k for k in (ev[0]['fl'] if ev else {}) if not k.startswith('_'))
    for name in names + ['ALL']:
        sel = [r for r in ev if name == 'ALL' or r['fl'][name]]
        rest = [r for r in ev if name != 'ALL' and not r['fl'][name]]
        entry = {'n': len(sel), 'share': round(len(sel) / len(ev) * 100, 1) if ev else None}
        for part, f in (('all', lambda r: True), ('train', lambda r: r['day'] < SPLIT), ('valid', lambda r: r['day'] >= SPLIT)):
            rows = [dict(r['fwd30'], day=r['day'], a_day=r['a_day'], w=r['w']) for r in sel if f(r)]
            rows_rest = [dict(r['fwd30'], day=r['day'], a_day=r['a_day'], w=r['w']) for r in rest if f(r)]
            entry[part] = {'stats': {k: stats(rows, k) for k in ('m30', 'm60', 'day_close', 'next_open', 'd5', 'd10', 'a_day')},
                           'weighted': {k: wmean([(net(e.get(k)), e['w']) for e in rows]) for k in ('m60', 'day_close', 'd5')},
                           'excess': {k: excess(rows, base_by_day, k) for k in ('m60', 'day_close', 'd5')},
                           'rest': {k: stats(rows_rest, k) for k in ('day_close', 'd5')},
                           'first': {x: sum(1 for e in rows if e.get('first') == x) for x in ('tp', 'sl', 'none')},
                           'mfe': (sum(e['day_high'] for e in rows) / len(rows)) if rows else None, 'mae': (sum(e['day_low'] for e in rows) / len(rows)) if rows else None}
        out['flags'][name] = entry
    # 5) 기존 검색기(전날 스캔 기록)와의 중복
    if hits_path and os.path.exists(hits_path):
        hits = json.load(open(hits_path, encoding='utf-8'))
        seen = defaultdict(set)
        for h in hits:
            seen[h['scanDate']].add(str(h['code']))
        first_scan = min(seen) if seen else None
        flagged = []
        for r in ev:
            if not (first_scan and r['day'] > first_scan):
                continue
            daily = load_daily(cache_dir, r['code'])
            di = next((i for i, x in enumerate(daily) if x[0] == r['day']), None)
            prev_day = daily[di - 1][0] if di else None
            flagged.append((r, prev_day in seen and r['code'] in seen[prev_day]))
        out['overlap'] = {'scan_window_from': first_scan, 'events_in_window': len(flagged), 'overlapped': sum(1 for _, f in flagged if f),
                          'not_overlapped': sum(1 for _, f in flagged if not f)}
        for label, want in (('overlapped', True), ('not_overlapped', False)):
            rows = [dict(r['fwd30'], day=r['day'], a_day=r['a_day'], w=r['w']) for r, f in flagged if f == want]
            out['overlap'][label + '_stats'] = {k: stats(rows, k) for k in ('m60', 'day_close', 'next_open', 'd5', 'a_day')}
            out['overlap'][label + '_excess'] = {k: excess(rows, base_by_day, k) for k in ('m60', 'day_close', 'd5')}
    # 4-2) 가격 방어 성공 / 고점 대비 급락 / 혼합 (100% 돌파 이벤트, 09:30 확정)
    out['defense'] = {}
    for cls in ('DEFENDED', 'MIXED', 'DROPPED'):
        sel = [r for r in ev if defense_class(r['fl']) == cls]
        entry = {'n': len(sel), 'share': round(len(sel) / len(ev) * 100, 1) if ev else None}
        for part, f in (('all', lambda r: True), ('train', lambda r: r['day'] < SPLIT), ('valid', lambda r: r['day'] >= SPLIT)):
            rows = [dict(r['fwd30'], day=r['day'], a_day=r['a_day'], w=r['w']) for r in sel if f(r)]
            entry[part] = {'stats': {k: stats(rows, k) for k in ('m60', 'day_close', 'next_open', 'd5', 'd10', 'a_day')},
                           'excess': {k: excess(rows, base_by_day, k) for k in ('m60', 'day_close', 'd5')},
                           'weighted': {k: wmean([(net(e.get(k)), e['w']) for e in rows]) for k in ('m60', 'day_close', 'd5')},
                           'first': {x: sum(1 for e in rows if e.get('first') == x) for x in ('tp', 'sl', 'none')},
                           'mfe': (sum(e['day_high'] for e in rows) / len(rows)) if rows else None, 'mae': (sum(e['day_low'] for e in rows) / len(rows)) if rows else None}
        out['defense'][cls] = entry
    # 4-3) 100% 돌파의 감지 프로필: 감지 시점 시가 대비 상승률·시가 갭 구간별 감지 후 성과
    prof = {'by_rise_at_detection': {}, 'by_open_gap': {}, 'by_detect_time': {}}
    labels_rise = ['<2%', '2~5%', '5~10%', '>=10%']
    labels_gap = ['<0%', '0~2%', '2~5%', '>=5%']
    labels_time = ['~09:10', '09:10~09:20', '09:20~09:30']
    groups = {'by_rise_at_detection': (lambda r, c: bucket(c['rise_from_open'], [2, 5, 10], labels_rise), labels_rise),
              'by_open_gap': (lambda r, c: bucket(r['open_gap'], [0, 2, 5], labels_gap), labels_gap),
              'by_detect_time': (lambda r, c: bucket(c['time'], ['0910', '0920'], labels_time), labels_time)}
    for gname, (fn, labs) in groups.items():
        for lab in labs:
            rows = [dict(c['fwd'], day=r['day'], w=r['w']) for r in records if '1.0' in r['cross'] for c in [r['cross']['1.0']] if c['fwd'] and fn(r, c) == lab]
            prof[gname][lab] = {'n': len(rows), 'stats': {k: stats(rows, k) for k in ('m60', 'day_close', 'd5')},
                                'excess': {k: excess(rows, base_by_day, k) for k in ('day_close', 'd5')}}
    out['detect_profile'] = prof
    # 4-4) 선택 편향 점검: 층별 이벤트 수·모집단 추정·0건 층의 상한(3의 법칙), 표본 평균 대 가중 평균
    sel_chk = {}
    for st in ('S1', 'S2', 'S3', 'S4', 'S5'):
        rs = [r for r in records if r['stratum'] == st]
        evs = [r for r in rs if '1.0' in r['cross']]
        pop_n = sum(v.get(st, 0) for v in population.values()) if have_pop else None
        est = sum(r['w'] for r in evs) if have_pop else None
        sel_chk[st] = {'collected': len(rs), 'events100': len(evs), 'population': pop_n, 'est_events': round(est, 1) if est is not None else None,
                       'event_rate_pct': round(len(evs) / len(rs) * 100, 2) if rs else None,
                       'upper95_events_if_zero': (round(3 / len(rs) * pop_n, 0) if rs and not evs and pop_n else None)}
    out['selection_check'] = sel_chk
    out['events_list'] = [{'code': r['code'], 'day': r['day'], 'time': r['cross']['1.0']['time'], 'stratum': r['stratum']} for r in records if '1.0' in r['cross']]
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('records', len(records), 'quality_dropped', quality_drop, 'events(100%)', len(out['events_list']))


if __name__ == '__main__':
    run(*sys.argv[1:6])
