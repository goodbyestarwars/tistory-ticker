import importlib.util
from pathlib import Path
from unittest.mock import patch
import pytest

spec = importlib.util.spec_from_file_location('us_market_breadth', Path(__file__).parents[1] / 'scripts/cloud-vm/us_market_breadth.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def payload(changes):
    return {'totalCount': len(changes), 'data': [{'s': 'NASDAQ:' + str(i), 'd': [value, 'delayed_streaming_900']} for i, value in enumerate(changes)]}


def test_complete_membership_counts_missing_separately():
    result = m.parse_breadth(payload([2, -1, 0, None, float('nan')]))
    assert (result['up'], result['down'], result['flat'], result['missing'], result['total']) == (1, 1, 1, 2, 5)
    assert result['delaySeconds'] == 900


def test_truncated_duplicate_and_empty_data_rejected():
    bad = payload([1, -1]); bad['totalCount'] = 503
    with pytest.raises(ValueError): m.parse_breadth(bad)
    bad = payload([1, -1]); bad['data'][1]['s'] = bad['data'][0]['s']
    with pytest.raises(ValueError): m.parse_breadth(bad)
    with pytest.raises(ValueError): m.parse_breadth(payload([None]))


def test_shared_cache_single_refresh_and_failure_backoff():
    m._cache.update(at=0, attempt=0, data=None)
    now = 1793116800
    with patch.object(m, '_fetch', return_value={'up': 2, 'down': 1, 'flat': 0, 'missing': 0, 'total': 3}) as fetch:
        result = m.get_breadth(now)
        assert fetch.call_count == 2
        assert m.get_breadth(now + 1) is result
        assert fetch.call_count == 2
    with patch.object(m, '_fetch', side_effect=ValueError('offline')) as fetch:
        result = m.get_breadth(now + 4000)
        assert all(entry['status'] == 'unavailable' for entry in result['byIndex'].values())
        m.get_breadth(now + 4001)
        assert fetch.call_count == 2
