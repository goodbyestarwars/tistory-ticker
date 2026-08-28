# -*- coding: utf-8 -*-
import datetime
import os
import re
import sys
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CLOUD_VM_DIR = os.path.join(REPO_ROOT, 'scripts', 'cloud-vm')
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import research_reports  # noqa: E402


SAMPLE_HTML = '''
<table>
  <tr>
    <td><a href="/item/main.naver?code=005930" class="stock_item">삼성전자</a></td>
    <td><a href="company_read.naver?nid=95868&page=1&searchType=itemCode&itemCode=005930">공포가 클수록 중심을 잡자</a></td>
    <td>미래에셋증권</td>
    <td><a href="https://stock.pstatic.net/stock-research/company/56/report.pdf"><img alt="pdf"></a></td>
    <td>26.08.26</td><td>29978</td>
  </tr>
  <tr>
    <td><a href="/item/main.naver?code=005930">삼성전자</a></td>
    <td><a href="company_read.naver?nid=1">기간 밖 리포트</a></td>
    <td>테스트증권</td><td></td><td>26.04.01</td><td>1</td>
  </tr>
</table>
'''


class ResearchReportParserTests(unittest.TestCase):
    def test_extracts_broker_date_and_original_pdf_within_lookback(self):
        today = datetime.datetime(2026, 8, 28, tzinfo=research_reports.KST)
        rows = research_reports.parse_research_list(SAMPLE_HTML, today=today)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['title'], '공포가 클수록 중심을 잡자')
        self.assertEqual(rows[0]['broker'], '미래에셋증권')
        self.assertEqual(rows[0]['date'], '2026-08-26')
        self.assertEqual(rows[0]['pdfUrl'], 'https://stock.pstatic.net/stock-research/company/56/report.pdf')
        self.assertTrue(rows[0]['detailUrl'].startswith('https://finance.naver.com/research/company_read.naver'))


class StockAnalysisUiContractTests(unittest.TestCase):
    def test_opinion_evidence_is_lazy_and_etf_uses_component_api(self):
        with open(os.path.join(REPO_ROOT, 'js', 'foreign-flow.js'), encoding='utf-8') as handle:
            source = handle.read()
        self.assertIn("'/research-reports/'", source)
        self.assertIn('wireOpinionEvidence(box, data.code)', source)
        self.assertIn('KIS 원응답에는 날짜·투자의견·목표가만 있고', source)
        self.assertIn("'/etf-components/'", source)
        self.assertRegex(source, r'selectedIsEtf\s*\?\s*Promise\.resolve\(null\)')
        self.assertIn('주요 편입종목', source)


if __name__ == '__main__':
    unittest.main()
