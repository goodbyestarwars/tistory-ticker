# -*- coding: utf-8 -*-
"""실계좌 runner 상태 텔레그램 알림 - 합성 상태 파일·장부만 쓰고 네트워크·주문 호출이 없다. (2026-10-23)"""
import json
import os
import shutil
import sqlite3
import tempfile
import unittest

import tg_format as F
import tg_live_status as S
from tg_monitor import Monitor


def dt(text):
    return F.to_dt(text)


class FakeNotifier:
    def __init__(self):
        self.raised, self.cleared, self.sent = [], [], []
        self.active = set()

    def raise_alert(self, key, text, level='warn', renotify_sec=3600, category='alert'):
        self.raised.append((key, level, text))
        self.active.add(key)
        return 'raised'

    def clear_alert(self, key, text):
        if key in self.active:
            self.active.discard(key)
            self.cleared.append(key)
            return True
        return False

    def notify(self, key, text, category='general', level='info', markup=None, ttl=None):
        if any(k == key for k, _, _ in self.sent):
            return False
        self.sent.append((key, category, text))
        return True


class FakeBot:
    def __init__(self, market):
        self.market = market

    def status(self):
        return {'market_open': self.market}


class FakeSvc:
    def __init__(self, base, now, market=True):
        self.base_dir = base
        self.now = now
        self.notifier = FakeNotifier()
        self.bot = FakeBot(market)

    def now_dt(self):
        return self.now


def make_monitor(svc):
    m = object.__new__(Monitor)
    m.svc = svc
    m.streaks = {}
    m._name = lambda code: None
    m._saved_name = lambda code: None
    return m


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write_status(self, state, checked, feed='OK', reason=None):
        with open(os.path.join(self.dir, 'live_status.json'), 'w', encoding='utf-8') as f:
            json.dump({'checked_at': checked, 'state': state, 'feed': {'checked_at': checked, 'state': feed, 'reason': reason}}, f)

    def write_ledger(self, orders=(), positions=(), skips=()):
        conn = sqlite3.connect(os.path.join(self.dir, 'live_orders.db'))
        conn.execute('CREATE TABLE intents(id INTEGER PRIMARY KEY, ts TEXT, code TEXT, side TEXT, qty INT, price REAL, state TEXT)')
        conn.execute('CREATE TABLE positions(code TEXT, qty INT, state TEXT)')
        conn.execute('CREATE TABLE skips(day TEXT, code TEXT, reason TEXT, detail TEXT, count INT)')
        for o in orders:
            conn.execute('INSERT INTO intents(ts,code,side,qty,price,state) VALUES(?,?,?,?,?,?)', o)
        for p in positions:
            conn.execute('INSERT INTO positions VALUES(?,?,?)', p)
        for s in skips:
            conn.execute('INSERT INTO skips VALUES(?,?,?,?,?)', s)
        conn.commit()
        conn.close()


class StateTests(unittest.TestCase):
    def test_blocking_states(self):
        for state in ('FOREIGN_HOLDINGS', 'PENDING_ORDERS', 'BUY_FILL_UNCONFIRMED', 'SELL_FILL_UNCONFIRMED', 'DISABLED_OR_UNCERTAIN', 'ERROR_ValueError'):
            self.assertTrue(S.is_blocking(state), state)
        for state in ('WAIT', 'NO_ENTRY', 'EXITS_CHECKED', '9PAY_BUY_SENT', 'NO_CANDIDATE', None):
            self.assertFalse(S.is_blocking(state), state)

    def test_due_slots_weekdays_only(self):
        self.assertEqual(S.due_slots(dt('2026-10-23T09:06:00+09:00')), [('0905', '준비 점검')])
        self.assertEqual(S.due_slots(dt('2026-10-23T14:10:00+09:00')), [('1405', '매수 시간 종료')])
        self.assertEqual(S.due_slots(dt('2026-10-23T11:00:00+09:00')), [])
        self.assertEqual(S.due_slots(dt('2026-10-24T09:06:00+09:00')), [])          # 토요일


class MonitorTests(Base):
    def run_at(self, now, market=True):
        svc = FakeSvc(self.dir, dt(now), market)
        m = make_monitor(svc)
        m.watch_live_status()
        return m, svc

    def test_blocking_state_alerts_once_and_clears_when_resolved(self):
        self.write_status('FOREIGN_HOLDINGS', '2026-10-23T09:00:31+09:00')
        m, svc = self.run_at('2026-10-23T09:01:00+09:00')
        self.assertEqual([k for k, _, _ in svc.notifier.raised], ['live_state_FOREIGN_HOLDINGS'])
        self.assertIn('장부 밖 보유', svc.notifier.raised[0][2])
        self.write_status('NO_ENTRY', '2026-10-23T09:02:00+09:00')
        svc.now = dt('2026-10-23T09:02:10+09:00')
        m.watch_live_status()
        self.assertEqual(svc.notifier.cleared, ['live_state_FOREIGN_HOLDINGS'])

    def test_yesterdays_blocking_state_does_not_alert_today(self):
        self.write_status('FOREIGN_HOLDINGS', '2026-10-22T09:00:31+09:00')
        _, svc = self.run_at('2026-10-23T08:50:00+09:00', market=False)
        self.assertEqual(svc.notifier.raised, [])

    def test_stale_status_during_market_needs_two_ticks(self):
        self.write_status('WAIT', '2026-10-23T10:00:00+09:00')
        svc = FakeSvc(self.dir, dt('2026-10-23T10:20:00+09:00'))
        m = make_monitor(svc)
        m.watch_live_status()
        self.assertEqual(svc.notifier.raised, [])
        m.watch_live_status()
        self.assertEqual([k for k, _, _ in svc.notifier.raised], ['live_stale'])

    def test_short_feed_outage_at_open_is_ignored_but_long_one_alerts(self):
        self.write_status('9PAY_FEED_UNAVAILABLE', '2026-10-23T09:00:10+09:00', 'UNAVAILABLE', 'observer inactive')
        svc = FakeSvc(self.dir, dt('2026-10-23T09:00:12+09:00'))
        m = make_monitor(svc)
        m.watch_live_status()
        self.assertEqual(svc.notifier.raised, [])
        self.write_status('9PAY_FEED_UNAVAILABLE', '2026-10-23T09:03:30+09:00', 'UNAVAILABLE', 'observer inactive')
        svc.now = dt('2026-10-23T09:03:32+09:00')
        m.watch_live_status()
        self.assertEqual([k for k, _, _ in svc.notifier.raised], ['live_feed'])

    def test_summary_sent_once_with_skip_reason(self):
        self.write_status('NO_ENTRY', '2026-10-23T09:05:30+09:00')
        self.write_ledger(skips=[('2026-10-23', '*', 'SLOTS_FULL', 'slots=1/1 cash=706694 committed=0', 2)])
        m, svc = self.run_at('2026-10-23T09:05:40+09:00')
        self.assertEqual(len(svc.notifier.sent), 1)
        text = svc.notifier.sent[0][2]
        for needle in ('준비 점검', 'NO_ENTRY', '매수 0건', '종목 수 한도', 'slots=1/1'):
            self.assertIn(needle, text)
        m.watch_live_status()
        self.assertEqual(len(svc.notifier.sent), 1)                                   # 같은 슬롯은 한 번만

    def test_summary_lists_todays_orders(self):
        self.write_status('WAIT', '2026-10-23T14:05:30+09:00')
        self.write_ledger(orders=[('2026-10-23T10:59:37+09:00', '373220', 'BUY', 1, 382500, 'ACK')], positions=[('373220', 1, 'OPEN')])
        _, svc = self.run_at('2026-10-23T14:05:40+09:00')
        text = svc.notifier.sent[0][2]
        self.assertIn('매수 1건', text)
        self.assertIn('373220', text)
        self.assertIn('열린 포지션: 1종목', text)

    def test_no_summary_on_holiday_without_runner_activity(self):
        self.write_status('WAIT', '2026-10-22T15:00:00+09:00')
        _, svc = self.run_at('2026-10-23T09:05:40+09:00', market=False)
        self.assertEqual(svc.notifier.sent, [])

    def test_missing_status_file_is_silent(self):
        _, svc = self.run_at('2026-10-23T09:05:40+09:00')
        self.assertEqual((svc.notifier.raised, svc.notifier.sent), ([], []))


if __name__ == '__main__':
    unittest.main()
