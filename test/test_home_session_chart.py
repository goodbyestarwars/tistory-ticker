import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
import db_schema
import home_session_chart as charts
import foreign_futures

REAL_CONN = db_schema.get_conn


class SessionCharts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, 'test.db')
        self.conn = REAL_CONN(self.path)
        self.addCleanup(self.conn.close)
        db_schema.create_schema(self.conn)
        p = mock.patch.object(db_schema, 'get_conn', lambda: REAL_CONN(self.path))
        p.start()
        self.addCleanup(p.stop)

    def put(self, price, stamp='2026-10-15T10:01:00-04:00', symbol='NASDAQ_INDEX', **extra):
        q = dict(price=price, traded_at=stamp, market_status='OPEN')
        q.update(extra)
        return charts.record(self.conn, symbol, q, datetime.fromisoformat(stamp))

    def get(self, symbol='NASDAQ_INDEX'):
        return next(r for r in charts.get_results() if r['symbol'] == symbol)

    def test_observations_keep_high_low_and_latest_not_older_quote(self):
        self.put(100)
        self.put(110, '2026-10-15T10:05:00-04:00')
        self.put(90, '2026-10-15T10:03:00-04:00')
        r = self.get()['rows'][0]
        self.assertEqual((r['slot'], r['open'], r['high'], r['low'], r['close']), (1, 100, 110, 90, 110))

    def test_cash_boundaries_missing_slots_and_market_separation(self):
        self.assertFalse(self.put(1, '2026-10-15T09:29:00-04:00'))
        self.put(100, '2026-10-15T09:30:00-04:00')
        self.put(102, '2026-10-15T16:00:00-04:00')
        self.assertEqual([r['slot'] for r in self.get()['rows']], [0, 13])
        self.assertEqual(self.get('SP500_INDEX')['rows'], [])

    def test_dst_and_midnight_sessions(self):
        summer = charts.session('NASDAQ_INDEX', datetime.fromisoformat('2026-10-15T13:30:00Z'))
        winter = charts.session('NASDAQ_INDEX', datetime.fromisoformat('2026-12-15T14:30:00Z'))
        self.assertEqual((summer['slot'], winter['slot']), (0, 0))
        cme = charts.session('NASDAQ100', datetime.fromisoformat('2026-10-16T01:00:00-04:00'))
        self.assertEqual((cme['date'], cme['slot'], cme['slotCount']), ('2026-10-15', 14, 47))
        night = charts.session('KOSPI200_NIGHT', datetime.fromisoformat('2026-10-16T01:00:00+09:00'))
        self.assertEqual((night['date'], night['slot'], night['slotCount']), ('2026-10-15', 14, 25))

    def test_invalid_closed_old_future_and_break_rejected(self):
        self.assertFalse(self.put(100, market_status='CLOSE'))
        self.assertFalse(self.put(float('nan')))
        self.assertFalse(self.put(100, '2026-10-17T10:01:00-04:00'))
        self.assertIsNone(charts.session('NASDAQ100', datetime.fromisoformat('2026-10-15T17:30:00-04:00')))
        q = dict(price=100, traded_at='2026-10-15T10:00:00-04:00', market_status='OPEN')
        for delta in (-120, 1201):
            self.assertFalse(charts.record(self.conn, 'NASDAQ_INDEX', q,
                datetime.fromisoformat(q['traded_at']) + timedelta(seconds=delta)))

    def test_latest_session_survives_restart_and_no_backfill(self):
        self.put(100)
        self.put(101, '2026-10-16T11:00:00-04:00')
        result = self.get()
        self.assertEqual((result['session']['date'], len(result['rows'])), ('2026-10-16', 1))

    def test_night_actual_minutes_aggregate_high_low_and_new_session(self):
        def row(stamp, price):
            return dict(ts=int(datetime.fromisoformat(stamp).timestamp()), open=price, high=price+2, low=price-1, close=price+1)
        db_schema.upsert_future_chart_minute_rows(self.conn, 'KOSPI200_NIGHT', [
            row('2026-10-14T18:00:00+09:00', 100),
            row('2026-10-15T23:01:00+09:00', 110),
            row('2026-10-15T23:10:00+09:00', 115),
            row('2026-10-16T01:00:00+09:00', 112)])
        r = self.get('KOSPI200_NIGHT')
        self.assertEqual(r['session']['date'], '2026-10-15')
        self.assertEqual([p['slot'] for p in r['rows']], [10, 14])
        self.assertEqual((r['rows'][0]['high'], r['rows'][0]['low'], r['rows'][0]['close']), (117, 109, 116))

    def test_provider_metadata_is_used_without_extra_requests(self):
        fixture = {'datas': [dict(closePriceRaw='100', compareToPreviousClosePriceRaw='1', fluctuationsRatioRaw='1',
            highPriceRaw='102', lowPriceRaw='99', localTradedAt='2026-10-15T10:01:00-04:00', marketStatus='OPEN')]}
        with mock.patch.object(foreign_futures, '_get_json', return_value=fixture) as fetch:
            q = foreign_futures.fetch_realtime(dict(category='index', code='.IXIC'))
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(q['market_status'], 'OPEN')
        self.assertEqual(q['traded_at'], fixture['datas'][0]['localTradedAt'])

    def test_public_route_does_not_fetch_provider(self):
        from fastapi.testclient import TestClient
        import main
        with mock.patch.object(foreign_futures, '_get_json', side_effect=AssertionError('provider call')):
            r = TestClient(main.app).get('/home-session-chart')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()['data']), 5)
