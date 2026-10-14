# -*- coding: utf-8 -*-
"""검색기 0건 진단 - 읽기 전용(SQLite daily_prices만 읽고 아무것도 쓰지 않는다).

2026-10-15: 첫 눌림 재돌파가 27거래일 중 25일 0건, 공파산이 오늘 0건인 이유를 "조건 과다/구조적 희소/오류"로
가르려고 만들었다. 조건 완화 근거를 만들기 위한 도구가 아니라 단계별 탈락 건수를 보는 도구다.

사용(VM, 일일 스캔이 돌지 않는 시간에): nice -n 19 python3 pattern_funnel.py [--days 27]
  - firstPullbackBreakout: 최신 봉 기준 단계별 통과 종목 수 + 최근 N거래일 실제 판정기 일별 건수
  - gongpasan: 최신 봉 단계별 통과 수 + 최근 N거래일 entry_signal 일별 건수
e2-micro(메모리 1GB)라 종목을 하나씩 읽고 버린다.
"""
import sys
from collections import Counter

import db_schema
import pattern_detect as pd

FIRST_PULLBACK_STAGES = [
    'universe', 'trend(종가>20일선>60일선, 20일선 상승)', 'impulse(20일 고가 돌파+거래량1.5배+양봉)',
    'correction(2~8봉, 상승 5봉 이내)', 'clean_ascent(상승 중 2% 이탈 없음)', 'no_rebreak(조정 중 재돌파 없음)',
    'quiet_pullback(낙폭2~12%·지지·거래량80%이하)', 'today_rebreak(오늘 재돌파)',
]


def first_pullback_stage(daily):
    """pattern_detect.detect_first_pullback_breakout()과 같은 순서로 평가해 도달한 가장 깊은 단계(0~7)를 돌려준다."""
    if len(daily) < 65:
        return 0
    win = daily[-85:]
    last = win[-1]
    if any(not r.get(k) or r[k] <= 0 for r in win for k in ('open', 'high', 'low', 'close')):
        return 0
    ma20 = pd.moving_average(win, 'close', 20)
    ma60 = pd.moving_average(win, 'close', 60)
    if not (last['close'] > ma20[-1] > ma60[-1] and ma20[-1] > ma20[-6]):
        return 0
    best = 1
    for anchor in range(max(20, len(win) - 16), len(win) - 3):
        base = win[anchor - 20:anchor]
        bv = sum(r.get('volume', 0) for r in base) / 20
        if bv <= 0:
            continue
        imp = win[anchor]
        if not (imp['close'] > max(r['high'] for r in base) and imp.get('volume', 0) >= bv * 1.5
                and imp['close'] > imp['open']):
            continue
        best = max(best, 2)
        pk = max(range(anchor, len(win) - 1), key=lambda i: win[i]['high'])
        corr = win[pk + 1:-1]
        if not (2 <= len(corr) <= 8 and pk - anchor <= 5):
            continue
        best = max(best, 3)
        rh, bad = imp['high'], False
        for r in win[anchor + 1:pk + 1]:
            if r['close'] < rh * 0.98:
                bad = True
                break
            rh = max(rh, r['high'])
        if bad:
            continue
        best = max(best, 4)
        if any(win[i]['close'] > max(r['high'] for r in win[i - 3:i]) for i in range(pk + 4, len(win) - 1)):
            continue
        best = max(best, 5)
        low_row = min(corr, key=lambda r: r['low'])
        sup, peak = low_row['low'], win[pk]
        drop = (peak['high'] - sup) / peak['high'] * 100
        iv = sum(r.get('volume', 0) for r in win[anchor:pk + 1]) / (pk - anchor + 1)
        qv = sum(r.get('volume', 0) for r in corr) / len(corr)
        if not (2 <= drop <= 12 and sup > min(r['low'] for r in base) and qv > 0 and qv <= iv * 0.8):
            continue
        best = max(best, 6)
        if pd.detect_first_pullback_breakout(daily) is not None:
            best = 7
    return best


def main():
    days = 27
    if '--days' in sys.argv:
        days = int(sys.argv[sys.argv.index('--days') + 1])
    conn = db_schema.get_conn()
    codes = [r[0] for r in conn.execute('SELECT DISTINCT code FROM daily_prices ORDER BY code')]
    stage_count = Counter()
    fp_daily = Counter()
    gp_daily = Counter()
    gp_stage = Counter()
    scanned = 0
    try:
        import gongpasan_strategy as gp
    except Exception as e:  # pandas 없는 환경
        gp = None
        print('공파산 건너뜀:', e)
    for code in codes:
        rows = db_schema.load_daily_prices(conn, code)
        stock = {'code': code, 'name': code}
        if pd.is_excluded_stock(stock, rows) or len(rows) < 65:
            continue
        scanned += 1
        stage = first_pullback_stage(rows)
        for s in range(stage + 1):
            stage_count[s] += 1
        # 일별 판정기 건수 - 1단계(추세) 통과 종목만 과거 날짜로 되돌려 본다(비용 절감, 결과 동일: 추세 불통과면 어차피 None).
        for back in range(0, days):
            sub = rows[:len(rows) - back] if back else rows
            if len(sub) < 65:
                break
            if pd.detect_first_pullback_breakout(sub) is not None:
                fp_daily[sub[-1]['date']] += 1
        if gp is not None and len(rows) >= gp.DECLINE_LOOKBACK + 10:
            df = gp.calculate_gongpasan_signal(code, conn=conn, rows=rows)
            if not df.empty:
                tail = df.tail(days)
                for _, r in tail[tail['entry_signal'].astype(bool)].iterrows():
                    gp_daily[r['date'].strftime('%Y-%m-%d')] += 1
                last20 = df.tail(20)
                gp_stage['deep_decline(160일 -25%)'] += int((last20['retreat_pct'] <= -gp.DECLINE_MIN_PCT).any())
                gp_stage['gongguri(40일 횡보)'] += int(last20['is_gongguri'].any())
                gp_stage['daejip(매집봉)'] += int(last20['has_daejip_bong'].any())
                gp_stage['odori(5봉 돌파)'] += int(last20['is_odori'].any())
                gp_stage['breakout_signal(4개 모두)'] += int(last20['breakout_signal'].astype(bool).any())
                gp_stage['entry_signal(마지막 봉)'] += int(bool(df.iloc[-1]['entry_signal']))
    print('검사 종목:', scanned)
    print('== 첫 눌림 재돌파 최신 봉 단계별 통과 ==')
    for i, name in enumerate(FIRST_PULLBACK_STAGES):
        print('%d %-44s %d' % (i, name, stage_count[i] if i else scanned))
    print('== 첫 눌림 재돌파 일별 건수(판정기 실행) ==')
    for d in sorted(fp_daily):
        print(d, fp_daily[d])
    print('== 공파산 최근 20봉 내 단계 통과 종목 수 ==')
    for k, v in gp_stage.items():
        print(k, v)
    print('== 공파산 일별 entry_signal 건수 ==')
    for d in sorted(gp_daily):
        print(d, gp_daily[d])


if __name__ == '__main__':
    main()
