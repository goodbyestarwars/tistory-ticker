"""Owner-only NVDA 0DTE observations from the Alpaca Paper Basic subscription."""
from contextlib import closing
import datetime as dt
import json
import logging
import math
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

import us_options

PAPER = 'https://paper-api.alpaca.markets'
DATA = 'https://data.alpaca.markets'
SYMBOL = 'NVDA'
NY = ZoneInfo('America/New_York')
INTERVAL = 300
DB_FILE = Path(__file__).with_name('alpaca_nvda_options.db')
logger = logging.getLogger(__name__)
_start_lock = threading.Lock()
_worker = None


def _headers():
    key = os.environ.get('APCA_API_KEY_ID', '')
    secret = os.environ.get('APCA_API_SECRET_KEY', '')
    if key.startswith('PK') and secret:
        return {'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret}
    return None


def _get(base, path, headers, parameters=None):
    url = base + path
    if parameters:
        url += '?' + urlencode(parameters)
    with urlopen(Request(url, headers=headers), timeout=10) as response:
        body = response.read(4 * 1024 * 1024 + 1)
    if len(body) > 4 * 1024 * 1024:
        raise ValueError('Alpaca response too large')
    return json.loads(body)


def _pages(base, path, headers, parameters, field, item_type):
    merged = item_type()
    seen = set()
    query = dict(parameters)
    for _ in range(12):
        page = _get(base, path, headers, query)
        items = page.get(field)
        if not isinstance(items, item_type):
            raise ValueError('Alpaca response missing chain field')
        if item_type is list:
            merged.extend(items)
        else:
            merged.update(items)
        token = page.get('next_page_token')
        if not token:
            return merged
        if token in seen:
            break
        seen.add(token)
        query['page_token'] = token
    raise ValueError('Alpaca pagination did not finish')


def _number(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) and value >= 0 else None


def _time(value):
    try:
        stamp = dt.datetime.fromisoformat(value)
        return int(stamp.timestamp()) if stamp.tzinfo else None
    except (TypeError, ValueError):
        return None


def _contracts(headers, day):
    definitions = _pages(PAPER, '/v2/options/contracts', headers, {
        'underlying_symbols': SYMBOL, 'expiration_date': day.isoformat(), 'limit': 1000,
    }, 'option_contracts', list)
    return {item['symbol']: item for item in definitions
            if item.get('expiration_date') == day.isoformat() and
            re.fullmatch(SYMBOL + day.strftime('%y%m%d') + r'[CP]\d{8}', item.get('symbol', ''))
            and _number(item.get('multiplier')) == 100}


def _normalize(definitions, snapshots):
    result = []
    for symbol, definition in sorted(definitions.items()):
        raw = snapshots.get(symbol) or {}
        quote = raw.get('latestQuote') or {}
        greeks = raw.get('greeks') or {}
        result.append({
            'option': symbol, 'strike': int(symbol[-8:]) / 1000, 'side': symbol[-9],
            'open_interest': _number(definition.get('open_interest')),
            'open_interest_date': definition.get('open_interest_date'),
            'gamma': _number(greeks.get('gamma')), 'iv': _number(raw.get('impliedVolatility')),
            'bid': _number(quote.get('bp')), 'ask': _number(quote.get('ap')),
            'quote_at': _time(quote.get('t')),
            'trade_at': _time((raw.get('latestTrade') or {}).get('t')),
        })
    return sorted(result, key=lambda row: (row['strike'], row['side']))


def _save(stamp, day, payload):
    os.close(os.open(DB_FILE, os.O_CREAT | os.O_WRONLY, 0o600))
    with closing(sqlite3.connect(DB_FILE)) as db, db:
        db.execute('CREATE TABLE IF NOT EXISTS options_0dte '
                   '(slot INTEGER PRIMARY KEY, collected_at INTEGER, session TEXT, payload TEXT)')
        db.execute('INSERT OR REPLACE INTO options_0dte VALUES (?, ?, ?, ?)',
                   (stamp // INTERVAL, payload['collected_at'], day.isoformat(), json.dumps(payload, allow_nan=False)))
        db.execute('DELETE FROM options_0dte WHERE slot < ?', ((stamp - 14 * 86400) // INTERVAL,))


def collect(now=None):
    headers = _headers()
    now = (now or dt.datetime.now(NY)).astimezone(NY)
    if not headers or now.weekday() >= 5 or not 570 <= now.hour * 60 + now.minute < 960:
        return None
    clock = _get(PAPER, '/v2/clock', headers)
    if clock.get('is_open') is not True:
        return None
    day = now.date()
    definitions = _contracts(headers, day)
    payload = {'symbol': SYMBOL, 'expiry': day.isoformat(), 'source': 'alpaca_indicative',
               'status': 'no_expiry', 'contracts': []}
    if definitions:
        snapshots = _pages(DATA, '/v1beta1/options/snapshots/' + SYMBOL, headers, {
            'feed': 'indicative', 'expiration_date': day.isoformat(), 'limit': 1000,
        }, 'snapshots', dict)
        if not definitions.keys() & snapshots.keys():
            raise ValueError('Alpaca returned no matching contract snapshots')
        contracts = _normalize(definitions, snapshots)
        payload.update(status='ready', contracts=contracts, snapshot_count=len(definitions.keys() & snapshots.keys()))
        # Reuse the existing GEX calculation, while keeping 0DTE out of all-expiry volume history.
        try:
            underlying = _get(DATA, '/v2/stocks/NVDA/quotes/latest', headers, {'feed': 'iex'}).get('quote') or {}
        except (OSError, ValueError) as error:
            logger.warning('Alpaca NVDA IEX quote unavailable: %s', type(error).__name__)
            underlying = {}
        bid, ask = _number(underlying.get('bp')), _number(underlying.get('ap'))
        price_at = _time(underlying.get('t'))
        quoted_at = max((row['quote_at'] or 0 for row in contracts), default=0)
        payload.update(underlying_at=price_at, quote_at=quoted_at or None)
        if bid and ask and bid <= ask and price_at and quoted_at and abs(price_at - quoted_at) <= 900:
            payload['underlying_price'] = (bid + ask) / 2
            if all(row['open_interest'] is not None and
                   (row['open_interest'] == 0 or row['gamma'] is not None) for row in contracts):
                result = us_options.summarize({'data': {
                    'current_price': payload['underlying_price'], 'options': contracts,
                }}, day, SYMBOL, now, include_overview=False)
                if result:
                    payload['gex'] = {key: result[key] for key in
                                      ('net', 'call_wall', 'put_wall', 'max_call_gex', 'max_put_gex', 'strikes')}
    slot_start = int(now.timestamp())
    payload['collected_at'] = int(time.time())
    _save(slot_start, day, payload)
    logger.info('Alpaca NVDA 0DTE saved session=%s status=%s contracts=%d',
                day, payload['status'], len(payload['contracts']))
    return payload


def latest(symbol):
    if symbol.upper() != SYMBOL:
        return {'available': False, 'status': 'unsupported'}
    if not _headers():
        return {'available': False, 'status': 'unconfigured'}
    if not DB_FILE.is_file():
        return {'available': False, 'status': 'waiting'}
    with closing(sqlite3.connect(DB_FILE.as_uri() + '?mode=ro', uri=True)) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='options_0dte'").fetchone():
            return {'available': False, 'status': 'waiting'}
        row = db.execute('SELECT payload FROM options_0dte ORDER BY slot DESC LIMIT 1').fetchone()
    if not row:
        return {'available': False, 'status': 'waiting'}
    payload = json.loads(row[0])
    payload['available'] = payload['status'] == 'ready'
    payload['stale'] = time.time() - payload['collected_at'] > 2 * INTERVAL
    return payload


def _run():
    while True:
        try:
            collect()
        except Exception as error:
            # URL, headers and response bodies are never written to logs.
            logger.warning('Alpaca NVDA 0DTE collection failed: %s %s',
                           type(error).__name__, getattr(error, 'code', ''))
        time.sleep(INTERVAL - time.time() % INTERVAL)


def start_background():
    global _worker
    if not _headers():
        return
    with _start_lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run, daemon=True, name='alpaca-options-0dte')
            _worker.start()
