import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
import schedule_health


class ScheduleHealthTests(unittest.TestCase):
    def test_timer_outcome_and_stale_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = os.path.join(directory, '.off_hours_maintenance_last_run_date')
            with open(marker, 'w', encoding='ascii') as stream:
                stream.write('2026-09-27\n')
            units = {
                'kiwoom-dailyscan.service': {
                    'Result': 'success', 'ExecMainStartTimestamp': 'Mon 2026-10-19 11:10:05 UTC',
                    'ExecMainExitTimestamp': 'Mon 2026-10-19 14:41:36 UTC'},
                'kiwoom-dailyscan.timer': {
                    'ActiveState': 'active', 'NextElapseUSecRealtime': 'Tue 2026-10-20 11:10:00 UTC'},
                'kiwoom-etfstrategyscan.service': {'Result': 'exit-code'},
                'kiwoom-etfstrategyscan.timer': {'ActiveState': 'active'},
                'kiwoom-swingmonitor.timer': {'ActiveState': 'inactive'},
            }
            data = schedule_health.collect(directory, datetime(2026, 10, 20, 7, 0, tzinfo=timezone(timedelta(hours=9))), units)
            jobs = {row['id']: row for row in data['jobs']}
            self.assertEqual(jobs['dailyscan']['state'], '지연')
            self.assertEqual(jobs['dailyscan']['elapsedSec'], 12691)
            self.assertEqual(jobs['dailyscan']['nextRunAt'], '2026-10-20T20:10:00+09:00')
            self.assertEqual(jobs['etfstrategyscan']['state'], '오류')
            self.assertEqual(jobs['swingmonitor']['state'], '의도적 비활성화')
            self.assertEqual(jobs['maintenance']['state'], '오류')


if __name__ == '__main__':
    unittest.main()
