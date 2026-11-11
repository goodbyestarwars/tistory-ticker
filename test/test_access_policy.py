import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
os.environ['ACCESS_POLICY_PATH'] = os.path.join(tempfile.mkdtemp(), 'policy.json')

import access_policy as ap  # noqa: E402

MAIN = os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm', 'main.py')
# 공개 4개 화면과 인증/건강 확인이 쓰는 경로는 제한 대상이 아니어야 한다.
PUBLIC_PATHS = ['/health', '/auth/google/me', '/access-policy', '/futures', '/futures/avg', '/fx-rates',
                '/fx-rates/history', '/domestic-market-indicators', '/domestic-market-indicators/chart',
                '/kofia-market', '/earnings-calendar', '/morning-briefing', '/ai-comments', '/crypto-news',
                '/foreign-news', '/domestic-news', '/naver-news', '/weekly-report', '/weekend-us-themes',
                '/domestic-disclosures']
RESTRICTED_PATHS = ['/quote', '/us-search', '/ohlc/005930', '/investor-flow/005930', '/pattern-scan',
                    '/market-board', '/order-book/005930', '/investor-trend/history', '/market-temp',
                    '/strategy-scan-batch', '/us-quote/NVDA']


class PolicyTests(unittest.TestCase):
    def setUp(self):
        if os.path.exists(ap.STATE_PATH):
            os.remove(ap.STATE_PATH)

    def test_path_classification(self):
        for p in PUBLIC_PATHS:
            self.assertFalse(ap.is_restricted_path(p), p)
        for p in RESTRICTED_PATHS:
            self.assertTrue(ap.is_restricted_path(p), p)
        self.assertFalse(ap.is_restricted_path('/quotes-other'))  # 접두사 문자열 우회/오탐 없음

    def test_anonymous_three_member_four_screens(self):
        for admin in (False,):
            allowed = {k for k, v in ap.view(False, admin)['screens'].items() if v['allowed']}
            self.assertEqual(allowed, {'guestbook', 'calendar', 'briefing'})  # 비로그인: 시장지표 없음
            member = {k for k, v in ap.view(True, admin)['screens'].items() if v['allowed']}
            self.assertEqual(member, {'guestbook', 'calendar', 'briefing', 'indicators'})  # 로그인 회원: 시장지표 추가
        allowed = {k for k, v in ap.view(True, True)['screens'].items() if v['allowed']}
        self.assertEqual(allowed, set(ap.SCREENS))

    def test_toggle_persists_and_cannot_widen_public(self):
        ap.update({'calendar': False, 'home': False}, 'a@x')
        v = ap.view(False, False)['screens']
        self.assertFalse(v['calendar']['allowed'])
        self.assertTrue(ap.view(True, True)['screens']['stocks']['allowed'])
        self.assertFalse(ap.view(True, True)['screens']['home']['allowed'])
        ap.update({'home': True}, 'a@x')
        # 관리자 전용 화면을 켜도 비로그인에게는 열리지 않는다.
        self.assertFalse(ap.view(False, False)['screens']['home']['allowed'])
        self.assertEqual(ap.load_state()['revision'], 2)

    def test_validation_and_lock(self):
        for bad in ({}, {'nope': True}, {'calendar': 'x'}, {'guestbook': False}, None):
            with self.assertRaises(ValueError):
                ap.update(bad, 'a@x')
        self.assertFalse(os.path.exists(ap.STATE_PATH))

    def test_corrupt_file_falls_back_to_default(self):
        with open(ap.STATE_PATH, 'w') as f:
            f.write('{broken')
        self.assertTrue(all(ap.load_state()['screens'].values()))

    def test_write_failure_keeps_previous_policy(self):
        ap.update({'calendar': False}, 'a@x')
        real = ap.snapshot_io.atomic_json
        ap.snapshot_io.atomic_json = lambda *a, **k: (_ for _ in ()).throw(OSError('disk'))
        try:
            with self.assertRaises(OSError):
                ap.update({'calendar': True}, 'a@x')
        finally:
            ap.snapshot_io.atomic_json = real
        self.assertFalse(ap.load_state()['screens']['calendar'])

    def test_every_stock_route_is_gated_or_explicitly_public(self):
        """main.py의 GET 라우트가 추가될 때 분류 누락을 잡는다: 종목/시세 성격 경로는 제한 목록에 있어야 한다."""
        src = open(MAIN, encoding='utf-8').read()
        routes = re.findall(r"@app\.(?:get|put|post|delete)\('(/[^'{]*)", src)
        stock_like = re.compile(r'^/(quote|us-|ohlc|flow-chart|pbar|etf-components|investor|foreign-flow|fundamentals|'
                                r'pattern|strategy|order-book|stock-members|market-board|market-rank|week52)')
        for r in routes:
            r = r.rstrip('/')
            if stock_like.match(r):
                self.assertTrue(ap.is_restricted_path(r), r)

    def test_websocket_quotes_guard_present(self):
        src = open(MAIN, encoding='utf-8').read()
        block = src.split("async def realtime_quote_socket", 1)[1].split("await websocket.accept()", 1)[0]
        self.assertIn('_access_denied(websocket)', block)


if __name__ == '__main__':
    unittest.main()
