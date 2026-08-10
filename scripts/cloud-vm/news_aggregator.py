# -*- coding: utf-8 -*-
"""미국 종목 뉴스 통합기.

Alpha Vantage와 Finnhub는 선택형 공급자다. 키가 없거나 한 공급자가 실패해도
기존 네이버 뉴스는 계속 표시되도록 설계한다. 기사 본문은 저장하지 않고 제목,
출처, 발행시각, 원문 링크와 종목별 감성 메타데이터만 전달한다.
"""

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
from email.utils import parsedate_to_datetime

logger = logging.getLogger('news_aggregator')

ALPHA_URL = 'https://www.alphavantage.co/query'
FINNHUB_URL = 'https://finnhub.io/api/v1/company-news'
GOOGLE_NEWS_RSS_URL = 'https://news.google.com/rss/search'
HTTP_TIMEOUT = 8
FOREIGN_NEWS_LIMIT = 2
LOCAL_NEWS_LIMIT = 1
TOTAL_NEWS_LIMIT = 10

# Keep raw article bodies out of the database. This cache stores only the small
# metadata payload needed by the US news panel and survives API process restarts.
NEWS_CACHE_DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'us_news_cache.db')
NEWS_CACHE_TTL_SEC = 30 * 60
NEWS_CACHE_LOCK = threading.Lock()
GENERAL_NEWS_CACHE_TTL_SEC = 5 * 60
GENERAL_NEWS_CACHE_LOCK = threading.Lock()
_general_news_cache = (0, [])


def _cache_db_path():
    return os.environ.get('US_NEWS_CACHE_DB', '').strip() or NEWS_CACHE_DB_FILE


def _cache_ttl_sec():
    try:
        return max(0, int(os.environ.get('US_NEWS_CACHE_TTL_SEC', NEWS_CACHE_TTL_SEC)))
    except (TypeError, ValueError):
        return NEWS_CACHE_TTL_SEC


def _cache_connect():
    conn = sqlite3.connect(_cache_db_path(), timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA busy_timeout=5000')
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS us_news_cache (
            symbol TEXT NOT NULL,
            link TEXT NOT NULL,
            title TEXT NOT NULL,
            pub_date TEXT,
            source TEXT,
            provider TEXT,
            sentiment_json TEXT,
            published_ts INTEGER NOT NULL DEFAULT 0,
            fetched_at INTEGER NOT NULL,
            PRIMARY KEY (symbol, link)
        );
        CREATE TABLE IF NOT EXISTS us_news_cache_meta (
            symbol TEXT PRIMARY KEY,
            fetched_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_us_news_cache_symbol_published
            ON us_news_cache(symbol, published_ts DESC);
    ''')
    return conn


def load_cached_news(symbol, ttl_sec=None):
    """Return fresh cached news, an empty list for a fresh empty result, or None."""
    symbol = str(symbol or '').strip().upper()
    if not symbol:
        return None
    ttl = _cache_ttl_sec() if ttl_sec is None else max(0, int(ttl_sec))
    try:
        conn = _cache_connect()
        meta = conn.execute(
            'SELECT fetched_at FROM us_news_cache_meta WHERE symbol = ?',
            (symbol,),
        ).fetchone()
        if meta is None or int(time.time()) - int(meta['fetched_at']) >= ttl:
            conn.close()
            return None
        rows = conn.execute('''
            SELECT title, link, pub_date, source, provider, sentiment_json
            FROM us_news_cache
            WHERE symbol = ?
            ORDER BY published_ts DESC, fetched_at DESC
            LIMIT ?
        ''', (symbol, TOTAL_NEWS_LIMIT)).fetchall()
        conn.close()
    except sqlite3.Error:
        logger.exception('News cache read failed for %s', symbol)
        return None

    items = []
    for row in rows:
        item = {
            'title': row['title'],
            'link': row['link'],
            'pubDate': row['pub_date'] or '',
            'source': row['source'] or '',
            'provider': row['provider'] or '',
        }
        if row['sentiment_json']:
            try:
                item['sentiment'] = json.loads(row['sentiment_json'])
            except (TypeError, ValueError):
                pass
        items.append(item)
    return items


def save_cached_news(symbol, items):
    """Merge new rows into one symbol's cache and keep the latest ten atomically."""
    symbol = str(symbol or '').strip().upper()
    if not symbol:
        return
    fetched_at = int(time.time())
    conn = None
    try:
        conn = _cache_connect()
        with conn:
            existing_rows = conn.execute('''
                SELECT title, link, pub_date, source, provider, sentiment_json, published_ts
                FROM us_news_cache
                WHERE symbol = ?
            ''', (symbol,)).fetchall()
            existing = []
            for row in existing_rows:
                old = {
                    'title': row['title'],
                    'link': row['link'],
                    'pubDate': row['pub_date'] or '',
                    'source': row['source'] or '',
                    'provider': row['provider'] or '',
                    '_published_ts': row['published_ts'] or 0,
                }
                if row['sentiment_json']:
                    try:
                        old['sentiment'] = json.loads(row['sentiment_json'])
                    except (TypeError, ValueError):
                        pass
                existing.append(old)

            merged = {}
            for item in existing + list(items or []):
                title = str(item.get('title') or '').strip()
                link = str(item.get('link') or '').strip()
                if not title or not link:
                    continue
                key = _dedupe_key(item)
                current = merged.get(key)
                if current is None or _published_timestamp(item) >= _published_timestamp(current):
                    merged[key] = item

            selected = sorted(
                merged.values(),
                key=lambda item: _published_timestamp(item),
                reverse=True,
            )[:TOTAL_NEWS_LIMIT]
            conn.execute('DELETE FROM us_news_cache WHERE symbol = ?', (symbol,))
            for item in selected:
                title = str(item.get('title') or '').strip()
                link = str(item.get('link') or '').strip()
                sentiment = item.get('sentiment')
                conn.execute('''
                    INSERT OR REPLACE INTO us_news_cache
                    (symbol, link, title, pub_date, source, provider,
                     sentiment_json, published_ts, fetched_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    symbol,
                    link,
                    title,
                    item.get('pubDate') or '',
                    item.get('source') or '',
                    item.get('provider') or '',
                    json.dumps(sentiment, ensure_ascii=False, separators=(',', ':'))
                    if sentiment is not None else None,
                    _published_timestamp(item),
                    fetched_at,
                ))
            conn.execute('''
                INSERT OR REPLACE INTO us_news_cache_meta(symbol, fetched_at)
                VALUES (?, ?)
            ''', (symbol, fetched_at))
    except sqlite3.Error:
        logger.exception('News cache write failed for %s', symbol)
    finally:
        if conn is not None:
            conn.close()


def get_or_refresh_news(symbol, naver_fetcher=None, alpha_api_key='', finnhub_api_key='', limit=TOTAL_NEWS_LIMIT, ttl_sec=None):
    """Read SQLite first and fetch/replace only when this symbol's cache expires."""
    cached = load_cached_news(symbol, ttl_sec=ttl_sec)
    if cached is not None:
        return cached

    # A second check under the lock prevents duplicate provider calls when two
    # requests for the same symbol arrive at the same time in this process.
    with NEWS_CACHE_LOCK:
        cached = load_cached_news(symbol, ttl_sec=ttl_sec)
        if cached is not None:
            return cached
        try:
            naver_items = naver_fetcher() if naver_fetcher else []
        except Exception:
            logger.exception('Naver news failed for %s', symbol)
            naver_items = []
        items = merge_news(
            symbol,
            naver_items=naver_items,
            alpha_api_key=alpha_api_key,
            finnhub_api_key=finnhub_api_key,
            limit=limit,
        )
        save_cached_news(symbol, items)
        return items


def get_general_news(alpha_api_key='', finnhub_api_key='', limit=20, ttl_sec=None):
    """Return cached US market and macro news from Finnhub and Alpha Vantage."""
    global _general_news_cache
    try:
        ttl = GENERAL_NEWS_CACHE_TTL_SEC if ttl_sec is None else max(0, int(ttl_sec))
    except (TypeError, ValueError):
        ttl = GENERAL_NEWS_CACHE_TTL_SEC
    now = time.time()
    fetched_at, cached_items = _general_news_cache
    if fetched_at and now - fetched_at < ttl:
        return list(cached_items[:max(1, int(limit))])

    with GENERAL_NEWS_CACHE_LOCK:
        fetched_at, cached_items = _general_news_cache
        if fetched_at and now - fetched_at < ttl:
            return list(cached_items[:max(1, int(limit))])
        items = []
        providers = []
        if finnhub_api_key:
            providers.append(('Finnhub', lambda: _finnhub_general_news(finnhub_api_key)))
        if alpha_api_key:
            providers.append(('Alpha Vantage', lambda: _alpha_general_news(alpha_api_key)))
        if providers:
            with ThreadPoolExecutor(max_workers=len(providers)) as executor:
                futures = [(name, executor.submit(fetch)) for name, fetch in providers]
                for name, future in futures:
                    try:
                        items.extend(future.result())
                    except Exception:
                        logger.exception('%s general news failed', name)

        unique = {}
        for item in items:
            if not item.get('title') or not item.get('link'):
                continue
            key = _dedupe_key(item)
            current = unique.get(key)
            if current is None or item.get('_published_ts', 0) > current.get('_published_ts', 0):
                unique[key] = item
        selected = sorted(unique.values(), key=lambda item: item.get('_published_ts', 0), reverse=True)
        for item in selected:
            item.pop('_published_ts', None)
        _general_news_cache = (now, selected)
        return list(selected[:max(1, int(limit))])


def _published_timestamp(item):
    value = item.get('_published_ts')
    if value not in (None, '', 0):
        try:
            return int(value)
        except (TypeError, ValueError):
            pass
    return _parse_date(item.get('pubDate'))


def merge_news(symbol, naver_items=None, alpha_api_key='', finnhub_api_key='', limit=TOTAL_NEWS_LIMIT):
    """세 공급자의 종목별 뉴스를 중복 제거·최신순으로 합친다."""
    items = []
    if alpha_api_key:
        items.extend(_alpha_news(symbol, alpha_api_key))
    if finnhub_api_key:
        items.extend(_finnhub_news(symbol, finnhub_api_key))
    # 유료/선택형 키가 없거나 두 공급자가 기사를 못 주는 경우에도
    # 해외 뉴스 2개가 비지 않도록 영어권 Google News RSS를 보완합니다.
    foreign_count = sum(1 for item in items if item.get('provider') != 'Naver')
    if foreign_count < FOREIGN_NEWS_LIMIT:
        items.extend(_google_news(symbol))
    items.extend(_normalize_naver(item) for item in (naver_items or []))

    unique = {}
    for item in items:
        if not item.get('title') or not item.get('link'):
            continue
        key = _dedupe_key(item)
        current = unique.get(key)
        if current is None or item.get('_published_ts', 0) > current.get('_published_ts', 0):
            unique[key] = item

    result = sorted(unique.values(), key=lambda item: item.get('_published_ts', 0), reverse=True)
    max_items = max(1, int(limit))
    foreign = [item for item in result if item.get('provider') != 'Naver']
    local = [item for item in result if item.get('provider') == 'Naver']
    selected = (foreign[:FOREIGN_NEWS_LIMIT] + local[:LOCAL_NEWS_LIMIT])[:max_items]
    if len(selected) < max_items:
        selected_keys = {_dedupe_key(item) for item in selected}
        selected.extend(item for item in result if _dedupe_key(item) not in selected_keys)
        selected = selected[:max_items]
    selected = sorted(selected, key=lambda item: item.get('_published_ts', 0), reverse=True)
    for item in selected:
        item.pop('_published_ts', None)
    return selected


def _alpha_news(symbol, api_key):
    query = urllib.parse.urlencode({
        'function': 'NEWS_SENTIMENT',
        'tickers': symbol,
        'sort': 'LATEST',
        'limit': 10,
        'apikey': api_key,
    })
    try:
        payload = _get_json(ALPHA_URL + '?' + query)
    except Exception:
        logger.exception('Alpha Vantage news failed for %s', symbol)
        return []

    items = []
    for row in payload.get('feed', []) if isinstance(payload, dict) else []:
        title = _clean_text(row.get('title'))
        link = row.get('url') or ''
        if not title or not link:
            continue
        items.append({
            'title': title,
            'link': link,
            'pubDate': _format_alpha_time(row.get('time_published')),
            'source': _clean_text(row.get('source')) or 'Alpha Vantage',
            'provider': 'Alpha Vantage',
            'sentiment': _alpha_sentiment(row, symbol),
            '_published_ts': _parse_alpha_time(row.get('time_published')),
        })
    return items


def _alpha_general_news(api_key):
    query = urllib.parse.urlencode({
        'function': 'NEWS_SENTIMENT',
        'topics': 'financial_markets,economy_macro,economy_monetary,earnings',
        'sort': 'LATEST',
        'limit': 50,
        'apikey': api_key,
    })
    try:
        payload = _get_json(ALPHA_URL + '?' + query)
    except Exception:
        logger.exception('Alpha Vantage general news failed')
        return []

    items = []
    for row in payload.get('feed', []) if isinstance(payload, dict) else []:
        title = _clean_text(row.get('title'))
        link = row.get('url') or ''
        if not title or not link:
            continue
        items.append({
            'title': title,
            'link': link,
            'pubDate': _format_alpha_time(row.get('time_published')),
            'source': _clean_text(row.get('source')) or 'Alpha Vantage',
            'provider': 'Alpha Vantage',
            'category': '시장',
            'kind': 'news',
            'market': 'us',
            '_published_ts': _parse_alpha_time(row.get('time_published')),
        })
    return items


def _finnhub_news(symbol, api_key):
    today = datetime.now(timezone.utc).date()
    params = urllib.parse.urlencode({
        'symbol': symbol,
        'from': (today - timedelta(days=7)).isoformat(),
        'to': today.isoformat(),
        'token': api_key,
    })
    try:
        payload = _get_json(FINNHUB_URL + '?' + params)
    except Exception:
        logger.exception('Finnhub news failed for %s', symbol)
        return []

    items = []
    for row in payload if isinstance(payload, list) else []:
        title = _clean_text(row.get('headline'))
        link = row.get('url') or ''
        if not title or not link:
            continue
        published_ts = int(row.get('datetime') or 0)
        items.append({
            'title': title,
            'link': link,
            'pubDate': _format_unix_time(published_ts),
            'source': _clean_text(row.get('source')) or 'Finnhub',
            'provider': 'Finnhub',
            '_published_ts': published_ts,
        })
    return items[:10]


def _finnhub_general_news(api_key):
    query = urllib.parse.urlencode({'category': 'general', 'token': api_key})
    try:
        payload = _get_json('https://finnhub.io/api/v1/news?' + query)
    except Exception:
        logger.exception('Finnhub general news failed')
        return []

    items = []
    for row in payload if isinstance(payload, list) else []:
        title = _clean_text(row.get('headline'))
        link = row.get('url') or ''
        if not title or not link:
            continue
        published_ts = int(row.get('datetime') or 0)
        items.append({
            'title': title,
            'link': link,
            'pubDate': _format_unix_time(published_ts),
            'source': _clean_text(row.get('source')) or 'Finnhub',
            'provider': 'Finnhub',
            'category': '시장',
            'kind': 'news',
            'market': 'us',
            '_published_ts': published_ts,
        })
    return items[:50]


def _google_news(symbol):
    query = urllib.parse.urlencode({
        'q': '"' + symbol + '" stock',
        'hl': 'en-US',
        'gl': 'US',
        'ceid': 'US:en',
    })
    try:
        payload = _get_xml(GOOGLE_NEWS_RSS_URL + '?' + query)
    except Exception:
        logger.exception('Google News RSS failed for %s', symbol)
        return []

    items = []
    for row in payload.findall('.//item') if payload is not None else []:
        title = _clean_text(_xml_text(row, 'title'))
        link = _xml_text(row, 'link')
        pub_date = _xml_text(row, 'pubDate')
        source = _clean_text(_xml_text(row, 'source')) or 'Google News'
        if not title or not link:
            continue
        items.append({
            'title': title,
            'link': link,
            'pubDate': pub_date,
            'source': source,
            'provider': 'Google News (English)',
            '_published_ts': _parse_date(pub_date),
        })
    return items[:10]


def _normalize_naver(item):
    item = item or {}
    pub_date = item.get('pubDate') or ''
    return {
        'title': _clean_text(item.get('title')),
        'link': item.get('link') or '',
        'pubDate': pub_date,
        'source': _clean_text(item.get('source')) or '네이버',
        'provider': 'Naver',
        '_published_ts': _parse_date(pub_date),
    }


def _get_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'tistory-ticker/1.0'})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return json.loads(response.read().decode('utf-8'))


def _get_xml(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'tistory-ticker/1.0'})
    with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
        return ET.fromstring(response.read())


def _xml_text(node, name):
    if node is None:
        return ''
    for child in list(node):
        if str(child.tag).rsplit('}', 1)[-1] == name:
            return child.text or ''
    return ''


def _alpha_sentiment(row, symbol):
    for item in row.get('ticker_sentiment', []) if isinstance(row, dict) else []:
        if str(item.get('ticker', '')).upper() == symbol.upper():
            return {
                'label': item.get('ticker_sentiment_label'),
                'score': item.get('ticker_sentiment_score'),
                'relevance': item.get('relevance_score'),
            }
    return None


def _dedupe_key(item):
    link = str(item.get('link') or '').strip()
    parsed = urllib.parse.urlsplit(link)
    if parsed.netloc:
        return 'url:' + parsed.netloc.lower() + parsed.path.rstrip('/').lower()
    title = re.sub(r'\W+', ' ', str(item.get('title') or '').lower()).strip()
    return 'title:' + title


def _clean_text(value):
    text = html.unescape(str(value or ''))
    return re.sub(r'<[^>]+>', '', text).strip()


def _parse_alpha_time(value):
    try:
        return int(datetime.strptime(str(value), '%Y%m%dT%H%M%S').replace(tzinfo=timezone.utc).timestamp())
    except (TypeError, ValueError):
        return 0


def _format_alpha_time(value):
    stamp = _parse_alpha_time(value)
    return _format_unix_time(stamp) if stamp else str(value or '')


def _format_unix_time(value):
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    except (TypeError, ValueError, OverflowError, OSError):
        return ''


def _parse_date(value):
    text = str(value or '').strip()
    for fmt in ('%Y-%m-%d %H:%M UTC', '%Y-%m-%d %H:%M:%S UTC'):
        try:
            return int(datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).timestamp())
        except (TypeError, ValueError, OverflowError):
            pass
    try:
        return int(parsedate_to_datetime(text).timestamp())
    except (TypeError, ValueError, OverflowError):
        return 0
