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

BASE_URL = 'https://opendart.fss.or.kr/api/list.json'
CACHE_TTL_SEC = 10 * 60
_cache = {}
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
        })
    _cache[key] = (time.time(), events)
    return events


def safe_fetch_month(year, month):
    try:
        return fetch_month(year, month)
    except Exception:
        _logger.exception('earnings calendar fetch failed for %s-%s', year, month)
        return []
