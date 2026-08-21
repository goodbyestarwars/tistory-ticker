# -*- coding: utf-8 -*-
import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

try:
    import pandas  # noqa: F401
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False

if PANDAS_AVAILABLE:
    import accumulation_angle
    import indicator_sensitivity as ind


def _uptrend_rows(n=80, base=10000, step=100, volume=1000):
    rows = []
    cursor = date(2024, 1, 1)
    price = float(base)
    for i in range(n):
        price += step
        rows.append({
            'date': cursor.isoformat(),
            'open': price - step, 'high': price + 20, 'low': price - step - 20,
            'close': price, 'volume': volume,
        })
        cursor += timedelta(days=1)
    return rows


def _flat_rows(n=80, base=10000, volume=1000):
    rows = []
    cursor = date(2024, 1, 1)
    for i in range(n):
        rows.append({
            'date': cursor.isoformat(),
            'open': base - 5, 'high': base + 10, 'low': base - 10, 'close': base, 'volume': volume,
        })
        cursor += timedelta(days=1)
    return rows


def _rows_to_df(rows):
    """accumulation_angle.compute_accumulation_angle()과 동일한 컬럼 계약을 흉내낸 최소
    DataFrame - entry_signal/각도 계산 없이 순수 OHLCV+entry_signal 플래그만 있으면 되는
    collect_indicator_trades 테스트용."""
    import pandas as pd
    df = pd.DataFrame(rows)
    df['date'] = pd.to_datetime(df['date'])
    return df


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음 - accumulation_angle.py와 동일한 스킵 사유')
class ComputeCandidateIndicatorsTests(unittest.TestCase):
    def test_adds_all_indicator_columns(self):
        df = _rows_to_df(_uptrend_rows())
        out = ind.compute_candidate_indicators(df)
        for col in ind.INDICATOR_COLUMNS:
            self.assertIn(col, out.columns)

    def test_strong_uptrend_pushes_momentum_indicators_high(self):
        df = _rows_to_df(_uptrend_rows(n=80))
        out = ind.compute_candidate_indicators(df)
        last = out.iloc[-1]
        # 꾸준한 상승 구간이면 RSI/스토캐스틱은 과매수권, 이격도는 100 초과여야 한다.
        self.assertGreater(last['rsi14'], 60)
        self.assertGreater(last['stoch_k'], 80)
        self.assertGreater(last['disparity20'], 100)
        self.assertGreater(last['macd_hist'], 0)

    def test_flat_series_rsi_is_100_without_crash(self):
        df = _rows_to_df(_flat_rows(n=60))
        out = ind.compute_candidate_indicators(df)
        last = out.iloc[-1]
        # 완전 평평한 데이터는 avg_loss가 0이라 RSI가 100(0/0 대신 분기 처리)이 되는 게 맞다.
        # ADX는 방향성 움직임 자체가 없어(0/0) NaN이 나오는 게 맞다 - 여기선 예외 없이
        # 끝까지 계산되는지만 확인한다(값 자체는 위 test_adds_all_indicator_columns가 확인).
        self.assertEqual(last['rsi14'], 100.0)

    def test_empty_dataframe_returns_empty(self):
        import pandas as pd
        empty = pd.DataFrame(columns=['date', 'open', 'high', 'low', 'close', 'volume'])
        out = ind.compute_candidate_indicators(empty)
        self.assertTrue(out.empty)


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음')
class CollectIndicatorTradesTests(unittest.TestCase):
    def test_returns_net_return_and_indicator_values_per_signal(self):
        rows = _uptrend_rows(n=60)
        df = _rows_to_df(rows)
        df = ind.compute_candidate_indicators(df)
        df['entry_signal'] = False
        df.loc[40, 'entry_signal'] = True  # 지표가 이미 안정된 이후 구간 하나만 신호로 지정

        records = ind.collect_indicator_trades(df, hold_days=5, slippage_pct=0.0015)

        self.assertEqual(len(records), 1)
        record = records[0]
        entry_price = df.loc[41, 'open']
        exit_price = df.loc[46, 'close']
        expected_net = (exit_price - entry_price) / entry_price - 0.0015 * 2
        self.assertAlmostEqual(record['netReturn'], expected_net, places=8)
        for col in ind.INDICATOR_COLUMNS:
            self.assertIn(col, record)
        self.assertAlmostEqual(record['rsi14'], df.loc[40, 'rsi14'], places=8)

    def test_signal_too_close_to_end_is_dropped_for_missing_exit(self):
        rows = _uptrend_rows(n=60)
        df = _rows_to_df(rows)
        df = ind.compute_candidate_indicators(df)
        df['entry_signal'] = False
        df.loc[len(df) - 1, 'entry_signal'] = True  # 마지막 봉 - 다음날 시가/청산 종가가 없음

        records = ind.collect_indicator_trades(df, hold_days=5, slippage_pct=0.0015)

        self.assertEqual(records, [])

    def test_empty_dataframe_returns_empty_list(self):
        self.assertEqual(ind.collect_indicator_trades(None, 5, 0.0015), [])


@unittest.skipUnless(PANDAS_AVAILABLE, 'pandas가 설치되지 않음')
class SummarizeIndicatorSensitivityTests(unittest.TestCase):
    def _perfectly_correlated_records(self, n=40):
        # rsi14 값이 클수록 수익률도 커지도록 완전 상관 데이터를 만들어 4분위 승률이
        # Q1<Q2<Q3<Q4로 단조증가하는지, 상관계수가 1에 가까운지 확인한다.
        records = []
        for i in range(n):
            value = float(i)
            net_return = -0.05 + (i / n) * 0.10  # 앞쪽 절반은 손실, 뒤쪽 절반은 이익
            record = {'netReturn': net_return}
            for col in ind.INDICATOR_COLUMNS:
                record[col] = value if col == 'rsi14' else None
            records.append(record)
        return records

    def test_quartile_win_rate_increases_with_correlated_indicator(self):
        records = self._perfectly_correlated_records()
        summary = ind.summarize_indicator_sensitivity(records)

        rsi_summary = summary['rsi14']
        self.assertEqual(rsi_summary['sampleCount'], len(records))
        buckets = rsi_summary['buckets']
        self.assertEqual(len(buckets), 4)
        win_rates = [b['winRatePct'] for b in buckets]
        self.assertEqual(win_rates, sorted(win_rates))  # 단조증가
        self.assertGreater(rsi_summary['correlation'], 0.9)

    def test_indicator_with_too_few_samples_is_skipped(self):
        records = [{'netReturn': 0.01, **{col: (1.0 if col == 'rsi14' else None) for col in ind.INDICATOR_COLUMNS}}
                   for _ in range(3)]
        summary = ind.summarize_indicator_sensitivity(records)
        self.assertIsNone(summary['rsi14']['buckets'])
        self.assertEqual(summary['rsi14']['sampleCount'], 3)

    def test_empty_records_returns_empty_dict(self):
        self.assertEqual(ind.summarize_indicator_sensitivity([]), {})


if __name__ == '__main__':
    unittest.main()
