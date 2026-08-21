# -*- coding: utf-8 -*-
"""Fill T+5/T+10/T+20 outcomes for saved domestic swing snapshots.

This job makes the recommendation measurable without changing the signal after
the fact. It is safe to run repeatedly: outcomes are recalculated from the
same immutable signal date and only become non-null when enough trading bars
exist.
"""

from datetime import datetime, timezone

import db_schema
import swing_model


def _returns(prices, entry_close, benchmark=None):
    if not entry_close or not prices:
        return None, None
    ret = prices[-1] / entry_close * 100 - 100
    excess = None
    if benchmark and benchmark[0] and benchmark[-1]:
        excess = (prices[-1] / entry_close - benchmark[-1] / benchmark[0]) * 100
    return round(ret, 4), round(excess, 4) if excess is not None else None


def outcome_for_snapshot(conn, row, daily_cache=None):
    code, as_of_date, initial_regime, entry_close = row[1], row[0], row[4], row[5]
    daily = (daily_cache or {}).get(code)
    if daily is None:
        daily = db_schema.load_daily_prices(conn, code)
    after = [item for item in daily if item.get('date', '') > as_of_date]
    benchmark_rows = db_schema.load_future_chart_since(conn, 'KOSPI', as_of_date.replace('-', ''))
    benchmark_by_date = {str(item.get('date', '')).replace('-', ''): item.get('close') for item in benchmark_rows}
    prices = [float(item['close']) for item in after if item.get('close') not in (None, 0)]
    highs = [float(item['high']) for item in after[:20] if item.get('high') not in (None, 0)]
    lows = [float(item['low']) for item in after[:20] if item.get('low') not in (None, 0)]
    entry_benchmark = benchmark_by_date.get(as_of_date.replace('-', ''))
    future_benchmark = [benchmark_by_date.get(str(item.get('date', '')).replace('-', '')) for item in after[:20]]
    future_benchmark = [value for value in future_benchmark if value]
    outcomes = {
        't5_return': None, 't10_return': None, 't20_return': None,
        't5_excess_return': None, 't10_excess_return': None, 't20_excess_return': None,
        't20_regime': None, 't20_regime_changed': None,
        'mfe': round(max(highs) / entry_close * 100 - 100, 4) if highs and entry_close else None,
        'mae': round(min(lows) / entry_close * 100 - 100, 4) if lows and entry_close else None,
        'outcomeUpdatedAt': datetime.now(timezone.utc).isoformat(),
    }
    for field, horizon in (('t5', 5), ('t10', 10), ('t20', 20)):
        if len(prices) < horizon:
            continue
        benchmark_slice = future_benchmark[:horizon]
        ret, excess = _returns(prices[:horizon], entry_close,
                               [entry_benchmark] + benchmark_slice if entry_benchmark and len(benchmark_slice) == horizon else None)
        outcomes[field + '_return'] = ret
        outcomes[field + '_excess_return'] = excess
    if len(after) >= 20:
        target_date = after[19].get('date')
        target_index = next((index for index, item in enumerate(daily) if item.get('date') == target_date), None)
        if target_index is not None:
            t20_chart = swing_model.classify_chart_regime(daily[:target_index + 1])
            t20_regime = (t20_chart.get('currentRegime') or {}).get('key') or 'neutral'
            outcomes['t20_regime'] = t20_regime
            outcomes['t20_regime_changed'] = int(bool(initial_regime and t20_regime != initial_regime))
    return outcomes


def run(db_file=None):
    conn = db_schema.get_conn(db_file)
    db_schema.create_schema(conn)
    # 2026-08-21 코드 감사: t20_return까지 다 채워진 행은 더 이상 변하지 않는데(과거 확정
    # 가격이라) 조건 없이 매번 전량 재처리하고 있었다 - daily_scan.py가 거의 전종목에
    # 매일 새 스냅샷을 추가해 이 테이블이 무기한 누적되는 구조라, 시간이 갈수록 이 작업의
    # 비용도 같이 늘어났음. t20_return이 아직 안 채워진(최근 20거래일이 안 지났거나, 상장폐지
    # 등으로 영영 안 채워질) 행만 재처리하도록 좁힌다.
    rows = conn.execute(
        '''SELECT as_of_date, code, model_version, chart_regime, current_regime, close
           FROM swing_recommendation_snapshots
           WHERE model_version=? AND t20_return IS NULL ORDER BY code, as_of_date''',
        (swing_model.MODEL_VERSION,),
    ).fetchall()
    # 같은 code가 여러 as_of_date에 걸쳐 반복 등장하므로(위 ORDER BY로 같은 code끼리
    # 모여 있음) 한 번의 실행 안에서 code별 가격 이력을 한 번만 로드해 재사용한다.
    codes = {row[1] for row in rows}
    daily_cache = {code: db_schema.load_daily_prices(conn, code) for code in codes}
    updated = 0
    for row in rows:
        outcomes = outcome_for_snapshot(conn, row, daily_cache)
        if any(outcomes.get(key) is not None for key in ('t5_return', 't10_return', 't20_return')):
            db_schema.update_swing_snapshot_outcome(
                conn, row[0], row[1], row[2], outcomes)
            updated += 1
    conn.commit()
    conn.close()
    return {'snapshots': len(rows), 'updated': updated}


if __name__ == '__main__':
    print(run())
