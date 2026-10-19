from datetime import datetime, timezone
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from ninepay_signal_client import SignalFeedUnavailable, valid_signals


NOW = datetime(2026, 10, 19, 0, 30, tzinfo=timezone.utc).timestamp()


def payload(**changes):
    state = {'ruleVersion': 'ab70-v1', 'running': True, 'active': True, 'rankError': None,
             'amountFallback': False, 'rankAt': datetime.fromtimestamp(NOW, timezone.utc).isoformat(),
             'signals': [{'signalId': '2026-10-19:005930', 'code': '005930',
                          'at': NOW - 2, 'price': 105000, 'source': 'Kiwoom WebSocket',
                          'volumeMissing': False, 'excluded': False, 'ruleVersion': 'ab70-v1',
                          'branches': ['B'], 'first70At': NOW - 60, 'volumeRatio': .8}]}
    state.update(changes)
    return {'data': {'ninePayResearch': state}}


class SignalClientTests(unittest.TestCase):
    def test_real_vm_observer_signal_passes_pc_contract(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts' / 'cloud-vm'))
        import kiwoom_9pay_observer as observer
        o = observer.Observer(['005930'], {'005930': 1000})
        start = NOW - 30*60  # 09:00 KST
        for seconds, price, volume in ((0,100,0),(60,110,700),(120,108,710),(180,111,720)):
            item = o.observe('005930', start+seconds, price, volume)
        self.assertTrue(item['signal'])
        self.assertIsNone(item['excluded'])
        state = payload()['data']['ninePayResearch']
        state.update(signals=[item], rankAt=datetime.fromtimestamp(item['at'], timezone.utc).isoformat())
        self.assertEqual(valid_signals({'data': {'ninePayResearch': state}}, item['at'])[0]['code'], '005930')

    def test_missing_exclusion_field_or_reason_still_blocks(self):
        bad = payload()
        item = bad['data']['ninePayResearch']['signals'][0]
        del item['excluded']
        self.assertEqual(valid_signals(bad, NOW), [])
        item['excluded'] = '09:30 이전 70% 충족 관측 없음'
        self.assertEqual(valid_signals(bad, NOW), [])

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

    def test_wrong_version_persistence_failure_or_drops_blocks_feed(self):
        for change in ({'ruleVersion': 'old'}, {'persistenceError': 'failed'}, {'queueDropped': 1}):
            with self.subTest(change=change), self.assertRaises(SignalFeedUnavailable):
                valid_signals(payload(**change), NOW)

    def test_ab_and_observed_cutoff_evidence_required(self):
        for change in ({'branches': []}, {'branches': ['C']}, {'first70At': NOW},
                       {'first70At': None}, {'volumeRatio': .69}, {'excluded': True},
                       {'price': float('nan')}, {'ruleVersion': 'old'}):
            bad = payload()
            bad['data']['ninePayResearch']['signals'][0].update(change)
            with self.subTest(change=change):
                self.assertEqual(valid_signals(bad, NOW), [])

    def test_a_b_or_both_produce_one_event(self):
        for branches in (['A'], ['B'], ['A', 'B']):
            good = payload()
            good['data']['ninePayResearch']['signals'][0]['branches'] = branches
            self.assertEqual(len(valid_signals(good, NOW)), 1)

    def test_cutoff_092959_accepted_093000_rejected(self):
        good = payload()
        item = good['data']['ninePayResearch']['signals'][0]
        item.update(at=NOW, first70At=NOW-1)
        self.assertEqual(len(valid_signals(good, NOW)), 1)
        item['first70At'] = NOW
        self.assertEqual(valid_signals(good, NOW), [])


if __name__ == '__main__':
    unittest.main()
