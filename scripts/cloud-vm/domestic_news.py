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
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import naver_news

LOGGER = logging.getLogger('domestic_news')
CACHE_DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'domestic_news.db')
CACHE_TTL_SEC = 5 * 60
DART_URL = 'https://opendart.fss.or.kr/api/list.json'

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
             fetched_at REAL NOT NULL
           )'''
    )
    conn.commit()
    return conn


def _strip(value):
    return re.sub(r'\s+', ' ', html.unescape(str(value or ''))).strip()


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
    direct = _direct_match(title, description, code, name)
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
        'stockCode': str(code or '') if direct else '',
        'stockName': str(name or '') if direct else '',
        'relevance': 'direct' if direct else 'market',
    }


def _dart_items(code='', name='', now=None):
    api_key = os.environ.get('DART_API_KEY', '').strip()
    if not api_key:
        return []
    now = now or datetime.now(timezone.utc)
    request = urllib.request.Request(
        DART_URL + '?' + urllib.parse.urlencode({
            'crtfc_key': api_key,
            'bgn_de': (now - timedelta(days=2)).strftime('%Y%m%d'),
            'end_de': now.strftime('%Y%m%d'),
            'page_no': 1, 'page_count': 100, 'sort': 'date', 'sort_mth': 'desc',
        }),
        headers={'User-Agent': 'tistory-ticker/1.0'},
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode('utf-8'))
    except Exception:
        LOGGER.exception('DART disclosure fetch failed')
        return []
    if payload.get('status') not in (None, '000'):
        return []
    items = []
    for row in payload.get('list') or []:
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
        }
        item['id'] = _item_key(item)
        items.append(item)
    return items


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
            item.pop('item_key', None)
            item.pop('fetched_at', None)
            item['provider'] = 'DART' if item.get('kind') == 'disclosure' else 'Naver'
            result.append(item)
        if query_key == 'market':
            return result
        return [item for item in result if item.get('stockCode') == query_key or item.get('stockName') == query_key]
    finally:
        conn.close()


def _save(items):
    if not items:
        return
    conn = _connect()
    try:
        now = time.time()
        conn.executemany(
            '''INSERT OR REPLACE INTO domestic_news
               (item_key, title, link, description, pub_date, source, category, kind,
                stock_code, stock_name, relevance, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            [(
                item['id'], item['title'], item['link'], item.get('description', ''), item.get('pubDate', ''),
                item.get('source', ''), item.get('category', '일반'), item.get('kind', 'news'),
                item.get('stockCode', ''), item.get('stockName', ''), item.get('relevance', 'market'), now,
            ) for item in items],
        )
        conn.commit()
    finally:
        conn.close()


def _merge(items, limit, code=''):
    by_id = {}
    for item in items:
        if not item or not item.get('title'):
            continue
        key = item.get('id') or _item_key(item)
        existing = by_id.get(key)
        if existing is None or (item.get('kind') == 'disclosure' and existing.get('kind') != 'disclosure'):
            by_id[key] = item
    result = list(by_id.values())
    result.sort(key=lambda item: (
        item.get('kind') != 'disclosure',
        bool(code) and item.get('relevance') != 'direct',
        -_parse_pub_date(item.get('pubDate')).timestamp(),
    ))
    return result[:max(1, min(int(limit or 10), 50))]


def get_news(code='', name='', query='', limit=10):
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
            'items': _merge(cached + stale, limit, bool(code)),
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
    fresh.extend(_dart_items(code, name))
    _save(fresh)
    # API 장애나 일시적인 빈 응답에도 기존 기사를 화면에서 지우지 않는다.
    merged = _merge(fresh + cached + stale, limit, bool(code))
    return {
        'items': merged,
        'configured': bool(client_id and client_secret),
        'source': 'live' if fresh else 'cache',
        'providers': sorted(set(item.get('provider') for item in merged if item.get('provider'))),
    }
