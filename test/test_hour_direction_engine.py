"""Direction hypotheses must not confuse absence of a buy setup with selling."""
import copy
import unittest
from test_hour_candidate_engine import snapshot
import hour_candidate_engine as candidate
import hour_direction_engine as engine


def bearish_snapshot():
    data = snapshot()
    for row in data['bars']:
        old = dict(row)
        row.update(open=20000-old['open'], high=20000-old['low'],
                   low=20000-old['high'], close=20000-old['close'])
    data['trade'].update(price=9950, strength=80)
    data['book']['asks'] = [{'price': 9950, 'qty': 100}, {'price': 9960, 'qty': 200}]
    data['book']['bids'] = [{'price': 9940, 'qty': 200}, {'price': 9930, 'qty': 100}]
    return data


class DirectionTests(unittest.TestCase):
    def test_both_directions_are_independent_hypotheses(self):
        for data, expected in [(snapshot(), 'up'), (bearish_snapshot(), 'down')]:
            result = engine.evaluate_direction(data)
            self.assertEqual(result['direction'], expected)
            self.assertFalse(result['validated'])
            self.assertIsNone(result['probability'])
            self.assertEqual(result['horizonMinutes'], 60)
            self.assertEqual(result['expiresAt'], '2026-10-06T10:05:08+09:00')
            self.assertGreater(result['targetPrice'], result['entryPrice'])
            self.assertLess(result['stopPrice'], result['entryPrice'])
        self.assertEqual(candidate.evaluate(bearish_snapshot())['status'], 'rejected')

    def test_rejecting_up_setup_is_not_down_prediction(self):
        for field, value in [('strength', 80), ('strength', 100)]:
            data = snapshot()
            data['trade'][field] = value
            self.assertEqual(candidate.evaluate(data)['status'], 'rejected')
            self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')

    def test_both_directions_require_volume(self):
        for factory in (snapshot, bearish_snapshot):
            data = factory()
            for bar in data['bars']:
                bar['volume'] = 1000
            self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')
            data = factory()
            data['previousVolume']['value'] = 10000000
            self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')

    def test_missing_or_stale_inputs_block_even_with_known_rejection(self):
        for factory in (snapshot, bearish_snapshot):
            for section, field, value in [('trade', 'strength', None), ('trade', 'time', '2026-10-06T09:04:00+09:00'),
                                          ('book', 'time', '2026-10-06T09:05:59+09:00'), ('quote', 'tempStop', None)]:
                data = factory()
                data[section][field] = value
                self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')
            data = factory()
            del data['bars'][1]
            self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')

    def test_surge_halt_target_and_spread_are_not_bearish_signals(self):
        for factory in (snapshot, bearish_snapshot):
            for change in ({'high': 10600}, {'tempStop': 'Y'}, {'upperLimit': 10100}):
                data = factory()
                data['quote'].update(change)
                self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')
            data = factory()
            data['book']['bids'] = [{'price': 9890, 'qty': 100}]
            self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')

    def test_large_walls_veto_but_cannot_create_a_direction(self):
        data = snapshot()
        data['book']['asks'][0]['qty'] = 100000
        self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')
        data = bearish_snapshot()
        data['book']['bids'][0]['qty'] = 100000
        self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')

    def test_current_and_future_prices_never_affect_hypothesis(self):
        for factory in (snapshot, bearish_snapshot):
            data = factory()
            expected = engine.evaluate_direction(data)
            for minute in (5, 6, 59):
                row = copy.deepcopy(data['bars'][-1])
                row.update(time='09:%02d:00' % minute, high=999999, low=1, close=None, volume=99999999)
                data['bars'].append(row)
            self.assertEqual(engine.evaluate_direction(data), expected)

    def test_window_and_invalid_source_do_not_get_direction(self):
        for change in ({'checkedAt': None}, {'checkedAt': '2026-10-06T15:30:00+09:00'},
                       {'source': 'other'}, {'market': 'NXT'}, {'checkedAt': '2026-10-10T09:05:08+09:00'}):
            data = snapshot()
            data.update(change)
            self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')

    def test_crash_is_not_labelled_as_new_prediction(self):
        data = bearish_snapshot()
        data['bars'][0]['low'] = 9800
        result = engine.evaluate_direction(data)
        self.assertEqual(result['direction'], 'unclear')
        self.assertIn('한 번에', result['reason'])


    def test_converging_highs_and_lows_do_not_get_direction(self):
        data = snapshot()
        for bar, high in zip(data['bars'][-3:], [10100, 10090, 10080]):
            bar['high'] = high
        data['quote']['high'] = 10100
        result = engine.evaluate_direction(data)
        self.assertEqual(result['direction'], 'unclear')
        self.assertIn('함께', result['reason'])
