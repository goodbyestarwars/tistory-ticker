"""Offline orchestration, shared ledger, and unchanged exit-rule regression."""
import os
import tempfile
import unittest
from unittest.mock import Mock, patch

import live_engine as engine
from live_runner_9pay import run_cycle
from ninepay_signal_client import SignalFeedUnavailable
from ninepay_trade import trade_signal_once
from test_live_exclusion import Base, FakeBroker, NOW, holding


class OrderingTests(unittest.TestCase):
    def cycle(self, feed=None, exit_state='EXITS_CHECKED', due=True, buy='9PAY_BUY_SENT'):
        calls = []
        def legacy(*args, **kw):
            calls.append('exit' if kw.get('allow_entries') is False else 'legacy')
            return exit_state if kw.get('allow_entries') is False else 'BUY_SENT'
        def fetch(**kw):
            calls.append('feed')
            if feed == 'error':
                raise SignalFeedUnavailable()
            return [{}] if feed is None else feed
        def enter(*args):
            calls.append('9pay')
            return buy
        with patch.dict(os.environ, {'NINEPAY_LIVE_TRADING': '1'}):
            result = run_cycle(None, Mock(), None, '.', NOW, due, engine_cycle=legacy,
                               signal_fetch=fetch, signal_trade=enter,
                               get_candidates=lambda now: [])
        return result, calls

    def test_new_entry_wins_over_legacy(self):
        self.assertEqual(self.cycle(), ('9PAY_BUY_SENT', ['exit', 'feed', '9pay']))

    def test_no_new_signal_permits_legacy(self):
        self.assertEqual(self.cycle(feed=[]), ('BUY_SENT', ['exit', 'feed', 'legacy']))

    def test_feed_error_still_runs_exits_and_blocks_legacy(self):
        self.assertEqual(self.cycle(feed='error'), ('9PAY_FEED_UNAVAILABLE', ['exit', 'feed']))

    def test_exit_or_uncertain_state_blocks_all_entries(self):
        for state in ('STOP_EMERGENCY', 'STOP_3', 'TRAIL_2_5', 'DISABLED_OR_UNCERTAIN',
                      'PENDING_ORDERS', 'BUY_FILL_UNCONFIRMED', 'PRICE_UNAVAILABLE'):
            self.assertEqual(self.cycle(exit_state=state), (state, ['exit']))

    def test_three_second_poll_does_not_repeat_exit_checks(self):
        self.assertEqual(self.cycle(due=False), ('9PAY_BUY_SENT', ['feed', '9pay']))

    def test_order_block_reason_is_persisted(self):
        ledger = Mock()
        sig = {'code': '010580', 'signalId': '2026-10-19:010580'}
        with patch.dict(os.environ, {'NINEPAY_LIVE_TRADING': '1'}):
            result = run_cycle(None, ledger, None, '.', NOW, False,
                               signal_fetch=lambda **kw: [sig],
                               signal_trade=lambda *args: 'BUDGET_OR_SLOTS_FULL')
        self.assertEqual(result, 'BUDGET_OR_SLOTS_FULL')
        self.assertEqual(ledger.skip.call_args.args[1:3], ('010580','9PAY_BUDGET_OR_SLOTS_FULL'))

    def test_disabled_9pay_keeps_existing_cycle(self):
        fn = Mock(side_effect=['EXITS_CHECKED', 'NO_CANDIDATE'])
        fetch = Mock()
        with patch.dict(os.environ, {'NINEPAY_LIVE_TRADING': '0'}):
            run_cycle(None, None, None, '.', NOW, True, engine_cycle=fn,
                      signal_fetch=fetch, get_candidates=lambda now: [])
        fetch.assert_not_called()
        self.assertEqual(fn.call_count, 2)
        self.assertFalse(fn.call_args.kwargs['manage_exits'])


class SharedEngineTests(Base):
    def setUp(self):
        super().setUp()
        self.write_exclusions([])
        with self.ledger.connect() as db:
            db.execute('DELETE FROM positions')
            db.execute('DELETE FROM intents')

    def sig(self, code='005930'):
        return {'code': code, 'signalId': NOW.strftime('%Y-%m-%d')+':'+code,
                'at': NOW.timestamp()-2, 'price': 10000, 'source': 'Kiwoom WebSocket',
                'ruleVersion': 'ab70-v1', 'volumeMissing': False, 'excluded': False,
                'branches': ['A', 'B'], 'first70At': NOW.timestamp()-60, 'volumeRatio': .8}

    def broker(self, holdings=()):
        b = FakeBroker(list(holdings), {'005930': 10000, '000660': 9600})
        b.call = lambda *args: {'return_code': 0, 'cur_prc': '10000', 'stk_nm': '삼성전자'}
        return b

    def buy(self, b, sig=None):
        with patch.dict(os.environ, {'NINEPAY_LIVE_TRADING': '1'}):
            return trade_signal_once(b, self.ledger, sig or self.sig(), self.dir, NOW,
                                     engine, clock=lambda: NOW)

    def position(self, code, qty, price, state='OPEN'):
        with self.ledger.connect() as db:
            db.execute("INSERT INTO positions(code,qty,state,buy_day) VALUES(?,?,?,?)",
                       (code, qty, state, '2026-10-14'))
            db.execute("INSERT INTO intents(ts,code,side,qty,price,state) VALUES(?,?,'BUY',?,?,'ACK')",
                       ('2026-10-14T09:10:00+09:00', code, qty, price))

    def test_pending_legacy_position_reserves_shared_capital(self):
        self.position('000660', 89, 10000, 'PENDING')
        b = self.broker([holding('000660', 89, 10000, 10000)])
        self.assertEqual(self.buy(b), '9PAY_BUY_SENT')
        self.assertEqual(b.buys, [('005930', 1, 10000)])  # 900,000 committed cap

    def test_three_existing_positions_do_not_block_fourth_within_budget(self):
        for code in ('000001', '000002', '000003'):
            self.position(code, 1, 10000)
        b = self.broker([holding(c, 1, 10000, 10000) for c in ('000001','000002','000003')])
        self.assertIsNone(engine.MAX_STOCKS)
        self.assertEqual(self.buy(b), '9PAY_BUY_SENT')
        self.assertEqual(b.buys, [('005930', 30, 10000)])

    def test_no_count_cap_never_overrides_budget(self):
        self.position('000660', 90, 10000)
        b = self.broker([holding('000660',90,10000,10000)])
        self.assertEqual(self.buy(b), 'BUDGET_OR_SLOTS_FULL')
        self.assertEqual(b.buys, [])

    def test_restart_and_simultaneous_ab_do_not_repeat_buy(self):
        b = self.broker()
        self.assertEqual(self.buy(b), '9PAY_BUY_SENT')
        self.ledger = engine.Ledger(self.ledger.path)
        b.holdings = [holding('005930', 30, 10000, 10000)]
        self.assertEqual(self.buy(b), 'ALREADY_HELD_OR_SENT')
        self.assertEqual(len(b.buys), 1)

    def test_split_cycle_never_counts_stop_confirmation_twice(self):
        self.position('000660', 1, 10000)
        b = self.broker([holding('000660', 1, 10000, 9600)])
        self.assertEqual(engine.trade_once(b, self.ledger, [], lambda c: [], self.dir, NOW,
                                          allow_entries=False), 'EXITS_CHECKED')
        engine.trade_once(b, self.ledger, [], lambda c: [], self.dir, NOW, manage_exits=False)
        self.assertEqual(b.sells, [])
        self.assertEqual(engine.trade_once(b, self.ledger, [], lambda c: [], self.dir, NOW,
                                          allow_entries=False), 'STOP_3')
        self.assertEqual(b.sells, [('000660', 1)])

    def test_9pay_position_uses_existing_emergency_exit(self):
        b = self.broker()
        self.assertEqual(self.buy(b), '9PAY_BUY_SENT')
        b.holdings = [holding('005930', 30, 10000, 9400)]
        b.prices['005930'] = 9400
        self.assertEqual(engine.trade_once(b, self.ledger, [], lambda c: [], self.dir, NOW,
                                          allow_entries=False), 'STOP_EMERGENCY')
        self.assertEqual(b.sells, [('005930', 30)])

    def test_unknown_response_cannot_retry(self):
        b = self.broker()
        def timeout(*args):
            raise TimeoutError()
        b.buy_limit = timeout
        with self.assertRaises(TimeoutError):
            self.buy(b)
        self.assertTrue(self.ledger.has_uncertain())
        self.assertEqual(self.buy(b), 'DISABLED_OR_UNCERTAIN')


class NetworkRecoveryTests(unittest.TestCase):
    def test_retryable_transport_failure_without_uncertain_order(self):
        from live_runner_9pay import cycle_error_state
        from urllib.error import URLError
        from http.client import RemoteDisconnected
        ledger = Mock()
        ledger.has_uncertain.return_value = False
        for exc in (TimeoutError(), ConnectionResetError(), URLError('offline'), RemoteDisconnected()):
            with self.subTest(kind=type(exc).__name__):
                self.assertTrue(cycle_error_state(exc, ledger).startswith('NETWORK_RETRY_'))

    def test_uncertain_order_stays_stopped(self):
        from live_runner_9pay import cycle_error_state
        ledger = Mock()
        ledger.has_uncertain.return_value = True
        self.assertEqual(cycle_error_state(TimeoutError(), ledger), 'DISABLED_OR_UNCERTAIN')

    def test_non_transport_error_stays_fatal(self):
        from live_runner_9pay import cycle_error_state
        self.assertEqual(cycle_error_state(ValueError(), Mock()), 'ERROR_ValueError')


if __name__ == '__main__':
    unittest.main()
