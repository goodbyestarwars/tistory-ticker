# -*- coding: utf-8 -*-
"""단타 집중: '전일 거래량 100%가 장 시작 15분 안에 터진' 이벤트 x '시가 대비 +5% 이상' x '저점 상승'의 조합별 성과(연구용, 2026-10-18).

모두 감지 시점(진입 전)에 아는 값이다. 시가 대비 상승률 = 감지 봉 종가 / 당일 시가(전일 종가 기준 아님). 진입 = 감지 다음 봉 시가 + 0.10%.
저점 상승 = 감지 봉까지 최근 9분을 3분씩 나눈 구간 저점이 계속 높아짐(w1<w2<w3). 기준선 = 같은 날짜 전체 표본(층 가중) 09:30 진입 평균.
사용: python open_volume_fast15.py <1분봉 폴더> <네이버 캐시> <universe_bands.json> <out.json>
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from open_volume_study import COST_PCT, SPLIT, excess, first_cross, load_records, net, stats, wmean  # noqa: E402

CUT = '0915'          # 확정 시각 기준 15분 안(09:00 시작 기준 감지 봉 09:14까지)


def higher_lows(seen):
    if len(seen) < 9:
        return False
    w = [min(b[3] for b in seen[-9:-6]), min(b[3] for b in seen[-6:-3]), min(b[3] for b in seen[-3:])]
    return w[0] < w[1] < w[2]


def main(bars_dir, cache_dir, uni_path, out_path):
    ub = json.load(open(uni_path, encoding='utf-8'))
    records, _, _ = load_records(bars_dir, cache_dir, ub.get('population') or {})
    for r in records:
        r['w'] = r['w'] or 1.0
    base = defaultdict(list)
    for r in records:
        if r['fwd30']:
            base[r['day']].append((net(r['fwd30']['day_close']), net(r['fwd30'].get('m60')), r['w']))
    base_by_day = {d: {'day_close': wmean([(a, w) for a, b, w in v]), 'm60': wmean([(b, w) for a, b, w in v])} for d, v in base.items()}
    rows = []
    for r in records:
        c = r['cross'].get('1.0')
        if not c or not c['fwd'] or c['time'] > CUT:
            continue
        bars = [b for b in __import__('open_volume_study').load_bars(bars_dir, r['code'], r['day']) if '0900' <= b[0] <= '1530']
        k = next(i for i, b in enumerate(bars) if __import__('open_volume_study').minute_add(b[0], 1) == c['time'])
        rows.append(dict(c['fwd'], day=r['day'], w=r['w'], rise=c['rise_from_open'], hl=higher_lows(bars[:k + 1]), time=c['time'], amount=c['cum_amount']))
    groups = {
        '15분 안 100% (전체)': lambda x: True,
        '+ 시가 대비 5% 이상': lambda x: x['rise'] >= 5,
        '+ 시가 대비 5% 미만': lambda x: x['rise'] < 5,
        '+ 저점 상승': lambda x: x['hl'],
        '+ 저점 상승 아님': lambda x: not x['hl'],
        '시가 5%+ & 저점 상승': lambda x: x['rise'] >= 5 and x['hl'],
        '시가 5%+ & 저점 상승 아님': lambda x: x['rise'] >= 5 and not x['hl'],
        '시가 5% 미만 & 저점 상승': lambda x: x['rise'] < 5 and x['hl'],
        '시가 3~5% & 저점 상승': lambda x: 3 <= x['rise'] < 5 and x['hl'],
        '시가 8%+ (이미 급등)': lambda x: x['rise'] >= 8,
    }
    out = {'n_events_15min': len(rows)}
    for name, f in groups.items():
        entry = {}
        for part, pf in (('all', lambda d: True), ('train', lambda d: d < SPLIT), ('valid', lambda d: d >= SPLIT)):
            sel = [x for x in rows if f(x) and pf(x['day'])]
            entry[part] = {'n': len(sel), 'stats': {k: stats(sel, k) for k in ('m15', 'm60', 'day_close', 'd5')},
                           'excess_day_close': excess(sel, base_by_day, 'day_close') if len(sel) >= 3 else None,
                           'first': {x: sum(1 for e in sel if e['first'] == x) for x in ('tp', 'sl', 'none')},
                           'mfe': sum(e['day_high'] for e in sel) / len(sel) if sel else None, 'mae': sum(e['day_low'] for e in sel) / len(sel) if sel else None}
        out[name] = entry
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('events', len(rows))


if __name__ == '__main__':
    main(*sys.argv[1:5])
