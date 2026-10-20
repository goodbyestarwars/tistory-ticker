import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
import scan_prereq

KST = timezone(timedelta(hours=9))


class ScanPrereqTests(unittest.TestCase):
    def test_after_midnight_uses_previous_session(self):
        now = datetime(2026, 10, 20, 3, 10, tzinfo=KST)
        self.assertEqual(scan_prereq.assess(now, '2026-10-19T14:41:36+00:00', lambda _: True),
                         ('ready', '2026-10-19'))
        self.assertEqual(scan_prereq.assess(now, '2026-10-18T14:41:36+00:00', lambda _: True),
                         ('stale', '2026-10-19'))

    def test_holiday_and_missing_source(self):
        now = datetime(2026, 10, 20, 21, 0, tzinfo=KST)
        self.assertEqual(scan_prereq.assess(now, None, lambda _: False)[0], 'holiday')
        self.assertEqual(scan_prereq.assess(now, None, lambda _: True)[0], 'missing')


if __name__ == '__main__':
    unittest.main()
