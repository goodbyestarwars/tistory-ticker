# -*- coding: utf-8 -*-
import os
import sys
import unittest

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import kisyaml_strategy  # noqa: E402

GOLDEN_CROSS_YAML = '''
version: "1.0"

metadata:
  name: "골든크로스"
  description: "단기 MA가 장기 MA를 상향 돌파 시 매수"
  author: "KIS"
  tags: [ma, crossover, trend]

strategy:
  id: golden_cross
  category: trend

  indicators:
    - id: sma
      alias: sma_fast
      params:
        period: 5
    - id: sma
      alias: sma_slow
      params:
        period: 20

  entry:
    logic: AND
    conditions:
      - indicator: sma_fast
        operator: cross_above
        compare_to: sma_slow

  exit:
    logic: AND
    conditions:
      - indicator: sma_fast
        operator: cross_below
        compare_to: sma_slow

risk:
  stop_loss:
    enabled: true
    percent: 5.0
  take_profit:
    enabled: true
    percent: 10.0
  trailing_stop:
    enabled: false
    percent: 3.0
'''


def _bar(date, close, high=None, low=None, volume=1000):
    return {
        'date': date,
        'open': close,
        'high': high if high is not None else close,
        'low': low if low is not None else close,
        'close': close,
        'volume': volume,
    }


class ParseYamlTests(unittest.TestCase):
    def test_parses_readme_example(self):
        strategy = kisyaml_strategy.parse_strategy_yaml(GOLDEN_CROSS_YAML)
        self.assertEqual(strategy['version'], '1.0')
        self.assertEqual(strategy['metadata']['name'], '골든크로스')
        self.assertEqual(strategy['metadata']['tags'], ['ma', 'crossover', 'trend'])
        self.assertEqual(strategy['strategy']['id'], 'golden_cross')
        indicators = strategy['strategy']['indicators']
        self.assertEqual(len(indicators), 2)
        self.assertEqual(indicators[0], {'id': 'sma', 'alias': 'sma_fast', 'params': {'period': 5}})
        self.assertEqual(indicators[1], {'id': 'sma', 'alias': 'sma_slow', 'params': {'period': 20}})
        self.assertEqual(strategy['strategy']['entry'], {
            'logic': 'AND',
            'conditions': [{'indicator': 'sma_fast', 'operator': 'cross_above', 'compare_to': 'sma_slow'}],
        })
        self.assertEqual(strategy['risk']['stop_loss'], {'enabled': True, 'percent': 5.0})
        self.assertFalse(strategy['risk']['trailing_stop']['enabled'])

    def test_rejects_unknown_indicator(self):
        bad = GOLDEN_CROSS_YAML.replace('id: sma\n      alias: sma_fast', 'id: nope\n      alias: sma_fast')
        with self.assertRaises(kisyaml_strategy.StrategyError):
            kisyaml_strategy.parse_strategy_yaml(bad)

    def test_rejects_condition_referencing_undefined_alias(self):
        bad = GOLDEN_CROSS_YAML.replace('compare_to: sma_slow\n\n  exit',
                                         'compare_to: does_not_exist\n\n  exit')
        with self.assertRaises(kisyaml_strategy.StrategyError):
            kisyaml_strategy.parse_strategy_yaml(bad)


class IndicatorTests(unittest.TestCase):
    def test_sma_basic(self):
        daily = [_bar(str(i), v) for i, v in enumerate([1, 2, 3, 4, 5])]
        out = kisyaml_strategy._sma(daily, 3)
        self.assertEqual(out, [None, None, 2.0, 3.0, 4.0])

    def test_rsi_all_gains_is_100(self):
        closes = list(range(1, 20))  # 계속 상승
        daily = [_bar(str(i), v) for i, v in enumerate(closes)]
        out = kisyaml_strategy._rsi(daily, period=14)
        self.assertEqual(out[14], 100)

    def test_highest_lowest(self):
        daily = [_bar(str(i), v, high=v + 1, low=v - 1) for i, v in enumerate([5, 3, 8, 2, 9])]
        self.assertEqual(kisyaml_strategy._highest(daily, 3), [None, None, 9, 9, 10])
        self.assertEqual(kisyaml_strategy._lowest(daily, 3), [None, None, 2, 1, 1])


class EvaluateTests(unittest.TestCase):
    def _make_daily(self, closes):
        return [_bar(str(i), v) for i, v in enumerate(closes)]

    def test_entry_buy_on_golden_cross(self):
        strategy = kisyaml_strategy.parse_strategy_yaml(GOLDEN_CROSS_YAML)
        # 20일 하락 후 반등 - 5일선이 20일선을 마지막 봉(index 22)에서 상향 돌파하도록 구성
        # (실측: index21 sma5=23.6<=sma20=25.025, index22 sma5=26.3>sma20=25.325)
        closes = [30 - i * 0.5 for i in range(20)] + [25, 30, 35]
        daily = self._make_daily(closes)
        result = kisyaml_strategy.evaluate(strategy, daily)
        self.assertEqual(result['action'], 'BUY')
        self.assertEqual(result['confidence'], 1.0)
        self.assertTrue(result['entry']['passed'])
        self.assertFalse(result['exit']['passed'])

    def test_hold_when_no_condition_met(self):
        strategy = kisyaml_strategy.parse_strategy_yaml(GOLDEN_CROSS_YAML)
        closes = [100.0] * 30  # 횡보(등락 없음) - 골든/데드크로스 자체가 없음
        daily = self._make_daily(closes)
        result = kisyaml_strategy.evaluate(strategy, daily)
        self.assertEqual(result['action'], 'HOLD')

    def test_numeric_compare_to_threshold(self):
        yaml_text = GOLDEN_CROSS_YAML.replace(
            'compare_to: sma_slow\n\n  exit',
            'compare_to: sma_slow\n      - indicator: sma_fast\n        operator: greater_than\n'
            '        compare_to: 1000000\n\n  exit',
        )
        strategy = kisyaml_strategy.parse_strategy_yaml(yaml_text)
        # cross_above 자체는 만족(index22)하지만 sma_fast > 1,000,000은 불가능하므로 AND 전체는 실패
        closes = [30 - i * 0.5 for i in range(20)] + [25, 30, 35]
        daily = self._make_daily(closes)
        result = kisyaml_strategy.evaluate(strategy, daily)
        self.assertEqual(result['action'], 'HOLD')
        self.assertEqual(result['entry']['matched'], 1)
        self.assertEqual(result['entry']['total'], 2)

    def test_risk_levels(self):
        strategy = kisyaml_strategy.parse_strategy_yaml(GOLDEN_CROSS_YAML)
        levels = kisyaml_strategy.risk_levels(strategy, 10000)
        self.assertAlmostEqual(levels['stop_loss_price'], 9500)
        self.assertAlmostEqual(levels['take_profit_price'], 11000)
        self.assertNotIn('trailing_stop_percent', levels)  # enabled: false


class NewIndicatorTests(unittest.TestCase):
    def test_disparity_basic(self):
        # sma(3)=[_,_,2,3,4] (test_sma_basic과 동일 데이터) -> disparity = close/sma*100
        daily = [_bar(str(i), v) for i, v in enumerate([1, 2, 3, 4, 5])]
        out = kisyaml_strategy._disparity(daily, period=3, basis='sma')
        self.assertIsNone(out[1])
        self.assertAlmostEqual(out[2], 3 / 2 * 100)
        self.assertAlmostEqual(out[4], 5 / 4 * 100)

    def test_streak_signed_consecutive_days(self):
        daily = [_bar(str(i), v) for i, v in enumerate([10, 11, 12, 11, 10, 9, 9])]
        # +1(11>10) +2(12>11) -1(11<12) -2(10<11) -3(9<10) 0(9==9)
        self.assertEqual(kisyaml_strategy._streak(daily), [0, 1, 2, -1, -2, -3, 0])

    def test_range_position(self):
        daily = [
            {'date': '0', 'open': 10, 'high': 12, 'low': 8, 'close': 11.6, 'volume': 1},  # 상단 근접
            {'date': '1', 'open': 10, 'high': 12, 'low': 8, 'close': 8.4, 'volume': 1},   # 하단 근접
            {'date': '2', 'open': 10, 'high': 10, 'low': 10, 'close': 10, 'volume': 1},   # 고가=저가
        ]
        out = kisyaml_strategy._range_position(daily)
        self.assertAlmostEqual(out[0], 90.0)
        self.assertAlmostEqual(out[1], 10.0)
        self.assertEqual(out[2], 50.0)

    def test_highest_exclude_current_shifts_window_back_one_bar(self):
        daily = [_bar(str(i), v, high=v + 1, low=v - 1) for i, v in enumerate([5, 3, 8, 2, 9])]
        # exclude_current=False(기존): index4의 window=[2,3,4] -> high 값 [3,10,3] max=10
        # exclude_current=True: index4의 window=[1,2,3] -> high 값 [4,9,3] max=9(자기 자신 제외)
        out = kisyaml_strategy._highest(daily, 3, exclude_current=True)
        self.assertIsNone(out[2])  # period=3이면 index3부터 값이 생김
        self.assertEqual(out[3], max(6, 4, 9))  # window=[0,1,2] high=[6,4,9]
        self.assertEqual(out[4], max(4, 9, 3))  # window=[1,2,3] high=[4,9,3]

    def test_stddev_normalize_returns_percent_of_mean(self):
        daily = [_bar(str(i), v) for i, v in enumerate([100, 100, 100, 100])]
        raw = kisyaml_strategy._stddev(daily, 4, normalize=False)
        pct = kisyaml_strategy._stddev(daily, 4, normalize=True)
        self.assertAlmostEqual(raw[3], 0.0)
        self.assertAlmostEqual(pct[3], 0.0)  # 변동 없음 -> 0%

        daily2 = [_bar(str(i), v) for i, v in enumerate([90, 100, 110, 100])]
        pct2 = kisyaml_strategy._stddev(daily2, 4, normalize=True)
        self.assertGreater(pct2[3], 0)


class TenPresetTests(unittest.TestCase):
    """README '10개 프리셋 전략' 표 전부를 kisyaml로 옮긴 strategies/*.kis.yaml이 실제
    daily_prices 모양 데이터에 대해 예외 없이 평가되는지 확인한다(정확한 매수 시그널
    여부보다 '깨지지 않고 결과 스키마를 지키는지'가 목적 - 각 프리셋의 세부 판정은
    IndicatorTests/NewIndicatorTests에서 별도 검증)."""

    PRESET_IDS = [
        'golden_cross', 'momentum', 'trend_filter', 'week52_high', 'consecutive',
        'disparity', 'breakout_fail', 'strong_close', 'volatility', 'mean_reversion',
    ]

    @classmethod
    def setUpClass(cls):
        # 시드 고정 의사난수 - 300거래일치(week52_high가 최소 253일 필요)를 재현 가능하게 생성.
        import random
        rnd = random.Random(42)
        price = 10000.0
        daily = []
        for i in range(300):
            price = max(100.0, price * (1 + rnd.uniform(-0.03, 0.032)))
            high = price * (1 + rnd.uniform(0, 0.02))
            low = price * (1 - rnd.uniform(0, 0.02))
            daily.append({
                'date': '2026-%03d' % i,
                'open': price, 'high': high, 'low': low, 'close': price,
                'volume': 1000 + i,
            })
        cls.daily = daily

    def test_all_ten_presets_exist(self):
        strategies_dir = os.path.join(CLOUD_VM_DIR, 'strategies')
        found = {f[:-len('.kis.yaml')] for f in os.listdir(strategies_dir) if f.endswith('.kis.yaml')}
        missing = set(self.PRESET_IDS) - found
        self.assertFalse(missing, '누락된 프리셋 파일: %s' % missing)

    def test_all_ten_presets_evaluate_without_error(self):
        strategies_dir = os.path.join(CLOUD_VM_DIR, 'strategies')
        for preset_id in self.PRESET_IDS:
            path = os.path.join(strategies_dir, preset_id + '.kis.yaml')
            strategy = kisyaml_strategy.load_strategy_file(path)
            self.assertEqual(strategy['strategy']['id'], preset_id)
            result = kisyaml_strategy.evaluate(strategy, self.daily)
            self.assertIn(result['action'], ('BUY', 'SELL', 'HOLD'))
            self.assertGreaterEqual(result['confidence'], 0.0)
            self.assertLessEqual(result['confidence'], 1.0)


class ExampleFileTests(unittest.TestCase):
    def test_bundled_example_files_parse(self):
        strategies_dir = os.path.join(CLOUD_VM_DIR, 'strategies')
        for fname in os.listdir(strategies_dir):
            if fname.endswith('.kis.yaml'):
                kisyaml_strategy.load_strategy_file(os.path.join(strategies_dir, fname))


if __name__ == '__main__':
    unittest.main()
