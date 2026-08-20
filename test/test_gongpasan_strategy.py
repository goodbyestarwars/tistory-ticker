# -*- coding: utf-8 -*-
import os
import sys
import unittest
from datetime import date, timedelta
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

try:
    import pandas  # noqa: F401
    import numpy as np
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False

if PANDAS_AVAILABLE:
    import db_schema
    import gongpasan_strategy as gp


def _decline_gongguri_breakout_pullback_rows():
    """역매공파 4단계를 전부 통과하도록 설계한 합성 OHLC:
    160일 이상 -50% 급락(낙폭과대) -> 45일 좁은 횡보(공구리, 중간에 매집봉 1개) ->
    단 하루 만에 5봉 고가+5일선을 동시에 뚫는 오돌이 돌파 -> 며칠 상승 후 20일선까지
    눌림(매수 타점) -> 다시 하락(백테스트 손절 확인용).
    breakout_signal/entry_signal이 정확히 1회씩만 뜨는지 확인하는 재료로 쓴다."""
    rows = []
    cursor = date(2023, 1, 1)
    price = 20000.0
    n_decline = 165
    step = (20000.0 - 9500.0) / n_decline
    for _ in range(n_decline):
        price -= step
        o = price + step * 0.3
        c = price
        rows.append({'date': cursor.isoformat(), 'open': o, 'high': max(o, c) + 20,
                      'low': min(o, c) - 20, 'close': c, 'volume': 50000})
        cursor += timedelta(days=1)

    rng = np.random.default_rng(3)
    base = price
    for _ in range(45):
        c = base + rng.normal(0, base * 0.015)
        o = c - rng.normal(0, base * 0.008)
        rows.append({'date': cursor.isoformat(), 'open': o, 'high': max(o, c) + base * 0.004,
                      'low': min(o, c) - base * 0.004, 'close': c, 'volume': 50000})
        cursor += timedelta(days=1)

    o = base
    c = base * 1.045
    rows.append({'date': cursor.isoformat(), 'open': o, 'high': c + 40, 'low': o - 40,
                  'close': c, 'volume': 50000 * 3.0})
    cursor += timedelta(days=1)
    base = c
    for _ in range(6):
        base *= 0.99
        rows.append({'date': cursor.isoformat(), 'open': base * 1.004, 'high': base + 20,
                      'low': base - 30, 'close': base, 'volume': 40000})
        cursor += timedelta(days=1)

    last5_highs = [r['high'] for r in rows[-5:]]
    breakout_close = max(last5_highs) * 1.06
    breakout_idx = len(rows)
    rows.append({'date': cursor.isoformat(), 'open': base, 'high': breakout_close + 30,
                  'low': base - 10, 'close': breakout_close, 'volume': 50000 * 1.8})
    cursor += timedelta(days=1)
    base = breakout_close
    for _ in range(4):
        base *= 1.01
        rows.append({'date': cursor.isoformat(), 'open': base * 0.995, 'high': base + 30,
                      'low': base - 30, 'close': base, 'volume': 40000})
        cursor += timedelta(days=1)
    entry_idx = len(rows) + 7  # 대략 8일째 눌림 근처(정확한 인덱스는 테스트에서 다시 찾음)
    for _ in range(10):
        base *= 0.985
        rows.append({'date': cursor.isoformat(), 'open': base * 1.005, 'high': base + 20,
                      'low': base - 40, 'close': base, 'volume': 35000})
        cursor += timedelta(days=1)
    return rows, breakout_idx, entry_idx


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - accumulation_angle.py와 같은 '
                      '이유로 이 테스트만 독립적으로 스킵한다.')
class GongpasanStrategyTests(unittest.TestCase):
    def test_returns_expected_columns_and_row_count(self):
        rows, _, _ = _decline_gongguri_breakout_pullback_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = gp.calculate_gongpasan_signal('005930', conn=object())
        self.assertEqual(list(df.columns), gp.DAILY_PRICES_COLUMNS)
        self.assertEqual(len(df), len(rows))

    def test_empty_rows_returns_empty_dataframe_with_columns(self):
        df = gp.calculate_gongpasan_signal('005930', rows=[])
        self.assertEqual(list(df.columns), gp.DAILY_PRICES_COLUMNS)
        self.assertEqual(len(df), 0)

    def test_breakout_signal_fires_once_at_the_odori_candle(self):
        rows, _, _ = _decline_gongguri_breakout_pullback_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = gp.calculate_gongpasan_signal('005930', conn=object())
        fired = df.index[df['breakout_signal']].tolist()
        self.assertEqual(len(fired), 1, '역배열+공구리+매집봉+오돌이가 전부 겹치는 합성 데이터라 '
                          '정확히 한 번만 떠야 한다')
        # 그 시점엔 반드시 오돌이 조건(직전 5봉 고가 돌파 + 5일선 상향 돌파)이 같이 True여야 한다.
        self.assertTrue(bool(df.loc[fired[0], 'is_odori']))

    def test_entry_signal_fires_after_breakout_not_before(self):
        rows, _, _ = _decline_gongguri_breakout_pullback_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = gp.calculate_gongpasan_signal('005930', conn=object())
        breakout_idx = df.index[df['breakout_signal']].tolist()
        entry_idx = df.index[df['entry_signal']].tolist()
        self.assertTrue(entry_idx, '가속 후 20일선까지 눌림받는 합성 데이터라 entry_signal이 최소 1회는 떠야 한다')
        self.assertTrue(breakout_idx)
        for idx in entry_idx:
            self.assertGreater(idx, breakout_idx[0])

    def test_entry_signal_never_fires_without_a_prior_breakout(self):
        # 공구리·매집봉 없이 그냥 평평한 데이터 - 20일선을 여러 번 오가도 breakout이 없으면
        # entry_signal이 절대 뜨면 안 된다(눌림목은 반드시 돌파 다음에만 의미가 있음).
        rng = np.random.default_rng(7)
        rows = []
        cursor = date(2023, 1, 1)
        price = 10000.0
        for _ in range(120):
            c = price + rng.normal(0, 80)
            o = c - rng.normal(0, 40)
            rows.append({'date': cursor.isoformat(), 'open': o, 'high': max(o, c) + 30,
                          'low': min(o, c) - 30, 'close': c, 'volume': 30000})
            cursor += timedelta(days=1)
            price = c
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = gp.calculate_gongpasan_signal('005930', conn=object())
        self.assertFalse(df['breakout_signal'].any())
        self.assertFalse(df['entry_signal'].any())

    def test_blue_line_is_sma46_times_envelope_pct(self):
        rows, _, _ = _decline_gongguri_breakout_pullback_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = gp.calculate_gongpasan_signal('005930', conn=object())
        row = df.dropna(subset=['sma46', 'blue_line']).iloc[-1]
        self.assertAlmostEqual(row['blue_line'], row['sma46'] * (1 + gp.ENVELOPE_PCT), places=6)

    def test_conn_is_created_and_closed_when_not_provided(self):
        rows, _, _ = _decline_gongguri_breakout_pullback_rows()
        fake_conn = mock.Mock()
        with mock.patch.object(db_schema, 'get_conn', return_value=fake_conn) as get_conn, \
                mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            gp.calculate_gongpasan_signal('005930')
        get_conn.assert_called_once()
        fake_conn.close.assert_called_once()

    def test_rows_param_skips_db_lookup(self):
        rows, _, _ = _decline_gongguri_breakout_pullback_rows()
        with mock.patch.object(db_schema, 'load_daily_prices') as load_daily_prices:
            df = gp.calculate_gongpasan_signal('005930', conn=object(), rows=rows)
        load_daily_prices.assert_not_called()
        self.assertEqual(len(df), len(rows))

    def test_backtest_gongpasan_returns_one_trade_per_entry_signal(self):
        rows, _, _ = _decline_gongguri_breakout_pullback_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = gp.calculate_gongpasan_signal('005930', conn=object())
        trades = gp.backtest_gongpasan(df)
        self.assertEqual(len(trades), int(df['entry_signal'].sum()))

    def test_backtest_gongpasan_empty_when_no_signals(self):
        empty = gp.calculate_gongpasan_signal('005930', rows=[])
        self.assertEqual(gp.backtest_gongpasan(empty), [])

    def test_summarize_backtest_matches_accumulation_angle_semantics(self):
        summary = gp.summarize_backtest([0.05, 0.03, -0.02, 0.01])
        self.assertEqual(summary['totalTrades'], 4)
        self.assertEqual(summary['winRatePct'], 75.0)
        self.assertAlmostEqual(summary['avgReturnPct'], 1.75, places=2)

    def test_summarize_backtest_returns_none_when_no_trades(self):
        self.assertIsNone(gp.summarize_backtest([]))


if __name__ == '__main__':
    unittest.main()
