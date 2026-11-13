import ast
import sqlite3
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

class FuturesObservationHistory(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        tree = ast.parse((ROOT/'scripts/cloud-vm/db_schema.py').read_text(encoding='utf-8'))
        schema_env = {}
        nodes = [n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('SCHEMA','SIGNAL_REVIEW_SCHEMA') for t in n.targets)]
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'schema','exec'),schema_env)
        self.conn.executescript(schema_env['SCHEMA'])
        conn = self.conn
        class Proxy:
            def execute(self,*args):return conn.execute(*args)
            def commit(self):conn.commit()
            def close(self):pass
        tree = ast.parse((ROOT/'scripts/cloud-vm/investor_trend.py').read_text(encoding='utf-8'))
        nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('capture_futures_observation','get_futures_history')]
        self.env=dict(datetime=datetime,timedelta=timedelta,KST=timezone(timedelta(hours=9)),db_schema=types.SimpleNamespace(get_conn=Proxy))
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'history','exec'),self.env)
        self.clock=patch.dict(sys.modules,{'market_clock':types.SimpleNamespace(is_kr_trading_day=lambda d:d.weekday()<5)})
        self.clock.start();self.addCleanup(self.clock.stop);self.addCleanup(self.conn.close)

    def snapshot(self,stamp,net=100):
        return dict(available=True,stale=False,retrievedAt=stamp,participants={k:{'net':net} for k in ('foreign','institution','individual')})

    def test_observation_identity_staleness_session_and_persistence(self):
        stamp='2026-11-13T09:10:00+09:00';now=datetime.fromisoformat(stamp);data=self.snapshot(stamp)
        capture=self.env['capture_futures_observation']
        self.assertTrue(capture(data,now));self.assertTrue(capture(data,now))
        self.assertEqual(len(self.env['get_futures_history']()['observations']),1)
        self.assertFalse(capture(dict(data,stale=True),now))
        self.assertFalse(capture(data,now+timedelta(minutes=2)))
        self.assertFalse(capture(self.snapshot('2026-11-13T16:00:00+09:00'),datetime.fromisoformat('2026-11-13T16:00:00+09:00')))
        self.assertFalse(capture(self.snapshot('2026-11-14T09:10:00+09:00'),datetime.fromisoformat('2026-11-14T09:10:00+09:00')))
        self.assertTrue(capture(self.snapshot('2026-11-16T09:10:00+09:00',200),datetime.fromisoformat('2026-11-16T09:10:00+09:00')))
        history=self.env['get_futures_history']()
        self.assertEqual(history['historyDate'],'2026-11-16');self.assertEqual(history['observations'][0]['foreign'],200)

    def test_minute_request_includes_today_time(self):
        tree=ast.parse((ROOT/'scripts/cloud-vm/domestic_futures.py').read_text(encoding='utf-8'))
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='fetch_domestic_index_chart_minute')
        urls=[]
        class Clock(datetime):
            @classmethod
            def now(cls,*args):return cls(2026,11,13,18,15,tzinfo=timezone(timedelta(hours=9)))
        env=dict(datetime=Clock,timedelta=timedelta,KST=timezone(timedelta(hours=9)),_get_json=lambda u:urls.append(u) or [])
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'minute','exec'),env)
        env['fetch_domestic_index_chart_minute']('futures','FUT')
        self.assertIn('endDateTime=20261113181500',urls[0]);self.assertIn('startDateTime=20261110000000',urls[0])

if __name__=='__main__':unittest.main()
