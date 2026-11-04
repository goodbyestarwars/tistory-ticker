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
            'tgConflict': False, 'ledger': {'unknownOrders': 0, 'openPositions': 0}, 'flags': {'manualStop': False}}
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
            (MON, good(MON, ledger={'unknownOrders': 2}), 'UNKNOWN 주문 2건'),
            (MON, good(MON, ledger={}), 'UNKNOWN 주문 수 미수신'),
            (MON, good(MON, runnerProcs=1), '이중 실행'),
            (MON, good(MON, serviceState='active'), '이중 실행'),
            (MON, good(MON, runnerProcs=None), 'runner 수 미수신'),
            (MON, good(MON, tgConflict=True), 'PC 실행 흔적'),
            (MON, good(MON, timerState='enabled'), '이미 켜져'),
            (MON, {}, '미수신'),
            (MON, good(MON - timedelta(seconds=200)), '미수신'),
            (MON, good(MON, flags={}), '수동 중지 상태 미수신'),
            (MON, good(MON, timerState='unknown'), '타이머 상태 확인 불가'),
        ]
        for now, snap, text in cases:
            joined = ' '.join(ac.start_blockers(snap, now))
            self.assertIn(text, joined, (text, joined))

    def test_manual_stop_may_be_rearmed_on_closed_day(self):
        stopped = good(SUN, timerState='enabled', flags={'manualStop': True})
        self.assertEqual(ac.start_blockers(stopped, SUN), [])
        self.seed(stopped)
        self.assertEqual(ac.queue_command('start', 'a@b.c', SUN)['action'], 'start')

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

    def test_activity_keeps_only_whitelisted_fields(self):
        raw = {'orders': [{'ts': '2026-11-02T11:44:59+09:00', 'code': '068270', 'name': '셀트리온', 'side': 'buy', 'qty': '4',
                           'price': 193200, 'state': 'ACK', 'reason': 'ENTRY', 'order_no': '0001234', 'detail': 'acct 1234', 'note': 'x'},
                          {'code': 'BAD', 'side': 'BUY'}, {'code': '005930', 'side': 'HOLD'}],
               'positions': [{'code': '068270', 'qty': 4, 'state': 'OPEN', 'buyDay': '2026-11-02', 'avg_price': 1}],
               'candidates': {'scanDate': '2026-11-03', 'rows': [{'scanner': 'pullback', 'code': '005830', 'name': 'DB손해보험',
                                                                   'score': 7.5, 'basePrice': 'x', 'reason': 'private'}]}}
        out = ac.sanitize_activity(raw)
        self.assertEqual(len(out['orders']), 1)
        self.assertEqual(set(out['orders'][0]), {'no', 'ts', 'code', 'name', 'side', 'qty', 'price', 'state', 'reason'})
        self.assertEqual(out['orders'][0]['side'], 'BUY')
        self.assertEqual(out['orders'][0]['qty'], 4)
        self.assertEqual(set(out['positions'][0]), {'code', 'name', 'qty', 'state', 'buyDay', 'avg'})
        self.assertIsNone(out['candidates']['rows'][0]['basePrice'])
        self.assertNotIn('reason', out['candidates']['rows'][0])
        self.assertEqual(out['candidates']['rows'][0]['reasons'], [])
        self.assertEqual(ac.sanitize_activity('junk')['orders'], [])

    def test_activity_is_stored_and_only_exposed_when_received(self):
        now = MON
        ac.agent_sync({'snapshot': {'timerState': 'enabled'}, 'activity': {'orders': [{'code': '068270', 'side': 'BUY', 'qty': 1}]}}, now)
        self.assertEqual(ac.public_status(now)['activity']['orders'][0]['code'], '068270')
        self.assertIsNone(ac.public_status(now + timedelta(minutes=5))['activity'])
        # activity 키가 없는 동기화는 기존 목록을 지우지 않는다
        ac.agent_sync({'snapshot': {'timerState': 'enabled'}}, now + timedelta(seconds=20))
        self.assertEqual(len(ac.public_status(now + timedelta(seconds=30))['activity']['orders']), 1)

    def test_candidate_history_is_kept_until_replaced(self):
        now = MON
        hist = [{'scanDate': '2026-11-02', 'rows': [{'code': '005830', 'scanner': 'pullback', 'reasons': ['a', 'b']}]}]
        ac.agent_sync({'snapshot': {}, 'activity': {'candidates': {'scanDate': '2026-11-03', 'rows': [], 'history': hist}}}, now)
        ac.agent_sync({'snapshot': {}, 'activity': {'candidates': {'scanDate': '2026-11-03', 'rows': []}}}, now + timedelta(seconds=20))
        kept = ac.public_status(now + timedelta(seconds=30))['activity']['candidates']['history']
        self.assertEqual(kept[0]['rows'][0]['reasons'], ['a', 'b'])

    def test_hold_is_refused_until_agent_reports_capability(self):
        self.seed(good(MON))
        with self.assertRaises(ac.ControlError) as ctx:
            ac.queue_command('hold', 'a@b.c', MON)
        self.assertEqual(ctx.exception.status, 409)
        self.assertFalse(ac.public_status(MON)['hold']['supported'])
        self.assertIsNone(ac.public_status(MON)['pending'])

    def test_hold_is_accepted_on_any_day_and_carries_today_and_buy_scope(self):
        self.seed(good(SUN, capabilities=['hold']))
        ac.queue_command('hold', 'a@b.c', SUN)
        out = ac.agent_sync({'snapshot': good(SUN, capabilities=['hold'])}, SUN)
        self.assertEqual(out['command']['action'], 'hold')
        self.assertEqual(out['command']['day'], '2026-11-01')
        self.assertEqual(out['command']['scope'], 'buy')

    def test_hold_status_comes_from_agent_and_expires_at_midnight(self):
        today = '2026-11-02'
        snap = good(MON, capabilities=['hold'], flags={'hold': {'day': today, 'scope': 'buy'}})
        self.seed(snap)
        self.assertTrue(ac.public_status(MON)['hold']['active'])
        next_day = MON + timedelta(days=1)
        self.seed(good(next_day, capabilities=['hold'], flags={'hold': {'day': today, 'scope': 'buy'}}))
        view = ac.public_status(next_day)['hold']
        self.assertFalse(view['active'])
        self.assertEqual(view['staleDay'], today)

    def test_hold_unreceived_is_not_reported_as_active_or_supported(self):
        old = MON - timedelta(minutes=10)
        self.seed(good(old, capabilities=['hold'], flags={'hold': {'day': '2026-11-02'}}))
        view = ac.public_status(MON)['hold']
        self.assertFalse(view['active'])
        self.assertFalse(view['supported'])

    def test_resume_follows_same_gate_and_start_does_not_carry_day(self):
        self.seed(good(MON, capabilities=['hold']))
        cmd = ac.queue_command('resume', 'a@b.c', MON)
        self.assertEqual(cmd['action'], 'resume')
        out = ac.agent_sync({'snapshot': good(MON, capabilities=['hold'])}, MON)
        self.assertNotIn('day', out['command'])

    def test_status_includes_recent_log_newest_first_without_full_email(self):
        self.seed(good(MON))
        ac.queue_command('stop', 'owner@example.com', MON)
        ac.audit('owner@example.com', 'start', 'REFUSED', '타이머가 이미 켜져 있음')
        log = ac.public_status(MON)['log']
        self.assertEqual([row['action'] for row in log], ['start', 'stop'])
        self.assertEqual(log[0]['account'], 'owner')
        self.assertNotIn('@', str(log))

    def test_hold_file_reported_invalid_is_shown_as_active_like_the_engine(self):
        self.seed(good(MON, capabilities=['hold'], flags={'hold': {'invalid': True}}))
        view = ac.public_status(MON)['hold']
        self.assertTrue(view['active'])
        self.assertTrue(view['invalid'])


if __name__ == '__main__':
    unittest.main()
