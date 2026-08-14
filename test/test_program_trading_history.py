import os
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import program_trading_history as pth


class ProgramTradingHistoryTest(unittest.TestCase):
    def setUp(self):
        # 실제 VM 파일(scripts/cloud-vm/program_trading_history.json)을 건드리지 않도록
        # 테스트마다 임시 파일 경로로 바꿔치기한다.
        fd, path = tempfile.mkstemp(suffix='.json')
        os.close(fd)
        os.remove(path)  # record()가 "파일 없음"부터 시작하는 경로도 같이 검증
        self.tmp_path = path
        self.patcher = patch.object(pth, 'HISTORY_FILE', path)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))

    def test_record_then_load_round_trips(self):
        pth.record('2026-08-13', -100.0, 40.0, -60.0)
        pth.record('2026-08-14', -239707.0, 50602.0, -189105.0)
        history = pth.load()
        self.assertEqual(history['2026-08-14'], {'arbitrage': -239707.0, 'nonArbitrage': 50602.0, 'total': -189105.0})
        self.assertEqual(len(history), 2)

    def test_record_overwrites_same_date(self):
        pth.record('2026-08-14', -1.0, 1.0, 0.0)
        pth.record('2026-08-14', -239707.0, 50602.0, -189105.0)
        history = pth.load()
        self.assertEqual(len(history), 1)
        self.assertEqual(history['2026-08-14']['arbitrage'], -239707.0)

    def test_series_is_sorted_oldest_to_newest_and_limited(self):
        pth.record('2026-08-12', -10.0, 1.0, -9.0)
        pth.record('2026-08-14', -30.0, 3.0, -27.0)
        pth.record('2026-08-13', -20.0, 2.0, -18.0)
        rows = pth.series(pth.load(), 'arbitrage')
        self.assertEqual([date for date, _ in rows], ['2026-08-12', '2026-08-13', '2026-08-14'])
        limited = pth.series(pth.load(), 'arbitrage', limit=2)
        self.assertEqual([date for date, _ in limited], ['2026-08-13', '2026-08-14'])

    def test_average_ignores_missing_field_and_handles_empty_history(self):
        self.assertIsNone(pth.average({}, 'arbitrage'))
        pth.record('2026-08-13', -10.0, None, -10.0)
        pth.record('2026-08-14', -30.0, 6.0, -24.0)
        history = pth.load()
        self.assertEqual(pth.average(history, 'arbitrage'), -20.0)
        self.assertEqual(pth.average(history, 'nonArbitrage'), 6.0)

    def test_load_returns_empty_dict_when_file_missing(self):
        self.assertEqual(pth.load(), {})

    def test_max_entries_prunes_oldest(self):
        with patch.object(pth, 'MAX_ENTRIES', 3):
            for day in range(1, 6):
                pth.record('2026-08-%02d' % day, float(day), float(day), float(day))
            history = pth.load()
        self.assertEqual(len(history), 3)
        self.assertEqual(sorted(history.keys()), ['2026-08-03', '2026-08-04', '2026-08-05'])


if __name__ == '__main__':
    unittest.main()
