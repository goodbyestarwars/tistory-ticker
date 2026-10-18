import sys
from datetime import datetime, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'research'))
from pre_surge_entry import first_crossings


def bar(minute, volume, price=100):
    return dict(ts=datetime(2026, 10, 16, 9, 0) + timedelta(minutes=minute), open=price, high=price, low=price, close=price, volume=volume)


def test_crossing_and_next_bar_entry():
    bars = [bar(i, 10 if i < 5 else 25, 100 + i) for i in range(35)]
    events = first_crossings(bars, 100)
    first = next(e for e in events if e['threshold'] == .3)
    assert first['detected_at'].endswith('09:03:00')
    assert first['entry_at'].endswith('09:03:00')
    assert first['entry_price'] == 103
    assert first['return_5m_net_pct'] is not None
    assert first['return_60m_net_pct'] is None


def test_no_future_fill_or_missing_minute():
    bars = [bar(0, 40), bar(2, 10)]
    event = first_crossings(bars, 100)[0]
    assert event['entry_price'] is None
    assert event['return_5m_net_pct'] is None


def test_no_crossing_after_0930():
    bars = [bar(i, 0 if i < 31 else 100) for i in range(34)]
    assert first_crossings(bars, 100) == []


def test_missing_opening_minute_rejected():
    assert first_crossings([bar(1, 100), bar(2, 10)], 100) == []
