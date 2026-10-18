# -*- coding: utf-8 -*-
"""100% 돌파 이벤트의 '+4% 먼저(익절 279건)' 대 '-3% 먼저(손절 466건)' 비교 연구(연구용, 실전 연결 없음 - 2026-10-18).

물음: (1) 익절군에는 있고 손절군에는 부족한 공통 신호는 무엇인가? (2) 그 신호를 **매수 전에** 알 수 있었는가?
자료: 이미 받아 둔 1분봉(open_volume_study.load_records 와 같은 종목일, 다시 받지 않음). 진입 = 감지 확정 봉의 다음 봉 시가 + 0.10%.
특징은 시점별로 나눠 분류한다. PRE = 진입 전(감지 봉까지의 봉만), POST1/POST3 = 진입 뒤 첫 1분·3분(진입 봉 포함). POST 는 **진입 뒤에 아는 값**이라
PRE 와 섞어 '매수 전 신호'로 부르지 않는다. 5분 뒤 방향 같은 결과값은 특징으로 쓰지 않는다.
POST 규칙 검증은 '관찰 뒤 진입'으로 한다: 첫 N분을 보고 통과한 이벤트만 N분 뒤 봉 시가(+슬리피지)에 새로 진입해 같은 +4/-3 규칙으로 다시 잰다.
익절/손절 판정은 open_volume_study.forward 와 같다(진입 다음 봉부터 검사, 같은 봉에 둘 다면 손절).
"""
import csv
import json
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from open_volume_study import (COST_PCT, SL, SLIP_BUY, SPLIT, TP, daily_context, first_cross, forward, load_bars, load_daily)  # noqa: E402

LEVEL = 1.0


def touch_info(bars, entry_i):
    """forward 와 같은 규칙으로 판정과 걸린 분(진입 봉부터 센 경과 분)을 돌려준다."""
    e = bars[entry_i][1] * (1 + SLIP_BUY / 100)
    for j in range(entry_i + 1, len(bars)):
        b = bars[j]
        if b[3] <= e * (1 - SL / 100):
            return 'sl', j - entry_i
        if b[2] >= e * (1 + TP / 100):
            return 'tp', j - entry_i
    return 'none', None


def vwap(bars):
    pv = sum((b[2] + b[3] + b[4]) / 3 * b[5] for b in bars)
    v = sum(b[5] for b in bars)
    return pv / v if v else bars[-1][4]


def pre_features(bars, k, ctx):
    """감지 봉 k(포함)까지만 쓰는 진입 전 특징."""
    seen = bars[:k + 1]
    last = seen[-1]
    o = seen[0][1]
    hi, lo = max(b[2] for b in seen), min(b[3] for b in seen)
    cum_v = sum(b[5] for b in seen)
    recent = seen[-3:]
    prior = seen[-8:-3] or seen[:1]
    vol_recent = sum(b[5] for b in recent) / len(recent)
    vol_prior = sum(b[5] for b in prior) / len(prior)
    return {
        'pre_time_min': int(last[0][:2]) * 60 + int(last[0][2:]) - 540,
        'pre_rise_from_open': (last[4] / o - 1) * 100,
        'pre_open_gap': (o / ctx['prev_close'] - 1) * 100,
        'pre_cum_volx': cum_v / ctx['prev_vol'],                                   # 감지 때 전일 거래량의 몇 배(100% 문턱을 넘은 정도)
        'pre_cum_amount_eok': sum(b[4] * b[5] for b in seen) / 1e8,
        'pre_last3_vol_share': sum(b[5] for b in recent) / cum_v,                   # 거래량이 막판에 몰렸나(폭발) 완만히 쌓였나
        'pre_vol_accel': vol_recent / vol_prior if vol_prior else 0.0,
        'pre_drawdown_from_high': (hi / last[4] - 1) * 100,
        'pre_pos_in_range': (last[4] - lo) / (hi - lo) if hi > lo else 0.5,
        'pre_above_vwap': 1.0 if last[4] > vwap(seen) else 0.0,
        'pre_up_bars_last5': sum(1 for b in seen[-5:] if b[4] > b[1]),
        'pre_last_bar_range_pct': (last[2] / last[3] - 1) * 100 if last[3] else 0.0,
        'pre_last_bar_upper_wick': ((last[2] - max(last[1], last[4])) / (last[2] - last[3])) if last[2] > last[3] else 0.0,
        'pre_pos250': ctx['pos250'], 'pre_ret20': ctx['ret20'],
        'pre_high_zone': 1.0 if ctx['high_zone'] else 0.0,
        'pre_prior_lows_rising': 1.0 if ctx['lows_rising'] else 0.0,
    }


def post_features(bars, i, n):
    """진입 봉 i 부터 n분(진입 봉 포함)의 흐름. 진입 뒤에만 아는 값."""
    e = bars[i][1] * (1 + SLIP_BUY / 100)
    w = bars[i:i + n]
    before = bars[max(0, i - 5):i]
    base_v = sum(b[5] for b in before) / len(before) if before else 0.0
    t = 'post%d_' % n
    return {
        t + 'low_vs_entry': (min(b[3] for b in w) / e - 1) * 100,
        t + 'high_vs_entry': (max(b[2] for b in w) / e - 1) * 100,
        t + 'close_vs_entry': (w[-1][4] / e - 1) * 100,
        t + 'vol_vs_pre5': (sum(b[5] for b in w) / len(w)) / base_v if base_v else 0.0,
        t + 'up_bars': float(sum(1 for b in w if b[4] > b[1])),
    }


def auc(pos, neg):
    """P(익절군 값 > 손절군 값), 동률은 0.5 (순위 기반)."""
    if not pos or not neg:
        return None
    allv = sorted([(v, 1) for v in pos] + [(v, 0) for v in neg])
    ranks, i = {}, 0
    while i < len(allv):
        j = i
        while j + 1 < len(allv) and allv[j + 1][0] == allv[i][0]:
            j += 1
        r = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks.setdefault(id(allv[k]), r)
        i = j + 1
    rs = sum(ranks[id(a)] for a in allv if a[1] == 1)
    return (rs - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def mean_sd(xs):
    m = sum(xs) / len(xs)
    sd = math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1)) if len(xs) > 1 else 0.0
    return m, sd


def compare(rows, keys):
    """특징별: 익절군/손절군 평균·중앙값, 표준화 차이(d), AUC, 학습·검증 AUC."""
    out = {}
    for key in keys:
        tp = [r[key] for r in rows if r['label'] == 'tp']
        sl = [r[key] for r in rows if r['label'] == 'sl']
        if len(tp) < 5 or len(sl) < 5:
            continue
        (m1, s1), (m0, s0) = mean_sd(tp), mean_sd(sl)
        pooled = math.sqrt(((len(tp) - 1) * s1 ** 2 + (len(sl) - 1) * s0 ** 2) / (len(tp) + len(sl) - 2)) or 1e-9
        a_tr = auc([r[key] for r in rows if r['label'] == 'tp' and r['day'] < SPLIT], [r[key] for r in rows if r['label'] == 'sl' and r['day'] < SPLIT])
        a_va = auc([r[key] for r in rows if r['label'] == 'tp' and r['day'] >= SPLIT], [r[key] for r in rows if r['label'] == 'sl' and r['day'] >= SPLIT])
        out[key] = {'tp_mean': m1, 'sl_mean': m0, 'tp_median': sorted(tp)[len(tp) // 2], 'sl_median': sorted(sl)[len(sl) // 2],
                    'd': (m1 - m0) / pooled, 'auc': auc(tp, sl), 'auc_train': a_tr, 'auc_valid': a_va}
    return out


def build_rows(bars_dir, cache_dir, members):
    """members: [(code, day)] 100% 돌파 이벤트. 레코드 하나당 PRE/POST 특징과 판정."""
    rows, daily_cache = [], {}
    for code, day in members:
        bars = [b for b in load_bars(bars_dir, code, day) if '0900' <= b[0] <= '1530']
        if len(bars) < 300 or bars[0][0] != '0900':
            continue
        daily = daily_cache.setdefault(code, load_daily(cache_dir, code))
        ctx = daily_context(daily, day)
        if not ctx or ctx['prev_vol'] <= 0:
            continue
        c = first_cross(bars, ctx['prev_vol'], LEVEL)
        if not c:
            continue
        k, _ = c
        i = k + 1
        if i + 4 >= len(bars) - 2:
            continue
        label, minutes = touch_info(bars, i)
        row = {'code': code, 'day': day, 'label': label, 'touch_min': minutes, 'entry_i': i}
        row.update(pre_features(bars, k, ctx))
        row.update(post_features(bars, i, 1))
        row.update(post_features(bars, i, 3))
        row['five_min_dir'] = 1 if bars[i + 4][4] > bars[i][1] * (1 + SLIP_BUY / 100) else 0      # 사용자 집계 재현용 진행 정보(특징으로 쓰지 않음)
        # 관찰 뒤 진입 결과(N분 뒤 새 진입)
        for n in (1, 3):
            f = forward(bars, i + n, daily, ctx)
            row['after%d' % n] = ({'label': touch_info(bars, i + n)[0], 'day_close': f['day_close'] - COST_PCT, 'm60': (f['m60'] - COST_PCT) if f.get('m60') is not None else None,
                                   'd5': (f['d5'] - COST_PCT) if f.get('d5') is not None else None} if f else None)
        f0 = forward(bars, i, daily, ctx)
        row['net_day_close'] = f0['day_close'] - COST_PCT if f0 else None
        row['net_m60'] = (f0['m60'] - COST_PCT) if f0 and f0.get('m60') is not None else None
        row['net_d5'] = (f0['d5'] - COST_PCT) if f0 and f0.get('d5') is not None else None
        rows.append(row)
    return rows


def rule_eval(rows, name, pass_fn, n):
    """관찰 N분 뒤 통과한 이벤트만 N분 뒤 새로 진입. 반환: 건수·익절/손절/미도달·당일 종가 평균·5일 평균(train/valid 분리)."""
    def agg(sel):
        res = [r['after%d' % n] for r in sel if r['after%d' % n]]
        if not res:
            return {'n': 0}
        d5 = [x['d5'] for x in res if x['d5'] is not None]
        return {'n': len(res), 'tp': sum(1 for x in res if x['label'] == 'tp'), 'sl': sum(1 for x in res if x['label'] == 'sl'),
                'none': sum(1 for x in res if x['label'] == 'none'), 'day_close': sum(x['day_close'] for x in res) / len(res),
                'd5': (sum(d5) / len(d5)) if d5 else None}
    kept = [r for r in rows if pass_fn(r)]
    return {'name': name, 'n_obs': n, 'all': agg(kept), 'train': agg([r for r in kept if r['day'] < SPLIT]), 'valid': agg([r for r in kept if r['day'] >= SPLIT]),
            'skipped': agg([r for r in rows if not pass_fn(r)])}


def main(events_csv, bars_dir, cache_dir, out_json):
    members = [(r['code'], r['day']) for r in csv.DictReader(open(events_csv, encoding='utf-8')) if r['level_pct'] == '100']
    rows = build_rows(bars_dir, cache_dir, members)
    keys = sorted(k for k in rows[0] if k.startswith(('pre_', 'post')))
    res = {'n_events': len(rows), 'labels': {x: sum(1 for r in rows if r['label'] == x) for x in ('tp', 'sl', 'none')}}
    # 걸린 시간
    for lab in ('tp', 'sl'):
        ts = sorted(r['touch_min'] for r in rows if r['label'] == lab)
        res['touch_min_' + lab] = {'median': ts[len(ts) // 2], 'p25': ts[len(ts) // 4], 'p75': ts[3 * len(ts) // 4],
                                   'within5': sum(1 for t in ts if t <= 5), 'within15': sum(1 for t in ts if t <= 15), 'n': len(ts)}
    # 5분 뒤 방향(사용자 집계 재현): 진입 후 5번째 봉 종가가 진입가보다 위인가
    res['five_min_up'] = {lab: [sum(1 for r in rows if r['label'] == lab and r['five_min_dir']), sum(1 for r in rows if r['label'] == lab)] for lab in ('tp', 'sl', 'none')}
    res['compare'] = compare(rows, keys)
    # 매수 전에 알 수 있는 규칙과 첫 1·3분 규칙
    res['rules'] = []
    base = {'name': 'ALL(대조: 감지 즉시 진입)', 'n_obs': 0}
    res['rules'].append(rule_eval(rows, 'ALL(관찰 없이 통과, 1분 뒤 진입)', lambda r: True, 1))
    res['rules'].append(rule_eval(rows, 'ALL(관찰 없이 통과, 3분 뒤 진입)', lambda r: True, 3))
    res['rules'].append(rule_eval(rows, '첫 1분 종가가 진입가 위', lambda r: r['post1_close_vs_entry'] > 0, 1))
    res['rules'].append(rule_eval(rows, '첫 1분 저점이 진입가 -1% 위', lambda r: r['post1_low_vs_entry'] > -1.0, 1))
    res['rules'].append(rule_eval(rows, '첫 3분 종가가 진입가 위', lambda r: r['post3_close_vs_entry'] > 0, 3))
    res['rules'].append(rule_eval(rows, '첫 3분 저점이 진입가 -1.5% 위', lambda r: r['post3_low_vs_entry'] > -1.5, 3))
    res['rules'].append(rule_eval(rows, '첫 3분 저점 -1.5% 위 & 거래량 감소 아님(>=1배)', lambda r: r['post3_low_vs_entry'] > -1.5 and r['post3_vol_vs_pre5'] >= 1.0, 3))
    res['rules'].append(rule_eval(rows, '첫 3분 저점 -1.5% 위 & 종가 위 & 상승봉 2개 이상', lambda r: r['post3_low_vs_entry'] > -1.5 and r['post3_close_vs_entry'] > 0 and r['post3_up_bars'] >= 2, 3))
    # PRE 만 쓰는 규칙(진입 시점에 판단): 건수·익절률·당일/5일 평균은 진입 전 규칙이라 원래 진입 결과를 쓴다
    def pre_rule(name, fn):
        kept = [r for r in rows if fn(r)]
        skip = [r for r in rows if not fn(r)]

        def a(sel):
            d5 = [r['net_d5'] for r in sel if r['net_d5'] is not None]
            return {'n': len(sel), 'tp': sum(1 for r in sel if r['label'] == 'tp'), 'sl': sum(1 for r in sel if r['label'] == 'sl'), 'none': sum(1 for r in sel if r['label'] == 'none'),
                    'day_close': (sum(r['net_day_close'] for r in sel if r['net_day_close'] is not None) / len(sel)) if sel else None, 'd5': (sum(d5) / len(d5)) if d5 else None}
        return {'name': name, 'kept': a(kept), 'kept_train': a([r for r in kept if r['day'] < SPLIT]), 'kept_valid': a([r for r in kept if r['day'] >= SPLIT]), 'skipped': a(skip)}
    res['pre_rules'] = [
        pre_rule('ALL(진입 전 규칙 없음)', lambda r: True),
        pre_rule('감지 시 시가 대비 +10% 미만', lambda r: r['pre_rise_from_open'] < 10),
        pre_rule('감지 시 시가 대비 +5% 미만', lambda r: r['pre_rise_from_open'] < 5),
        pre_rule('고점 대비 하락 1% 미만 & VWAP 위', lambda r: r['pre_drawdown_from_high'] < 1 and r['pre_above_vwap'] > 0),
        pre_rule('거래량 완만(마지막 3분 점유 <50%)', lambda r: r['pre_last3_vol_share'] < 0.5),
        pre_rule('거래량 폭발(마지막 3분 점유 >=50%)', lambda r: r['pre_last3_vol_share'] >= 0.5),
        pre_rule('최근 5봉 중 상승봉 3개 이상', lambda r: r['pre_up_bars_last5'] >= 3),
    ]
    json.dump(res, open(out_json, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    # 특징 표 저장(공개 가능: 종목코드·날짜·수치만)
    out_csv = os.path.splitext(out_json)[0] + '_features.csv'
    cols = ['code', 'day', 'label', 'touch_min'] + keys
    with open(out_csv, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in sorted(rows, key=lambda r: (r['day'], r['code'])):
            w.writerow([r[c] if not isinstance(r[c], float) else round(r[c], 4) for c in cols])
    print('events', len(rows), res['labels'])


if __name__ == '__main__':
    main(*sys.argv[1:5])
