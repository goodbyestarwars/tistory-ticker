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


def _flat_accelerate_plateau_rows(flat_days=40, accel_days=30, plateau_days=50, base=10000, accel_step=8,
                                   plateau_step=240, accel_volume_step=60):
    """평평(각도 0 근방) -> 갈수록 상승폭이 커지는 가속 구간(각도가 빠르게 커짐) -> 상승폭이
    일정해지는 평탄 상승 구간(각도가 다시 완만해짐)으로 이어지는 합성 OHLC. entry_signal이
    "가속이 시작되는 초입"에서만 켜지고, 상승이 이미 일정한 속도로 굳어진 뒤(평탄 상승)에는
    꺼져야 한다는 걸 확인하는 재료로 쓴다.

    2026-08-22: entry_signal에 거래량 분출(volume_erupt_filter) 조건이 추가돼, 가속 구간에
    거래량도 함께 늘어나야 한다 - 평평/평탄 구간은 거래량을 고정(diff=0, 분출 없음)해 두고
    가속 구간에서만 거래량이 계단식으로 늘게 했다(가격 각도가 가속 구간에서만 튀는 것과
    같은 방식)."""
    rows = []
    price = float(base)
    volume = 1000
    cursor = date(2024, 1, 1)
    for i in range(flat_days):
        rows.append({
            'date': cursor.isoformat(),
            'open': price - 5, 'high': price + 10, 'low': price - 10, 'close': price, 'volume': volume,
        })
        cursor += timedelta(days=1)
    for i in range(accel_days):
        price += (i + 1) * accel_step
        volume += accel_volume_step
        rows.append({
            'date': cursor.isoformat(),
            'open': price - accel_step, 'high': price + 10, 'low': price - accel_step - 10, 'close': price, 'volume': volume,
        })
        cursor += timedelta(days=1)
    for _ in range(plateau_days):
        price += plateau_step
        rows.append({
            'date': cursor.isoformat(),
            'open': price - plateau_step, 'high': price + 10, 'low': price - plateau_step - 10, 'close': price, 'volume': volume,
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

    # 2026-08-22 신설(작업지시서 1~3단계) --------------------------------------------

    def test_entry_signal_requires_volume_eruption(self):
        """거래량이 가격 가속 구간에도 전혀 안 늘면(거래량 diff=0 고정) 다른 조건이 전부
        맞아도 entry_signal이 뜨면 안 된다."""
        rows = _flat_accelerate_plateau_rows(accel_volume_step=0)
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        self.assertFalse(df['volume_erupt_filter'].any())
        self.assertFalse(df['entry_signal'].any())

    def test_ema_aligned_reflects_ema_short_above_ema_long(self):
        rows = _flat_accelerate_plateau_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        expected = df['ema_short'] > df['ema_long']
        self.assertTrue((df['ema_aligned'] == expected).all())
        # entry_signal이 뜨는 날은 전부 정배열(ema_aligned)이어야 한다.
        self.assertTrue(df.loc[df['entry_signal'], 'ema_aligned'].all())

    def test_overheated_excludes_entry_signal(self):
        """20일 엔벨로프 상단을 훌쩍 넘는 날(초급등)은 entry_signal 조건을 다 만족해도
        overheated로 제외돼야 한다."""
        rows = _flat_accelerate_plateau_rows(flat_days=40, accel_days=10, plateau_days=0,
                                              accel_step=400)  # 훨씬 가파른 가속으로 과열 유도
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        self.assertTrue(df['overheated'].any(), '이 합성 데이터는 최소 하루는 과열 상태여야 한다')
        self.assertFalse(df.loc[df['overheated'], 'entry_signal'].any())

    def test_backtest_angle_entry_with_dynamic_exit_stop_loss(self):
        """진입 기준 봉(신호 당일)의 저가를 이탈하면 그 즉시 종가로 손절 청산돼야 한다."""
        rows = [
            {'date': '2025-01-01', 'open': 100.0, 'high': 101.0, 'low': 98.0, 'close': 100.0, 'volume': 100,
             'angle_short': 1.0, 'entry_signal': False},
            {'date': '2025-01-02', 'open': 100.0, 'high': 101.0, 'low': 95.0, 'close': 100.0, 'volume': 100,
             'angle_short': 2.0, 'entry_signal': True},   # 신호 당일 - 저가 95가 손절 기준선
            {'date': '2025-01-03', 'open': 102.0, 'high': 103.0, 'low': 101.0, 'close': 102.0, 'volume': 100,
             'angle_short': 3.0, 'entry_signal': False},  # 진입일(다음날 시가 102)
            {'date': '2025-01-04', 'open': 101.0, 'high': 102.0, 'low': 90.0, 'close': 91.0, 'volume': 100,
             'angle_short': 4.0, 'entry_signal': False},  # 저가 90 <= 95 -> 손절, 종가 91 청산
            {'date': '2025-01-05', 'open': 91.0, 'high': 95.0, 'low': 89.0, 'close': 94.0, 'volume': 100,
             'angle_short': 5.0, 'entry_signal': False},
        ]
        df = accumulation_angle.compute_accumulation_angle.__globals__['pd'].DataFrame(rows)
        trades = accumulation_angle.backtest_angle_entry_with_dynamic_exit(df, slippage_pct=0.0)
        self.assertEqual(len(trades), 1)
        self.assertAlmostEqual(trades[0], (91.0 - 102.0) / 102.0, places=6)

    def test_backtest_angle_entry_with_dynamic_exit_take_profit_on_angle_turn(self):
        """손절 없이 각도가 직전 봉 대비 꺾이는 첫 시점에 종가로 익절 청산돼야 한다."""
        rows = [
            {'date': '2025-01-01', 'open': 100.0, 'high': 101.0, 'low': 90.0, 'close': 100.0, 'volume': 100,
             'angle_short': 1.0, 'entry_signal': True},   # 신호 당일 - 저가 90(손절 기준, 안 뚫림)
            {'date': '2025-01-02', 'open': 102.0, 'high': 108.0, 'low': 101.0, 'close': 105.0, 'volume': 100,
             'angle_short': 3.0, 'entry_signal': False},  # 진입일(시가 102), 각도 상승
            {'date': '2025-01-03', 'open': 106.0, 'high': 112.0, 'low': 104.0, 'close': 110.0, 'volume': 100,
             'angle_short': 5.0, 'entry_signal': False},  # 각도 계속 상승
            {'date': '2025-01-04', 'open': 111.0, 'high': 115.0, 'low': 109.0, 'close': 112.0, 'volume': 100,
             'angle_short': 4.0, 'entry_signal': False},  # 각도 5->4로 꺾임 -> 이 날 종가로 익절
            {'date': '2025-01-05', 'open': 112.0, 'high': 120.0, 'low': 111.0, 'close': 118.0, 'volume': 100,
             'angle_short': 6.0, 'entry_signal': False},
        ]
        df = accumulation_angle.compute_accumulation_angle.__globals__['pd'].DataFrame(rows)
        trades = accumulation_angle.backtest_angle_entry_with_dynamic_exit(df, slippage_pct=0.0)
        self.assertEqual(len(trades), 1)
        self.assertAlmostEqual(trades[0], (112.0 - 102.0) / 102.0, places=6)

    def test_backtest_angle_entry_with_dynamic_exit_time_cut(self):
        """손절도 익절도 안 뜨면 max_hold_days 마지막 날 종가로 강제 청산돼야 한다."""
        rows = [{'date': '2025-01-01', 'open': 100.0, 'high': 101.0, 'low': 50.0, 'close': 100.0,
                  'volume': 100, 'angle_short': 1.0, 'entry_signal': True}]
        for i in range(1, 10):
            rows.append({'date': '2025-01-%02d' % (i + 1), 'open': 100.0 + i, 'high': 101.0 + i,
                          'low': 60.0, 'close': 100.0 + i, 'volume': 100,
                          'angle_short': 1.0 + i, 'entry_signal': False})  # 각도 계속 상승(안 꺾임)
        df = accumulation_angle.compute_accumulation_angle.__globals__['pd'].DataFrame(rows)
        trades = accumulation_angle.backtest_angle_entry_with_dynamic_exit(df, slippage_pct=0.0, max_hold_days=5)
        self.assertEqual(len(trades), 1)
        entry_price = rows[1]['open']  # entry_idx = 0(신호) + 1 = 1
        exit_price = rows[5]['close']  # last_checkable = entry_idx(1) + max_hold_days(5) - 1 = 5
        self.assertAlmostEqual(trades[0], (exit_price - entry_price) / entry_price, places=6)


if __name__ == '__main__':
    unittest.main()
