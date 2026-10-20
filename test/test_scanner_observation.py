import copy
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts/cloud-vm'))
import scanner_observation as obs
import scan_indicators as indicators
import pattern_detect as pd
import fundamentals


def rows(n=40):
    return [{'code':f'{i:06d}','name':f'ordinary {i}','price':10000+i,
             'trade_volume':100000+i} for i in range(1,n+1)]


class ObservationTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.paths=patch.multiple(obs,PATH=self.tmp.name+'/state.json',LOG=self.tmp.name+'/log.jsonl')
        self.paths.start()
        obs._pools.clear(); obs._previous.clear(); obs._calls.clear(); obs._cache.clear()
        obs._write_error=False
    def tearDown(self):
        self.paths.stop(); self.tmp.cleanup()

    def test_full_union_dedup_20_unchanged_and_no_mutation(self):
        data=rows(); original=copy.deepcopy(data)
        obs.observe('kiwoom',data+data[:10],now=10000)
        selected=[r['code'] for r in data[:20]]
        obs.selection(selected)
        p=obs.snapshot(now=10001)['pools']['kiwoom']
        self.assertEqual((p['rawRows'],p['uniqueRows'],p['duplicateRows']), (50,40,10))
        self.assertEqual((p['omittedCount'],p['omissionRate']), (20,.5))
        self.assertEqual(data,original); self.assertEqual(len(selected),20)

    def test_growth_new_entry_and_reset(self):
        obs.observe('kis',rows(2),now=10000)
        self.assertTrue(all(r['newEntry'] is None for r in obs._pools['kis']['items']))
        data=rows(3);data[0]['trade_volume']*=2
        obs.observe('kis',data,now=10030)
        by={r['code']:r for r in obs._pools['kis']['items']}
        self.assertEqual(by['000001']['volumeGrowthPct'],100)
        self.assertTrue(by['000003']['newEntry'])
        data[0]['trade_volume']=1
        obs.observe('kis',data,now=10060)
        self.assertIsNone(next(r for r in obs._pools['kis']['items'] if r['code']=='000001')['volumeGrowthPct'])
        obs.observe('kis',data,now=10400)
        self.assertTrue(all(r['newEntry'] is None for r in obs._pools['kis']['items']))

    def test_partial_error_never_claims_full_coverage(self):
        obs.observe('kiwoom',rows(),errors=['amount_unavailable'],now=10000)
        obs.selection([r['code'] for r in rows(20)])
        p=obs.snapshot(now=10000)['pools']['kiwoom']
        self.assertTrue(p['stale']); self.assertIsNone(p['omissionRate'])
        self.assertEqual(p['candidateObservations'],0)
        obs.observe('kiwoom',rows(),now=10060)
        self.assertTrue(all(r['newEntry'] is None for r in obs._pools['kiwoom']['items']))

    def test_failures_preserve_last_observed_time(self):
        obs.observe('kis',rows(),now=10000); obs.failure('kis','timeout')
        p=obs.snapshot(now=10100)['pools']['kis']
        self.assertEqual(p['observedAt'],10000); self.assertTrue(p['stale'])
        self.assertIsNone(p['sourceAsOf'])

    def test_daily_totals_and_excluded_products(self):
        data=rows();data[0]['name']='KODEX 레버리지';data[1]['name']='TIGER 머니마켓'
        obs.observe('kiwoom',data,now=10000); obs.selection([])
        obs.observe('kiwoom',data,now=10060); obs.selection([])
        self.assertEqual(obs._pools['kiwoom']['candidateObservations'],76)
        obs.observe('kiwoom',data,now=100000);obs.selection([])
        self.assertEqual(obs._pools['kiwoom']['candidateObservations'],38)

    def test_metrics_preserve_return_and_exception(self):
        @obs.measured('test')
        def fn(fail=False):
            if fail:raise ValueError()
            return 7
        self.assertEqual(fn(),7)
        with self.assertRaises(ValueError):fn(True)
        self.assertEqual(obs.snapshot()['calls']['test']['calls'],2)
        self.assertEqual(obs.snapshot()['calls']['test']['errors'],1)

    def test_persistence_failure_never_changes_scan_execution(self):
        with patch.object(obs,'PATH',self.tmp.name+'/missing/state.json'):
            obs.observe('kis',rows(),now=10000)
        self.assertTrue(obs.snapshot()['persistenceError'])

    def test_restore_read_is_stale_no_new_entry_baseline(self):
        obs.observe('kis',rows(),now=10000);obs._pools.clear();obs._previous.clear()
        self.assertTrue(obs.snapshot(now=11000)['pools']['kis']['stale'])
        obs.observe('kis',rows(),now=11000)
        self.assertTrue(all(r['newEntry'] is None for r in obs._pools['kis']['items']))

    def test_counter_survives_same_day_restart_without_new_entry_claim(self):
        obs.observe('kiwoom',rows(),now=10000);obs.selection([])
        obs._pools.clear();obs._previous.clear()
        obs.observe('kiwoom',rows(),now=10060);obs.selection([])
        self.assertEqual(obs._pools['kiwoom']['candidateObservations'],80)
        self.assertTrue(all(r['newEntry'] is None for r in obs._pools['kiwoom']['items']))


class IndicatorTest(unittest.TestCase):
    def test_exact_math_copy_change_and_scope_cleanup(self):
        data=[{'close':100+i/3} for i in range(260)]
        expected=pd.moving_average(data,'close',20)
        @indicators.shared
        def run(_stock, daily):
            first=pd.moving_average(data,'close',20)
            self.assertTrue(indicators._scope.get()[1])
            second=pd.moving_average(list(data),'close',20)
            self.assertEqual(first,expected);self.assertEqual(second,expected)
            first[-1]=0
            self.assertEqual(pd.moving_average(data,'close',20),expected)
            changed=copy.deepcopy(data);changed[-1]['close']+=1
            self.assertNotEqual(pd.moving_average(changed,'close',20),expected)
        run(None,data);self.assertIsNone(indicators._scope.get())
        @indicators.shared
        def fail():raise ValueError()
        with self.assertRaises(ValueError):fail()
        self.assertIsNone(indicators._scope.get())

    def test_screening_only_for_requested_candidates(self):
        with patch.multiple(fundamentals,fetch_annual_series=lambda *a:{'years':[]},
                            fetch_latest_quarter=lambda *a:{},fetch_dividend_history=lambda *a:{}), \
             patch.object(fundamentals.time,'sleep'),patch.object(fundamentals,'fetch_screening',return_value={'version':1}) as gate:
            self.assertNotIn('screening',fundamentals.fetch_stock('fake','fake',include_screening=False))
            gate.assert_not_called()
            self.assertEqual(fundamentals.fetch_stock('fake','fake')['screening'],{'version':1})
            self.assertEqual(gate.call_count,1)


if __name__=='__main__':unittest.main()
