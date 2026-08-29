# -*- coding: utf-8 -*-
"""국내 종목 뉴스와 DART 공시를 한 피드로 정규화한다.

네이버 API는 서버에서만 호출하고, 프론트엔드는 이 모듈을 노출한
/domestic-news만 사용한다. 검색 결과 전체를 매번 다시 가져오지 않도록
SQLite에 원문 메타데이터를 저장하고, 같은 제목/URL은 하나로 합친다.
"""

import hashlib
import html
import json
import logging
import os
import re
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import naver_news
import dart_client

LOGGER = logging.getLogger('domestic_news')
CACHE_DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'domestic_news.db')
CACHE_TTL_SEC = 5 * 60
DART_URL = 'https://opendart.fss.or.kr/api/list.json'
KIND_RSS_URL = ('https://kind.krx.co.kr/disclosure/rsstodaydistribute.do?'
                'method=searchRssTodayDistribute&repIsuSrtCd=&mktTpCd=0&'
                'searchCorpName=&currentPageSize=100')
WATCHLIST_DISCLOSURE_CACHE_TTL_SEC = 30 * 60
WATCHLIST_DISCLOSURE_MAX_PAGES = 3
KIND_CACHE_TTL_SEC = 30
_watchlist_disclosure_cache = {}
_watchlist_disclosure_cache_lock = threading.Lock()
_kind_cache = None
_kind_cache_lock = threading.Lock()

CATEGORY_RULES = (
    ('실적', ('영업이익', '순이익', '매출액', '실적', '어닝', '잠정실적', '분기')),
    ('수주·계약', ('수주', '계약', '공급계약', 'MOU', ' mou ')),
    ('배당', ('배당', '자사주', '소각')),
    ('증자·감자', ('유상증자', '무상증자', '감자', '전환사채', '신주')),
    ('M&A', ('인수', '합병', '매각', '지분 취득', '지분 매각')),
    ('규제·정책', ('정책', '규제', '법안', '관세', '금리', '정부')),
    ('목표주가·리포트', ('목표주가', '투자의견', '리포트', '증권사', '분석')),
    ('시장', ('코스피', '코스닥', '증시', '주식시장', '뉴욕증시', '환율')),
)


def _connect():
    conn = sqlite3.connect(CACHE_DB_FILE, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute(
        '''CREATE TABLE IF NOT EXISTS domestic_news (
             item_key TEXT PRIMARY KEY,
             title TEXT NOT NULL,
             link TEXT,
             description TEXT,
             pub_date TEXT,
             source TEXT,
             category TEXT,
             kind TEXT,
             stock_code TEXT,
             stock_name TEXT,
             relevance TEXT,
             source_status TEXT,
             alternate_link TEXT,
             source_links TEXT,
             fetched_at REAL NOT NULL
           )'''
    )
    columns = {row['name'] for row in conn.execute('PRAGMA table_info(domestic_news)').fetchall()}
    for name, definition in (
        ('source_status', 'TEXT'),
        ('alternate_link', 'TEXT'),
        ('source_links', 'TEXT'),
    ):
        if name not in columns:
            conn.execute('ALTER TABLE domestic_news ADD COLUMN %s %s' % (name, definition))
    # 2026-08-30 속도 점검: item_key PRIMARY KEY 말고는 인덱스가 없어서
    # _load_cached()의 `WHERE fetched_at >= ? ORDER BY pub_date DESC`가 매번 전체
    # 테이블 스캔 + 전체 정렬이었다. 이 테이블은 삭제 정책이 없어 계속 자라기만 하고,
    # get_news()는 요청당 이 쿼리를 두 번(신선분 5분 + 폴백 24시간) 돌린다.
    # 라이브 측정: 외부 API를 전혀 안 타는 캐시 응답(source=cache)이 6~13초.
    # 종목별 조회(6.34초)와 전체 피드(6.43초)가 같은 시간이라 공통 구간인 이 쿼리가
    # 비용의 전부임을 확인했다. 범위 탐색으로 바꿔주는 인덱스만 추가한다(동작 불변).
    conn.execute('CREATE INDEX IF NOT EXISTS idx_domestic_news_fetched_at ON domestic_news(fetched_at)')
    # get_weekly_news()의 `WHERE kind = ? ORDER BY fetched_at DESC LIMIT 5000`용.
    conn.execute('CREATE INDEX IF NOT EXISTS idx_domestic_news_kind_fetched_at ON domestic_news(kind, fetched_at)')
    conn.commit()
    return conn


def ensure_schema():
    """스키마·인덱스를 요청 경로 밖(앱 기동 시)에서 한 번 만들어 둔다.

    `_connect()`의 CREATE INDEX IF NOT EXISTS는 인덱스가 이미 있으면 사실상 공짜지만,
    처음 만들 때는 테이블이 커진 만큼 시간이 걸리고 그동안 쓰기 락을 잡는다. 그 최초
    1회가 사용자 요청 중에 일어나면 다른 요청이 `timeout=10`에 걸려 실패할 수 있어
    기동 시점으로 옮긴다. 실패해도 다음 `_connect()`가 다시 시도하므로 치명적이지 않다.
    """
    conn = _connect()
    conn.close()


def _strip(value):
    return re.sub(r'\s+', ' ', html.unescape(str(value or ''))).strip()


def _compact(value):
    return re.sub(r'\s+', '', _strip(value)).lower()


def _title_direct_match(title, code, name):
    title_text = _compact(title)
    terms = (_compact(code), _compact(name))
    return bool(title_text) and any(term and term in title_text for term in terms)


def _canonical_url(url):
    parsed = urllib.parse.urlsplit(str(url or '').strip())
    if not parsed.scheme or not parsed.netloc:
        return ''
    query = [(key, value) for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
             if not key.lower().startswith(('utm_', 'gclid'))]
    return urllib.parse.urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path,
                                    urllib.parse.urlencode(query), ''))


def _item_key(item):
    url = _canonical_url(item.get('link'))
    base = url or _strip(item.get('title')).lower()
    return hashlib.sha1(base.encode('utf-8')).hexdigest()


def classify(title, description=''):
    text = ' ' + (_strip(title) + ' ' + _strip(description)).lower() + ' '
    for category, tokens in CATEGORY_RULES:
        if any(token.lower() in text for token in tokens):
            return category
    return '일반'


def _parse_pub_date(value):
    text = _strip(value)
    if not text:
        return datetime.min.replace(tzinfo=timezone.utc)
    for fmt in ('%a, %d %b %Y %H:%M:%S %z', '%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%d %H:%M:%S', '%Y%m%d'):
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.min.replace(tzinfo=timezone.utc)


def _date_key(value):
    parsed = _parse_pub_date(value)
    if parsed == datetime.min.replace(tzinfo=timezone.utc):
        digits = re.sub(r'[^0-9]', '', _strip(value))
        return digits[:8] if len(digits) >= 8 else ''
    return parsed.astimezone(timezone(timedelta(hours=9))).strftime('%Y%m%d')


def _source_links(item):
    raw = item.get('sourceLinks')
    if isinstance(raw, list):
        return [link for link in raw if isinstance(link, dict) and link.get('link')]
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [link for link in parsed if isinstance(link, dict) and link.get('link')]
        except (TypeError, ValueError):
            pass
    provider = str(item.get('provider') or item.get('source') or '').strip()
    link = str(item.get('link') or '').strip()
    return [{'provider': provider, 'link': link}] if link else []


def _compact_corp(value):
    return re.sub(r'[^0-9a-z가-힣]', '', _strip(value).lower().replace('주식회사', ''))


def _disclosure_terms(title, corp=''):
    text = _strip(title).lower()
    if corp:
        text = text.replace(_strip(corp).lower(), ' ')
    return set(re.findall(r'[0-9a-z가-힣]{2,}', text))


def _same_disclosure(left, right):
    """Conservative KIND↔DART match; same company/date plus strong title overlap only."""
    left_corp = _compact_corp(left.get('stockName') or left.get('corp'))
    right_corp = _compact_corp(right.get('stockName') or right.get('corp'))
    if not left_corp or left_corp != right_corp or _date_key(left.get('pubDate')) != _date_key(right.get('pubDate')):
        return False
    left_text = _compact(left.get('title')).replace(left_corp, '')
    right_text = _compact(right.get('title')).replace(right_corp, '')
    if not left_text or not right_text:
        return False
    if left_text in right_text or right_text in left_text:
        return True
    return len(_disclosure_terms(left.get('title'), left.get('stockName') or left.get('corp'))
               & _disclosure_terms(right.get('title'), right.get('stockName') or right.get('corp'))) >= 2


def _merge_disclosure_pair(left, right):
    sources = _source_links(left) + _source_links(right)
    unique = {}
    for source in sources:
        key = (source.get('provider'), source.get('link'))
        if key[1]:
            unique[key] = source
    links = list(unique.values())
    dart = next((item for item in (left, right) if item.get('provider') == 'DART'), None)
    kind = next((item for item in (left, right) if item.get('provider') == 'KIND'), None)
    canonical = dict(dart or left)
    canonical['sourceStatus'] = 'dart-confirmed' if dart and kind else canonical.get('sourceStatus', 'dart-only')
    canonical['source'] = 'DART + KIND' if dart and kind else canonical.get('source', canonical.get('provider', ''))
    canonical['provider'] = 'DART' if dart else canonical.get('provider', '')
    canonical['sourceLinks'] = links
    canonical['alternateLink'] = kind.get('link') if dart and kind else ''
    canonical['kindLink'] = kind.get('link') if kind else canonical.get('kindLink', '')
    canonical['dartLink'] = dart.get('link') if dart else canonical.get('dartLink', '')
    return canonical


def _dedupe_disclosures(items):
    groups = []
    for item in items or []:
        if not item or not item.get('title'):
            continue
        current = dict(item)
        if not current.get('sourceStatus'):
            current['sourceStatus'] = 'kind-only' if current.get('provider') == 'KIND' else 'dart-only'
        match = next((index for index, group in enumerate(groups)
                      if _same_disclosure(group, current)), None)
        if match is None:
            groups.append(current)
        else:
            groups[match] = _merge_disclosure_pair(groups[match], current)
    groups.sort(key=lambda item: _parse_pub_date(item.get('pubDate')).timestamp(), reverse=True)
    return groups


def _kind_corp(value):
    text = _strip(value)
    return re.sub(r'^\[(?:유|코|코넥스)\]\s*', '', text).strip()


def _kind_items(code='', name=''):
    """Read today's KRX/KIND RSS and normalize it as a disclosure feed."""
    global _kind_cache
    now_ts = time.time()
    with _kind_cache_lock:
        rows = _kind_cache[1] if _kind_cache and now_ts - _kind_cache[0] < KIND_CACHE_TTL_SEC else None
    if rows is None:
        request = urllib.request.Request(KIND_RSS_URL, headers={'User-Agent': 'tistory-ticker/1.0'})
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                root = ET.fromstring(response.read())
            rows = []
            for row in root.findall('./channel/item'):
                title = _strip(row.findtext('title'))
                link = _strip(row.findtext('link'))
                author = _kind_corp(row.findtext('author'))
                if not title or not link:
                    continue
                corp = author
                detail = title
                if detail.startswith('['):
                    close = detail.find(']')
                    detail = detail[close + 1:].strip() if close >= 0 else detail
                if corp and detail.startswith(corp):
                    detail = detail[len(corp):].strip()
                item_link = link.replace('http://kind.krx.co.kr:80', 'https://kind.krx.co.kr')
                item = {
                    'id': _item_key({'title': title, 'link': item_link}),
                    'title': (corp + ' ' + detail).strip(),
                    'link': item_link,
                    'description': _strip(row.findtext('category')),
                    'pubDate': _strip(row.findtext('pubDate')),
                    'source': 'KIND', 'provider': 'KIND', 'category': '공시',
                    'kind': 'disclosure', 'stockCode': '', 'stockName': corp,
                    'market': 'KOSDAQ' if title.startswith('[코]') or title.startswith('[코넥스]') else 'KOSPI',
                    'relevance': 'market', 'sourceStatus': 'kind-only',
                    'sourceLinks': [{'provider': 'KIND', 'link': item_link}],
                }
                rows.append(item)
            with _kind_cache_lock:
                _kind_cache = (time.time(), rows)
        except Exception:
            LOGGER.exception('KIND disclosure RSS fetch failed')
            with _kind_cache_lock:
                rows = _kind_cache[1] if _kind_cache else []
    result = []
    for item in rows:
        if name and _compact_corp(name) not in _compact_corp(item.get('stockName')):
            continue
        copied = dict(item)
        if code:
            copied['stockCode'] = str(code)
            copied['relevance'] = 'direct'
        result.append(copied)
    return result


def _direct_match(title, description, code, name):
    if not code and not name:
        return False
    text = _strip(title) + ' ' + _strip(description)
    return (bool(code) and str(code) in text) or (bool(name) and str(name).strip() in text)


def normalize_naver(item, code='', name=''):
    title = _strip(item.get('title'))
    description = _strip(item.get('description'))
    link = _canonical_url(item.get('link')) or str(item.get('link') or '').strip()
    if not title or not link:
        return None
    title_direct = _title_direct_match(title, code, name)
    body_direct = not title_direct and _direct_match(title, description, code, name)
    return {
        'id': _item_key({'title': title, 'link': link}),
        'title': title,
        'link': link,
        'description': description,
        'pubDate': _strip(item.get('pubDate')),
        'source': _strip(item.get('source')) or 'Naver News',
        'provider': 'Naver',
        'category': classify(title, description),
        'kind': 'news',
        'stockCode': str(code or '') if title_direct else '',
        'stockName': str(name or '') if title_direct else '',
        'relevance': 'direct' if title_direct else 'body' if body_direct else 'market',
    }


def _dart_items(code='', name='', now=None, start_date=None, end_date=None,
                corp_code='', max_pages=1):
    api_key = os.environ.get('DART_API_KEY', '').strip()
    if not api_key:
        return []
    now = now or datetime.now(timezone.utc)
    start_date = str(start_date or (now - timedelta(days=2)).strftime('%Y%m%d'))
    end_date = str(end_date or now.strftime('%Y%m%d'))
    max_pages = max(1, min(int(max_pages or 1), 10))
    rows = []
    for page_no in range(1, max_pages + 1):
        params = {
            'crtfc_key': api_key,
            'bgn_de': start_date,
            'end_de': end_date,
            'page_no': page_no, 'page_count': 100, 'sort': 'date', 'sort_mth': 'desc',
        }
        if corp_code:
            params['corp_code'] = str(corp_code)
        request = urllib.request.Request(
            DART_URL + '?' + urllib.parse.urlencode(params),
            headers={'User-Agent': 'tistory-ticker/1.0'},
        )
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                payload = json.loads(response.read().decode('utf-8'))
        except Exception:
            LOGGER.exception('DART disclosure fetch failed')
            return []
        if payload.get('status') == '013':
            break
        if payload.get('status') not in (None, '000'):
            return []
        page_rows = payload.get('list') or []
        rows.extend(page_rows)
        try:
            total_pages = int(payload.get('total_page') or page_no)
        except (TypeError, ValueError):
            total_pages = page_no
        if not page_rows or page_no >= total_pages:
            break
    items = []
    for row in rows:
        row_code = _strip(row.get('stock_code'))
        corp = _strip(row.get('corp_name'))
        if code and row_code and row_code != str(code):
            continue
        if code and not row_code and name and name not in corp:
            continue
        if name and not code and name not in corp:
            continue
        receipt = _strip(row.get('rcept_no'))
        title = corp + ' ' + _strip(row.get('report_nm'))
        if not corp or not receipt or not title.strip():
            continue
        item = {
            'id': '',
            'title': title,
            'link': 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + receipt,
            'description': _strip(row.get('flr_nm')),
            'pubDate': _strip(row.get('rcept_dt')),
            'source': 'DART',
            'provider': 'DART',
            'category': '공시',
            'kind': 'disclosure',
            'stockCode': row_code,
            'stockName': corp,
            'relevance': 'direct' if code else 'market',
            'sourceStatus': 'dart-only',
        }
        item['sourceLinks'] = [{'provider': 'DART', 'link': item['link']}]
        item['id'] = _item_key(item)
        items.append(item)
    return items


def get_watchlist_disclosures(codes, days=7, now=None, names_by_code=None):
    """Return recent watchlist disclosures, merging KIND speed with DART confirmation.

    DART's list API accepts ``corp_code`` rather than the six-digit stock code.
    The static mapping is shared with the fundamentals collector, then each
    company is fetched once and cached for 30 minutes. This avoids scanning the
    entire market on every personalized home-page request while still returning
    all filings (not a global top-five slice).
    """
    normalized_codes = []
    seen_codes = set()
    for value in codes or []:
        code = _strip(value)
        if not re.fullmatch(r'\d{6}', code) or code in seen_codes:
            continue
        seen_codes.add(code)
        normalized_codes.append(code)
    if not normalized_codes:
        return []

    api_key = os.environ.get('DART_API_KEY', '').strip()
    now = now or datetime.now(timezone(timedelta(hours=9)))
    days = max(1, min(int(days or 7), 31))
    start_date = (now - timedelta(days=days - 1)).strftime('%Y%m%d')
    end_date = now.strftime('%Y%m%d')
    try:
        corp_map = dart_client.get_corp_code_map(api_key) if api_key else {}
    except Exception:
        LOGGER.exception('DART corporation-code map fetch failed')
        corp_map = {}

    current_time = time.time()
    by_code = {}
    stale_by_code = {}
    missing = []
    with _watchlist_disclosure_cache_lock:
        for code in normalized_codes:
            cache_key = (code, start_date, end_date)
            cached = _watchlist_disclosure_cache.get(cache_key)
            if cached and current_time - cached[0] < WATCHLIST_DISCLOSURE_CACHE_TTL_SEC:
                by_code[code] = cached[1]
            else:
                if cached:
                    stale_by_code[code] = cached[1]
                missing.append(code)

    def fetch_code(code):
        corp_code = corp_map.get(code)
        if not corp_code:
            return code, []
        return code, _dart_items(
            code=code,
            now=now,
            start_date=start_date,
            end_date=end_date,
            corp_code=corp_code,
            max_pages=WATCHLIST_DISCLOSURE_MAX_PAGES,
        )

    if missing and api_key:
        with ThreadPoolExecutor(max_workers=min(6, len(missing))) as pool:
            fetched = list(pool.map(fetch_code, missing))
        with _watchlist_disclosure_cache_lock:
            for code, items in fetched:
                if not items and stale_by_code.get(code):
                    items = stale_by_code[code]
                cache_key = (code, start_date, end_date)
                _watchlist_disclosure_cache[cache_key] = (time.time(), items)
                by_code[code] = items
            # Date-keyed entries naturally expire, but remove old weeks so a
            # long-running VM cannot grow this small personalized cache forever.
            cutoff = time.time() - 2 * 24 * 60 * 60
            for cache_key, cached in list(_watchlist_disclosure_cache.items()):
                if cached[0] < cutoff:
                    _watchlist_disclosure_cache.pop(cache_key, None)

    merged_items = []
    for code in normalized_codes:
        for item in by_code.get(code, []):
            copied = dict(item)
            copied['relevance'] = 'direct'
            merged_items.append(copied)
    if names_by_code:
        for code in normalized_codes:
            name = _strip((names_by_code or {}).get(code))
            if not name:
                continue
            for item in _kind_items(code=code, name=name):
                item['stockName'] = name
                merged_items.append(item)
    start_key = (now - timedelta(days=days - 1)).strftime('%Y%m%d')
    result = [item for item in _dedupe_disclosures(merged_items)
              if _date_key(item.get('pubDate')) >= start_key]
    return result


def _load_cached(query_key, ttl_sec=CACHE_TTL_SEC):
    conn = _connect()
    try:
        rows = conn.execute(
            'SELECT * FROM domestic_news WHERE fetched_at >= ? ORDER BY pub_date DESC LIMIT 100',
            (time.time() - ttl_sec,),
        ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item['stockCode'] = item.pop('stock_code') or ''
            item['stockName'] = item.pop('stock_name') or ''
            item['pubDate'] = item.pop('pub_date') or ''
            item['sourceStatus'] = item.pop('source_status') or ''
            item['alternateLink'] = item.pop('alternate_link') or ''
            source_links = item.pop('source_links') or ''
            if source_links:
                try:
                    item['sourceLinks'] = json.loads(source_links)
                except (TypeError, ValueError):
                    item['sourceLinks'] = []
            item.pop('item_key', None)
            item.pop('fetched_at', None)
            item['provider'] = item.get('source') or ('DART' if item.get('kind') == 'disclosure' else 'Naver')
            # 예전 캐시에 본문 일치만으로 direct로 저장된 뉴스가 남아 있어도
            # 제목에 종목명이 없는 기사는 종목별 피드에서 직접 관련으로 재사용하지 않는다.
            if (query_key != 'market' and item.get('kind') == 'news'
                    and item.get('relevance') == 'direct'
                    and not _title_direct_match(item.get('title'), item.get('stockCode'), item.get('stockName'))):
                continue
            result.append(item)
        if query_key == 'market':
            return result
        return [item for item in result if item.get('stockCode') == query_key or item.get('stockName') == query_key]
    finally:
        conn.close()


def get_weekly_news(start, end, limit=120):
    """Return archived market news published inside the requested date window.

    The normal market feed intentionally uses a five-minute freshness window,
    but a weekend report must read the archive by publication date. The caller
    supplies the Friday-Sunday window so newer headlines do not replace it.
    """
    try:
        start_day = datetime.strptime(str(start)[:10], '%Y-%m-%d').date()
        end_day = datetime.strptime(str(end)[:10], '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return []
    conn = _connect()
    try:
        rows = conn.execute(
            'SELECT * FROM domestic_news WHERE kind = ? ORDER BY fetched_at DESC LIMIT 5000',
            ('news',),
        ).fetchall()
    finally:
        conn.close()
    result = []
    seen = set()
    for row in rows:
        item = dict(row)
        pub_date = item.get('pub_date') or ''
        published = _parse_pub_date(pub_date)
        if published.date() < start_day or published.date() > end_day:
            continue
        key = item.get('item_key') or _item_key(item)
        if key in seen:
            continue
        seen.add(key)
        item['stockCode'] = item.pop('stock_code') or ''
        item['stockName'] = item.pop('stock_name') or ''
        item['pubDate'] = item.pop('pub_date') or ''
        item.pop('item_key', None)
        item.pop('fetched_at', None)
        item['provider'] = 'Naver'
        result.append(item)
    # 수집기가 특정 날만 갱신된 경우를 보완한다. 네이버
    # 검색 API에는 조회수 필드가 없으므로, 조회수순을 가장하지 않고 날짜별
    # 발행 기사를 확보해 주간 타임라인이 하루에 몰리지 않게 한다.
    covered_days = {_parse_pub_date(item.get('pubDate')).date() for item in result
                    if item.get('pubDate') and _parse_pub_date(item.get('pubDate')) != datetime.min.replace(tzinfo=timezone.utc)}
    client_id = os.environ.get('NAVER_APIHUB_CLIENT_ID', '').strip()
    client_secret = os.environ.get('NAVER_APIHUB_CLIENT_SECRET', '').strip()
    if len(covered_days) < 3 and client_id and client_secret:
        # 2026-08-21 코드 감사: 여기서 쓰지도 않는 'oldest' 변수를 사전 초기화 없이
        # 참조+대입하는 줄이 있었다 - 이 조건(주말 커버리지 3일 미만)이 자주 참이라
        # 이 분기가 실행될 때마다 UnboundLocalError를 던졌고, 호출부의 try/except가
        # 조용히 삼켜 backfill 전체가 매번 빈 결과로 대체되고 있었다. 사용처가 없어
        # 그냥 삭제.
        backfill = []
        backfill_seen = set()
        def fetch_page(start_index):
            return naver_news.search_news(
                '코스피 코스닥 증시', client_id, client_secret,
                display=100, sort='date', start=start_index,
            )

        # 과거 페이지를 병렬로 조회해 보강 때문에 주간 리포트가 다시
        # 여러 API 타임아웃을 직렬로 기다리지 않도록 한다.
        with ThreadPoolExecutor(max_workers=3) as pool:
            pages = list(pool.map(fetch_page, (1, 101, 201)))
        for raw in pages:
            if not raw:
                continue
            for raw_item in raw:
                item = normalize_naver(raw_item)
                if not item:
                    continue
                published = _parse_pub_date(item.get('pubDate'))
                if published == datetime.min.replace(tzinfo=timezone.utc):
                    continue
                if start_day <= published.date() <= end_day:
                    key = item.get('id') or _item_key(item)
                    if key not in backfill_seen:
                        backfill_seen.add(key)
                        backfill.append(item)
                        covered_days.add(published.date())
        _save(backfill)
        result.extend(backfill)
    merged = {}
    for item in result:
        key = item.get('id') or _item_key(item)
        merged[key] = item
    result = list(merged.values())
    result.sort(key=lambda item: _parse_pub_date(item.get('pubDate')).timestamp(), reverse=True)
    return result[:max(1, min(int(limit or 120), 200))]


def _save(items):
    if not items:
        return
    conn = _connect()
    try:
        now = time.time()
        conn.executemany(
            '''INSERT OR REPLACE INTO domestic_news
               (item_key, title, link, description, pub_date, source, category, kind,
                stock_code, stock_name, relevance, source_status, alternate_link,
                source_links, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            [(
                item['id'], item['title'], item['link'], item.get('description', ''), item.get('pubDate', ''),
                item.get('source', ''), item.get('category', '일반'), item.get('kind', 'news'),
                item.get('stockCode', ''), item.get('stockName', ''), item.get('relevance', 'market'),
                item.get('sourceStatus', ''), item.get('alternateLink', ''),
                json.dumps(item.get('sourceLinks') or [], ensure_ascii=False), now,
            ) for item in items],
        )
        conn.commit()
    finally:
        conn.close()


def _merge(items, limit, code='', item_kind='all'):
    by_id = {}
    for item in items:
        if not item or not item.get('title'):
            continue
        key = item.get('id') or _item_key(item)
        existing = by_id.get(key)
        if existing is None or (item.get('kind') == 'disclosure' and existing.get('kind') != 'disclosure'):
            by_id[key] = item
    result = list(by_id.values())
    if item_kind == 'news':
        result = [item for item in result if item.get('kind') != 'disclosure']
    result.sort(key=lambda item: (
        item.get('kind') != 'disclosure',
        bool(code) and item.get('relevance') != 'direct',
        -_parse_pub_date(item.get('pubDate')).timestamp(),
    ))
    return result[:max(1, min(int(limit or 10), 50))]


def _select_stock_news(items, code='', name='', body_fallback_limit=3):
    """종목별 네이버 뉴스는 제목 일치 결과를 우선하고 본문 일치는 최소 보조로만 사용한다."""
    if not code and not name:
        return items
    title_items = []
    body_items = []
    other_items = []
    for item in items:
        if item.get('kind') != 'news':
            other_items.append(item)
        elif item.get('relevance') == 'direct':
            title_items.append(item)
        elif item.get('relevance') == 'body':
            body_items.append(item)
    return other_items + title_items + body_items[:max(0, body_fallback_limit - len(title_items))]


def _disclosure_items(code='', name=''):
    dart_items = _dart_items(code, name)
    kind_items = _kind_items(code, name)
    return _dedupe_disclosures(dart_items + kind_items)


def get_news(code='', name='', query='', limit=10, item_kind='all'):
    code = _strip(code)
    name = _strip(name)
    query = _strip(query)
    cache_key = code or name or 'market'
    cached = _load_cached(cache_key)
    stale = _load_cached(cache_key, ttl_sec=24 * 60 * 60)
    client_id = os.environ.get('NAVER_APIHUB_CLIENT_ID', '').strip()
    client_secret = os.environ.get('NAVER_APIHUB_CLIENT_SECRET', '').strip()
    if (cached or stale) and (len(cached) >= min(int(limit or 10), 10) or not (client_id and client_secret)):
        return {
            'items': _merge(cached + stale, limit, bool(code), item_kind),
            'configured': bool(client_id and client_secret),
            'source': 'cache',
            'providers': sorted(set(item.get('provider') for item in cached if item.get('provider'))),
        }

    fresh = []
    if client_id and client_secret:
        search_query = query or ((name + ' 주식') if name else '증시')
        raw = naver_news.search_news(search_query, client_id, client_secret,
                                     display=min(max(int(limit or 10) * 2, 10), 100))
        fresh.extend(item for item in (normalize_naver(raw_item, code, name) for raw_item in raw) if item)
    fresh.extend(_disclosure_items(code, name))
    fresh = _select_stock_news(fresh, code, name)
    _save(fresh)
    # API 장애나 일시적인 빈 응답에도 기존 기사를 화면에서 지우지 않는다.
    merged = _merge(fresh + cached + stale, limit, bool(code), item_kind)
    return {
        'items': merged,
        'configured': bool(client_id and client_secret),
        'source': 'live' if fresh else 'cache',
        'providers': sorted(set(item.get('provider') for item in merged if item.get('provider'))),
    }


def get_disclosures(limit=30):
    """최근 KIND/DART 공시를 속보용으로 반환한다.

    일반 종합뉴스는 성능을 위해 공시를 제외하지만, 속보 레일은 실적과
    관심종목 공시를 즉시 구분해야 하므로 DART 원문 메타데이터만 별도로 읽는다.
    호출 주기는 상위 WebSocket 캐시가 제한한다.
    """
    items = _disclosure_items()
    return items[:max(1, min(int(limit or 30), 30))]
