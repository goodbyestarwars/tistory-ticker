# -*- coding: utf-8 -*-
"""키움 실시간 공유 허브 + KIS 자리 넘친 종목의 키움 우선 중계 계약(2026-09-15).

사용자 지적("40개 ????")과 결정("적용해 1,2번"): KIS 실시간 자리(40)를 넘친 종목이 15초 REST
폴백("지연")으로만 갱신됐다. 옵션 호가 몫을 20→10으로 줄이고, 넘친 종목은 키움 WebSocket 하나로
받는다. 이 테스트는 로컬 WebSocket 서버를 가짜 키움으로 띄워 허브의 등록·전달·접미사 재시도를 실제
소켓으로 확인하고, 중계가 넘친 종목을 REST보다 키움에 먼저 맡기는지 본다.
"""

import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD_VM = os.path.join(ROOT, 'scripts', 'cloud-vm')
sys.path.insert(0, CLOUD_VM)

import kis_ws_hub  # noqa: E402
import kiwoom_ws_hub  # noqa: E402

try:
    from websockets.asyncio.server import serve
    HAVE_WEBSOCKETS = True
except ImportError:  # pragma: no cover
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


REAL_005930 = {
    'trnm': 'REAL',
    'data': [{'type': '0B', 'name': '주식체결', 'item': '005930_AL',
              'values': {'10': '-397000', '11': '-3000', '12': '-0.75', '13': '300'}}],
}


class FakeKiwoom:
    """키움 WebSocket 흉내: LOGIN·REG에 응답하고 받은 메시지를 기록한다."""

    def __init__(self, reject_suffix=False):
        self.connections = 0
        self.messages = []
        self.clients = []
        self.reject_suffix = reject_suffix

    async def handler(self, ws):
        self.connections += 1
        self.clients.append(ws)
        try:
            async for raw in ws:
                data = json.loads(raw)
                self.messages.append(data)
                trnm = data.get('trnm')
                if trnm == 'LOGIN':
                    await ws.send(json.dumps({'trnm': 'LOGIN', 'return_code': 0, 'return_msg': 'ok'}))
                elif trnm == 'REG':
                    items = data['data'][0]['item']
                    bad = self.reject_suffix and any(item.endswith('_AL') for item in items)
                    await ws.send(json.dumps({'trnm': 'REG', 'return_code': 1 if bad else 0,
                                              'return_msg': 'invalid item' if bad else 'ok'}))
        except Exception:
            pass
        finally:
            if ws in self.clients:
                self.clients.remove(ws)

    def regs(self):
        return [message for message in self.messages if message.get('trnm') == 'REG']

    async def send_all(self, payload):
        for ws in list(self.clients):
            await ws.send(json.dumps(payload))


@unittest.skipUnless(HAVE_WEBSOCKETS, 'websockets 필요')
class KiwoomWsHubTests(unittest.TestCase):
    def run_scenario(self, scenario, fake=None, **hub_kwargs):
        async def main():
            server = fake or FakeKiwoom()
            port = _free_port()
            async with serve(server.handler, '127.0.0.1', port):
                kwargs = dict(url='ws://127.0.0.1:%d' % port, token_fn=lambda: 'tok', code_suffix='_AL',
                              max_codes=100, watchdog_sec=30, reconnect_min_sec=0.1, reconnect_max_sec=0.5,
                              reg_min_gap_sec=0.05, reg_ack_grace_sec=0.2, idle_close_sec=0.3)
                kwargs.update(hub_kwargs)
                hub = kiwoom_ws_hub.KiwoomWsHub('app', 'secret', **kwargs)
                hub.start()
                try:
                    await scenario(server, hub)
                finally:
                    hub.stop()
        asyncio.run(asyncio.wait_for(main(), 30))

    def test_no_connection_without_subscribers(self):
        async def scenario(fake, hub):
            await asyncio.sleep(0.4)
            self.assertEqual(fake.connections, 0)
            self.assertEqual(hub.live_codes(), frozenset())
        self.run_scenario(scenario)

    def test_registers_full_list_and_delivers_events_to_subscribers(self):
        async def scenario(fake, hub):
            sub = hub.subscribe(['005930', '000660', 'bad'])
            self.assertTrue(await _wait_until(lambda: fake.regs()))
            reg = fake.regs()[-1]
            self.assertEqual(reg['grp_no'], '1')
            self.assertEqual(reg['refresh'], '0')   # 전체 목록으로 교체(REMOVE 형식 미확인)
            self.assertEqual(reg['data'], [{'item': ['005930_AL', '000660_AL'], 'type': ['0B']}])
            self.assertTrue(await _wait_until(lambda: hub.live_codes() == frozenset({'005930', '000660'})))

            await fake.send_all(REAL_005930)
            event = await asyncio.wait_for(sub.queue.get(), 3)
            self.assertEqual(event, {'type': 'quote', 'code': '005930', 'price': 397000.0,
                                     'change': -3000.0, 'changeRate': -0.75, 'source': 'Kiwoom WebSocket'})

            other = hub.subscribe(['000660'])
            await fake.send_all(REAL_005930)
            await asyncio.wait_for(sub.queue.get(), 3)
            await asyncio.sleep(0.1)
            self.assertTrue(other.queue.empty())      # 구독하지 않은 종목은 받지 않는다

            sub.update(['000660'])
            self.assertTrue(await _wait_until(
                lambda: fake.regs()[-1]['data'][0]['item'] == ['000660_AL']))
            self.assertEqual(fake.connections, 1)
            health = hub.health()
            self.assertTrue(health['connected'])
            self.assertTrue(health['loggedIn'])
            self.assertEqual(health['subscribers'], 2)
            self.assertGreaterEqual(health['regOk'], 2)
            self.assertEqual(health['codeSuffix'], '_AL')
            other.close()
            sub.close()
            self.assertTrue(await _wait_until(lambda: not hub.health()['connected'], timeout=4))
        self.run_scenario(scenario)

    def test_rejected_suffix_retries_without_suffix(self):
        async def scenario(fake, hub):
            hub.subscribe(['005930'])
            self.assertTrue(await _wait_until(
                lambda: any(reg['data'][0]['item'] == ['005930'] for reg in fake.regs())))
            self.assertTrue(await _wait_until(lambda: hub.live_codes() == frozenset({'005930'})))
            health = hub.health()
            self.assertEqual(health['codeSuffix'], '')
            self.assertTrue(health['suffixFallbackUsed'])
            self.assertEqual(health['regErrors'], 1)
        self.run_scenario(scenario, fake=FakeKiwoom(reject_suffix=True))

    def test_registration_is_capped_and_ping_is_echoed(self):
        async def scenario(fake, hub):
            hub.subscribe(['005930', '000660', '035420'])
            self.assertTrue(await _wait_until(lambda: fake.regs()))
            self.assertEqual(fake.regs()[-1]['data'][0]['item'], ['005930_AL', '000660_AL'])
            self.assertEqual(hub.health()['droppedCount'], 1)
            await fake.send_all({'trnm': 'PING'})
            self.assertTrue(await _wait_until(
                lambda: any(message.get('trnm') == 'PING' for message in fake.messages)))
        self.run_scenario(scenario, max_codes=2)


class RelayUsesKiwoomBeforeRestTests(unittest.TestCase):
    """KIS에 못 들어간 종목은 키움이 받으면 '지연'이 아니고 REST 폴백도 부르지 않는다."""

    def test_kis_overflow_codes_go_to_kiwoom_not_rest(self):
        import realtime_quotes
        import rest_quote_fallback as rqf

        class FakeKisSub:
            def __init__(self):
                self.queue = asyncio.Queue()

            def close(self):
                pass

        class FakeKisHub:
            def subscribe(self, keys):
                return FakeKisSub()

            def live_or_pending_keys(self):
                return frozenset({('H0UNCNT0', '005930')})

            def health(self):
                return {'connected': True, 'lastTickAgeSec': 0}

        class FakeKwSub:
            def __init__(self, codes):
                self.codes = set(codes)
                self.queue = asyncio.Queue()
                self.closed = False

            def update(self, codes):
                self.codes = set(codes)

            def close(self):
                self.closed = True

        class FakeKwHub:
            sub = None

            def subscribe(self, codes):
                FakeKwHub.sub = FakeKwSub(codes)
                return FakeKwHub.sub

            def live_codes(self):
                return frozenset({'000660'})

        class FakeFallback:
            def __init__(self):
                self.wanted = []

            def want(self, codes):
                self.wanted.append(set(codes))

            def release(self, codes):
                pass

            def latest(self, code):
                return None

        class FakeBrowser:
            def __init__(self):
                self.sent = []

            async def send_json(self, payload):
                self.sent.append(payload)

        fallback = FakeFallback()
        browser = FakeBrowser()
        starts = []
        patches = {
            (kis_ws_hub, 'start'): lambda a, b: FakeKisHub(),
            (kiwoom_ws_hub, 'start'): lambda a, b: starts.append((a, b)) or FakeKwHub(),
            (rqf, 'start'): lambda a, b: fallback,
            (realtime_quotes, '_COVERAGE_GRACE_SEC'): 0,
            (realtime_quotes, '_RELAY_TICK_SEC'): 0.05,
            (realtime_quotes, '_KIWOOM_DRAIN_SEC'): 0.05,
        }
        originals = {key: getattr(key[0], key[1]) for key in patches}
        env_keys = ('KIS_APPKEY', 'KIS_APPSECRET', 'KIWOOM_APPKEY', 'KIWOOM_SECRETKEY')
        env = {key: os.environ.get(key) for key in env_keys}
        for key in env_keys:
            os.environ[key] = 'x'
        for (module, name), value in patches.items():
            setattr(module, name, value)
        try:
            async def run():
                task = asyncio.ensure_future(
                    realtime_quotes._relay_once_kis(browser, ['005930', '000660'], []))
                self.assertTrue(await _wait_until(lambda: FakeKwHub.sub is not None, timeout=2))
                FakeKwHub.sub.queue.put_nowait({'type': 'quote', 'code': '000660', 'price': 2.0,
                                                'source': 'Kiwoom WebSocket'})
                FakeKwHub.sub.queue.put_nowait({'type': 'quote', 'code': '005930', 'price': 9.0,
                                                'source': 'Kiwoom WebSocket'})
                await asyncio.sleep(0.3)
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            asyncio.run(run())
        finally:
            for (module, name), value in originals.items():
                setattr(module, name, value)
            for key, value in env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.assertEqual(len(starts), 1)
        self.assertEqual(FakeKwHub.sub.codes, {'000660'})
        coverage = [message for message in browser.sent if message['type'] == 'coverage']
        self.assertEqual(coverage, [{'type': 'coverage', 'live': ['005930', '000660'], 'delayed': []}])
        kiwoom_quotes = [message for message in browser.sent
                         if message['type'] == 'quote' and message.get('source') == 'Kiwoom WebSocket']
        # KIS가 받는 005930은 키움 쪽 이벤트를 중복으로 넘기지 않는다.
        self.assertEqual([message['code'] for message in kiwoom_quotes], ['000660'])
        self.assertEqual(fallback.wanted, [])
        self.assertTrue(FakeKwHub.sub.closed)


class OptionsBudgetAndWiringTests(unittest.TestCase):
    def test_default_options_budget_is_a_quarter_of_the_slots(self):
        saved = os.environ.pop('KIS_WS_OPTIONS_BUDGET', None)
        try:
            hub = kis_ws_hub.KisWsHub('app', 'secret', approval_key_fn=lambda: 'k', max_registrations=40)
            self.assertEqual(hub.options_budget, 10)
        finally:
            if saved is not None:
                os.environ['KIS_WS_OPTIONS_BUDGET'] = saved

    def test_health_endpoint_includes_kiwoom_hub(self):
        with open(os.path.join(CLOUD_VM, 'main.py'), encoding='utf-8') as handle:
            source = handle.read()
        self.assertIn("snapshot['kiwoom'] = kiwoom_ws_hub.health_snapshot()", source)

    def test_kiwoom_quote_parser_strips_code_suffix(self):
        import realtime_quotes
        events = realtime_quotes._quote_events(REAL_005930)
        self.assertEqual([event['code'] for event in events], ['005930'])


@unittest.skipUnless(shutil.which('node'), 'node 필요')
class SplitFlapDigitTests(unittest.TestCase):
    """홈 종목판: 바뀐 글자만 점수판처럼 반쪽씩 넘기고, 오른쪽 끝부터 자리를 맞춘다."""

    def run_flap(self, cases):
        with open(os.path.join(ROOT, 'js', 'home-realtime-table.js'), encoding='utf-8') as handle:
            source = handle.read()
        start = source.index('  function flapHalf(position, age, text) {')
        end = source.index('\n  function textNodesOf(root) {', start)
        script = (
            "function escapeHtml(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;');}\n"
            + source[start:end]
            + "\nconst cases = JSON.parse(process.env.FLAP_CASES);"
            + "\nconsole.log(JSON.stringify(cases.map(c => splitFlapText(c[0], c[1]))));"
        )
        env = dict(os.environ, FLAP_CASES=json.dumps(cases))
        out = subprocess.run(['node', '-e', script], capture_output=True, text=True, encoding='utf-8',
                             env=env, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    @staticmethod
    def flap(prev, nxt):
        half = '<span class="hrt-flap-half hrt-flap-%s hrt-flap-%s"><span>%s</span></span>'
        return ('<span class="hrt-flap"><span class="hrt-flap-base">%s</span>' % nxt
                + half % ('top', 'new', nxt) + half % ('bottom', 'old', prev)
                + half % ('top', 'old', prev) + half % ('bottom', 'new', nxt) + '</span>')

    def test_only_changed_characters_flip_aligned_from_the_right(self):
        changed, grow, same = self.run_flap([
            ['4,325원', '4,330원'],
            ['9,995', '10,005'],
            ['+0.75%', '+0.75%'],
        ])
        flap = self.flap
        # 4,325원 → 4,330원: 천 단위 3은 그대로, 2→3·5→0 두 글자만 넘어간다.
        self.assertEqual(changed, '4,3' + flap('2', '3') + flap('5', '0') + '원')
        self.assertEqual(grow, flap('', '1') + flap('9', '0') + ',' + flap('9', '0') + flap('9', '0') + '5')
        self.assertEqual(same, '+0.75%')

if __name__ == '__main__':
    unittest.main()
