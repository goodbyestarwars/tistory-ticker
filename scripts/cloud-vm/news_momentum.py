# -*- coding: utf-8 -*-
"""뉴스 제목과 NAVER 검색어 트렌드로 종목별 이슈 지속성을 집계한다.

기사 본문/HTML/이미지는 저장하지 않으며 기존 ohlc_snapshot.db와 완전히 분리된
news_momentum.db만 사용한다. 사용자 요청 시 외부 API를 호출하지 않고 이 DB만 읽는다.
"""

import json
import os
import re
import sqlite3
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime


DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'news_momentum.db')
DATALAB_URL = 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search'
RETENTION_DAYS = 90

SCHEMA = '''
CREATE TABLE IF NOT EXISTS news_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_code TEXT NOT NULL,
    stock_name TEXT NOT NULL,
    topic_name TEXT NOT NULL,
    keywords_json TEXT NOT NULL,
    query_version INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    total_count INTEGER NOT NULL DEFAULT 0,
    count_7d INTEGER NOT NULL DEFAULT 0,
    count_30d INTEGER NOT NULL DEFAULT 0,
    sentiment TEXT NOT NULL DEFAULT 'neutral',
    status TEXT NOT NULL DEFAULT 'active',
    representative_urls_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(stock_code, topic_name)
);

CREATE TABLE IF NOT EXISTS news_topic_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL,
    stock_code TEXT NOT NULL,
    date TEXT NOT NULL,
    news_count INTEGER NOT NULL DEFAULT 0,
    search_interest REAL,
    created_at TEXT NOT NULL,
    UNIQUE(topic_id, date),
    FOREIGN KEY(topic_id) REFERENCES news_topics(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS datalab_trends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL,
    query_version INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    time_unit TEXT NOT NULL,
    trend_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    FOREIGN KEY(topic_id) REFERENCES news_topics(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS news_stock_coverage (
    stock_code TEXT PRIMARY KEY,
    stock_name TEXT NOT NULL,
    requested_start_date TEXT NOT NULL,
    actual_start_date TEXT,
    actual_end_date TEXT,
    backfill_days INTEGER NOT NULL DEFAULT 90,
    backfill_complete INTEGER NOT NULL DEFAULT 0,
    fetched_articles INTEGER NOT NULL DEFAULT 0,
    news_api_calls INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_news_topics_stock_code ON news_topics(stock_code);
CREATE INDEX IF NOT EXISTS idx_news_topics_stock_status ON news_topics(stock_code, status);
CREATE INDEX IF NOT EXISTS idx_news_topics_last_seen ON news_topics(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_news_topic_daily_topic_date ON news_topic_daily(topic_id, date);
CREATE INDEX IF NOT EXISTS idx_news_topic_daily_stock_date ON news_topic_daily(stock_code, date);
CREATE INDEX IF NOT EXISTS idx_datalab_trends_topic_fetched ON datalab_trends(topic_id, fetched_at);
'''

POSITIVE_WORDS = {
    '증가', '확대', '성장', '호조', '상승', '수주', '계약', '공급', '신설', '구축', '개발',
    '승인', '흑자', '최대', '돌파', '개선', '투자', '증설', '출시', '협력',
}
NEGATIVE_WORDS = {
    '감소', '축소', '하락', '부진', '적자', '중단', '취소', '소송', '제재', '리콜',
    '급락', '우려', '경고', '조사', '압수수색', '매각', '철수',
}
STOP_WORDS = {
    '관련', '대한', '통해', '위한', '올해', '내년', '오늘', '전망', '주가', '증권', '종목',
    '기업', '시장', '업계', '기자', '단독', '종합', '속보', '코스피', '코스닥',
}


def get_conn(db_file=None):
    conn = sqlite3.connect(db_file or DB_FILE, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA busy_timeout=5000')
    conn.execute('PRAGMA temp_store=MEMORY')
    return conn


def create_schema(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def _iso_now(now=None):
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _parse_date(value, fallback=None):
    if not value:
        return fallback or date.today().isoformat()
    text = str(value).strip()
    if re.match(r'^\d{12}$', text):
        return datetime.strptime(text, '%Y%m%d%H%M').date().isoformat()
    if re.match(r'^\d{8}$', text):
        return datetime.strptime(text, '%Y%m%d').date().isoformat()
    if re.match(r'^\d{4}-\d{2}-\d{2}', text):
        return text[:10]
    try:
        return parsedate_to_datetime(text).date().isoformat()
    except (TypeError, ValueError, OverflowError):
        return fallback or date.today().isoformat()


def _clean_title(title):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', title or '')).strip()


def _location_factory_issue(title):
    match = re.search(
        r'([가-힣]{2,6})(?:에|서|지역)?\s*(?:AI\s*)?(?:반도체\s*)?(?:공장|생산라인)'
        r'.{0,16}(신설|건설|구축|증설|투자)',
        title,
        re.IGNORECASE,
    )
    if not match:
        return None
    location = re.sub(r'(지역|에서|에|서)$', '', match.group(1))
    if location in {'신규', '첨단', '대규모', '글로벌', '국내', '해외'}:
        return None
    return '%s공장 %s' % (location, '증설' if match.group(2) == '증설' else '신설')


def _issue_labels(title):
    """한 제목에서 일반 단어가 아닌 복합 이슈 라벨만 추출한다."""
    labels = []
    upper = title.upper()
    if 'HBM' in upper:
        labels.append('HBM 수요 증가' if re.search(r'수요|공급|증가|확대|성장', title) else 'HBM')
    if re.search(r'\bAI\b', upper) and re.search(r'반도체|칩|메모리', title, re.IGNORECASE):
        labels.append('AI 반도체')

    factory = _location_factory_issue(title)
    if factory:
        labels.append(factory)

    rules = [
        (r'신규.{0,8}수주|수주.{0,8}(증가|확대|계약)|공급계약', '신규 수주'),
        (r'신약.{0,12}(승인|허가)|품목허가', '신약 승인'),
        (r'(실적|영업이익).{0,10}(호조|증가|성장|최대|흑자)', '실적 개선'),
        (r'(실적|영업이익).{0,10}(부진|감소|적자)', '실적 부진'),
        (r'배당.{0,8}(확대|증가|결정)|주주환원', '주주환원 확대'),
        (r'유상증자|주주배정', '유상증자'),
        (r'합병|인수.{0,5}합병|M&A', '인수합병'),
        (r'리콜|판매.{0,5}중단', '리콜·판매중단'),
        (r'소송|제재|과징금|압수수색', '규제·법적 위험'),
    ]
    for pattern, label in rules:
        if re.search(pattern, title, re.IGNORECASE):
            labels.append(label)

    # 규칙에 없는 제목도 "핵심명사 + 사건어"의 복합어만 제한적으로 허용한다.
    if not labels:
        tokens = [
            token for token in re.findall(r'[A-Za-z][A-Za-z0-9-]{1,}|[가-힣]{2,}', title)
            if token not in STOP_WORDS
        ]
        event_tokens = [
            token for token in tokens
            if token in POSITIVE_WORDS or token in NEGATIVE_WORDS
            or token in {'수주', '계약', '공급', '투자', '신설', '증설', '개발', '승인'}
        ]
        core_tokens = [
            token for token in tokens
            if token not in event_tokens and token not in POSITIVE_WORDS and token not in NEGATIVE_WORDS
        ]
        if core_tokens and event_tokens:
            labels.append('%s %s' % (core_tokens[-1], event_tokens[0]))

    out = []
    for label in labels:
        label = re.sub(r'\s+', ' ', label).strip()
        if len(label) >= 4 and label not in out:
            out.append(label)
    return out


def _keyword_group(stock_name, label):
    short_name = re.sub(r'(주식회사|㈜|\(주\)|홀딩스)$', '', stock_name).strip()
    base = [
        '%s %s' % (stock_name, label),
        '%s %s' % (short_name, label),
    ]
    if '공장 신설' in label:
        location = label.split('공장', 1)[0]
        base.extend([
            '%s %s공장' % (stock_name, location),
            '%s AI공장' % stock_name,
            '%s 공장 신설' % stock_name,
        ])
    if label == 'HBM 수요 증가':
        base.extend(['%s HBM' % stock_name, '%s HBM 수요' % short_name])
    if label == 'AI 반도체':
        base.extend(['%s AI 반도체' % stock_name, '%s AI칩' % short_name])
    seen = set()
    return [item for item in base if item and not (item in seen or seen.add(item))][:20]


def _sentiment(titles):
    positive = sum(sum(word in title for word in POSITIVE_WORDS) for title in titles)
    negative = sum(sum(word in title for word in NEGATIVE_WORDS) for title in titles)
    if positive > negative:
        return 'positive'
    if negative > positive:
        return 'negative'
    return 'neutral'


def extract_topics(stock_code, stock_name, news_items, today=None):
    """서로 다른 기사 2건 이상에서 반복된 복합 이슈만 반환한다."""
    today_iso = (today or date.today()).isoformat()
    grouped = defaultdict(dict)
    for item in news_items or []:
        title = _clean_title(item.get('title', ''))
        if not title:
            continue
        article_key = item.get('link') or title
        published = _parse_date(item.get('pubDate') or item.get('datetime'), today_iso)
        for label in _issue_labels(title):
            grouped[label][article_key] = {
                'title': title,
                'date': published,
                'url': item.get('link') or '',
            }

    topics = []
    seven_days_ago = (date.fromisoformat(today_iso) - timedelta(days=6)).isoformat()
    for label, articles_by_key in grouped.items():
        articles = list(articles_by_key.values())
        recent_count = sum(article['date'] >= seven_days_ago for article in articles)
        if len(articles) < 2 and recent_count < 2:
            continue
        by_date = defaultdict(int)
        for article in articles:
            by_date[article['date']] += 1
        urls = []
        for article in sorted(articles, key=lambda row: row['date'], reverse=True):
            if article['url'] and article['url'] not in urls:
                urls.append(article['url'])
        topics.append({
            'stock_code': stock_code,
            'stock_name': stock_name,
            'topic_name': '%s %s' % (stock_name, label),
            'label': label,
            'keywords': _keyword_group(stock_name, label),
            'sentiment': _sentiment([article['title'] for article in articles]),
            'daily_counts': dict(by_date),
            'representative_urls': urls[:3],
        })
    return sorted(topics, key=lambda row: (-sum(row['daily_counts'].values()), row['topic_name']))


def _topic_status(last_seen, today_iso):
    age = (date.fromisoformat(today_iso) - date.fromisoformat(last_seen)).days
    if age <= 7:
        return 'active'
    if age <= 30:
        return 'cooling'
    return 'ended'


def refresh_topic_statuses(conn, today=None, stock_code=None):
    """새 기사에 다시 등장하지 않은 기존 이슈도 날짜 경과에 따라 상태를 갱신한다."""
    today_iso = (today or date.today()).isoformat()
    params = []
    where = ''
    if stock_code:
        where = ' WHERE stock_code=?'
        params.append(stock_code)
    rows = conn.execute(
        'SELECT id,last_seen_at,status FROM news_topics' + where,
        params,
    ).fetchall()
    updates = []
    for row in rows:
        status = _topic_status(row['last_seen_at'], today_iso)
        if row['status'] != status:
            updates.append((status, row['id']))
    if updates:
        with conn:
            conn.executemany('UPDATE news_topics SET status=? WHERE id=?', updates)
    return len(updates)


def _refresh_topic_aggregates(conn, topic_id, today_iso, now_iso):
    row = conn.execute(
        'SELECT MIN(date), MAX(date), SUM(news_count) FROM news_topic_daily WHERE topic_id=?',
        (topic_id,),
    ).fetchone()
    first_seen, last_seen, total_count = row
    if not first_seen:
        return
    cutoff_7d = (date.fromisoformat(today_iso) - timedelta(days=6)).isoformat()
    cutoff_30d = (date.fromisoformat(today_iso) - timedelta(days=29)).isoformat()
    count_7d = conn.execute(
        'SELECT COALESCE(SUM(news_count),0) FROM news_topic_daily WHERE topic_id=? AND date>=?',
        (topic_id, cutoff_7d),
    ).fetchone()[0]
    count_30d = conn.execute(
        'SELECT COALESCE(SUM(news_count),0) FROM news_topic_daily WHERE topic_id=? AND date>=?',
        (topic_id, cutoff_30d),
    ).fetchone()[0]
    conn.execute(
        'UPDATE news_topics SET first_seen_at=?, last_seen_at=?, total_count=?, count_7d=?, '
        'count_30d=?, status=?, updated_at=? WHERE id=?',
        (first_seen, last_seen, total_count or 0, count_7d, count_30d,
         _topic_status(last_seen, today_iso), now_iso, topic_id),
    )


def upsert_topics(conn, stock_code, stock_name, topics, today=None, now=None):
    """한 종목의 추출 결과를 한 transaction으로 저장하고 topic 행 목록을 반환한다."""
    today_iso = (today or date.today()).isoformat()
    now_iso = _iso_now(now)
    touched_ids = []
    with conn:
        for topic in topics:
            keywords_json = json.dumps(sorted(set(topic['keywords'])), ensure_ascii=False)
            existing = conn.execute(
                'SELECT * FROM news_topics WHERE stock_code=? AND topic_name=?',
                (stock_code, topic['topic_name']),
            ).fetchone()
            if existing:
                query_version = existing['query_version']
                if existing['keywords_json'] != keywords_json:
                    query_version += 1
                old_urls = json.loads(existing['representative_urls_json'] or '[]')
                urls = []
                for url in topic['representative_urls'] + old_urls:
                    if url and url not in urls:
                        urls.append(url)
                urls = urls[:3]
                conn.execute(
                    'UPDATE news_topics SET stock_name=?, keywords_json=?, query_version=?, '
                    'sentiment=?, representative_urls_json=?, updated_at=? WHERE id=?',
                    (stock_name, keywords_json, query_version, topic['sentiment'],
                     json.dumps(urls, ensure_ascii=False), now_iso, existing['id']),
                )
                topic_id = existing['id']
            else:
                first_seen = min(topic['daily_counts'])
                last_seen = max(topic['daily_counts'])
                cursor = conn.execute(
                    'INSERT INTO news_topics '
                    '(stock_code,stock_name,topic_name,keywords_json,query_version,first_seen_at,last_seen_at,'
                    'total_count,count_7d,count_30d,sentiment,status,representative_urls_json,created_at,updated_at) '
                    'VALUES (?,?,?,?,1,?,?,0,0,0,?,?,?,?,?)',
                    (stock_code, stock_name, topic['topic_name'], keywords_json, first_seen, last_seen,
                     topic['sentiment'], _topic_status(last_seen, today_iso),
                     json.dumps(topic['representative_urls'], ensure_ascii=False), now_iso, now_iso),
                )
                topic_id = cursor.lastrowid

            conn.executemany(
                'INSERT INTO news_topic_daily (topic_id,stock_code,date,news_count,search_interest,created_at) '
                'VALUES (?,?,?,?,NULL,?) ON CONFLICT(topic_id,date) DO UPDATE SET '
                'news_count=MAX(news_topic_daily.news_count,excluded.news_count)',
                [(topic_id, stock_code, day, count, now_iso)
                 for day, count in topic['daily_counts'].items()],
            )
            _refresh_topic_aggregates(conn, topic_id, today_iso, now_iso)
            touched_ids.append(topic_id)
    return [dict(row) for row in conn.execute(
        'SELECT * FROM news_topics WHERE id IN (%s)' % ','.join('?' for _ in touched_ids),
        touched_ids,
    )] if touched_ids else []


def datalab_topics_due(conn, stock_code, today=None, limit=5):
    today_iso = (today or date.today()).isoformat()
    rows = conn.execute(
        '''SELECT t.*,
           (SELECT MAX(fetched_at) FROM datalab_trends d
            WHERE d.topic_id=t.id AND d.query_version=t.query_version) AS last_fetched
           FROM news_topics t
           WHERE t.stock_code=? AND t.status='active'
           ORDER BY t.count_7d DESC, t.last_seen_at DESC LIMIT ?''',
        (stock_code, limit),
    ).fetchall()
    return [
        dict(row) for row in rows
        if not row['last_fetched'] or row['last_fetched'][:10] < today_iso
    ]


def save_stock_coverage(conn, stock_code, stock_name, requested_start_date,
                        actual_start_date, actual_end_date, backfill_complete,
                        fetched_articles, news_api_calls, backfill_days=90, now=None):
    now_iso = _iso_now(now)
    with conn:
        conn.execute(
            '''INSERT INTO news_stock_coverage
               (stock_code,stock_name,requested_start_date,actual_start_date,actual_end_date,
                backfill_days,backfill_complete,fetched_articles,news_api_calls,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(stock_code) DO UPDATE SET
               stock_name=excluded.stock_name,
               requested_start_date=excluded.requested_start_date,
               actual_start_date=excluded.actual_start_date,
               actual_end_date=excluded.actual_end_date,
               backfill_days=excluded.backfill_days,
               backfill_complete=excluded.backfill_complete,
               fetched_articles=excluded.fetched_articles,
               news_api_calls=excluded.news_api_calls,
               updated_at=excluded.updated_at''',
            (stock_code, stock_name, requested_start_date, actual_start_date, actual_end_date,
             backfill_days, 1 if backfill_complete else 0, fetched_articles, news_api_calls,
             now_iso),
        )


def fetch_datalab_trends(topic_rows, client_id, client_secret, start_date, end_date, time_unit='date'):
    if not client_id or not client_secret or not topic_rows:
        return {}
    groups = [{
        'groupName': 'topic-%s' % row['id'],
        'keywords': json.loads(row['keywords_json'])[:20],
    } for row in topic_rows[:5]]
    body = json.dumps({
        'startDate': start_date,
        'endDate': end_date,
        'timeUnit': time_unit,
        'keywordGroups': groups,
    }, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(DATALAB_URL, data=body, method='POST', headers={
        'X-NCP-APIGW-API-KEY-ID': client_id,
        'X-NCP-APIGW-API-KEY': client_secret,
        'Content-Type': 'application/json',
        'User-Agent': '9Pay-NewsMomentum/1.0',
    })
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode('utf-8'))
    return {
        result['title']: result.get('data') or []
        for result in payload.get('results') or []
    }


def save_datalab_trends(conn, topic_rows, trends_by_group, start_date, end_date,
                        time_unit='date', now=None):
    now_iso = _iso_now(now)
    with conn:
        for row in topic_rows:
            trend = trends_by_group.get('topic-%s' % row['id'])
            if trend is None:
                continue
            conn.execute(
                'INSERT INTO datalab_trends '
                '(topic_id,query_version,start_date,end_date,time_unit,trend_json,fetched_at) '
                'VALUES (?,?,?,?,?,?,?)',
                (row['id'], row['query_version'], start_date, end_date, time_unit,
                 json.dumps(trend, ensure_ascii=False), now_iso),
            )
            conn.executemany(
                'INSERT INTO news_topic_daily '
                '(topic_id,stock_code,date,news_count,search_interest,created_at) VALUES (?,?,?,0,?,?) '
                'ON CONFLICT(topic_id,date) DO UPDATE SET search_interest=excluded.search_interest',
                [(row['id'], row['stock_code'], point['period'], point.get('ratio'), now_iso)
                 for point in trend],
            )
            # 일별 집계가 과거 추이를 보존하므로 큰 trend_json은 검색어 버전별 최신
            # 스냅샷 하나만 남겨 활성 이슈가 매일 DB를 불필요하게 키우지 않게 한다.
            conn.execute(
                '''DELETE FROM datalab_trends
                   WHERE topic_id=? AND query_version=? AND id NOT IN (
                       SELECT id FROM datalab_trends
                       WHERE topic_id=? AND query_version=?
                       ORDER BY fetched_at DESC,id DESC LIMIT 1
                   )''',
                (row['id'], row['query_version'], row['id'], row['query_version']),
            )


def prune_old_details(conn, today=None, retention_days=RETENTION_DAYS):
    """서비스 중 VACUUM 없이 90일 초과 상세 행만 transaction으로 삭제한다."""
    today_value = today or date.today()
    cutoff = (today_value - timedelta(days=retention_days)).isoformat()
    with conn:
        daily_deleted = conn.execute(
            'DELETE FROM news_topic_daily WHERE date<?', (cutoff,)
        ).rowcount
        trends_deleted = conn.execute(
            '''DELETE FROM datalab_trends WHERE topic_id IN
               (SELECT id FROM news_topics WHERE status='ended' AND last_seen_at<?)''',
            (cutoff,),
        ).rowcount
    return {'dailyDeleted': daily_deleted, 'trendsDeleted': trends_deleted, 'cutoff': cutoff}


def load_stock_momentum(conn, stock_code, daily_days=30):
    topic_rows = conn.execute(
        'SELECT * FROM news_topics WHERE stock_code=? ORDER BY '
        "CASE status WHEN 'active' THEN 0 WHEN 'cooling' THEN 1 ELSE 2 END, "
        'count_7d DESC, last_seen_at DESC LIMIT 12',
        (stock_code,),
    ).fetchall()
    topics = []
    for row in topic_rows:
        daily = conn.execute(
            'SELECT date,news_count,search_interest FROM news_topic_daily '
            'WHERE topic_id=? ORDER BY date DESC LIMIT ?',
            (row['id'], daily_days),
        ).fetchall()
        daily = [dict(point) for point in reversed(daily)]
        interest_values = [
            point['search_interest'] for point in daily if point['search_interest'] is not None
        ]
        latest_interest = interest_values[-1] if interest_values else None
        previous = interest_values[-8:-1] if len(interest_values) > 1 else []
        previous_avg = sum(previous) / len(previous) if previous else None
        interest_change = (
            latest_interest - previous_avg
            if latest_interest is not None and previous_avg is not None else None
        )
        topics.append({
            'id': row['id'],
            'topicName': row['topic_name'],
            'keywords': json.loads(row['keywords_json']),
            'queryVersion': row['query_version'],
            'firstSeenAt': row['first_seen_at'],
            'lastSeenAt': row['last_seen_at'],
            'totalCount': row['total_count'],
            'count7d': row['count_7d'],
            'count30d': row['count_30d'],
            'sentiment': row['sentiment'],
            'status': row['status'],
            'representativeUrls': json.loads(row['representative_urls_json'] or '[]')[:3],
            'latestSearchInterest': latest_interest,
            'searchInterestChange': interest_change,
            'daily': daily,
        })
    coverage_row = conn.execute(
        'SELECT * FROM news_stock_coverage WHERE stock_code=?', (stock_code,)
    ).fetchone()
    coverage = None
    if coverage_row:
        coverage = {
            'requestedStartDate': coverage_row['requested_start_date'],
            'actualStartDate': coverage_row['actual_start_date'],
            'actualEndDate': coverage_row['actual_end_date'],
            'backfillDays': coverage_row['backfill_days'],
            'backfillComplete': bool(coverage_row['backfill_complete']),
            'fetchedArticles': coverage_row['fetched_articles'],
            'newsApiCalls': coverage_row['news_api_calls'],
            'updatedAt': coverage_row['updated_at'],
        }
    return {
        'stockCode': stock_code,
        'stockName': (
            topic_rows[0]['stock_name'] if topic_rows
            else coverage_row['stock_name'] if coverage_row else None
        ),
        'dataAsOf': coverage['actualEndDate'] if coverage else None,
        'coverage': coverage,
        'topics': topics,
    }
