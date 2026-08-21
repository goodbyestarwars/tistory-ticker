# -*- coding: utf-8 -*-
"""상승삼각형(ascending_triangle.py) 전종목 스캔 - "실제 확률"(백테스트 승률)을 확인하기
위한 수동 실행 전용 스크립트(타이머 없음, rescan_patterns.py와 같은 성격). SQLite
daily_prices만 읽고 키움 API는 재호출하지 않는다.

daily_scan_cache.json에 쓰지 않는다 - 아직 화면(차트검색)에 붙이기로 확정된 게 아니라
승률부터 확인하는 단계라 별도 산출물(OUTPUT_FILE)에만 저장한다. 화면에 붙이기로 하면
angle_momentum_scan.py와 같은 패턴으로 daily_scan_cache.json에 patternScan.patterns에
추가하는 스캐너를 별도로 만들면 된다."""

import json
import os
import sys
from datetime import datetime, timezone

import ascending_triangle as at
import db_schema
import pattern_detect as pd

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ascending_triangle_backtest.json')
BACKTEST_HOLD_DAYS = at.DEFAULT_HOLD_DAYS
BACKTEST_SLIPPAGE_PCT = at.DEFAULT_SLIPPAGE_PCT

# 삼각형 룩백(LOOKBACK_WINDOW) + 스윙 확정 여유 정도는 있어야 신호가 뜰 여지가 생긴다.
MIN_ROWS = at.LOOKBACK_WINDOW + at.SWING + 5


def log(msg):
    print('[ascending_triangle_scan] ' + msg, flush=True)


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
    latest_matches = []  # 오늘 막 돌파가 뜬 종목(참고용 - 화면에 붙이진 않음)

    for i, code in enumerate(codes):
        rows = db_schema.load_daily_prices(conn, code)
        stock = {'code': code}
        if pd.is_excluded_stock(stock, rows):
            continue
        if len(rows) < MIN_ROWS:
            continue
        scanned += 1

        df = at.compute_ascending_triangle_signal(code, conn=conn, rows=rows)
        if df.empty:
            continue

        net_returns.extend(at.backtest_entry_signal(df, hold_days=hold_days, slippage_pct=BACKTEST_SLIPPAGE_PCT))

        if bool(df.iloc[-1]['entry_signal']):
            latest_matches.append({'code': code, 'date': df.iloc[-1]['date'].strftime('%Y-%m-%d'),
                                    'close': float(df.iloc[-1]['close']), 'resistance': float(df.iloc[-1]['resistance'])})

        if (i + 1) % 300 == 0 or (i + 1) == len(codes):
            log('[%d/%d] 진행 중 (스캔 %d / 백테스트 거래 %d건 누적 / 오늘 돌파 %d종목)'
                % (i + 1, len(codes), scanned, len(net_returns), len(latest_matches)))

    conn.close()

    summary = at.summarize_backtest(net_returns)
    generated_at = datetime.now(timezone.utc).isoformat()

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({
            'generatedAt': generated_at,
            'scanned': scanned,
            'universe': len(codes),
            'holdDays': hold_days,
            'backtest': summary,
            'latestMatches': latest_matches,
        }, f, ensure_ascii=False)

    log('저장 완료: %s (스캔 %d / 백테스트 거래 %d건 / 오늘 돌파 %d종목)'
        % (OUTPUT_FILE, scanned, len(net_returns), len(latest_matches)))
    print('\n=== 상승/수렴삼각형(고점 정체·완만한 하락 + 저점 계단식 상승 후 돌파) 백테스트 ===')
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if latest_matches:
        print('\n=== 오늘 기준 방금 돌파한 종목(참고용) ===')
        for m in latest_matches[:20]:
            print('  %s  %s원  저항 %s원' % (m['code'], format(round(m['close']), ','), format(round(m['resistance']), ',')))


if __name__ == '__main__':
    main()
