"""Public endpoint validation, no-store and safe failures without broker calls."""
import json
import os
import sys
import unittest
from unittest import mock

from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import main


class ManualCheckRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)  # Do not start background collectors.
        self.rate = mock.patch.object(main, '_check_rate_limit').start()
        self.addCleanup(mock.patch.stopall)
        self.addCleanup(self.client.close)

    def test_no_store_and_selected_name_pass_through(self):
        with mock.patch.object(main.hour_candidates, 'scan', return_value={'state': 'ready', 'items': []}) as scan:
            response = self.client.get('/hour-candidates?mode=selected&code=035420&name=NAVER')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertTrue(response.json()['success'])
        self.assertEqual(scan.call_args.kwargs['name'], 'NAVER')
        self.rate.assert_called_once()

    def test_bad_parameters_never_call_provider(self):
        with mock.patch.object(main.hour_candidates, 'scan') as scan:
            for query in ['mode=unknown', 'mode=selected&code=../../x', 'max_open_rise_pct=0',
                          'max_minute_jump_pct=nan', 'max_open_rise_pct=inf']:
                response = self.client.get('/hour-candidates?' + query)
                self.assertIn(response.status_code, (400, 422))
            scan.assert_not_called()

    def test_busy_and_upstream_errors_have_safe_messages(self):
        for error, status in [(main.hour_candidates.BusyError('internal'), 409),
                              (RuntimeError('provider secret-like raw response must not be shown'), 503)]:
            with mock.patch.object(main.hour_candidates, 'scan', side_effect=error):
                response = self.client.get('/hour-candidates')
            self.assertEqual(response.status_code, status)
            self.assertNotIn('internal', response.text)
            self.assertNotIn('provider secret-like', response.text)


if __name__ == '__main__':
    unittest.main()


class DirectionRouteTests(unittest.TestCase):
    setUp = ManualCheckRouteTests.setUp
    def test_single_stock_direction_no_store_and_shared_rate_bucket(self):
        with mock.patch.object(main.hour_candidates, 'check_direction', return_value={
                'direction': 'unclear', 'probability': None, 'validated': False}) as check:
            response = self.client.get('/hour-direction?code=035420&name=NAVER')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.json()['data']['direction'], 'unclear')
        self.assertEqual(check.call_args.args, ('035420',))
        self.assertEqual(check.call_args.kwargs['name'], 'NAVER')
        self.assertEqual(self.rate.call_args.args[0], 'hour_candidates')

    def test_direction_needs_stock_code_and_does_not_call_provider_on_invalid_input(self):
        with mock.patch.object(main.hour_candidates, 'check_direction') as check:
            for query in ['', 'code=../../x', 'code=US:AAPL', 'code=035420&name=' + 'a'*81]:
                response = self.client.get('/hour-direction?' + query)
                self.assertEqual(response.status_code, 422)
            check.assert_not_called()

    def test_direction_errors_do_not_expose_provider_details(self):
        for error, status in [(main.hour_candidates.BusyError('secret'), 409), (RuntimeError('raw secret'), 503)]:
            with mock.patch.object(main.hour_candidates, 'check_direction', side_effect=error):
                response = self.client.get('/hour-direction?code=035420')
            self.assertEqual(response.status_code, status)
            self.assertNotIn('secret', response.text)


    def test_client_cannot_expand_lookback_or_worker_count(self):
        with mock.patch.object(main.hour_candidates,'check_direction',return_value={'direction':'unclear'}) as check:
            response=self.client.get('/hour-direction?code=035420&lookback=390&workers=100&mode=ranked')
        self.assertEqual(response.status_code,200)
        self.assertNotIn('lookback',check.call_args.kwargs)
        self.assertNotIn('workers',check.call_args.kwargs)
        self.assertNotIn('mode',check.call_args.kwargs)
