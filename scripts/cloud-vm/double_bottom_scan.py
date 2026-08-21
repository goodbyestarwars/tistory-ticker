# -*- coding: utf-8 -*-
"""쌍바닥(double_bottom.py) 전종목 스캔 - "실제 확률"(백테스트 승률)을 확인하기 위한
수동 실행 전용 스크립트(타이머 없음, rescan_patterns.py와 같은 성격). SQLite
daily_prices만 읽고 키움 API는 재호출하지 않는다.

daily_scan_cache.json에 쓰지 않는다 - 기존 쌍바닥(pattern_detect.detect_double_bottom)은
이미 차트검색 화면에 나가고 있지만(오늘 스냅샷만), 여기 전체이력 백테스트는 아직 화면에
붙이기로 확정된 게 아니라 별도 산출물에만 저장한다."""

import json
import os
import sys
from datetime import datetime, timezone

import db_schema
import double_bottom as db_pattern
import pattern_detect as pd

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'double_bottom_backtest.json')
BACKTEST_HOLD_DAYS = db_pattern.DEFAULT_HOLD_DAYS
BACKTEST_SLIPPAGE_PCT = db_pattern.DEFAULT_SLIPPAGE_PCT


def log(msg):
    print('[double_bottom_scan] ' + msg, flush=True)


def _parse_hold_days(default):
    """--hold-days=N으로 보유일을 코드 수정 없이 바꿔볼 수 있게 함(2026-08-21, 사용자가
    5일 대신 10거래일 관점으로 여러 값을 실험하고 싶어함). 안 주면 기존 기본값 그대로."""
    for arg in sys.argv:
        if arg.startswith('--hold-days='):
            return int(arg.split('=', 1)[1])
    return default


def main():
    hold_days = _parse_hold_days(BACKTEST_HOLD_DAYS)

    conn = db_schema.get_conn()
    db_schema.create_schema(conn)

    codes = [r[0] for r in conn.execute('SELECT DISTINCT code FROM daily_prices ORDER BY code').fetchall()]
    if not codes:
        log('daily_prices가 비어있습니다 - daily_scan.py가 아직 안 돌았을 수 있음.')
        sys.exit(1)
    if '--test' in sys.argv:
        codes = codes[:200]
        log('--test 모드: %d종목만 스모크 테스트' % len(codes))
    log('대상 종목 수: %d (hold_days=%d)' % (len(codes), hold_days))

    net_returns = []
    scanned = 0

    for i, code in enumerate(codes):
        rows = db_schema.load_daily_prices(conn, code)
        stock = {'code': code}
        if pd.is_excluded_stock(stock, rows):
            continue
        if len(rows) < 2:
            continue
        scanned += 1

        df = db_pattern.compute_double_bottom_signal(code, conn=conn, rows=rows)
        if df.empty:
            continue

        net_returns.extend(db_pattern.backtest_entry_signal(df, hold_days=hold_days, slippage_pct=BACKTEST_SLIPPAGE_PCT))

        if (i + 1) % 300 == 0 or (i + 1) == len(codes):
            log('[%d/%d] 진행 중 (스캔 %d / 거래 %d건 누적)' % (i + 1, len(codes), scanned, len(net_returns)))

    conn.close()

    summary = db_pattern.summarize_backtest(net_returns)
    generated_at = datetime.now(timezone.utc).isoformat()

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({
            'generatedAt': generated_at,
            'scanned': scanned,
            'universe': len(codes),
            'holdDays': hold_days,
            'backtest': summary,
        }, f, ensure_ascii=False)

    log('저장 완료: %s (스캔 %d / 거래 %d건)' % (OUTPUT_FILE, scanned, len(net_returns)))
    print('\n=== 쌍바닥 백테스트 ===')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
