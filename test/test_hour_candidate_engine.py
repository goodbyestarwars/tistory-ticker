# -*- coding: utf-8 -*-
"""미래 누출과 자료 오류로 잘못된 후보가 생기지 않는 계산 계약."""

import copy
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import hour_candidate_engine as engine  # noqa: E402


def snapshot():
    bars = []
    for index, (opening, low, closing, volume) in enumerate([
        (10000, 9980, 10010, 1000), (10010, 9990, 10020, 1000),
        (10020, 10000, 10030, 1000), (10030, 10010, 10040, 2000),
        (10040, 10020, 10050, 2500),
    ]):
        bars.append({'date': '2026-10-06', 'time': '09:%02d:00' % index,
                     'open': opening, 'high': closing + 10, 'low': low,
                     'close': closing, 'volume': volume})
    return {
        'code': '111111', 'name': '표본', 'market': 'KRX', 'source': 'KIS',
        'checkedAt': '2026-10-06T09:05:08+09:00',
        'dataAsOf': '2026-10-06T09:05:06+09:00', 'bars': bars,
        'quote': {'open': 10000, 'high': 10060, 'base': 10000,
                  'upperLimit': 13000, 'tempStop': 'N'},
        'book': {'time': '2026-10-06T09:05:05+09:00',
                 'asks': [{'price': 10070, 'qty': 200}, {'price': 10060, 'qty': 100}],
                 'bids': [{'price': 10040, 'qty': 1000}, {'price': 10050, 'qty': 800}]},
        'trade': {'time': '2026-10-06T09:05:06+09:00', 'price': 10050,
                  'qty': 100, 'strength': 120},
        'previousVolume': {'value': 100000, 'date': '2026-10-02',
                           'source': 'KIS', 'market': 'KRX'},
    }


class CandidateTest(unittest.TestCase):
    def test_joint_conditions_and_tick_aware_prices(self):
        result = engine.evaluate(snapshot())
        self.assertEqual(result['status'], 'candidate')
        self.assertEqual(result['entryPrice'], 10060)
        self.assertEqual(result['targetPrice'], 10370)
        self.assertEqual(result['stopPrice'], 9760)
        self.assertEqual(result['expiresAt'], '2026-10-06T10:05:08+09:00')
        self.assertGreaterEqual(result['targetPct'], 3)
        self.assertGreaterEqual(result['stopPct'], -3)
        self.assertLess(result['stopPct'], 0)
        self.assertIsNone(result['probability'])
        self.assertAlmostEqual(result['metrics']['recentPrevVolumePct'], 4.5)
        self.assertEqual(result['metrics']['strongestBidWall']['price'], 10040)
        self.assertFalse(result['metrics']['breakoutConfirmed'])
        self.assertEqual(result['metrics']['priorHigh'], 10050)

    def test_rising_lows_without_volume_are_rejected(self):
        data = snapshot()
        for row in data['bars']:
            row['volume'] = 1000
        result = engine.evaluate(data)
        self.assertEqual(result['status'], 'rejected')
        self.assertTrue(result['metrics']['risingRecentLows'])
        self.assertIn('거래량', ' '.join(result['reasons']))

    def test_large_total_bid_does_not_override_weak_strength(self):
        data = snapshot()
        data['book']['bids'][0]['qty'] = 100000000
        data['trade']['strength'] = 80
        self.assertEqual(engine.evaluate(data)['status'], 'rejected')

    def test_visible_ask_wall_is_burden_proxy(self):
        data = snapshot()
        data['book']['asks'][0]['qty'] = 6000
        result = engine.evaluate(data)
        self.assertEqual(result['status'], 'rejected')
        self.assertTrue(result['metrics']['visibleResistanceOnly'])
        self.assertGreater(result['metrics']['visibleResistanceToRecentVolume'], 1)

    def test_empty_book_levels_do_not_hide_valid_best_ask(self):
        data = snapshot()
        data['book']['asks'] += [{'price': 0, 'qty': 0}, {'price': None, 'qty': None}]
        data['book']['bids'] += [{'price': None, 'qty': 0}]
        self.assertEqual(engine.evaluate(data), engine.evaluate(snapshot()))

    def test_volume_acceleration_without_previous_day_participation_is_excluded(self):
        data = snapshot()
        data['previousVolume']['value'] = 10000000
        result = engine.evaluate(data)
        self.assertEqual(result['status'], 'rejected')
        self.assertGreater(result['metrics']['volumeAcceleration'], 1.3)
        self.assertIn('전일 거래량', ' '.join(result['reasons']))

    def test_exact_open_surge_threshold_is_excluded_with_missing_strength(self):
        data = snapshot()
        data['quote']['high'] = 10500
        data['trade']['strength'] = None
        result = engine.evaluate(data)
        self.assertEqual(result['status'], 'rejected')
        self.assertIn('개장 후', result['reasons'][0])

    def test_intrabar_spike_is_excluded_even_if_close_recovers(self):
        data = snapshot()
        data['bars'][1]['high'] = 10200
        data['quote']['high'] = 10200
        result = engine.evaluate(data)
        self.assertEqual(result['status'], 'rejected')
        self.assertIn('한 번에', ' '.join(result['reasons']))

    def test_opening_gap_from_previous_complete_bar_is_excluded(self):
        data = snapshot()
        data['bars'][2].update(open=10200, high=10210, close=10030)
        data['quote']['high'] = 10210
        self.assertEqual(engine.evaluate(data)['status'], 'rejected')

    def test_unreachable_target_and_trading_halt_are_excluded(self):
        for change in ({'upperLimit': 10300}, {'tempStop': 'Y'}, {'tempStop': True}):
            data = snapshot()
            data['quote'].update(change)
            self.assertEqual(engine.evaluate(data)['status'], 'rejected')

    def test_missing_halt_status_is_unresolved_while_explicit_false_is_valid(self):
        for value in (None, 'unknown', 0, 1):
            data = snapshot()
            data['quote']['tempStop'] = value
            self.assertEqual(engine.evaluate(data)['status'], 'insufficient_data')
        data = snapshot()
        data['quote']['tempStop'] = False
        self.assertEqual(engine.evaluate(data)['status'], 'candidate')


class InformationBoundaryTest(unittest.TestCase):
    def test_missing_minutes_and_strength_are_unresolved(self):
        data = snapshot()
        del data['bars'][1]
        self.assertEqual(engine.evaluate(data)['status'], 'insufficient_data')
        data = snapshot()
        data['trade']['strength'] = None
        self.assertEqual(engine.evaluate(data)['status'], 'insufficient_data')

    def test_previous_day_bars_are_ignored(self):
        data = snapshot()
        old = copy.deepcopy(data['bars'][0])
        old.update(date='2026-10-05', high=100000, volume=10000000)
        data['bars'].append(old)
        self.assertEqual(engine.evaluate(data), engine.evaluate(snapshot()))

    def test_current_and_future_bar_prices_never_affect_decision(self):
        data = snapshot()
        data['bars'] += [dict(data['bars'][0], time='09:05:00', high=float('nan')),
                         dict(data['bars'][0], time='10:00:00', high=9999999)]
        self.assertEqual(engine.evaluate(data), engine.evaluate(snapshot()))

    def test_unconfirmed_last_pivot_is_not_counted(self):
        data = snapshot()
        lows = [9980, 9970, 9990, 10000, 9990]
        for row, low in zip(data['bars'], lows):
            row['low'] = low
        result = engine.evaluate(data)
        self.assertEqual(result['status'], 'rejected')
        self.assertEqual(len(result['metrics']['confirmedPivotLows']), 1)

    def test_two_confirmed_pivots_can_replace_last_three_rising_lows(self):
        data = snapshot()
        data['checkedAt'] = '2026-10-06T09:10:08+09:00'
        data['dataAsOf'] = data['trade']['time'] = '2026-10-06T09:10:06+09:00'
        data['book']['time'] = '2026-10-06T09:10:05+09:00'
        lows = [9990, 9970, 9990, 10000, 9980, 10000, 10010, 10020, 10010, 10010]
        data['bars'] = [dict(data['bars'][0], time='09:%02d:00' % index,
                             open=max(10000, low), low=low, high=10070, close=10050,
                             volume=2500 if index >= 8 else 1000)
                        for index, low in enumerate(lows)]
        data['quote']['high'] = 10070
        result = engine.evaluate(data)
        self.assertEqual(result['status'], 'candidate')
        self.assertFalse(result['metrics']['risingRecentLows'])
        self.assertTrue(result['metrics']['risingConfirmedPivotLows'])

    def test_stale_future_or_timezone_free_live_times_do_not_qualify(self):
        for field, stamp in [('book', '2026-10-06T09:04:57+09:00'),
                             ('trade', '2026-10-06T09:05:09+09:00'),
                             ('book', '2026-10-06T09:05:05')]:
            data = snapshot()
            data[field]['time'] = stamp
            self.assertEqual(engine.evaluate(data)['status'], 'insufficient_data')

    def test_trade_ask_disagreement_is_unresolved(self):
        data = snapshot()
        data['trade']['price'] = 10000
        result = engine.evaluate(data)
        # Momentum itself is also false, so the verified exclusion wins.
        self.assertNotEqual(result['status'], 'candidate')
        self.assertIn('0.5%', ' '.join(result['reasons']))

    def test_future_metadata_and_market_mismatch_are_unresolved(self):
        for field, value in [('dataAsOf', '2026-10-06T09:05:09+09:00'),
                             ('market', 'UN'), ('source', 'mixed')]:
            data = snapshot()
            data[field] = value
            self.assertEqual(engine.evaluate(data)['status'], 'insufficient_data')
        data = snapshot()
        data['previousVolume']['market'] = 'NXT'
        self.assertEqual(engine.evaluate(data)['status'], 'insufficient_data')

    def test_invalid_check_clock_and_unavailable_limit_are_unresolved(self):
        data = snapshot()
        data['checkedAt'] = '2026-10-06T09:05:08'
        result = engine.evaluate(data)
        self.assertEqual(result['status'], 'insufficient_data')
        self.assertIsNone(result['entryPrice'])
        self.assertIsNone(result['targetPct'])
        data = snapshot()
        data['quote']['upperLimit'] = None
        self.assertEqual(engine.evaluate(data)['status'], 'insufficient_data')

    def test_nonfinite_ohlc_and_invalid_book_prices_are_unresolved(self):
        for value in (float('nan'), float('inf'), -1):
            data = snapshot()
            data['bars'][0]['high'] = value
            self.assertEqual(engine.evaluate(data)['status'], 'insufficient_data')
        data = snapshot()
        data['book']['asks'][0]['price'] = 10071
        self.assertEqual(engine.evaluate(data)['status'], 'insufficient_data')

    def test_bar_order_is_irrelevant_but_duplicates_fail(self):
        data = snapshot()
        data['bars'].reverse()
        self.assertEqual(engine.evaluate(data), engine.evaluate(snapshot()))
        data['bars'].append(copy.deepcopy(data['bars'][0]))
        self.assertEqual(engine.evaluate(data)['status'], 'insufficient_data')


class TickAndSettingsTest(unittest.TestCase):
    def test_tick_boundary_ceiling_uses_destination_interval(self):
        self.assertEqual(engine.ceil_tick(19999.1), 20000)
        self.assertEqual(engine.ceil_tick(49999.1), 50000)
        self.assertEqual(engine.ceil_tick(199999.1), 200000)
        self.assertEqual(engine.ceil_tick(499999.1), 500000)
        self.assertEqual(engine.ceil_tick(20500 * 0.97), 19890)
        self.assertEqual(engine.ceil_tick(19900 * 1.03), 20500)

    def test_only_bounded_numeric_settings_are_accepted(self):
        for setting in ({'minStrength': '110'}, {'minStrength': True},
                        {'minStrength': float('nan')}, {'maxOpenRisePct': 0},
                        {'minStrength': 10 ** 1000},
                        {'targetPct': 1}, []):
            with self.assertRaises(ValueError):
                engine.evaluate(snapshot(), setting)
        self.assertEqual(engine.evaluate(snapshot(), {'minStrength': 130})['status'], 'rejected')
        self.assertEqual(engine.DEFAULT_SETTINGS['minStrength'], 110)


if __name__ == '__main__':
    unittest.main()
