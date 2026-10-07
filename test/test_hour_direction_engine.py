"""Direction hypotheses must not confuse absence of a buy setup with selling."""
import copy
import unittest
from datetime import datetime, timedelta
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


def intraday_snapshot(at='2026-10-06T13:00:08+09:00', bearish=False):
    data = bearish_snapshot() if bearish else snapshot()
    checked = datetime.fromisoformat(at)
    minute = checked.replace(second=0, microsecond=0)
    pattern = copy.deepcopy(data['bars'])
    bars = []
    for index in range(30):
        stamp = minute - timedelta(minutes=30-index)
        bar = (dict(pattern[index-25]) if index >= 25 else
               {'open': 10000, 'high': 10020, 'low': 9980, 'close': 10000, 'volume': 1000})
        bar.update(date=stamp.date().isoformat(), time=stamp.strftime('%H:%M:%S'))
        bars.append(bar)
    data.update(checkedAt=at, dataAsOf=(checked-timedelta(seconds=2)).isoformat(), bars=bars)
    data['book']['time']=(checked-timedelta(seconds=3)).isoformat()
    data['trade']['time']=(checked-timedelta(seconds=2)).isoformat()
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
            self.assertNotEqual(engine.evaluate_direction(data)['direction'], 'down')

    def test_weak_volume_is_context_not_a_direction_veto(self):
        for factory, expected in [(snapshot, 'up'), (bearish_snapshot, 'down')]:
            data = factory()
            for bar in data['bars']:
                bar['volume'] = 1000
            data['previousVolume']['value'] = 10000000
            result = engine.evaluate_direction(data)
            self.assertEqual(result['direction'], expected)
            self.assertIn('거래량은 약해', result['reason'])
            self.assertEqual(candidate.evaluate(data)['status'], 'rejected')
            for bar in data['bars']:
                bar['volume'] = 0
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

    def test_walls_annotate_but_cannot_create_a_direction(self):
        for factory, expected, side in [(snapshot, 'up', 'asks'), (bearish_snapshot, 'down', 'bids')]:
            data = factory()
            data['book'][side][0]['qty'] = 100000
            result = engine.evaluate_direction(data)
            self.assertEqual(result['direction'], expected)
            self.assertIn('잔량은 부담', result['reason'])
            for bar in data['bars']:
                bar.update(open=10000, high=10010, low=9990, close=10000)
            data['trade']['price'] = 10000
            self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')

    def test_execution_pressure_can_confirm_without_strict_three_bar_pattern(self):
        data = snapshot()
        for bar in data['bars'][-3:]:
            bar['low'] = 9980
            bar['high'] = 10070
        self.assertFalse(candidate.evaluate(data)['metrics']['risingRecentLows'])
        self.assertEqual(engine.evaluate_direction(data)['direction'], 'up')
        data['trade']['strength'] = 100
        self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')

    def test_small_directional_bounce_is_not_a_three_percent_setup(self):
        for factory, sign, delta in [(snapshot, '+3%', 1), (bearish_snapshot, '−3%', -1)]:
            data = factory()
            closes = [190000,190000,190000+100*delta,190000+100*delta,190000+200*delta]
            for i, row in enumerate(data['bars']):
                opening = closes[max(0,i-1)]
                row.update(open=opening, close=closes[i],
                           high=max(opening,closes[i])+100,low=min(opening,closes[i])-100)
            for side in ('asks','bids'):
                for level in data['book'][side]:
                    level['price'] = 190000 + (level['price']-10000)*10
            data['trade']['price'] = closes[-1]
            data['quote'].update(open=190000,high=190700,upperLimit=247000)
            result = engine.evaluate_direction(data)
            self.assertEqual(result['direction'], 'unclear')
            self.assertIn(sign, result['reason'])
            self.assertIsNone(result['targetPrice'])

    def test_recorded_naver_bounce_is_below_target_movement_screen(self):
        import json
        from pathlib import Path
        data = json.loads((Path(__file__).parent/'fixtures/hour_naver_20261007_0948.json').read_text(encoding='utf-8'))
        result = engine.evaluate_direction(data)
        self.assertEqual(result['direction'], 'unclear')
        self.assertIn('+3%', result['reason'])
        self.assertLess(result['metrics']['upMovementBudgetPct'], 0.5)
        self.assertGreater(result['metrics']['upRequiredMovePct'], 3)
        self.assertFalse(result['validated'])

    def test_movement_screen_includes_entry_gap_and_actual_tick_target(self):
        data = snapshot()
        bars, error = candidate._closed_bars(data['bars'], candidate._iso(data['checkedAt']), 30)
        self.assertIsNone(error)
        metrics = engine.movement_budget(bars, 10060, 10370, 9760)
        self.assertAlmostEqual(metrics['upRequiredMovePct'], (10370/10050-1)*100)
        self.assertFalse(metrics['movementBudgetValidated'])
        far = engine.movement_budget(bars, 11000, 11330, 10670)
        self.assertFalse(far['upMovementSupported'])

    def test_flat_choppy_prices_do_not_gain_drift_from_total_range(self):
        data = snapshot()
        bars, _ = candidate._closed_bars(data['bars'], candidate._iso(data['checkedAt']), 30)
        for i, row in enumerate(bars):
            row['close'] = 10000 + (10 if i % 2 else 0)
        metrics = engine.movement_budget(bars,10020,10330,9720)
        self.assertFalse(metrics['upMovementSupported'])
        self.assertFalse(metrics['downMovementSupported'])

    def test_coarse_single_tick_rebound_does_not_hide_lg_downtrend(self):
        import json
        from pathlib import Path
        data = json.loads((Path(__file__).parent/'fixtures/hour_066570_20261007.json').read_text(encoding='utf-8'))
        result = engine.evaluate_direction(data)
        self.assertEqual(result['direction'], 'down')
        self.assertEqual(result['metrics']['tradePriceTolerance'], 500)
        self.assertGreater(result['metrics']['downMovementBudgetPct'],result['metrics']['downRequiredMovePct'])
        data['trade']['price'] += 500
        self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')

    def test_hyundai_day_loss_is_not_fabricated_into_forward_downtrend(self):
        import json
        from pathlib import Path
        data = json.loads((Path(__file__).parent/'fixtures/hour_005380_20261007.json').read_text(encoding='utf-8'))
        result = engine.evaluate_direction(data)
        self.assertEqual(result['direction'], 'unclear')
        self.assertIn('매도 체결 우위',result['reason'])
        self.assertIn('횡보',result['reason'])
        self.assertIsNone(result['entryPrice'])

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


    def test_late_morning_and_afternoon_use_only_recent_thirty_minutes(self):
        for hour in (10, 11, 13, 14):
            for bearish in (False, True):
                data = intraday_snapshot(at='2026-10-06T%02d:00:08+09:00' % hour, bearish=bearish)
                result = engine.evaluate_direction(data)
                self.assertEqual(result['direction'], 'down' if bearish else 'up')
                self.assertEqual(result['metrics']['closedBarCount'], 30)
                self.assertEqual(result['metrics']['barLookbackMinutes'], 30)
                self.assertEqual(result['metrics']['directionPriceBasis'], '최근 5개 완결 분봉 시작 가격')
                old = copy.deepcopy(data['bars'][0])
                old.update(time='09:00:00', close=None, volume=999999999)
                data['bars'].append(old)
                self.assertEqual(engine.evaluate_direction(data), result)

    def test_missing_recent_bar_is_not_filled_from_old_bars(self):
        data = intraday_snapshot()
        del data['bars'][7]
        self.assertEqual(engine.evaluate_direction(data)['direction'], 'unclear')

    def test_last_hour_of_session_cannot_become_full_hour_forecast(self):
        for clock in ['14:30:00', '14:45:08', '15:20:08', '15:30:00']:
            data = intraday_snapshot('2026-10-06T'+clock+'+09:00')
            result = engine.evaluate_direction(data)
            self.assertEqual(result['direction'], 'unclear')
            self.assertIsNone(result['entryPrice'])
            if clock < '15:30:00':self.assertIn('1시간',result['reason'])
