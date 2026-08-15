import os
import sys
import tempfile
import unittest
from datetime import datetime

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import maintenance  # noqa: E402


class MaintenanceTests(unittest.TestCase):
    def test_market_hours_are_blocked(self):
        self.assertFalse(maintenance.is_off_hours(datetime(2026, 8, 17, 10, 0, tzinfo=maintenance.KST)))
        self.assertTrue(maintenance.is_off_hours(datetime(2026, 8, 17, 8, 59, tzinfo=maintenance.KST)))
        self.assertTrue(maintenance.is_off_hours(datetime(2026, 8, 17, 15, 41, tzinfo=maintenance.KST)))

    def test_weekend_is_off_hours(self):
        self.assertTrue(maintenance.is_off_hours(datetime(2026, 8, 16, 12, 0, tzinfo=maintenance.KST)))

    def test_trim_log_keeps_recent_lines_atomically(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = os.path.join(temp_dir, 'sample.log')
            with open(path, 'w', encoding='utf-8') as output:
                output.writelines('%d\n' % index for index in range(5))
            removed = maintenance.trim_log(path, max_lines=2)
            self.assertEqual(removed, 3)
            with open(path, 'r', encoding='utf-8') as source:
                self.assertEqual(source.read(), '3\n4\n')


if __name__ == '__main__':
    unittest.main()
