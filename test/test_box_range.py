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
    import box_range as br
    import db_schema


def _box_rows(mode='flat'):
    """사용자 그림(노란 박스 안에서 고점 3번·저점 3번 왕복 후 돌파)을 그대로 옮긴 합성
    OHLC. mode='resistance_rising'이면 고점이 계속 올라가게(저항선이 평평하지 않음),
    mode='support_falling'이면 저점이 계속 내려가게(지지선이 평평하지 않음) 만든다 - 둘 다
    신호가 뜨면 안 되는 음성 대조군."""
    rows = []
    cursor = [date(2024, 1, 1)]

    def add(o, h, l, c, v=1000):
        rows.append({'date': cursor[0].isoformat(), 'open': o, 'high': h, 'low': l, 'close': c, 'volume': v})
        cursor[0] += timedelta(days=1)

    for i in range(10):
        lvl = 9000 + i * 3  # 동률 방지용 미세 drift
        add(lvl, lvl + 20, lvl - 20, lvl + 5)

    supports = [9800.0, 9800.0, 9800.0]
    resistances = [10300.0, 10300.0, 10300.0]
    if mode == 'resistance_rising':
        resistances = [10100.0, 10300.0, 10500.0]  # 밴드(3%) 밖으로 계속 오름
    elif mode == 'support_falling':
        supports = [9800.0, 9500.0, 9200.0]  # 밴드(3%) 밖으로 계속 내려감

    for support, resistance in zip(supports, resistances):
        add(support + 20, support + 250, support, support + 180)
        add(support + 300, resistance - 100, support + 200, resistance - 150)
        add(resistance - 15, resistance, resistance - 30, resistance - 15)
        add(resistance - 300, resistance - 150, support + 300, resistance - 250)

    last_support, last_resistance = supports[-1], resistances[-1]
    add(last_support + 40, last_support + 80, last_support + 10, last_support + 60)
    add(last_support + 90, last_support + 130, last_support + 50, last_support + 100)
    add(last_resistance - 20, last_resistance * 1.05, last_resistance - 40, last_resistance * 1.04)  # 돌파 캔들
    for _ in range(7):
        add(last_resistance * 1.04, last_resistance * 1.06, last_resistance * 1.02, last_resistance * 1.045)

    return rows


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - accumulation_angle.py와 동일한 스킵 사유')
class BoxRangeSignalTests(unittest.TestCase):
    def test_fires_once_at_the_breakout_candle(self):
        rows = _box_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = br.compute_box_range_signal('005930', conn=object())

        fired = df.index[df['entry_signal']].tolist()
        self.assertEqual(len(fired), 1, '같은 저항선으로 연속 재신호가 나면 안 된다')
        idx = fired[0]
        self.assertAlmostEqual(df.loc[idx, 'resistance'], 10300.0, places=1)
        self.assertGreater(df.loc[idx, 'close'], df.loc[idx, 'resistance'] * 1.02)
        self.assertLess(df.loc[idx, 'support'], df.loc[idx, 'resistance'])

    def test_no_signal_when_resistance_keeps_rising(self):
        rows = _box_rows(mode='resistance_rising')
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = br.compute_box_range_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_no_signal_when_support_keeps_falling(self):
        rows = _box_rows(mode='support_falling')
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = br.compute_box_range_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_swing_confirmation_does_not_use_future_bars(self):
        rows = _box_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            full_df = br.compute_box_range_signal('005930', conn=object())
        breakout_idx = full_df.index[full_df['entry_signal']].tolist()[0]

        truncated_rows = rows[:breakout_idx]
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=truncated_rows):
            truncated_df = br.compute_box_range_signal('005930', conn=object())
        self.assertFalse(truncated_df['entry_signal'].any())

    def test_empty_rows_returns_empty_dataframe_with_columns(self):
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=[]):
            df = br.compute_box_range_signal('005930', conn=object())
        self.assertEqual(list(df.columns), br.DAILY_PRICES_COLUMNS)
        self.assertEqual(len(df), 0)

    def test_rows_param_skips_db_lookup(self):
        rows = _box_rows()
        with mock.patch.object(db_schema, 'load_daily_prices') as load_daily_prices:
            df = br.compute_box_range_signal('005930', conn=object(), rows=rows)
        load_daily_prices.assert_not_called()
        self.assertEqual(len(df), len(rows))


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음')
class BoxRangeBacktestReuseTests(unittest.TestCase):
    def test_backtest_functions_are_accumulation_angle_reexports(self):
        import accumulation_angle as aa
        self.assertIs(br.backtest_entry_signal, aa.backtest_entry_signal)
        self.assertIs(br.summarize_backtest, aa.summarize_backtest)

    def test_backtest_produces_expected_net_return(self):
        rows = _box_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = br.compute_box_range_signal('005930', conn=object())

        returns = br.backtest_entry_signal(df, hold_days=5, slippage_pct=0.0015)
        self.assertEqual(len(returns), 1)

        breakout_idx = df.index[df['entry_signal']].tolist()[0]
        entry_price = df.loc[breakout_idx + 1, 'open']
        exit_price = df.loc[breakout_idx + 1 + 5, 'close']
        expected = (exit_price - entry_price) / entry_price - 0.0015 * 2
        self.assertAlmostEqual(returns[0], expected, places=8)


if __name__ == '__main__':
    unittest.main()
