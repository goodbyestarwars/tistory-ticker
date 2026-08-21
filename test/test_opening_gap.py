# -*- coding: utf-8 -*-
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

try:
    import pandas  # noqa: F401
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False

if PANDAS_AVAILABLE:
    import db_schema
    import opening_gap as og
    import pattern_detect as detector


def _rows(open_price=10500, close_price=11000, volume=300000):
    """test_pattern_detect.py의 OpeningGapDetectionTest.daily()와 동일한 픽스처."""
    return [
        {"date": "2026-08-10", "open": 10000, "high": 10000, "low": 10000, "close": 10000, "volume": volume},
        {"date": "2026-08-11", "open": open_price, "high": close_price, "low": open_price,
         "close": close_price, "volume": volume},
    ]


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - accumulation_angle.py와 동일한 스킵 사유')
class ComputeOpeningGapSignalTests(unittest.TestCase):
    def test_matches_the_original_snapshot_detector(self):
        rows = _rows()
        old_result = detector.detect_opening_gap(rows)
        self.assertIsNotNone(old_result)

        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = og.compute_opening_gap_signal('005930', conn=object())

        last = df.iloc[-1]
        self.assertTrue(bool(last['entry_signal']))
        self.assertAlmostEqual(last['gap_rate_pct'], old_result['gapRatePct'], places=6)
        self.assertAlmostEqual(last['intraday_rate_pct'], old_result['intradayRatePct'], places=6)
        self.assertAlmostEqual(last['turnover_million'], old_result['turnoverMillion'], places=6)

    def test_no_signal_without_a_gap_up(self):
        rows = _rows(open_price=9900, close_price=10500)  # 시가가 전일 종가보다 낮음
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = og.compute_opening_gap_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_no_signal_when_intraday_rise_is_too_small(self):
        rows = _rows(open_price=10100, close_price=10150)  # 갭은 있지만 장중 상승 3% 미만
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = og.compute_opening_gap_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_no_signal_when_turnover_out_of_range(self):
        rows = _rows(volume=100)  # 거래대금이 최소 기준(3,000백만원) 미만
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = og.compute_opening_gap_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_first_day_never_signals_without_a_previous_close(self):
        rows = _rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = og.compute_opening_gap_signal('005930', conn=object())
        self.assertFalse(bool(df.iloc[0]['entry_signal']))

    def test_empty_rows_returns_empty_dataframe_with_columns(self):
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=[]):
            df = og.compute_opening_gap_signal('005930', conn=object())
        self.assertEqual(list(df.columns), og.DAILY_PRICES_COLUMNS)
        self.assertEqual(len(df), 0)

    def test_rows_param_skips_db_lookup(self):
        rows = _rows()
        with mock.patch.object(db_schema, 'load_daily_prices') as load_daily_prices:
            df = og.compute_opening_gap_signal('005930', conn=object(), rows=rows)
        load_daily_prices.assert_not_called()
        self.assertEqual(len(df), len(rows))


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음')
class OpeningGapBacktestReuseTests(unittest.TestCase):
    def test_backtest_functions_are_accumulation_angle_reexports(self):
        import accumulation_angle as aa
        self.assertIs(og.backtest_entry_signal, aa.backtest_entry_signal)
        self.assertIs(og.summarize_backtest, aa.summarize_backtest)


if __name__ == '__main__':
    unittest.main()
