# -*- coding: utf-8 -*-
"""Run: PYTHONPATH=scripts/cloud-vm:test python -m unittest test_toss_ws_hub"""
import asyncio
import pathlib
import unittest

import toss_ws_hub
import realtime_quotes
import kiwoom_ws_hub
import option_flow
import domestic_futures


class TossQuoteTests(unittest.TestCase):
    def test_trade_payload_never_invents_volume_direction_or_change(self):
        frame = {'type': 'message', 'topic': 'trade:kr:005930',
                 'data': {'price': '73100', 'volume': '7',
                          'timestamp': '2026-10-27T09:00:01.123+09:00',
                          'currency': 'KRW'}}
        event = toss_ws_hub._quote(frame)
        self.assertEqual((event['code'], event['price'], event['trade']['qty']),
                         ('005930', 73100, 7))
        self.assertEqual(event['source'], 'Toss WebSocket')
        self.assertNotIn('volume', event)
        self.assertNotIn('changeRate', event)
        self.assertEqual(event['trade']['direction'], 'unknown')
        for invalid in (
            {'type': 'message', 'topic': 'trade:us:AAPL', 'data': frame['data']},
            {'type': 'message', 'topic': 'trade:kr:005930', 'data': {'price': 'nan'}},
            {'type': 'message', 'topic': 'trade:kr:123456', 'data': {'price': '-1'}},
            {'type': 'subscriptions', 'subscribed': ['trade:kr:005930']},
        ):
            self.assertIsNone(toss_ws_hub._quote(invalid))

    def test_two_hundred_topics_split_into_exactly_two_hundred(self):
        hub = toss_ws_hub.TossWsHub('fake-id', 'fake-secret', token_fn=lambda: ('token', 3600))
        hub.start = lambda: hub   # no external connection
        loop = asyncio.new_event_loop()
        try:
            codes = [str(i).zfill(6) for i in range(250)]
            sub = hub.subscribe(codes, loop=loop)
            a, b = hub._desired(0), hub._desired(1)
            self.assertEqual(len(a), 100)
            self.assertEqual(len(b), 100)
            self.assertEqual(len(set(a) | set(b)), 200)
            self.assertEqual(hub.health()['excessCodes'], 50)
            sub.update(codes[:80])
            self.assertEqual(len(hub._desired(0)), 80)
            self.assertEqual(len(hub._desired(1)), 0)
            sub.close()
            self.assertEqual(hub.health()['desiredCodes'], 0)
        finally:
            loop.close()

    def test_shared_auth_token_only_issued_once(self):
        calls = []
        def token():
            calls.append(True)
            return ('valid', 3600)
        hub = toss_ws_hub.TossWsHub('fake-id', 'fake-secret', token_fn=token)
        self.assertEqual(hub._token(), 'valid')
        self.assertEqual(hub._token(), 'valid')
        self.assertEqual(len(calls), 1)

    def test_queue_drops_are_explicitly_counted(self):
        hub = toss_ws_hub.TossWsHub('fake-id', 'fake-secret')
        hub.start = lambda: hub
        loop = asyncio.new_event_loop()
        try:
            sub = hub.subscribe(['005930'], loop=loop, maxsize=1)
            sub._deliver({'code': '005930', 'price': 1})
            sub._deliver({'code': '005930', 'price': 2})
            self.assertEqual(sub.dropped_events, 1)
            self.assertEqual(sub.queue.get_nowait()['price'], 2)
            sub.close()
        finally:
            loop.close()


class BrokerAllocationContracts(unittest.TestCase):
    def test_user_request_accepts_400_domestic_codes(self):
        codes = [str(i).zfill(6) for i in range(405)]
        self.assertEqual(len(realtime_quotes.normalize_codes(
            codes, limit=realtime_quotes.MAX_REQUEST_CODES)), 400)
        self.assertEqual(kiwoom_ws_hub.DEFAULT_MAX_CODES, 200)
        self.assertEqual(toss_ws_hub.MAX_CODES, 200)

    def test_derivative_slow_snapshot_does_not_slow_indices(self):
        self.assertEqual(option_flow._POLL_INTERVAL_SEC, 1800)
        self.assertFalse(option_flow.realtime_ws_enabled())
        self.assertEqual(domestic_futures._DAY_FUTURES_POLL_SEC, 1800)
        self.assertEqual(domestic_futures._REALTIME_POLL_SEC, 30)

    def test_relay_does_not_aggregate_lossy_ticks_into_live_order_signals(self):
        source = pathlib.Path('scripts/cloud-vm/realtime_quotes.py').read_text()
        self.assertIn('toss_hub.subscribe(toss_primary)', source)
        self.assertNotIn('kiwoom_9pay_live.', source)
        self.assertIn("('H0UNCNT0', c)", source)


if __name__ == '__main__':
    unittest.main()
