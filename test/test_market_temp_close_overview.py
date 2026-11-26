import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'cloud-vm'))
import market_temp_extras as extras


def test_close_basis_respects_calendar_and_nightly_scan():
    assert extras.close_basis(datetime(2026, 11, 27, 19, 59)) == date(2026, 11, 26)
    assert extras.close_basis(datetime(2026, 11, 27, 20, 0)) == date(2026, 11, 27)
    assert extras.close_basis(datetime(2026, 11, 29, 21, 0)) == date(2026, 11, 27)
    assert extras.close_basis(datetime(2026, 10, 9, 21, 0)) == date(2026, 10, 8)


def test_exact_basis_returns_and_independent_ma_samples(monkeypatch):
    sessions = [date(2026, 11, 26) - timedelta(days=offset) for offset in range(450)]
    days = [day.isoformat() for day in sessions if day.weekday() < 5][:224]
    basis, previous = days[:2]
    monkeypatch.setattr(extras.index_daily_history, 'peek', lambda market: {
        'rows': [{'date': day, 'confirmed': True, 'close': 100} for day in days[1:]]
    })
    monkeypatch.setattr(extras.db_schema, 'load_future_chart', lambda conn, symbol, limit_days: [
        {'date': previous.replace('-', ''), 'close': 100},
        {'date': basis.replace('-', ''), 'close': 102} if symbol == 'KOSPI'
        else {'date': basis.replace('-', ''), 'close': None},
    ])
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE daily_prices(code, date, close, volume, PRIMARY KEY(code, date))')
    conn.executemany('INSERT INTO daily_prices VALUES (?, ?, ?, ?)', [
        (code, day, close if day == basis else 100, volume if day == basis else 1)
        for code, close, volume, history in [
            ('000001', 106, 1, days),
            ('000002', 96, 1, days[:5]),
            ('000003', 105, 0, days),
            ('000004', 104, 1, [basis] + days[2:]),
            ('000005', 100, 1, days[:20]),
        ] for day in history
    ])
    members = {f'{n:06}': 'KOSPI' if n < 5 else 'KOSDAQ' for n in range(1, 6)}
    markets = extras.market_summary(conn, members, basis, previous)['markets']
    kospi, kosdaq = markets['KOSPI'], markets['KOSDAQ']
    assert (kospi['sample'], kospi['up'], kospi['down'], kospi['medianChangePct']) == (2, 1, 1, 1.0)
    assert (kospi['indexChangePct'], kospi['gapPp']) == (2.0, 1.0)
    assert kospi['aboveMA']['5'] == {'above': 1, 'sample': 2, 'pct': 50.0}
    assert kospi['aboveMA']['224'] == {'above': 1, 'sample': 1, 'pct': 100.0}
    assert kosdaq['indexChangePct'] is None and kosdaq['gapPp'] is None
    assert kosdaq['medianChangePct'] == 0 and kosdaq['flat'] == 1
    assert kosdaq['aboveMA']['20']['pct'] == 0
    assert kosdaq['aboveMA']['224']['pct'] is None
    assert markets['all']['aboveMA']['5'] == {'above': 1, 'sample': 3, 'pct': 33.3}


def test_track_comparison_reuses_only_comparable_rows():
    pytest.importorskip('fcntl')
    from shape_scan import GROUPS, VERSION

    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE pattern_tracks(scanner, detected_date, code)')
    basis, previous = '2026-11-26', '2026-11-25'
    conn.executemany('INSERT INTO pattern_tracks VALUES (?, ?, ?)', [
        ('pattern:shape-v2:trendBreakout', basis, '111111'),
        ('pattern:shape-v2:trendBreakout', basis, '111111'),
        ('pattern:shape-v2:trendBreakout', basis, '222222'),
        ('pattern:shape-v2:trendBreakout', previous, '333333'),
        ('pattern:shape-v2:bottomFormation', basis, '444444'),
        ('pattern:shape:bottomFormation', previous, '555555'),
    ])
    now = datetime.fromisoformat('2026-11-27T02:00:00+09:00')
    shape = dict(version=VERSION, strategyVersion='chart-first-v2', dataDate=basis, mode='observation',
                 orderAuthorized=False, status='ok', scannedAt='2026-11-26T21:30:00+09:00',
                 groups={key: [] for key in GROUPS})
    shape['groups']['trendBreakout'] = [{'code': '111111', 'price': 100}]
    payload = {'shapeSelection': shape, 'dataDate': basis}
    assert extras.scanner_summary(conn, payload, previous, now) is None
    summary = extras.scanner_summary(conn, payload, basis, now)
    assert summary['previousTrackDate'] == previous
    assert summary['groups']['trendBreakout'] == {'candidates': 1, 'tracked': 2, 'trackDelta': 1}
    assert summary['groups']['bottomFormation'] == {'candidates': 0, 'tracked': 1, 'trackDelta': None}
    assert '111111' not in repr(summary) and 'price' not in repr(summary)
    assert extras.scanner_summary(conn, payload, basis, now + timedelta(days=2)) is None


def test_history_upsert_preserves_last_verified_section(monkeypatch, tmp_path):
    db = tmp_path / 'overview.db'
    conn = sqlite3.connect(db)
    extras.ensure_history_schema(conn)
    market = {'asOf': '2026-11-26', 'markets': {}}
    scanner = {'asOf': '2026-11-26', 'groups': {}}
    extras.save_history(conn, '2026-11-26', {'market': market, 'scanners': None})
    extras.save_history(conn, '2026-11-26', {'market': None, 'scanners': scanner})
    conn.close()
    monkeypatch.setattr(extras.db_schema, 'get_conn', lambda read_only: sqlite3.connect(db))
    assert extras.historical_overview(date(2026, 11, 26)) == {'market': market, 'scanners': scanner}
    assert extras.historical_overview(date(2026, 11, 28)) == {'market': None, 'scanners': None}
