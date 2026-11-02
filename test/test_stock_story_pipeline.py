import copy
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import build_stock_stories as pipeline


class StoryPipelineTests(unittest.TestCase):
    def setUp(self):
        self.filing = dict(year=2026, month=6, reprt_code='11012', rcept_no='20260814000001', rcept_dt='20260814')
        self.rows = [dict(rcept_no=self.filing['rcept_no'], fs_div='CFS', sj_div='IS', account_id=account,
                          thstrm_amount=str(cur), frmtrm_q_amount=str(prior),
                          thstrm_add_amount=str(cur*2), frmtrm_add_amount=str(prior*2))
                     for account, cur, prior in [('ifrs-full_Revenue', 100000000000, 90000000000),
                                                 ('dart_OperatingIncomeLoss', 20000000000, -10000000000),
                                                 ('ifrs-full_ProfitLoss', -1000000000, 1000000000)]]

    def test_whole_market_rank_combines_both_markets_and_not_sector_subset(self):
        codes = [f'{i:06}' for i in range(1, 2501)]
        master = dict(stocks={c:c for c in codes}, markets={c:'KOSPI' if i%2 else 'KOSDAQ' for i,c in enumerate(codes)},
                      marketCaps={c:i+1 for i,c in enumerate(codes)}, source='KIS', generatedAt='2026-11-02')
        result = pipeline.select_members(master)
        self.assertEqual(len(result['members']), 100)
        self.assertEqual(result['members']['002500']['rank'], 1)
        self.assertEqual({m['market'] for m in result['members'].values()}, {'KOSPI','KOSDAQ'})
        master['marketCaps'] = {c:1 for c in codes[:238]}
        with self.assertRaises(ValueError):
            pipeline.select_members(master)

    def test_verified_quarter_ytd_loss_transitions_and_original_receipt(self):
        cards = pipeline.financial_cards(self.rows, self.filing)
        self.assertEqual(len(cards), 3)
        self.assertEqual(cards[0]['periodBasis'], 'standalone_3m')
        self.assertEqual(cards[2]['periodBasis'], 'dart_ytd_reported')
        self.assertEqual(cards[1]['pair'][1]['v'], '흑자 전환')
        self.assertEqual(cards[1]['pair'][2]['v'], '적자 전환')
        self.assertTrue(all(c['asOf']=='2026-08-14' for c in cards))
        rows = copy.deepcopy(self.rows)
        for r in rows:
            r['rcept_no'] = '20260515000001'
        with self.assertRaises(pipeline.DisclosurePending):
            pipeline.financial_cards(rows, self.filing)

    def test_missing_metrics_do_not_become_zero(self):
        rows = copy.deepcopy(self.rows)
        rows[1]['thstrm_amount'] = ''
        cards = pipeline.financial_cards(rows, self.filing)
        self.assertFalse(any(p['k']=='영업이익' for p in cards[0]['pair']))
        self.assertEqual(pipeline.won(None), None)

    def test_noop_review_does_not_change_written_date_or_publish(self):
        member = {'name':'삼성전자'}
        cards = pipeline.financial_cards(self.rows, self.filing)
        story = pipeline.compose_story(None, member, cards, self.filing, '2026-11-02')
        reviewed = pipeline.compose_story(story, member, cards, self.filing, '2026-11-16')
        self.assertEqual(story, reviewed)
        with tempfile.TemporaryDirectory() as d, patch.object(pipeline,'OUT',Path(d)):
            self.assertTrue(pipeline.publish_story('005930', story))
            before = (Path(d)/'005930.js').stat().st_mtime_ns
            self.assertFalse(pipeline.publish_story('005930', reviewed))
            self.assertEqual((Path(d)/'005930.js').stat().st_mtime_ns, before)
            self.assertEqual(pipeline.load_story('005930'), story)

    def test_new_periodic_event_replaces_earnings_but_keeps_other_dated_editorial(self):
        old = dict(name='회사',asOf='2026-05-01',written='2026-05-01', cards=[
            dict(topic='earnings', title='old',sub='old',src='old',asOf='2026-05-01'),
            dict(topic='position', title='position',sub='old',src='old',asOf='2026-05-01')])
        result=pipeline.compose_story(old,{'name':'회사'},pipeline.financial_cards(self.rows,self.filing),self.filing,'2026-11-02')
        self.assertFalse(any(c['title']=='old' for c in result['cards']))
        self.assertEqual(result['cards'][-1]['asOf'],'2026-05-01')
        self.assertEqual(result['asOf'],'2026-08-14')

    def test_older_periodic_data_does_not_overwrite_newer_editorial_or_expired_badge(self):
        old=dict(name='회사',asOf='2026-10-30',written='2026-11-01',cards=[dict(topic='earnings',title='new',sub='new',src='new',asOf='2026-10-30',badge={'expiresAt':'2026-11-01'})])
        result=pipeline.compose_story(old,{'name':'회사'},pipeline.financial_cards(self.rows,self.filing),self.filing,'2026-11-02')
        self.assertEqual(result['cards'][0]['title'],'new')
        self.assertNotIn('badge',result['cards'][0])
        self.assertIn('badge',old['cards'][0], 'does not mutate source')

    def test_watcher_resumes_pages_and_keeps_event_pending_until_applied(self):
        state={}
        payload={'status':'000','total_page':2,'list':[dict(stock_code='005930',report_nm='반기보고서 (2026.06)',rcept_no='20260814000001',rcept_dt='20260814')]}
        with patch.object(pipeline.dart_client,'_fetch',return_value=json.dumps(payload).encode()):
            pipeline.watch_disclosures('secret',{'005930':{}},state,'2026-11-02',max_pages=1)
        self.assertEqual(state['watch']['page'],2)
        self.assertEqual(state['pending']['005930'],'20260814000001')
        self.assertNotIn('observed',state)
        state['observed']={'005930':'20260814000001'}
        state['pending']={}
        with patch.object(pipeline.dart_client,'_fetch',return_value=json.dumps(payload).encode()):
            pipeline.watch_disclosures('secret',{'005930':{}},state,'2026-11-02',max_pages=1)
        self.assertEqual(state['pending'],{})

    def test_budget_stops_before_provider_call(self):
        state={}
        with patch.object(pipeline.dart_client,'_fetch',return_value=b'ok') as request, patch.object(pipeline.time,'sleep'):
            original,_=pipeline.install_budget(state,1,10)
            try:
                self.assertEqual(pipeline.dart_client._fetch('https://example.test'),b'ok')
                with self.assertRaises(pipeline.BudgetExceeded):
                    pipeline.dart_client._fetch('https://example.test')
                self.assertEqual(request.call_count,1)
            finally:
                pipeline.dart_client._fetch=original


if __name__ == '__main__':
    unittest.main()
