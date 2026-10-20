"""Offline feed, thread-pool isolation and optional WebSocket cleanup regression."""
import ast
import asyncio
import json
from pathlib import Path
import sys
import threading
from types import SimpleNamespace

import anyio
from fastapi import FastAPI, WebSocketDisconnect
import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/cloud-vm'))
sys.path.insert(0, str(ROOT / 'quant-autotrade/local_bot'))
import kiwoom_9pay_live as observer
from ninepay_signal_client import SignalFeedUnavailable, valid_signals
from live_runner_9pay import FeedDiagnostics, run_cycle, KST
from datetime import datetime, timedelta, timezone


def main_function(name, namespace):
    tree = ast.parse((ROOT / 'scripts/cloud-vm/main.py').read_text(encoding='utf-8'))
    node = next(n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                and n.name == name)
    node.decorator_list = []
    exec(compile(ast.Module(body=[node], type_ignores=[]), 'main.py', 'exec'), namespace)
    return namespace[name]


def test_small_feed_keeps_contract_and_missing_evidence(monkeypatch):
    now = datetime(2026, 10, 20, 9, 15, tzinfo=KST).timestamp()
    signal = dict(code='005930', signalId='2026-10-20:005930', at=now-2, price=100,
                  source='Kiwoom WebSocket', ruleVersion='ab70-v1', volumeMissing=False,
                  excluded=None, branches=['A'], first70At=now-60, volumeRatio=.8,
                  unrelated_large_field='not-needed')
    monkeypatch.setattr(observer, '_status', dict(ruleVersion='ab70-v1', running=True,
        active=True, rankAt=datetime.fromtimestamp(now, timezone.utc).isoformat(),
        rankError=None, amountFallback=False, queueDropped=0, persistenceError=None,
        signals=[signal], observations={'not-needed': {}}))
    snapshot = observer.signal_snapshot()
    assert 'observations' not in snapshot
    assert 'unrelated_large_field' not in snapshot['signals'][0]
    assert len(valid_signals({'data': {'ninePayResearch': snapshot}}, now)) == 1
    snapshot['signals'][0]['branches'].append('B')
    assert signal['branches'] == ['A']
    del signal['excluded']
    snapshot = observer.signal_snapshot()
    assert 'excluded' not in snapshot['signals'][0]
    assert valid_signals({'data': {'ninePayResearch': snapshot}}, now) == []
    for field, value in [('queueDropped', 1), ('persistenceError', 'failure'), ('active', False)]:
        with pytest.raises(SignalFeedUnavailable):
            valid_signals({'data': {'ninePayResearch': {**snapshot, field: value}}}, now)


def test_small_feed_serves_while_sync_api_thread_pool_is_full():
    async def scenario():
        app = FastAPI()
        handler = main_function('health_ninepay', {
            'envelope': lambda data: {'data': data},
            'kiwoom_9pay_live': SimpleNamespace(signal_snapshot=lambda: {'running': True})})
        app.get('/health/9pay')(handler)
        started, release = threading.Event(), threading.Event()

        @app.get('/blocked-sync-api')
        def slow():
            started.set()
            release.wait(5)
            return {'ok': True}

        limiter = anyio.to_thread.current_default_thread_limiter()
        original = limiter.total_tokens
        limiter.total_tokens = 1
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
            blocked = asyncio.create_task(client.get('/blocked-sync-api'))
            try:
                for _ in range(200):
                    if started.is_set():
                        break
                    await asyncio.sleep(.005)
                assert started.is_set()
                response = await asyncio.wait_for(client.get('/health/9pay'), timeout=.5)
                assert response.json()['data']['ninePayResearch']['running'] is True
                assert not blocked.done()
            finally:
                release.set()
                await blocked
                limiter.total_tokens = original
    asyncio.run(scenario())


@pytest.mark.parametrize('kis,domestic,us', [(True, True, False), (False, True, False), (False, False, True)])
def test_websocket_cleanup_handles_absent_optional_tasks(monkeypatch, kis, domestic, us):
    async def scenario():
        created = []
        async def relay(*args):
            task = asyncio.current_task()
            created.append(task)
            await asyncio.Event().wait()
        class Socket:
            headers = {'origin': 'https://ghlee.tistory.com'}
            query_params = {'codes': 'US:AAPL' if us else '005930'}
            async def accept(self): pass
            async def close(self, **kwargs): pass
            async def receive_text(self):
                await asyncio.sleep(0)
                raise WebSocketDisconnect()
        namespace = dict(asyncio=asyncio, os=__import__('os'), WebSocket=object,
            WebSocketDisconnect=WebSocketDisconnect, _ws_active_connections=0,
            _WS_MAX_CONNECTIONS=200, _market_board_source=lambda: 'kis' if kis else 'kiwoom',
            realtime_quotes=SimpleNamespace(MAX_REQUEST_CODES=250,
                normalize_codes=lambda *a, **k: ['005930'] if domestic else [], relay_quotes=relay),
            us_stocks=SimpleNamespace(normalize_symbol=lambda raw: raw.split(':')[-1]),
            finnhub_realtime=SimpleNamespace(stream_quotes=relay), logging=__import__('logging'))
        monkeypatch.setenv('KIS_APPKEY', 'test-only')
        monkeypatch.setenv('KIS_APPSECRET', 'test-only')
        handler = main_function('realtime_quote_socket', namespace)
        await handler(Socket())
        assert namespace['_ws_active_connections'] == 0
        assert created and all(task.done() for task in created)
    asyncio.run(scenario())


def test_feed_failure_logs_safe_reason_and_restoration_without_entries(tmp_path):
    now = datetime(2026, 10, 20, 9, 15, tzinfo=KST)
    clock = [now]
    report = FeedDiagnostics(str(tmp_path), clock=lambda: clock[0])
    report('UNAVAILABLE', SignalFeedUnavailable('HTTPError', http_status=502))
    report('UNAVAILABLE', SignalFeedUnavailable('HTTPError', http_status=502))
    clock[0] += timedelta(seconds=61)
    report('UNAVAILABLE', SignalFeedUnavailable('HTTPError', http_status=502))
    report('OK')
    report('UNAVAILABLE', SignalFeedUnavailable('sensitive raw response must never appear'))
    rows = [json.loads(line) for line in next((tmp_path/'logs').glob('*.jsonl')).read_text().splitlines()]
    assert len(rows) == 4 and rows[0]['http_status'] == 502
    assert rows[2]['state'] == 'OK' and rows[3]['reason'] == 'unclassified'
    assert 'sensitive' not in json.dumps(rows)


def test_log_write_failure_does_not_stop_exit_check(tmp_path, monkeypatch):
    import os
    calls = []
    monkeypatch.setenv('NINEPAY_LIVE_TRADING', '1')
    invalid_folder = tmp_path / 'a-file'
    invalid_folder.write_text('not a directory')
    report = FeedDiagnostics(str(invalid_folder))
    def exits(*a, **kw):
        calls.append(('exits', kw['allow_entries']))
        return 'EXITS_CHECKED'
    def feed(**kw):
        raise SignalFeedUnavailable('TimeoutError')
    for _ in range(2):
        assert run_cycle(None, None, None, str(tmp_path), datetime.now(KST), True,
            engine_cycle=exits, signal_fetch=feed, feed_report=report) == '9PAY_FEED_UNAVAILABLE'
    assert calls == [('exits', False), ('exits', False)]
    assert report.latest['reason'] == 'TimeoutError'
