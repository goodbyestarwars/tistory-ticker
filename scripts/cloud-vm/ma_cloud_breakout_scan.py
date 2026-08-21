# -*- coding: utf-8 -*-
"""이평 상승 초입형(ma_cloud_breakout.py) 전종목 스캔 - "실제 확률"(백테스트 승률)을
확인하기 위한 수동 실행 전용 스크립트(타이머 없음, rescan_patterns.py와 같은 성격).
SQLite daily_prices만 읽고 키움 API는 재호출하지 않는다.

daily_scan_cache.json에 쓰지 않는다 - 이 신호 자체는 이미 pattern_detect.py를 통해
차트검색 화면에 나가고 있지만(오늘 스냅샷만), 여기 백테스트(구름 하단 손절+타임컷)는
아직 화면에 붙이기로 확정된 게 아니라 별도 산출물에만 저장한다."""

import json
import os
import sys
from datetime import datetime, timezone

import db_schema
import ma_cloud_breakout as mcb
import pattern_detect as pd

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ma_cloud_breakout_backtest.json')
BACKTEST_TIMECUT_DAYS = mcb.DEFAULT_TIMECUT_DAYS
BACKTEST_SLIPPAGE_PCT = mcb.DEFAULT_SLIPPAGE_PCT

MIN_ROWS = mcb.MA_LONG + mcb.ICHIMOKU_DISPLACEMENT + mcb.ICHIMOKU_SENKOU_B_PERIOD  # 224일선 + 구름 계산에 필요한 최소치


def log(msg):
    print('[ma_cloud_breakout_scan] ' + msg, flush=True)


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

    net_returns = []
    scanned = 0

    for i, code in enumerate(codes):
        rows = db_schema.load_daily_prices(conn, code)
        stock = {'code': code}
        if pd.is_excluded_stock(stock, rows):
            continue
        if len(rows) < MIN_ROWS:
            continue
        scanned += 1

        df = mcb.compute_ma_cloud_breakout_signal(code, conn=conn, rows=rows)
        if df.empty:
            continue

        net_returns.extend(mcb.backtest_ma_cloud_breakout(df, timecut_days=BACKTEST_TIMECUT_DAYS, slippage_pct=BACKTEST_SLIPPAGE_PCT))

        if (i + 1) % 300 == 0 or (i + 1) == len(codes):
            log('[%d/%d] 진행 중 (스캔 %d / 백테스트 거래 %d건 누적)' % (i + 1, len(codes), scanned, len(net_returns)))

    conn.close()

    summary = mcb.summarize_backtest(net_returns)
    generated_at = datetime.now(timezone.utc).isoformat()

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({
            'generatedAt': generated_at,
            'scanned': scanned,
            'universe': len(codes),
            'timecutDays': BACKTEST_TIMECUT_DAYS,
            'exitRule': '종가가 구름 하단 아래로 마감하면 손절, 그 전까지는 보유(최대 timecutDays)',
            'backtest': summary,
        }, f, ensure_ascii=False)

    log('저장 완료: %s (스캔 %d / 백테스트 거래 %d건)' % (OUTPUT_FILE, scanned, len(net_returns)))
    print('\n=== 이평 상승 초입형(224일선+구름 상단 시도+5일선 골든크로스) 백테스트 ===')
    print('청산 규칙: 구름 하단 이탈 손절, 아니면 최대 %d거래일 보유' % BACKTEST_TIMECUT_DAYS)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
