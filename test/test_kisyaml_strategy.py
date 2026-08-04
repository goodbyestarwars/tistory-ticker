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


class ExampleFileTests(unittest.TestCase):
    def test_bundled_example_files_parse(self):
        strategies_dir = os.path.join(CLOUD_VM_DIR, 'strategies')
        for fname in os.listdir(strategies_dir):
            if fname.endswith('.kis.yaml'):
                kisyaml_strategy.load_strategy_file(os.path.join(strategies_dir, fname))


if __name__ == '__main__':
    unittest.main()
