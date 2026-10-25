import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
import market_clock
import scheduled_job as job


def at(day=23, hour=20, minute=10):
    return datetime(2026, 10, day, hour, minute, tzinfo=job.KST)


class SessionTest(unittest.TestCase):
    def test_friday_job_keeps_its_basis_after_midnight(self):
        basis, end = job.session(at(24, 1), 'night')
        self.assertEqual(basis, '2026-10-23')
        self.assertEqual((end.day, end.hour, end.minute), (24, 7, 20))

    def test_start_and_end_boundaries(self):
        self.assertIsNone(job.session(at(hour=19, minute=59), 'night')[1])
        self.assertIsNotNone(job.session(at(hour=20, minute=0), 'night')[1])
        self.assertIsNone(job.session(at(hour=7, minute=20), 'night')[1])
        self.assertIsNone(job.session(at(hour=9, minute=4), 'open')[1])
        self.assertIsNotNone(job.session(at(hour=9, minute=5), 'open')[1])

    def test_child_holiday_check_uses_validated_nightly_basis(self):
        from unittest.mock import patch
        with patch.dict(os.environ, {'NINEPAY_SCAN_DATA_DATE': '2026-10-23'}):
            self.assertEqual(market_clock.skip_scan_today(at(24, 1)), (False, '2026-10-23'))
            with self.assertRaises(ValueError):
                market_clock.skip_scan_today(at(25, 1))

    def test_every_contract_has_finite_wait_and_run(self):
        for policy in job.CONTRACTS.values():
            self.assertGreater(policy['maxWait'], 0)
            self.assertGreater(policy['maxRun'], 30)


@unittest.skipUnless(os.name == 'posix', 'Linux process groups and flock')
class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.policy = dict(maxWait=.2, maxRun=2, window='night', daily=False, trading=True)

    def tearDown(self):
        self.temp.cleanup()

    def run_job(self, code, **changes):
        policy = dict(self.policy, **changes)
        return job.run('dailyscan', [sys.executable, '-c', code], self.folder,
                       policy, grace=.05, now=lambda: at())

    def test_success_then_failure_keeps_last_success(self):
        self.assertEqual(self.run_job('pass'), 0)
        path = self.folder / 'scheduled_jobs.json'
        success = json.loads(path.read_text())['dailyscan']['lastSuccessAt']
        self.assertEqual(self.run_job('raise SystemExit(9)'), 9)
        status = json.loads(path.read_text())['dailyscan']
        self.assertEqual(status['state'], 'failed')
        self.assertEqual(status['lastSuccessAt'], success)

    def test_lock_wait_is_bounded_and_does_not_start_child(self):
        import fcntl
        with open(self.folder / '.scan_serial.lock', 'a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.assertEqual(self.run_job("open('should-not-exist','w').close()"), 76)
        self.assertFalse((self.folder / 'should-not-exist').exists())

    def test_maintenance_waiter_gets_priority(self):
        import fcntl
        with open(self.folder / '.off_hours_maintenance_trigger.lock', 'a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.assertEqual(self.run_job("open('should-not-exist','w').close()"), 76)
        self.assertFalse((self.folder / 'should-not-exist').exists())

    def test_same_job_does_not_queue_a_duplicate(self):
        import fcntl
        with open(self.folder / '.schedule_dailyscan.lock', 'a+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.assertEqual(self.run_job("open('duplicate','w').close()"), 0)
        self.assertFalse((self.folder / 'duplicate').exists())

    def test_missing_prerequisite_preserves_snapshot_and_does_not_start(self):
        marker = self.folder / 'daily_scan_cache.json'
        marker.write_text('{"old":true}')
        self.assertEqual(self.run_job("open('should-not-exist','w').close()", daily=True), 75)
        self.assertEqual(marker.read_text(), '{"old":true}')
        self.assertFalse((self.folder / 'should-not-exist').exists())

    def test_timeout_kills_a_descendant_that_ignores_term_and_releases_lock(self):
        code = "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)']);open('child.pid','w').write(str(p.pid));time.sleep(60)"
        self.assertEqual(self.run_job(code, maxRun=.5), 124)
        pid = int((self.folder / 'child.pid').read_text())
        state = Path('/proc/%s/stat' % pid)
        self.assertTrue(not state.exists() or state.read_text().split()[2] == 'Z')
        with open(self.folder / '.scan_serial.lock', 'a+') as lock:
            self.assertTrue(job.try_lock(lock))
        self.assertEqual(json.loads((self.folder / 'scheduled_jobs.json').read_text())['dailyscan']['state'], 'run_timeout')


if __name__ == '__main__':
    unittest.main()
