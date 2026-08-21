# -*- coding: utf-8 -*-
"""각도기 타점(accumulation_angle.py entry_signal)을 기준으로 두고, 보조지표를 하나씩
따로 VM에서 재백테스트하지 않고 "지표별로 구간을 나누면 승률이 어떻게 달라지는지"를 한 번의
전종목 스캔으로 확인하는 수동 실행 전용 분석 스크립트(타이머 없음 - rescan_patterns.py와
같은 성격, angle_momentum_scan.py와 동일한 방식으로 SQLite daily_prices만 읽는다).

angle_momentum_scan.py처럼 daily_scan_cache.json에 쓰지 않는다 - 이건 화면에 표시할 운영
데이터가 아니라 "다음에 뭘 추가할지" 판단하기 위한 1회성 분석 산출물이라 별도 파일
(OUTPUT_FILE)에 저장하고, 사람이 읽기 쉬운 요약도 표준출력에 같이 찍는다."""

import json
import os
import sys
from datetime import datetime, timezone

import accumulation_angle as aa
import db_schema
import indicator_sensitivity as ind
import pattern_detect as pd

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'angle_momentum_indicator_sensitivity.json')
BACKTEST_HOLD_DAYS = aa.DEFAULT_HOLD_DAYS
BACKTEST_SLIPPAGE_PCT = aa.DEFAULT_SLIPPAGE_PCT


def log(msg):
    print('[angle_momentum_indicator_scan] ' + msg, flush=True)


def _print_summary(summary):
    ranked = sorted(
        (item for item in summary.values() if item.get('buckets')),
        key=lambda item: (item['buckets'][-1]['winRatePct'] - item['buckets'][0]['winRatePct']),
        reverse=True,
    )
    print('\n=== 지표별 구간(Q1=낮음~Q4=높음) 승률 - Q4-Q1 승률차 큰 순 ===')
    for item in ranked:
        buckets = item['buckets']
        spread = buckets[-1]['winRatePct'] - buckets[0]['winRatePct']
        print('%s (표본 %d건, 기준 승률 %.2f%%, 상관계수 %s)' % (
            item['label'], item['sampleCount'], item['baselineWinRatePct'], item['correlation']))
        for b in buckets:
            print('  Q%d (%.4g~%.4g, %d건): 승률 %.2f%% / 평균수익률 %.2f%% / 중앙값 %.2f%%' % (
                b['quartile'], b['valueRangeLow'], b['valueRangeHigh'], b['count'],
                b['winRatePct'], b['avgReturnPct'], b['medianReturnPct']))
    skipped = [item['label'] for item in summary.values() if not item.get('buckets')]
    if skipped:
        print('\n표본 부족으로 제외된 지표: %s' % ', '.join(skipped))


def main():
    conn = db_schema.get_conn()
    db_schema.create_schema(conn)

    codes = [r[0] for r in conn.execute('SELECT DISTINCT code FROM daily_prices ORDER BY code').fetchall()]
    if not codes:
        log('daily_prices가 비어있습니다 - daily_scan.py가 아직 안 돌았을 수 있음.')
        sys.exit(1)
    if '--test' in sys.argv:
        codes = codes[:200]
        log('--test 모드: %d종목만 스모크 테스트' % len(codes))
    log('대상 종목 수: %d' % len(codes))

    records = []
    scanned = 0

    for i, code in enumerate(codes):
        rows = db_schema.load_daily_prices(conn, code)
        stock = {'code': code}
        if pd.is_excluded_stock(stock, rows):
            continue
        if len(rows) < aa.EMA_LONG_LEN * 2:
            continue
        scanned += 1

        df = aa.compute_accumulation_angle(code, conn=conn, rows=rows)
        if df.empty:
            continue
        df = ind.compute_candidate_indicators(df)
        records.extend(ind.collect_indicator_trades(df, hold_days=BACKTEST_HOLD_DAYS, slippage_pct=BACKTEST_SLIPPAGE_PCT))

        if (i + 1) % 300 == 0 or (i + 1) == len(codes):
            log('[%d/%d] 진행 중 (스캔 %d / 거래 %d건 누적)' % (i + 1, len(codes), scanned, len(records)))

    conn.close()

    summary = ind.summarize_indicator_sensitivity(records)
    generated_at = datetime.now(timezone.utc).isoformat()

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({
            'generatedAt': generated_at,
            'scanned': scanned,
            'universe': len(codes),
            'totalTrades': len(records),
            'holdDays': BACKTEST_HOLD_DAYS,
            'indicators': summary,
        }, f, ensure_ascii=False)
    log('저장 완료: %s (스캔 %d / 거래 %d건)' % (OUTPUT_FILE, scanned, len(records)))
    _print_summary(summary)


if __name__ == '__main__':
    main()
