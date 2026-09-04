# -*- coding: utf-8 -*-
"""브라우저가 GAS를 거치지 않고 직접 보는 /invest-signal, /pattern-scan 계약.

2026-09-03 API Probe 실측: GAS 경유가 ?investSignal=1 8.59초, ?patternScan=1 24.07초였다.
같은 응답의 전송 바이트는 gzip 후 각각 230KB/22.8KB라 회선이 아니라 GAS 구간이 병목이고,
VM은 하루 1회 배치가 만들어둔 캐시 파일을 그대로 서빙한다.

프론트가 VM과 GAS 두 경로를 같은 렌더 함수로 그리고 VM이 막히면 GAS로 폴백하므로,
두 응답의 모양이 어긋나면 폴백이 조용히 깨진다. 여기서 gas/ticker-proxy.gs의
getInvestSignalResult()/getPatternScanResult()와 같은 키를 내는지 고정한다.
"""
import gzip
import json
import os
import sys
import tempfile
import unittest

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import main  # noqa: E402


class FakeRequest(object):
    """라우트가 쓰는 건 Accept-Encoding 헤더뿐이다(레이트리밋은 테스트에서 통과시킨다)."""

    def __init__(self, accept_encoding='gzip, deflate'):
        self.headers = {'accept-encoding': accept_encoding}


CACHE = {
    'generatedAt': '2026-09-03T09:00:00+09:00',
    'universe': 2900,
    'patternScan': {'scanned': 2800, 'patterns': {
        'risingLows': [{'code': '000001'}],
        'maCloudBreakout': [], 'doubleBottom': [], 'invHeadShoulders': [],
        'boxRangeLow': [], 'openingGap': [], 'angleMomentum': [], 'gongpasan': [],
    }},
    'pullbackScan': {'scanned': 2700, 'matches': [{'code': '000002'}]},
    'angleMomentumBacktest': {'totalTrades': 10},
    'gongpasanBacktest': None,
    'investSignal': {'scanned': 2800, 'counts': {'매수 우위': 1}, 'buckets': {
        '적극 매수': [], '매수 우위': [['000001', '테스트', 100, 1.0, 5, 3]],
        '보유': [], '비중축소': [], '매도': [],
    }},
    'swingScan': {'modelVersion': 'swing-4w-v5', 'scanned': 2800,
                  'flowGroups': {'upturn': [{'code': '000001'}]},
                  'regimeCounts': {}, 'eventCounts': {}, 'waveCoverage': {}},
}


class PublicScanRouteTests(unittest.TestCase):

    def setUp(self):
        self._orig_file = main.DAILY_SCAN_CACHE_FILE
        self._orig_mem = main._daily_scan_cache_mem
        self._orig_limit = main._check_rate_limit
        fd, path = tempfile.mkstemp(suffix='.json')
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(CACHE, f)
        self._path = path
        main.DAILY_SCAN_CACHE_FILE = path
        main._daily_scan_cache_mem = {}
        self._orig_resp = main._daily_scan_response_cache
        main._daily_scan_response_cache = {}
        # 레이트리밋은 Request가 필요해 여기서는 통과시킨다. 라우트에 걸려 있는지는
        # 아래 test_routes_are_rate_limited가 소스로 확인한다.
        main._check_rate_limit = lambda *args, **kwargs: None

    def tearDown(self):
        main.DAILY_SCAN_CACHE_FILE = self._orig_file
        main._daily_scan_cache_mem = self._orig_mem
        main._daily_scan_response_cache = self._orig_resp
        main._check_rate_limit = self._orig_limit
        if os.path.exists(self._path):
            os.remove(self._path)

    def route_data(self, route):
        """라우트는 미리 직렬화해둔 바이트를 Response로 돌려주므로 본문을 풀어서 본다."""
        response = route(FakeRequest())
        self.assertEqual(response.headers['content-encoding'], 'gzip')
        return json.loads(gzip.decompress(response.body).decode('utf-8'))['data']

    def test_invest_signal_matches_the_gas_shape(self):
        data = self.route_data(main.invest_signal_result)
        self.assertEqual(sorted(data), ['buckets', 'counts', 'scanned', 'scannedAt', 'swingScan', 'universe'])
        # GAS는 한글 라벨 버킷을 영문 키로 바꿔서 넘긴다. 프론트가 그 키를 읽는다.
        self.assertEqual(sorted(data['buckets']), ['activeBuy', 'buy', 'hold', 'reduce', 'sell'])
        self.assertEqual(data['buckets']['buy'], [['000001', '테스트', 100, 1.0, 5, 3]])
        self.assertEqual(data['buckets']['activeBuy'], [])
        self.assertEqual(data['scannedAt'], CACHE['generatedAt'])
        self.assertEqual(data['scanned'], 2800)
        self.assertEqual(data['universe'], 2900)
        self.assertEqual(sorted(data['swingScan']),
                         ['eventCounts', 'flowGroups', 'modelVersion', 'regimeCounts', 'scanned', 'waveCoverage'])
        # candidates는 GAS도 넘기지 않는다 - 프론트의 폴백 경로가 그 부재를 전제로 한다.
        self.assertNotIn('candidates', data['swingScan'])

    def test_pattern_scan_matches_the_gas_shape(self):
        data = self.route_data(main.pattern_scan_result)
        self.assertEqual(sorted(data), ['angleMomentumBacktest', 'gongpasanBacktest', 'patterns',
                                        'pullbackScanned', 'pullbackScannedAt', 'scanned', 'scannedAt', 'universe'])
        self.assertEqual(sorted(data['patterns']),
                         ['angleMomentum', 'boxRangeLow', 'doubleBottom', 'gongpasan', 'invHeadShoulders',
                          'maCloudBreakout', 'openingGap', 'pullback', 'risingLows'])
        # 눌림목만 patternScan.patterns가 아니라 pullbackScan.matches에서 온다.
        self.assertEqual(data['patterns']['pullback'], [{'code': '000002'}])
        self.assertEqual(data['patterns']['risingLows'], [{'code': '000001'}])
        self.assertEqual(data['pullbackScanned'], 2700)
        self.assertEqual(data['angleMomentumBacktest'], {'totalTrades': 10})
        self.assertIsNone(data['gongpasanBacktest'])

    def test_uncompressed_client_gets_the_same_json(self):
        response = main.invest_signal_result(FakeRequest(accept_encoding='identity'))
        self.assertNotIn('content-encoding', response.headers)
        self.assertEqual(json.loads(response.body.decode('utf-8'))['data']['scanned'], 2800)

    def test_response_bytes_are_built_once_per_cache_file_version(self):
        # 2026-09-03 실측: 요청마다 2.4MB를 인코딩·압축하느라 /invest-signal이 7.4초였다.
        # 파일이 그대로면 같은 바이트 객체를 그대로 돌려줘야 한다.
        first = main.invest_signal_result(FakeRequest()).body
        second = main.invest_signal_result(FakeRequest()).body
        self.assertIs(first, second)
        # 파일이 바뀌면 다시 만든다.
        with open(self._path, 'w', encoding='utf-8') as f:
            json.dump(dict(CACHE, universe=2901), f)
        main._daily_scan_cache_mem = {}
        rebuilt = json.loads(gzip.decompress(main.invest_signal_result(FakeRequest()).body).decode('utf-8'))
        self.assertEqual(rebuilt['data']['universe'], 2901)

    def test_updated_at_comes_from_the_cache_file_not_the_request(self):
        # 호출 시각을 쓰면 응답이 매번 달라져 미리 만들어둔 바이트를 못 쓴다.
        body = json.loads(gzip.decompress(main.invest_signal_result(FakeRequest()).body).decode('utf-8'))
        expected = main.datetime.fromtimestamp(os.stat(self._path).st_mtime, main.timezone.utc).isoformat()
        self.assertEqual(body['updatedAt'], expected)

    def test_missing_cache_returns_503_not_an_empty_screen(self):
        os.remove(self._path)
        main._daily_scan_cache_mem = {}
        main._daily_scan_response_cache = {}
        for route in (main.invest_signal_result, main.pattern_scan_result):
            with self.assertRaises(main.HTTPException) as ctx:
                route(FakeRequest())
            self.assertEqual(ctx.exception.status_code, 503)

    def test_cache_is_reparsed_only_when_the_file_changes(self):
        main.load_daily_scan_cache_cached()
        signature = main._daily_scan_cache_mem['signature']
        main.load_daily_scan_cache_cached()
        self.assertEqual(main._daily_scan_cache_mem['signature'], signature)

    def test_warmer_builds_the_bytes_before_a_request_arrives(self):
        # 2026-09-04 실측: 캐시 파일이 새로 쓰인 뒤 첫 /invest-signal만 18.5초였고
        # 이어진 6회는 1.0~1.1초였다. 배치 스캔이 매일 파일을 새로 쓰므로, 워머가 없으면
        # 매일 첫 사용자가 그 18.5초를 뒤집어쓴다.
        main._daily_scan_response_cache = {}
        main._warm_daily_scan_responses()
        self.assertEqual(sorted(main._daily_scan_response_cache), ['invest_signal', 'pattern_scan'])
        warmed = main._daily_scan_response_cache['invest_signal']['gzip']
        # 예열해둔 바로 그 바이트가 응답으로 나가야 의미가 있다.
        self.assertIs(main.invest_signal_result(FakeRequest()).body, warmed)

    def test_warmer_survives_a_missing_cache_file(self):
        # 배치 첫 실행 전에는 파일이 없다. 워머 스레드가 거기서 죽으면 이후 갱신을 놓친다.
        os.remove(self._path)
        main._daily_scan_cache_mem = {}
        main._daily_scan_response_cache = {}
        main._warm_daily_scan_responses()
        self.assertEqual(main._daily_scan_response_cache, {})

    def test_routes_are_public_but_rate_limited(self):
        source = open(os.path.join(CLOUD_VM_DIR, 'main.py'), encoding='utf-8').read()
        head = source.split("@app.get('/invest-signal')")[1].split("@app.get('/strategy-scan-batch')")[0]
        # 공개 라우트다(/flow-chart, /investor-flow와 같은 모델) - 대신 레이트리밋은 필수다.
        self.assertNotIn('require_api_key', head)
        self.assertIn("_check_rate_limit('invest_signal', request", head)
        self.assertIn("_check_rate_limit('pattern_scan', request", head)


if __name__ == '__main__':
    unittest.main()


class FrontendVmFirstWiringTests(unittest.TestCase):
    """프론트가 VM을 먼저 보고 GAS로 폴백하는 배선을 고정한다.

    소스 텍스트 검사인 이유는 test_ui_ia.py와 같다 - 이 저장소에는 JS 런타임 테스트
    기반이 없다. 배선이 빠지면 화면은 멀쩡히 GAS 경로로 동작해서(단지 느릴 뿐)
    회귀를 눈으로 못 잡는다.
    """

    ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def read(self, rel):
        return open(os.path.join(self.ROOT, rel), encoding='utf-8').read()

    def test_foreign_flow_tries_the_vm_before_gas(self):
        source = self.read('js/foreign-flow.js')
        self.assertIn("KIWOOM_VM_URL + '/invest-signal'", source)
        self.assertIn('return requestFromVm().catch(function () { return requestFromGas(attempt); });', source)
        # GAS 경로는 폴백으로 남아 있어야 한다 - VM이 죽으면 화면이 비면 안 된다.
        self.assertIn("var signalUrl = GAS_TICKER_URL + '?investSignal=1';", source)

    def test_pattern_scan_tries_the_vm_before_gas(self):
        source = self.read('js/pattern-scan.js')
        self.assertIn("KIWOOM_VM_URL + '/pattern-scan?_=' + stamp", source)
        self.assertIn('.catch(function () { return fetchWithRetry(scanUrl, hasPatterns); })', source)
        self.assertIn("var scanUrl = GAS_TICKER_URL + '?patternScan=1&_=' + stamp;", source)

    def test_flow_row_normalization_is_cached_per_flow(self):
        # 3,000종목대를 렌더할 때마다 다시 정규화하던 것을 응답이 바뀔 때만 하도록 바꿨다.
        source = self.read('js/foreign-flow.js')
        self.assertIn('var flowRowCache = {};', source)
        self.assertIn('if (flowRowCache[key]) return flowRowCache[key];', source)
        # 새 응답이 오면 반드시 비워야 한다 - 안 비우면 어제 스캔이 계속 보인다.
        self.assertIn('flowRowCache = {};', source.split('signalData = data;')[1][:200])
