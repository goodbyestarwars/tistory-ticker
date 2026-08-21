# -*- coding: utf-8 -*-
"""눌림목 2종(우량주/급등주, pullback_patterns.py) 전종목 스캔 - "실제 확률"(백테스트
승률)을 확인하기 위한 수동 실행 전용 스크립트(타이머 없음, rescan_patterns.py와 같은
성격). SQLite daily_prices만 읽고 키움 API는 재호출하지 않는다.

daily_scan_cache.json에 쓰지 않는다 - 우량주 눌림목은 이미 pattern_detect.py를 통해
차트검색 화면에 나가고 있지만(오늘 스냅샷만), 여기 전체이력 백테스트와 급등주 눌림목은
아직 화면에 붙이기로 확정된 게 아니라 별도 산출물에만 저장한다."""

import json
import os
import sys
from datetime import datetime, timezone

import db_schema
import pattern_detect as pd
import pullback_patterns as pp

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pullback_patterns_backtest.json')
BACKTEST_HOLD_DAYS = pp.DEFAULT_HOLD_DAYS
BACKTEST_SLIPPAGE_PCT = pp.DEFAULT_SLIPPAGE_PCT


def log(msg):
    print('[pullback_patterns_scan] ' + msg, flush=True)


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

    bluechip_returns = []
    surge_returns = []
    scanned = 0

    for i, code in enumerate(codes):
        rows = db_schema.load_daily_prices(conn, code)
        stock = {'code': code}
        if pd.is_excluded_stock(stock, rows):
            continue
        if len(rows) < pp.SURGE_MIN_DAYS:
            continue
        scanned += 1

        if len(rows) >= pp.BLUECHIP_MIN_DAYS:
            bluechip_df = pp.compute_bluechip_pullback_signal(code, conn=conn, rows=rows)
            bluechip_returns.extend(pp.backtest_entry_signal(bluechip_df, hold_days=hold_days, slippage_pct=BACKTEST_SLIPPAGE_PCT))

        surge_df = pp.compute_surge_pullback_signal(code, conn=conn, rows=rows)
        surge_returns.extend(pp.backtest_entry_signal(surge_df, hold_days=hold_days, slippage_pct=BACKTEST_SLIPPAGE_PCT))

        if (i + 1) % 300 == 0 or (i + 1) == len(codes):
            log('[%d/%d] 진행 중 (스캔 %d / 우량주 거래 %d건 / 급등주 거래 %d건 누적)'
                % (i + 1, len(codes), scanned, len(bluechip_returns), len(surge_returns)))

    conn.close()

    bluechip_summary = pp.summarize_backtest(bluechip_returns)
    surge_summary = pp.summarize_backtest(surge_returns)
    generated_at = datetime.now(timezone.utc).isoformat()

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({
            'generatedAt': generated_at,
            'scanned': scanned,
            'universe': len(codes),
            'holdDays': hold_days,
            'bluechipPullback': bluechip_summary,
            'surgePullback': surge_summary,
        }, f, ensure_ascii=False)

    log('저장 완료: %s' % OUTPUT_FILE)
    print('\n=== 우량주 눌림목 백테스트 ===')
    print(json.dumps(bluechip_summary, ensure_ascii=False, indent=2))
    print('\n=== 급등주 눌림목 백테스트 ===')
    print(json.dumps(surge_summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
