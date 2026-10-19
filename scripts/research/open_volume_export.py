# -*- coding: utf-8 -*-
"""시초 30분 거래량 돌파 연구의 공개 가능한 산출물을 만든다(연구 전용, 비밀정보·원자료 없음).

입력: 받아 둔 키움 1분봉 폴더(open_volume_collect.py 결과) + 네이버 일봉 캐시 + universe_bands.json.
출력(모두 CSV/MD, 종목코드·날짜·가격·비율만 있고 키·계좌·토큰·분봉 원자료는 없다):
  sample_items.csv     받은 종목일 하나가 한 줄: 층, 가중치, 자료 품질, 수준별 돌파 여부
  sampling_frame.csv   날짜 x 층의 모집단 수 N, 받은 수 n, 가중치 N/n
  events.csv           (종목일 x 돌파 수준 30/50/100/150%) 한 줄: 감지 시각·가격·진입가·이후 수익률·MFE/MAE·09:30 분류
사용: python open_volume_export.py <openvol 폴더> <네이버 캐시> <out 폴더> [universe_bands.json]
"""
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from open_volume_study import LEVELS, defense_class, load_records  # noqa: E402

RET_KEYS = ('m5', 'm15', 'm30', 'm60', 'day_close', 'next_open', 'd5', 'd10')
FLAG_KEYS = ('A1_prior_lows_rising', 'A2_intraday_higher_lows', 'A3_above_open_vwap', 'A4_close_near_high', 'A5_pullback_volume_drop',
             'A6_rebound_volume_up', 'A7_break_prior_high_hold', 'D1_drop_from_high', 'D2_long_upper_wick', 'D3_giveback_half', 'D4_below_vwap',
             'D5_lower_highs', 'P_high_zone', 'ABSORB', 'DISTRIB')


def r4(x):
    return '' if x is None else ('%.4f' % x if isinstance(x, float) else x)


def build(bars_dir, cache_dir, universe_path):
    ub = json.load(open(universe_path, encoding='utf-8')) if universe_path and os.path.exists(universe_path) else {}
    population = ub.get('population') or {}
    records, n_cell, _ = load_records(bars_dir, cache_dir, population)
    for r in records:
        if r['w'] is None:
            r['w'] = 1.0
    return records, n_cell, population


def write_all(records, n_cell, population, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    # 1) 표본 목록
    with open(os.path.join(out_dir, 'sample_items.csv'), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['code', 'day', 'stratum', 'weight', 'minute_vs_daily_volume'] + ['cross_%d' % round(lv * 100) for lv in LEVELS])
        for r in sorted(records, key=lambda r: (r['day'], r['code'])):
            w.writerow([r['code'], r['day'], r['stratum'], r4(r['w']), r4(r['quality'])] + [1 if str(lv) in r['cross'] else 0 for lv in LEVELS])
    # 2) 표집 틀
    with open(os.path.join(out_dir, 'sampling_frame.csv'), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['day', 'stratum', 'population_N', 'collected_n', 'weight_N_over_n'])
        for day in sorted(population):
            for st in ('S0', 'S1', 'S2', 'S3', 'S4', 'S5'):
                N, n = population[day].get(st, 0), n_cell.get((day, st), 0)
                w.writerow([day, st, N, n, r4(N / n) if n else ''])
    # 3) 이벤트 표
    cols = (['code', 'day', 'level_pct', 'stratum', 'weight', 'prev_day_volume', 'open_gap_pct', 'detect_time_hhmm', 'detect_price', 'rise_from_open_pct',
             'cum_amount_won', 'entry_price'] + ['gross_%s_pct' % k for k in RET_KEYS] +
            ['net_%s_pct' % k for k in ('m60', 'day_close', 'd5')] + ['mfe_pct', 'mae_pct', 'first_touch_tp4_sl3', 'defense_class_0930'] + list(FLAG_KEYS))
    n_rows = 0
    with open(os.path.join(out_dir, 'events.csv'), 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in sorted(records, key=lambda r: (r['day'], r['code'])):
            for lv in LEVELS:
                c = r['cross'].get(str(lv))
                if not c or not c['fwd']:
                    continue
                fw, fl = c['fwd'], r['fl']
                cls = defense_class(fl) if fl else ''
                row = [r['code'], r['day'], round(lv * 100), r['stratum'], r4(r['w']), r['prev_vol'], r4(r['open_gap']), c['time'], r4(c['price']),
                       r4(c['rise_from_open']), round(c['cum_amount']), r4(fw['entry'])]
                row += [r4(fw.get(k)) for k in RET_KEYS]
                row += [r4(fw.get(k) - 0.7 if fw.get(k) is not None else None) for k in ('m60', 'day_close', 'd5')]
                row += [r4(fw['day_high']), r4(fw['day_low']), fw['first'], cls]
                row += [(int(bool(fl[k])) if fl else '') for k in FLAG_KEYS]
                w.writerow(row)
                n_rows += 1
    return n_rows


if __name__ == '__main__':
    bars, cache, out = sys.argv[1:4]
    uni = sys.argv[4] if len(sys.argv) > 4 else os.path.join(bars, 'universe_bands.json')
    recs, ncell, pop = build(bars, cache, uni)
    print('events rows', write_all(recs, ncell, pop, out), 'items', len(recs))
