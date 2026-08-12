# -*- coding: utf-8 -*-
"""DART 정기 실적 공시를 캘린더 이벤트 형태로 제공한다.

DART에는 미래의 '예정일'이 아니라 실제 접수된 실적 공시가 기록되므로,
이 모듈은 발표가 확인된 날짜를 자동으로 캘린더에 추가한다. 예정일 데이터가
없는 기업은 임의의 날짜를 만들지 않는다.
"""

import json
import logging
import os
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from html.parser import HTMLParser

BASE_URL = 'https://opendart.fss.or.kr/api/list.json'
FINANCIALS_URL = 'https://opendart.fss.or.kr/api/fnlttSinglAcnt.json'
DART_DISCLOSURE_URL = 'https://dart.fss.or.kr/dsaf001/main.do'
DART_VIEWER_URL = 'https://dart.fss.or.kr/report/viewer.do'
FINNHUB_URL = 'https://finnhub.io/api/v1/calendar/earnings'
CACHE_TTL_SEC = 10 * 60
FINNHUB_CACHE_TTL_SEC = 10 * 60
DART_LIST_PAGE_COUNT = 100
DART_LIST_MAX_PAGES = 10
DART_RESULT_LOOKUP_MAX = 80
_cache = {}
_financials_cache = {}
_viewer_cache = {}
_finnhub_cache = {}
_logger = logging.getLogger('earnings_calendar')


def _fetch_page(api_key, start_date, end_date, page_no):
    params = {
        'crtfc_key': api_key,
        'bgn_de': start_date,
        'end_de': end_date,
        # 거래소 공시: 영업(잠정)실적, 연결재무제표 기준 잠정실적 등
        'pblntf_ty': 'I',
        'page_no': str(page_no),
        'page_count': str(DART_LIST_PAGE_COUNT),
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
        return {'status': '013', 'list': [], 'total_page': '0'}
    if data.get('status') != '000':
        raise RuntimeError('DART list status %s: %s' % (data.get('status'), data.get('message', '')))
    return data


def _fetch(api_key, start_date, end_date):
    """DART 거래소 공시를 페이지 끝까지 읽는다.

    실적 시즌에는 일반 공시가 1페이지(100건)를 먼저 채워서 실적공시가
    뒤로 밀릴 수 있다. 기존에는 첫 페이지만 읽어 당일 실적이 누락됐으므로,
    DART가 알려준 전체 페이지 수만큼(안전 상한 내에서) 순회한다.
    """
    rows = []
    for page_no in range(1, DART_LIST_MAX_PAGES + 1):
        data = _fetch_page(api_key, start_date, end_date, page_no)
        page_rows = data.get('list') or []
        rows.extend(page_rows)
        try:
            total_pages = int(data.get('total_page') or page_no)
        except (TypeError, ValueError):
            total_pages = page_no
        if not page_rows or page_no >= total_pages:
            break
    return rows


def _fetch_financials(api_key, corp_code, bsns_year, reprt_code):
    """Fetch the major accounts for one formal DART financial report."""
    key = (str(corp_code), str(bsns_year), str(reprt_code))
    cached = _financials_cache.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL_SEC:
        return cached[1]
    params = {
        'crtfc_key': api_key,
        'corp_code': str(corp_code),
        'bsns_year': str(bsns_year),
        'reprt_code': str(reprt_code),
    }
    request = urllib.request.Request(
        FINANCIALS_URL + '?' + urllib.parse.urlencode(params),
        headers={'User-Agent': '9Pay-stock-calendar/1.0'},
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        data = json.loads(response.read().decode('utf-8'))
    rows = data.get('list') or [] if data.get('status') == '000' else []
    _financials_cache[key] = (time.time(), rows)
    return rows


class _DartViewerParser(HTMLParser):
    """Extract table cells from the public DART disclosure viewer HTML."""

    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.rows = []
        self._row = None
        self._in_cell = False
        self._cell_parts = []

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self._row = []
        elif tag == 'td':
            self._in_cell = True
            self._cell_parts = []

    def handle_data(self, data):
        if self._row is not None and self._in_cell:
            self._cell_parts.append(data)

    def handle_endtag(self, tag):
        if tag == 'td' and self._row is not None:
            value = re.sub(r'\s+', ' ', ' '.join(self._cell_parts)).strip()
            self._row.append(value)
            self._cell_parts = []
            self._in_cell = False
        elif tag == 'tr' and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None


def _fetch_text(url):
    request = urllib.request.Request(url, headers={'User-Agent': '9Pay-stock-calendar/1.0'})
    with urllib.request.urlopen(request, timeout=12) as response:
        charset = response.headers.get_content_charset() or 'utf-8'
        return response.read().decode(charset, errors='replace')


def _viewer_document_url(event):
    receipt_no = str(event.get('receipt_no') or '').strip()
    if not receipt_no:
        return None
    cache_key = ('url', receipt_no)
    cached = _viewer_cache.get(cache_key)
    if cached and time.time() - cached[0] < CACHE_TTL_SEC:
        return cached[1]
    main_url = DART_DISCLOSURE_URL + '?' + urllib.parse.urlencode({'rcpNo': receipt_no})
    html = _fetch_text(main_url)
    pattern = r'viewDoc\(\s*["\']%s["\']\s*,\s*["\']([^"\']+)["\']\s*,\s*["\']([^"\']*)["\']\s*,\s*["\']([^"\']*)["\']\s*,\s*["\']([^"\']*)["\']\s*,\s*["\']([^"\']+)["\']' % re.escape(receipt_no)
    match = re.search(pattern, html)
    if not match:
        return None
    params = {
        'rcpNo': receipt_no,
        'dcmNo': match.group(1),
        'eleId': match.group(2),
        'offset': match.group(3),
        'length': match.group(4),
        'dtd': match.group(5),
    }
    url = DART_VIEWER_URL + '?' + urllib.parse.urlencode(params)
    _viewer_cache[cache_key] = (time.time(), url)
    return url


def _viewer_amount(value, multiplier):
    number = _number(value)
    if number is None:
        return None
    scaled = number * multiplier
    return int(scaled) if scaled.is_integer() else scaled


def _reported_dart_viewer_result(html):
    """Read actual-period revenue/profit values from a DART disclosure table."""
    unit_match = re.search(r'단위\s*[:：]\s*(조원|억원|백만원|천원|원)', html)
    if not unit_match:
        return None
    multiplier = {
        '조원': 1_000_000_000_000,
        '억원': 100_000_000,
        '백만원': 1_000_000,
        '천원': 1_000,
        '원': 1,
    }[unit_match.group(1)]
    parser = _DartViewerParser()
    parser.feed(html)

    aliases = (
        ('revenue_actual', ('매출액', '영업수익', '매출')),
        ('operating_profit_actual', ('영업이익', '영업손익')),
        ('net_income_actual', ('당기순이익', '당기순손익')),
    )
    values = {}
    for field, names in aliases:
        for row in parser.rows:
            normalized = [re.sub(r'\s+', '', cell) for cell in row]
            if not any(any(name in cell for name in names) for cell in normalized):
                continue
            try:
                actual_index = next(index for index, cell in enumerate(normalized) if cell == '당해실적')
            except StopIteration:
                continue
            for candidate in row[actual_index + 1:]:
                value = _viewer_amount(candidate, multiplier)
                if value is not None:
                    values[field] = value
                    break
            if field in values:
                break
    if not values:
        return None
    parts = []
    labels = (
        ('revenue_actual', '매출'),
        ('operating_profit_actual', '영업이익'),
        ('net_income_actual', '순이익'),
    )
    for field, label in labels:
        if field in values:
            parts.append('{} {}'.format(label, _format_krw(values[field])))
    values['result'] = ' · '.join(parts)
    return values


def _fetch_dart_viewer_result(event):
    receipt_no = str(event.get('receipt_no') or '').strip()
    if not receipt_no:
        return None
    cache_key = ('result', receipt_no)
    cached = _viewer_cache.get(cache_key)
    if cached and time.time() - cached[0] < CACHE_TTL_SEC:
        return cached[1]
    viewer_url = _viewer_document_url(event)
    if not viewer_url:
        return None
    result = _reported_dart_viewer_result(_fetch_text(viewer_url))
    _viewer_cache[cache_key] = (time.time(), result)
    return result


def _report_period(report_name, receipt_date):
    """Map a formal DART report name to (business year, report code)."""
    name = str(report_name or '')
    period_match = re.search(r'(20\d{2})[.\-/](0[1369]|12)', name)
    month = int(period_match.group(2)) if period_match else None
    year = int(period_match.group(1)) if period_match else int(str(receipt_date or '')[:4] or 0)
    if '사업보고서' in name or month == 12:
        return (year if period_match else year - 1, '11011')
    if '반기보고서' in name or '반기' in name or month == 6:
        return (year, '11012')
    if '3분기보고서' in name or '3분기' in name or month == 9:
        return (year, '11014')
    if '1분기보고서' in name or '1분기' in name or month == 3:
        return (year, '11013')
    # "영업(잠정)실적" 공시는 보고서명이 아니라 접수월로 분기를 추정한다.
    # DART가 공식 재무제표를 아직 공개하지 않은 경우에는 결과를 붙이지 않고
    # 기존의 "실적공시 완료" 항목만 유지한다.
    receipt_month = int(str(receipt_date or '')[4:6] or 0)
    if receipt_month <= 3:
        return (year - 1, '11011')
    if receipt_month <= 5:
        return (year, '11013')
    if receipt_month <= 8:
        return (year, '11012')
    if receipt_month <= 11:
        return (year, '11014')
    return (year, '11011')


def _number(value):
    if value in (None, '', '-'):
        return None
    try:
        return float(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def _format_krw(value):
    number = _number(value)
    if number is None:
        return None
    absolute = abs(number)
    sign = '-' if number < 0 else ''
    if absolute >= 1_000_000_000_000:
        return '{}{:.1f}조'.format(sign, absolute / 1_000_000_000_000)
    if absolute >= 100_000_000:
        return '{}{:.0f}억'.format(sign, absolute / 100_000_000)
    if absolute >= 10_000:
        return '{}{:.0f}만'.format(sign, absolute / 10_000)
    return '{}{:.0f}'.format(sign, absolute)


def _account_value(rows, names):
    """Select a consolidated account value, falling back to separate data."""
    candidates = [row for row in rows if str(row.get('account_nm') or '').strip() in names]
    if not candidates:
        return None
    def order(row):
        try:
            return int(row.get('ord') or 999)
        except (TypeError, ValueError):
            return 999
    candidates.sort(key=lambda row: (0 if row.get('fs_div') == 'CFS' else 1, order(row)))
    for row in candidates:
        value = _number(row.get('thstrm_amount'))
        if value is not None:
            return value
    return None


def _reported_dart_result(rows):
    revenue = _account_value(rows, {'매출액', '영업수익', '매출'})
    operating_profit = _account_value(rows, {'영업이익', '영업이익(손실)', '영업손익'})
    net_income = _account_value(rows, {'당기순이익', '당기순이익(손실)', '당기순손익'})
    parts = []
    if revenue is not None:
        parts.append('매출 {}'.format(_format_krw(revenue)))
    if operating_profit is not None:
        parts.append('영업이익 {}'.format(_format_krw(operating_profit)))
    if net_income is not None:
        parts.append('순이익 {}'.format(_format_krw(net_income)))
    return {
        'result': ' · '.join(parts),
        'revenue_actual': revenue,
        'operating_profit_actual': operating_profit,
        'net_income_actual': net_income,
    } if parts else None


def _enrich_dart_event(api_key, event):
    period = _report_period(event.get('report_name'), event.get('receipt_date'))
    corp_code = event.get('corp_code')
    result = None
    if api_key and corp_code and period:
        try:
            rows = _fetch_financials(api_key, corp_code, period[0], period[1])
            result = _reported_dart_result(rows)
        except Exception:
            _logger.exception('DART financial result fetch failed for %s', event.get('corp_name'))
    if not result:
        try:
            result = _fetch_dart_viewer_result(event)
        except Exception:
            _logger.exception('DART disclosure viewer result fetch failed for %s', event.get('corp_name'))
    if result:
        event.update(result)
    return event


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
        if not any(token in report_name for token in ('영업(잠정)실적', '잠정영업실적', '실적', '사업보고서', '반기보고서', '분기보고서')):
            continue
        receipt_date = (row.get('rcept_dt') or '').strip()
        if len(receipt_date) != 8 or receipt_date[:6] != key.replace('-', ''):
            continue
        corp = (row.get('corp_name') or '').strip()
        receipt_no = (row.get('rcept_no') or '').strip()
        if not corp or not receipt_no:
            continue
        # list.json은 숫자 재무제표가 아니라 실제 접수된 공시의 메타데이터를
        # 제공한다. 공시명을 함께 내려야 캘린더에서 어떤 실적 공시인지 확인할
        # 수 있고, 검색도 일반적인 "실적공시 완료" 문구에 갇히지 않는다.
        detail = '실적공시 완료'
        if report_name:
            detail += ' · ' + report_name
        event = {
            'title': '$%s %s | 자동(DART)' % (corp, detail),
            'start': '%s-%s-%s' % (receipt_date[:4], receipt_date[4:6], receipt_date[6:8]),
            'link': 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + receipt_no,
            'source': 'dart',
            'market': 'domestic',
            'status': 'reported',
            'corp_name': corp,
            'corp_code': (row.get('corp_code') or '').strip(),
            'report_name': report_name,
            'receipt_date': receipt_date,
            'receipt_no': receipt_no,
        }
        stock_code = (row.get('stock_code') or '').strip()
        if stock_code:
            event['symbol'] = stock_code
        events.append(event)
    lookup_events = [event for event in events if event.get('corp_code')][:DART_RESULT_LOOKUP_MAX]
    if lookup_events:
        with ThreadPoolExecutor(max_workers=6) as executor:
            enriched = list(executor.map(lambda item: _enrich_dart_event(api_key, item), lookup_events))
        for event in enriched:
            if event.get('result'):
                event['title'] = '$%s 실적발표 완료 · %s | 자동(DART)' % (event['corp_name'], event['result'])
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


def _number(value):
    if value in (None, ''):
        return None
    try:
        return float(str(value).replace(',', '').replace('%', '').strip())
    except (TypeError, ValueError):
        return None


def _format_eps(value):
    number = _number(value)
    return None if number is None else '{:.2f}'.format(number)


def _format_revenue(value):
    number = _number(value)
    if number is None:
        return None
    absolute = abs(number)
    if absolute >= 1_000_000_000:
        return '${:.1f}B'.format(number / 1_000_000_000)
    if absolute >= 1_000_000:
        return '${:.1f}M'.format(number / 1_000_000)
    if absolute >= 1_000:
        return '${:.1f}K'.format(number / 1_000)
    return '${:.0f}'.format(number)


def _surprise_text(actual, estimate):
    actual_number = _number(actual)
    estimate_number = _number(estimate)
    if actual_number is None or estimate_number is None:
        return ''
    if actual_number > estimate_number:
        direction = '상회'
    elif actual_number < estimate_number:
        direction = '하회'
    else:
        direction = '부합'
    if estimate_number == 0:
        return direction
    percent = (actual_number - estimate_number) / abs(estimate_number) * 100
    return '{} {:+.1f}%'.format(direction, percent)


def _reported_result(row):
    """Return the reported-result fields exposed by Finnhub's calendar row."""
    eps_actual = _number(row.get('epsActual'))
    eps_estimate = _number(row.get('epsEstimate'))
    revenue_actual = _number(row.get('revenueActual'))
    revenue_estimate = _number(row.get('revenueEstimate'))
    if eps_actual is None and revenue_actual is None:
        return None

    result_parts = []
    if eps_actual is not None:
        eps_text = 'EPS {}'.format(_format_eps(eps_actual))
        if eps_estimate is not None:
            eps_text += ' (예상 {}, {})'.format(
                _format_eps(eps_estimate), _surprise_text(eps_actual, eps_estimate)
            )
        result_parts.append(eps_text)
    if revenue_actual is not None:
        revenue_text = '매출 {}'.format(_format_revenue(revenue_actual))
        if revenue_estimate is not None:
            revenue_text += ' (예상 {}, {})'.format(
                _format_revenue(revenue_estimate), _surprise_text(revenue_actual, revenue_estimate)
            )
        result_parts.append(revenue_text)

    return {
        'status': 'reported',
        'eps_actual': eps_actual,
        'eps_estimate': eps_estimate,
        'revenue_actual': revenue_actual,
        'revenue_estimate': revenue_estimate,
        'result': ' · '.join(result_parts),
    }


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
        event = {
            'title': '$%s %s | 미국(Finnhub)' % (symbol, detail),
            'start': event_date,
            'link': 'https://finnhub.io/docs/api/earnings-calendar',
            'source': 'finnhub',
            'market': 'us',
            'status': 'scheduled',
        }
        result = _reported_result(row)
        if result:
            event['title'] = '$%s 실적발표 완료 · %s | 미국(Finnhub)' % (symbol, result['result'])
            event.update(result)
        events.append(event)
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


def _merge_events(events):
    seen = set()
    merged = []
    for event in events:
        key = (str(event.get('start') or ''), str(event.get('title') or '').strip())
        if key in seen:
            continue
        seen.add(key)
        merged.append(event)
    return sorted(merged, key=_event_sort_key)


def merge_month(year, month):
    """국내 DART 발표일과 미국 Finnhub 예정일을 하나의 목록으로 합친다."""
    return _merge_events(safe_fetch_month(year, month) + safe_fetch_us_month(year, month))


def merge_year(year):
    """해당 연도 1월 1일~12월 31일의 일정을 하나의 목록으로 합친다."""
    events = []
    def fetch_month_events(month):
        return safe_fetch_month(year, month) + safe_fetch_us_month(year, month)

    # 연간 검색은 12개월을 순차 조회하면 첫 검색이 지나치게 느려질 수 있어
    # 월별 공급자 캐시는 유지하면서 월 조회만 제한적으로 병렬화한다.
    with ThreadPoolExecutor(max_workers=6) as executor:
        for month_events in executor.map(fetch_month_events, range(1, 13)):
            events.extend(month_events)
    return _merge_events(events)
