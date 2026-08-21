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
    import db_schema
    import inv_head_shoulders_v2 as ihs


def _rows(mode='normal'):
    """레퍼런스(하락 추세선을 뚫는 고점 + 그 뒤 거래량이 죽은 눌림목이 진짜 타점)를 그대로
    옮긴 합성 OHLC. mode='not_declining'이면 고점이 순차 하락하지 않게(추세선 자체가 없음),
    mode='high_volume_pullback'이면 눌림목 거래량을 오히려 크게 만든다 - 둘 다 신호가 뜨면
    안 되는 음성 대조군."""
    rows = []
    cursor = [date(2024, 1, 1)]

    def add(o, h, l, c, v=1000):
        rows.append({'date': cursor[0].isoformat(), 'open': o, 'high': h, 'low': l, 'close': c, 'volume': v})
        cursor[0] += timedelta(days=1)

    add(9400, 9450, 9350, 9420)
    add(9420, 9460, 9380, 9440)

    highs = [10500.0, 10300.0, 10100.0]
    if mode == 'not_declining':
        highs = [10100.0, 10300.0, 10500.0]  # 순차 상승 - 하락 추세선이 아님

    for hv in highs:
        add(hv - 300, hv - 100, hv - 400, hv - 200)
        add(hv - 50, hv, hv - 150, hv - 30)
        add(hv - 300, hv - 100, hv - 400, hv - 200)
        add(9500, 9550, 9400, 9480)

    last_high = highs[-1]
    add(9550, 9600, 9500, 9580)
    add(9600, 9650, 9550, 9620)
    add(last_high - 100, last_high + 300, last_high - 150, last_high + 250, v=5000)  # 돌파 캔들
    add(last_high + 250, last_high + 400, last_high + 200, last_high + 350, v=3000)   # 추가 상승

    pullback_volume = 1500 if mode != 'high_volume_pullback' else 4500  # 돌파일(5000)의 0.6배 미만이어야 정상 신호
    add(last_high + 350, last_high + 360, last_high + 100, last_high + 150, v=pullback_volume)

    for i in range(5):
        lvl = last_high + 300 + i
        add(last_high + 150, lvl, last_high + 100, lvl - 50, v=1200)
    return rows


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - accumulation_angle.py와 동일한 스킵 사유')
class InvHeadShouldersV2Tests(unittest.TestCase):
    def test_fires_once_at_the_low_volume_pullback(self):
        rows = _rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = ihs.compute_inv_head_shoulders_signal('005930', conn=object())

        fired = df.index[df['entry_signal']].tolist()
        self.assertEqual(len(fired), 1, '같은 돌파로 연속 재신호가 나면 안 된다')
        idx = fired[0]
        self.assertLess(df.loc[idx, 'close'], df.loc[idx - 1, 'close'])

    def test_no_signal_when_highs_are_not_declining(self):
        rows = _rows(mode='not_declining')
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = ihs.compute_inv_head_shoulders_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_no_signal_when_pullback_volume_is_not_low(self):
        """레퍼런스 핵심: 눌림목에서 거래량이 죽어야 한다 - 죽지 않으면 신호 없음."""
        rows = _rows(mode='high_volume_pullback')
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = ihs.compute_inv_head_shoulders_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_swing_confirmation_does_not_use_future_bars(self):
        rows = _rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            full_df = ihs.compute_inv_head_shoulders_signal('005930', conn=object())
        breakout_idx = full_df.index[full_df['entry_signal']].tolist()[0]

        truncated_rows = rows[:breakout_idx]
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=truncated_rows):
            truncated_df = ihs.compute_inv_head_shoulders_signal('005930', conn=object())
        self.assertFalse(truncated_df['entry_signal'].any())

    def test_empty_rows_returns_empty_dataframe_with_columns(self):
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=[]):
            df = ihs.compute_inv_head_shoulders_signal('005930', conn=object())
        self.assertEqual(list(df.columns), ihs.DAILY_PRICES_COLUMNS)
        self.assertEqual(len(df), 0)

    def test_rows_param_skips_db_lookup(self):
        rows = _rows()
        with mock.patch.object(db_schema, 'load_daily_prices') as load_daily_prices:
            df = ihs.compute_inv_head_shoulders_signal('005930', conn=object(), rows=rows)
        load_daily_prices.assert_not_called()
        self.assertEqual(len(df), len(rows))


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음')
class InvHeadShouldersV2BacktestReuseTests(unittest.TestCase):
    def test_backtest_functions_are_accumulation_angle_reexports(self):
        import accumulation_angle as aa
        self.assertIs(ihs.backtest_entry_signal, aa.backtest_entry_signal)
        self.assertIs(ihs.summarize_backtest, aa.summarize_backtest)


if __name__ == '__main__':
    unittest.main()
