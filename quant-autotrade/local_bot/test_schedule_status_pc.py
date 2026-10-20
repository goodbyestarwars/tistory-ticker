import os
import sys
import unittest
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(__file__))
import schedule_status_pc


class PcScheduleTests(unittest.TestCase):
    def test_stale_research_and_disabled_paper_are_distinct(self):
        now = datetime(2026, 10, 20, 7, 0, tzinfo=timezone(timedelta(hours=9)))
        rows = [
            {'name': 'AutotraderResearch', 'state': 'Ready', 'code': 267014,
             'lastRunAt': '2026-10-13T21:29:16+09:00', 'nextRunAt': '2026-10-20T20:15:00+09:00', 'triggerCount': 3},
            {'name': 'AutotraderLivePaper', 'state': 'Disabled', 'code': 0,
             'lastRunAt': None, 'nextRunAt': None, 'triggerCount': 2},
            {'name': 'AutotraderCandidates', 'state': 'Ready', 'code': 0,
             'lastRunAt': '2026-10-19T20:15:00+09:00', 'nextRunAt': '2026-10-20T20:15:00+09:00', 'triggerCount': 1},
        ]
        jobs = {r['id']: r for r in schedule_status_pc.summarize(
            rows, {'lastSuccessAt': '2026-10-13T00:15:31+09:00'}, now)['jobs']}
        self.assertEqual(jobs['AutotraderResearch']['state'], '지연')
        self.assertEqual(jobs['AutotraderResearch']['triggerCount'], 3)
        self.assertEqual(jobs['AutotraderLivePaper']['state'], '의도적 비활성화')
        self.assertEqual(jobs['AutotraderCandidates']['state'], '정상')
        self.assertNotIn('action', str(jobs))


if __name__ == '__main__':
    unittest.main()
