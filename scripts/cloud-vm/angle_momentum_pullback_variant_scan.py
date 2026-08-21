# -*- coding: utf-8 -*-
"""각도기 타점(accumulation_angle.py entry_signal - 각도 급등/매집 신호) 즉시 진입 대신,
"신호가 뜬 뒤 눌림목(이평선 지지)이 올 때까지 기다렸다가 진입"하면 승률이 달라지는지 비교하는
수동 실행 전용 스크립트. 지표 필터를 여러 개 겹치는 대신(직전 분석 결과가 복잡하다는
피드백을 받아) 진입 시점 하나만 바꿔보는 단순한 대안이다 - "세력이 매집한 뒤 눌림목에서
같이 타는" 아이디어.

눌림목 판정은 새로 만들지 않고 gongpasan_strategy.py의 `_pullback_entry_flags`(공파산 타점이
이미 쓰고 있는 "돌파 이후 첫 지지 캔들" 로직)를 그대로 재사용한다 - "매집봉 뜨고 눌림목 오면"
이라는 아이디어 자체가 공파산 타점의 진입 로직과 개념적으로 같아서, 같은 코드를 각도기의
entry_signal(매집 신호)에 얹기만 하면 된다. 지지선은 공파산이 쓰는 sma20 대신 각도기 계산에
이미 있는 ema_long(20)을 그대로 쓴다(각도기는 SMA가 아니라 EMA 기반이라 - 새 이평선을 추가로
계산하지 않기 위함).

daily_scan_cache.json에 쓰지 않는다 - 이것도 indicator_sensitivity와 같은 성격의 1회성
분석 산출물."""

import json
import os
import sys
from datetime import datetime, timezone

import accumulation_angle as aa
import db_schema
import gongpasan_strategy as gp
import pattern_detect as pd

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'angle_momentum_pullback_variant.json')
BACKTEST_HOLD_DAYS = aa.DEFAULT_HOLD_DAYS
BACKTEST_SLIPPAGE_PCT = aa.DEFAULT_SLIPPAGE_PCT


def log(msg):
    print('[angle_momentum_pullback_variant_scan] ' + msg, flush=True)


def build_pullback_variant_returns(df, hold_days, slippage_pct):
    """df(compute_accumulation_angle 결과, entry_signal·ema_long 포함)에서 entry_signal
    이후 첫 눌림목(ema_long 지지) 캔들을 새 진입 시점으로 재정의하고, 그 시점 기준으로
    기존과 동일한 방식(다음날 시가 진입, hold_days일 뒤 종가 청산)으로 net_return을 구한다."""
    if df is None or df.empty or 'entry_signal' not in df.columns:
        return []
    pullback_entry = gp._pullback_entry_flags(
        df['entry_signal'].to_numpy(),
        df['low'].to_numpy(dtype=float),
        df['close'].to_numpy(dtype=float),
        df['ema_long'].to_numpy(dtype=float),
    )
    variant_df = df[['open', 'close']].copy()
    variant_df['entry_signal'] = pullback_entry
    return aa.backtest_entry_signal(variant_df, hold_days=hold_days, slippage_pct=slippage_pct)


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

    baseline_returns = []
    variant_returns = []
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

        baseline_returns.extend(aa.backtest_entry_signal(df, hold_days=BACKTEST_HOLD_DAYS, slippage_pct=BACKTEST_SLIPPAGE_PCT))
        variant_returns.extend(build_pullback_variant_returns(df, hold_days=BACKTEST_HOLD_DAYS, slippage_pct=BACKTEST_SLIPPAGE_PCT))

        if (i + 1) % 300 == 0 or (i + 1) == len(codes):
            log('[%d/%d] 진행 중 (스캔 %d / 즉시진입 %d건 / 눌림목진입 %d건)'
                % (i + 1, len(codes), scanned, len(baseline_returns), len(variant_returns)))

    conn.close()

    baseline_summary = aa.summarize_backtest(baseline_returns)
    variant_summary = aa.summarize_backtest(variant_returns)
    generated_at = datetime.now(timezone.utc).isoformat()

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({
            'generatedAt': generated_at,
            'scanned': scanned,
            'universe': len(codes),
            'holdDays': BACKTEST_HOLD_DAYS,
            'baseline': baseline_summary,
            'pullbackVariant': variant_summary,
        }, f, ensure_ascii=False)

    log('저장 완료: %s' % OUTPUT_FILE)
    print('\n=== 즉시 진입(기존 entry_signal) ===')
    print(json.dumps(baseline_summary, ensure_ascii=False, indent=2))
    print('\n=== 눌림목 대기 진입(entry_signal 이후 ema_long 첫 지지 캔들) ===')
    print(json.dumps(variant_summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
