"""Offline Windows spawn/process and broker-failure regressions."""
import errno
import io
import json
import multiprocessing as mp
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import kiwoom
import live_kiwoom
import kiwoom_balance_gate as gate


def worker(path, queue, count=2, crash=False):
    with patch.object(gate, 'lock_path', return_value=Path(path)):
        for _ in range(count):
            with gate.balance_request():
                queue.put(time.monotonic())
                if crash:
                    queue.close()
                    queue.join_thread()
                    os._exit(7)


class Response:
    def __init__(self, payload):
        self.payload = payload
        self.headers = {}
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass
    def read(self):
        return json.dumps(self.payload).encode()


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'gate.lock'
        self.patcher = patch.object(gate, 'lock_path', return_value=self.path)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def assert_spacing(self, stamps):
        stamps = sorted(stamps)
        self.assertTrue(all(b-a >= .55 for a,b in zip(stamps, stamps[1:])), stamps)
        self.assertTrue(all(sum(t <= x < t+1 for x in stamps) <= 2 for t in stamps))

    def test_sequential_and_exception_are_counted(self):
        stamps=[]
        for _ in range(4):
            try:
                with gate.balance_request():
                    stamps.append(time.monotonic())
                    raise ValueError('fake transport')
            except ValueError:
                pass
        self.assert_spacing(stamps)

    def test_spawn_processes_aggregate(self):
        ctx=mp.get_context('spawn'); queue=ctx.Queue()
        children=[ctx.Process(target=worker,args=(str(self.path),queue)) for _ in range(3)]
        try:
            for child in children: child.start()
            stamps=[queue.get(timeout=15) for _ in range(6)]
            for child in children:
                child.join(5)
                self.assertEqual(child.exitcode,0)
            self.assert_spacing(stamps)
        finally:
            for child in children:
                if child.is_alive(): child.terminate(); child.join()
            queue.close(); queue.join_thread()

    def test_abnormal_owner_exit_keeps_gap(self):
        ctx=mp.get_context('spawn'); queue=ctx.Queue()
        child=ctx.Process(target=worker,args=(str(self.path),queue,1,True))
        child.start()
        try:
            stamp=queue.get(timeout=10)
            child.join(5)
            self.assertEqual(child.exitcode,7)
            with gate.balance_request(): self.assert_spacing([stamp,time.monotonic()])
        finally:
            if child.is_alive(): child.terminate(); child.join()
            queue.close(); queue.join_thread()

    def test_clock_changes_do_not_affect_gate(self):
        with patch.object(time,'time',side_effect=AssertionError('wall clock used')):
            with gate.balance_request(): first=time.monotonic()
            with gate.balance_request(): self.assert_spacing([first,time.monotonic()])

    def test_lock_failure_and_timeout_fail_closed(self):
        for error in (OSError(errno.EIO,'fake'),OSError(errno.EACCES,'fake')):
            with patch.object(gate,'_lock',side_effect=error), patch.object(gate,'LOCK_TIMEOUT_SECONDS',0):
                with self.assertRaises(RuntimeError):
                    with gate.balance_request(): self.fail('must not dispatch')

    def test_permission_failure_does_not_dispatch(self):
        with patch('builtins.open',side_effect=PermissionError('fake')):
            with self.assertRaises(PermissionError):
                with gate.balance_request(): self.fail('must not dispatch')

    def client(self,module):
        client=module.KiwoomClient('fake','fake',min_gap_sec=0)
        client._get_token=lambda force=False:'fake'
        return client

    def test_both_clients_and_auth_retries_share_gate(self):
        stamps=[]
        for module in (kiwoom,live_kiwoom):
            client=self.client(module)
            for mode in ('http','payload','transport'):
                def request(*args,**kwargs):
                    stamps.append(time.monotonic())
                    if len(stamps)==start+1:
                        if mode=='http': raise HTTPError('https://fake',401,'fake',{},io.BytesIO(b''))
                        if mode=='transport': raise URLError('fake')
                        return Response({'return_msg':'8005'})
                    return Response({'return_code':0})
                start=len(stamps)
                with patch.object(module.urllib.request,'urlopen',side_effect=request):
                    if mode=='transport':
                        with self.assertRaises(URLError): client.call('kt00018','/fake',{})
                    else:
                        client.call('kt00018','/fake',{})
                        self.assertEqual(len(stamps)-start,2)
        self.assert_spacing(stamps)

    def test_orders_never_auth_retry(self):
        for module in (kiwoom,live_kiwoom):
            for api in ('kt10000','kt10001','kt10002','kt10003'):
                for result in (HTTPError('https://fake',401,'fake',{},io.BytesIO(b'')),Response({'return_msg':'8005'})):
                    client=self.client(module)
                    with patch.object(module.urllib.request,'urlopen',side_effect=[result]) as request:
                        try: client.call(api,'/fake',{})
                        except RuntimeError: pass
                        self.assertEqual(request.call_count,1)

    def test_partial_balance_is_not_used(self):
        response=Response({'return_code':0,'acnt_evlt_remn_indv_tot':[]})
        response.headers={'cont-yn':'Y'}
        for module in (kiwoom,live_kiwoom):
            client=self.client(module)
            with patch.object(module.urllib.request,'urlopen',return_value=response):
                with self.assertRaisesRegex(RuntimeError,'incomplete balance'): client.balance()

    def test_balance_failure_is_never_empty_holdings(self):
        for module in (kiwoom,live_kiwoom):
            client=self.client(module)
            for payload in ({'return_code':429}, {}, {'return_code':0},
                            {'return_code':0,'acnt_evlt_remn_indv_tot':{}},
                            {'return_code':0,'acnt_evlt_remn_indv_tot':[{'stk_cd':'005930','rmnd_qty':'bad'}]}):
                with patch.object(client,'call',return_value=payload):
                    with self.assertRaises(RuntimeError): client.balance()
            with patch.object(client,'call',return_value={'return_code':0,'acnt_evlt_remn_indv_tot':[]}):
                self.assertEqual(client.balance(),[])


class EntryFailureTests(unittest.TestCase):
    def test_runner_exit_then_signals_then_legacy_priority_unchanged(self):
        try:
            from live_runner import run_cycle
        except ImportError:
            from live_runner_9pay import run_cycle
        from test_ninepay_trade import NOW
        from unittest.mock import Mock
        calls=[]
        def engine(*args,**kwargs):
            calls.append('exit' if kwargs.get('allow_entries') is False else 'legacy')
            return 'EXITS_CHECKED' if kwargs.get('allow_entries') is False else 'NO_CANDIDATE'
        def signal_trade(*args):
            calls.append('signal')
            return 'BUDGET_OR_SLOTS_FULL'
        with patch.dict(os.environ,{'NINEPAY_LIVE_TRADING':'1'}):
            result=run_cycle(None,Mock(),None,'.',NOW,True,engine_cycle=engine,
                             signal_fetch=lambda **kw:[{}, {}, {}],signal_trade=signal_trade,
                             get_candidates=lambda now:[])
        self.assertEqual(result,'NO_CANDIDATE')
        self.assertEqual(calls,['exit','signal','signal','signal','legacy'])

    def test_runner_uncertain_order_blocks_retry_and_entries(self):
        try:
            from live_runner import run_cycle, cycle_error_state
        except ImportError:
            from live_runner_9pay import run_cycle, cycle_error_state
        from test_ninepay_trade import NOW
        from unittest.mock import Mock
        ledger=Mock(); ledger.has_uncertain.return_value=True
        self.assertEqual(cycle_error_state(URLError('fake'),ledger),'DISABLED_OR_UNCERTAIN')
        fetch=Mock()
        result=run_cycle(None,ledger,None,'.',NOW,True,
                         engine_cycle=lambda *a,**kw:'BUY_FILL_UNCONFIRMED',signal_fetch=fetch)
        self.assertEqual(result,'BUY_FILL_UNCONFIRMED')
        fetch.assert_not_called()

    def test_failed_balance_cannot_reserve_9pay_order(self):
        from test_ninepay_trade import FakeClient,FakeLedger,FakePolicy,NOW,signal
        from ninepay_trade import trade_signal_once
        client=FakeClient(); ledger=FakeLedger()
        try:
            with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'NINEPAY_LIVE_TRADING':'1'}):
                with patch.object(client,'balance',side_effect=RuntimeError('kt00018 limit')):
                    with self.assertRaises(RuntimeError):
                        trade_signal_once(client,ledger,signal(),folder,NOW,policy=FakePolicy)
            self.assertEqual(client.orders,[])
            self.assertEqual(ledger.reserved,[])
        finally:
            ledger.db.close()

    def test_failed_balance_cannot_close_position_or_order_legacy(self):
        from test_live_exclusion import Base, FakeBroker, NOW
        import live_engine
        fixture=Base()
        fixture.setUp()
        try:
            client=FakeBroker([], {})
            with patch.object(client,'balance',side_effect=RuntimeError('kt00018 limit')):
                with self.assertRaises(RuntimeError):
                    live_engine.trade_once(client,fixture.ledger,[],lambda code:[],fixture.dir,NOW)
            self.assertEqual(client.buys,[])
            self.assertEqual(client.sells,[])
            with fixture.ledger.connect() as db:
                self.assertEqual(db.execute("SELECT state FROM positions WHERE code='032640'").fetchone()[0],'OPEN')
        finally:
            fixture.tearDown()
