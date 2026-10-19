import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
import us_analysis as analysis
import us_etf_holdings as etf
import us_stocks

class AnalysisRegression(unittest.TestCase):
    def test_mapping_period_and_latest_recommendation(self):
        result = analysis._build_summary({'metric': {'pb': 8, 'pbAnnual': 4, 'roeRfy': 20, 'netProfitMarginTTM': 12},
            'recommendations': [{'period':'2026-01-01','buy':1},{'period':'2026-10-01','buy':8}],
            'financials': {'data':[{'endDate':'2025-09-30','report':{'ic':{'revenue':1}}},
                {'startDate':'2026-01-01','endDate':'2026-06-30','filedDate':'2026-07-30','report':{'ic':[
                    {'concept':'us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax','value':200},
                    {'concept':'us-gaap_NetIncomeLossAvailableToCommonStockholdersBasic','value':999},
                    {'concept':'us-gaap_NetIncomeLoss','value':25}]}}]}})
        self.assertEqual((result['pb'],result['roe'],result['net_margin']), (8,20,12))
        self.assertEqual((result['latest_revenue'],result['latest_net_income']), (200,25))
        self.assertEqual(result['statement_period']['start'], '2026-01-01')
        self.assertEqual(result['recommendation']['period'],'2026-10-01')
        self.assertEqual(result['recommendation']['buy'],8)
        self.assertIsNone(result['metric_basis']['pb']['as_of'])

    def test_nonfinite_and_false_zero(self):
        self.assertIsNone(analysis._number('NaN'))
        self.assertIsNone(analysis._number('Infinity'))
        self.assertEqual(analysis._number(0),0)
        self.assertFalse(analysis._build_summary({})['recommendation']['available'])

    def test_empty_response_retried_and_partial_expires(self):
        with tempfile.TemporaryDirectory() as root, patch.object(analysis, 'CACHE_DB_FILE',root+'/a.db'):
            with patch.object(analysis, '_get_json',return_value={}) as fetch:
                result=analysis.get_analysis('AAPL','test')
                self.assertEqual(fetch.call_count,8)
                self.assertFalse(result['available'])
                self.assertTrue(result['partial'])
            now=time.time()
            with patch.object(analysis.time, 'time',return_value=now+301):
                self.assertIsNone(analysis._load_cached('AAPL'))

    def test_legacy_cache_invalidated(self):
        with tempfile.TemporaryDirectory() as root, patch.object(analysis,'CACHE_DB_FILE',root+'/a.db'):
            analysis._save_cached('AAPL',{'available':True,'metric':{}})
            self.assertIsNone(analysis._load_cached('AAPL'))

    def test_broker_classification(self):
        rows=[('ZZZZ','TEST ETF','NA',True,''),('AAPL','Apple','NA',False,'')]
        with patch.dict(us_stocks._symbol_cache,rows=rows):
            self.assertEqual(us_stocks.instrument_info('ZZZZ')['quote_type'],'ETF')
            self.assertEqual(us_stocks.instrument_info('AAPL')['quote_type'],'EQUITY')
            self.assertEqual(us_stocks.instrument_info('UNKNOWN')['quote_type'],'UNKNOWN')

class HoldingsContract(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.env=patch.dict(os.environ,US_ETF_LICENSED_SNAPSHOT_DIR=str(self.root))
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.temp.cleanup)
        self.manifest={'public_display_allowed':True,'storage_allowed':True,'license_reference':'synthetic-test-only',
                       'expires_on':'2099-01-01','provider':'Synthetic QA','source_url':'https://example.org/license'}
        self.snapshot={'symbol':'TEST','as_of':time.strftime('%Y-%m-%d'),'holdings':[
            {'name':'Foreign equity','ticker':'005930','country':'KR','kind':'equity','basis':'holding_value','weight_percent':60},
            {'name':'Synthetic swap','ticker':None,'kind':'derivative','basis':'economic_exposure','weight_percent':70}]}
        self.write()

    def write(self):
        (self.root/'license.json').write_text(json.dumps(self.manifest),encoding='utf-8')
        (self.root/'TEST.json').write_text(json.dumps(self.snapshot),encoding='utf-8')

    def test_disabled_without_manifest_and_no_file_read(self):
        (self.root/'license.json').unlink()
        with patch.object(etf.json,'loads',side_effect=AssertionError('must not read holdings')):
            self.assertEqual(etf.get_holdings('TEST',{})['status'],'pending')

    def test_rights_expiry_missing_and_stale(self):
        for key,value in [('public_display_allowed',False),('storage_allowed',False),('expires_on','2020-01-01'),('license_reference','')]:
            with self.subTest(key=key):
                original=self.manifest[key];self.manifest[key]=value;self.write()
                self.assertEqual(etf.get_holdings('TEST',{})['holdings'],[])
                self.manifest[key]=original
        self.snapshot['as_of']='2020-01-01';self.write()
        self.assertEqual(etf.get_holdings('TEST',{})['status'],'pending')

    def test_foreign_derivatives_and_weights_not_normalized(self):
        result=etf.get_holdings('TEST',{})
        self.assertEqual(result['status'],'ready')
        self.assertEqual(result['total_count'],2)
        self.assertEqual(sum(row['weight_percent'] for row in result['holdings']),130)
        self.assertEqual(result['holdings'][0]['basis'],'economic_exposure')
        self.assertEqual(result['holdings'][1]['country'],'KR')
        self.assertNotIn('license_reference',result)

    def test_invalid_weight_and_unsafe_source(self):
        self.snapshot['holdings'][0]['weight_percent']=float('nan');self.write()
        self.assertEqual(etf.get_holdings('TEST',{})['status'],'pending')
        self.manifest['source_url']='javascript:alert(1)';self.write()
        self.assertEqual(etf.get_holdings('TEST',{})['status'],'pending')

if __name__=='__main__':unittest.main()
