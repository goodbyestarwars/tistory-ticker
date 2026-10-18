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
    result = {'code': '005930', 'at': 10, 'source': 'KIS rank polling',
              'volumeMissing': False, 'mfePct': 0.0, 'maePct': 0.0, 'signal': True}
    seen = set()
    before = live.health_snapshot()['signalCount']
    live._handle_signal(result, seen)
    live._handle_signal(result, seen)
    assert len(records) == 1
    assert live.health_snapshot()['signalCount'] == before + 1


def test_observation_status_is_safe_copy():
    live._set(candidateDetails=[{'code': '005930', 'name': '삼성전자', 'price': 100,
                                 'tradeVolume': 200, 'tradeAmountRaw': 300}], observations={})
    live._observe_status({'code': '005930', 'at': 5, 'price': 101, 'stage': 'surge',
                          'source': 'Kiwoom WebSocket', 'volumeMissing': False})
    snapshot = live.health_snapshot()
    assert snapshot['candidateDetails'][0]['name'] == '삼성전자'
    assert snapshot['observations']['005930']['stage'] == 'surge'
    snapshot['candidateDetails'][0]['name'] = 'changed'
    snapshot['observations']['005930']['stage'] = 'changed'
    assert live.health_snapshot()['candidateDetails'][0]['name'] == '삼성전자'
    assert live.health_snapshot()['observations']['005930']['stage'] == 'surge'


def test_previous_confirmed_day_must_match_calendar():
    import sqlite3
    db = sqlite3.connect(':memory:')
    db.execute('CREATE TABLE daily_prices(code,date,low,close,volume)')
    db.executemany('INSERT INTO daily_prices VALUES(?,?,?,?,?)', [
        ('005930', '2026-10-15', 90, 99, 1000), ('005930', '2026-10-16', 95, 100, 1200)])
    ctx = live._daily_context(db, datetime(2026, 10, 19, 9, tzinfo=KST), '005930')
    assert ctx['prevVolume'] == 1200 and ctx['lows'] == [90, 95]
    db.execute("DELETE FROM daily_prices WHERE date='2026-10-16'")
    assert live._daily_context(db, datetime(2026, 10, 19, 9, tzinfo=KST), '005930') == {}


def test_70_evidence_and_signal_survive_restart_without_resending(tmp_path, monkeypatch):
    monkeypatch.setattr(live, 'STATE_PATH', str(tmp_path / 'state.json'))
    monkeypatch.setattr(live, '_record', lambda record: None)
    live._set(observations={}, signals=[], candidateDetails=[], signalCount=0)
    o = live.logic.Observer(['005930'], {'005930': 1000})
    def ts(clock):
        return datetime.fromisoformat('2026-10-19T' + clock + '+09:00').timestamp()
    seen = set()
    for clock, price, volume in [('09:00:00', 100, 0), ('09:01:00', 110, 700),
                                  ('09:02:00', 108, 710), ('09:03:00', 111, 720)]:
        result = o.observe('005930', ts(clock), price, volume)
        live._consume(result, o, '2026-10-19', seen)
    restored = live.logic.Observer([], {})
    live._restore(restored, '2026-10-19')
    assert restored.tracks['005930'].first70_at == ts('09:01:00')
    assert not restored.observe('005930', ts('09:04:00'), 112, 730)['signal']
    assert len(live.health_snapshot()['signals']) == 1
    # Crash between saving the intent evidence and the rendered signal list.
    import json
    payload = json.loads((tmp_path / 'state.json').read_text(encoding='utf-8'))
    payload['signals'] = []
    (tmp_path / 'state.json').write_text(json.dumps(payload), encoding='utf-8')
    live._restore(live.logic.Observer([], {}), '2026-10-19')
    assert len(live.health_snapshot()['signals']) == 1
    assert live.health_snapshot()['signals'][0]['restored']


def test_publish_held_if_evidence_write_fails(monkeypatch):
    monkeypatch.setattr(live, '_persist', lambda observer, day: False)
    monkeypatch.setattr(live, '_record', lambda record: None)
    live._set(observations={}, signals=[], signalCount=0)
    result = {'code': '005930', 'at': 10, 'price': 100, 'signal': True,
              'signalAt': 10, 'first70At': 1, 'branches': ['A']}
    live._consume(result, None, '2026-10-19', set())
    assert not live.health_snapshot()['signals']
