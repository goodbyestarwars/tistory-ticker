import sys, pathlib, unittest
from unittest.mock import patch
from datetime import datetime, timezone
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts/cloud-vm'))
import fundamentals as f
import story_disclosures as events

class StoryEvidenceTests(unittest.TestCase):
    def rows(self, year, report):
        quarter={'11013':1,'11012':2,'11014':3,'11011':4}[report]
        items=[]
        for key,label in [('ifrs-full_Revenue','매출액'),('dart_OperatingIncomeLoss','영업이익'),('ifrs-full_ProfitLoss','당기순이익')]:
            items.append(dict(account_id=key,account_nm=label,sj_div='IS',rcept_no=str(year)+'0814000001',thstrm_amount='400' if quarter==4 else '100',thstrm_add_amount='300'))
        return items
    def test_eight_contiguous_standalone_quarters_q4_annual_minus_ytd(self):
        with patch.object(f.time,'sleep'),patch.object(f.dart_client,'call_fnltt',side_effect=lambda key,corp,year,report,fs:self.rows(year,report)),patch.object(f.dart_client,'call_stock_totqy',return_value=[{'se':'보통주','istc_totqy':'1000'}]):
            q=f.fetch_quarter_history('key','corp',{'year':2026,'reprt_code':'11012','fs_div':'CFS'})
        self.assertEqual(len(q),8)
        self.assertEqual(q[0]['period_end'],'2024-09-30')
        self.assertEqual(q[-1]['period_end'],'2026-06-30')
        self.assertEqual([r['operating_income'] for r in q],[100]*8)
        self.assertTrue(all(r['ordinary_shares']==1000 for r in q))
        self.assertTrue(all(r['net_income_parent'] is None for r in q))
    def test_no_statement_basis_no_requests(self):
        with patch.object(f.dart_client,'call_fnltt') as api:
            self.assertEqual(f.fetch_quarter_history('key','corp',{'fs_div':None}),[])
        api.assert_not_called()
    def cb(self):
        return dict(rcept_no='20261102000001',cv_prc='10,000',cvisstk_cnt='100,000',cvisstk_tisstk_vs='2.5',cvrqpd_bgd='2027년 11월 02일',cvrqpd_edd='2030.11.02',bd_tm='3')
    def test_official_cb_fields_missing_values_and_par_value_rejected(self):
        item=events.normalize(self.cb(),'cvbdIsDecsn','CB')
        self.assertEqual((item['price'],item['shares_pct'],item['start_date']),(10000,2.5,'2027-11-02'))
        self.assertIsNone(events.normalize(dict(self.cb(),cv_prc='-'),'cvbdIsDecsn','CB'))
        self.assertIsNone(events.normalize({'rcept_no':'20261102000001','fv_ps':'500'},'piicDecsn','유상증자'))
    def test_event_receipt_matching_cache_and_budget_friendly_noop(self):
        now=datetime(2026,11,2,tzinfo=timezone.utc)
        report={'rcept_no':'20261102000001','report_nm':'주요사항보고서(전환사채권발행결정)'}
        with patch.object(events.time,'sleep'),patch.object(events.dart_client,'call_material_disclosures',return_value=[report]),patch.object(events.dart_client,'call_structured_event',return_value=[self.cb()]) as api:
            cache=events.refresh('key','corp',{},now)
            self.assertEqual(cache['status'],'ok');self.assertEqual(len(cache['items']),1)
            entry={'potential_supply':cache}
            self.assertEqual(events.refresh('key','corp',entry,now),cache)
            api.assert_called_once()
    def test_pending_structure_is_not_acknowledged_or_zero_filled(self):
        now=datetime(2026,11,2,tzinfo=timezone.utc)
        with patch.object(events.time,'sleep'),patch.object(events.dart_client,'call_material_disclosures',return_value=[{'rcept_no':'20261102000001','report_nm':'전환사채권발행결정'}]),patch.object(events.dart_client,'call_structured_event',return_value=[]):
            cache=events.refresh('key','corp',{},now)
        self.assertEqual(cache['status'],'pending');self.assertEqual(cache['receipts'],[]);self.assertEqual(cache['items'],[])
if __name__=='__main__':unittest.main()
