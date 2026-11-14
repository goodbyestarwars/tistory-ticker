"""2026-11-14 체결강도 순위 기록(volume_power_log) 회귀."""
import sqlite3
import sys
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'cloud-vm'))
import volume_power_log as vpl  # noqa: E402

KST = ZoneInfo('Asia/Seoul')


def board(ts, rows):
    return {'market': 'domestic', 'updated_at': ts, 'sections': {'volumePowerStocks': rows}}


class VolumePowerLog(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.now = datetime(2026, 11, 13, 10, 7, tzinfo=KST)
        vpl._last_slot = None
        self.p = patch('market_clock.is_kr_trading_day', return_value=True)
        self.p.start()

    def tearDown(self):
        self.p.stop()

    def rows(self):
        return self.conn.execute('SELECT session,slot,rank,code,strength,price FROM volume_power_observations ORDER BY rank').fetchall()

    def test_records_valid_rows_once_per_slot(self):
        ts = self.now.timestamp() - 5
        data = board(ts, [{'code': '005930', 'name': 'A', 'price': 1000, 'change_rate': 1.2, 'execution_strength': 150.5, 'trade_amount': 1e9},
                          {'code': '000660', 'execution_strength': None},
                          {'code': 'ABC', 'execution_strength': 120},
                          {'code': '035720', 'execution_strength': float('nan')},
                          {'code': '051910', 'execution_strength': 99.0, 'price': True}])
        self.assertEqual(vpl.capture(data, now=self.now, conn=self.conn), 2)
        self.assertEqual(self.rows(), [('2026-11-13', 605, 1, '005930', 150.5, 1000), ('2026-11-13', 605, 5, '051910', 99.0, None)])
        data2 = board(ts + 20, [{'code': '005930', 'execution_strength': 10.0}])
        vpl.capture(data2, now=self.now.replace(minute=9), conn=self.conn)
        self.assertEqual(self.rows()[0][4], 150.5, '같은 슬롯은 처음 값 유지')

    def test_skips_outside_session_stale_or_empty(self):
        ok = [{'code': '005930', 'execution_strength': 120.0}]
        self.assertEqual(vpl.capture(board(self.now.timestamp(), ok), now=self.now.replace(hour=8), conn=self.conn), 0)
        self.assertEqual(vpl.capture(board(self.now.timestamp() - 600, ok), now=self.now, conn=self.conn), 0)
        self.assertEqual(vpl.capture(board(self.now.timestamp(), []), now=self.now, conn=self.conn), 0)
        self.assertEqual(vpl.capture({'market': 'us', 'updated_at': self.now.timestamp(), 'sections': {}}, now=self.now, conn=self.conn), 0)
        with patch('market_clock.is_kr_trading_day', return_value=False):
            self.assertEqual(vpl.capture(board(self.now.timestamp(), ok), now=self.now, conn=self.conn), 0)

    def test_retention(self):
        ok = [{'code': '005930', 'execution_strength': 120.0}]
        vpl.capture(board(self.now.timestamp(), ok), now=self.now, conn=self.conn)
        later = self.now.replace(year=2028, month=1)
        vpl.capture(board(later.timestamp(), ok), now=later, conn=self.conn)
        self.assertEqual([r[0] for r in self.rows()], ['2028-01-13'])


if __name__ == '__main__':
    unittest.main()
