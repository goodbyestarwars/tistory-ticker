import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
import chart_history
import db_schema


class ChartHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = mock.patch.object(db_schema, 'DB_FILE', os.path.join(self.tmp.name, 'prices.db'))
        self.db_patch.start()
        conn = db_schema.get_conn()
        db_schema.create_schema(conn)
        conn.close()
        self.calls = []
        self.today = datetime.now(timezone(timedelta(hours=9))).date()

    def tearDown(self):
        self.db_patch.stop()
        self.tmp.cleanup()

    def bars(self, count):
        return [{'date': (self.today - timedelta(days=count - i)).isoformat(),
                 'open': 100, 'high': 110, 'low': 90, 'close': 102, 'volume': 1000}
                for i in range(count)]

    def fetch(self, token, code, max_days=None, max_pages=1):
        self.calls.append(max_pages)
        return self.bars(1300 if max_pages > 1 else 500)

    def test_on_demand_extension_is_cached_and_survives_fetch_failure(self):
        with mock.patch.object(chart_history.kiwoom_market, 'fetch_daily_ohlc', side_effect=self.fetch):
            first = chart_history.get_daily('005930', token_getter=lambda: 'token')
            extended = chart_history.get_daily('005930', True, lambda: 'token')
            again = chart_history.get_daily('005930', True, lambda: 'token')
        self.assertEqual([1, 3], self.calls)
        self.assertEqual((500, 1300, 1300), (len(first), len(extended), len(again)))
        self.assertTrue(chart_history.history_attempted('005930'))
        with mock.patch.object(chart_history.kiwoom_market, 'fetch_daily_ohlc', side_effect=RuntimeError('down')):
            self.assertEqual(1300, len(chart_history.get_daily('005930', True, lambda: 'token')))

    def test_bad_ohlc_is_rejected_and_short_listing_stays_short(self):
        rows = self.bars(80)
        rows.append(dict(rows[-1], date=self.today.isoformat(), low=200))
        with mock.patch.object(chart_history.kiwoom_market, 'fetch_daily_ohlc', return_value=rows):
            result = chart_history.get_daily('123456', True, lambda: 'token')
        self.assertEqual(80, len(result))
        self.assertEqual(80, len({row['date'] for row in result}))


if __name__ == '__main__':
    unittest.main()
