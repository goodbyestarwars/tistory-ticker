from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import sys

cloud = Path(__file__).parents[1] / 'scripts/cloud-vm'
sys.path.insert(0, str(cloud))
spec = importlib.util.spec_from_file_location('kiwoom_9pay_live', cloud / 'kiwoom_9pay_live.py')
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)
KST = timezone(timedelta(hours=9))


def test_market_hours_gate():
    assert live.market_open(datetime(2026, 10, 19, 9, 0, tzinfo=KST))
    assert not live.market_open(datetime(2026, 10, 18, 10, 0, tzinfo=KST))
    assert not live.market_open(datetime(2026, 10, 19, 15, 36, tzinfo=KST))


def test_disabled_start_does_not_launch(monkeypatch):
    monkeypatch.delenv('NINEPAY_RESEARCH_ENABLED', raising=False)
    assert live.start_background('dummy-app', 'dummy-secret') is None
    assert not live.health_snapshot()['running']


def test_signal_dedupes_across_sources(monkeypatch):
    records = []
    monkeypatch.setattr(live, '_record', records.append)
    result = {'code': '005930', 'at': 10, 'price': 100, 'source': 'KIS rank polling',
              'volumeMissing': False, 'mfePct': 0.0, 'maePct': 0.0, 'signal': True}
    seen = set()
    before = live.health_snapshot()['signalCount']
    live._handle_signal(result, seen)
    live._handle_signal(result, seen)
    assert len(records) == 1
    assert records[0]['price'] == 100
    assert live.health_snapshot()['signalCount'] == before + 1
