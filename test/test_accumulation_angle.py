# -*- coding: utf-8 -*-
import os
import sys
import unittest
from datetime import date, timedelta
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

try:
    import pandas  # noqa: F401
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False

if PANDAS_AVAILABLE:
    import accumulation_angle
    import db_schema


def _flat_accelerate_plateau_rows(flat_days=40, accel_days=30, plateau_days=50, base=10000, accel_step=8, plateau_step=240):
    """평평(각도 0 근방) -> 갈수록 상승폭이 커지는 가속 구간(각도가 빠르게 커짐) -> 상승폭이
    일정해지는 평탄 상승 구간(각도가 다시 완만해짐)으로 이어지는 합성 OHLC. entry_signal이
    "가속이 시작되는 초입"에서만 켜지고, 상승이 이미 일정한 속도로 굳어진 뒤(평탄 상승)에는
    꺼져야 한다는 걸 확인하는 재료로 쓴다."""
    rows = []
    price = float(base)
    cursor = date(2024, 1, 1)
    for i in range(flat_days):
        rows.append({
            'date': cursor.isoformat(),
            'open': price - 5, 'high': price + 10, 'low': price - 10, 'close': price, 'volume': 1000,
        })
        cursor += timedelta(days=1)
    for i in range(accel_days):
        price += (i + 1) * accel_step
        rows.append({
            'date': cursor.isoformat(),
            'open': price - accel_step, 'high': price + 10, 'low': price - accel_step - 10, 'close': price, 'volume': 1000,
        })
        cursor += timedelta(days=1)
    for _ in range(plateau_days):
        price += plateau_step
        rows.append({
            'date': cursor.isoformat(),
            'open': price - plateau_step, 'high': price + 10, 'low': price - plateau_step - 10, 'close': price, 'volume': 1000,
        })
        cursor += timedelta(days=1)
    return rows


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - 2026-08-20 기준 pandas-ta는 '
                      'Python 3.12+ 베타만 PyPI에 있어 이 환경(3.11)엔 못 깔지만, pandas 자체는 '
                      '별개로 설치 가능/불가능할 수 있어 이 테스트만 독립적으로 스킵한다.')
class AccumulationAngleTests(unittest.TestCase):
    def test_returns_expected_columns_and_row_count(self):
        rows = _flat_accelerate_plateau_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        self.assertEqual(list(df.columns), accumulation_angle.DAILY_PRICES_COLUMNS)
        self.assertEqual(len(df), len(rows))

    def test_empty_rows_returns_empty_dataframe_with_columns(self):
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=[]):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        self.assertEqual(list(df.columns), accumulation_angle.DAILY_PRICES_COLUMNS)
        self.assertEqual(len(df), 0)

    def test_entry_signal_fires_only_during_the_acceleration_window(self):
        flat_days, accel_days = 40, 30
        rows = _flat_accelerate_plateau_rows(flat_days=flat_days, accel_days=accel_days)
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        fired = df.index[df['entry_signal']].tolist()
        # 평평한 구간(가속 시작 전)에서는 절대 뜨면 안 되고, 가속 구간이 끝나고 평탄 상승으로
        # 굳어진 뒤(가속 구간 종료 한참 뒤)에도 다시 뜨면 안 된다 - "가속 초입"만 잡아야 한다.
        self.assertTrue(fired, '가속 초입 구간에서 최소 1회는 entry_signal이 떠야 한다')
        for idx in fired:
            self.assertGreaterEqual(idx, flat_days)
            self.assertLess(idx, flat_days + accel_days + 5)

    def test_angle_mid_turn_and_long_turn_are_plus_minus_one_or_zero(self):
        rows = _flat_accelerate_plateau_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        valid = {-1.0, 0.0, 1.0}
        self.assertTrue(set(df['angle_mid_turn'].unique()).issubset(valid))
        self.assertTrue(set(df['angle_long_turn'].unique()).issubset(valid))

    def test_rows_param_skips_db_lookup(self):
        # angle_momentum_scan.py처럼 호출부가 이미 db_schema.load_daily_prices를 한 번
        # 불러둔 경우, rows를 직접 넘기면 DB를 다시 조회하지 않아야 한다(중복 쿼리 방지).
        rows = _flat_accelerate_plateau_rows(flat_days=5, accel_days=5, plateau_days=5)
        with mock.patch.object(db_schema, 'load_daily_prices') as load_daily_prices:
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object(), rows=rows)
        load_daily_prices.assert_not_called()
        self.assertEqual(len(df), len(rows))

    def test_conn_is_created_and_closed_when_not_provided(self):
        rows = _flat_accelerate_plateau_rows(flat_days=5, accel_days=5, plateau_days=5)
        fake_conn = mock.Mock()
        with mock.patch.object(db_schema, 'get_conn', return_value=fake_conn) as get_conn, \
                mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            accumulation_angle.compute_accumulation_angle('005930')
        get_conn.assert_called_once()
        fake_conn.close.assert_called_once()

    def test_backtest_entry_signal_returns_net_return_per_trade(self):
        rows = _flat_accelerate_plateau_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        trades = accumulation_angle.backtest_entry_signal(df, hold_days=5, slippage_pct=0.0015)
        self.assertTrue(trades)
        self.assertEqual(len(trades), int(df['entry_signal'].sum()))
        # 가속 구간에 진입해 5일 뒤 청산이면 우상향 합성 데이터 특성상 전부 플러스여야 한다.
        for r in trades:
            self.assertGreater(r, 0)

    def test_backtest_entry_signal_empty_when_no_signals(self):
        flat_rows = _flat_accelerate_plateau_rows(flat_days=60, accel_days=0, plateau_days=0)
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=flat_rows):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        self.assertEqual(accumulation_angle.backtest_entry_signal(df), [])

    def test_backtest_entry_signal_on_empty_dataframe_is_empty(self):
        empty = accumulation_angle.compute_accumulation_angle.__globals__['pd'].DataFrame(
            columns=accumulation_angle.DAILY_PRICES_COLUMNS)
        self.assertEqual(accumulation_angle.backtest_entry_signal(empty), [])

    def test_summarize_backtest_computes_win_rate_and_avg_return(self):
        summary = accumulation_angle.summarize_backtest([0.05, 0.03, -0.02, 0.01])
        self.assertEqual(summary['totalTrades'], 4)
        self.assertEqual(summary['winRatePct'], 75.0)
        self.assertAlmostEqual(summary['avgReturnPct'], 1.75, places=2)
        self.assertIsNotNone(summary['profitFactor'])

    def test_summarize_backtest_returns_none_when_no_trades(self):
        self.assertIsNone(accumulation_angle.summarize_backtest([]))

    def test_summarize_backtest_profit_factor_none_when_no_losses(self):
        summary = accumulation_angle.summarize_backtest([0.05, 0.03])
        self.assertIsNone(summary['profitFactor'])
        self.assertIsNone(summary['avgLossPct'])


if __name__ == '__main__':
    unittest.main()
