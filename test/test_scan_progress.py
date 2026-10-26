import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import schedule_health
import scheduled_job


class ScanProgressTest(unittest.TestCase):
    def test_only_matching_running_snapshot_is_exposed(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            started = '2026-10-26T20:10:00+09:00'
            with patch.dict(os.environ, {'NINEPAY_PROGRESS_JOB': 'dailyscan',
                                         'NINEPAY_PROGRESS_STARTED': started}), patch.object(
                    scheduled_job, '__file__', str(folder / 'scheduled_job.py')):
                scheduled_job.report_progress(25, 100, '일봉·수급 확인')
            status = {'dailyscan': {'state': 'running', 'startedAt': started}}
            def read():
                (folder / 'scheduled_jobs.json').write_text(json.dumps(status), encoding='utf-8')
                return next(row for row in schedule_health.collect(directory, units={})['jobs']
                            if row['id'] == 'dailyscan')['progress']
            self.assertEqual(read()['processed'], 25)
            status['dailyscan']['startedAt'] = '2026-10-27T20:10:00+09:00'
            self.assertIsNone(read())
            status['dailyscan'].update(state='failed', startedAt=started)
            self.assertIsNone(read())

    def test_telemetry_failure_does_not_fail_scan(self):
        with patch.dict(os.environ, {'NINEPAY_PROGRESS_JOB': 'dailyscan',
                                     'NINEPAY_PROGRESS_STARTED': 'run'}), patch.object(
                scheduled_job, 'atomic_json', side_effect=OSError('disk full')):
            scheduled_job.report_progress(0, 100, '일봉')
