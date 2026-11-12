import json
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
PUBLIC_PATHS = ['/health', '/auth/google/me', '/access-policy', '/fx-rates',
                '/fx-rates/history', '/domestic-market-indicators', '/domestic-market-indicators/chart',
                '/kofia-market', '/earnings-calendar', '/morning-briefing', '/ai-comments', '/crypto-news',
                '/foreign-news', '/domestic-news', '/naver-news', '/weekly-report', '/weekend-us-themes',
                '/domestic-disclosures']
RESTRICTED_PATHS = ['/quote', '/us-search', '/ohlc/005930', '/investor-flow/005930', '/pattern-scan',
                    '/market-board', '/order-book/005930', '/investor-trend/history', '/market-temp',
                    '/strategy-scan-batch', '/us-quote/NVDA', '/futures', '/futures/avg', '/futures/refresh-macro']


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
            self.assertEqual(allowed, {'guestbook', 'calendar', 'briefing', 'news'})  # 비로그인: 시장지표 없음
            member = {k for k, v in ap.view(True, admin)['screens'].items() if v['allowed']}
            self.assertEqual(member, {'guestbook', 'calendar', 'briefing', 'news', 'indicators'})  # 로그인 회원: 시장지표 추가
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

    def test_roles_are_independent(self):
        ap.update(None, 'a@x', roles={
            'calendar': {'guest': False, 'member': True, 'admin': False},
            'indicators': {'member': False},
        })
        self.assertFalse(ap.view(False, False)['screens']['calendar']['allowed'])
        self.assertTrue(ap.view(True, False)['screens']['calendar']['allowed'])
        self.assertFalse(ap.view(True, True)['screens']['calendar']['allowed'])
        self.assertFalse(ap.view(True, False)['screens']['indicators']['allowed'])
        self.assertTrue(ap.view(True, True)['screens']['indicators']['allowed'])
        self.assertEqual(ap.view(True, True)['screens']['calendar']['roles'],
                         {'guest': False, 'member': True, 'admin': False})
        self.assertNotIn('roles', ap.view(True, False)['screens']['calendar'])

    def test_old_state_and_api_are_compatible(self):
        with open(ap.STATE_PATH, 'w', encoding='utf-8') as f:
            json.dump({'screens': {'calendar': False, 'indicators': False}, 'revision': 8}, f)
        self.assertFalse(ap.view(False, False)['screens']['calendar']['allowed'])
        self.assertFalse(ap.view(True, False)['screens']['calendar']['allowed'])
        self.assertFalse(ap.view(True, True)['screens']['calendar']['allowed'])
        ap.update(None, 'a@x', roles={'calendar': {'member': True}})
        self.assertFalse(ap.view(False, False)['screens']['calendar']['allowed'])
        self.assertTrue(ap.view(True, False)['screens']['calendar']['allowed'])
        self.assertFalse(ap.view(True, True)['screens']['calendar']['allowed'])
        self.assertEqual(ap.load_state()['revision'], 9)
        ap.update({'calendar': True}, 'a@x')
        self.assertTrue(ap.view(False, False)['screens']['calendar']['allowed'])
        self.assertTrue(ap.view(True, True)['screens']['calendar']['allowed'])

    def test_role_ceiling_and_lock(self):
        for invalid in (
            {'home': {'guest': True}}, {'home': {'member': False}},
            {'indicators': {'guest': True}}, {'stocks': {'member': True}},
            {'calendar': {'stranger': True}}, {'calendar': {'guest': 'yes'}},
            {'calendar': {}}, {'guestbook': {'guest': False}},
            {'guestbook': {'admin': False}},
        ):
            with self.assertRaises(ValueError, msg=str(invalid)):
                ap.update(None, 'a@x', roles=invalid)
        self.assertFalse(os.path.exists(ap.STATE_PATH))

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

    def test_market_indicator_websocket_requires_admin_before_accept(self):
        src = open(MAIN, encoding='utf-8').read()
        block = src.split("async def market_indicators_socket", 1)[1].split("await websocket.accept()", 1)[0]
        self.assertIn("websocket.headers.get('origin')", block)
        self.assertIn('_access_denied(websocket)', block)
        self.assertIn('await websocket.close(code=1008)', block)

    def test_futures_prefix_does_not_restrict_other_public_routes(self):
        self.assertTrue(all(ap.is_restricted_path(p) for p in
                            ('/futures', '/futures/avg', '/futures/refresh-macro')))
        self.assertFalse(ap.is_restricted_path('/futures-public'))
        for p in ('/domestic-news', '/foreign-news', '/crypto-news', '/earnings-calendar'):
            self.assertFalse(ap.is_restricted_path(p), p)


if __name__ == '__main__':
    unittest.main()
