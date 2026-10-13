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

    def test_render_only_uses_real_account_sections(self):
        render = self.js.split('function render(d) {', 1)[1].split('var lastData', 1)[0]
        for call in ('journalHtml(', 'candidatesHtml(', 'liveHtml(', 'paperHtml(', 'backtestHtml(', 'engineHtml(', 'paperOverviewHtml(', 'ensureBacktest('):
            self.assertNotIn(call, render)
        self.assertIn('holdingsHtml(d.holdings)', render)
        self.assertIn('ordersHtml(d.orders)', render)

    def test_policy_does_not_claim_orders_are_active(self):
        self.assertIn('실주문 비활성', self.js)
        self.assertIn('자동매수와 새 정책의 실주문 연결은 아직 없습니다', self.js)

    def test_simulated_sections_are_removed(self):
        for title in ('통합 시간순 거래 일지', 'B 일봉 사후 모의매매', 'C 장중 실시간 가상매매', 'A 검색기별 백테스트 성과'):
            self.assertNotIn(title, self.js)

    def test_no_live_switch_or_secrets_in_front_end(self):
        self.assertNotIn('LIVE_SELL=true', self.js)
        self.assertNotRegex(self.js, r"(appkey|secretkey|password)\s*[:=]\s*['\"][A-Za-z0-9]{12,}")
        # 토큰은 기존대로 localStorage 한 곳(사용자가 붙여 넣은 로컬 봇 접속 토큰)만 쓴다
        self.assertEqual(len(re.findall(r'localStorage\.(?:setItem|getItem|removeItem)', self.js)), 3)

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
