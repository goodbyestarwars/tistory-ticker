import concurrent.futures
import importlib
import os
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta
from unittest.mock import patch

sys.path.insert(0, os.path.abspath('scripts/cloud-vm'))
import index_daily_history as history
import domestic_market_indicators as dmi
import market_clock


def candle(day, volume=100):
    return {'date': day, 'open': 10, 'high': 12, 'low': 9, 'close': 11, 'volume': volume}


def wait_job(market='KOSPI'):
    history._jobs[market].result(timeout=3)


def test_cold_get_does_not_block_and_parallel_requests_share_one_job():
    with tempfile.TemporaryDirectory() as path, patch.object(history, 'DIRECTORY', path):
        history._jobs.clear()
        release = threading.Event()
        calls = []
        def fetch(market, start, end):
            calls.append((market, start, end))
            release.wait(2)
            return [candle('2026-10-22'), candle('2026-10-23')]
        start = time.perf_counter()
        first = history.get('KOSPI', fetch)
        assert time.perf_counter() - start < .1
        assert not first['rows'] and first['cache']['refreshing']
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            list(pool.map(lambda _: history.get('KOSPI', fetch), range(20)))
        release.set()
        wait_job()
        assert len(calls) == 1
        got = history.get('KOSPI', fetch)
        assert len(got['rows']) == 2 and got['cache']['volumeUnit'] == 'unverified'


def test_restart_reads_disk_without_external_request():
    with tempfile.TemporaryDirectory() as path, patch.object(history, 'DIRECTORY', path):
        history._jobs.clear()
        history.get('KOSPI', lambda *args: [candle('2026-10-22'), candle('2026-10-23')])
        wait_job()
        # Clearing all process job state models a fresh reader; storage remains.
        history._jobs.clear()
        got = history.get('KOSPI', lambda *args: (_ for _ in ()).throw(AssertionError('refetch')))
        assert len(got['rows']) == 2 and not got['cache']['refreshing']
        assert got['cache']['lastSuccessAt'] and got['source'] == 'kis'


def test_incremental_skips_confirmed_history_and_keeps_failed_snapshot_then_recovers():
    with tempfile.TemporaryDirectory() as path, patch.object(history, 'DIRECTORY', path):
        history._jobs.clear()
        today = datetime.now(history.KST).strftime('%Y-%m-%d')
        yesterday = (datetime.now(history.KST) - timedelta(days=1)).strftime('%Y-%m-%d')
        before = (datetime.now(history.KST) - timedelta(days=2)).strftime('%Y-%m-%d')
        history.get('KOSPI', lambda *args: [candle(before), candle(yesterday), candle(today, 10)])
        wait_job()
        data = history._load('KOSPI')
        data['lastSuccess'] = data['lastAttempt'] = 0
        history._save('KOSPI', data)
        ranges = []
        def failing(market, start, end):
            ranges.append((start, end)); raise RuntimeError('provider offline')
        old = history.get('KOSPI', failing)
        assert old['cache']['usingLastValid']
        wait_job()
        failed = history.get('KOSPI', failing)
        assert ranges == [(today, today)]
        assert failed['rows'][-1]['volume'] == 10
        assert failed['cache']['lastErrorAt'] and failed['cache']['lastSuccessAt']
        assert not failed['cache']['refreshing']  # 60s failure backoff
        data = history._load('KOSPI'); data['lastAttempt'] = 0; history._save('KOSPI', data)
        history.get('KOSPI', lambda *args: [candle(today, 20), candle(before, 999)])
        wait_job()
        recovered = history.get('KOSPI', failing)
        assert recovered['rows'][0]['volume'] == 100  # old confirmed value untouched
        assert recovered['rows'][-1]['volume'] == 20
        assert recovered['cache']['lastError'] is None


def test_markets_keep_independent_persistent_data():
    with tempfile.TemporaryDirectory() as path, patch.object(history, 'DIRECTORY', path):
        history._jobs.clear()
        def fetch(market, *args):
            return [candle('2026-10-22', 10 if market == 'KOSPI' else 20), candle('2026-10-23')]
        history.get('KOSPI', fetch); history.get('KOSDAQ', fetch)
        wait_job('KOSPI'); wait_job('KOSDAQ')
        assert history.get('KOSPI', fetch)['rows'][0]['volume'] == 10
        assert history.get('KOSDAQ', fetch)['rows'][0]['volume'] == 20


def test_kis_history_rejects_missing_volume_and_filters_dates():
    rows = [{'stck_bsop_date':day,'bstp_nmix_oprc':'10','bstp_nmix_hgpr':'12',
             'bstp_nmix_lwpr':'9','bstp_nmix_prpr':'11',**volume}
            for day, volume in [('20261021',{'acml_vol':'99'}),('20261022',{}),('20261023',{'acml_vol':'0'})]]
    with patch.object(dmi.kis_client, 'get_token', return_value='fake'), patch.object(dmi.kis_client, 'fetch_index_period_chart', return_value=({}, rows)):
        got = dmi._fetch_kis_history_range('key','secret','KOSPI','2026-10-22','2026-10-23')
    assert len(got) == 1 and got[0]['date'] == '2026-10-23' and got[0]['volume'] == 0


def test_incremental_kis_stops_at_lower_bound_even_with_continuation_header():
    with patch.object(dmi.kis_client, '_get_domestic_quote', return_value=(
            {'output2': [{'stck_bsop_date':'20261023'}, {'stck_bsop_date':'20261022'}]}, 'M')) as request:
        dmi.kis_client.fetch_index_period_chart('token','key','secret','0001','20261023','20261023', max_pages=20)
    assert request.call_count == 1
