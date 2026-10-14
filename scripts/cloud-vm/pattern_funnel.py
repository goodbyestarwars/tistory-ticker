# -*- coding: utf-8 -*-
"""검색기 0건 진단 - 읽기 전용(SQLite daily_prices만 읽고 아무것도 쓰지 않는다).

2026-10-15: 첫 눌림 재돌파가 27거래일 중 25일 0건, 공파산이 오늘 0건인 이유를 "조건 과다/구조적 희소/오류"로
가르려고 만들었다. 조건 완화 근거를 만들기 위한 도구가 아니라 단계별 탈락 건수를 보는 도구다.

사용(VM, 일일 스캔이 돌지 않는 시간에): nice -n 19 python3 pattern_funnel.py [--history --days 27]
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


GP_STAGE_ORDER = [
    'deep_decline(160일 -25%)', 'gongguri(40일 횡보 20%)', 'daejip(매집봉 100억)', '1단계 매집 관찰(위 3개 동시)',
    'breakout_signal(돌파봉 300억)', '2단계 상승 돌파', '3단계 눌림 대기', '4단계 지지 확인',
]


def gongpasan_funnel(df, days, stage_count, daily, near):
    """최근 days봉 안에서 종목이 각 단계에 도달했는지(종목당 1회)와 일별 단계 분포를 집계한다. 조건은 읽기만 하고 바꾸지 않는다."""
    import gongpasan_stages as gs
    import gongpasan_strategy as gp
    n = len(df)
    start = max(0, n - days)
    trace = gs.stage_trace(df)
    tail = df.iloc[start:]
    st = trace['stage'][start:]
    stage_count[GP_STAGE_ORDER[0]] += int((tail['retreat_pct'] <= -gp.DECLINE_MIN_PCT).any())
    stage_count[GP_STAGE_ORDER[1]] += int(tail['is_gongguri'].any())
    stage_count[GP_STAGE_ORDER[2]] += int(tail['has_daejip_bong'].any())
    stage_count[GP_STAGE_ORDER[3]] += int(trace['cond1'][start:].any())
    stage_count[GP_STAGE_ORDER[4]] += int(tail['breakout_signal'].astype(bool).any())
    stage_count[GP_STAGE_ORDER[5]] += int((st == 2).any())
    stage_count[GP_STAGE_ORDER[6]] += int((st == 3).any())
    stage_count[GP_STAGE_ORDER[7]] += int((st == 4).any())
    for d, code in zip(tail['date'], st):
        if code:
            daily.setdefault(d.strftime('%Y-%m-%d'), Counter())[int(code)] += 1

    # near-miss: 숫자 하나만 완화했을 때 새로 걸리는 종목(어느 임계값이 결과 수에 얼마나 효과가 큰지만 본다)
    box_range = (df['high'].rolling(gp.GONGGURI_LOOKBACK).max() - df['low'].rolling(gp.GONGGURI_LOOKBACK).min()) \
        / df['low'].rolling(gp.GONGGURI_LOOKBACK).min() * 100
    decline = df['retreat_pct'] <= -gp.DECLINE_MIN_PCT
    daejip = df['has_daejip_bong'].astype(bool)
    near['40일 횡보폭 20~30%에서만 탈락(낙폭·매집봉 통과)'] += int((decline & daejip & (box_range > 20) & (box_range <= 30)).iloc[start:].any())
    tv = df['close'] * df['volume']
    body_pct = (df['close'] - df['open']) / df['open'] * 100
    big_body = (body_pct >= gp.ODORI_MIN_BODY_PCT) | ((df['close'] - df['open']) >= df['atr14'] * gp.ODORI_MIN_BODY_ATR)
    odori_no_tv = (df['close'] > df['high'].rolling(gp.ODORI_LOOKBACK).max().shift(1)) & (df['close'] > df['sma5']) \
        & (df['close'] > df['open']) & big_body
    cond1 = pd_series(trace['cond1'], df.index)
    near['돌파 거래대금 200~300억에서만 탈락(1단계 통과)'] += int((cond1 & odori_no_tv & (tv >= 200e8) & (tv < gp.ODORI_MIN_TRADING_VALUE_EOK * 1e8)).iloc[start:].any())


def pd_series(arr, index):
    import pandas as _pd
    return _pd.Series(arr, index=index)


def main():
    days = 27
    if '--days' in sys.argv:
        days = int(sys.argv[sys.argv.index('--days') + 1])
    history = '--history' in sys.argv   # 일별 판정기 재실행은 느려서(e2-micro에서 수십 분) 옵션으로만 켠다
    conn = db_schema.get_conn()
    codes = [r[0] for r in conn.execute('SELECT DISTINCT code FROM daily_prices ORDER BY code')]
    stage_count = Counter()
    fp_daily = Counter()
    gp_daily = {}
    gp_stage = Counter()
    gp_near = Counter()
    gp_days = 60
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
        if scanned % 300 == 0:
            print('진행', scanned, flush=True)
        stage = first_pullback_stage(rows)
        for s in range(stage + 1):
            stage_count[s] += 1
        # 일별 판정기 건수 - 1단계(추세) 통과 종목만 과거 날짜로 되돌려 본다(비용 절감, 결과 동일: 추세 불통과면 어차피 None).
        for back in (range(0, days) if history else ()):
            sub = rows[:len(rows) - back] if back else rows
            if len(sub) < 65:
                break
            if pd.detect_first_pullback_breakout(sub) is not None:
                fp_daily[sub[-1]['date']] += 1
        if gp is not None and len(rows) >= gp.DECLINE_LOOKBACK + 10:
            df = gp.calculate_gongpasan_signal(code, conn=conn, rows=rows)
            if not df.empty:
                gongpasan_funnel(df, gp_days, gp_stage, gp_daily, gp_near)
    print('검사 종목:', scanned)
    print('== 첫 눌림 재돌파 최신 봉 단계별 통과 ==')
    for i, name in enumerate(FIRST_PULLBACK_STAGES):
        print('%d %-44s %d' % (i, name, stage_count[i] if i else scanned))
    print('== 첫 눌림 재돌파 일별 건수(판정기 실행) ==')
    for d in sorted(fp_daily):
        print(d, fp_daily[d])
    print('== 공파산 최근 %d거래일 내 단계에 한 번이라도 도달한 종목 수 ==' % gp_days)
    for k in GP_STAGE_ORDER:
        print('%-46s %d' % (k, gp_stage[k]))
    print('== 공파산 near-miss(한 조건만 완화하면 늘어나는 종목 수, 조건은 바꾸지 않음) ==')
    for k, v in gp_near.items():
        print('%-46s %d' % (k, v))
    print('== 공파산 일별 단계별 종목 수(WATCH/BREAKOUT/WAIT/SUPPORT) ==')
    for d in sorted(gp_daily):
        c = gp_daily[d]
        print(d, c.get(1, 0), c.get(2, 0), c.get(3, 0), c.get(4, 0))


if __name__ == '__main__':
    main()
