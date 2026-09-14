# -*- coding: utf-8 -*-
"""KIS 실시간 WebSocket 공유 허브 계약(2026-09-14).

같은 KIS 앱키로 WebSocket을 여는 곳이 프로세스 안에 넷(야간선물·주간선물·옵션·브라우저 중계
연결마다)이라, 라이브에서 중계 연결이 약 0.5초 만에 끊기는 재접속이 반복되고 브라우저에는
체결이 0건 들어왔다. 이 테스트는 로컬 WebSocket 서버를 가짜 KIS로 띄워 허브가
"연결 하나를 같이 쓰는지"를 실제 소켓으로 확인하고, 다른 모듈이 KIS WebSocket을 직접 여는
코드가 다시 들어오지 못하게 정적으로 막는다.
"""

import asyncio
import json
import os
import re
import socket
import sys
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD_VM = os.path.join(ROOT, 'scripts', 'cloud-vm')
sys.path.insert(0, CLOUD_VM)

import kis_ws_hub  # noqa: E402

try:
    from websockets.asyncio.server import serve
    HAVE_WEBSOCKETS = True
except ImportError:  # pragma: no cover - VM·로컬 모두 websockets가 있다
    HAVE_WEBSOCKETS = False


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


async def _wait_until(predicate, timeout=6.0):
    end = time.time() + timeout
    while time.time() < end:
        if predicate():
            return True
        await asyncio.sleep(0.02)
    return predicate()


class FakeKis:
    """KIS WebSocket 흉내: 연결 수, 연결별 등록, PINGPONG 되돌림을 기록한다."""

    def __init__(self):
        self.connections = 0
        self.registrations = []
        self.unregistrations = []
        self.pingpong_echoes = 0
        self.clients = []

    async def handler(self, ws):
        self.connections += 1
        regs = []
        self.registrations.append(regs)
        self.clients.append(ws)
        try:
            async for message in ws:
                data = json.loads(message)
                if (data.get('header') or {}).get('tr_id') == 'PINGPONG':
                    self.pingpong_echoes += 1
                    continue
                body = (data.get('body') or {}).get('input') or {}
                key = (body.get('tr_id'), body.get('tr_key'))
                if (data.get('header') or {}).get('tr_type') == '2':
                    self.unregistrations.append(key)
                    if key in regs:
                        regs.remove(key)
                else:
                    regs.append(key)
        except Exception:
            pass
        finally:
            if ws in self.clients:
                self.clients.remove(ws)

    async def send_all(self, text):
        for ws in list(self.clients):
            await ws.send(text)

    async def close_all(self):
        for ws in list(self.clients):
            await ws.close()


@unittest.skipUnless(HAVE_WEBSOCKETS, 'websockets 필요')
class KisWsHubTests(unittest.TestCase):
    def run_scenario(self, scenario, **hub_kwargs):
        async def main():
            fake = FakeKis()
            port = _free_port()
            async with serve(fake.handler, '127.0.0.1', port):
                kwargs = dict(url='ws://127.0.0.1:%d' % port, approval_key_fn=lambda: 'test-key',
                              watchdog_sec=30, reconnect_min_sec=0.1, reconnect_max_sec=0.5)
                kwargs.update(hub_kwargs)
                hub = kis_ws_hub.KisWsHub('app', 'secret', **kwargs)
                hub.start()
                try:
                    await scenario(fake, hub)
                finally:
                    hub.stop()
        asyncio.run(asyncio.wait_for(main(), 30))

    def test_one_upstream_connection_is_shared_and_keys_register_once(self):
        async def scenario(fake, hub):
            quotes = hub.subscribe([('H0UNCNT0', '005930')])
            futures = hub.subscribe([('H0UNCNT0', '005930'),
                                     ('H0MFCNT0', 'A01609', kis_ws_hub.PRIORITY_FUTURES)])
            self.assertTrue(await _wait_until(
                lambda: fake.registrations and len(fake.registrations[-1]) >= 2))
            await asyncio.sleep(0.2)
            self.assertEqual(fake.connections, 1)
            self.assertEqual(sorted(fake.registrations[0]),
                             sorted([('H0UNCNT0', '005930'), ('H0MFCNT0', 'A01609')]))

            await fake.send_all('0|H0UNCNT0|001|005930^1^2')
            self.assertEqual(await asyncio.wait_for(quotes.queue.get(), 3), '0|H0UNCNT0|001|005930^1^2')
            self.assertEqual(await asyncio.wait_for(futures.queue.get(), 3), '0|H0UNCNT0|001|005930^1^2')

            # tr_id가 다른 프레임은 그 tr_id를 구독한 쪽에만 간다.
            await fake.send_all('0|H0MFCNT0|001|A01609^x')
            self.assertEqual(await asyncio.wait_for(futures.queue.get(), 3), '0|H0MFCNT0|001|A01609^x')
            await asyncio.sleep(0.1)
            self.assertTrue(quotes.queue.empty())
            self.assertTrue(hub.health()['connected'])
        self.run_scenario(scenario)

    def test_pingpong_is_echoed_as_text(self):
        async def scenario(fake, hub):
            hub.subscribe([('H0UNCNT0', '005930')])
            self.assertTrue(await _wait_until(lambda: fake.clients))
            await fake.send_all(json.dumps({'header': {'tr_id': 'PINGPONG', 'datetime': '20260914190000'}}))
            self.assertTrue(await _wait_until(lambda: fake.pingpong_echoes >= 1))
            self.assertGreaterEqual(hub.health()['pingpongs'], 1)
        self.run_scenario(scenario)

    def test_control_error_is_recorded_not_swallowed(self):
        """KIS 거절 사유가 사라지면 장애 원인을 로그로도 못 좁힌다(2026-09-14 실제로 그랬다)."""
        async def scenario(fake, hub):
            hub.subscribe([('H0UNCNT0', '005930')])
            self.assertTrue(await _wait_until(lambda: fake.clients))
            await fake.send_all(json.dumps({
                'header': {'tr_id': 'H0UNCNT0', 'tr_key': '005930'},
                'body': {'rt_cd': '1', 'msg_cd': 'OPSP0011', 'msg1': 'ALREADY IN USE appkey'},
            }))
            self.assertTrue(await _wait_until(lambda: (hub.health()['lastError'] or {}).get('msgCd') == 'OPSP0011'))
            health = hub.health()
            self.assertEqual(health['controlErrors'], 1)
            self.assertEqual(health['lastError']['msg'], 'ALREADY IN USE appkey')
        self.run_scenario(scenario)

    def test_reconnect_re_registers_active_keys(self):
        async def scenario(fake, hub):
            hub.subscribe([('H0UNCNT0', '005930'), ('H0UNASP0', '005930', kis_ws_hub.PRIORITY_ORDERBOOK)])
            self.assertTrue(await _wait_until(lambda: fake.registrations and len(fake.registrations[0]) == 2))
            await fake.close_all()
            self.assertTrue(await _wait_until(
                lambda: fake.connections >= 2 and len(fake.registrations[-1]) == 2))
            self.assertEqual(sorted(fake.registrations[-1]), sorted(fake.registrations[0]))
            self.assertGreaterEqual(hub.health()['reconnects'], 1)
        self.run_scenario(scenario)

    def test_registration_cap_keeps_higher_priority_keys(self):
        async def scenario(fake, hub):
            options = hub.subscribe([('H0IOCNT0', '201W09250', kis_ws_hub.PRIORITY_OPTIONS)])
            self.assertTrue(await _wait_until(lambda: fake.registrations and fake.registrations[-1]))
            hub.subscribe([('H0UNCNT0', '005930')])
            hub.subscribe([('H0MFCNT0', 'A01609', kis_ws_hub.PRIORITY_FUTURES)])
            # 옵션이 두 자리 중 하나를 쥐고 있으면 옵션만 해제하고 선물·종목을 올린다(같은 세션).
            self.assertTrue(await _wait_until(
                lambda: set(fake.registrations[-1]) == {('H0MFCNT0', 'A01609'), ('H0UNCNT0', '005930')}))
            self.assertEqual(fake.connections, 1)
            self.assertEqual(fake.unregistrations, [('H0IOCNT0', '201W09250')])
            health = hub.health()
            self.assertEqual(health['droppedCount'], 1)
            self.assertEqual(health['droppedRegistrations'][0]['trId'], 'H0IOCNT0')
            self.assertFalse(options.closed)
        self.run_scenario(scenario, max_registrations=2, options_budget=2)

    def test_closed_subscription_frees_its_slot_without_reconnect(self):
        """새 페이지의 첫 체결이 세션 재구성을 기다리면 안 된다(라이브 16초 지연)."""
        async def scenario(fake, hub):
            first = hub.subscribe([('H0UNCNT0', '005930')])
            self.assertTrue(await _wait_until(lambda: fake.registrations and fake.registrations[-1]))
            first.close()
            started = time.time()
            hub.subscribe([('H0UNCNT0', '000660')])
            self.assertTrue(await _wait_until(
                lambda: fake.registrations[-1] == [('H0UNCNT0', '000660')], timeout=2))
            self.assertLess(time.time() - started, 1.5)
            self.assertEqual(fake.connections, 1)
            self.assertEqual(fake.unregistrations, [('H0UNCNT0', '005930')])
            self.assertEqual(hub.health()['unsubscribes'], 1)
        self.run_scenario(scenario, max_registrations=1)

    def test_options_use_at_most_their_budget(self):
        async def scenario(fake, hub):
            hub.subscribe([('H0IOCNT0', '201W0925%d' % i, kis_ws_hub.PRIORITY_OPTIONS) for i in range(6)])
            hub.subscribe([('H0UNCNT0', '005930')])
            self.assertTrue(await _wait_until(lambda: fake.registrations and len(fake.registrations[-1]) == 4))
            await asyncio.sleep(0.2)
            regs = fake.registrations[-1]
            self.assertEqual(sum(1 for key in regs if key[0] == 'H0IOCNT0'), 3)
            self.assertIn(('H0UNCNT0', '005930'), regs)
            self.assertEqual(hub.health()['droppedCount'], 3)
        self.run_scenario(scenario, max_registrations=10, options_budget=3)

    def test_resubscribing_same_keys_with_free_slots_keeps_the_session(self):
        """옵션 수집기는 5분마다 같은 계약을 닫고 다시 구독한다 - 그때마다 세션을 갈아엎으면
        브라우저 체결까지 끊긴다."""
        async def scenario(fake, hub):
            keys = [('H0IOCNT0', '201W0925%d' % i, kis_ws_hub.PRIORITY_OPTIONS) for i in range(12)]
            hub.subscribe([('H0UNCNT0', '005930')])
            first = hub.subscribe(keys)
            self.assertTrue(await _wait_until(lambda: fake.registrations and len(fake.registrations[0]) == 13))
            first.close()
            await asyncio.sleep(0.3)
            hub.subscribe(keys)
            await asyncio.sleep(0.3)
            self.assertEqual(fake.connections, 1)
            self.assertEqual(len(fake.registrations[0]), 13)
            self.assertEqual(fake.unregistrations, [])
            self.assertEqual(hub.health()['unsubscribes'], 0)
        self.run_scenario(scenario, max_registrations=40)

    def test_watchdog_reconnects_when_upstream_goes_silent(self):
        async def scenario(fake, hub):
            hub.subscribe([('H0UNCNT0', '005930')])
            self.assertTrue(await _wait_until(lambda: fake.connections >= 2, timeout=8))
            self.assertGreaterEqual(hub.health()['watchdogReconnects'], 1)
        self.run_scenario(scenario, watchdog_sec=0.5)

    def test_health_never_exposes_keys(self):
        async def scenario(fake, hub):
            hub.subscribe([('H0UNCNT0', '005930')])
            self.assertTrue(await _wait_until(lambda: fake.clients))
            dumped = json.dumps(hub.health())
            self.assertNotIn('test-key', dumped)
            self.assertNotIn('secret', dumped)
        self.run_scenario(scenario)


class LiveOrPendingKeysTests(unittest.TestCase):
    """중계가 '지연'을 판단하는 기준: 연결 중 등록됐거나 상한 안에서 등록 차례를 기다리는 키."""

    def make_hub(self, max_registrations):
        hub = kis_ws_hub.KisWsHub('app', 'secret', approval_key_fn=lambda: 'k',
                                  max_registrations=max_registrations, options_budget=0)
        loop = asyncio.new_event_loop()
        self.addCleanup(loop.close)
        return hub, loop

    def test_pending_keys_within_cap_count_as_live_while_connected(self):
        hub, loop = self.make_hub(max_registrations=2)
        hub.subscribe([('H0UNCNT0', '005930'), ('H0UNCNT0', '000660'), ('H0UNCNT0', '035420')], loop=loop)
        with hub._lock:
            hub._state['connected'] = True
            hub._registered_view = frozenset({('H0UNCNT0', '005930')})
        keys = hub.live_or_pending_keys()
        self.assertIn(('H0UNCNT0', '005930'), keys)      # 등록됨
        self.assertIn(('H0UNCNT0', '000660'), keys)      # 상한 안에서 차례 대기
        self.assertNotIn(('H0UNCNT0', '035420'), keys)   # 상한 밖 → 지연

    def test_result_is_cached_until_subscriptions_change(self):
        """브라우저 연결마다 1초에 한 번 부르므로 바뀐 게 없으면 다시 계산하지 않는다(2026-09-15)."""
        hub, loop = self.make_hub(max_registrations=5)
        hub.subscribe([('H0UNCNT0', '005930')], loop=loop)
        with hub._lock:
            hub._state['connected'] = True
        first = hub.live_or_pending_keys()
        self.assertIs(hub.live_or_pending_keys(), first)
        hub.subscribe([('H0UNCNT0', '000660')], loop=loop)
        self.assertIn(('H0UNCNT0', '000660'), hub.live_or_pending_keys())
        with hub._lock:
            hub._state['connected'] = False
        self.assertEqual(hub.live_or_pending_keys(), frozenset())

    def test_nothing_is_live_while_disconnected(self):
        hub, loop = self.make_hub(max_registrations=40)
        hub.subscribe([('H0UNCNT0', '005930')], loop=loop)
        self.assertEqual(hub.live_or_pending_keys(), frozenset())


class RelayRegistrationTests(unittest.TestCase):
    """브라우저 연결 하나가 허브에 어떤 키를 올리는지(등록 자리 40을 아껴 쓰는지)."""

    def registrations_for(self, codes):
        import realtime_quotes

        captured = {}

        class FakeSub:
            queue = asyncio.Queue()

            def close(self):
                captured['closed'] = True

        class FakeHub:
            def subscribe(self, keys):
                captured['keys'] = list(keys)
                return FakeSub()

        class StopRelay(Exception):
            pass

        class FakeBrowser:
            async def send_json(self, payload):
                raise StopRelay()

        original_start = kis_ws_hub.start
        original_env = {k: os.environ.get(k) for k in ('KIS_APPKEY', 'KIS_APPSECRET')}
        kis_ws_hub.start = lambda appkey, appsecret: FakeHub()
        os.environ['KIS_APPKEY'] = 'k'
        os.environ['KIS_APPSECRET'] = 's'
        try:
            with self.assertRaises(StopRelay):
                asyncio.run(realtime_quotes._relay_once_kis(FakeBrowser(), codes, []))
        finally:
            kis_ws_hub.start = original_start
            for key, value in original_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
        self.assertTrue(captured.get('closed'))
        return [(tr_id, code) for tr_id, code, _priority in captured['keys']]

    def test_single_code_order_book_gets_trades_and_orderbook(self):
        self.assertEqual(self.registrations_for(['005930']),
                         [('H0UNCNT0', '005930'), ('H0UNASP0', '005930')])

    def test_multi_code_list_pages_register_trades_only(self):
        keys = self.registrations_for(['005930', '000660', '035420'])
        self.assertEqual(keys, [('H0UNCNT0', '005930'), ('H0UNCNT0', '000660'), ('H0UNCNT0', '035420')])


class SingleKisSessionContractTests(unittest.TestCase):
    """KIS WebSocket을 직접 여는 코드는 허브 한 곳에만 있어야 한다."""

    def test_only_the_hub_connects_to_kis_websocket(self):
        offenders = []
        pattern = re.compile(r'websockets\.connect\(\s*(kis_client\.WS_URL|KIS_WS_URL)')
        for name in sorted(os.listdir(CLOUD_VM)):
            if not name.endswith('.py') or name == 'kis_ws_hub.py':
                continue
            with open(os.path.join(CLOUD_VM, name), encoding='utf-8') as handle:
                if pattern.search(handle.read()):
                    offenders.append(name)
        self.assertEqual(offenders, [], 'KIS WebSocket을 허브 밖에서 직접 연다: %s' % offenders)

    def test_consumers_subscribe_through_the_hub(self):
        for name in ('realtime_quotes.py', 'night_futures_ws.py', 'domestic_futures_ws.py', 'option_flow.py'):
            with open(os.path.join(CLOUD_VM, name), encoding='utf-8') as handle:
                source = handle.read()
            self.assertIn('kis_ws_hub.start(', source, name)
            self.assertIn('.subscribe(', source, name)

    def test_health_endpoint_exposes_hub_state(self):
        with open(os.path.join(CLOUD_VM, 'main.py'), encoding='utf-8') as handle:
            source = handle.read()
        self.assertIn("@app.get('/health/realtime')", source)
        self.assertIn('kis_ws_hub.health_snapshot()', source)
        self.assertIn('kis_ws_hub.start(kis_appkey, kis_appsecret)', source)


if __name__ == '__main__':
    unittest.main()
