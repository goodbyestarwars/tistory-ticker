import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import earnings_calendar


class EarningsCalendarTests(unittest.TestCase):
    def setUp(self):
        earnings_calendar._finnhub_cache.clear()

    def test_fetches_and_caches_us_month(self):
        rows = [
            {'date': '2026-08-15', 'symbol': 'AAPL', 'company': 'Apple Inc.', 'hour': 'amc'},
            {'date': '2026-08-15', 'symbol': 'AAPL', 'company': 'Apple Inc.', 'hour': 'amc'},
            {'date': '2026-09-01', 'symbol': 'MSFT', 'company': 'Microsoft', 'hour': 'bmo'},
            {'date': '2026-08-20', 'company': 'No ticker'},
        ]
        with mock.patch.dict(os.environ, {'FINNHUB_API_KEY': 'test-key'}):
            with mock.patch.object(earnings_calendar, '_fetch_finnhub', return_value=rows) as fetch:
                events = earnings_calendar.fetch_us_month(2026, 8)
                cached = earnings_calendar.fetch_us_month(2026, 8)

        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['title'], '$AAPL 실적발표 (장후) · Apple Inc. | 미국(Finnhub)')
        self.assertEqual(events[0]['source'], 'finnhub')
        self.assertEqual(cached, events)

    def test_marks_reported_us_earnings_with_eps_and_revenue_results(self):
        rows = [{
            'date': '2026-08-15',
            'symbol': 'AAPL',
            'company': 'Apple Inc.',
            'hour': 'amc',
            'epsActual': 1.2,
            'epsEstimate': 1.0,
            'revenueActual': 91819000000,
            'revenueEstimate': 88496400810,
        }]
        with mock.patch.dict(os.environ, {'FINNHUB_API_KEY': 'test-key'}):
            with mock.patch.object(earnings_calendar, '_fetch_finnhub', return_value=rows):
                events = earnings_calendar.fetch_us_month(2026, 8)

        event = events[0]
        self.assertEqual(event['status'], 'reported')
        self.assertEqual(event['eps_actual'], 1.2)
        self.assertEqual(event['revenue_actual'], 91819000000)
        self.assertIn('실적발표 완료', event['title'])
        self.assertIn('EPS 1.20', event['title'])
        self.assertIn('매출 $91.8B', event['title'])
        self.assertIn('상회', event['title'])

    def test_merges_domestic_and_us_events_in_date_order(self):
        domestic = [{'title': '$삼성전자 실적발표 | 자동(DART)', 'start': '2026-08-20', 'source': 'dart'}]
        us = [{'title': '$AAPL 실적발표 | 미국(Finnhub)', 'start': '2026-08-15', 'source': 'finnhub'}]
        with mock.patch.object(earnings_calendar, 'safe_fetch_month', return_value=domestic):
            with mock.patch.object(earnings_calendar, 'safe_fetch_us_month', return_value=us):
                events = earnings_calendar.merge_month(2026, 8)

        self.assertEqual([event['start'] for event in events], ['2026-08-15', '2026-08-20'])


    def test_merges_domestic_before_us_on_same_date(self):
        domestic = [{'title': 'Domestic earnings', 'start': '2026-08-15', 'source': 'dart', 'market': 'domestic'}]
        us = [
            {'title': 'US earnings', 'start': '2026-08-15', 'source': 'finnhub', 'market': 'us'},
            {'title': 'US earnings later', 'start': '2026-08-20', 'source': 'finnhub', 'market': 'us'},
        ]
        with mock.patch.object(earnings_calendar, 'safe_fetch_month', return_value=domestic):
            with mock.patch.object(earnings_calendar, 'safe_fetch_us_month', return_value=us):
                events = earnings_calendar.merge_month(2026, 8)

        self.assertEqual([(event['market'], event['start']) for event in events], [
            ('domestic', '2026-08-15'), ('us', '2026-08-15'), ('us', '2026-08-20')
        ])


if __name__ == '__main__':
    unittest.main()
