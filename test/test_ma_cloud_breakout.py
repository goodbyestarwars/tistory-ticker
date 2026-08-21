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
    import pandas as pd

    import db_schema
    import ma_cloud_breakout as mcb
    import pattern_detect as detector


def _ma_cloud_breakout_rows():
    """test_pattern_detect.py의 ma_cloud_breakout_daily()와 동일한 합성 데이터 - 원본
    스냅샷 판정(pattern_detect.detect_ma_cloud_breakout)이 마지막 날 신호를 내는 걸로
    이미 검증된 고정 픽스처라, 전체 이력 버전이 같은 결론을 내는지 대조하는 데 그대로
    재사용한다."""
    daily = []
    start = date(2025, 1, 1)
    for i in range(300):
        close = 100.0
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": close, "high": close + 1, "low": close - 1, "close": close, "volume": 1000,
        })
    for i in range(222, 248):
        daily[i].update(high=106.0, low=98.0)
    for i in range(248, 274):
        daily[i].update(high=101.0, low=99.0)
    for i, close in enumerate((100.1, 100.2, 100.4, 100.6, 100.8), start=295):
        daily[i].update(open=close - 0.2, high=102.0 if i == 299 else close + 0.5,
                         low=close - 0.5, close=close)
    for row in daily:
        for field in ("open", "high", "low", "close"):
            row[field] *= 1000
    return daily


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - accumulation_angle.py와 동일한 스킵 사유')
class ComputeMaCloudBreakoutSignalTests(unittest.TestCase):
    def test_matches_the_original_snapshot_detector(self):
        rows = _ma_cloud_breakout_rows()
        old_result = detector.detect_ma_cloud_breakout(rows)
        self.assertIsNotNone(old_result, '원본 스냅샷 판정 자체가 신호를 내야 대조가 의미 있음')

        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = mcb.compute_ma_cloud_breakout_signal('005930', conn=object())

        last = df.iloc[-1]
        self.assertTrue(bool(last['entry_signal']))
        self.assertAlmostEqual(last['ma224'], old_result['ma224'], places=4)
        self.assertAlmostEqual(last['cloud_top'], old_result['cloud']['top'], places=4)
        self.assertAlmostEqual(last['cloud_bottom'], old_result['cloud']['bottom'], places=4)

    def test_flat_series_never_signals(self):
        rows = [{
            "date": (date(2025, 1, 1) + timedelta(days=i)).isoformat(),
            "open": 10000, "high": 10050, "low": 9950, "close": 10000, "volume": 1000,
        } for i in range(300)]
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = mcb.compute_ma_cloud_breakout_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_empty_rows_returns_empty_dataframe_with_columns(self):
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=[]):
            df = mcb.compute_ma_cloud_breakout_signal('005930', conn=object())
        self.assertEqual(list(df.columns), mcb.DAILY_PRICES_COLUMNS)
        self.assertEqual(len(df), 0)

    def test_rows_param_skips_db_lookup(self):
        rows = _ma_cloud_breakout_rows()
        with mock.patch.object(db_schema, 'load_daily_prices') as load_daily_prices:
            df = mcb.compute_ma_cloud_breakout_signal('005930', conn=object(), rows=rows)
        load_daily_prices.assert_not_called()
        self.assertEqual(len(df), len(rows))


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음')
class BacktestMaCloudBreakoutTests(unittest.TestCase):
    def _frame(self, n=15):
        dates = [(date(2024, 1, 1) + timedelta(days=i)).isoformat() for i in range(n)]
        return pd.DataFrame({
            'date': pd.to_datetime(dates), 'open': [100.0] * n, 'close': [100.0] * n,
            'cloud_bottom': [90.0] * n, 'entry_signal': [False] * n,
        })

    def test_exits_on_close_below_cloud_bottom(self):
        """사용자 확인 규칙: 종가가 구름 하단 아래로 마감하면 그 날 손절."""
        df = self._frame()
        df.loc[2, 'entry_signal'] = True  # 진입은 idx3(다음날 시가)
        df.loc[6, 'close'] = 80.0
        df.loc[6, 'cloud_bottom'] = 85.0  # idx6에서 구름 하단 이탈

        returns = mcb.backtest_ma_cloud_breakout(df, timecut_days=20, slippage_pct=0.0015)

        self.assertEqual(len(returns), 1)
        entry_price = df.loc[3, 'open']
        expected = (80.0 - entry_price) / entry_price - 0.0015 * 2
        self.assertAlmostEqual(returns[0], expected, places=8)

    def test_holds_through_timecut_when_never_falls_below_cloud(self):
        """구름 아래로 안 떨어지면 손절 없이 타임컷까지 계속 보유(생존)."""
        df = self._frame()
        df.loc[2, 'entry_signal'] = True

        returns = mcb.backtest_ma_cloud_breakout(df, timecut_days=5, slippage_pct=0.0015)

        self.assertEqual(len(returns), 1)
        entry_price = df.loc[3, 'open']
        exit_idx = min(3 + 5, len(df) - 1)
        expected = (df.loc[exit_idx, 'close'] - entry_price) / entry_price - 0.0015 * 2
        self.assertAlmostEqual(returns[0], expected, places=8)

    def test_signal_too_close_to_end_is_dropped(self):
        df = self._frame()
        df.loc[len(df) - 1, 'entry_signal'] = True  # 다음날 시가가 없음
        self.assertEqual(mcb.backtest_ma_cloud_breakout(df, timecut_days=20, slippage_pct=0.0015), [])

    def test_empty_dataframe_returns_empty_list(self):
        self.assertEqual(mcb.backtest_ma_cloud_breakout(None, 20, 0.0015), [])
        self.assertEqual(mcb.backtest_ma_cloud_breakout(pd.DataFrame(), 20, 0.0015), [])

    def test_summarize_backtest_is_accumulation_angle_reexport(self):
        import accumulation_angle as aa
        self.assertIs(mcb.summarize_backtest, aa.summarize_backtest)


if __name__ == '__main__':
    unittest.main()
