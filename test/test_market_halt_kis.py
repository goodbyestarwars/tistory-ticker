import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
import circuit_breaker as cb  # noqa: E402
import market_halt_kis as mk  # noqa: E402

KST = timezone(timedelta(hours=9))


def frame(code, mkop):
    vals = [code, 'N', '', mkop, '', '', '', '', '0', '0', 'K']
    return '0|H0STMKO0|001|' + '^'.join(vals)


class KisHaltTests(unittest.TestCase):
    def setUp(self):
        mk.STORE = os.path.join(tempfile.mkdtemp(), 'ev.json')
        mk._state.update({'events': [], 'raw': [], 'codes': {}, 'frames': 0, 'lastFrameAt': None, 'date': None, 'error': None})
        self.now = datetime(2026, 10, 15, 14, 0, 0, tzinfo=KST)

    def test_parse_rejects_other_frames(self):
        self.assertIsNone(mk.parse_frame('0|H0STCNT0|001|a^b^c^d'))
        self.assertIsNone(mk.parse_frame('{"header":{}}'))
        self.assertEqual(mk.parse_frame(frame('005930', '387'))['mkop_cls_code'], '387')

    def test_unknown_code_is_recorded_but_not_an_event(self):
        mk.handle_raw(frame('005930', '112'), self.now)
        s = mk.snapshot()
        self.assertEqual(s['events'], [])
        self.assertEqual(s['codes'], {'KOSPI:112': 1})
        self.assertEqual(s['frames'], 1)

    def test_sell_sidecar_active_then_released_market_by_key(self):
        mk.handle_raw(frame('247540', '387'), self.now)
        mk.handle_raw(frame('247540', '387'), self.now + timedelta(seconds=5))   # 반복 수신은 한 건
        ev = mk.snapshot()['events']
        self.assertEqual(len(ev), 1)
        self.assertEqual((ev[0]['market'], ev[0]['direction'], ev[0]['status']), ('KOSDAQ', 'SELL', 'active'))
        mk.handle_raw(frame('247540', '388'), self.now + timedelta(minutes=5))
        ev = mk.snapshot()['events']
        self.assertEqual((len(ev), ev[0]['status']), (1, 'released'))
        self.assertTrue(ev[0]['released_at'].startswith('2026-10-15T14:05'))

    def test_cb_has_no_guessed_stage_and_normalizes(self):
        mk.handle_raw(frame('005930', '174'), self.now)
        (ev,) = mk.snapshot()['events']
        self.assertIsNone(ev['stage'])
        n = cb.normalize_halt_event(dict(ev))
        self.assertIsNotNone(n)
        self.assertEqual((n['kind'], n['stage'], n['code']), ('CIRCUIT_BREAKER', None, '174'))
        self.assertIsNone(cb.normalize_halt_event({'market': 'KOSPI', 'kind': 'CIRCUIT_BREAKER', 'stage': None, 'status': 'active',
                                                   'triggered_at': self.now.isoformat()}))   # 코드 없는 단계 미상은 여전히 버림

    def test_cb_release_codes_and_ambiguous_codes(self):
        mk.handle_raw(frame('005930', '174'), self.now)
        mk.handle_raw(frame('005930', '182'), self.now)
        mk.handle_raw(frame('005930', '184'), self.now)
        self.assertEqual(len(mk.snapshot()['events']), 1)
        mk.handle_raw(frame('005930', '185'), self.now + timedelta(minutes=20))
        (ev,) = mk.snapshot()['events']
        self.assertEqual(ev['status'], 'released')

    def test_release_without_trigger_is_kept_as_missed(self):
        mk.handle_raw(frame('005930', '398'), self.now)
        (ev,) = mk.snapshot()['events']
        self.assertTrue(ev['trigger_missed'])

    def test_persistence_survives_restart(self):
        mk.handle_raw(frame('005930', '397'), self.now)
        mk._state.update({'events': [], 'date': None})
        mk._load(self.now)
        self.assertEqual(len(mk.snapshot()['events']), 1)

    def test_events_reach_dashboard_payload(self):
        mk.handle_raw(frame('005930', '387'), datetime.now(KST))
        with mk._lock:
            events = mk._to_halt_events(mk._state['events'])
        self.assertEqual(cb.ingest_market_halt(events, mk.SOURCE, datetime.now(KST)), 1)


if __name__ == '__main__':
    unittest.main()
