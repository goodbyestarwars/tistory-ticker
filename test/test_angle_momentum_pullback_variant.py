# -*- coding: utf-8 -*-
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

try:
    import pandas  # noqa: F401
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False

if PANDAS_AVAILABLE:
    import pandas as pd

    import angle_momentum_pullback_variant_scan as pv


def _frame(entry_signal_at, ema_long, low, close, open_, n=30):
    """entry_signal이 지정한 인덱스에서만 True인 최소 DataFrame(open/close/entry_signal/
    ema_long) - build_pullback_variant_returns()가 필요로 하는 컬럼만 있으면 된다."""
    data = {
        'open': open_,
        'close': close,
        'low': low,
        'ema_long': ema_long,
        'entry_signal': [i in entry_signal_at for i in range(n)],
    }
    return pd.DataFrame(data)


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - accumulation_angle.py와 동일한 스킵 사유')
class BuildPullbackVariantReturnsTests(unittest.TestCase):
    def test_entry_is_moved_to_first_ma_touch_after_signal(self):
        n = 20
        ema_long = [100.0] * n
        open_ = [100.0] * n
        close = [100.0] * n
        low = [100.0] * n
        # 신호는 5일차에 뜨고, 6~8일차는 지지선(100) 근처도 안 가다가 9일차에 처음
        # low가 이평선(100) 이내(허용오차 2%)로 닿는다 - gongpasan의 SUPPORT_TOUCH_TOL_PCT
        # 재사용을 전제로 한 테스트라 그 값이 바뀌면 이 테스트도 함께 재검토해야 한다.
        for i in (6, 7, 8):
            low[i] = 110.0  # 지지선 근처 아님
        low[9] = 99.0  # 이평선 대비 -1% - 허용오차(2%) 이내로 지지받은 첫 캔들
        close[9] = 100.5
        open_[10] = 101.0
        close[15] = 105.0  # hold_days=5 뒤(10+5=15) 청산 종가

        df = _frame(entry_signal_at={5}, ema_long=ema_long, low=low, close=close, open_=open_, n=n)

        returns = pv.build_pullback_variant_returns(df, hold_days=5, slippage_pct=0.0015)

        self.assertEqual(len(returns), 1)
        expected = (105.0 - 101.0) / 101.0 - 0.0015 * 2
        self.assertAlmostEqual(returns[0], expected, places=8)

    def test_no_pullback_within_lookahead_yields_no_trade(self):
        n = 10
        ema_long = [50.0] * n  # 지지선이 훨씬 아래라 절대 안 닿음
        open_ = [100.0] * n
        close = [100.0] * n
        low = [95.0] * n
        df = _frame(entry_signal_at={2}, ema_long=ema_long, low=low, close=close, open_=open_, n=n)

        returns = pv.build_pullback_variant_returns(df, hold_days=5, slippage_pct=0.0015)

        self.assertEqual(returns, [])

    def test_no_signal_at_all_yields_no_trade(self):
        n = 10
        df = _frame(entry_signal_at=set(), ema_long=[100.0] * n, low=[99.0] * n,
                     close=[100.0] * n, open_=[100.0] * n, n=n)

        self.assertEqual(pv.build_pullback_variant_returns(df, hold_days=5, slippage_pct=0.0015), [])

    def test_empty_dataframe_returns_empty_list(self):
        self.assertEqual(pv.build_pullback_variant_returns(None, 5, 0.0015), [])
        self.assertEqual(pv.build_pullback_variant_returns(pd.DataFrame(), 5, 0.0015), [])


if __name__ == '__main__':
    unittest.main()
