"""Reproduce the 500-slot overflow, then exercise the real non-blocking loop."""
import asyncio
import json
from datetime import datetime
from pathlib import Path
import sys
import threading
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
import kiwoom_9pay_live as live
import kiwoom_ws_hub as hub_module
import volume_surge_live


def test_saved_drop_block_survives_same_day_restart(tmp_path, monkeypatch):
    path = tmp_path / 'state.json'
    monkeypatch.setattr(live, 'STATE_PATH', str(path))
    monkeypatch.setattr(live, '_status', dict(live._status, candidateDetails=[], observations={},
                                            signals=[], queueDropped=473))
    source = live.logic.Observer([], {})
    assert live._persist(source, '2026-10-20')
    assert json.loads(path.read_text())['queueDropped'] == 473
    live._set(queueDropped=0)
    live._restore(live.logic.Observer([], {}), '2026-10-20')
    assert live.signal_snapshot()['queueDropped'] == 473


def test_inline_rank_pause_can_reproduce_473_lost_events():
    async def scenario():
        sub = hub_module.Subscription(None, 1, ['005930'], asyncio.get_running_loop(), 500, True)
        # The previous inline await left no consumer while REST ranking ran.
        for i in range(973):
            sub._deliver({'code': '005930', 'volume': i})
        assert sub.dropped_events == 473 and sub.queue.qsize() == 500
    asyncio.run(scenario())


def test_real_loop_drains_973_ticks_during_slow_rank_without_drops(monkeypatch):
    async def scenario():
        class Hub:
            sub = None
            def subscribe(self, codes, loop, maxsize, include_volume):
                self.sub = hub_module.Subscription(self, 1, codes, loop, maxsize, include_volume)
                return self.sub
            def _update(self, ident, codes):
                self.sub.codes = frozenset(codes)
            def _remove(self, ident): pass
        hub = Hub()
        started, release, finished = threading.Event(), threading.Event(), threading.Event()
        rank_calls = [0]
        clock = [datetime.now(live.KST).replace(hour=9, minute=15, second=0, microsecond=0).timestamp()]
        consumed, records = [], []
        ack = asyncio.Event()
        def consume(result, *args):
            consumed.append(result)
            ack.set()
        def ranking(*args):
            rank_calls[0] += 1
            if rank_calls[0] == 2:
                started.set()
                release.wait(30)
                finished.set()
            return ['005930'], {'005930': 1000}, False, [{'code': '005930', 'name': '삼성전자'}], {}
        monkeypatch.setattr(hub_module, 'start', lambda *a: hub)
        monkeypatch.setattr(volume_surge_live, 'sample_snapshot', lambda codes: {})
        monkeypatch.setattr(live, 'market_open', lambda: True)
        monkeypatch.setattr(live, '_rank', ranking)
        monkeypatch.setattr(live, '_restore', lambda *a: None)
        monkeypatch.setattr(live, '_persist', lambda *a: True)
        monkeypatch.setattr(live, '_record', records.append)
        monkeypatch.setattr(live, '_consume', consume)
        monkeypatch.setattr(live, 'time', SimpleNamespace(time=lambda: clock[0]))
        monkeypatch.setattr(live, '_status', dict(live._status,
            candidateDetails=[], observations={}, signals=[], candidates=[]))
        task = asyncio.create_task(live._run('test-only', 'test-only'))
        async def wait_until(predicate):
            for _ in range(600):
                if predicate(): return
                if task.done(): await task
                await asyncio.sleep(.005)
            raise AssertionError('loop did not make progress')
        def deliver(volume):
            clock[0] += .001
            hub.sub._deliver(dict(code='005930', price=100, volume=volume,
                                   receivedAt=clock[0], openPrice=100))
        try:
            await wait_until(lambda: hub.sub is not None and bool(hub.sub.codes))
            clock[0] += 61
            deliver(1000)
            await wait_until(started.is_set)
            before = len(consumed)
            for i in range(973):
                ack.clear()
                deliver(1001+i)
                await asyncio.wait_for(ack.wait(), timeout=1)
            await wait_until(lambda: len(consumed) >= before+973)
            assert not finished.is_set()  # REST is still blocked, yet all ticks were consumed.
            assert hub.sub.dropped_events == 0
            assert live.health_snapshot()['queueDropped'] == 0
            assert all(row['sampleAt'] <= row['at'] for row in consumed)
            assert not any(row['signal'] for row in consumed)
        finally:
            release.set()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        assert hub.sub.closed
    asyncio.run(scenario())


def test_prior_day_drop_does_not_block_new_day(tmp_path, monkeypatch):
    """Yesterday's confirmed loss is not today's drop; no live feed or order calls."""
    path = tmp_path / 'state.json'
    monkeypatch.setattr(live, 'STATE_PATH', str(path))
    monkeypatch.setattr(live, '_status', dict(live._status, candidateDetails=[],
                                            observations={}, signals=[],
                                            queueDropped=473, persistenceError=None))
    saved = live.logic.Observer([], {})
    assert live._persist(saved, '2026-10-21')
    # Same long-lived hub subscription has already seen 473 losses yesterday.
    baseline_drops, subscription_base = live._start_trading_day(
        live.logic.Observer([], {}), '2026-10-22', 473, first_day=False)
    assert baseline_drops == 0 and subscription_base == 473
    assert live.signal_snapshot()['queueDropped'] == 0
    assert baseline_drops + (473 - subscription_base) == 0
    # But even one loss *today* must remain fatal to new entries.
    assert baseline_drops + (474 - subscription_base) == 1


def test_same_day_saved_drop_survives_restart_after_rollover(tmp_path, monkeypatch):
    path = tmp_path / 'state.json'
    monkeypatch.setattr(live, 'STATE_PATH', str(path))
    monkeypatch.setattr(live, '_status', dict(live._status, candidateDetails=[],
                                            observations={}, signals=[],
                                            queueDropped=3, persistenceError=None))
    assert live._persist(live.logic.Observer([], {}), '2026-10-22')
    # New server process has a new subscription (counter zero).
    saved, subscriber_base = live._start_trading_day(
        live.logic.Observer([], {}), '2026-10-22', 0, first_day=True)
    assert saved == 3 and subscriber_base == 0
    assert live.signal_snapshot()['queueDropped'] == 3
    assert saved + (1 - subscriber_base) == 4
