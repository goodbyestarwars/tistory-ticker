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
KST = timezone(timedelta(hours=9))

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
    positive_count INTEGER,
    neutral_count INTEGER,
    negative_count INTEGER,
    previous_7d_count INTEGER,
    change_rate REAL,
    momentum_status TEXT,
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
    positive_count INTEGER,
    neutral_count INTEGER,
    negative_count INTEGER,
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
    _add_missing_columns(conn, 'news_topics', {
        'positive_count': 'INTEGER',
        'neutral_count': 'INTEGER',
        'negative_count': 'INTEGER',
        'previous_7d_count': 'INTEGER',
        'change_rate': 'REAL',
        'momentum_status': 'TEXT',
    })
    _add_missing_columns(conn, 'news_topic_daily', {
        'positive_count': 'INTEGER',
        'neutral_count': 'INTEGER',
        'negative_count': 'INTEGER',
    })
    conn.commit()


def _add_missing_columns(conn, table_name, columns):
    """기존 news_momentum.db에 nullable 집계 컬럼만 안전하게 추가한다."""
    existing = {
        row['name'] for row in conn.execute('PRAGMA table_info(%s)' % table_name)
    }
    for column_name, column_type in columns.items():
        if column_name not in existing:
            conn.execute(
                'ALTER TABLE %s ADD COLUMN %s %s'
                % (table_name, column_name, column_type)
            )


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


# 이슈 라벨 -> 네이버에서 실제로 검색될 만한 짧은 표현.
# 2026-08-02: 예전에는 확장 규칙이 공장/HBM/AI 반도체 3개에만 하드코딩돼 있어서, 그 외
# 이슈는 "종목명 + 라벨 전체"라는 롱테일 문구 하나로만 조회됐다(예: "한화오션 조원 돌파").
# 아무도 그렇게 검색하지 않으니 DataLab이 빈 응답을 주고 화면에는 "데이터 부족"만 떴다.
# 모든 규칙 라벨을 표로 옮겨 짧은 검색어를 함께 넣는다.
# 키워드는 반드시 "종목명 + 이슈어" 형태로만 만들고 종목명 단독은 절대 넣지 않는다 -
# 종목명만 넣으면 검색량은 늘지만 이슈별 변별력이 사라진다(사용자 확인 사항).
# 같은 이유로 실적 개선/부진은 공통어 '실적'을 쓰지 않고 서로 다른 표현만 쓴다.
ISSUE_SEARCH_TERMS = {
    'HBM': ('HBM',),
    'HBM 수요 증가': ('HBM', 'HBM 수요', 'HBM 공급'),
    'AI 반도체': ('AI 반도체', 'AI칩', 'AI 메모리'),
    '신규 수주': ('수주', '신규 수주', '수주 계약', '공급계약'),
    '신약 승인': ('신약', '신약 승인', '품목허가'),
    '실적 개선': ('실적 개선', '영업이익 증가', '흑자'),
    '실적 부진': ('실적 부진', '영업이익 감소', '적자'),
    '주주환원 확대': ('배당', '배당 확대', '주주환원'),
    '유상증자': ('유상증자', '증자'),
    '인수합병': ('인수합병', 'M&A', '인수'),
    '리콜·판매중단': ('리콜', '판매 중단'),
    '규제·법적 위험': ('소송', '제재', '과징금'),
}
# 종목명과 붙여도 검색어가 되지 못하는 말들.
# 정도·상태어("한화오션 증가")와 단위어("한화오션 조원")는 아무도 검색하지 않는다.
# 반면 사건 명사(수주·계약·소송·리콜·배당 등)는 종목명과 붙이면 실제로 검색되는
# 조합이라 남긴다 - 위 ISSUE_SEARCH_TERMS 표도 같은 기준으로 만들었다.
DEGREE_WORDS = {
    '증가', '확대', '성장', '호조', '상승', '최대', '돌파', '개선',
    '감소', '축소', '하락', '부진', '급락', '우려', '경고',
}
UNIT_WORDS = {'조원', '억원', '만원', '달러', '포인트', '퍼센트'}
_WEAK_KEYWORD_TOKENS = DEGREE_WORDS | UNIT_WORDS | STOP_WORDS


def _factory_search_terms(label):
    """'{지역}공장 신설/증설'은 지역명이 라벨마다 달라서 표 대신 규칙으로 만든다."""
    match = re.match(r'^(.+?)공장 (신설|증설)$', label)
    if not match:
        return ()
    location, action = match.group(1), match.group(2)
    return ('%s공장' % location, '%s 공장' % location, '공장 %s' % action, '신규 공장')


def _core_tokens(text, stock_name):
    """검색어로 쓸 만한 핵심 명사만 남긴다(정도어·사건어·종목명 자체는 제외)."""
    out = []
    for token in re.findall(r'[A-Za-z][A-Za-z0-9-]{1,}|[가-힣]{2,}', text or ''):
        if token in _WEAK_KEYWORD_TOKENS or token in stock_name or len(token) < 2:
            continue
        if token not in out:
            out.append(token)
    return out


def _keyword_group(stock_name, label, titles=None):
    """DataLab 조회용 키워드 묶음. 모든 항목이 종목명을 포함해 이슈 변별력을 유지한다."""
    short_name = re.sub(r'(주식회사|㈜|\(주\)|홀딩스)$', '', stock_name).strip()
    known_terms = tuple(ISSUE_SEARCH_TERMS.get(label, ())) + _factory_search_terms(label)
    terms = [label]
    terms.extend(known_terms)
    if not known_terms:
        # 표에 없는 라벨(제목에서 즉석 조합된 이슈)은 라벨의 핵심어를 검색어로 쓴다.
        terms.extend(_core_tokens(label, stock_name))
        # 라벨만으로는 검색어를 만들기 어려우므로, 그 이슈의 기사 제목에서 2건 이상
        # 반복된 핵심어도 함께 넣는다 - 이슈 안에서만 뽑으므로 변별력은 유지된다.
        counts = defaultdict(int)
        for title in titles or []:
            for token in set(_core_tokens(title, stock_name)):
                counts[token] += 1
        repeated = sorted(
            (token for token, count in counts.items() if count >= 2),
            key=lambda token: (-counts[token], token),
        )
        terms.extend(repeated[:3])

    keywords = []
    seen = set()
    for name in (stock_name, short_name):
        for term in terms:
            if not term:
                continue
            keyword = '%s %s' % (name, term)
            if keyword not in seen:
                seen.add(keyword)
                keywords.append(keyword)
    return keywords[:20]


def _drop_shared_keywords(topics):
    """한 종목의 이슈들 사이에 겹치는 키워드를 제거해 이슈별 변별력을 보장한다.

    표의 검색어와 제목에서 뽑은 핵심어가 우연히 겹칠 수 있는데(예: '신규 수주'
    이슈와 제목에 '수주'가 반복된 다른 이슈), 그대로 두면 두 이슈의 검색 관심도가
    같은 검색량을 나눠 갖게 된다. 겹치는 키워드는 양쪽에서 모두 빼고, 이슈마다
    고유한 '종목명 + 라벨 전체'는 항상 남겨 빈 묶음이 생기지 않게 한다.
    """
    counts = defaultdict(int)
    for topic in topics:
        for keyword in set(topic['keywords']):
            counts[keyword] += 1
    for topic in topics:
        full_label_keyword = '%s %s' % (topic['stock_name'], topic['label'])
        kept = [kw for kw in topic['keywords'] if counts[kw] == 1]
        if not kept:
            kept = [full_label_keyword]
        topic['keywords'] = kept
    return topics


def _sentiment_score(title):
    return (
        sum(word in title for word in POSITIVE_WORDS),
        sum(word in title for word in NEGATIVE_WORDS),
    )


def _classify_sentiment(title):
    positive, negative = _sentiment_score(title)
    if positive > negative:
        return 'positive'
    if negative > positive:
        return 'negative'
    return 'neutral'


def _sentiment(titles):
    positive = 0
    negative = 0
    for title in titles:
        title_positive, title_negative = _sentiment_score(title)
        positive += title_positive
        negative += title_negative
    if positive > negative:
        return 'positive'
    if negative > positive:
        return 'negative'
    return 'neutral'


def _momentum_change(recent_count, previous_count):
    if previous_count == 0:
        return None, 'new' if recent_count > 0 else 'persistent'
    change_rate = round((recent_count - previous_count) / previous_count * 100, 1)
    difference = recent_count - previous_count
    if change_rate >= 20 and difference >= 2:
        status = 'expanding'
    elif change_rate <= -20 and difference <= -2:
        status = 'declining'
    else:
        status = 'persistent'
    return change_rate, status


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
        sentiment_by_date = defaultdict(lambda: {
            'positive': 0, 'neutral': 0, 'negative': 0,
        })
        for article in articles:
            by_date[article['date']] += 1
            sentiment_by_date[article['date']][_classify_sentiment(article['title'])] += 1
        urls = []
        for article in sorted(articles, key=lambda row: row['date'], reverse=True):
            if article['url'] and article['url'] not in urls:
                urls.append(article['url'])
        topics.append({
            'stock_code': stock_code,
            'stock_name': stock_name,
            'topic_name': '%s %s' % (stock_name, label),
            'label': label,
            'keywords': _keyword_group(
                stock_name, label, [article['title'] for article in articles]
            ),
            'sentiment': _sentiment([article['title'] for article in articles]),
            'daily_counts': dict(by_date),
            'daily_sentiment_counts': dict(sentiment_by_date),
            'representative_urls': urls[:3],
        })
    _drop_shared_keywords(topics)
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
    cutoff_previous_7d = (date.fromisoformat(today_iso) - timedelta(days=13)).isoformat()
    previous_7d_count = conn.execute(
        'SELECT COALESCE(SUM(news_count),0) FROM news_topic_daily '
        'WHERE topic_id=? AND date>=? AND date<?',
        (topic_id, cutoff_previous_7d, cutoff_7d),
    ).fetchone()[0]
    count_30d = conn.execute(
        'SELECT COALESCE(SUM(news_count),0) FROM news_topic_daily WHERE topic_id=? AND date>=?',
        (topic_id, cutoff_30d),
    ).fetchone()[0]
    daily_rows = conn.execute(
        'SELECT news_count,positive_count,neutral_count,negative_count '
        'FROM news_topic_daily WHERE topic_id=?',
        (topic_id,),
    ).fetchall()
    sentiment_complete = all(
        row['positive_count'] is not None
        and row['neutral_count'] is not None
        and row['negative_count'] is not None
        and (
            row['positive_count'] + row['neutral_count'] + row['negative_count']
            == row['news_count']
        )
        for row in daily_rows
    )
    positive_count = (
        sum(row['positive_count'] for row in daily_rows)
        if sentiment_complete else None
    )
    neutral_count = (
        sum(row['neutral_count'] for row in daily_rows)
        if sentiment_complete else None
    )
    negative_count = (
        sum(row['negative_count'] for row in daily_rows)
        if sentiment_complete else None
    )
    change_rate, momentum_status = _momentum_change(count_7d, previous_7d_count)
    conn.execute(
        'UPDATE news_topics SET first_seen_at=?, last_seen_at=?, total_count=?, count_7d=?, '
        'count_30d=?, positive_count=?, neutral_count=?, negative_count=?, '
        'previous_7d_count=?, change_rate=?, momentum_status=?, status=?, updated_at=? '
        'WHERE id=?',
        (
            first_seen, last_seen, total_count or 0, count_7d, count_30d,
            positive_count, neutral_count, negative_count, previous_7d_count,
            change_rate, momentum_status, _topic_status(last_seen, today_iso),
            now_iso, topic_id,
        ),
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
                'INSERT INTO news_topic_daily '
                '(topic_id,stock_code,date,news_count,positive_count,neutral_count,'
                'negative_count,search_interest,created_at) '
                'VALUES (?,?,?,?,?,?,?,NULL,?) ON CONFLICT(topic_id,date) DO UPDATE SET '
                'news_count=excluded.news_count, '
                'positive_count=excluded.positive_count, '
                'neutral_count=excluded.neutral_count, '
                'negative_count=excluded.negative_count',
                [
                    (
                        topic_id, stock_code, day, count,
                        topic.get('daily_sentiment_counts', {}).get(day, {}).get('positive'),
                        topic.get('daily_sentiment_counts', {}).get(day, {}).get('neutral'),
                        topic.get('daily_sentiment_counts', {}).get(day, {}).get('negative'),
                        now_iso,
                    )
                    for day, count in topic['daily_counts'].items()
                ],
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


def load_coverage_dates(conn):
    """{종목코드: 마지막 수집 KST 날짜}. --full 이어달리기가 이미 처리한 종목을
    건너뛰는 데 쓴다. updated_at은 UTC ISO 문자열이라 KST 날짜로 환산한다."""
    result = {}
    for row in conn.execute(
        'SELECT stock_code, updated_at FROM news_stock_coverage'
    ).fetchall():
        updated_at = row['updated_at']
        if not updated_at:
            continue
        try:
            parsed = datetime.fromisoformat(updated_at)
        except (TypeError, ValueError):
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        result[row['stock_code']] = (parsed.astimezone(KST)).date()
    return result


def load_stock_momentum(conn, stock_code, daily_days=30):
    topic_rows = conn.execute(
        'SELECT * FROM news_topics WHERE stock_code=? ORDER BY '
        "CASE status WHEN 'active' THEN 0 WHEN 'cooling' THEN 1 ELSE 2 END, "
        'count_7d DESC, last_seen_at DESC LIMIT 12',
        (stock_code,),
    ).fetchall()
    topics = []
    for row in topic_rows:
        row_keys = set(row.keys())
        positive_count = row['positive_count'] if 'positive_count' in row_keys else None
        neutral_count = row['neutral_count'] if 'neutral_count' in row_keys else None
        negative_count = row['negative_count'] if 'negative_count' in row_keys else None
        previous_7d_count = (
            row['previous_7d_count'] if 'previous_7d_count' in row_keys else None
        )
        change_rate = row['change_rate'] if 'change_rate' in row_keys else None
        momentum_status = (
            row['momentum_status'] if 'momentum_status' in row_keys else None
        )
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
            'newsCount': row['total_count'],
            'count7d': row['count_7d'],
            'recent7dCount': row['count_7d'],
            'count30d': row['count_30d'],
            'sentiment': row['sentiment'],
            'sentimentCounts': (
                {
                    'positive': positive_count,
                    'neutral': neutral_count,
                    'negative': negative_count,
                }
                if positive_count is not None
                and neutral_count is not None
                and negative_count is not None
                else None
            ),
            'netSentiment': (
                positive_count - negative_count
                if positive_count is not None and negative_count is not None
                else None
            ),
            'negativeShare': (
                round(negative_count / row['total_count'], 4)
                if negative_count is not None and row['total_count'] else None
            ),
            'previous7dCount': previous_7d_count,
            'changeRate': change_rate,
            'momentumStatus': momentum_status,
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
