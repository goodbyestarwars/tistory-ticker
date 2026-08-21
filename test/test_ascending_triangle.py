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
    import ascending_triangle as at
    import db_schema


def _triangle_rows(resistance_mode='flat', rising=True):
    """사용자가 그린 그림(계단식 저점 5개 + 저항선 + 돌파)을 그대로 옮긴 합성 OHLC.
    resistance_mode: 'flat'(수평 저항, 상승삼각형) / 'declining'(완만히 하락하며 저점과
    좁혀지는 저항, 수렴삼각형) / 'rising'(고점도 계속 올라가는 평행채널 - 막힘 없음, 음성
    대조군). rising=False면 저점 하나가 앞 저점보다 낮아지게 만든다(음성 대조군)."""
    rows = []
    cursor = [date(2024, 1, 1)]

    def add(o, h, l, c, v=1000):
        rows.append({'date': cursor[0].isoformat(), 'open': o, 'high': h, 'low': l, 'close': c, 'volume': v})
        cursor[0] += timedelta(days=1)

    add(11200, 11250, 11200, 11220)
    add(11150, 11200, 11150, 11170)

    lows = [9800.0, 9900.0, 10000.0, 10100.0, 10200.0]
    if not rising:
        lows = [9800.0, 9700.0, 10000.0, 9950.0, 10200.0]  # 두 번째 저점이 첫 저점보다 낮음

    if resistance_mode == 'declining':
        resistances = [10900.0, 10800.0, 10700.0, 10600.0, 10500.0]  # 완만히 하락하며 저점과 좁혀짐
    elif resistance_mode == 'rising':
        resistances = [10300.0, 10450.0, 10600.0, 10750.0, 10900.0]  # 고점도 계속 올라감(막힘 없음)
    else:
        resistances = [10500.0] * 5  # 수평 저항(상승삼각형)

    for low_v, resistance in zip(lows, resistances):
        add(low_v, low_v + 20, low_v, low_v + 10)                                  # 트로프(스윙 저점)
        add(low_v + 200, low_v + 250, low_v + 150, low_v + 220)                    # 상승1
        add(resistance - 200, resistance - 150, resistance - 250, resistance - 180)  # 상승2
        add(resistance - 15, resistance, resistance - 30, resistance - 15)          # 피크(스윙 고점)
        add(resistance - 200, resistance - 150, resistance - 250, resistance - 180)  # 하강1
        add(low_v + 200, low_v + 250, low_v + 150, low_v + 220)                    # 하강2(다음 트로프 직전)

    last_low = lows[-1]
    last_resistance = resistances[-1]
    add(last_low + 100, last_low + 140, last_low + 60, last_low + 90)   # 스윙 저점 확정용 버퍼(SWING=2)
    add(last_low + 150, last_low + 190, last_low + 100, last_low + 140)
    add(last_resistance - 20, last_resistance * 1.05, last_resistance - 40, last_resistance * 1.04)  # 돌파 캔들
    for _ in range(7):  # backtest_entry_signal(hold_days=5)가 필요로 하는 진입+청산 여유분 포함
        add(last_resistance * 1.04, last_resistance * 1.06, last_resistance * 1.02, last_resistance * 1.045)

    return rows


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - accumulation_angle.py와 동일한 스킵 사유')
class AscendingTriangleSignalTests(unittest.TestCase):
    def test_fires_once_at_the_breakout_candle(self):
        rows = _triangle_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = at.compute_ascending_triangle_signal('005930', conn=object())

        fired = df.index[df['entry_signal']].tolist()
        self.assertEqual(len(fired), 1, '같은 저항선으로 연속 재신호가 나면 안 된다(돌파 후 스윙점 재사용 방지 확인)')
        breakout_idx = fired[0]
        self.assertAlmostEqual(df.loc[breakout_idx, 'resistance'], 10500.0, places=2)
        self.assertGreater(df.loc[breakout_idx, 'close'], df.loc[breakout_idx, 'resistance'] * 1.02)

    def test_no_signal_when_lows_are_not_monotonically_rising(self):
        rows = _triangle_rows(rising=False)
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = at.compute_ascending_triangle_signal('005930', conn=object())

        self.assertFalse(df['entry_signal'].any())

    def test_no_signal_when_highs_keep_rising_instead_of_capped(self):
        """고점도 계속 오르는 평행채널(저항이 막혀있지 않음)은 상승/수렴삼각형이 아니다."""
        rows = _triangle_rows(resistance_mode='rising')
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = at.compute_ascending_triangle_signal('005930', conn=object())

        self.assertFalse(df['entry_signal'].any())

    def test_fires_when_resistance_declines_and_converges_with_rising_lows(self):
        """2026-08-21: 사용자가 두 번째 그림(저항선이 완전히 평평하지 않고 완만하게
        하락하며 저점 추세선과 좁혀 들어가는 수렴형)을 보여주며 "자로 잴 필요 없이"
        조건을 넓혀달라고 해서 추가한 케이스 - 완만히 하락하는 저항도 신호가 떠야 한다."""
        rows = _triangle_rows(resistance_mode='declining')
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = at.compute_ascending_triangle_signal('005930', conn=object())

        fired = df.index[df['entry_signal']].tolist()
        self.assertEqual(len(fired), 1)
        self.assertAlmostEqual(df.loc[fired[0], 'resistance'], 10500.0, places=2)  # 가장 최근(마지막) 저항 터치 값

    def test_swing_confirmation_does_not_use_future_bars(self):
        """look-ahead 방지: i번째 봉까지의 데이터만으로 확정 가능한 스윙만 삼각형 판정에
        쓴다(i-SWING 이후 스윙은 아직 '모르는' 것으로 취급) - 룩백 구간을 짧게 잘라도
        신호가 늦게 뜨긴 해도 더 일찍 뜨지는 않아야 한다는 것으로 확인한다."""
        rows = _triangle_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            full_df = at.compute_ascending_triangle_signal('005930', conn=object())
        breakout_idx = full_df.index[full_df['entry_signal']].tolist()[0]

        # 돌파 캔들 자체를 포함해 그 이후 데이터를 아예 잘라내면(미래 없음) 신호가 그 이전
        # 인덱스에서는 뜨면 안 된다 - 만약 떴다면 미래 봉을 미리 참조했다는 뜻이다.
        truncated_rows = rows[:breakout_idx]
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=truncated_rows):
            truncated_df = at.compute_ascending_triangle_signal('005930', conn=object())
        self.assertFalse(truncated_df['entry_signal'].any())

    def test_empty_rows_returns_empty_dataframe_with_columns(self):
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=[]):
            df = at.compute_ascending_triangle_signal('005930', conn=object())
        self.assertEqual(list(df.columns), at.DAILY_PRICES_COLUMNS)
        self.assertEqual(len(df), 0)

    def test_rows_param_skips_db_lookup(self):
        rows = _triangle_rows()
        with mock.patch.object(db_schema, 'load_daily_prices') as load_daily_prices:
            df = at.compute_ascending_triangle_signal('005930', conn=object(), rows=rows)
        load_daily_prices.assert_not_called()
        self.assertEqual(len(df), len(rows))


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음')
class AscendingTriangleBacktestReuseTests(unittest.TestCase):
    def test_backtest_functions_are_accumulation_angle_reexports(self):
        # accumulation_angle.py와 완전히 동일한 진입/청산 가정을 새로 만들지 않고
        # 재사용한다는 걸 명시적으로 확인 - 계약이 어긋나면(예: 시그니처 변경) 여기서 잡힌다.
        import accumulation_angle as aa
        self.assertIs(at.backtest_entry_signal, aa.backtest_entry_signal)
        self.assertIs(at.summarize_backtest, aa.summarize_backtest)

    def test_backtest_produces_expected_net_return_for_the_breakout_trade(self):
        rows = _triangle_rows()
        with mock.patch.object(db_schema, 'load_daily_prices', return_value=rows):
            df = at.compute_ascending_triangle_signal('005930', conn=object())

        returns = at.backtest_entry_signal(df, hold_days=5, slippage_pct=0.0015)
        self.assertEqual(len(returns), 1)

        breakout_idx = df.index[df['entry_signal']].tolist()[0]
        entry_price = df.loc[breakout_idx + 1, 'open']
        exit_price = df.loc[breakout_idx + 1 + 5, 'close']
        expected = (exit_price - entry_price) / entry_price - 0.0015 * 2
        self.assertAlmostEqual(returns[0], expected, places=8)


if __name__ == '__main__':
    unittest.main()
