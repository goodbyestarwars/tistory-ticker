# -*- coding: utf-8 -*-
"""미국 종목 뉴스 통합기.

Alpha Vantage와 Finnhub는 선택형 공급자다. 키가 없거나 한 공급자가 실패해도
기존 네이버 뉴스는 계속 표시되도록 설계한다. 기사 본문은 저장하지 않고 제목,
출처, 발행시각, 원문 링크와 종목별 감성 메타데이터만 전달한다.
"""

import html
import json
import logging
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

logger = logging.getLogger('news_aggregator')

ALPHA_URL = 'https://www.alphavantage.co/query'
FINNHUB_URL = 'https://finnhub.io/api/v1/company-news'
GOOGLE_NEWS_RSS_URL = 'https://news.google.com/rss/search'
HTTP_TIMEOUT = 8
FOREIGN_NEWS_LIMIT = 2
LOCAL_NEWS_LIMIT = 1
TOTAL_NEWS_LIMIT = 3


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
    try:
        return int(parsedate_to_datetime(str(value)).timestamp())
    except (TypeError, ValueError, OverflowError):
        return 0
