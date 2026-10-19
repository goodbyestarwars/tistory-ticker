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

    def test_night_live_quote_tail_keeps_gaps_and_rejects_old_or_other_session(self):
        moment = datetime.fromisoformat('2026-10-16T01:50:00+09:00')
        minute_ts = int(datetime.fromisoformat('2026-10-15T23:57:00+09:00').timestamp())
        db_schema.upsert_future_chart_minute_rows(self.conn, 'KOSPI200_NIGHT',
            [dict(ts=minute_ts, open=880, high=884, low=879, close=883)])
        with mock.patch.object(charts, 'datetime', wraps=datetime) as clock:
            clock.now.return_value = moment
            for stamp, expected in [('2026-10-16T01:49:00+09:00', [11, 15]),
                                    ('2026-10-15T23:56:00+09:00', [11]),
                                    ('2026-10-16T18:01:00+09:00', [11]),
                                    ('2026-10-16T01:20:00+09:00', [11])]:
                self.conn.execute('INSERT OR REPLACE INTO future_prices (symbol,name,price,updated_at) VALUES (?,?,?,?)',
                    ('KOSPI200_NIGHT', 'night', 885, stamp))
                self.conn.commit()
                result = self.get('KOSPI200_NIGHT')
                self.assertEqual([r['slot'] for r in result['rows']], expected)
                if len(expected) == 2:
                    self.assertEqual(result['rows'][-1]['close'], 885)

    def test_public_route_does_not_fetch_provider(self):
        from fastapi.testclient import TestClient
        import main
        with mock.patch.object(foreign_futures, '_get_json', side_effect=AssertionError('provider call')):
            r = TestClient(main.app).get('/home-session-chart')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()['data']), 7)

    def test_korean_regular_session_fourteen_slots_holiday_and_missing_timestamp(self):
        with mock.patch('market_clock.is_kr_trading_day', return_value=True):
            self.assertFalse(self.put(100, '2026-10-16T08:59:00+09:00', 'KOSPI'))
            self.put(100, '2026-10-16T09:00:00+09:00', 'KOSPI')
            self.put(110, '2026-10-16T15:30:00+09:00', 'KOSPI')
            r = self.get('KOSPI')
            self.assertEqual((r['session']['timeZone'], r['session']['slotCount']), ('Asia/Seoul', 14))
            self.assertEqual([p['slot'] for p in r['rows']], [0, 13])
            self.assertEqual(self.get('KOSDAQ')['rows'], [])
        with mock.patch('market_clock.is_kr_trading_day', return_value=False):
            self.assertFalse(self.put(100, '2026-10-16T10:00:00+09:00', 'KOSDAQ'))
        self.assertFalse(charts.record(self.conn, 'KOSPI', dict(price=100, market_status='OPEN', traded_at=None)))

    def test_kis_mode_poll_loop_records_korean_index_observations(self):
        """2026-10-16: KIS 모드(use_kis_realtime=True) 폴링 분기에서도 KOSPI/KOSDAQ 관측이 저장돼야 한다."""
        import domestic_futures
        import market_clock
        stamp = datetime.now(timezone.utc).astimezone(charts.KST).isoformat()
        quote = dict(price=5600.0, change=1.0, change_rate=0.1, high=5610.0, low=5590.0,
                     traded_at=stamp, market_status='OPEN')

        class Stop(BaseException):
            pass

        with mock.patch.object(domestic_futures, 'fetch_index_realtime', return_value=quote), \
                mock.patch.object(market_clock, 'kr_market_active', return_value=True), \
                mock.patch.object(domestic_futures, 'refresh_history_all', side_effect=Stop), \
                mock.patch.object(domestic_futures, 'refresh_realtime_all'), \
                mock.patch.object(charts, 'session', return_value=dict(
                    date='2026-10-16', start='x', end='y', slotCount=14, slot=1, timeZone='Asia/Seoul')):
            with self.assertRaises(Stop):
                domestic_futures._poll_loop(use_kis_realtime=True)
        symbols = {r[0] for r in self.conn.execute('SELECT symbol FROM home_session_prices')}
        self.assertEqual(symbols, {'KOSPI', 'KOSDAQ'})

    def test_previous_close_saved_in_same_session_only(self):
        self.put(105, change=-5)
        self.assertEqual(self.get()['reference'], 110)
        self.put(106, '2026-10-16T10:01:00-04:00')
        self.assertIsNone(self.get()['reference'])

    def test_invalid_previous_close_not_invented(self):
        for value in (None, '', float('nan'), float('inf')):
            self.put(100, change=value)
            self.assertIsNone(self.get()['reference'])
