"""Completed cards use reported disclosures, retain links, and follow the month."""
import json
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HARNESS = r"""
const fs=require('fs'),vm=require('vm');const window={};
let source=fs.readFileSync('js/stock-calendar.js','utf8').replace('global.StockCalendar = StockCalendar;', 'global.StockCalendar = StockCalendar; global.completedCards=renderCompletedDisclosures;');
vm.runInNewContext(source,{window,document:{readyState:'loading',addEventListener(){}},console,URLSearchParams,Date,Set});
const base={title:'$삼성전자 실적공시 완료',start:'2026-10-02',source:'dart',status:'reported',symbol:'005930',receipt_no:'one',link:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=one'};
const events=[base,{...base}, {...base,title:'$한화오션 잠정실적',symbol:'042660',start:'2026-10-07',receipt_no:'two',result:'매출 <100>'},
 {...base,status:'scheduled',receipt_no:'pending'}, {...base,start:'2026-09-30',receipt_no:'previous'},
 {...base,source:'finnhub',receipt_no:'us'}, {...base,status:undefined,receipt_no:'unknown'}];
console.log(JSON.stringify({html:window.completedCards({viewYear:2026,viewMonth:9,events},false),
 empty:window.completedCards({viewYear:2026,viewMonth:10,events},false),loading:window.completedCards({viewYear:2026,viewMonth:10,events:[]},true)}));
"""


class CompletedDisclosureCardsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(['node', '-e', HARNESS], cwd=ROOT, capture_output=True,
                                text=True, encoding='utf-8', check=True)
        cls.data = json.loads(result.stdout)

    def test_only_reported_domestic_disclosures_from_displayed_month_are_cards(self):
        html = self.data['html']
        self.assertEqual(html.count('<article class="sc-completed-card">'), 2)
        self.assertIn('2건', html)
        self.assertLess(html.index('2026-10-07'), html.index('2026-10-02'))
        self.assertNotIn('rcpNo=pending', html)
        self.assertNotIn('rcpNo=previous', html)

    def test_existing_stock_and_disclosure_links_and_safe_result_text_are_preserved(self):
        html = self.data['html']
        self.assertIn('data-stock-search-code="005930"', html)
        self.assertIn('data-stock-search-code="042660"', html)
        self.assertIn('https://dart.fss.or.kr/dsaf001/main.do?rcpNo=one', html)
        self.assertIn('매출 &lt;100&gt;', html)

    def test_empty_and_loading_states_do_not_show_another_months_cards(self):
        self.assertIn('2026년 11월', self.data['empty'])
        self.assertIn('표시할 완료 공시가 없어.', self.data['empty'])
        self.assertNotIn('<article', self.data['empty'])
        self.assertIn('공시를 불러오는 중이야.', self.data['loading'])
