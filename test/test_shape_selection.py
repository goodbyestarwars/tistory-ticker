import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
VM=ROOT/'scripts'/'cloud-vm'
sys.path.insert(0,str(VM))
import pattern_detect as detector

class ShapeSelection(unittest.TestCase):
    def setUp(self):
        self.cache=types.ModuleType('daily_scan_cache')
        self.db=types.ModuleType('db_schema')
        self.original={n:sys.modules.get(n) for n in ('daily_scan_cache','db_schema')}
        sys.modules['daily_scan_cache']=self.cache;sys.modules['db_schema']=self.db
        spec=importlib.util.spec_from_file_location('shape_under_test',VM/'shape_scan.py')
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.rows=[dict(date='2026-10-'+str(i+1).zfill(2),open=10000,high=10010,low=9990,close=10000,volume=500000) for i in range(24)]
        self.stock=dict(code='123450',name='일반기업',market_cap_eok=4000)
    def tearDown(self):
        for n,v in self.original.items():
            if v is None:sys.modules.pop(n,None)
            else:sys.modules[n]=v
    def test_input_gates(self):
        m=self.module;basis=self.rows[-1]['date']
        self.assertTrue(m.eligible(self.stock,self.rows,basis))
        self.assertFalse(m.eligible(self.stock,self.rows,'2026-11-04'))
        self.assertFalse(m.eligible(dict(self.stock,is_etf=True),self.rows,basis))
        self.assertFalse(m.eligible(dict(self.stock,market_cap_eok=None),self.rows,basis))
        self.assertFalse(m.eligible(dict(self.stock,market_cap_eok=float('inf')),self.rows,basis))
        bad=copy.deepcopy(self.rows);bad[10]['low']=20000
        self.assertFalse(m.eligible(self.stock,bad,basis))
        bad=copy.deepcopy(self.rows);bad[10]['volume']=None
        self.assertFalse(m.eligible(self.stock,bad,basis))
        self.assertFalse(m.eligible(self.stock,self.rows[::-1],basis))
    def test_public_contract_and_expiry(self):
        m=self.module;now=datetime(2026,11,4,15,tzinfo=timezone.utc)
        s=dict(version=m.VERSION,mode='observation',orderAuthorized=False,status='ok',dataDate='2026-11-04',
               scannedAt=now.isoformat(),groups={k:[] for k in m.GROUPS})
        original=copy.deepcopy(s)
        self.assertIsNotNone(m.public_snapshot(s,now=now,basis='2026-11-04'))
        self.assertEqual(s,original)
        self.assertIsNone(m.public_snapshot(dict(s,orderAuthorized=True),now=now))
        self.assertIsNone(m.public_snapshot(s,now=now,basis='2026-11-03'))
        self.assertIsNone(m.public_snapshot(dict(s,scannedAt='2026-11-01T00:00:00+00:00'),now=now))
        self.assertIsNone(m.public_snapshot(dict(s,scannedAt='2026-11-06T00:00:00+00:00'),now=now))
    def test_legacy_api_projection_unchanged(self):
        import ast
        source=(VM/'main.py').read_text(encoding='utf-8')
        func=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='_build_pattern_scan')
        fake=types.ModuleType('shape_scan');fake.public_snapshot=lambda snapshot,**kw:snapshot
        data=dict(patternScan=dict(patterns={'doubleBottom':[{'code':'123450'}]}),shapeSelection={'marker':'observation'})
        env=dict(load_daily_scan_cache_cached=lambda:copy.deepcopy(data),pattern_detect=types.SimpleNamespace(validated_long_term_snapshot=lambda p:([],None)),
                 volume_accumulation=types.SimpleNamespace(merge_lists=lambda a,b:a+b))
        with patch.dict(sys.modules,shape_scan=fake):
            exec(compile(ast.Module(body=[func],type_ignores=[]),'<api>','exec'),env)
            result=env['_build_pattern_scan']()
        self.assertEqual(result['patterns']['doubleBottom'],data['patternScan']['patterns']['doubleBottom'])
        self.assertNotIn('shape',result['patterns'])
        self.assertEqual(result['shapeSelection'],{'marker':'observation'})
        self.assertNotIn('shapeSelection',data['patternScan'])

    def test_refresh_reads_universe_and_preserves_legacy(self):
        from datetime import timedelta
        m=self.module
        class FixedDate(datetime):
            @classmethod
            def now(cls,tz=None):
                return datetime(2026,11,4,16,tzinfo=timezone.utc).astimezone(tz or timezone.utc)
        daily=[]
        for i in range(60):
            c=(100+i*.4 if i<30 else 112-(i-30)*.2 if i<45 else 109+(i%3)*.03)*100
            daily.append(dict(date=(datetime(2026,11,4)-timedelta(days=59-i)).date().isoformat(),
                              open=c-10,high=c+30,low=c-30,close=c,volume=2000000 if i<30 else 800000))
        original=dict(dataDate='2026-11-04',generatedAt='2026-11-04T12:00:00+00:00',
                      patternScan={'patterns':{'doubleBottom':[{'code':'legacy'}]}},
                      pullbackScan={'matches':[{'code':'legacy2'}]})
        live=copy.deepcopy(original)
        class Conn:
            def execute(self,q):return [('123450',)]
            def close(self):pass
        self.db.get_conn=lambda:Conn()
        self.db.load_daily_prices=lambda conn,code:copy.deepcopy(daily)
        resc=types.ModuleType('rescan_patterns')
        resc.load_universe_metadata=lambda:({'123450':'일반기업'},set())
        resc.load_market_cap_cache=lambda:{'123450':4000}
        resc.load_fundamentals_cache=lambda:{}
        with tempfile.TemporaryDirectory() as tmp:
            f=Path(tmp)/'cache.json';f.write_text(json.dumps(original),encoding='utf-8')
            self.cache.OUTPUT_FILE=str(f);self.cache.update=lambda mutate:mutate(live)
            with patch.dict(sys.modules,rescan_patterns=resc),patch.object(m,'datetime',FixedDate),patch.object(detector,'long_term_financial_check',return_value={'passed':False}):
                result=m.refresh()
        self.assertEqual(result['coverage']['eligible'],1)
        self.assertEqual(len(result['groups']['pullbackRebreak']),1)
        self.assertEqual(live['patternScan'],original['patternScan'])
        self.assertEqual(live['pullbackScan'],original['pullbackScan'])
        self.assertEqual(live['generatedAt'],original['generatedAt'])
        self.assertIs(live['shapeSelection'],result)

    def test_record_tracks_uses_separate_keys_and_is_idempotent(self):
        import sqlite3
        conn=sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL)')
        for r in self.rows:conn.execute('INSERT INTO daily_prices VALUES (?,?,?,?,?,?,?)',('123450',r['date'],r['open'],r['high'],r['low'],r['close'],r['volume']))
        row=dict(code='123450',name='일반기업',price=10000,score=80,patternDetail={'status':'SHAPE_FORMING','support':9990})
        groups={k:[] for k in self.module.GROUPS};groups['pullbackRebreak']=[row];groups['bottomFormation']=[dict(row)]
        snap=dict(dataDate='2026-10-24',groups=groups)
        self.assertEqual(self.module.record_tracks(snap,conn=conn)['pullbackRebreak'],1)
        self.assertEqual(sum(self.module.record_tracks(snap,conn=conn).values()),0)
        keys=sorted(r[0] for r in conn.execute('SELECT scanner FROM pattern_tracks'))
        self.assertEqual(keys,['pattern:shape:bottomFormation','pattern:shape:pullbackRebreak'])
        self.assertEqual(conn.execute("SELECT detected_date,detected_close,status FROM pattern_tracks WHERE scanner='pattern:shape:pullbackRebreak'").fetchone(),('2026-10-24',10000.0,'NEW'))

    def test_edge_tags_track_under_own_keys_and_skip_menu_stats(self):
        import sqlite3
        conn=sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE daily_prices (code TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL)')
        for code in ('123450','222220'):
            for r in self.rows:conn.execute('INSERT INTO daily_prices VALUES (?,?,?,?,?,?,?)',(code,r['date'],r['open'],r['high'],r['low'],r['close'],r['volume']))
        tag=[{'key':'surgeNextDay'}]
        shaped=dict(code='123450',name='모양+태그',price=10000,score=80,patternDetail={'status':'SHAPE_FORMING','edgeSignals':tag})
        only=dict(code='222220',name='태그만',price=5000,score=40,patternDetail={'status':'EDGE_OBSERVE','edgeOnly':True,'edgeSignals':tag})
        groups={k:[] for k in self.module.GROUPS};groups['trendBreakout']=[shaped,only]
        out=self.module.record_tracks(dict(dataDate='2026-10-24',groups=groups),conn=conn)
        self.assertEqual(out['trendBreakout'],1,'edge-only row does not enter the shape menu statistics')
        self.assertEqual(out['pattern:edge:surgeNextDay'],2)
        self.assertEqual(out['pattern:edge:gapVolumeClose'],0)

    def test_benchmarks_require_both_indices_on_basis(self):
        rows={'KOSPI':[dict(date='20261105',close=5383.8),dict(date='20261106',close=5059.69)],
              'KOSDAQ':[dict(date='20261105',close=678.41),dict(date='2026-11-06',close=644.27)]}
        self.db.load_future_chart_since=lambda conn,symbol,since:rows[symbol]
        out=self.module.load_benchmarks(None,'2026-11-06')
        self.assertEqual(out['KOSPI'][-1],{'date':'2026-11-06','close':5059.69})
        self.assertEqual(out['KOSDAQ'][0]['date'],'2026-11-05')
        self.assertEqual(self.module.load_benchmarks(None,'2026-11-09'),{})
        rows['KOSDAQ']=rows['KOSDAQ'][:1]
        self.assertEqual(self.module.load_benchmarks(None,'2026-11-06'),{},'one stale index disables the filter')

if __name__=='__main__':unittest.main()
