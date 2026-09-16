# -*- coding: utf-8 -*-
"""배포 후 /health 대기 계약(2026-09-17).

FastAPI 재시작 후 포트가 열리기까지 VM 실측 41~64초가 걸린다. 예전 구현은 "5초 타임아웃
20회"라 연결이 즉시 거부되는 구간에서 실측 25초 만에 포기했고, 그 실패가 set -e로
deploy_check.sh를 끊어 SHA가 기록되지 않았다. 결과는 5분마다 같은 커밋을 다시 배포하며
FastAPI를 재시작하는 루프였다. 대기는 횟수가 아니라 마감 시각으로 센다.
"""

import importlib.util
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULE_PATH = os.path.join(ROOT, 'scripts', 'cloud-vm', 'post_deploy_check.py')

_spec = importlib.util.spec_from_file_location('post_deploy_check', MODULE_PATH)
post_deploy_check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(post_deploy_check)


class HealthWaitTest(unittest.TestCase):
    def setUp(self):
        self.real_fetch = post_deploy_check.fetch_json
        self.real_sleep = post_deploy_check.time.sleep
        self.clock = [0.0]
        self.real_monotonic = post_deploy_check.time.monotonic
        # 실제로 기다리지 않도록 시계와 sleep을 가짜로 둔다.
        post_deploy_check.time.sleep = lambda seconds: self.clock.__setitem__(0, self.clock[0] + seconds)
        post_deploy_check.time.monotonic = lambda: self.clock[0]

    def tearDown(self):
        post_deploy_check.fetch_json = self.real_fetch
        post_deploy_check.time.sleep = self.real_sleep
        post_deploy_check.time.monotonic = self.real_monotonic

    def test_waits_through_a_60_second_startup(self):
        """VM 실측 최장 기동(64초)보다 오래 기다려야 한다."""
        calls = []

        def fake_fetch(path, api_token=None, timeout=30):
            calls.append(self.clock[0])
            if self.clock[0] < 64:
                raise OSError('Connection refused')
            return {'data': {'status': 'ok'}}

        post_deploy_check.fetch_json = fake_fetch
        waited = post_deploy_check.wait_for_health()
        self.assertGreaterEqual(waited, 64)
        self.assertLess(waited, post_deploy_check.HEALTH_WAIT_SECONDS)
        self.assertGreater(len(calls), 20, '횟수 기반으로 끊기면 기동을 못 기다린다')

    def test_default_budget_covers_measured_startup_with_margin(self):
        self.assertGreaterEqual(post_deploy_check.HEALTH_WAIT_SECONDS, 120)

    def test_gives_up_at_the_deadline_with_the_reason(self):
        def always_down(path, api_token=None, timeout=30):
            raise OSError('Connection refused')

        post_deploy_check.fetch_json = always_down
        with self.assertRaises(RuntimeError) as caught:
            post_deploy_check.wait_for_health(wait_seconds=30)
        message = str(caught.exception)
        self.assertIn('/health', message)
        self.assertIn('Connection refused', message)

    def test_not_ok_status_is_a_failure(self):
        post_deploy_check.fetch_json = lambda path, api_token=None, timeout=30: {'data': {'status': 'degraded'}}
        with self.assertRaises(RuntimeError) as caught:
            post_deploy_check.wait_for_health(wait_seconds=10)
        self.assertIn('degraded', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
