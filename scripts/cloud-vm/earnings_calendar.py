# -*- coding: utf-8 -*-
"""DART 정기 실적 공시를 캘린더 이벤트 형태로 제공한다.

DART에는 미래의 '예정일'이 아니라 실제 접수된 실적 공시가 기록되므로,
이 모듈은 발표가 확인된 날짜를 자동으로 캘린더에 추가한다. 예정일 데이터가
없는 기업은 임의의 날짜를 만들지 않는다.
"""

import json
import logging
import os
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta

BASE_URL = 'https://opendart.fss.or.kr/api/list.json'
FINNHUB_URL = 'https://finnhub.io/api/v1/calendar/earnings'
CACHE_TTL_SEC = 10 * 60
FINNHUB_CACHE_TTL_SEC = 10 * 60
_cache = {}
_finnhub_cache = {}
_logger = logging.getLogger('earnings_calendar')


def _fetch(api_key, start_date, end_date):
    params = {
        'crtfc_key': api_key,
        'bgn_de': start_date,
        'end_de': end_date,
        # 거래소 공시: 영업(잠정)실적, 연결재무제표 기준 잠정실적 등
        'pblntf_ty': 'I',
        'page_no': '1',
        'page_count': '100',
        'sort': 'date',
        'sort_mth': 'desc',
    }
    request = urllib.request.Request(
        BASE_URL + '?' + urllib.parse.urlencode(params),
        headers={'User-Agent': '9Pay-stock-calendar/1.0'},
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        data = json.loads(response.read().decode('utf-8'))
    if data.get('status') == '013':
        return []
    if data.get('status') != '000':
        raise RuntimeError('DART list status %s: %s' % (data.get('status'), data.get('message', '')))
    return data.get('list') or []


def fetch_month(year, month):
    """해당 월에 접수된 잠정실적/실적 관련 거래소 공시를 반환한다."""
    key = '%04d-%02d' % (int(year), int(month))
    cached = _cache.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL_SEC:
        return cached[1]

    api_key = os.environ.get('DART_API_KEY', '').strip()
    if not api_key:
        return []

    start_date = '%04d%02d01' % (int(year), int(month))
    if int(month) == 12:
        next_year, next_month = int(year) + 1, 1
    else:
        next_year, next_month = int(year), int(month) + 1
    end_date = '%04d%02d01' % (next_year, next_month)
    # end_de는 포함 경계가 불명확하므로 다음 달 1일을 넣고 결과를 월 기준으로 다시 거른다.
    rows = _fetch(api_key, start_date, end_date)
    events = []
    for row in rows:
        report_name = (row.get('report_nm') or '').strip()
        if not any(token in report_name for token in ('영업(잠정)실적', '잠정영업실적', '실적')):
            continue
        receipt_date = (row.get('rcept_dt') or '').strip()
        if len(receipt_date) != 8 or receipt_date[:6] != key.replace('-', ''):
            continue
        corp = (row.get('corp_name') or '').strip()
        receipt_no = (row.get('rcept_no') or '').strip()
        if not corp or not receipt_no:
            continue
        events.append({
            'title': '$%s 실적발표 | 자동(DART)' % corp,
            'start': '%s-%s-%s' % (receipt_date[:4], receipt_date[4:6], receipt_date[6:8]),
            'link': 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + receipt_no,
            'source': 'dart',
            'market': 'domestic',
        })
    _cache[key] = (time.time(), events)
    return events


def safe_fetch_month(year, month):
    try:
        return fetch_month(year, month)
    except Exception:
        _logger.exception('earnings calendar fetch failed for %s-%s', year, month)
        return []


def _fetch_finnhub(api_key, start_date, end_date):
    params = {
        'from': start_date,
        'to': end_date,
        'international': 'false',
        'token': api_key,
    }
    request = urllib.request.Request(
        FINNHUB_URL + '?' + urllib.parse.urlencode(params),
        headers={'User-Agent': '9Pay-stock-calendar/1.0'},
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        payload = json.loads(response.read().decode('utf-8'))
    if not isinstance(payload, dict):
        return []
    rows = payload.get('earningsCalendar')
    return rows if isinstance(rows, list) else []


def _finnhub_hour_label(hour):
    return {
        'bmo': '장전',
        'amc': '장후',
        'dmh': '장중',
    }.get(str(hour or '').lower(), '')


def fetch_us_month(year, month):
    """Finnhub 예정 실적일정을 월별 캘린더 이벤트로 변환한다."""
    key = '%04d-%02d' % (int(year), int(month))
    cached = _finnhub_cache.get(key)
    if cached and time.time() - cached[0] < FINNHUB_CACHE_TTL_SEC:
        return cached[1]

    api_key = os.environ.get('FINNHUB_API_KEY', '').strip()
    if not api_key:
        return []

    start = date(int(year), int(month), 1)
    end = (date(int(year) + 1, 1, 1) if int(month) == 12
           else date(int(year), int(month) + 1, 1)) - timedelta(days=1)
    rows = _fetch_finnhub(api_key, start.isoformat(), end.isoformat())
    events = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get('symbol') or '').strip().upper()
        event_date = str(row.get('date') or '').strip()
        if not symbol or not event_date or event_date[:7] != key:
            continue
        dedupe_key = (event_date, symbol)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        hour = _finnhub_hour_label(row.get('hour'))
        detail = '실적발표' + (' (' + hour + ')' if hour else '')
        company = str(row.get('company') or '').strip()
        if company:
            detail += ' · ' + company
        events.append({
            'title': '$%s %s | 미국(Finnhub)' % (symbol, detail),
            'start': event_date,
            'link': 'https://finnhub.io/docs/api/earnings-calendar',
            'source': 'finnhub',
            'market': 'us',
        })
    events.sort(key=lambda event: (event['start'], event['title']))
    _finnhub_cache[key] = (time.time(), events)
    return events


def safe_fetch_us_month(year, month):
    try:
        return fetch_us_month(year, month)
    except Exception:
        _logger.exception('Finnhub US earnings calendar fetch failed for %s-%s', year, month)
        return []


def _market_priority(event):
    market = str((event or {}).get('market') or '').strip().lower()
    if market in ('domestic', 'kr', 'korea'):
        return 0
    if market in ('us', 'usa', 'foreign'):
        return 1

    source = str((event or {}).get('source') or (event or {}).get('provider') or '')
    title = str((event or {}).get('title') or '').strip()
    source_title = (source + ' ' + title).lower()
    if 'dart' in source.lower() or any(token in source_title for token in ('국내', '한국', 'kospi', 'kosdaq')):
        return 0
    if 'finnhub' in source.lower() or any(token in source_title for token in ('미국', 'nasdaq', 'nyse', 's&p')):
        return 1
    return 1 if title.startswith('$') else 0


def _event_sort_key(event):
    start = str((event or {}).get('start') or '')
    return (start[:10], _market_priority(event), start, str((event or {}).get('title') or ''))


def merge_month(year, month):
    """국내 DART 발표일과 미국 Finnhub 예정일을 하나의 목록으로 합친다."""
    events = safe_fetch_month(year, month) + safe_fetch_us_month(year, month)
    seen = set()
    merged = []
    for event in events:
        key = (str(event.get('start') or ''), str(event.get('title') or '').strip())
        if key in seen:
            continue
        seen.add(key)
        merged.append(event)
    return sorted(merged, key=_event_sort_key)
