# -*- coding: utf-8 -*-
import os
import sys
import tempfile
import unittest
from unittest import mock

CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import latency_monitor  # noqa: E402


class FakeResponse:
    def __init__(self, status, body=b'{}'):
        self.status = status
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class CheckOneTests(unittest.TestCase):
    """2026-08-03: VM 장애 진단 때 사용자가 매번 SSH로 curl -w 재던 걸 자동화 - 로컬
    엔드포인트 응답시간을 재는 핵심 함수가 정상/에러 응답 모두 크래시 없이 처리하는지 검증."""

    def test_returns_status_and_elapsed_on_success(self):
        with mock.patch.object(latency_monitor.urllib.request, 'urlopen', return_value=FakeResponse(200)):
            elapsed, status = latency_monitor.check_one('/health', {})
        self.assertEqual(status, 200)
        self.assertGreaterEqual(elapsed, 0)

    def test_returns_http_error_code_without_raising(self):
        err = latency_monitor.urllib.error.HTTPError('url', 503, 'Service Unavailable', {}, None)
        with mock.patch.object(latency_monitor.urllib.request, 'urlopen', side_effect=err):
            elapsed, status = latency_monitor.check_one('/futures', {})
        self.assertEqual(status, 503)
        self.assertGreaterEqual(elapsed, 0)

    def test_returns_err_marker_on_timeout_without_raising(self):
        with mock.patch.object(latency_monitor.urllib.request, 'urlopen', side_effect=TimeoutError('timed out')):
            elapsed, status = latency_monitor.check_one('/market-rank', {})
        self.assertEqual(status, 'ERR:TimeoutError')
        self.assertGreaterEqual(elapsed, 0)

    def test_builds_url_with_query_params(self):
        url = latency_monitor._build_url('/foreign-flow/005930', {'days': '20'})
        self.assertEqual(url, 'http://localhost:8080/foreign-flow/005930?days=20')

    def test_builds_url_without_params(self):
        url = latency_monitor._build_url('/market-rank', {})
        self.assertEqual(url, 'http://localhost:8080/market-rank')


class RunOnceTests(unittest.TestCase):
    def test_run_once_produces_one_line_per_endpoint(self):
        with mock.patch.object(latency_monitor.urllib.request, 'urlopen', return_value=FakeResponse(200)):
            lines = latency_monitor.run_once()
        self.assertEqual(len(lines), len(latency_monitor._endpoints()))
        for line in lines:
            self.assertIn('200', line)

    def test_foreign_flow_days_rotates_through_allowed_options(self):
        for _ in range(20):
            days = latency_monitor._foreign_flow_days_for_now()
            self.assertIn(days, latency_monitor.FOREIGN_FLOW_DAY_OPTIONS)


class TrimLogTests(unittest.TestCase):
    def test_trim_log_keeps_only_the_most_recent_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'latency_monitor.log')
            with open(path, 'w', encoding='utf-8') as f:
                for i in range(20):
                    f.write('line-%d\n' % i)
            with mock.patch.object(latency_monitor, 'MAX_LOG_LINES', 5):
                latency_monitor._trim_log(path)
            with open(path, 'r', encoding='utf-8') as f:
                remaining = f.readlines()
        self.assertEqual(len(remaining), 5)
        self.assertEqual(remaining[0].strip(), 'line-15')
        self.assertEqual(remaining[-1].strip(), 'line-19')

    def test_trim_log_is_noop_when_file_missing(self):
        latency_monitor._trim_log('/nonexistent/path/latency_monitor.log')  # 예외 없이 조용히 반환


if __name__ == '__main__':
    unittest.main()


class BuildUrlEncodingTest(unittest.TestCase):
    """쿼리 퍼센트 인코딩(2026-09-08).

    `name=삼성전자`를 그대로 붙이고 있어서 `/investor-flow`가 5분마다
    `ERR:UnicodeEncodeError`로 실패했다 - 0.000초, 즉 요청을 보내기도 전에 urlopen이
    URL을 ASCII로 인코딩하려다 터진 것이라 이 엔드포인트는 도입 이후 한 번도 측정된 적이
    없었다.
    """

    def test_non_ascii_query_is_percent_encoded(self):
        url = latency_monitor._build_url('/investor-flow/005930', {'name': '삼성전자'})
        self.assertIn('name=%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90', url)
        url.encode('ascii')   # urlopen이 하는 일 - 여기서 터지면 안 된다

    def test_url_without_params_is_untouched(self):
        self.assertTrue(latency_monitor._build_url('/futures', {}).endswith('/futures'))

    def test_news_endpoints_are_watched(self):
        """뉴스가 멈췄을 때 /health/latency만으로 원인을 좁힐 수 있어야 한다."""
        paths = [path for path, _ in latency_monitor._endpoints()]
        self.assertIn('/domestic-news', paths)
        self.assertIn('/foreign-news', paths)
        params = dict(latency_monitor._endpoints())
        # 화면이 실제로 부르는 건수와 같아야 체감과 같은 숫자가 나온다.
        self.assertEqual('25', params['/domestic-news']['limit'])
        self.assertEqual('25', params['/foreign-news']['limit'])
