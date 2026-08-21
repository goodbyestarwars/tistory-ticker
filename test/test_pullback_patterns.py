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
    import pattern_detect as detector
    import pullback_patterns as pp


def _bluechip_rows():
    """test_pattern_detect.py의 pullback_daily()와 동일한 합성 데이터 - 원본 스냅샷
    판정(pattern_detect.detect_pullback)이 마지막 날 신호를 내는 걸로 이미 검증된 고정
    픽스처를 그대로 재사용해 전체 이력 버전과 대조한다."""
    n = 260
    daily = []
    start = date(2024, 1, 1)
    price = 20000.0
    flat_days = n - 25
    for i in range(flat_days):
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": price, "high": price * 1.003, "low": price * 0.997, "close": price, "volume": 1000,
        })
    low_price = price
    rise_days = 15
    rise_total = 0.28
    for i in range(rise_days):
        price = low_price * (1 + rise_total * (i + 1) / rise_days)
        vol = 800 + i * 100
        daily.append({
            "date": (start + timedelta(days=flat_days + i)).isoformat(),
            "open": price * 0.999, "high": price * 1.008, "low": price * 0.995, "close": price, "volume": vol,
        })
    peak = price
    drop_days = n - len(daily)
    drop_total = 0.08
    for i in range(drop_days):
        price = peak * (1 - drop_total * (i + 1) / drop_days)
        vol = max(1800 - i * 130, 100)
        daily.append({
            "date": (start + timedelta(days=len(daily))).isoformat(),
            "open": price * 1.001, "high": price * 1.006, "low": price * 0.995, "close": price, "volume": vol,
        })
    daily[-1]["close"] = daily[-1]["open"] * 1.002
    return daily


def _surge_rows(surge_total=0.45, drop_total=0.10):
    """짧은 구간(6거래일) 안에 급등(45%) 후 3일 안에 빠르게 눌림(10% 조정)이 오는 합성
    데이터. surge_total을 낮게 주면(SURGE_MIN_RISE 30% 미만) 신호가 없어야 하는 음성
    대조군으로도 쓴다."""
    n = 60
    daily = []
    start = date(2024, 1, 1)
    price = 10000.0
    flat_days = 35
    for i in range(flat_days):
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": price, "high": price * 1.005, "low": price * 0.995, "close": price, "volume": 1000,
        })
    low_price = price
    surge_days = 6
    for i in range(surge_days):
        price = low_price * (1 + surge_total * (i + 1) / surge_days)
        vol = 1000 + i * 400  # 상승구간 거래량 증가
        daily.append({
            "date": (start + timedelta(days=flat_days + i)).isoformat(),
            "open": price * 0.995, "high": price * 1.01, "low": price * 0.99, "close": price, "volume": vol,
        })
    peak = price
    drop_days = n - len(daily)
    for i in range(drop_days):
        price = peak * (1 - drop_total * min(1.0, (i + 1) / 3))  # 3일 안에 목표 조정폭 도달
        daily.append({
            "date": (start + timedelta(days=len(daily))).isoformat(),
            "open": price * 1.002, "high": price * 1.008, "low": price * 0.995, "close": price, "volume": 500,
        })
    return daily


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - accumulation_angle.py와 동일한 스킵 사유')
class BluechipPullbackTests(unittest.TestCase):
    def test_matches_the_original_snapshot_detector(self):
        rows = _bluechip_rows()
        old_result = detector.detect_pullback(rows)
        self.assertIsNotNone(old_result, '원본 스냅샷 판정 자체가 신호를 내야 대조가 의미 있음')

        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = pp.compute_bluechip_pullback_signal('005930', conn=object())

        self.assertTrue(bool(df.iloc[-1]['entry_signal']))

    def test_flat_series_never_signals(self):
        rows = [{
            "date": (date(2024, 1, 1) + timedelta(days=i)).isoformat(),
            "open": 10000, "high": 10050, "low": 9950, "close": 10000, "volume": 1000,
        } for i in range(260)]
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = pp.compute_bluechip_pullback_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_empty_rows_returns_empty_dataframe_with_columns(self):
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=[]):
            df = pp.compute_bluechip_pullback_signal('005930', conn=object())
        self.assertEqual(list(df.columns), pp.BLUECHIP_COLUMNS)
        self.assertEqual(len(df), 0)

    def test_rows_param_skips_db_lookup(self):
        rows = _bluechip_rows()
        with mock.patch.object(db_schema, 'load_daily_prices') as load_daily_prices:
            df = pp.compute_bluechip_pullback_signal('005930', conn=object(), rows=rows)
        load_daily_prices.assert_not_called()
        self.assertEqual(len(df), len(rows))


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음')
class SurgePullbackTests(unittest.TestCase):
    def test_fires_after_a_fast_pullback_following_a_surge(self):
        rows = _surge_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = pp.compute_surge_pullback_signal('005930', conn=object())
        self.assertTrue(df['entry_signal'].any())

    def test_no_signal_when_rise_is_too_small_to_call_a_surge(self):
        rows = _surge_rows(surge_total=0.15)  # SURGE_MIN_RISE(30%) 미만
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = pp.compute_surge_pullback_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_no_signal_when_drop_is_too_shallow(self):
        rows = _surge_rows(drop_total=0.02)  # SURGE_MIN_DROP(5%) 미만
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = pp.compute_surge_pullback_signal('005930', conn=object())
        self.assertFalse(df['entry_signal'].any())

    def test_empty_rows_returns_empty_dataframe_with_columns(self):
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=[]):
            df = pp.compute_surge_pullback_signal('005930', conn=object())
        self.assertEqual(list(df.columns), pp.SURGE_COLUMNS)
        self.assertEqual(len(df), 0)

    def test_rows_param_skips_db_lookup(self):
        rows = _surge_rows()
        with mock.patch.object(db_schema, 'load_daily_prices') as load_daily_prices:
            df = pp.compute_surge_pullback_signal('005930', conn=object(), rows=rows)
        load_daily_prices.assert_not_called()
        self.assertEqual(len(df), len(rows))


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음')
class PullbackBacktestReuseTests(unittest.TestCase):
    def test_backtest_functions_are_accumulation_angle_reexports(self):
        import accumulation_angle as aa
        self.assertIs(pp.backtest_entry_signal, aa.backtest_entry_signal)
        self.assertIs(pp.summarize_backtest, aa.summarize_backtest)


if __name__ == '__main__':
    unittest.main()
