# -*- coding: utf-8 -*-
"""자동매매 규칙(손절 -3%, 익절 3~5%) 백테스트 - 차트검색 검색기별 (2026-10-11, 오프라인 전용·운영 VM 무관).

신호일 D의 판정은 daily[:D+1]만 사용(look-ahead 없음). 진입은 D+1 시가에 지정가 체결로 가정(시가*1.002),
D+1 시가가 D 종가보다 GAP_SKIP 이상 높으면 매수하지 않는다. 청산 규칙(일봉 근사, 보수적 순서):
  - 손절: 저가 <= 진입가*(1-stop) -> 진입가*(1-stop) 에서 슬리피지만큼 불리하게 체결
  - 익절 상한: 고가 >= 진입가*1.05 -> 1.05에서 체결(슬리피지 반영)
  - 익절 하한: 이전 봉에서 고가가 +3%를 넘긴 적이 있고 오늘 저가가 +3% 이하 -> +3%에서 체결(슬리피지 반영),
    오늘 처음 +3%를 넘겼다가 종가가 +3% 아래면 그날 +3%에서 체결
  - 같은 봉에서 손절과 익절이 모두 가능하면 손절 먼저(보수적)
  - 최대 보유 MAX_HOLD 거래일, 마지막 날 종가 청산
비용: 왕복 0.4% + 청산 슬리피지 0.3%. 기준선(BASELINE)은 같은 종목·기간의 3일마다 아무 날이나 같은 규칙으로 진입.
사용: python exit_rule_backtest.py --db bt.db --out result.json
"""
import argparse
import json
import os
import sqlite3
import statistics
import sys
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(REPO, 'scripts', 'cloud-vm'))
sys.path.insert(0, os.path.join(REPO, 'scripts', 'analysis'))
sys.path.insert(0, HERE)

import signal_backtest as sb  # noqa: E402

COOLDOWN = 5
GAP_SKIP = 0.02
ENTRY_SLIP = 0.002
EXIT_SLIP = 0.003
COST = 0.004
MAX_HOLD = 10
FLOOR, CAP = 0.03, 0.05
STOPS = (0.03, 0.04, 0.05)
SCANNERS = ('maCloudBreakout', 'doubleBottom', 'invHeadShoulders', 'pullback', 'shortTermMaBreakout')
MIN_SCORE = {'doubleBottom': 70, 'invHeadShoulders': 70, 'pullback': 80}


def simulate(daily, i, stop):
    """신호일 인덱스 i. 반환: dict(ret, reason, days, gap) 또는 None(진입 안 함/데이터 부족)."""
    if i + 1 >= len(daily):
        return None
    prev_close = daily[i]['close']
    open_ = daily[i + 1]['open']
    if not open_ or not prev_close:
        return None
    gap = open_ / prev_close - 1
    if gap >= GAP_SKIP:
        return {'skipped': True, 'gap': gap}
    entry = open_ * (1 + ENTRY_SLIP)
    armed = False
    last = min(len(daily) - 1, i + MAX_HOLD)
    for k in range(i + 1, last + 1):
        bar = daily[k]
        lo, hi, cl = bar['low'], bar['high'], bar['close']
        if lo <= entry * (1 - stop):
            return _done(entry * (1 - stop) * (1 - EXIT_SLIP), entry, 'STOP', k - i, gap)
        if hi >= entry * (1 + CAP):
            return _done(entry * (1 + CAP) * (1 - EXIT_SLIP / 3), entry, 'TP_CAP', k - i, gap)
        if armed and lo <= entry * (1 + FLOOR):
            return _done(entry * (1 + FLOOR) * (1 - EXIT_SLIP), entry, 'TP_FLOOR', k - i, gap)
        if hi >= entry * (1 + FLOOR):
            if cl < entry * (1 + FLOOR):
                return _done(entry * (1 + FLOOR) * (1 - EXIT_SLIP), entry, 'TP_FLOOR', k - i, gap)
            armed = True
        if k == last:
            return _done(cl * (1 - EXIT_SLIP / 3), entry, 'TIMEOUT', k - i, gap)
    return None


def _done(exit_price, entry, reason, days, gap):
    return {'skipped': False, 'ret': exit_price / entry - 1 - COST, 'reason': reason, 'days': days, 'gap': gap}


def for_stock(args):
    db, code = args
    import pattern_detect as pdx
    conn = sqlite3.connect(db)
    daily = sb.load(conn, code)
    conn.close()
    n = len(daily)
    if n < 160 or pdx.is_excluded_stock({'code': code, 'name': ''}, daily):
        return []
    detectors = {
        'maCloudBreakout': pdx.detect_ma_cloud_breakout, 'doubleBottom': pdx.detect_double_bottom,
        'invHeadShoulders': pdx.detect_inv_head_shoulders, 'pullback': pdx.detect_pullback,
        'shortTermMaBreakout': pdx.detect_short_ma_breakout,
    }
    rows, last_signal = [], {}
    for i in range(120, n - 1):
        if i % 3 == 0:
            rows.append(('BASELINE', i, daily[i]['date']))
        window = daily[:i + 1]
        for name, fn in detectors.items():
            if i + 1 < sb.MIN_HISTORY[name] or i - last_signal.get(name, -999) <= COOLDOWN:
                continue
            try:
                d = fn(window)
            except Exception:
                d = None
            if d is not None and not d.get('breakout') and (d.get('score') or 0) >= MIN_SCORE.get(name, 0):
                last_signal[name] = i
                rows.append((name, i, daily[i]['date']))
    out = []
    for name, i, date in rows:
        for stop in STOPS:
            res = simulate(daily, i, stop)
            if res:
                out.append(dict(res, scanner=name, date=date, code=code, stop=stop))
    return out


def summarize(rows):
    taken = [r for r in rows if not r.get('skipped')]
    if not taken:
        return {'n': 0, 'skipped': len([r for r in rows if r.get('skipped')])}
    rets = [r['ret'] for r in taken]
    reasons = {}
    for r in taken:
        reasons[r['reason']] = reasons.get(r['reason'], 0) + 1
    wins = [x for x in rets if x > 0]
    losses = [x for x in rets if x <= 0]
    return {'n': len(taken), 'skipped': len(rows) - len(taken), 'avg': sum(rets) / len(rets), 'med': statistics.median(rets),
            'win': len(wins) / len(rets), 'avgWin': (sum(wins) / len(wins)) if wins else None,
            'avgLoss': (sum(losses) / len(losses)) if losses else None,
            'avgDays': sum(r['days'] for r in taken) / len(taken),
            'reasons': {k: round(v / len(taken), 3) for k, v in reasons.items()}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--out', default='exit_rule_result.json')
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()
    conn = sqlite3.connect(args.db)
    codes = [r[0] for r in conn.execute('SELECT code FROM daily_prices GROUP BY code HAVING COUNT(*) >= 250 ORDER BY code')]
    conn.close()
    if args.limit:
        codes = codes[:args.limit]
    allrows = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for k, res in enumerate(pool.map(for_stock, [(args.db, c) for c in codes], chunksize=2)):
            allrows.extend(res)
            if (k + 1) % 20 == 0:
                print('%d/%d' % (k + 1, len(codes)), len(allrows), flush=True)
    dates = sorted({r['date'] for r in allrows})
    cut = dates[int(len(dates) * 0.55)]
    result = {'stocks': len(codes), 'cutDate': cut, 'params': {'gapSkip': GAP_SKIP, 'maxHold': MAX_HOLD, 'cost': COST, 'exitSlip': EXIT_SLIP}, 'table': {}}
    for name in ('BASELINE',) + SCANNERS:
        for stop in STOPS:
            rows = [r for r in allrows if r['scanner'] == name and r['stop'] == stop]
            result['table']['%s|%s' % (name, stop)] = {'all': summarize(rows), 'dev': summarize([r for r in rows if r['date'] < cut]),
                                                       'val': summarize([r for r in rows if r['date'] >= cut])}
    json.dump(result, open(args.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done', len(allrows))


if __name__ == '__main__':
    main()
