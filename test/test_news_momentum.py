# -*- coding: utf-8 -*-
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from unittest import mock


CLOUD_VM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'cloud-vm'))
if CLOUD_VM_DIR not in sys.path:
    sys.path.insert(0, CLOUD_VM_DIR)

import news_momentum
import news_momentum_scan
import backup_sqlite
import verify_news_momentum_db
import main as vm_main


TODAY = date(2026, 7, 29)

MOCK_NEWS = {
    '000660': (
        'SK하이닉스',
        [
            {'title': 'SK하이닉스 HBM 수요 증가…AI 반도체 공급 확대', 'link': 'https://n/1', 'pubDate': 'Tue, 28 Jul 2026 09:00:00 +0900'},
            {'title': 'AI 반도체 핵심 SK하이닉스, HBM 신규 공급 계약', 'link': 'https://n/2', 'pubDate': 'Mon, 27 Jul 2026 09:00:00 +0900'},
            {'title': 'SK하이닉스 광주 AI공장 신설 투자', 'link': 'https://n/3', 'pubDate': 'Sun, 26 Jul 2026 09:00:00 +0900'},
            {'title': '광주에 AI 반도체 생산라인 구축…SK하이닉스 투자 확대', 'link': 'https://n/4', 'pubDate': 'Sat, 25 Jul 2026 09:00:00 +0900'},
        ],
    ),
    '005930': (
        '삼성전자',
        [
            {'title': '삼성전자 AI 반도체 신규 공급계약 체결', 'link': 'https://n/5', 'pubDate': '202607281200'},
            {'title': '삼성전자 AI 반도체 수주 확대', 'link': 'https://n/6', 'pubDate': '202607271200'},
        ],
    ),
    '005380': (
        '현대차',
        [
            {'title': '현대차 전기차 신규 수주 계약', 'link': 'https://n/7', 'pubDate': '202607261200'},
            {'title': '현대차 공급계약…신규 수주 확대', 'link': 'https://n/8', 'pubDate': '202607251200'},
        ],
    ),
}


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode('utf-8')

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self.payload


class NewsMomentumTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, 'news_momentum.db')
        self.conn = news_momentum.get_conn(self.db_path)
        news_momentum.create_schema(self.conn)

    def tearDown(self):
        self.conn.close()
        self.temp_dir.cleanup()

    def test_schema_is_separate_and_has_required_indexes(self):
        self.assertNotEqual(os.path.basename(self.db_path), 'ohlc_snapshot.db')
        tables = {row[0] for row in self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
        self.assertTrue({
            'news_topics', 'news_topic_daily', 'datalab_trends', 'news_stock_coverage'
        } <= tables)
        indexes = {row[0] for row in self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index'"
        )}
        self.assertTrue({
            'idx_news_topics_stock_code',
            'idx_news_topics_stock_status',
            'idx_news_topics_last_seen',
            'idx_news_topic_daily_topic_date',
            'idx_news_topic_daily_stock_date',
            'idx_datalab_trends_topic_fetched',
        } <= indexes)
        self.assertEqual(self.conn.execute('PRAGMA journal_mode').fetchone()[0].lower(), 'wal')
        self.assertEqual(self.conn.execute('PRAGMA synchronous').fetchone()[0], 1)
        self.assertEqual(self.conn.execute('PRAGMA foreign_keys').fetchone()[0], 1)

    def test_three_stock_topic_extraction_and_idempotent_upsert(self):
        expected = {
            '000660': {'SK하이닉스 HBM 수요 증가', 'SK하이닉스 AI 반도체', 'SK하이닉스 광주공장 신설'},
            '005930': {'삼성전자 AI 반도체', '삼성전자 신규 수주'},
            '005380': {'현대차 신규 수주'},
        }
        for code, (name, items) in MOCK_NEWS.items():
            topics = news_momentum.extract_topics(code, name, items, today=TODAY)
            names = {topic['topic_name'] for topic in topics}
            self.assertTrue(expected[code] <= names)
            news_momentum.upsert_topics(self.conn, code, name, topics, today=TODAY)
            news_momentum.upsert_topics(self.conn, code, name, topics, today=TODAY)

        sk = news_momentum.load_stock_momentum(self.conn, '000660')
        self.assertGreaterEqual(len(sk['topics']), 3)
        hbm = next(topic for topic in sk['topics'] if topic['topicName'] == 'SK하이닉스 HBM 수요 증가')
        self.assertEqual(hbm['totalCount'], 2)
        self.assertEqual(len(hbm['representativeUrls']), 2)
        self.assertEqual(hbm['sentiment'], 'positive')
        self.assertEqual(sum(hbm['sentimentCounts'].values()), hbm['newsCount'])
        self.assertEqual(hbm['sentimentCounts']['positive'], 2)

    def test_keyword_change_increments_query_version(self):
        name, items = MOCK_NEWS['005380']
        topics = news_momentum.extract_topics('005380', name, items, today=TODAY)
        news_momentum.upsert_topics(self.conn, '005380', name, topics, today=TODAY)
        topics[0]['keywords'].append('현대차 글로벌 수주')
        news_momentum.upsert_topics(self.conn, '005380', name, topics, today=TODAY)
        version = self.conn.execute(
            'SELECT query_version FROM news_topics WHERE stock_code=?', ('005380',)
        ).fetchone()[0]
        self.assertEqual(version, 2)

    def test_sentiment_counts_dedupe_and_missing_data(self):
        items = [
            {'title': '삼성전자 AI 반도체 공급 확대', 'link': 'https://n/same',
             'pubDate': '2026-07-29'},
            {'title': '삼성전자 AI 반도체 공급 확대 복제', 'link': 'https://n/same',
             'pubDate': '2026-07-29'},
            {'title': '삼성전자 AI 반도체 우려 하락', 'link': 'https://n/negative',
             'pubDate': '2026-07-28'},
            {'title': '삼성전자 AI 반도체 관련 소식', 'link': 'https://n/neutral',
             'pubDate': '2026-07-27'},
        ]
        topics = news_momentum.extract_topics('005930', '삼성전자', items, today=TODAY)
        news_momentum.upsert_topics(self.conn, '005930', '삼성전자', topics, today=TODAY)
        ai = next(
            topic for topic in news_momentum.load_stock_momentum(self.conn, '005930')['topics']
            if topic['topicName'] == '삼성전자 AI 반도체'
        )
        self.assertEqual(ai['newsCount'], 3)
        self.assertEqual(ai['sentimentCounts'], {
            'positive': 1, 'neutral': 1, 'negative': 1,
        })
        self.assertEqual(sum(ai['sentimentCounts'].values()), ai['newsCount'])

        legacy_topic = [{
            'stock_code': '005930',
            'stock_name': '삼성전자',
            'topic_name': '삼성전자 과거 이슈',
            'label': '과거 이슈',
            'keywords': ['삼성전자 과거 이슈'],
            'sentiment': 'neutral',
            'daily_counts': {'2026-07-20': 2},
            'representative_urls': [],
        }]
        news_momentum.upsert_topics(
            self.conn, '005930', '삼성전자', legacy_topic, today=TODAY
        )
        legacy = next(
            topic for topic in news_momentum.load_stock_momentum(self.conn, '005930')['topics']
            if topic['topicName'] == '삼성전자 과거 이슈'
        )
        self.assertIsNone(legacy['sentimentCounts'])
        self.assertIsNone(legacy['netSentiment'])
        self.assertIsNone(legacy['negativeShare'])

    def test_current_batch_replaces_legacy_daily_count_without_sentiment(self):
        topics = news_momentum.extract_topics(
            '005930', '삼성전자', [
                {'title': '삼성전자 AI 반도체 공급 확대', 'link': 'https://n/current-1',
                 'pubDate': '2026-07-29'},
                {'title': '삼성전자 AI 반도체 우려 하락', 'link': 'https://n/current-2',
                 'pubDate': '2026-07-29'},
            ], today=TODAY,
        )
        topic = next(row for row in topics if row['topic_name'] == '삼성전자 AI 반도체')
        topic_id = self.conn.execute(
            '''INSERT INTO news_topics
               (stock_code,stock_name,topic_name,keywords_json,query_version,
                first_seen_at,last_seen_at,total_count,count_7d,count_30d,sentiment,
                status,representative_urls_json,created_at,updated_at)
               VALUES (?,?,?,?,1,?,?,3,3,3,?,'active','[]',?,?)''',
            (
                '005930', '삼성전자', topic['topic_name'], '[]',
                '2026-07-29', '2026-07-29', 'neutral',
                '2026-07-29T00:00:00+00:00', '2026-07-29T00:00:00+00:00',
            ),
        ).lastrowid
        self.conn.execute(
            '''INSERT INTO news_topic_daily
               (topic_id,stock_code,date,news_count,search_interest,created_at)
               VALUES (?,?,?,?,NULL,?)''',
            (topic_id, '005930', '2026-07-29', 3, '2026-07-29T00:00:00+00:00'),
        )
        self.conn.commit()

        news_momentum.upsert_topics(
            self.conn, '005930', '삼성전자', [topic], today=TODAY
        )
        loaded = news_momentum.load_stock_momentum(self.conn, '005930')['topics'][0]
        self.assertEqual(loaded['newsCount'], 2)
        self.assertEqual(sum(loaded['sentimentCounts'].values()), 2)

    def test_recent_previous_windows_and_momentum_statuses(self):
        topic = [{
            'stock_code': '005930',
            'stock_name': '삼성전자',
            'topic_name': '삼성전자 기간 비교',
            'label': '기간 비교',
            'keywords': ['삼성전자 기간 비교'],
            'sentiment': 'positive',
            'daily_counts': {
                '2026-07-29': 4,
                '2026-07-22': 2,
                '2026-07-15': 9,
            },
            'daily_sentiment_counts': {
                '2026-07-29': {'positive': 4, 'neutral': 0, 'negative': 0},
                '2026-07-22': {'positive': 1, 'neutral': 1, 'negative': 0},
                '2026-07-15': {'positive': 9, 'neutral': 0, 'negative': 0},
            },
            'representative_urls': [],
        }]
        news_momentum.upsert_topics(self.conn, '005930', '삼성전자', topic, today=TODAY)
        loaded = news_momentum.load_stock_momentum(self.conn, '005930')['topics'][0]
        self.assertEqual(loaded['recent7dCount'], 4)
        self.assertEqual(loaded['previous7dCount'], 2)
        self.assertEqual(loaded['changeRate'], 100.0)
        self.assertEqual(loaded['momentumStatus'], 'expanding')
        self.assertEqual(news_momentum._momentum_change(3, 0), (None, 'new'))
        self.assertEqual(news_momentum._momentum_change(3, 6), (-50.0, 'declining'))
        self.assertEqual(news_momentum._momentum_change(5, 4), (25.0, 'persistent'))
        self.assertEqual(news_momentum._momentum_change(0, 0), (None, 'persistent'))

    def test_legacy_schema_response_remains_backward_compatible(self):
        legacy = sqlite3.connect(':memory:')
        legacy.row_factory = sqlite3.Row
        legacy.executescript('''
            CREATE TABLE news_topics (
                id INTEGER PRIMARY KEY, stock_code TEXT, stock_name TEXT,
                topic_name TEXT, keywords_json TEXT, query_version INTEGER,
                first_seen_at TEXT, last_seen_at TEXT, total_count INTEGER,
                count_7d INTEGER, count_30d INTEGER, sentiment TEXT,
                status TEXT, representative_urls_json TEXT
            );
            CREATE TABLE news_topic_daily (
                topic_id INTEGER, date TEXT, news_count INTEGER, search_interest REAL
            );
            CREATE TABLE news_stock_coverage (
                stock_code TEXT, stock_name TEXT, requested_start_date TEXT,
                actual_start_date TEXT, actual_end_date TEXT, backfill_days INTEGER,
                backfill_complete INTEGER, fetched_articles INTEGER,
                news_api_calls INTEGER, updated_at TEXT
            );
            INSERT INTO news_topics VALUES (
                1,'005930','삼성전자','삼성전자 AI 반도체','[]',1,
                '2026-07-28','2026-07-29',2,2,2,'positive','active','[]'
            );
            INSERT INTO news_topic_daily VALUES (1,'2026-07-29',2,NULL);
        ''')
        try:
            topic = news_momentum.load_stock_momentum(legacy, '005930')['topics'][0]
        finally:
            legacy.close()
        self.assertEqual(topic['totalCount'], 2)
        self.assertIsNone(topic['sentimentCounts'])
        self.assertIsNone(topic['momentumStatus'])

    def test_datalab_request_and_save(self):
        name, items = MOCK_NEWS['005930']
        topics = news_momentum.extract_topics('005930', name, items, today=TODAY)
        news_momentum.upsert_topics(self.conn, '005930', name, topics, today=TODAY)
        due = news_momentum.datalab_topics_due(self.conn, '005930', today=TODAY)
        captured = {}

        def fake_urlopen(request, timeout):
            captured['url'] = request.full_url
            captured['body'] = json.loads(request.data.decode('utf-8'))
            groups = captured['body']['keywordGroups']
            return FakeResponse({
                'results': [
                    {'title': group['groupName'], 'keywords': group['keywords'],
                     'data': [{'period': '2026-07-28', 'ratio': 61.5},
                              {'period': '2026-07-29', 'ratio': 82.0}]}
                    for group in groups
                ]
            })

        with mock.patch('urllib.request.urlopen', side_effect=fake_urlopen):
            trends = news_momentum.fetch_datalab_trends(
                due, 'client-id', 'client-secret', '2026-05-01', '2026-07-29'
            )
        self.assertEqual(captured['url'], news_momentum.DATALAB_URL)
        self.assertLessEqual(len(captured['body']['keywordGroups']), 5)
        self.assertTrue(all(len(group['keywords']) <= 20 for group in captured['body']['keywordGroups']))
        news_momentum.save_datalab_trends(
            self.conn, due, trends, '2026-05-01', '2026-07-29',
            now=datetime(2026, 7, 29, tzinfo=timezone.utc),
        )
        loaded = news_momentum.load_stock_momentum(self.conn, '005930')
        self.assertEqual(loaded['topics'][0]['latestSearchInterest'], 82.0)
        self.assertEqual(news_momentum.datalab_topics_due(self.conn, '005930', today=TODAY), [])

    def test_retention_deletes_detail_without_vacuum(self):
        name, _ = MOCK_NEWS['005380']
        old_topic = [{
            'stock_code': '005380',
            'stock_name': name,
            'topic_name': '현대차 과거 수주',
            'label': '과거 수주',
            'keywords': ['현대차 과거 수주'],
            'sentiment': 'neutral',
            'daily_counts': {'2026-04-01': 2},
            'representative_urls': [],
        }]
        news_momentum.upsert_topics(self.conn, '005380', name, old_topic, today=TODAY)
        result = news_momentum.prune_old_details(self.conn, today=TODAY)
        self.assertEqual(result['dailyDeleted'], 1)
        self.assertEqual(self.conn.execute(
            'SELECT COUNT(*) FROM news_topics WHERE stock_code=?', ('005380',)
        ).fetchone()[0], 1)

    def test_stale_topic_status_and_datalab_snapshot_are_bounded(self):
        name, items = MOCK_NEWS['000660']
        topics = news_momentum.extract_topics('000660', name, items, today=TODAY)
        rows = news_momentum.upsert_topics(
            self.conn, '000660', name, topics, today=TODAY
        )
        topic = rows[0]
        trend = {'topic-%s' % topic['id']: [
            {'period': '2026-07-29', 'ratio': 50.0},
        ]}
        news_momentum.save_datalab_trends(
            self.conn, [topic], trend, '2026-07-01', '2026-07-29',
            now=datetime(2026, 7, 29, tzinfo=timezone.utc),
        )
        news_momentum.save_datalab_trends(
            self.conn, [topic], trend, '2026-07-02', '2026-07-30',
            now=datetime(2026, 7, 30, tzinfo=timezone.utc),
        )
        snapshots = self.conn.execute(
            'SELECT COUNT(*) FROM datalab_trends WHERE topic_id=? AND query_version=?',
            (topic['id'], topic['query_version']),
        ).fetchone()[0]
        self.assertEqual(snapshots, 1)

        changed = news_momentum.refresh_topic_statuses(
            self.conn, today=date(2026, 9, 1), stock_code='000660'
        )
        status = self.conn.execute(
            'SELECT status FROM news_topics WHERE id=?', (topic['id'],)
        ).fetchone()[0]
        self.assertGreater(changed, 0)
        self.assertEqual(status, 'ended')

    def test_default_scan_scope_is_approved_eight_stocks(self):
        names = {
            '000660': 'SK하이닉스', '005930': '삼성전자', '005380': '현대차',
            '083650': '비에이치아이', '042660': '한화오션', '035420': 'NAVER',
            '066570': 'LG전자', '247540': '에코프로비엠',
        }
        universe = [{'code': code, 'name': name} for code, name in names.items()]
        selected = news_momentum_scan.select_universe(
            universe, news_momentum_scan.parse_args([])
        )
        self.assertEqual([row['code'] for row in selected], list(news_momentum_scan.TEST_CODES))

    def test_full_scope_covers_entire_universe(self):
        universe = [{'code': '%06d' % index, 'name': 'stock%d' % index} for index in range(50)]
        selected = news_momentum_scan.select_universe(
            universe, news_momentum_scan.parse_args(['--full'])
        )
        self.assertEqual(len(selected), 50)

    def test_full_scan_rotates_from_cursor(self):
        universe = [{'code': '%06d' % index} for index in range(5)]
        rotated = news_momentum_scan.rotate_from_cursor(universe, 3)
        self.assertEqual(
            [row['code'] for row in rotated],
            ['000003', '000004', '000000', '000001', '000002'],
        )
        # 커서가 종목 수를 넘어가도 안전하게 되돌아온다.
        self.assertEqual(
            [row['code'] for row in news_momentum_scan.rotate_from_cursor(universe, 7)],
            ['000002', '000003', '000004', '000000', '000001'],
        )
        self.assertEqual(news_momentum_scan.rotate_from_cursor([], 3), [])

    def test_full_scan_cursor_state_roundtrip_and_recovery(self):
        cursor_path = os.path.join(self.temp_dir.name, 'cursor.json')
        with mock.patch.object(news_momentum_scan, 'CURSOR_FILE', cursor_path):
            fresh = news_momentum_scan.load_cursor()
            self.assertEqual(fresh['cursor'], 0)
            self.assertEqual(fresh['newsCalls'], 0)

            fresh.update({'cursor': 120, 'day': '2026-08-02', 'newsCalls': 300, 'datalabCalls': 12})
            news_momentum_scan.save_cursor(fresh)
            self.assertEqual(news_momentum_scan.load_cursor()['cursor'], 120)
            self.assertEqual(news_momentum_scan.load_cursor()['newsCalls'], 300)

            # 손상된 커서 파일은 처음부터 다시 시작한다(예외 없이).
            with open(cursor_path, 'w', encoding='utf-8') as broken:
                broken.write('{not json')
            self.assertEqual(news_momentum_scan.load_cursor()['cursor'], 0)

            # 음수·문자열 같은 비정상 값도 0으로 정규화한다.
            with open(cursor_path, 'w', encoding='utf-8') as odd:
                json.dump({'cursor': -5, 'newsCalls': 'x'}, odd)
            recovered = news_momentum_scan.load_cursor()
            self.assertEqual(recovered['cursor'], 0)
            self.assertEqual(recovered['newsCalls'], 0)

    def test_coverage_dates_use_kst_day(self):
        # UTC 2026-08-01T20:00Z = KST 2026-08-02 05:00 - 하루 단위 스킵 판정이 KST여야 한다.
        news_momentum.save_stock_coverage(
            self.conn, '000660', 'SK하이닉스', '2026-05-01', '2026-05-01',
            '2026-08-01', True, 10, 1, now=datetime(2026, 8, 1, 20, 0, tzinfo=timezone.utc),
        )
        dates = news_momentum.load_coverage_dates(self.conn)
        self.assertEqual(dates['000660'], date(2026, 8, 2))

    def _run_full_scan(self, universe, argv, status_sink, cursor_path):
        """--full 실행을 외부 호출 없이 돌린다(뉴스 1페이지 = API 1회)."""
        def fake_search(name, client_id, client_secret, **kwargs):
            return [{
                'title': '%s AI 반도체 공급 확대 계약' % name,
                'link': 'https://n/%s/1' % name,
                'pubDate': '2026-08-01',
            }]

        args = news_momentum_scan.parse_args(argv + ['--db', self.db_path, '--skip-datalab'])
        with mock.patch.object(news_momentum_scan, 'CURSOR_FILE', cursor_path), \
                mock.patch.object(news_momentum_scan, 'load_dotenv', lambda: None), \
                mock.patch.object(
                    news_momentum_scan.daily_scan, 'load_full_universe', lambda: universe), \
                mock.patch.object(
                    news_momentum_scan.naver_news, 'search_news', side_effect=fake_search), \
                mock.patch.object(
                    news_momentum_scan, 'write_batch_status',
                    lambda status, **fields: status_sink.append(dict(fields, status=status))), \
                mock.patch.dict(os.environ, {
                    'NAVER_APIHUB_CLIENT_ID': 'id', 'NAVER_APIHUB_CLIENT_SECRET': 'secret'}):
            return news_momentum_scan.run(args)

    def test_full_scan_resumes_from_cursor_within_daily_call_budget(self):
        universe = [{'code': '%06d' % index, 'name': '종목%d' % index} for index in range(10)]
        cursor_path = os.path.join(self.temp_dir.name, 'cursor.json')
        status = []

        # 뉴스 호출 예산 4회 = 4종목까지만 처리하고 커서를 남긴다.
        exit_code = self._run_full_scan(
            universe, ['--full', '--news-call-budget', '4'], status, cursor_path
        )
        self.assertEqual(exit_code, 0)
        self.assertEqual(status[-1]['stopReason'], 'news-budget-exhausted')
        self.assertEqual(status[-1]['processed'], 4)
        self.assertEqual(status[-1]['universeSize'], 10)
        with mock.patch.object(news_momentum_scan, 'CURSOR_FILE', cursor_path):
            saved = news_momentum_scan.load_cursor()
        self.assertEqual(saved['cursor'], 4)
        self.assertEqual(saved['newsCalls'], 4)
        covered = news_momentum.load_coverage_dates(self.conn)
        self.assertEqual(sorted(covered), ['000000', '000001', '000002', '000003'])

        # 같은 날 다시 돌리면 남은 예산이 없어 아무 종목도 처리하지 않는다.
        self._run_full_scan(
            universe, ['--full', '--news-call-budget', '4'], status, cursor_path
        )
        self.assertEqual(status[-1]['processed'], 0)
        self.assertEqual(status[-1]['stopReason'], 'news-budget-exhausted')

        # 예산을 늘리면 커서 위치(4번)부터 이어서 나머지를 처리한다.
        self._run_full_scan(
            universe, ['--full', '--news-call-budget', '100'], status, cursor_path
        )
        self.assertEqual(status[-1]['stopReason'], 'universe-complete')
        self.assertEqual(status[-1]['processed'], 6)
        self.assertEqual(status[-1]['skippedFresh'], 4)  # 오늘 이미 수집한 앞 4종목
        self.assertEqual(len(news_momentum.load_coverage_dates(self.conn)), 10)

    def test_full_scan_skips_failed_stock_without_blocking_cursor(self):
        universe = [{'code': '%06d' % index, 'name': '종목%d' % index} for index in range(3)]
        cursor_path = os.path.join(self.temp_dir.name, 'cursor.json')
        status = []

        def flaky_search(name, client_id, client_secret, **kwargs):
            if name == '종목0':
                raise RuntimeError('네이버 일시 오류')
            return [{'title': '%s 신규 수주 계약' % name, 'link': 'https://n/%s' % name,
                     'pubDate': '2026-08-01'}]

        args = news_momentum_scan.parse_args(
            ['--full', '--db', self.db_path, '--skip-datalab']
        )
        with mock.patch.object(news_momentum_scan, 'CURSOR_FILE', cursor_path), \
                mock.patch.object(news_momentum_scan, 'load_dotenv', lambda: None), \
                mock.patch.object(
                    news_momentum_scan.daily_scan, 'load_full_universe', lambda: universe), \
                mock.patch.object(
                    news_momentum_scan.naver_news, 'search_news', side_effect=flaky_search), \
                mock.patch.object(
                    news_momentum_scan, 'write_batch_status',
                    lambda s, **fields: status.append(dict(fields, status=s))), \
                mock.patch.dict(os.environ, {
                    'NAVER_APIHUB_CLIENT_ID': 'id', 'NAVER_APIHUB_CLIENT_SECRET': 'secret'}):
            exit_code = news_momentum_scan.run(args)

        # 한 종목이 실패해도 나머지는 수집되고 배치 자체는 성공(날짜 마커 기록 가능)이다.
        self.assertEqual(exit_code, 0)
        self.assertEqual(status[-1]['status'], 'completed')
        self.assertEqual(status[-1]['failureCount'], 1)
        self.assertEqual(status[-1]['processed'], 2)
        self.assertEqual(sorted(news_momentum.load_coverage_dates(self.conn)),
                         ['000001', '000002'])

    def test_90day_backfill_coverage_and_api_metadata(self):
        recent = [
            {'title': '삼성전자 AI 반도체 공급 확대', 'link': 'https://n/%d' % index,
             'pubDate': '2026-07-%02d' % (29 - (index % 20))}
            for index in range(100)
        ]
        older = [
            {'title': '삼성전자 AI 반도체 신규 수주', 'link': 'https://old/1',
             'pubDate': '2026-04-30'}
        ]
        with mock.patch.object(
            news_momentum_scan.naver_news,
            'search_news',
            side_effect=[recent, older],
        ) as search:
            items, coverage = news_momentum_scan.fetch_news_backfill(
                '삼성전자', 'secret-id', 'secret-key', TODAY
            )
        self.assertEqual(search.call_count, 2)
        self.assertTrue(coverage['backfillComplete'])
        self.assertEqual(coverage['requestedStartDate'], '2026-05-01')
        self.assertEqual(coverage['actualEndDate'], '2026-07-29')
        self.assertEqual(len(items), 100)

        news_momentum.save_stock_coverage(
            self.conn, '005930', '삼성전자',
            coverage['requestedStartDate'], coverage['actualStartDate'],
            coverage['actualEndDate'], coverage['backfillComplete'],
            len(items), coverage['newsApiCalls'], coverage['backfillDays'],
        )
        loaded = news_momentum.load_stock_momentum(self.conn, '005930')
        self.assertEqual(loaded['dataAsOf'], '2026-07-29')
        self.assertTrue(loaded['coverage']['backfillComplete'])

    def test_duplicate_batch_lock_is_rejected(self):
        lock_path = os.path.join(self.temp_dir.name, 'momentum.lock')
        with news_momentum_scan.BatchLock(lock_path):
            with self.assertRaises(news_momentum_scan.AlreadyRunning):
                with news_momentum_scan.BatchLock(lock_path):
                    pass

    def test_sqlite_backup_api_creates_valid_backup(self):
        source = os.path.join(self.temp_dir.name, 'ohlc_snapshot.db')
        backup_dir = os.path.join(self.temp_dir.name, 'backups')
        conn = sqlite3.connect(source)
        conn.execute('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)')
        conn.execute('INSERT INTO sample(value) VALUES (?)', ('preserved',))
        conn.commit()
        conn.close()

        result = backup_sqlite.backup_database(source, backup_dir, keep=2)
        restored = sqlite3.connect(result['backup'])
        try:
            self.assertEqual(
                restored.execute('SELECT value FROM sample').fetchone()[0],
                'preserved',
            )
            self.assertEqual(
                restored.execute('PRAGMA integrity_check').fetchone()[0],
                'ok',
            )
        finally:
            restored.close()

    def test_deployed_db_verifier_requires_all_eight_stocks(self):
        for code in verify_news_momentum_db.PILOT_CODES:
            topic = [{
                'stock_code': code,
                'stock_name': code,
                'topic_name': '%s 검증 이슈' % code,
                'label': '검증 이슈',
                'keywords': ['%s 검증 이슈' % code],
                'sentiment': 'neutral',
                'daily_counts': {'2026-07-29': 1},
                'daily_sentiment_counts': {
                    '2026-07-29': {'positive': 0, 'neutral': 1, 'negative': 0},
                },
                'representative_urls': [],
            }]
            news_momentum.upsert_topics(self.conn, code, code, topic, today=TODAY)
            news_momentum.save_stock_coverage(
                self.conn, code, code, '2026-05-01', '2026-05-01',
                '2026-07-29', True, 10, 1,
            )
        result = verify_news_momentum_db.verify_database(self.db_path)
        self.assertEqual(result['stocks'], 8)
        self.assertEqual(result['latestDataDate'], '2026-07-29')

    def test_deploy_timer_momentum_contract(self):
        deploy_path = os.path.join(CLOUD_VM_DIR, 'deploy_check.sh')
        with open(deploy_path, 'r', encoding='utf-8') as source:
            script = source.read()
        self.assertIn('APP_DIR="/home/goodbyestarwars/kiwoom-api"', script)
        self.assertIn('PYTHON="$APP_DIR/venv/bin/python"', script)
        self.assertIn('if [ "$(id -un)" != "goodbyestarwars" ]', script)
        self.assertIn('TZ=Asia/Seoul date +%F', script)
        self.assertIn('MOMENTUM_SCHEMA_VERSION="3"', script)
        self.assertIn('flock -n -E 75', script)
        # 2026-08-02: 파일럿 8종목 고정 목록 -> 전 상장종목 커서 이어달리기(--full)
        self.assertIn('--full', script)
        self.assertNotIn(
            '000660,005930,005380,083650,042660,035420,066570,247540',
            script,
        )
        self.assertIn('run_news_momentum_if_due "$DEPLOY_OCCURRED" || true', script)
        self.assertNotIn('/etc/systemd/system/kiwoom-news-momentum', script)
        self.assertNotIn('rollback_news_momentum.sh', script)

    def test_momentum_card_mobile_dark_and_missing_data_contract(self):
        repo_root = os.path.abspath(os.path.join(CLOUD_VM_DIR, '..', '..'))
        with open(
            os.path.join(repo_root, 'css', 'foreign-flow.css'),
            'r', encoding='utf-8',
        ) as source:
            css = source.read()
        with open(
            os.path.join(repo_root, 'js', 'foreign-flow.js'),
            'r', encoding='utf-8',
        ) as source:
            javascript = source.read()
        self.assertIn('@media (max-width: 420px)', css)
        self.assertIn('grid-template-columns: minmax(0, 1fr)', css)
        self.assertIn(
            'html.dark #foreign-flow .ff-momentum-change.status-expanding',
            css,
        )
        self.assertIn('감성 데이터 없음', javascript)
        self.assertIn('검색 관심도 데이터 부족', javascript)
        self.assertIn('※ 뉴스 제목 기준 자동 분류', javascript)

    def test_fastapi_momentum_response_and_health_regression(self):
        name, items = MOCK_NEWS['000660']
        topics = news_momentum.extract_topics('000660', name, items, today=TODAY)
        news_momentum.upsert_topics(self.conn, '000660', name, topics, today=TODAY)
        with mock.patch.object(news_momentum, 'DB_FILE', self.db_path), \
                mock.patch.dict(os.environ, {'NEWS_MOMENTUM_ENABLED': '1'}):
            response = vm_main.news_momentum_endpoint('000660')
        self.assertTrue(response['success'])
        self.assertTrue(response['data']['enabled'])
        self.assertEqual(response['data']['stockCode'], '000660')
        self.assertGreaterEqual(len(response['data']['topics']), 3)
        topic = response['data']['topics'][0]
        self.assertIn('sentimentCounts', topic)
        self.assertIn('previous7dCount', topic)
        self.assertIn('changeRate', topic)
        self.assertIn('momentumStatus', topic)
        health = vm_main.health()['data']
        self.assertEqual(health['status'], 'ok')
        self.assertEqual(health['momentumSchedulerVersion'], 'deploy-timer-flock-v1')
        self.assertEqual(health['momentumAggregationVersion'], 3)

        with mock.patch.dict(os.environ, {'NEWS_MOMENTUM_ENABLED': '0'}):
            disabled = vm_main.news_momentum_endpoint('000660')
        self.assertFalse(disabled['data']['enabled'])
        self.assertEqual(disabled['data']['topics'], [])

    def test_fundamentals_single_endpoint_slices_batch_cache(self):
        """종목분석 펀더멘탈 탭이 전 종목 배치 대신 단건만 받도록 추가한 엔드포인트."""
        cache_path = os.path.join(self.temp_dir.name, 'fundamentals_cache.json')
        annual = {'years': [{'year': 2025, 'revenue': 100}], 'latest_roe_pct': 12.5}
        with open(cache_path, 'w', encoding='utf-8') as output:
            json.dump({
                'data': {
                    '000660': {'annual': annual, 'latest_quarter': None},
                    '005930': {'annual': None, 'latest_quarter': None},
                },
                'fetchedAt': {'000660': '2026-08-01T00:00:00+00:00'},
            }, output)

        with mock.patch.object(vm_main, 'FUNDAMENTALS_CACHE_FILE', cache_path), \
                mock.patch.object(vm_main, '_fundamentals_cache_mem', {}), \
                mock.patch.object(vm_main, 'require_api_key', lambda key: None):
            hit = vm_main.fundamentals_single('000660')
            miss = vm_main.fundamentals_single('123456')
            # 두 번째 호출은 mtime이 그대로라 파일을 다시 파싱하지 않는다.
            with mock.patch.object(vm_main.json, 'load', side_effect=AssertionError('re-parsed')):
                cached = vm_main.fundamentals_single('000660')

        self.assertTrue(hit['success'])
        self.assertEqual(hit['data']['code'], '000660')
        self.assertEqual(hit['data']['fundamentals']['annual'], annual)
        self.assertEqual(hit['data']['fetchedAt'], '2026-08-01T00:00:00+00:00')
        # 캐시에 없는 종목은 오류가 아니라 fundamentals: null - 화면이 안내 문구를 띄운다.
        self.assertIsNone(miss['data']['fundamentals'])
        self.assertEqual(cached['data']['fundamentals']['annual'], annual)

    def test_fundamentals_single_reports_missing_cache(self):
        with mock.patch.object(
            vm_main, 'FUNDAMENTALS_CACHE_FILE',
            os.path.join(self.temp_dir.name, 'absent.json'),
        ), mock.patch.object(vm_main, '_fundamentals_cache_mem', {}), \
                mock.patch.object(vm_main, 'require_api_key', lambda key: None):
            with self.assertRaises(vm_main.HTTPException) as raised:
                vm_main.fundamentals_single('000660')
        self.assertEqual(raised.exception.status_code, 503)


if __name__ == '__main__':
    unittest.main()
