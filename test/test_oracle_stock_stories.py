"""Schedule, damaged payload and timeout/lock safety regression."""
import importlib.util
from datetime import date
from pathlib import Path
import json
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('refresh', ROOT / 'scripts/oracle-stock-stories/refresh_stock_stories.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class SafetyTests(unittest.TestCase):
    def test_anchor_kst_cadence(self):
        for day, expected in [('2026-11-07', False), ('2026-11-08', True),
                              ('2026-11-15', False), ('2026-11-22', True),
                              ('2026-11-09', False), ('2027-01-03', True)]:
            self.assertEqual(r.due(date.fromisoformat(day)), expected)

    def test_count_drop_manual_and_missing_shard_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'data/stories').mkdir(parents=True)
            manual = {c: {'cards': []} for c in ('005930', '042660', '111111', '222222')}
            def write(index, data=manual):
                (root / 'data/stock-stories.js').write_text('window.STOCK_STORIES=' + json.dumps(data) + ';\nwindow.STOCK_STORY_INDEX=' + json.dumps(index) + ';\n')
            write(['005380'])
            with self.assertRaisesRegex(ValueError, 'count_drop'):
                r.validate(root, (manual, ['005380', '333333']), date(2026, 11, 4))
            with self.assertRaisesRegex(ValueError, 'index_files'):
                r.validate(root, (manual, ['005380']), date(2026, 11, 4))
            write([], {})
            with self.assertRaisesRegex(ValueError, 'manual_changed'):
                r.validate(root, (manual, []), date(2026, 11, 4))

    def test_shared_lock_nonblocking_and_process_group_timeout(self):
        import sys
        sys.path.insert(0, str(ROOT / 'scripts/cloud-vm'))
        from scheduled_job import try_lock, stop_group
        with tempfile.TemporaryDirectory() as tmp:
            with open(Path(tmp) / 'lock', 'a+') as a, open(Path(tmp) / 'lock', 'a+') as b:
                self.assertTrue(try_lock(a))
                self.assertFalse(try_lock(b))
            process = subprocess.Popen(['sleep', '30'], start_new_session=True)
            stop_group(process, .1)
            self.assertIsNotNone(process.poll())


if __name__ == '__main__':
    unittest.main()
