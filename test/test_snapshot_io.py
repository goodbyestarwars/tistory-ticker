import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
from snapshot_io import atomic_json


class SnapshotTest(unittest.TestCase):
    def test_publish_and_serialization_failure_preserve_complete_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'result.json'
            atomic_json(path, {'value': '한국', 'dataDate': '2026-10-23'})
            original = path.read_bytes()
            with self.assertRaises(TypeError):
                atomic_json(path, {'broken': {1, 2}})
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(Path(folder).iterdir()), [path])
            atomic_json(path, {'value': 0})
            self.assertEqual(json.loads(path.read_bytes()), {'value': 0})

    def test_termination_during_write_and_publish_failure_keep_previous_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'result.json'
            atomic_json(path, {'old': True})
            original = path.read_bytes()
            def interrupted(value, stream, **kwargs):
                stream.write('{"incomplete":')
                raise KeyboardInterrupt()
            with patch('snapshot_io.json.dump', side_effect=interrupted):
                with self.assertRaises(KeyboardInterrupt):
                    atomic_json(path, {})
            with patch('snapshot_io.os.replace', side_effect=OSError('publish failed')):
                with self.assertRaises(OSError):
                    atomic_json(path, {})
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(Path(folder).iterdir()), [path])
