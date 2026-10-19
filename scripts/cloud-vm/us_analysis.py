# -*- coding: utf-8 -*-
"""Finnhub US equity analysis data with a persistent, low-frequency cache."""

import json
import logging
import math
import re
import urllib.error
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
CACHE_VERSION = 3
PARTIAL_CACHE_TTL_SEC = 5 * 60
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
        logger.warning('Finnhub %s failed: %s', path, type(exc).__name__)
        return None


def get_profile(symbol, finnhub_api_key=''):
    """종목판에서 재사용하는 업종·시가총액 프로필을 24시간 캐시한다."""
    symbol = str(symbol or '').strip().upper()
    if not symbol or not finnhub_api_key:
        return {}
    cached = _profile_cache.get(symbol)
    if cached and time.time() - cached[0] < (PROFILE_CACHE_TTL_SEC if cached[1] else PARTIAL_CACHE_TTL_SEC):
        return cached[1]
    profile = _call('/stock/profile2', {'symbol': symbol}, finnhub_api_key) or {}
    _profile_cache[symbol] = (time.time(), profile)
    return profile


def _number(value):
    if value in (None, ''):
        return None
    try:
        number = float(str(value).replace(',', '').replace('%', '').strip())
        return number if math.isfinite(number) else None
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


def _financial_rows(financials):
    return sorted(_records(financials), key=lambda row: (
        str(row.get('endDate') or row.get('period') or ''),
        str(row.get('filedDate') or ''),
    ), reverse=True)


def _financial_value(financials, *names):
    """Exact income concepts only; retain the provider's reported duration (often YTD)."""
    rows = _financial_rows(financials)
    if not rows:
        return None
    report = rows[0].get('report') if isinstance(rows[0].get('report'), dict) else rows[0]
    revenue = any('revenue' in name.lower() for name in names)
    aliases = (('RevenueFromContractWithCustomerExcludingAssessedTax',
                'RevenueFromContractWithCustomerIncludingAssessedTax',
                'RevenueFromContractWithCustomer', 'Revenues', 'SalesRevenueNet', 'Revenue')
               if revenue else ('NetIncomeLoss', 'ProfitLoss', 'NetIncome'))
    def normalize(name):
        return str(name).split(':')[-1].split('_')[-1].lower()
    for section in ('ic', 'income_statement'):
        values = report.get(section)
        if isinstance(values, dict):
            items = [{'concept': key, 'value': value} for key, value in values.items()]
        elif isinstance(values, list):
            items = values
        else:
            items = []
        for alias in aliases:
            for item in items:
                if isinstance(item, dict) and normalize(item.get('concept') or item.get('id') or item.get('key')) == alias.lower():
                    value = item.get('value')
                    number = _number(value.get('value') if isinstance(value, dict) else value)
                    if number is not None:
                        return number
    for name in names:
        value = report.get(name)
        number = _number(value.get('value') if isinstance(value, dict) else value)
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
        payload = json.loads(row['payload_json'])
        if not isinstance(payload, dict) or payload.get('cache_version') != CACHE_VERSION:
            return None
        ttl = PARTIAL_CACHE_TTL_SEC if payload.get('partial') else CACHE_TTL_SEC
        return payload if int(time.time()) - int(row['fetched_at']) < ttl else None
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


def _analyst_ratings(symbol, api_key, today):
    """Firm-level events are distinct from the monthly consensus."""
    try:
        data = _get_json('/stock/upgrade-downgrade', {
            'symbol': symbol, 'from': (today - timedelta(days=89)).isoformat(),
            'to': today.isoformat(),
        }, api_key)
        lower = datetime.combine(today - timedelta(days=89), datetime.min.time(), tzinfo=timezone.utc).timestamp()
        upper = datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).timestamp()
        rows = [row for row in _records(data) if row.get('company') and row.get('toGrade')
                and lower <= (_number(row.get('gradeTime')) or 0) < upper]
        rows.sort(key=lambda row: _number(row.get('gradeTime')), reverse=True)
        return {'available': bool(rows), 'status': 'ready' if rows else 'no_data',
                'source': 'Finnhub', 'items': rows[:50]}
    except urllib.error.HTTPError as exc:
        return {'available': False, 'status': 'access_denied' if exc.code in (401, 403) else 'unavailable',
                'source': 'Finnhub', 'items': []}
    except Exception:
        return {'available': False, 'status': 'unavailable', 'source': 'Finnhub', 'items': []}


def _insider_summary(payload, today=None, issuer_cik=None):
    today = today or datetime.now(timezone.utc).date()
    start = today - timedelta(days=89)
    records, seen = [], set()
    missing_dates = 0
    labels = {'P': '공개시장·사적 매수', 'S': '공개시장·사적 매도', 'A': '주식 보상·취득',
              'M': '옵션 행사·전환', 'F': '세금·행사가격 지급', 'G': '증여', 'D': '발행사 처분'}
    for row in _records(payload):
        try:
            traded = datetime.strptime(str(row.get('transactionDate'))[:10], '%Y-%m-%d').date()
            filed = datetime.strptime(str(row.get('filingDate'))[:10], '%Y-%m-%d').date()
        except (TypeError, ValueError):
            missing_dates += 1
            continue
        if not (start <= traded <= today) or filed > today:
            continue
        code = str(row.get('transactionCode') or '').upper()
        change = _number(row.get('change'))
        key = tuple(str(row.get(k)) for k in ('id', 'name', 'transactionDate', 'transactionCode', 'change', 'share', 'transactionPrice', 'isDerivative'))
        if key in seen:
            continue
        seen.add(key)
        kind = 'buy' if code == 'P' and row.get('isDerivative') is False else 'sell' if code == 'S' and row.get('isDerivative') is False else 'other'
        if change is None:
            kind = 'other'
        filing_id = str(row.get('id') or '')
        source_url = None
        if (row.get('source') == 'sec' and re.fullmatch(r'\d{10}-\d{2}-\d{6}', filing_id)
                and re.fullmatch(r'\d{1,10}', str(issuer_cik or ''))):
            # Accession prefixes can be filing-agent CIKs, not issuer CIKs.
            source_url = 'https://www.sec.gov/Archives/edgar/data/%d/%s/%s-index.html' % (int(issuer_cik), filing_id.replace('-', ''), filing_id)
        records.append({'name': row.get('name'), 'transaction_date': traded.isoformat(),
                        'filing_date': filed.isoformat(), 'code': code, 'label': labels.get(code, '기타 지분 변동'),
                        'kind': kind, 'shares': abs(change) if change is not None else None,
                        'price': _number(row.get('transactionPrice')), 'currency': row.get('currency') or None,
                        'is_derivative': row.get('isDerivative'), 'source_url': source_url})
    records.sort(key=lambda row: (row['transaction_date'], row['filing_date']), reverse=True)
    buys = [row for row in records if row['kind'] == 'buy']
    sells = [row for row in records if row['kind'] == 'sell']
    available = isinstance(payload, list) or (isinstance(payload, dict) and isinstance(payload.get('data'), list))
    return {'available': available, 'source': 'Finnhub · 내부자 공시', 'from': start.isoformat(), 'to': today.isoformat(),
            'buy_shares': sum(row['shares'] for row in buys), 'sell_shares': sum(row['shares'] for row in sells),
            'buy_count': len(buys), 'sell_count': len(sells), 'other_count': len(records)-len(buys)-len(sells),
            'latest_filing': max((row['filing_date'] for row in records), default=None),
            'missing_dates': missing_dates, 'items': records, 'coverage': '제공처가 반환한 공시 범위 · 전체 공시 완전성 미보장'}


def get_analysis(symbol, finnhub_api_key='', instrument_type='UNKNOWN'):
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
    if instrument_type != 'ETF' and (not isinstance(metric_payload, dict) or not isinstance(metric_payload.get('metric'), dict) or not metric_payload.get('metric')):
        metric_payload = _call('/stock/metric', {'symbol': symbol, 'metric': 'all'}, finnhub_api_key) or {}
    if isinstance(metric_payload, dict) and isinstance(metric_payload.get('metric'), dict):
        metric_payload = metric_payload['metric']
    else:
        metric_payload = {}
    payload = {
        'symbol': symbol,
        'cache_version': CACHE_VERSION,
        'fetched_at': datetime.now(timezone.utc).isoformat(),
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
        'insider_transactions': _call('/stock/insider-transactions', {
            'symbol': symbol, 'from': (today - timedelta(days=89)).isoformat(), 'to': today.isoformat(),
        }, finnhub_api_key) or {},
        'analyst_ratings': _analyst_ratings(symbol, finnhub_api_key, today) if instrument_type != 'ETF' else {'available': False, 'status': 'not_applicable', 'items': []},
    }
    payload['summary'] = _build_summary(payload)
    # Valid providers may omit P/E for loss-making companies. Do not repeatedly
    # refetch a valid response just because a ratio is legitimately unavailable.
    payload['partial'] = instrument_type != 'ETF' and (not metric_payload or not _records(payload['financials']))
    payload['available'] = any((metric_payload, _records(payload['financials']), _records(payload['recommendations']), _records(payload['earnings'])))
    payload['errors'] = ['일부 재무자료 미확보; 5분 후 재조회'] if payload['partial'] else []
    _save_cached(symbol, payload)
    return payload


def _build_summary(payload):
    metrics = payload.get('metric') or {}
    earnings = _records(payload.get('earnings'))
    financial_rows = _financial_rows(payload.get('financials'))
    calendar = _records(payload.get('earnings_calendar'), 'earningsCalendar')
    recommendations = sorted(_records(payload.get('recommendations')), key=lambda row: str(row.get('period') or ''), reverse=True)
    insiders = _records(payload.get('insider_transactions'))
    next_earnings = calendar[0] if calendar else {}
    latest_earnings = earnings[0] if earnings else {}
    latest_financial = financial_rows[0] if financial_rows else {}
    latest_recommendation = recommendations[0] if recommendations else {}
    financial_payload = payload.get('financials') or {}
    issuer_cik = financial_payload.get('cik') if isinstance(financial_payload, dict) else None
    issuer_cik = issuer_cik or latest_financial.get('cik')
    insider_summary = _insider_summary(payload.get('insider_transactions'), issuer_cik=issuer_cik)
    insider_net = insider_summary['buy_shares'] - insider_summary['sell_shares']
    return {
        'pe': _metric(metrics, 'peTTM', 'peBasicExclExtraTTM'),
        'pb': _metric(metrics, 'pb', 'pbQuarterly', 'pbAnnual'),
        'roe': _metric(metrics, 'roeTTM', 'roeRfy', 'roeAnnual'),
        'revenue_growth': _metric(metrics, 'revenueGrowthTTMYoy'),
        'net_margin': _metric(metrics, 'netProfitMarginTTM', 'netMarginTTM', 'netProfitMarginAnnual', 'netMarginAnnual'),
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
        'statement_period': {'start': latest_financial.get('startDate'), 'end': latest_financial.get('endDate'), 'filed': latest_financial.get('filedDate'), 'form': latest_financial.get('form'), 'basis': '공시 원문 기간 합계 (분기 누적 포함)'},
        'metric_basis': {key: {
            'source': 'Finnhub', 'as_of': None,
            'field': next((name for name in names if _number(metrics.get(name)) is not None), None),
            'fetched_at': payload.get('fetched_at'),
        } for key, names in {
            'pe': ('peTTM', 'peBasicExclExtraTTM'),
            'pb': ('pb', 'pbQuarterly', 'pbAnnual'),
            'roe': ('roeTTM', 'roeRfy', 'roeAnnual'),
            'revenue_growth': ('revenueGrowthTTMYoy',),
            'net_margin': ('netProfitMarginTTM', 'netMarginTTM', 'netProfitMarginAnnual', 'netMarginAnnual'),
        }.items()},
        'next_earnings': next_earnings.get('date'),
        'next_earnings_hour': next_earnings.get('hour'),
        'eps_surprise_percent': _number(latest_earnings.get('surprisePercent')),
        'eps_actual': _number(latest_earnings.get('actual')),
        'eps_estimate': _number(latest_earnings.get('estimate')),
        'recommendation': {
            'available': bool(recommendations),
            'provider': 'Finnhub',
            'period': latest_recommendation.get('period'),
            'source_url': 'https://widget.finnhub.io/widgets/recommendation?symbol=' + urllib.parse.quote(str(payload.get('symbol') or '')),
            'docs_url': 'https://finnhub.io/docs/api/recommendation-trends',
            'strongBuy': latest_recommendation.get('strongBuy', 0),
            'buy': latest_recommendation.get('buy', 0),
            'hold': latest_recommendation.get('hold', 0),
            'sell': latest_recommendation.get('sell', 0),
            'strongSell': latest_recommendation.get('strongSell', 0),
        },
        'insider': insider_summary,
        'analyst_ratings': payload.get('analyst_ratings') or {'available': False, 'status': 'unavailable', 'items': []},
        'insider_net_change': insider_net,
        'insider_transaction_count': insider_summary['buy_count'] + insider_summary['sell_count'],
    }
