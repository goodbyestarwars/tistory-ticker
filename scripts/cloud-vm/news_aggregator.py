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
import subprocess
import threading
import time
import urllib.parse
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

logger = logging.getLogger('news_aggregator')

ALPHA_URL = 'https://www.alphavantage.co/query'
FINNHUB_URL = 'https://finnhub.io/api/v1/company-news'
GOOGLE_NEWS_RSS_URL = 'https://news.google.com/rss/search'
SEC_CURRENT_FILINGS_URL = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom&count=100'
# 공개 RSS의 제목·링크만 사용한다. Bloomberg 피드는 간헐적으로 404/차단될 수
# 있으므로 한 공급자 실패가 전체 미국 뉴스 수집을 막지 않도록 개별 예외 처리한다.
MAJOR_NEWS_FEEDS = (
    ('CNBC', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114'),
    ('Bloomberg', 'https://feeds.bloomberg.com/markets/news.rss'),
)
HTTP_TIMEOUT = 8
FOREIGN_NEWS_LIMIT = 2
LOCAL_NEWS_LIMIT = 1
TOTAL_NEWS_LIMIT = 10
NEWS_CACHE_VERSION = 'major-publishers-v2'

# Keep raw article bodies out of the database. This cache stores only the small
# metadata payload needed by the US news panel and survives API process restarts.
NEWS_CACHE_DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'us_news_cache.db')
NEWS_CACHE_TTL_SEC = 30 * 60
NEWS_CACHE_LOCK = threading.Lock()
GENERAL_NEWS_CACHE_TTL_SEC = 5 * 60
GENERAL_NEWS_CACHE_LOCK = threading.Lock()
_general_news_cache = (0, [])
TRANSLATION_URL = 'https://translate.googleapis.com/translate_a/single'
TRANSLATION_FALLBACK_URL = 'https://api.mymemory.translated.net/get'
TRANSLATION_TIMEOUT_SEC = 5
TRANSLATION_CACHE_MAX = 2048
TRANSLATION_BATCH_SIZE = 10
TRANSLATION_RATE_LIMIT_COOLDOWN_SEC = 5 * 60
# 2026-09-05: 번역 캐시에 만료가 없어서 두 가지 문제가 있었다.
#   (1) 테이블이 무한히 커진다 - 메모리 캐시만 2048건 상한이 있고 SQLite는 없었다.
#   (2) 한번 이상하게 번역된 제목이 영구 고정된다 - 검증(한글 포함 + 원문과 다름)만
#       통과하면 오역이어도 계속 그 값을 쓰고, 고칠 방법이 없었다.
# updated_at을 기록만 하고 안 쓰고 있었으므로 그걸 만료 기준으로 삼는다. 지운 제목은
# 다음에 다시 나오면 새로 번역된다(무료 엔드포인트라 재번역 비용은 호출 한 번뿐).
TRANSLATION_CACHE_TTL_DAYS = 90
TRANSLATION_PRUNE_INTERVAL_SEC = 24 * 60 * 60
_translation_pruned_at = 0.0
TRANSLATION_CACHE_LOCK = threading.Lock()
TRANSLATION_REQUEST_LOCK = threading.Lock()
_translation_cache = {}
_translation_retry_after = 0
_translation_prefer_curl = False
SEC_FILINGS_CACHE_TTL_SEC = 5 * 60
SEC_FILINGS_LOCK = threading.Lock()
_sec_filings_cache = (0, [])


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
            fetched_at INTEGER NOT NULL,
            cache_version TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_us_news_cache_symbol_published
            ON us_news_cache(symbol, published_ts DESC);
        CREATE TABLE IF NOT EXISTS news_translation_cache (
            title TEXT PRIMARY KEY,
            translated TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
    ''')
    meta_columns = {row[1] for row in conn.execute('PRAGMA table_info(us_news_cache_meta)').fetchall()}
    if 'cache_version' not in meta_columns:
        conn.execute("ALTER TABLE us_news_cache_meta ADD COLUMN cache_version TEXT NOT NULL DEFAULT ''")
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
            'SELECT fetched_at, cache_version FROM us_news_cache_meta WHERE symbol = ?',
            (symbol,),
        ).fetchone()
        if (meta is None or meta['cache_version'] != NEWS_CACHE_VERSION
                or int(time.time()) - int(meta['fetched_at']) >= ttl):
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


def save_cached_news(symbol, items, retain_limit=TOTAL_NEWS_LIMIT):
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
            )[:max(TOTAL_NEWS_LIMIT, int(retain_limit or TOTAL_NEWS_LIMIT))]
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
                INSERT OR REPLACE INTO us_news_cache_meta(symbol, fetched_at, cache_version)
                VALUES (?, ?, ?)
            ''', (symbol, fetched_at, NEWS_CACHE_VERSION))
    except sqlite3.Error:
        logger.exception('News cache write failed for %s', symbol)
    finally:
        if conn is not None:
            conn.close()


def get_or_refresh_news(symbol, naver_fetcher=None, alpha_api_key='', finnhub_api_key='', limit=TOTAL_NEWS_LIMIT, ttl_sec=None, search_terms=''):
    """Read SQLite first and fetch/replace only when this symbol's cache expires."""
    cached = load_cached_news(symbol, ttl_sec=ttl_sec)
    if cached is not None:
        return translate_news_titles(cached, max_items=min(10, len(cached)))

    # A second check under the lock prevents duplicate provider calls when two
    # requests for the same symbol arrive at the same time in this process.
    with NEWS_CACHE_LOCK:
        cached = load_cached_news(symbol, ttl_sec=ttl_sec)
        if cached is not None:
            return translate_news_titles(cached, max_items=min(10, len(cached)))
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
            search_terms=search_terms,
        )
        save_cached_news(symbol, items)
        return translate_news_titles(items, max_items=min(10, len(items)))


def _valid_translation(original, translated):
    translated = str(translated or '').strip()
    return bool(translated and translated != original and re.search(r'[가-힣]', translated))


def _load_persistent_translations(titles):
    titles = list(dict.fromkeys(str(title or '').strip() for title in titles if str(title or '').strip()))
    if not titles:
        return {}
    conn = None
    try:
        conn = _cache_connect()
        placeholders = ','.join('?' for _ in titles)
        rows = conn.execute(
            'SELECT title, translated FROM news_translation_cache WHERE title IN (%s)' % placeholders,
            titles,
        ).fetchall()
        return {
            row['title']: row['translated'] for row in rows
            if _valid_translation(row['title'], row['translated'])
        }
    except sqlite3.Error:
        logger.warning('News translation cache read failed', exc_info=True)
        return {}
    finally:
        if conn is not None:
            conn.close()


def _save_persistent_translations(translations):
    valid = {
        str(title).strip(): str(translated).strip()
        for title, translated in (translations or {}).items()
        if _valid_translation(str(title).strip(), translated)
    }
    if not valid:
        return
    conn = None
    try:
        conn = _cache_connect()
        with conn:
            conn.executemany('''
                INSERT OR REPLACE INTO news_translation_cache(title, translated, updated_at)
                VALUES (?, ?, ?)
            ''', [(title, translated, int(time.time())) for title, translated in valid.items()])
    except sqlite3.Error:
        logger.warning('News translation cache write failed', exc_info=True)
    finally:
        if conn is not None:
            conn.close()


def prune_translation_cache(max_age_days=TRANSLATION_CACHE_TTL_DAYS):
    """오래된 번역 캐시 행을 지운다. 지운 행 수를 돌려준다.

    보관 기간이 지난 제목은 어차피 목록에서 사라진 기사다. 다시 나타나면 그때
    한 번 더 번역하면 되므로, 무한히 들고 있을 이유가 없다.
    """
    cutoff = int(time.time()) - int(max_age_days) * 86400
    conn = None
    try:
        conn = _cache_connect()
        with conn:
            cursor = conn.execute(
                'DELETE FROM news_translation_cache WHERE updated_at < ?', (cutoff,))
        removed = cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0
        if removed:
            logger.info('Pruned %d translation cache rows older than %d days', removed, max_age_days)
        return removed
    except sqlite3.Error:
        logger.warning('News translation cache prune failed', exc_info=True)
        return 0
    finally:
        if conn is not None:
            conn.close()


def forget_translations(titles):
    """지정한 제목의 번역을 캐시에서 지운다(메모리·SQLite 둘 다). 지운 행 수를 돌려준다.

    오역을 고치는 유일한 방법이다. 캐시가 남아 있으면 외부 호출 자체를 안 하므로
    행을 지워야 다음 조회 때 새로 번역한다. 프로세스가 여럿이면 메모리 캐시는 자기
    것만 지워지지만, SQLite에서 사라졌으므로 다른 프로세스도 다음 재시작 때 반영된다.
    """
    wanted = [str(title or '').strip() for title in (titles or [])]
    wanted = [title for title in wanted if title]
    if not wanted:
        return 0
    with TRANSLATION_CACHE_LOCK:
        for title in wanted:
            _translation_cache.pop(title, None)
    conn = None
    try:
        conn = _cache_connect()
        placeholders = ','.join('?' for _ in wanted)
        with conn:
            cursor = conn.execute(
                'DELETE FROM news_translation_cache WHERE title IN (%s)' % placeholders, wanted)
        return cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0
    except sqlite3.Error:
        logger.warning('News translation cache delete failed', exc_info=True)
        return 0
    finally:
        if conn is not None:
            conn.close()


def _remember_translations(translations):
    valid = {
        title: translated for title, translated in (translations or {}).items()
        if _valid_translation(title, translated)
    }
    if not valid:
        return
    with TRANSLATION_CACHE_LOCK:
        for title, translated in valid.items():
            while len(_translation_cache) >= TRANSLATION_CACHE_MAX:
                _translation_cache.pop(next(iter(_translation_cache)))
            _translation_cache[title] = translated
    _save_persistent_translations(valid)


def _request_translation_payload(query):
    """Use urllib first and fall back to the VM's existing curl binary.

    Google can rate-limit Python's TLS client fingerprint while accepting the exact
    same free request through curl. deploy_check.sh already requires curl on the VM,
    so this adds no package or paid service. Once fallback succeeds, the process keeps
    using curl and avoids a guaranteed rejected probe on every refresh.
    """
    global _translation_prefer_curl
    url = TRANSLATION_URL + '?' + query

    def via_curl():
        completed = subprocess.run(
            ['curl', '--fail', '--silent', '--show-error', '--max-time',
             str(TRANSLATION_TIMEOUT_SEC), url],
            capture_output=True,
            check=True,
            timeout=TRANSLATION_TIMEOUT_SEC + 2,
        )
        return json.loads(completed.stdout.decode('utf-8'))

    if _translation_prefer_curl:
        return via_curl()
    request = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'Mozilla/5.0 (compatible; tistory-ticker/1.0)',
            'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TRANSLATION_TIMEOUT_SEC) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as original_error:
        try:
            payload = via_curl()
            _translation_prefer_curl = True
            return payload
        except Exception:
            raise original_error


def _translate_with_mymemory(titles):
    """Free, keyless fallback used only while Google rejects the VM.

    MyMemory limits anonymous usage, so requests are kept below its short-text limit
    and successful results immediately enter SQLite. The fallback is therefore paid
    only once per unique headline and never runs for already cached titles.
    """
    titles = [str(title or '').strip() for title in titles]
    result = {}
    groups = []
    current = []
    current_chars = 0
    for index, title in enumerate(titles):
        if not title or not re.search(r'[A-Za-z]', title):
            continue
        segment = 'ZZZ%dZZZ %s' % (index, title[:400])
        if current and current_chars + 1 + len(segment) > 450:
            groups.append(current)
            current = []
            current_chars = 0
        current.append((index, segment))
        current_chars += len(segment) + (1 if current_chars else 0)
    if current:
        groups.append(current)

    for group in groups:
        joined = '\n'.join(segment for _, segment in group)
        query = urllib.parse.urlencode({'q': joined, 'langpair': 'en|ko'})
        request = urllib.request.Request(
            TRANSLATION_FALLBACK_URL + '?' + query,
            headers={'User-Agent': 'tistory-ticker/1.0'},
        )
        try:
            with urllib.request.urlopen(request, timeout=TRANSLATION_TIMEOUT_SEC) as response:
                payload = json.loads(response.read().decode('utf-8'))
            if int(payload.get('responseStatus') or 0) != 200:
                continue
            combined = html.unescape(str((payload.get('responseData') or {}).get('translatedText') or ''))
            matches = re.findall(r'ZZZ(\d+)ZZZ\s*(.*?)(?=\n?ZZZ\d+ZZZ|$)', combined, re.DOTALL)
            for index_text, translated in matches:
                index = int(index_text)
                if index < len(titles) and _valid_translation(titles[index], translated):
                    result[titles[index]] = translated.strip()
        except Exception:
            logger.warning('Fallback news title translation failed', exc_info=True)
            break
    return result


def _translate_title_batch_unlocked(titles):
    """Translate several public headlines with one free request.

    The previous implementation issued one request per headline with four workers,
    which quickly triggered HTTP 429. Numbered markers let a single response be split
    back into titles. Failed/original results are deliberately not cached so a later
    refresh can retry after the short process-wide cooldown.
    """
    global _translation_retry_after
    titles = [str(title or '').strip() for title in titles]
    titles = [title for title in titles if title and re.search(r'[A-Za-z]', title)]
    if not titles:
        return {}
    if time.time() < _translation_retry_after:
        return _translate_with_mymemory(titles)
    joined = '\n'.join('<<<%d>>> %s' % (index, title[:500]) for index, title in enumerate(titles))
    try:
        query = urllib.parse.urlencode({
            'client': 'gtx', 'sl': 'auto', 'tl': 'ko', 'dt': 't', 'q': joined,
        })
        payload = _request_translation_payload(query)
        combined = ''.join(
            str(part[0]) for part in (payload[0] if isinstance(payload, list) else [])
            if isinstance(part, list) and part and part[0]
        ).strip()
        matches = re.findall(r'<<<(\d+)>>>\s*(.*?)(?=\n?<<<\d+>>>|$)', combined, re.DOTALL)
        result = {}
        for index_text, translated in matches:
            index = int(index_text)
            if index < len(titles) and _valid_translation(titles[index], translated):
                result[titles[index]] = translated.strip()
        missing = [title for title in titles if title not in result]
        if missing:
            result.update(_translate_with_mymemory(missing))
        return result
    except urllib.error.HTTPError as error:
        if error.code == 429:
            _translation_retry_after = time.time() + TRANSLATION_RATE_LIMIT_COOLDOWN_SEC
            logger.warning('News title translation rate limited; retry delayed')
        else:
            logger.warning('News title translation HTTP failure: %s', error.code)
        return _translate_with_mymemory(titles)
    except Exception:
        logger.warning('News title translation failed', exc_info=True)
        return _translate_with_mymemory(titles)


def _translate_title_batch(titles):
    # General feed and per-symbol detail requests can arrive together. Serialize only
    # the small translation call so they reuse the just-written cache instead of
    # creating another request burst.
    with TRANSLATION_REQUEST_LOCK:
        cached = _load_persistent_translations(titles)
        missing = [title for title in titles if title not in cached]
        cached.update(_translate_title_batch_unlocked(missing))
        return cached


def _translations_for_titles(titles):
    titles = list(dict.fromkeys(str(title or '').strip() for title in titles if str(title or '').strip()))
    result = {}
    with TRANSLATION_CACHE_LOCK:
        result.update({title: _translation_cache[title] for title in titles if title in _translation_cache})
    missing = [title for title in titles if title not in result and re.search(r'[A-Za-z]', title)]
    if missing:
        persisted = _load_persistent_translations(missing)
        result.update(persisted)
        with TRANSLATION_CACHE_LOCK:
            _translation_cache.update(persisted)
    missing = [title for title in missing if title not in result]
    for start in range(0, len(missing), TRANSLATION_BATCH_SIZE):
        translated = _translate_title_batch(missing[start:start + TRANSLATION_BATCH_SIZE])
        if translated:
            _remember_translations(translated)
            result.update(translated)
        elif time.time() < _translation_retry_after:
            break
    return result


def translate_news_title(title):
    """Translate one public headline, reusing the same persistent free cache."""
    text = str(title or '').strip()
    if not text or not re.search(r'[A-Za-z]', text):
        return text
    return _translations_for_titles([text]).get(text, text)


def translate_news_titles(items, max_items=10):
    """Attach successful Korean translations without caching failure fallbacks."""
    rows = list(items or [])
    selected = rows[:max(0, int(max_items or 0))]
    if not selected:
        return rows
    titles = [str(item.get('title') or '').strip() for item in selected]
    translations = _translations_for_titles(titles)
    for item, title in zip(selected, titles):
        if title in translations:
            item['title_ko'] = translations[title]
        else:
            item.pop('title_ko', None)
    return rows


def get_general_news(alpha_api_key='', finnhub_api_key='', limit=20, ttl_sec=None):
    """Return cached US market and macro news from major RSS/API providers."""
    global _general_news_cache
    try:
        ttl = GENERAL_NEWS_CACHE_TTL_SEC if ttl_sec is None else max(0, int(ttl_sec))
    except (TypeError, ValueError):
        ttl = GENERAL_NEWS_CACHE_TTL_SEC
    now = time.time()
    fetched_at, cached_items = _general_news_cache
    if fetched_at and now - fetched_at < ttl:
        translate_news_titles(cached_items, max_items=min(20, len(cached_items)))
        return list(cached_items[:max(1, int(limit))])

    # 2026-08-31: 아래 갱신은 여러 공급자(RSS 2곳 + Finnhub + Alpha)를 다 받을 때까지
    # 락을 쥐고 있어서 약 3초가 걸린다. 그동안 도착한 다른 요청은 이 락에서 그대로
    # 대기했고, 그래서 /domestic-news와 /foreign-news가 **동시에** 3초대로 튀었다
    # (실측: 두 엔드포인트가 같은 회차에 3.38s/3.35s, 다음 회차엔 둘 다 1초 미만).
    # 갱신 중이면 기다리지 말고 직전 캐시를 그대로 준다(stale-while-revalidate).
    # 캐시가 아예 없는 콜드 스타트에서만 기존처럼 기다린다.
    acquired = GENERAL_NEWS_CACHE_LOCK.acquire(blocking=False)
    if not acquired:
        if cached_items:
            translate_news_titles(cached_items, max_items=min(20, len(cached_items)))
            return list(cached_items[:max(1, int(limit))])
        GENERAL_NEWS_CACHE_LOCK.acquire()
    try:
        fetched_at, cached_items = _general_news_cache
        if fetched_at and now - fetched_at < ttl:
            translate_news_titles(cached_items, max_items=min(20, len(cached_items)))
            return list(cached_items[:max(1, int(limit))])
        items = []
        providers = []
        for provider, feed_url in MAJOR_NEWS_FEEDS:
            providers.append((provider, lambda provider=provider, feed_url=feed_url: _publisher_rss(feed_url, provider)))
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
        save_cached_news('__GENERAL__', selected, retain_limit=500)
        for item in selected:
            item.pop('_published_ts', None)
        translate_news_titles(selected, max_items=min(20, len(selected)))
        _general_news_cache = (now, selected)
        return list(selected[:max(1, int(limit))])
    finally:
        GENERAL_NEWS_CACHE_LOCK.release()


# The on-demand path (translate_news_titles) only translates the first ~20
# headlines and stops on the first HTTP 429, so a cold cache leaves the rest of
# the general-news list in English until enough refreshes have run. This
# background loop walks the *whole* cached list a few titles at a time with long
# pauses so the free Google/MyMemory endpoints do not rate-limit, and every
# success lands in SQLite (news_translation_cache) where it survives restarts.
TRANSLATION_PREWARM_INTERVAL_SEC = 75
TRANSLATION_PREWARM_TITLES_PER_CYCLE = 8
TRANSLATION_PREWARM_MICRO_BATCH = 2
TRANSLATION_PREWARM_MICRO_PAUSE_SEC = 2.0
_translation_prewarmer_started = False
_translation_prewarmer_lock = threading.Lock()


def _prewarm_general_translations_once(alpha_api_key='', finnhub_api_key=''):
    """Translate a small slice of the still-untranslated general-news headlines."""
    try:
        get_general_news(alpha_api_key=alpha_api_key, finnhub_api_key=finnhub_api_key, limit=500)
    except Exception:
        logger.warning('translation prewarm: general news refresh failed', exc_info=True)

    _fetched_at, items = _general_news_cache
    pending = []
    for item in list(items or []):
        title = str(item.get('title') or '').strip()
        if not title or not re.search(r'[A-Za-z]', title):
            continue
        if _valid_translation(title, item.get('title_ko')):
            continue
        pending.append((item, title))
    if not pending:
        return

    known = _load_persistent_translations([title for _item, title in pending])
    if known:
        with TRANSLATION_CACHE_LOCK:
            _translation_cache.update(known)
    todo = []
    for item, title in pending:
        if title in known:
            item['title_ko'] = known[title]
        else:
            todo.append((item, title))
    todo = todo[:TRANSLATION_PREWARM_TITLES_PER_CYCLE]

    for start in range(0, len(todo), TRANSLATION_PREWARM_MICRO_BATCH):
        chunk = todo[start:start + TRANSLATION_PREWARM_MICRO_BATCH]
        try:
            translated = _translations_for_titles([title for _item, title in chunk])
        except Exception:
            logger.warning('translation prewarm: batch failed', exc_info=True)
            translated = {}
        for item, title in chunk:
            if _valid_translation(title, translated.get(title)):
                item['title_ko'] = translated[title]
        if start + TRANSLATION_PREWARM_MICRO_BATCH < len(todo):
            time.sleep(TRANSLATION_PREWARM_MICRO_PAUSE_SEC)


def _prune_translation_cache_if_due():
    """하루에 한 번만 정리한다. 이 루프는 75초마다 도는데 DELETE를 매번 돌릴 이유가 없다."""
    global _translation_pruned_at
    now = time.time()
    if now - _translation_pruned_at < TRANSLATION_PRUNE_INTERVAL_SEC:
        return
    _translation_pruned_at = now
    prune_translation_cache()


def _translation_prewarm_loop(alpha_api_key='', finnhub_api_key=''):
    while True:
        try:
            _prewarm_general_translations_once(alpha_api_key, finnhub_api_key)
        except Exception:
            logger.warning('translation prewarm loop iteration failed', exc_info=True)
        try:
            _prune_translation_cache_if_due()
        except Exception:
            logger.warning('translation cache prune failed', exc_info=True)
        time.sleep(TRANSLATION_PREWARM_INTERVAL_SEC)


def start_translation_prewarmer(alpha_api_key='', finnhub_api_key=''):
    """Start the general-news translation prewarmer once per process."""
    global _translation_prewarmer_started
    with _translation_prewarmer_lock:
        if _translation_prewarmer_started:
            return
        _translation_prewarmer_started = True
    thread = threading.Thread(
        target=_translation_prewarm_loop,
        kwargs={'alpha_api_key': alpha_api_key, 'finnhub_api_key': finnhub_api_key},
        name='news-translation-prewarmer',
        daemon=True,
    )
    thread.start()
    logger.info('news translation prewarmer started')


def get_sec_filings(limit=30, ttl_sec=None):
    """Return recent US corporate filings from the official SEC EDGAR feed.

    EDGAR is the US counterpart to Korea's DART. Only material current-form
    filings are used for the home flash rail; the original SEC filing URL is
    preserved for the detail popup.
    """
    global _sec_filings_cache
    try:
        ttl = SEC_FILINGS_CACHE_TTL_SEC if ttl_sec is None else max(0, int(ttl_sec))
    except (TypeError, ValueError):
        ttl = SEC_FILINGS_CACHE_TTL_SEC
    now = time.time()
    fetched_at, cached_items = _sec_filings_cache
    requested = max(1, int(limit))
    if fetched_at and now - fetched_at < ttl:
        return list(cached_items[:requested])
    with SEC_FILINGS_LOCK:
        fetched_at, cached_items = _sec_filings_cache
        if fetched_at and now - fetched_at < ttl:
            return list(cached_items[:requested])
        try:
            request = urllib.request.Request(
                SEC_CURRENT_FILINGS_URL,
                headers={
                    'User-Agent': os.environ.get(
                        'SEC_USER_AGENT', 'tistory-ticker/1.0 contact: goodbyestarwars@gmail.com'
                    ),
                    'Accept': 'application/atom+xml,application/xml',
                },
            )
            with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
                payload = ET.fromstring(response.read())
        except Exception:
            logger.exception('SEC EDGAR current filings failed')
            _sec_filings_cache = (now, [])
            return []

        allowed_forms = {'8-K', '10-K', '10-Q', '20-F', '40-F', '6-K'}
        items = []
        for entry in payload.findall('.//*') if payload is not None else []:
            if str(entry.tag).rsplit('}', 1)[-1] != 'entry':
                continue
            form = ''
            for child in list(entry):
                if str(child.tag).rsplit('}', 1)[-1] == 'category':
                    form = _clean_text(child.attrib.get('term'))
                    if form:
                        break
            title = _clean_text(_xml_text(entry, 'title'))
            if form not in allowed_forms or not title:
                continue
            link = ''
            for child in list(entry):
                if str(child.tag).rsplit('}', 1)[-1] == 'link' and child.attrib.get('href'):
                    link = child.attrib['href']
                    break
            if not link:
                continue
            pub_date = _xml_text(entry, 'updated') or _xml_text(entry, 'published')
            items.append({
                'title': title,
                'link': link,
                'pubDate': pub_date,
                'source': 'SEC EDGAR',
                'provider': 'SEC EDGAR',
                'category': '공시',
                'kind': 'disclosure',
                'market': 'us',
                'form': form,
                '_published_ts': _parse_date(pub_date),
            })
        items.sort(key=lambda item: item.get('_published_ts', 0), reverse=True)
        for item in items:
            item.pop('_published_ts', None)
        _sec_filings_cache = (now, items[:30])
        return list(_sec_filings_cache[1][:requested])


def get_general_news_history(start, end, limit=120, alpha_api_key=''):
    """Read the persisted US general-news archive for the requested window."""
    try:
        start_day = datetime.strptime(str(start)[:10], '%Y-%m-%d').date()
        end_day = datetime.strptime(str(end)[:10], '%Y-%m-%d').date()
    except (TypeError, ValueError):
        return []
    try:
        conn = _cache_connect()
        rows = conn.execute('''
            SELECT title, link, pub_date, source, provider, published_ts
            FROM us_news_cache
            WHERE symbol = ?
            ORDER BY published_ts DESC
            LIMIT 1000
        ''', ('__GENERAL__',)).fetchall()
        conn.close()
    except sqlite3.Error:
        logger.exception('General news archive read failed')
        return []
    result = []
    seen = set()
    for row in rows:
        published = _parse_date(row['pub_date'] or '')
        if not published:
            continue
        day = datetime.fromtimestamp(published, timezone.utc).astimezone(
            timezone(timedelta(hours=9))
        ).date()
        if day < start_day or day > end_day:
            continue
        key = _dedupe_key({'link': row['link'], 'title': row['title']})
        if key in seen:
            continue
        seen.add(key)
        result.append({
            'title': row['title'], 'link': row['link'], 'pubDate': row['pub_date'] or '',
            'source': row['source'] or '', 'provider': row['provider'] or 'US news',
            'category': '시장', 'kind': 'news', 'market': 'us',
        })
    covered_days = set()
    for item in result:
        published = _parse_date(item.get('pubDate'))
        if published:
            covered_days.add(datetime.fromtimestamp(published, timezone.utc).astimezone(
                timezone(timedelta(hours=9))
            ).date())
    # Alpha Vantage 뉴스에도 조회수는 없으므로, 주말 리포트는 날짜별 보강을
    # 우선한다. 기존 캐시가 금요일 기사만 갖고 있어도 금~일 자료를 다시 채운다.
    if len(covered_days) < 4 and alpha_api_key:
        try:
            backfill = _alpha_general_news(alpha_api_key, start_day, end_day)
            save_cached_news('__GENERAL__', backfill, retain_limit=500)
            for item in backfill:
                published = _parse_date(item.get('pubDate'))
                if not published:
                    continue
                day = datetime.fromtimestamp(published, timezone.utc).astimezone(
                    timezone(timedelta(hours=9))
                ).date()
                if start_day <= day <= end_day:
                    item = dict(item)
                    item.pop('_published_ts', None)
                    key = _dedupe_key(item)
                    if key not in seen:
                        seen.add(key)
                        result.append(item)
        except Exception:
            logger.exception('General news historical backfill failed')
    return result[:max(1, min(int(limit or 120), 200))]


def _published_timestamp(item):
    value = item.get('_published_ts')
    if value not in (None, '', 0):
        try:
            return int(value)
        except (TypeError, ValueError):
            pass
    return _parse_date(item.get('pubDate'))


def merge_news(symbol, naver_items=None, alpha_api_key='', finnhub_api_key='', limit=TOTAL_NEWS_LIMIT, search_terms=''):
    """주요 매체·선택형 API·네이버 종목 뉴스를 중복 제거·최신순으로 합친다."""
    items = []
    if alpha_api_key:
        items.extend(_alpha_news(symbol, alpha_api_key))
    if finnhub_api_key:
        items.extend(_finnhub_news(symbol, finnhub_api_key))
    # CNBC/Bloomberg를 우선 검색해 유력 경제지 기사를 확보한다. 결과가 부족하면
    # 기존 영어권 Google News RSS 검색으로 보완한다.
    foreign_count = sum(1 for item in items if item.get('provider') != 'Naver')
    if foreign_count < FOREIGN_NEWS_LIMIT:
        items.extend(_google_news(symbol, search_terms=search_terms, major_publishers=True))
        foreign_count = sum(1 for item in items if item.get('provider') != 'Naver')
    if foreign_count < FOREIGN_NEWS_LIMIT:
        items.extend(_google_news(symbol, search_terms=search_terms))
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
    # 미국 종목 화면은 해외 기사를 우선 노출하고, 국내 보완 기사는 최대 1개만 붙인다.
    # 이전에는 부족한 자리를 전체 result로 채워 네이버 기사 9개가 다시 섞이는 문제가 있었다.
    selected_foreign = sorted(foreign, key=lambda item: item.get('_published_ts', 0), reverse=True)
    selected_local = sorted(local, key=lambda item: item.get('_published_ts', 0), reverse=True)
    selected = selected_foreign[:min(FOREIGN_NEWS_LIMIT, max_items)]
    if len(selected) < max_items:
        selected.extend(selected_local[:min(LOCAL_NEWS_LIMIT, max_items - len(selected))])
    if len(selected) < max_items:
        selected.extend(selected_foreign[len(selected_foreign[:min(FOREIGN_NEWS_LIMIT, max_items)]):max_items])
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


def _alpha_general_news(api_key, start=None, end=None):
    params = {
        'function': 'NEWS_SENTIMENT',
        'topics': 'financial_markets,economy_macro,economy_monetary,earnings',
        'sort': 'LATEST',
        'limit': 50,
        'apikey': api_key,
    }
    if start is not None:
        params['time_from'] = start.strftime('%Y%m%dT0000')
    if end is not None:
        params['time_to'] = (end + timedelta(days=1)).strftime('%Y%m%dT0000')
    query = urllib.parse.urlencode(params)
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


def _google_news(symbol, search_terms='', major_publishers=False):
    safe_terms = str(search_terms or '').replace('"', '').strip()[:80]
    query_text = '"' + symbol + '"'
    if safe_terms and safe_terms.upper() != str(symbol).upper():
        query_text += ' "' + safe_terms + '"'
    query_text += ' stock'
    if major_publishers:
        query_text += ' (site:cnbc.com OR site:bloomberg.com)'
    query = urllib.parse.urlencode({
        'q': query_text,
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


def _publisher_rss(feed_url, provider):
    """Normalize a public publisher RSS feed without storing article bodies."""
    try:
        payload = _get_xml(feed_url)
    except Exception:
        logger.exception('%s RSS failed', provider)
        return []

    items = []
    for row in payload.findall('.//item') if payload is not None else []:
        title = _clean_text(_xml_text(row, 'title'))
        link = _xml_text(row, 'link').strip()
        pub_date = _xml_text(row, 'pubDate') or _xml_text(row, 'published')
        if not title or not link:
            continue
        items.append({
            'title': title,
            'link': link,
            'pubDate': pub_date,
            'source': provider,
            'provider': provider + ' RSS',
            'category': '시장',
            'kind': 'news',
            'market': 'us',
            '_published_ts': _parse_date(pub_date),
        })
    return items[:50]


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


# 번역 캐시 손질용 CLI. 오역을 고치려면 그 제목의 캐시 행을 지워야 다음 조회에서 다시
# 번역한다(캐시가 남아 있으면 외부 호출 자체를 안 한다). HTTP 관리자 엔드포인트를 새로
# 만들지 않은 이유: 인증 표면이 늘어나는 데 비해 쓰는 빈도가 낮다.
#
#   python3 news_aggregator.py --stats
#   python3 news_aggregator.py --forget "Fed holds rates steady as inflation cools"
#   python3 news_aggregator.py --prune            # 기본 90일
#   python3 news_aggregator.py --prune --days 30
if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='뉴스 제목 번역 캐시 관리')
    parser.add_argument('--forget', nargs='+', metavar='TITLE',
                        help='이 영어 제목들의 번역 캐시를 지운다(다음 조회 때 재번역)')
    parser.add_argument('--prune', action='store_true', help='오래된 캐시 행을 지운다')
    parser.add_argument('--days', type=int, default=TRANSLATION_CACHE_TTL_DAYS,
                        help='--prune 보관 기간(일, 기본 %d)' % TRANSLATION_CACHE_TTL_DAYS)
    parser.add_argument('--stats', action='store_true', help='캐시 행 수와 최신/최고령 시각')
    args = parser.parse_args()

    if args.stats:
        connection = _cache_connect()
        try:
            row = connection.execute(
                'SELECT COUNT(*) AS n, MIN(updated_at) AS oldest, MAX(updated_at) AS newest'
                ' FROM news_translation_cache').fetchone()
            print('행 수: %d' % (row['n'] or 0))
            for label, value in (('가장 오래된', row['oldest']), ('가장 최근', row['newest'])):
                if value:
                    print('%s: %s' % (label, datetime.fromtimestamp(value, timezone.utc)
                                      .astimezone().strftime('%Y-%m-%d %H:%M')))
        finally:
            connection.close()

    if args.forget:
        print('지운 행: %d' % forget_translations(args.forget))

    if args.prune:
        print('정리한 행: %d (보관 %d일)' % (prune_translation_cache(args.days), args.days))

    if not (args.stats or args.forget or args.prune):
        parser.print_help()
