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
    import double_bottom as db


def _double_bottom_rows(low2_diff_pct=0.3, breakout=True):
    """레퍼런스 이미지(비슷한 높이의 저점 2개 + 첫 저점을 깨지 않는 재반등 + 넥라인 돌파로
    확정)를 그대로 옮긴 합성 OHLC. low2_diff_pct로 두 저점 가격차를 조절해 3% 초과 시
    거부되는지 확인하고, breakout=False면 넥라인 회복만 하고 실제 2% 돌파까지는 못 가게
    만든다(음성 대조군)."""
    n = 110
    daily = []
    start = date(2025, 1, 1)
    base = 30000.0
    for i in range(n):
        # 완전히 평평한 기준선은 스윙 저점 판정에서 동률(tie)이 대량으로 잡혀, 두 개의
        # 기준선 저점이 우연히 넥라인 돌기를 사이에 끼고 가짜 쌍바닥으로 오판되는 문제를
        # 겪었다(2026-08-21) - 하루마다 미세하게(0.5) 단조 증가시켜 동률을 없앤다.
        level = base + i * 0.5
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": level, "high": level + 300, "low": level - 300, "close": level, "volume": 1000,
        })
    i2 = n - 18
    i1 = i2 - 30
    low1 = base * 0.80
    low2 = low1 * (1 + low2_diff_pct / 100.0)
    daily[i1].update(low=low1, close=low1 + 50, open=low1 + 80, high=low1 + 300, volume=2500)
    mid = (i1 + i2) // 2
    neck = base * 1.08
    daily[mid].update(high=neck, close=neck - 30, open=neck - 60, low=neck - 250, volume=1200)
    daily[i2].update(low=low2, close=low2 + 40, open=low2 + 70, high=low2 + 300, volume=900)  # 2번째 저점 거래량 <= 1번째

    recover_days = 3
    for k in range(i2 + 1, i2 + 1 + recover_days):
        frac = (k - i2) / recover_days
        c = low2 + (neck - low2) * frac
        lo = max(low2 * 1.002, c * 0.99)
        daily[k].update(open=c * 0.995, close=c, high=c * 1.01, low=lo, volume=600)

    breakout_idx = i2 + 1 + recover_days
    if breakout:
        daily[breakout_idx].update(open=neck * 0.995, close=neck * 1.04, low=neck * 0.99, high=neck * 1.05, volume=1500)
        for k in range(breakout_idx + 1, n):
            daily[k].update(open=neck * 1.04, close=neck * 1.045, low=neck * 1.02, high=neck * 1.06, volume=800)
    else:
        # 넥라인 근처까지만 회복하고 다시 주저앉음 - 진짜 W 확정(2% 돌파)까지는 못 감
        for k in range(breakout_idx, n):
            daily[k].update(open=neck * 0.99, close=neck * 0.985, low=neck * 0.97, high=neck * 1.0, volume=700)

    return daily


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - accumulation_angle.py와 동일한 스킵 사유')
class ComputeDoubleBottomSignalTests(unittest.TestCase):
    def test_fires_once_at_the_neckline_breakout(self):
        rows = _double_bottom_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = db.compute_double_bottom_signal('005930', conn=object())

        fired = df.index[df['entry_signal']].tolist()
        self.assertEqual(len(fired), 1, '같은 넥라인으로 연속 재신호가 나면 안 된다')
        idx = fired[0]
        self.assertGreater(df.loc[idx, 'close'], df.loc[idx, 'neckline'] * 1.02)

    def test_no_signal_when_second_low_too_far_from_first(self):
        rows = _double_bottom_rows(low2_diff_pct=5.0)  # 3% 허용치 초과
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = db.compute_double_bottom_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_no_signal_without_a_real_breakout(self):
        """레퍼런스: "여기를 뚫어야지 진짜 W인거예요" - 넥라인 근처까지만 오고 못 뚫으면 신호 없음."""
        rows = _double_bottom_rows(breakout=False)
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = db.compute_double_bottom_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_swing_confirmation_does_not_use_future_bars(self):
        rows = _double_bottom_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            full_df = db.compute_double_bottom_signal('005930', conn=object())
        breakout_idx = full_df.index[full_df['entry_signal']].tolist()[0]

        truncated_rows = rows[:breakout_idx]
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=truncated_rows):
            truncated_df = db.compute_double_bottom_signal('005930', conn=object())
        self.assertFalse(truncated_df['entry_signal'].any())

    def test_empty_rows_returns_empty_dataframe_with_columns(self):
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=[]):
            df = db.compute_double_bottom_signal('005930', conn=object())
        self.assertEqual(list(df.columns), db.DAILY_PRICES_COLUMNS)
        self.assertEqual(len(df), 0)

    def test_rows_param_skips_db_lookup(self):
        rows = _double_bottom_rows()
        with mock.patch.object(db_schema, 'load_daily_prices') as load_daily_prices:
            df = db.compute_double_bottom_signal('005930', conn=object(), rows=rows)
        load_daily_prices.assert_not_called()
        self.assertEqual(len(df), len(rows))


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음')
class DoubleBottomBacktestReuseTests(unittest.TestCase):
    def test_backtest_functions_are_accumulation_angle_reexports(self):
        import accumulation_angle as aa
        self.assertIs(db.backtest_entry_signal, aa.backtest_entry_signal)
        self.assertIs(db.summarize_backtest, aa.summarize_backtest)

    def test_backtest_produces_expected_net_return(self):
        rows = _double_bottom_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = db.compute_double_bottom_signal('005930', conn=object())

        returns = db.backtest_entry_signal(df, hold_days=5, slippage_pct=0.0015)
        self.assertEqual(len(returns), 1)

        breakout_idx = df.index[df['entry_signal']].tolist()[0]
        entry_price = df.loc[breakout_idx + 1, 'open']
        exit_price = df.loc[breakout_idx + 1 + 5, 'close']
        expected = (exit_price - entry_price) / entry_price - 0.0015 * 2
        self.assertAlmostEqual(returns[0], expected, places=8)


if __name__ == '__main__':
    unittest.main()
