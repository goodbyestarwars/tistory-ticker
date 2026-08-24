# -*- coding: utf-8 -*-
"""Quiver Quantitative congressional transaction adapter.

The browser never receives the provider key.  The endpoint is intentionally a
signal panel, not a copy-trading recommendation: congressional disclosures can
arrive well after the actual trade and the reported owner can be a spouse or
dependent.
"""

import json
import logging
import os
import sqlite3
import time
import urllib.parse
import urllib.request
from datetime import datetime

logger = logging.getLogger('congress_trading')

QUIVER_BASE_URL = 'https://api.quiverquant.com'
QUIVER_SOURCE_URL = 'https://www.quiverquant.com/congresstrading/stock/'
HTTP_TIMEOUT = 8
CACHE_TTL_SEC = 3 * 60 * 60
CACHE_DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'us_congress_trades_cache.db')


def _db_path():
    return os.environ.get('US_CONGRESS_CACHE_DB', '').strip() or CACHE_DB_FILE


def _connect():
    conn = sqlite3.connect(_db_path(), timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA busy_timeout=5000')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS us_congress_trades_cache (
            symbol TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
        )
    ''')
    return conn


def _load_cached(symbol):
    try:
        conn = _connect()
        row = conn.execute(
            'SELECT payload_json, fetched_at FROM us_congress_trades_cache WHERE symbol = ?',
            (symbol,),
        ).fetchone()
        conn.close()
        if row is None or time.time() - int(row['fetched_at']) >= CACHE_TTL_SEC:
            return None
        return json.loads(row['payload_json'])
    except (sqlite3.Error, TypeError, ValueError):
        logger.exception('Congress trades cache read failed for %s', symbol)
        return None


def _save_cached(symbol, payload):
    conn = None
    try:
        conn = _connect()
        with conn:
            conn.execute('''
                INSERT OR REPLACE INTO us_congress_trades_cache(symbol, payload_json, fetched_at)
                VALUES (?, ?, ?)
            ''', (symbol, json.dumps(payload, ensure_ascii=False), int(time.time())))
    except sqlite3.Error:
        logger.exception('Congress trades cache write failed for %s', symbol)
    finally:
        if conn is not None:
            conn.close()


def _get_json(symbol, api_key):
    query = urllib.parse.urlencode({
        'version': 'V2',
        'page_size': 50,
        'ticker': symbol,
    })
    request = urllib.request.Request(
        QUIVER_BASE_URL + '/beta/bulk/congresstrading?' + query,
        headers={
            'Authorization': 'Bearer ' + api_key,
            'User-Agent': 'tistory-ticker/1.0',
        },
    )
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return json.loads(response.read().decode('utf-8'))


def _records(payload):
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in ('data', 'results', 'trades'):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
    return []


def _first(row, *names):
    for name in names:
        value = row.get(name)
        if value not in (None, ''):
            return str(value).strip()
    return ''


def _date(value):
    value = str(value or '').strip()
    if not value:
        return None
    for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%m-%d-%Y', '%Y/%m/%d', '%Y-%m-%dT%H:%M:%S'):
        try:
            return datetime.strptime(value[:19], fmt).date()
        except ValueError:
            continue
    return None


def _normalise_date(value):
    parsed = _date(value)
    return parsed.isoformat() if parsed else str(value or '').strip()


def _normalise_trade(row, symbol):
    traded = _first(row, 'Traded', 'traded', 'TradeDate', 'trade_date', 'TransactionDate')
    filed = _first(row, 'Filed', 'filed', 'FiledDate', 'filed_date', 'ReportDate')
    traded_date = _date(traded)
    filed_date = _date(filed)
    delay_days = None
    if traded_date and filed_date:
        delay_days = max(0, (filed_date - traded_date).days)
    return {
        'symbol': _first(row, 'Ticker', 'ticker', 'Symbol', 'symbol') or symbol,
        'company': _first(row, 'Company', 'company', 'NameOfIssuer', 'name_of_issuer'),
        'member': _first(row, 'Name', 'name', 'Politician', 'politician', 'Member'),
        'transaction': _first(row, 'Transaction', 'transaction', 'Type', 'type'),
        'amount': _first(row, 'Trade_Size_USD', 'trade_size_usd', 'TradeSize', 'trade_size', 'Amount', 'amount'),
        'party': _first(row, 'Party', 'party'),
        'chamber': _first(row, 'Chamber', 'chamber'),
        'traded_date': _normalise_date(traded),
        'filed_date': _normalise_date(filed),
        'delay_days': delay_days,
    }


def get_trades(symbol, quiver_api_key=''):
    symbol = str(symbol or '').strip().upper()
    unavailable = {
        'symbol': symbol,
        'available': False,
        'source': 'Quiver Quantitative Congress Trading',
        'source_url': QUIVER_SOURCE_URL + urllib.parse.quote(symbol),
        'trades': [],
        'errors': [],
        'disclaimer': '공개 신고 기반 · 최대 45일 지연 가능 · 복사매매 신호 아님',
    }
    cached = _load_cached(symbol) if symbol else None
    if cached is not None:
        return cached
    if not symbol:
        unavailable['errors'] = ['symbol is required']
        return unavailable
    if not quiver_api_key:
        unavailable['errors'] = ['QUIVER_API_KEY is not configured']
        return unavailable
    try:
        rows = _records(_get_json(symbol, quiver_api_key))
        trades = [_normalise_trade(row, symbol) for row in rows]
        payload = dict(unavailable)
        payload.update({
            'available': True,
            'trades': trades[:20],
            'count': len(trades),
        })
        _save_cached(symbol, payload)
        return payload
    except Exception as exc:
        logger.warning('Quiver congressional trades failed for %s: %s', symbol, exc)
        unavailable['errors'] = ['Quiver API request failed']
        return unavailable
