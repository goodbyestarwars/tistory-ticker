# -*- coding: utf-8 -*-
"""메인페이지 VI·사이드카 배지 계약(2026-09-15 작업지시서)."""

import os
import sys
import unittest
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD_VM = os.path.join(ROOT, 'scripts', 'cloud-vm')
sys.path.insert(0, CLOUD_VM)

import circuit_breaker as cb  # noqa: E402

KST = cb.KST


def kst(y, mo, d, h, mi, s=0):
    return datetime(y, mo, d, h, mi, s, tzinfo=KST)


# KIS inquire-vi-status output 모양(공식 예제 컬럼)
OUTPUT = [
    {'hts_kor_isnm': '에코프로비엠', 'mksc_shrn_iscd': '247540', 'vi_cls_code': 'Y', 'bsop_date': '20260915',
     'cntg_vi_hour': '143200', 'vi_cncl_hour': '', 'vi_kind_code': '2', 'vi_prc': '150000', 'vi_count': '1'},
    {'hts_kor_isnm': 'HLB', 'mksc_shrn_iscd': '028300', 'vi_cls_code': 'N', 'bsop_date': '20260915',
     'cntg_vi_hour': '142500', 'vi_cncl_hour': '142700', 'vi_kind_code': '1', 'vi_prc': '90000', 'vi_count': '2'},
    {'hts_kor_isnm': '오래전해제', 'mksc_shrn_iscd': '000001', 'vi_cls_code': 'N', 'bsop_date': '20260915',
     'cntg_vi_hour': '100000', 'vi_cncl_hour': '100200', 'vi_kind_code': '1', 'vi_prc': '1000', 'vi_count': '1'},
    {'hts_kor_isnm': '시간없음', 'mksc_shrn_iscd': '000002', 'cntg_vi_hour': ''},
]


class ParseAndPayloadTests(unittest.TestCase):
    def test_active_and_recently_released_are_listed_newest_first(self):
        rows = cb.parse_rows(OUTPUT, '20260915')
        self.assertEqual(len(rows), 3)   # 발동시각 없는 행은 버린다
        payload = cb.build_payload(rows, kst(2026, 9, 15, 14, 30))
        self.assertEqual(payload['vi_active_count'], 1)
        self.assertEqual([r['name'] for r in payload['vi_list']], ['에코프로비엠', 'HLB'])  # 10:02 해제는 5분 지나 제외
        self.assertEqual(payload['vi_list'][0]['status'], 'active')
        self.assertEqual(payload['vi_list'][0]['triggered_at'], '2026-09-15T14:32:00+09:00')
        self.assertIsNone(payload['vi_list'][0]['released_at'])
        self.assertEqual(payload['vi_list'][1]['status'], 'released')
        self.assertEqual(payload['vi_list'][1]['released_at'], '2026-09-15T14:27:00+09:00')

    def test_released_item_drops_after_five_minutes(self):
        rows = cb.parse_rows(OUTPUT, '20260915')
        payload = cb.build_payload(rows, kst(2026, 9, 15, 14, 32, 1))
        self.assertEqual([r['name'] for r in payload['vi_list']], ['에코프로비엠'])

    def test_list_is_capped_at_ten(self):
        output = [{'hts_kor_isnm': 'S%d' % i, 'mksc_shrn_iscd': '%06d' % i, 'bsop_date': '20260915',
                   'cntg_vi_hour': '09%02d00' % i, 'vi_cncl_hour': ''} for i in range(15)]
        payload = cb.build_payload(cb.parse_rows(output, '20260915'), kst(2026, 9, 15, 10, 0))
        self.assertEqual(payload['vi_active_count'], 15)
        self.assertEqual(len(payload['vi_list']), 10)
        self.assertEqual(payload['vi_list'][0]['name'], 'S14')

    def test_sidecar_is_hidden_until_a_verified_source_exists(self):
        payload = cb.build_payload([], kst(2026, 9, 15, 10, 0))
        self.assertEqual(set(payload['sidecar']), {'available', 'active', 'market', 'triggered_at', 'note'})
        self.assertFalse(payload['sidecar']['available'])
        self.assertFalse(payload['sidecar']['active'])


class PollingTests(unittest.TestCase):
    def setUp(self):
        with cb._lock:
            cb._state.update({'date': None, 'rows': [], 'fetchedAt': None, 'error': None})

    def test_poll_window_is_regular_session_and_after_market_only(self):
        self.assertFalse(cb.in_poll_window(kst(2026, 9, 15, 8, 54)))
        self.assertTrue(cb.in_poll_window(kst(2026, 9, 15, 9, 0)))
        self.assertTrue(cb.in_poll_window(kst(2026, 9, 15, 15, 35)))
        self.assertFalse(cb.in_poll_window(kst(2026, 9, 15, 15, 45)))
        self.assertTrue(cb.in_poll_window(kst(2026, 9, 15, 19, 0)))
        self.assertFalse(cb.in_poll_window(kst(2026, 9, 15, 20, 6)))
        self.assertFalse(cb.in_poll_window(kst(2026, 9, 19, 10, 0)))   # 토요일
        self.assertFalse(cb.in_poll_window(kst(2026, 9, 24, 10, 0)))   # 추석 연휴

    def test_refresh_uses_kis_vi_status_request_and_caches(self):
        calls = []

        def getter(path, tr_id, params):
            calls.append((path, tr_id, dict(params)))
            return {'output': OUTPUT}
        rows = cb.refresh_once('k', 's', kst(2026, 9, 15, 14, 30), getter=getter)
        self.assertEqual(len(rows), 3)
        path, tr_id, params = calls[0]
        self.assertEqual((path, tr_id), (cb.VI_PATH, 'FHPST01390000'))
        self.assertEqual(params['FID_COND_SCR_DIV_CODE'], '20139')
        self.assertEqual(params['FID_INPUT_DATE_1'], '20260915')
        payload = cb.get_payload(kst(2026, 9, 15, 14, 30))
        self.assertEqual(payload['vi_active_count'], 1)
        self.assertEqual(payload['fetchedAt'], '2026-09-15T14:30:00+09:00')

    def test_failure_keeps_last_list_and_reports_error(self):
        cb.refresh_once('k', 's', kst(2026, 9, 15, 14, 30), getter=lambda *a: {'output': OUTPUT})

        def boom(*a):
            raise RuntimeError('KIS 500')
        self.assertIsNone(cb.refresh_once('k', 's', kst(2026, 9, 15, 14, 31), getter=boom))
        payload = cb.get_payload(kst(2026, 9, 15, 14, 31))
        self.assertEqual(payload['vi_active_count'], 1)
        self.assertIn('KIS 500', payload['error'])

    def test_new_day_starts_empty(self):
        cb.refresh_once('k', 's', kst(2026, 9, 15, 14, 30), getter=lambda *a: {'output': OUTPUT})
        self.assertEqual(cb.get_payload(kst(2026, 9, 16, 8, 0))['vi_list'], [])


class WiringTests(unittest.TestCase):
    def read(self, *parts):
        with open(os.path.join(ROOT, *parts), encoding='utf-8') as handle:
            return handle.read()

    def test_single_server_poll_and_cache_endpoint(self):
        main = self.read('scripts', 'cloud-vm', 'main.py')
        self.assertIn("@app.get('/api/circuit-breaker')", main)
        self.assertIn('circuit_breaker.get_payload()', main)
        self.assertIn('circuit_breaker.start_background(kis_appkey, kis_appsecret)', main)
        # 별도 프로세스·타이머를 두지 않는다.
        self.assertNotIn('circuit', self.read('scripts', 'cloud-vm', 'deploy_check.sh'))

    def test_front_polls_only_the_cache_endpoint(self):
        js = self.read('js', 'skin-main.js')
        self.assertIn("'https://goodbyestar.cloud/api/circuit-breaker'", js)
        self.assertNotIn('inquire-vi-status', js)   # 브라우저가 증권사 API를 직접 부르지 않는다
        self.assertIn('data-home-cb-sidecar', js)
        self.assertIn('data-home-cb-vi', js)
        self.assertIn('data-home-cb-dropdown', js)
        # 드롭다운은 실제 헤더 바로 아래에 붙여 VI 버튼을 가리지 않는다(고정 top이 버튼을 덮었던 라이브 확인).
        self.assertIn("dropdown.style.top = (heading.offsetTop + heading.offsetHeight + 6) + 'px';", js)


if __name__ == '__main__':
    unittest.main()
