# -*- coding: utf-8 -*-
"""자동매매 운영센터의 연구 기능 통합(2026-10-11) 계약 테스트: 연결 대기·빈 상태 문구, 백테스트 데이터 형식, 비밀 노출 금지."""
import json
import os
import re
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


class AutoTraderResearchUiTests(unittest.TestCase):
    def setUp(self):
        self.js = read('js/auto-trader.js')

    def test_research_api_is_not_requested(self):
        self.assertNotIn("api('/api/research')", self.js)

    def test_control_card_uses_server_api_not_local_pc(self):
        # 2026-11-01: 로컬 PC 봇(127.0.0.1)·접속 토큰을 걷고 사이트 서버의 관리자 세션 API만 쓴다.
        for gone in ('127.0.0.1', 'X-AutoTrader-Token', 'autotrader_token_v1', '.token', 'run.bat', 'shellDisconnected', 'data-token'):
            self.assertNotIn(gone, self.js)
        self.assertIn("controlRequest('/autotrader/status')", self.js)
        self.assertIn("controlRequest('/autotrader/command', { action: action })", self.js)
        self.assertIn("credentials: 'include'", self.js)
        self.assertIn('global.NineAPI.data(', self.js)
        self.assertNotRegex(self.js, r"\bfetch\(")      # 전송은 NineHttp/NineAPI 공통 모듈만 쓴다

    def test_control_actions_are_confirmed_and_limited(self):
        # 허용 목록: 시작·중지와 당일 신규 매수 보류/해제(서버 ACTIONS와 같아야 한다). 주문·계좌 명령은 화면에 없다.
        self.assertEqual(sorted(set(re.findall(r'data-ctl="(\w+)"', self.js))), ['hold', 'resume', 'start', 'stop'])
        for action in ('hold', 'resume'):
            self.assertIn(action + ": '", self.js.split('var CONFIRM', 1)[1].split('};', 1)[0])
        self.assertIn('global.confirm(CONFIRM[action])', self.js)
        self.assertIn('실계좌', self.js.split('var CONFIRM', 1)[1].split('};', 1)[0])
        # 시작은 서버가 허용(canStart)할 때만 누를 수 있고, 중지는 상태와 무관하게 누를 수 있다.
        self.assertIn("data-ctl=\"start\"' + (c.canStart && !busy", self.js)
        self.assertIn("data-ctl=\"stop\"' + (c.configured && !busy", self.js)

    def test_missing_values_are_shown_as_unreceived_not_zero(self):
        for text in ("미수신", "ledger.unknownOrders == null ? '미수신'", "ledger.openPositions == null ? '미수신'"):
            self.assertIn(text, self.js)

    def test_policy_does_not_claim_orders_are_active(self):
        self.assertIn('실주문 비활성', self.js)
        # 고정 문구 대신 봇이 알려 준 상태로 보여 주며, 승인·설정 전에는 '불가'가 기본이다.
        self.assertIn('불가(승인·설정 전)', self.js)
        self.assertIn('var armed = !!s.live_scheduled;', self.js)

    def test_simulated_sections_are_removed(self):
        for title in ('통합 시간순 거래 일지', 'B 일봉 사후 모의매매', 'C 장중 실시간 가상매매', 'A 검색기별 백테스트 성과'):
            self.assertNotIn(title, self.js)

    def test_no_live_switch_or_secrets_in_front_end(self):
        self.assertNotIn('LIVE_SELL=true', self.js)
        self.assertNotRegex(self.js, r"(appkey|secretkey|password)\s*[:=]\s*['\"][A-Za-z0-9]{12,}")
        self.assertNotIn('localStorage', self.js)

    def test_backtest_data_file_is_window_global_with_real_fields(self):
        text = read('data/quant-backtest.js')
        self.assertTrue(text.lstrip().startswith('/*') or text.startswith('window.QUANT_BACKTEST'))
        out = subprocess.run(['node', '-e', "global.window={};require('./data/quant-backtest.js');process.stdout.write(JSON.stringify(window.QUANT_BACKTEST))"],
                             cwd=ROOT, capture_output=True, check=True, timeout=30).stdout.decode('utf-8')
        data = json.loads(out)
        self.assertEqual(data['kind'], 'backtest')
        self.assertGreaterEqual(len(data['rows']), 20)
        for r in data['rows']:
            for key in ('scanner', 'exit', 'ret', 'mdd', 'trades', 'devRet', 'valRet'):
                self.assertIn(key, r)
        self.assertIn('실거래 매수 비활성', data['verdict'])


if __name__ == '__main__':
    unittest.main()
