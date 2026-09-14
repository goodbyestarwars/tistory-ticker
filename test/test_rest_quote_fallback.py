# -*- coding: utf-8 -*-
"""실시간 등록 자리에 못 들어간 종목의 REST 통합 시세 폴백 계약(2026-09-14)."""

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'cloud-vm'))

import rest_quote_fallback as rqf  # noqa: E402

KST = timezone(timedelta(hours=9))
SESSION = datetime(2026, 9, 14, 19, 30, tzinfo=KST)      # 월요일 애프터마켓
NIGHT = datetime(2026, 9, 14, 22, 0, tzinfo=KST)


class QuoteEventTests(unittest.TestCase):
    def test_falling_quote_gets_negative_change_and_rate(self):
        event = rqf.quote_event('005930', {
            'stck_prpr': '248000', 'prdy_vrss': '11500', 'prdy_vrss_sign': '5',
            'prdy_ctrt': '4.43', 'acml_vol': '26014666',
        }, 100.0)
        self.assertEqual(event['type'], 'quote')
        self.assertEqual(event['price'], 248000)
        self.assertEqual(event['change'], -11500)
        self.assertEqual(event['changeRate'], -4.43)
        self.assertEqual(event['volume'], 26014666)
        self.assertTrue(event['delayed'])
        self.assertEqual(event['source'], 'KIS REST')

    def test_already_signed_values_are_not_flipped_twice(self):
        event = rqf.quote_event('000660', {
            'stck_prpr': '100', 'prdy_vrss': '-5', 'prdy_vrss_sign': '5', 'prdy_ctrt': '-4.76',
        }, 1.0)
        self.assertEqual(event['change'], -5)
        self.assertEqual(event['changeRate'], -4.76)

    def test_rising_and_flat(self):
        up = rqf.quote_event('A', {'stck_prpr': '10', 'prdy_vrss': '1', 'prdy_vrss_sign': '2', 'prdy_ctrt': '11.1'}, 1)
        flat = rqf.quote_event('B', {'stck_prpr': '10', 'prdy_vrss': '0', 'prdy_vrss_sign': '3', 'prdy_ctrt': '0.00'}, 1)
        self.assertEqual((up['change'], up['changeRate']), (1, 11.1))
        self.assertEqual((flat['change'], flat['changeRate']), (0, 0))

    def test_missing_price_gives_no_event(self):
        self.assertIsNone(rqf.quote_event('A', {'stck_prpr': ''}, 1))
        self.assertIsNone(rqf.quote_event('A', None, 1))


class FallbackPollingTests(unittest.TestCase):
    def make(self, now_kst=SESSION, max_codes=60):
        self.clock = [1000.0]
        self.calls = []

        def fetch(code):
            self.calls.append(code)
            return {'stck_prpr': '1000', 'prdy_vrss': '10', 'prdy_vrss_sign': '2', 'prdy_ctrt': '1.01'}
        return rqf.RestQuoteFallback(fetch, clock=lambda: self.clock[0], now_kst=lambda: now_kst,
                                     max_codes=max_codes)

    def test_only_wanted_codes_are_fetched_and_shared_across_viewers(self):
        fb = self.make()
        fb.want(['005930', '000660'])
        fb.want(['005930'])                  # 두 번째 방문자
        fb.poll_once()
        self.assertEqual(sorted(self.calls), ['000660', '005930'])
        self.assertEqual(fb.latest('005930')['price'], 1000)

    def test_interval_is_respected_in_session(self):
        fb = self.make()
        fb.want(['005930'])
        fb.poll_once()
        self.clock[0] += rqf.SESSION_INTERVAL_SEC - 1
        fb.poll_once()
        self.assertEqual(self.calls, ['005930'])
        self.clock[0] += 1
        fb.poll_once()
        self.assertEqual(self.calls, ['005930', '005930'])

    def test_off_session_polls_rarely(self):
        fb = self.make(now_kst=NIGHT)
        fb.want(['005930'])
        fb.poll_once()
        self.clock[0] += rqf.SESSION_INTERVAL_SEC * 2
        fb.poll_once()
        self.assertEqual(self.calls, ['005930'])

    def test_release_stops_polling_only_when_nobody_wants_it(self):
        fb = self.make()
        fb.want(['005930'])
        fb.want(['005930'])
        fb.release(['005930'])
        self.assertEqual(fb.wanted_codes(), ['005930'])
        fb.release(['005930'])
        self.assertEqual(fb.wanted_codes(), [])
        fb.poll_once()
        self.assertEqual(self.calls, [])

    def test_cycle_cap_defers_the_rest(self):
        fb = self.make(max_codes=2)
        fb.want(['A', 'B', 'C'])
        fb.poll_once()
        self.assertEqual(len(self.calls), 2)
        fb.poll_once()
        self.assertEqual(len(self.calls), 3)

    def test_fetch_error_does_not_break_the_cycle(self):
        fb = self.make()

        def flaky(code):
            if code == 'BAD':
                raise RuntimeError('boom')
            return {'stck_prpr': '5'}
        fb._fetch = flaky
        fb.want(['BAD', 'OK'])
        fb.poll_once()
        self.assertIsNone(fb.latest('BAD'))
        self.assertEqual(fb.latest('OK')['price'], 5)


class RelayCoverageTests(unittest.TestCase):
    """중계가 등록 못 된 종목을 알려주고 REST 시세를 delayed quote로 대신 보내는지."""

    def test_unregistered_codes_are_reported_and_filled_from_rest(self):
        import asyncio
        import kis_ws_hub
        import realtime_quotes

        class FakeSub:
            def __init__(self):
                self.queue = asyncio.Queue()

            def close(self):
                pass

        class FakeHub:
            def subscribe(self, keys):
                return FakeSub()

            def registered_keys(self):
                return frozenset({('H0UNCNT0', '005930')})

            def health(self):
                return {'connected': True, 'lastTickAgeSec': 0}

        class FakeFallback:
            def __init__(self):
                self.wanted = []
                self.released = []

            def want(self, codes):
                self.wanted.append(set(codes))

            def release(self, codes):
                self.released.append(set(codes))

            def latest(self, code):
                if code == '000660':
                    return {'type': 'quote', 'code': code, 'price': 1.0, 'delayed': True, 'fetchedAt': 7}
                return None

        class FakeBrowser:
            def __init__(self):
                self.sent = []

            async def send_json(self, payload):
                self.sent.append(payload)

        fallback = FakeFallback()
        browser = FakeBrowser()
        patches = {
            (kis_ws_hub, 'start'): lambda a, b: FakeHub(),
            (rqf, 'start'): lambda a, b: fallback,
            (realtime_quotes, '_COVERAGE_GRACE_SEC'): 0,
            (realtime_quotes, '_RELAY_TICK_SEC'): 0.05,
        }
        originals = {key: getattr(key[0], key[1]) for key in patches}
        env = {k: os.environ.get(k) for k in ('KIS_APPKEY', 'KIS_APPSECRET')}
        os.environ['KIS_APPKEY'] = 'k'
        os.environ['KIS_APPSECRET'] = 's'
        for (module, name), value in patches.items():
            setattr(module, name, value)
        try:
            async def run():
                with self.assertRaises(asyncio.TimeoutError):
                    await asyncio.wait_for(
                        realtime_quotes._relay_once_kis(browser, ['005930', '000660'], []), 0.5)
            asyncio.run(run())
        finally:
            for (module, name), value in originals.items():
                setattr(module, name, value)
            for key, value in env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        types = [message['type'] for message in browser.sent]
        self.assertEqual(types[0], 'ready')
        coverage = [m for m in browser.sent if m['type'] == 'coverage']
        self.assertEqual(coverage, [{'type': 'coverage', 'live': ['005930'], 'delayed': ['000660']}])
        delayed_quotes = [m for m in browser.sent if m['type'] == 'quote']
        self.assertEqual(len(delayed_quotes), 1)          # 같은 조회값은 한 번만
        self.assertEqual(delayed_quotes[0]['code'], '000660')
        self.assertTrue(delayed_quotes[0]['delayed'])
        self.assertEqual(fallback.wanted, [{'000660'}])
        self.assertEqual(fallback.released, [{'000660'}])  # 연결이 끝나면 조회 요청을 거둔다


if __name__ == '__main__':
    unittest.main()
