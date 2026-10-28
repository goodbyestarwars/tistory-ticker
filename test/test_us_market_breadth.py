import importlib.util
from pathlib import Path
from unittest.mock import patch
import pytest
import sys
sys.path.insert(0, str(Path(__file__).parents[1] / "scripts/cloud-vm"))

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

def test_volume_participation_excludes_missing_and_counts_one_vote_per_stock():
    data = payload([2, -1, 0, 1, 1])
    for row, value in zip(data['data'], [1000, 1.2, 1.0, 0, None]):
        row['d'].append(value)
    result = m.parse_breadth(data)['volumeParticipation']
    assert result['increased'] == 2 and result['eligible'] == 4 and result['total'] == 5
    assert result['ratio'] == .5
    assert result['median'] == 1.1
    assert result['basis'] == 'same-time-5m' and result['lookbackDays'] == 10
    assert m.parse_breadth(payload([1]))['volumeParticipation']['ratio'] is None


def test_domestic_and_us_have_independent_shared_caches():
    for cache in m._caches.values(): cache.update(at=0, attempt=0, data=None)
    with patch.object(m, '_fetch', return_value={'up': 1, 'down': 0, 'total': 1}) as fetch:
        us = m.get_breadth(1793116800, market='us')
        kr = m.get_breadth(1793116800, market='domestic')
        assert set(us['byIndex']) == {'SP500', 'NASDAQ'}
        assert set(kr['byIndex']) == {'KOSPI', 'KOSDAQ'}
        assert fetch.call_count == 4
        m.get_breadth(1793116801, market='domestic')
        assert fetch.call_count == 4
        assert fetch.call_args[0][1] == 'korea'

def test_volume_index_is_ratio_of_sums_not_mean_of_ratios():
    data = payload([1, -1])
    data['data'][0]['d'] += [2.0, 100]
    data['data'][1]['d'] += [1.0, 900]
    result = m.parse_breadth(data)['volumeIndex']
    assert result['current'] == 1000 and result['baseline'] == 950
    assert result['index100'] == pytest.approx(1000 / 950 * 100)
    assert result['index100'] != 150
    assert result['status'] == 'ok'


def test_volume_index_never_fills_missing_baseline_with_zero():
    assert m.parse_breadth(payload([1]))['volumeIndex']['index100'] is None
    data = payload([1, 1]); data['data'][0]['d'] += [0, 0]; data['data'][1]['d'] += [1, 100]
    assert m.parse_breadth(data)['volumeIndex']['status'] == 'unavailable'

def test_megacap_volume_does_not_weight_participation_or_median():
    data = payload([1] * 100)
    for i, row in enumerate(data['data']):
        row['d'] += [1.2 if i < 50 else .8, 100]
    before = m.parse_breadth(data)
    # Samsung/SK-sized volume shocks affect only the two corresponding votes.
    for row in data['data'][:2]:
        row['d'][2:] = [1000000, 10**15]
    after = m.parse_breadth(data)
    assert before['volumeParticipation']['ratio'] == after['volumeParticipation']['ratio'] == .5
    assert before['volumeParticipation']['median'] == after['volumeParticipation']['median'] == 1
    assert after['volumeIndex']['index100'] > before['volumeIndex']['index100']


@pytest.mark.parametrize('value', [None, float('nan'), float('inf'), -1, True])
def test_invalid_relative_volume_is_excluded_without_liquidity_filter(value):
    data = payload([1, -1, 0])
    for row, relative in zip(data['data'], [0, 1.2, value]):
        row['d'] += [relative, 0]
    result = m.parse_breadth(data)
    assert result['volumeParticipation']['eligible'] == 2
    assert result['volumeParticipation']['ratio'] == .5
    assert result['volumeParticipation']['median'] == .6
    assert result['volumeIndex']['status'] == 'unavailable'

def test_domestic_turnover_uses_shared_cache_and_preserves_volume_contracts():
    import domestic_turnover
    m._caches['domestic'].update(at=0,attempt=0,data=None)
    original=m.parse_breadth(payload([1,-1]))
    now=1793152800
    with patch.object(m,'_fetch',return_value=original),patch.object(domestic_turnover,'fetch_turnover',return_value={'status':'ok','index100':123}) as fetch:
        result=m.get_breadth(now,market='domestic')
        assert result['byIndex']['KOSPI']['turnoverIndex']['index100']==123
        assert result['byIndex']['KOSPI']['volumeIndex']==original['volumeIndex']
        assert result['byIndex']['KOSDAQ']['volumeParticipation']==original['volumeParticipation']
        assert m.get_breadth(now+1,market='domestic') is result
        assert fetch.call_count==2
        stale=m._stale(now+2,market='domestic')
        assert stale['byIndex']['KOSPI']['turnoverIndex']['status']=='stale'
        assert result['byIndex']['KOSPI']['turnoverIndex']['status']=='ok'
    m._caches['domestic'].update(at=0,attempt=0,data=None)
