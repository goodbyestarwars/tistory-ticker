"""자동매매 제어 중계(scripts/cloud-vm/autotrader_control.py) 회귀 - 실행: python test/test_autotrader_control.py"""
import os
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))
import autotrader_control as ac

KST = timezone(timedelta(hours=9))
MON = datetime(2026, 11, 2, 21, 0, tzinfo=KST)      # 평일(장외)
SUN = datetime(2026, 11, 1, 21, 0, tzinfo=KST)
KEY = 'k' * 40


def good(now, **over):
    snap = {'receivedAt': now.isoformat(), 'timerState': 'disabled', 'serviceState': 'inactive', 'runnerProcs': 0,
            'tgConflict': False, 'ledger': {'unknownOrders': 0, 'openPositions': 0}}
    snap.update(over)
    return snap


class ControlTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.mkdtemp()
        ac.STATE_PATH = os.path.join(tmp, 'state.json')
        ac.AUDIT_PATH = os.path.join(tmp, 'audit.jsonl')
        os.environ['AUTOTRADER_CONTROL_SECRET'] = KEY

    def seed(self, snap):
        ac._save({'snapshot': snap})

    def test_start_allowed_only_when_everything_is_known_and_clear(self):
        self.assertEqual(ac.start_blockers(good(MON), MON), [])

    def test_start_blockers(self):
        cases = [
            (SUN, good(SUN), '휴장일'),
            (MON, good(MON, ledger={'unknownOrders': 2}), 'UNKNOWN 주문 2건'),
            (MON, good(MON, ledger={}), 'UNKNOWN 주문 수 미수신'),
            (MON, good(MON, runnerProcs=1), '이중 실행'),
            (MON, good(MON, serviceState='active'), '이중 실행'),
            (MON, good(MON, runnerProcs=None), 'runner 수 미수신'),
            (MON, good(MON, tgConflict=True), 'PC 실행 흔적'),
            (MON, good(MON, timerState='enabled'), '이미 켜져'),
            (MON, {}, '미수신'),
            (MON, good(MON - timedelta(seconds=200)), '미수신'),
            (datetime(2027, 3, 2, 21, 0, tzinfo=KST), good(datetime(2027, 3, 2, 21, 0, tzinfo=KST)), '거래일을 확정할 수 없음'),
        ]
        for now, snap, text in cases:
            joined = ' '.join(ac.start_blockers(snap, now))
            self.assertIn(text, joined, (text, joined))

    def test_start_refused_is_audited_and_not_queued(self):
        self.seed(good(MON, runnerProcs=1))
        with self.assertRaises(ac.ControlError) as cm:
            ac.queue_command('start', 'a@b.c', MON)
        self.assertEqual(cm.exception.status, 409)
        self.assertIsNone(ac._load().get('pending'))
        self.assertIn('REFUSED', open(ac.AUDIT_PATH, encoding='utf-8').read())

    def test_stop_is_always_accepted_even_without_vm_state_or_on_holiday(self):
        ac._save({})
        self.assertEqual(ac.queue_command('stop', 'a@b.c', SUN)['action'], 'stop')

    def test_unknown_action_and_missing_secret(self):
        with self.assertRaises(ac.ControlError):
            ac.queue_command('restart', 'a@b.c', MON)
        os.environ['AUTOTRADER_CONTROL_SECRET'] = ''
        with self.assertRaises(ac.ControlError) as cm:
            ac.queue_command('stop', 'a@b.c', MON)
        self.assertEqual(cm.exception.status, 503)

    def test_second_command_while_pending_is_refused(self):
        ac.queue_command('stop', 'a@b.c', MON)
        with self.assertRaises(ac.ControlError) as cm:
            ac.queue_command('stop', 'a@b.c', MON)
        self.assertEqual(cm.exception.status, 409)

    def test_agent_roundtrip_ack_clears_pending(self):
        cmd = ac.queue_command('stop', 'a@b.c', MON)
        out = ac.agent_sync({'snapshot': good(MON)}, MON)
        self.assertEqual(out['command'], cmd)
        out = ac.agent_sync({'snapshot': good(MON), 'ack': {'id': cmd['id'], 'ok': True}}, MON)
        self.assertIsNone(out['command'])
        self.assertEqual(ac.public_status(MON)['lastCommand']['result'], 'DONE')

    def test_expired_command_is_not_delivered(self):
        ac.queue_command('stop', 'a@b.c', MON)
        state = ac._load(); state['pending']['queuedAt'] = time.time() - 1000; ac._save(state)
        self.assertIsNone(ac.agent_sync({'snapshot': good(MON)}, MON)['command'])
        self.assertEqual(ac._load()['last']['result'], 'EXPIRED')

    def test_status_reports_missing_values_as_unreceived_not_zero(self):
        ac._save({'snapshot': good(MON - timedelta(seconds=500), ledger={'unknownOrders': 0})})
        view = ac.public_status(MON)
        self.assertFalse(view['received'])
        self.assertIsNone(view['vm']['ledger'])
        self.assertFalse(view['canStart'])

    def test_signature(self):
        body = b'{"snapshot":{}}'
        ts = str(int(time.time()))
        ac.verify_agent(ts, ac.sign(ts, body), body)
        for bad_ts, sig in ((ts, 'x' * 64), (str(int(time.time()) - 500), ac.sign(str(int(time.time()) - 500), body)), (None, 'x')):
            with self.assertRaises(ac.ControlError) as cm:
                ac.verify_agent(bad_ts, sig, body)
            self.assertEqual(cm.exception.status, 401)
        with self.assertRaises(ac.ControlError):
            ac.verify_agent(ts, ac.sign(ts, body), body + b' ')


if __name__ == '__main__':
    unittest.main()
