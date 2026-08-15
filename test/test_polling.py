import logging
import os
import sys
import threading
import unittest

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import polling  # noqa: E402


class PollingTests(unittest.TestCase):
    def test_refresh_errors_are_logged_and_loop_can_stop(self):
        stop_event = threading.Event()
        calls = []

        def refresh():
            calls.append(True)
            if len(calls) == 1:
                raise RuntimeError('provider failure')
            stop_event.set()

        with self.assertLogs('polling-test', level='ERROR') as captured:
            polling.run_forever(
                refresh,
                0,
                logging.getLogger('polling-test'),
                'refresh failed',
                stop_event=stop_event,
            )
        self.assertEqual(len(calls), 2)
        self.assertIn('refresh failed', captured.output[0])


if __name__ == '__main__':
    unittest.main()
