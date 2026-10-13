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

    def test_research_api_is_optional_and_does_not_block_the_page(self):
        self.assertIn("api('/api/research').catch(", self.js)
        self.assertIn('연결 대기', self.js)
        self.assertIn('연구 작업이 아직 실행되지 않았습니다', self.js)

    def test_all_research_sections_exist_with_empty_states(self):
        for title in ('연구 엔진', '연구 후보', 'B 일봉 사후 모의매매', 'A 검색기별 백테스트 성과', 'C 장중 실시간 가상매매'):
            self.assertIn('<h3>%s</h3>' % title, self.js)
        for empty in ('아직 생성된 연구 후보가 없습니다', '아직 모의 진입 기록이 없습니다', '백테스트 요약을 불러오지 못했습니다', 'live_paper_job'):
            self.assertIn(empty, self.js)

    def test_backtest_paper_and_live_are_kept_apart(self):
        self.assertIn('B·C 모의매매·실거래 성과 아님', self.js)         # A 백테스트
        self.assertIn('A·C와 합산하지 않음', self.js)                  # B 일봉 사후
        self.assertIn('A·B와 합산하지 않음', self.js)                  # C 장중 실시간(가상 체결)
        self.assertIn('실제 체결·주문 아님', self.js)
        self.assertIn('r.livePaper', self.js)
        self.assertIn('disk', self.js.lower())
        self.assertIn('r.diskUsedBytes != null', self.js)   # 실제 값이 있을 때만 디스크 사용량 표시

    def test_chronological_journal_marks_unknown_daily_fields(self):
        self.assertIn('통합 시간순 거래 일지', self.js)
        self.assertIn('rows.sort(function (a, b)', self.js)
        self.assertIn('시각 미기록', self.js)
        self.assertIn('거래 직후 잔고', self.js)
        self.assertIn('청산 조건 미충족', self.js)

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
