"""Durable scanner signal history with synthetic, account-free observations."""
import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
import volume_surge_history as history
import volume_surge_live as scanner


class SignalHistoryTest(unittest.TestCase):
    def test_first_signal_survives_repeat_and_day_reset(self):
        with tempfile.TemporaryDirectory() as folder:
            db = os.path.join(folder, 'signals.db')
            ts = 1792100000.0
            scanner._reset_for_day('2026-10-16')
            with scanner._lock:
                scanner._state['detections']['005930'] = {
                    'code': '005930', 'detectedAt': ts, 'detectPrice': 71000,
                    'detectVolume': 123456,
                }
                scanner._accum['005930'] = {
                    'realtime': {'type': 'REALTIME_ACCUM'},
                    'firstRealtimeAt': ts + 30, 'firstPrice': 71100,
                    'firstVolume': 130000,
                }
            with mock.patch.object(history, 'DB_FILE', db):
                scanner._record_signal_history([], ts + 30, '2026-10-16')
                scanner._record_signal_history([], ts + 60, '2026-10-16')
                scanner._reset_for_day('2026-10-17')
            with closing(sqlite3.connect(db)) as conn:
                rows = conn.execute('SELECT signal_type, detected_price, cumulative_volume, '
                                    'cumulative_value_raw, vwap_relative_pct, index_relative_pct '
                                    'FROM signal_history ORDER BY signal_type').fetchall()
            self.assertEqual(rows, [('EARLY_PACE', 71000, 123456, None, None, None),
                                    ('REALTIME_ACCUM', 71100, 130000, None, None, None)])

    def test_old_state_is_not_backfilled_and_history_failure_is_isolated(self):
        scanner._reset_for_day('2026-10-16')
        with scanner._lock:
            scanner._state['detections']['111111'] = {
                'code': '111111', 'detectedAt': 1792100000, 'detectPrice': 1000,
            }
        with mock.patch.object(history, 'record') as writer:
            scanner._record_signal_history([], 1792100100, '2026-10-16')
            writer.assert_called_once_with([])
        with scanner._lock:
            scanner._state['detections']['111111']['detectVolume'] = 20000
            scanner._state['detections']['111111']['detectedAt'] = None
        with mock.patch.object(history, 'record') as writer:
            scanner._record_signal_history([], 1792100100, '2026-10-16')
            writer.assert_not_called()
        self.assertNotIn(('2026-10-16', '111111', 'EARLY_PACE'), scanner._history_recorded)


if __name__ == '__main__':
    unittest.main()
