from datetime import datetime, timedelta
from pathlib import Path
import sqlite3
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'cloud-vm'))
import alpaca_options as options


def test_collects_only_confirmed_0dte_and_upserts_same_slot(tmp_path):
    now = datetime(2026, 11, 23, 10, 5, tzinfo=options.NY)
    call, put = 'NVDA261123C00150000', 'NVDA261123P00150000'

    def request(_, path, headers, query=None):
        assert headers['APCA-API-KEY-ID'] == 'PK_TEST'
        if path == '/v2/clock':
            return {'is_open': True}
        assert query.get('expiration_date', '2026-11-23') == '2026-11-23'
        if path.endswith('/contracts'):
            if query.get('page_token'):
                return {'option_contracts': [
                    {'symbol': put, 'expiration_date': '2026-11-23', 'multiplier': '100'},
                ]}
            return {'option_contracts': [
                {'symbol': call, 'expiration_date': '2026-11-23', 'multiplier': '100',
                 'open_interest': '20', 'open_interest_date': '2026-11-20'},
                {'symbol': 'NVDA261124C00150000', 'expiration_date': '2026-11-24', 'multiplier': '100'},
            ], 'next_page_token': 'next'}
        if path.endswith('/snapshots/NVDA'):
            assert query['feed'] == 'indicative'
            return {'snapshots': {call: {'latestQuote': {'bp': 1, 'ap': 1.1, 't': now.isoformat()},
                                        'greeks': {'gamma': .01}, 'impliedVolatility': .4}}}
        return {'quote': {'t': now.isoformat(), 'bp': 150, 'ap': 150.1}}

    store = tmp_path / 'options.db'
    with patch.object(options, 'DB_FILE', store), patch.object(options, '_get', side_effect=request), \
            patch.object(options.time, 'time', return_value=now.timestamp()), \
            patch.dict('os.environ', {'APCA_API_KEY_ID': 'PK_TEST', 'APCA_API_SECRET_KEY': 'test'}):
        options._init_storage()
        payload = options.collect('NVDA', now)
        assert [item['option'] for item in payload['contracts']] == [call, put]
        assert payload['snapshot_count'] == 1 and 'gex' not in payload
        assert payload['contracts'][1]['gamma'] is None
        assert options.latest('NVDA')['available']
        assert not options.latest('SPY')['available']
        options.collect('NVDA', now + timedelta(seconds=5))
        options.collect('NVDA', now + timedelta(minutes=5))
        with sqlite3.connect(store) as db:
            assert db.execute('SELECT count(*) FROM options_0dte_symbols').fetchone() == (2,)


def test_paper_clock_prevents_holiday_collections(tmp_path):
    store = tmp_path / 'options.db'
    with patch.object(options, 'DB_FILE', store), patch.object(options, '_get', return_value={'is_open': False}) as get, \
            patch.dict('os.environ', {'APCA_API_KEY_ID': 'PK_TEST', 'APCA_API_SECRET_KEY': 'test'}):
        assert options.collect('SPY', datetime(2026, 11, 26, 10, tzinfo=options.NY)) is None
        assert get.call_count == 1 and not store.exists()


def test_migrates_nvda_and_separates_symbols_in_same_slot(tmp_path):
    store = tmp_path / 'options.db'
    now = datetime(2026, 11, 23, 10, 5, tzinfo=options.NY)
    stamp = int(now.timestamp())
    with sqlite3.connect(store) as db:
        db.execute('CREATE TABLE options_0dte (slot INTEGER PRIMARY KEY, collected_at INTEGER, session TEXT, payload TEXT)')
        db.execute('INSERT INTO options_0dte VALUES (?, ?, ?, ?)',
                   (stamp // 300, stamp, '2026-11-23', '{"symbol":"NVDA","status":"ready","collected_at":%s}' % stamp))
    with patch.object(options, 'DB_FILE', store), patch.object(options.time, 'time', return_value=stamp), \
            patch.dict('os.environ', {'APCA_API_KEY_ID': 'PK_TEST', 'APCA_API_SECRET_KEY': 'test'}):
        options._init_storage()
        options._init_storage()
        options._save(stamp, now.date(), {'symbol': 'SPY', 'status': 'no_expiry', 'collected_at': stamp})
        assert options.latest('NVDA')['available']
        assert options.latest('SPY')['symbol'] == 'SPY'
        assert options.latest('SPY')['status'] == 'no_expiry'
