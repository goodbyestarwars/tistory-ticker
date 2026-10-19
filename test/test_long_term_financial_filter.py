import sys,unittest,copy
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/cloud-vm'))
import fundamentals as f
import pattern_detect as p
NOW=datetime(2026,10,19,tzinfo=timezone.utc)
def entry():
 return {'annual':{'years':[{'year':2025,'operating_income':100,'net_income':80,'roe_pct':12,'debt_ratio_pct':50,'operating_income_yoy_pct':20,'rcept_no':'20260320000001'}]},'screening':{'version':1,'checked_at':NOW.isoformat(),'filing':{'year':2026,'reprt_code':'11012','rcept_no':'20260814000001','rcept_dt':'20260814'},'standalone':{'basis':'dart_thstrm_amount_3m','operating_income':30,'net_income':20}}}
def item():return {'code':'005930','price':5000,'longTermLiquidity':{'market_cap_eok':3000,'avg20_value_eok':30},'patternDetail':{}}
class FinancialGateTest(unittest.TestCase):
 def test_profitable_boundary_pass(self):self.assertTrue(p.long_term_financial_check(item(),entry(),now=NOW)['passed'])
 def test_losses_missing_stale_fail(self):
  for field in ['operating_income','net_income']:
   e=entry();e['annual']['years'][0][field]=0;self.assertIn('ANNUAL_LOSS',p.long_term_financial_check(item(),e,now=NOW)['reasons'])
   e=entry();e['screening']['standalone'][field]=-1;self.assertIn('QUARTER_LOSS',p.long_term_financial_check(item(),e,now=NOW)['reasons'])
  self.assertFalse(p.long_term_financial_check(item(),None,now=NOW)['passed'])
  e=entry();e['screening']['checked_at']='2026-10-01T00:00:00+00:00';self.assertIn('DISCLOSURE_STALE',p.long_term_financial_check(item(),e,now=NOW)['reasons'])
 def test_new_timestamp_cannot_refresh_old_report(self):
  e=entry();e['screening']['filing'].update(year=2025,reprt_code='11014');self.assertFalse(p.long_term_financial_check(item(),e,now=NOW)['passed'])
 def test_nan_and_low_or_unknown_market_data_fail(self):
  for change in [{'price':4999},{'price':float('nan')},{'longTermLiquidity':{}},{'longTermLiquidity':{'market_cap_eok':2999,'avg20_value_eok':30}},{'longTermLiquidity':{'market_cap_eok':3000,'avg20_value_eok':29.99}}]:
   it=item();it.update(change);self.assertFalse(p.long_term_financial_check(it,entry(),now=NOW)['passed'])
 def test_legacy_bucket_untouched_and_reason_counts(self):
  raw=[item(),dict(item(),code='000660')];before=copy.deepcopy(raw);groups={'maCloudBreakout':raw}
  summary=p.apply_long_term_filter(groups,{'005930':entry()},now=NOW)
  self.assertEqual(groups['maCloudBreakout'],before);self.assertEqual(len(groups['longTermQuality']),1);self.assertEqual(summary['excluded'],1);self.assertEqual(summary['reasonCounts']['FINANCIAL_MISSING'],1)
 def test_new_filing_pending_no_fallback(self):
  reports=[{'report_nm':'반기보고서 (2026.06)','rcept_dt':'20260814','rcept_no':'20260814000002'}]
  q={'year':2026,'reprt_code':'11012','rcept_no':'20260814000001'}
  with patch.object(f.dart_client,'call_periodic_reports',return_value=reports):
   result=f.fetch_screening('key','corp',None,q,as_of=NOW.date())
  self.assertEqual(result['error'],'LATEST_DISCLOSURE_PENDING')
 def test_period_order_over_correction_order(self):
  reports=[{'report_nm':'[기재정정]사업보고서 (2025.12)','rcept_no':'20261018000001','rcept_dt':'20261018'},{'report_nm':'반기보고서 (2026.06)','rcept_no':'20260814000001','rcept_dt':'20260814'}]
  self.assertEqual(f.latest_periodic_filing(reports)['reprt_code'],'11012')
 def test_q4_annual_minus_q3_cumulative_not_three_month(self):
  reports=[{'report_nm':'사업보고서 (2025.12)','rcept_no':'20260320000001','rcept_dt':'20260320'}]
  q={'year':2025,'reprt_code':'11011','rcept_no':'20260320000001','fs_div':'CFS','operating_income':100,'net_income':80}
  rows=[{'sj_div':'IS','account_id':'dart_OperatingIncomeLoss','thstrm_amount':'50','thstrm_add_amount':'120'},{'sj_div':'IS','account_id':'ifrs-full_ProfitLoss','thstrm_amount':'20','thstrm_add_amount':'90'}]
  with patch.object(f.dart_client,'call_periodic_reports',return_value=reports),patch.object(f.dart_client,'call_fnltt',return_value=rows) as call:
   result=f.fetch_screening('key','corp',None,q,as_of=NOW.date())
  self.assertEqual(result['standalone']['operating_income'],-20);self.assertEqual(result['standalone']['net_income'],-10)
  self.assertEqual(call.call_args.args[-1],'CFS')
 def test_three_month_field_not_ytd(self):
  reports=[{'report_nm':'반기보고서 (2026.06)','rcept_dt':'20260814','rcept_no':'20260814000001'}]
  q={'year':2026,'reprt_code':'11012','rcept_no':'20260814000001','operating_income':-5,'net_income':-2,'operating_income_ytd':100}
  with patch.object(f.dart_client,'call_periodic_reports',return_value=reports):result=f.fetch_screening('key','corp',None,q,as_of=NOW.date())
  self.assertEqual(result['standalone']['operating_income'],-5)
 def test_read_time_expiry_and_original_namespace(self):
  groups={'maCloudBreakout':[item()]}
  summary=p.apply_long_term_filter(groups,{'005930':entry()},now=NOW)
  cached={'patterns':groups,'longTermFilter':summary}
  self.assertEqual(len(p.validated_long_term_snapshot(cached,now=NOW)[0]),1)
  later=NOW.replace(day=29)
  accepted,updated=p.validated_long_term_snapshot(cached,now=later)
  self.assertEqual(accepted,[]);self.assertEqual(updated['excluded'],1)
  self.assertEqual(len(groups['maCloudBreakout']),1);self.assertEqual(summary['passed'],1)
 def test_receipt_future_and_no_proof_fail(self):
  e=entry();e['annual']['years'][0]['rcept_no']='20271019000001';self.assertIn('REPORT_DATE_INVALID',p.long_term_financial_check(item(),e,now=NOW)['reasons'])
  e=entry();del e['screening']['standalone']['basis'];self.assertIn('QUARTER_MISSING',p.long_term_financial_check(item(),e,now=NOW)['reasons'])
if __name__=='__main__':unittest.main()
