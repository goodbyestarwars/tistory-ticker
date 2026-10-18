from datetime import datetime, timezone
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from ninepay_signal_client import SignalFeedUnavailable, valid_signals


NOW = datetime(2026, 10, 19, 0, 30, tzinfo=timezone.utc).timestamp()


def payload(**changes):
    state = {'running': True, 'active': True, 'rankError': None,
             'amountFallback': False, 'rankAt': datetime.fromtimestamp(NOW, timezone.utc).isoformat(),
             'signals': [{'signalId': '2026-10-19:005930', 'code': '005930',
                          'at': NOW - 2, 'price': 105000, 'source': 'Kiwoom WebSocket',
                          'volumeMissing': False}]}
    state.update(changes)
    return {'data': {'ninePayResearch': state}}


class SignalClientTests(unittest.TestCase):
    def test_accepts_fresh_complete_signal(self):
        self.assertEqual(valid_signals(payload(), NOW)[0]['code'], '005930')

    def test_stale_and_missing_volume_are_rejected(self):
        bad = payload()
        bad['data']['ninePayResearch']['signals'][0]['at'] = NOW - 11
        self.assertEqual(valid_signals(bad, NOW), [])
        bad['data']['ninePayResearch']['signals'][0]['at'] = NOW - 2
        bad['data']['ninePayResearch']['signals'][0]['volumeMissing'] = True
        self.assertEqual(valid_signals(bad, NOW), [])

    def test_incomplete_rank_fails_closed(self):
        with self.assertRaises(SignalFeedUnavailable):
            valid_signals(payload(amountFallback=True), NOW)
        with self.assertRaises(SignalFeedUnavailable):
            valid_signals(payload(rankAt=None), NOW)


if __name__ == '__main__':
    unittest.main()
