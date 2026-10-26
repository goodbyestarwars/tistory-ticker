import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import schedule_health
import scheduled_job


class ScanProgressTest(unittest.TestCase):
    @unittest.skipUnless(os.name == 'posix', 'Linux status file lock')
    def test_new_run_clears_previous_terminal_fields_but_keeps_last_success(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            scheduled_job.write_status(folder, 'dailyscan', state='success', startedAt='old',
                                       finishedAt='old-end', exitCode=0, runSec=600, waitSec=3)
            scheduled_job.write_status(folder, 'dailyscan', state='waiting', queuedAt='new')
            scheduled_job.write_status(folder, 'dailyscan', state='running', startedAt='new', waitSec=0)
            row = json.loads((folder / 'scheduled_jobs.json').read_text())['dailyscan']
            self.assertEqual(row['lastSuccessAt'], 'old-end')
            self.assertEqual(row['startedAt'], 'new')
            for key in ('finishedAt', 'exitCode', 'runSec'):
                self.assertNotIn(key, row)

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
