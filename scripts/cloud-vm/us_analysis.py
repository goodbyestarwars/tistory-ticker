# -*- coding: utf-8 -*-
"""Finnhub US equity analysis data with a persistent, low-frequency cache."""

import json
import logging
import os
import sqlite3
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

logger = logging.getLogger('us_analysis')

FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'
HTTP_TIMEOUT = 8
CACHE_TTL_SEC = 6 * 60 * 60
PROFILE_CACHE_TTL_SEC = 24 * 60 * 60
CACHE_DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'us_analysis_cache.db')
_profile_cache = {}


def _db_path():
    return os.environ.get('US_ANALYSIS_CACHE_DB', '').strip() or CACHE_DB_FILE


def _connect():
    conn = sqlite3.connect(_db_path(), timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA busy_timeout=5000')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS us_analysis_cache (
            symbol TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
        )
    ''')
    return conn


def _get_json(path, params, api_key):
    query = dict(params or {})
    query['token'] = api_key
    url = FINNHUB_BASE_URL + path + '?' + urllib.parse.urlencode(query)
    request = urllib.request.Request(url, headers={'User-Agent': 'tistory-ticker/1.0'})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return json.loads(response.read().decode('utf-8'))


def _call(path, params, api_key):
    try:
        return _get_json(path, params, api_key)
    except Exception as exc:
        logger.warning('Finnhub %s failed: %s', path, exc)
        return None


def get_profile(symbol, finnhub_api_key=''):
    """종목판에서 재사용하는 업종·시가총액 프로필을 24시간 캐시한다."""
    symbol = str(symbol or '').strip().upper()
    if not symbol or not finnhub_api_key:
        return {}
    cached = _profile_cache.get(symbol)
    if cached and time.time() - cached[0] < PROFILE_CACHE_TTL_SEC:
        return cached[1]
    profile = _call('/stock/profile2', {'symbol': symbol}, finnhub_api_key) or {}
    _profile_cache[symbol] = (time.time(), profile)
    return profile


def _number(value):
    if value in (None, ''):
        return None
    try:
        return float(str(value).replace(',', '').replace('%', '').strip())
    except (TypeError, ValueError):
        return None


def _metric(metrics, *names):
    if not isinstance(metrics, dict):
        return None
    for name in names:
        value = _number(metrics.get(name))
        if value is not None:
            return value
    return None


def _records(payload, key=None):
    if key and isinstance(payload, dict):
        payload = payload.get(key)
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for name in ('data', 'earningsCalendar', 'recommendation', 'insiderTransactions'):
            if isinstance(payload.get(name), list):
                return [row for row in payload[name] if isinstance(row, dict)]
    return []


def _financial_value(financials, *names):
    """Return the newest reported income-statement value for any known field name."""
    rows = _records(financials)
    if not rows:
        return None
    report = rows[0].get('report') if isinstance(rows[0].get('report'), dict) else rows[0]
    containers = [report]
    for section in ('ic', 'income_statement'):
        section_value = report.get(section)
        if isinstance(section_value, dict):
            containers.insert(0, section_value)
        elif isinstance(section_value, list):
            wanted = [str(name).lower() for name in names]
            for item in section_value:
                if not isinstance(item, dict):
                    continue
                searchable = ' '.join(str(item.get(key) or '').lower() for key in ('concept', 'label', 'id', 'key'))
                for name in wanted:
                    if name == 'revenue':
                        matched = 'revenue' in searchable and not any(word in searchable for word in ('cost', 'expense', 'deferred'))
                    else:
                        matched = name in searchable
                    if matched:
                        value = item.get('value')
                        number = _number(value)
                        if number is not None:
                            return number
    for container in containers:
        for name in names:
            value = container.get(name) if isinstance(container, dict) else None
            if isinstance(value, dict):
                value = value.get('value')
            number = _number(value)
            if number is not None:
                return number
    return None


def _load_cached(symbol):
    try:
        conn = _connect()
        row = conn.execute(
            'SELECT payload_json, fetched_at FROM us_analysis_cache WHERE symbol = ?',
            (symbol,),
        ).fetchone()
        conn.close()
        if row is None or int(time.time()) - int(row['fetched_at']) >= CACHE_TTL_SEC:
            return None
        return json.loads(row['payload_json'])
    except (sqlite3.Error, TypeError, ValueError):
        logger.exception('US analysis cache read failed for %s', symbol)
        return None


def _save_cached(symbol, payload):
    conn = None
    try:
        conn = _connect()
        with conn:
            conn.execute('''
                INSERT OR REPLACE INTO us_analysis_cache(symbol, payload_json, fetched_at)
                VALUES (?, ?, ?)
            ''', (symbol, json.dumps(payload, ensure_ascii=False), int(time.time())))
    except sqlite3.Error:
        logger.exception('US analysis cache write failed for %s', symbol)
    finally:
        if conn is not None:
            conn.close()


def get_analysis(symbol, finnhub_api_key=''):
    symbol = str(symbol or '').strip().upper()
    cached = _load_cached(symbol)
    if cached is not None:
        return cached
    if not finnhub_api_key:
        return {
            'symbol': symbol,
            'available': False,
            'source': 'Finnhub key missing',
            'summary': {},
            'errors': ['FINNHUB_API_KEY is not configured'],
        }

    today = datetime.now(timezone.utc).date()
    metric_payload = _call('/stock/metric', {'symbol': symbol, 'metric': 'all'}, finnhub_api_key) or {}
    if isinstance(metric_payload, dict) and isinstance(metric_payload.get('metric'), dict):
        metric_payload = metric_payload['metric']
    payload = {
        'symbol': symbol,
        'available': True,
        'source': 'Finnhub',
        'profile': _call('/stock/profile2', {'symbol': symbol}, finnhub_api_key) or {},
        'metric': metric_payload,
        'financials': _call('/stock/financials-reported', {'symbol': symbol, 'freq': 'quarterly'}, finnhub_api_key) or {},
        'earnings': _call('/stock/earnings', {'symbol': symbol, 'limit': 4}, finnhub_api_key) or [],
        'earnings_calendar': _call('/calendar/earnings', {
            'from': today.isoformat(),
            'to': (today + timedelta(days=90)).isoformat(),
            'symbol': symbol,
            'international': 'false',
        }, finnhub_api_key) or {},
        'recommendations': _call('/stock/recommendation', {'symbol': symbol}, finnhub_api_key) or [],
        'insider_transactions': _call('/stock/insider-transactions', {'symbol': symbol}, finnhub_api_key) or {},
    }
    payload['summary'] = _build_summary(payload)
    _save_cached(symbol, payload)
    return payload


def _build_summary(payload):
    metrics = payload.get('metric') or {}
    earnings = _records(payload.get('earnings'))
    financial_rows = _records(payload.get('financials'))
    calendar = _records(payload.get('earnings_calendar'), 'earningsCalendar')
    recommendations = _records(payload.get('recommendations'))
    insiders = _records(payload.get('insider_transactions'))
    next_earnings = calendar[0] if calendar else {}
    latest_earnings = earnings[0] if earnings else {}
    latest_financial = financial_rows[0] if financial_rows else {}
    latest_recommendation = recommendations[0] if recommendations else {}
    insider_net = sum(_number(row.get('change')) or 0 for row in insiders)
    return {
        'pe': _metric(metrics, 'peTTM', 'peBasicExclExtraTTM'),
        'pb': _metric(metrics, 'pbAnnual', 'pbQuarterly'),
        'roe': _metric(metrics, 'roeTTM', 'roeAnnual'),
        'revenue_growth': _metric(metrics, 'revenueGrowthTTMYoy', 'revenueGrowth5Y'),
        'net_margin': _metric(metrics, 'netMarginTTM', 'netMarginAnnual'),
        'latest_statement_date': next((
            latest_financial.get(name) for name in ('filedDate', 'period', 'endDate')
            if latest_financial.get(name)
        ), None),
        'latest_revenue': _financial_value(
            payload.get('financials'), 'revenue', 'revenues', 'salesRevenueNet'
        ),
        'latest_net_income': _financial_value(
            payload.get('financials'), 'netIncome', 'netIncomeLoss', 'profitLoss'
        ),
        'next_earnings': next_earnings.get('date'),
        'next_earnings_hour': next_earnings.get('hour'),
        'eps_surprise_percent': _number(latest_earnings.get('surprisePercent')),
        'eps_actual': _number(latest_earnings.get('actual')),
        'eps_estimate': _number(latest_earnings.get('estimate')),
        'recommendation': {
            'strongBuy': latest_recommendation.get('strongBuy', 0),
            'buy': latest_recommendation.get('buy', 0),
            'hold': latest_recommendation.get('hold', 0),
            'sell': latest_recommendation.get('sell', 0),
            'strongSell': latest_recommendation.get('strongSell', 0),
        },
        'insider_net_change': insider_net,
        'insider_transaction_count': len(insiders),
    }
