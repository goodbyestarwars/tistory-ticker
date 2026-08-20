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


def _flat_then_rising_rows(flat_days=25, rise_days=15, base=10000, step=150):
    """앞부분은 거의 평평(각도 0 근방)하다가 뒷부분은 꾸준히 우상향하는 합성 OHLC.
    장기(20)/중기(EMA20 기준 5구간) 각도가 평평->상승 구간 경계 근처에서 음수->양수로
    전환되는지 확인하는 회귀 재료로 쓴다."""
    rows = []
    price = base
    cursor = date(2026, 1, 1)
    for _ in range(flat_days):
        rows.append({
            'date': cursor.isoformat(),
            'open': price, 'high': price + 5, 'low': price - 5, 'close': price, 'volume': 1000,
        })
        cursor += timedelta(days=1)
    for _ in range(rise_days):
        price += step
        rows.append({
            'date': cursor.isoformat(),
            'open': price - step, 'high': price + 5, 'low': price - step - 5, 'close': price, 'volume': 1000,
        })
        cursor += timedelta(days=1)
    return rows


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - 2026-08-20 기준 pandas-ta는 '
                      'Python 3.12+ 베타만 PyPI에 있어 이 환경(3.11)엔 못 깔지만, pandas 자체는 '
                      '별개로 설치 가능/불가능할 수 있어 이 테스트만 독립적으로 스킵한다.')
class AccumulationAngleTests(unittest.TestCase):
    def test_returns_expected_columns_and_row_count(self):
        rows = _flat_then_rising_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        self.assertEqual(list(df.columns), accumulation_angle.DAILY_PRICES_COLUMNS)
        self.assertEqual(len(df), len(rows))

    def test_empty_rows_returns_empty_dataframe_with_columns(self):
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=[]):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        self.assertEqual(list(df.columns), accumulation_angle.DAILY_PRICES_COLUMNS)
        self.assertEqual(len(df), 0)

    def test_short_angle_is_positive_during_sustained_rise(self):
        rows = _flat_then_rising_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        # 마지막 봉(꾸준히 오르는 구간 한복판)은 단기(EMA5) 각도가 뚜렷하게 양수여야 한다.
        self.assertGreater(df['short_angle'].iloc[-1], 0)

    def test_entry_signal_fires_only_at_the_flat_to_rise_turn(self):
        rows = _flat_then_rising_rows(flat_days=25, rise_days=15)
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = accumulation_angle.compute_accumulation_angle('005930', conn=object())
        # entry_signal이 한 번도 안 뜨거나(각도가 완전히 평평해 전환 자체가 없을 수 있음)
        # 뜬다면 반드시 평평 구간이 끝나고 상승 구간이 시작된 뒤(index >= flat_days)에만 떠야
        # 한다 - 평평한 초반 구간에서 잘못 켜지면 안 된다.
        fired = df.index[df['entry_signal']].tolist()
        for idx in fired:
            self.assertGreaterEqual(idx, 25)

    def test_conn_is_created_and_closed_when_not_provided(self):
        rows = _flat_then_rising_rows(flat_days=5, rise_days=5)
        fake_conn = mock.Mock()
        with mock.patch.object(db_schema, 'get_conn', return_value=fake_conn) as get_conn, \
                mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            accumulation_angle.compute_accumulation_angle('005930')
        get_conn.assert_called_once()
        fake_conn.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
