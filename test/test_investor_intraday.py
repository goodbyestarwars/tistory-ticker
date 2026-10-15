"""Intraday observations must not fabricate historical bars or add KIS calls."""
import os
import sys
import tempfile
import unittest
from datetime import datetime
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
import db_schema
import investor_trend as trend
import market_clock

REAL_CONN = db_schema.get_conn


class IntradayTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = os.path.join(tmp.name, 'observations.db')
        conn = REAL_CONN(self.path)
        db_schema.create_schema(conn)
        db_schema.create_schema(conn)  # Existing deployments must migrate idempotently.
        conn.close()
        patch = mock.patch.object(db_schema, 'get_conn', lambda: REAL_CONN(self.path))
        patch.start()
        self.addCleanup(patch.stop)
        patch = mock.patch.object(market_clock, 'is_kr_trading_day', side_effect=lambda d: d.weekday() < 5)
        patch.start()
        self.addCleanup(patch.stop)

    def at(self, day=16, hour=10, minute=5):
        return datetime(2026, 10, day, hour, minute, tzinfo=trend.KST)

    def put(self, value, now=None, market='KOSPI', date=None):
        now = now or self.at()
        row = dict(date=date or now.strftime('%Y%m%d'), ind=-value if value is not None else None, frgn=value, orgn=0)
        conn = REAL_CONN(self.path)
        try:
            return trend.record_intraday(conn, market, row, now)
        finally:
            conn.close()

    def get(self, now=None, market='kospi'):
        with mock.patch.object(trend.kis_client, 'get_token', side_effect=AssertionError('read API contacted KIS')):
            return trend.get_intraday_result(market, now or self.at())

    def test_same_slot_updates_latest_and_keeps_observed_extrema(self):
        self.put(100, self.at(minute=1))
        self.put(-40, self.at(minute=10))
        self.put(30, self.at(minute=29))
        data = self.get()
        self.assertEqual(len(data['rows']), 1)
        self.assertEqual(data['latest'], 30)
        self.assertEqual(data['extrema']['high'], {'value': 100, 'slot': 2})
        self.assertEqual(data['extrema']['low'], {'value': -40, 'slot': 2})

    def test_boundaries_and_missing_slots_are_not_filled(self):
        for h, m in [(8, 59), (15, 31), (17, 0)]:
            self.assertFalse(self.put(5, self.at(hour=h, minute=m)))
        self.put(1, self.at(hour=9, minute=0))
        self.put(-2, self.at(hour=15, minute=30))
        self.assertEqual([r['slot'] for r in self.get()['rows']], [0, 13])

    def test_exactly_fourteen_slots_for_full_session(self):
        for slot in range(14):
            minute = 540 + slot * 30
            self.put(slot, self.at(hour=minute // 60, minute=minute % 60))
        rows = self.get()['rows']
        self.assertEqual(len(rows), 14)
        self.assertEqual((rows[0]['label'], rows[-1]['label']), ('09:00', '15:30'))

    def test_old_row_weekend_and_missing_amount_are_rejected(self):
        self.assertFalse(self.put(100, date='20261015'))
        self.assertFalse(self.put(100, now=self.at(day=17)))
        self.assertFalse(self.put(float('nan')))
        self.assertFalse(self.put(None))
        self.assertEqual(self.get()['rows'], [])

    def test_new_session_clears_previous_bars_and_overnight_preserves_them(self):
        self.put(55, self.at(day=15))
        night = self.get(self.at(hour=0))
        self.assertEqual(night['date'], '2026-10-15')
        self.assertEqual(night['latest'], 55)
        opened = self.get(self.at(hour=9))
        self.assertEqual(opened['date'], '2026-10-16')
        self.assertEqual(opened['state'], 'no_samples')
        self.assertIsNone(opened['latest'])

    def test_markets_and_days_stay_separate_and_survive_reopen(self):
        self.put(100)
        self.put(-300, market='KOSDAQ')
        self.assertEqual(self.get()['latest'], 100)
        self.assertEqual(self.get(market='kosdaq')['latest'], -300)

    def test_daily_fallback_does_not_turn_into_intraday_bar(self):
        conn = REAL_CONN(self.path)
        db_schema.upsert_investor_trend_rows(conn, 'KOSPI', [dict(date='20261015', ind=1, frgn=25, orgn=3)])
        conn.close()
        data = self.get(self.at(hour=0))
        self.assertEqual(data['latest'], 25)
        self.assertEqual(data['rows'], [])
        self.assertIsNone(data['extrema']['high'])

    def test_existing_poll_records_without_additional_provider_call(self):
        row = dict(date='20261016', ind=1, frgn=2, orgn=3)
        with mock.patch.object(trend.kis_client, 'get_token', return_value='test'), \
                mock.patch.object(trend, 'fetch_kis_day', return_value=row) as fetch, \
                mock.patch.object(trend, 'record_intraday') as record:
            trend.refresh_recent_kis('test', 'test', 'KOSPI', 'KSP', '0001')
        self.assertEqual(fetch.call_count, 1)
        record.assert_called_once()

    def test_retention_removes_old_observations(self):
        self.put(1, self.at(day=1))
        self.put(2, self.at())
        conn = REAL_CONN(self.path)
        dates = [r[0] for r in conn.execute('SELECT DISTINCT date FROM investor_trend_intraday')]
        conn.close()
        self.assertEqual(dates, ['20261016'])

    def test_public_route_dispatches_intraday_and_keeps_daily_contract(self):
        import main
        from fastapi.testclient import TestClient
        with mock.patch.object(trend, 'get_intraday_result', return_value={'period': 'intraday', 'rows': []}) as get:
            response = TestClient(main.app).get('/investor-trend?period=intraday&market=kosdaq')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data']['period'], 'intraday')
        get.assert_called_once_with('kosdaq')
        self.assertEqual(trend.get_result('day', 'kospi')['period'], 'day')


if __name__ == '__main__':
    unittest.main()
