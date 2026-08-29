import os
import sys
import tempfile
import unittest
from unittest import mock
from datetime import datetime, timedelta, timezone
import json
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import domestic_news


class DomesticNewsTests(unittest.TestCase):
    def tearDown(self):
        domestic_news._watchlist_disclosure_cache.clear()
        domestic_news._kind_cache = None
        domestic_news._dart_cache.clear()

    def test_cache_reads_use_an_index_instead_of_scanning_the_whole_table(self):
        """캐시 조회가 전체 테이블 스캔으로 돌아가지 않는지 고정한다.

        2026-08-30: 인덱스가 item_key PRIMARY KEY뿐이라 `WHERE fetched_at >= ?
        ORDER BY pub_date DESC`가 매 요청 전체 스캔 + 전체 정렬이었고, get_news()가
        이걸 요청당 두 번 돌려 캐시 응답이 라이브에서 6~13초 걸렸다.
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = os.path.join(temp_dir, 'domestic.db')
            with mock.patch.object(domestic_news, 'CACHE_DB_FILE', db_path):
                conn = domestic_news._connect()
                try:
                    indexes = {row['name'] for row in
                               conn.execute("PRAGMA index_list('domestic_news')").fetchall()}
                    self.assertIn('idx_domestic_news_fetched_at', indexes)
                    self.assertIn('idx_domestic_news_kind_fetched_at', indexes)
                    plan = conn.execute(
                        'EXPLAIN QUERY PLAN SELECT * FROM domestic_news '
                        'WHERE fetched_at >= ? ORDER BY pub_date DESC LIMIT 100', (0,)
                    ).fetchall()
                    detail = ' '.join(str(row[-1]) for row in plan)
                    self.assertIn('idx_domestic_news_fetched_at', detail)
                    self.assertNotIn('SCAN domestic_news', detail)
                finally:
                    conn.close()

    def test_ensure_schema_builds_indexes_off_the_request_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = os.path.join(temp_dir, 'domestic.db')
            with mock.patch.object(domestic_news, 'CACHE_DB_FILE', db_path):
                domestic_news.ensure_schema()
                conn = domestic_news._connect()
                try:
                    indexes = {row['name'] for row in
                               conn.execute("PRAGMA index_list('domestic_news')").fetchall()}
                finally:
                    conn.close()
        self.assertIn('idx_domestic_news_fetched_at', indexes)

    def test_classifies_financial_and_market_headlines(self):
        self.assertEqual(domestic_news.classify('삼성전자 영업이익 깜짝 실적'), '실적')
        self.assertEqual(domestic_news.classify('코스피 상승 출발'), '시장')
        self.assertEqual(domestic_news.classify('새로운 사업 소식'), '일반')

    def test_normalizes_and_marks_direct_stock_match(self):
        item = domestic_news.normalize_naver({
            'title': '<b>삼성전자</b> 공급계약 체결',
            'description': '삼성전자와 계약을 체결했다',
            'link': 'https://www.example.com/article?id=1&utm_source=naver',
            'pubDate': 'Mon, 10 Aug 2026 09:00:00 +0900',
            'source': 'example.com',
        }, '005930', '삼성전자')
        self.assertEqual(item['category'], '수주·계약')
        self.assertEqual(item['relevance'], 'direct')
        self.assertNotIn('utm_source', item['link'])

    def test_get_news_uses_cache_when_provider_is_not_configured(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = os.path.join(temp_dir, 'domestic.db')
            with mock.patch.object(domestic_news, 'CACHE_DB_FILE', db_path), \
                    mock.patch.dict(os.environ, {
                        'NAVER_APIHUB_CLIENT_ID': '',
                        'NAVER_APIHUB_CLIENT_SECRET': '',
                        'DART_API_KEY': '',
                    }, clear=False):
                item = domestic_news.normalize_naver({
                    'title': '시장 뉴스', 'link': 'https://example.com/news/1',
                    'pubDate': 'Mon, 10 Aug 2026 09:00:00 +0900',
                })
                domestic_news._save([item])
                result = domestic_news.get_news(limit=10)
                self.assertEqual(result['source'], 'cache')
                self.assertEqual(result['items'][0]['title'], '시장 뉴스')

    def test_title_match_is_direct_and_body_match_is_only_fallback(self):
        title_match = domestic_news.normalize_naver({
            'title': '<b>삼성전자</b> 신규 투자 발표',
            'description': '삼성전자 관련 내용입니다.',
            'link': 'https://example.com/news/title-match',
        }, '005930', '삼성전자')
        body_match = domestic_news.normalize_naver({
            'title': '반도체 업계 투자 확대',
            'description': '삼성전자가 관련 사업을 확대합니다.',
            'link': 'https://example.com/news/body-match',
        }, '005930', '삼성전자')

        self.assertEqual(title_match['relevance'], 'direct')
        self.assertEqual(body_match['relevance'], 'body')
        self.assertEqual(body_match['stockCode'], '')

        selected = domestic_news._select_stock_news(
            [title_match, body_match], '005930', '삼성전자', body_fallback_limit=3,
        )
        self.assertEqual([item['relevance'] for item in selected], ['direct', 'body'])

    def test_disclosures_are_prioritized_over_newer_news(self):
        items = [
            {
                'id': 'news-1', 'title': 'latest news',
                'pubDate': 'Mon, 10 Aug 2026 13:16:00 +0900',
                'kind': 'news', 'relevance': 'direct',
            },
            {
                'id': 'dart-1', 'title': 'NH investment disclosure',
                'pubDate': '20260810',
                'kind': 'disclosure', 'relevance': 'direct',
            },
        ]

        merged = domestic_news._merge(items, limit=1, code='005940')

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]['kind'], 'disclosure')

    def test_news_filter_removes_disclosures_before_limit_is_applied(self):
        items = [
            {'id': 'dart-1', 'title': 'disclosure', 'pubDate': '20260810', 'kind': 'disclosure'},
            {'id': 'news-1', 'title': 'market headline', 'pubDate': 'Mon, 10 Aug 2026 13:16:00 +0900', 'kind': 'news'},
        ]

        merged = domestic_news._merge(items, limit=1, item_kind='news')

        self.assertEqual([item['id'] for item in merged], ['news-1'])

    def _fake_dart(self, rows, calls):
        """DART 목록 API 응답을 흉내내고 호출 횟수를 세는 urlopen 대역."""
        class FakeResponse:
            def __init__(self, payload):
                self.payload = payload

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(self.payload).encode('utf-8')

        def fake_urlopen(request, timeout=0):
            calls.append(request.full_url)
            return FakeResponse({'status': '000', 'total_page': 1, 'list': rows})

        return fake_urlopen

    def test_general_dart_feed_is_cached_so_every_request_does_not_call_dart(self):
        """2026-08-30: 같은 파일 KIND는 30초 캐시가 있는데 DART만 없어서 홈이 부르는
        /domestic-news가 요청마다 DART를 라이브로 쳤다(서버 작업의 약 3.1초)."""
        rows = [
            {'stock_code': '005930', 'corp_name': '삼성전자', 'rcept_no': '1',
             'report_nm': '주요사항보고서', 'flr_nm': '삼성전자', 'rcept_dt': '20260830'},
            {'stock_code': '000660', 'corp_name': 'SK하이닉스', 'rcept_no': '2',
             'report_nm': '분기보고서', 'flr_nm': 'SK하이닉스', 'rcept_dt': '20260830'},
        ]
        calls = []
        with mock.patch.dict(os.environ, {'DART_API_KEY': 'test-key'}, clear=False), \
                mock.patch.object(domestic_news.urllib.request, 'urlopen',
                                  side_effect=self._fake_dart(rows, calls)):
            first = domestic_news._dart_items(start_date='20260828', end_date='20260830')
            second = domestic_news._dart_items(start_date='20260828', end_date='20260830')
            # 캐시는 필터 이전 원본 행을 담으므로 종목 필터는 캐시 히트에서도 동작해야 한다.
            filtered = domestic_news._dart_items(code='005930', start_date='20260828',
                                                 end_date='20260830')
        self.assertEqual(len(calls), 1)
        self.assertEqual([i['stockCode'] for i in first], ['005930', '000660'])
        self.assertEqual([i['stockCode'] for i in second], ['005930', '000660'])
        self.assertEqual([i['stockCode'] for i in filtered], ['005930'])

    def test_expired_dart_cache_refetches(self):
        rows = [{'stock_code': '005930', 'corp_name': '삼성전자', 'rcept_no': '1',
                 'report_nm': '주요사항보고서', 'flr_nm': '삼성전자', 'rcept_dt': '20260830'}]
        calls = []
        with mock.patch.dict(os.environ, {'DART_API_KEY': 'test-key'}, clear=False), \
                mock.patch.object(domestic_news, 'DART_CACHE_TTL_SEC', 0), \
                mock.patch.object(domestic_news.urllib.request, 'urlopen',
                                  side_effect=self._fake_dart(rows, calls)):
            domestic_news._dart_items(start_date='20260828', end_date='20260830')
            domestic_news._dart_items(start_date='20260828', end_date='20260830')
        self.assertEqual(len(calls), 2)

    def test_company_specific_dart_lookup_is_not_cached(self):
        """corp_code별 조회는 상위 _watchlist_disclosure_cache(30분)가 담당하므로
        여기서 캐시하면 키가 종목 수만큼 늘어난다."""
        rows = [{'stock_code': '005930', 'corp_name': '삼성전자', 'rcept_no': '1',
                 'report_nm': '주요사항보고서', 'flr_nm': '삼성전자', 'rcept_dt': '20260830'}]
        calls = []
        with mock.patch.dict(os.environ, {'DART_API_KEY': 'test-key'}, clear=False), \
                mock.patch.object(domestic_news.urllib.request, 'urlopen',
                                  side_effect=self._fake_dart(rows, calls)):
            domestic_news._dart_items(corp_code='00126380', start_date='20260828', end_date='20260830')
            domestic_news._dart_items(corp_code='00126380', start_date='20260828', end_date='20260830')
        self.assertEqual(len(calls), 2)

    def test_dart_failure_serves_the_last_successful_rows(self):
        rows = [{'stock_code': '005930', 'corp_name': '삼성전자', 'rcept_no': '1',
                 'report_nm': '주요사항보고서', 'flr_nm': '삼성전자', 'rcept_dt': '20260830'}]
        calls = []
        with mock.patch.dict(os.environ, {'DART_API_KEY': 'test-key'}, clear=False), \
                mock.patch.object(domestic_news.urllib.request, 'urlopen',
                                  side_effect=self._fake_dart(rows, calls)):
            domestic_news._dart_items(start_date='20260828', end_date='20260830')
        with mock.patch.dict(os.environ, {'DART_API_KEY': 'test-key'}, clear=False), \
                mock.patch.object(domestic_news, 'DART_CACHE_TTL_SEC', 0), \
                mock.patch.object(domestic_news.urllib.request, 'urlopen',
                                  side_effect=OSError('DART down')):
            items = domestic_news._dart_items(start_date='20260828', end_date='20260830')
        self.assertEqual([i['stockCode'] for i in items], ['005930'])

    def test_dart_items_reads_every_requested_page_for_a_company(self):
        pages = {
            1: {'status': '000', 'total_page': 2, 'list': [
                {'stock_code': '005930', 'corp_name': '삼성전자', 'rcept_no': '1',
                 'report_nm': '주요사항보고서', 'flr_nm': '삼성전자', 'rcept_dt': '20260816'},
            ]},
            2: {'status': '000', 'total_page': 2, 'list': [
                {'stock_code': '005930', 'corp_name': '삼성전자', 'rcept_no': '2',
                 'report_nm': '분기보고서', 'flr_nm': '삼성전자', 'rcept_dt': '20260815'},
            ]},
        }

        class FakeResponse:
            def __init__(self, payload):
                self.payload = payload

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(self.payload).encode('utf-8')

        requested = []

        def fake_urlopen(request, timeout=0):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
            requested.append(query)
            return FakeResponse(pages[int(query['page_no'][0])])

        with mock.patch.dict(os.environ, {'DART_API_KEY': 'test-key'}, clear=False), \
                mock.patch.object(domestic_news.urllib.request, 'urlopen', side_effect=fake_urlopen):
            items = domestic_news._dart_items(
                code='005930', start_date='20260810', end_date='20260816',
                corp_code='00126380', max_pages=3,
            )

        self.assertEqual([item['pubDate'] for item in items], ['20260816', '20260815'])
        self.assertEqual([query['page_no'][0] for query in requested], ['1', '2'])
        self.assertTrue(all(query['corp_code'][0] == '00126380' for query in requested))

    def test_watchlist_disclosures_include_every_domestic_watchlist_stock(self):
        now = datetime(2026, 8, 16, 12, tzinfo=timezone(timedelta(hours=9)))

        def fake_dart_items(**kwargs):
            code = kwargs['code']
            day = '20260816' if code == '005930' else '20260814'
            return [{
                'id': code, 'title': code + ' 공시', 'link': 'https://dart.example/' + code,
                'pubDate': day, 'kind': 'disclosure', 'stockCode': code,
                'stockName': '삼성전자' if code == '005930' else 'SK하이닉스',
            }]

        with mock.patch.dict(os.environ, {'DART_API_KEY': 'test-key'}, clear=False), \
                mock.patch.object(domestic_news.dart_client, 'get_corp_code_map', return_value={
                    '005930': '00126380', '000660': '00164779',
                }), \
                mock.patch.object(domestic_news, '_dart_items', side_effect=fake_dart_items) as fetch:
            items = domestic_news.get_watchlist_disclosures(
                ['005930', 'US:AAPL', '000660', '005930'], days=7, now=now,
            )

        self.assertEqual([item['stockCode'] for item in items], ['005930', '000660'])
        self.assertTrue(all(item['relevance'] == 'direct' for item in items))
        self.assertEqual(fetch.call_count, 2)

    def test_general_disclosures_default_to_fifty_items(self):
        rows = [{'id': str(index), 'pubDate': '20260816'} for index in range(80)]
        with mock.patch.object(domestic_news, '_dart_items', return_value=rows):
            items = domestic_news.get_disclosures()
        self.assertEqual(len(items), 30)

    def test_kind_and_dart_same_event_are_merged_with_both_source_links(self):
        kind = {
            'id': 'kind-1', 'title': '삼성전자 단일판매·공급계약체결',
            'link': 'https://kind.example/1', 'pubDate': 'Mon, 10 Aug 2026 09:01:00 +0900',
            'provider': 'KIND', 'source': 'KIND', 'stockName': '삼성전자',
            'kind': 'disclosure', 'sourceStatus': 'kind-only',
        }
        dart = {
            'id': 'dart-1', 'title': '삼성전자 단일판매·공급계약 체결',
            'link': 'https://dart.example/1', 'pubDate': '20260810',
            'provider': 'DART', 'source': 'DART', 'stockName': '삼성전자',
            'kind': 'disclosure', 'sourceStatus': 'dart-only',
        }

        merged = domestic_news._dedupe_disclosures([kind, dart])

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]['provider'], 'DART')
        self.assertEqual(merged[0]['sourceStatus'], 'dart-confirmed')
        self.assertEqual(merged[0]['alternateLink'], 'https://kind.example/1')
        self.assertEqual({row['provider'] for row in merged[0]['sourceLinks']}, {'KIND', 'DART'})

    def test_kind_only_event_is_retained_when_dart_has_no_match(self):
        kind = {
            'id': 'kind-only', 'title': '삼성전자 매매거래정지 예고',
            'link': 'https://kind.example/only', 'pubDate': 'Mon, 10 Aug 2026 09:01:00 +0900',
            'provider': 'KIND', 'source': 'KIND', 'stockName': '삼성전자',
            'kind': 'disclosure', 'sourceStatus': 'kind-only',
        }
        dart = {
            'id': 'dart-other', 'title': '삼성전자 분기보고서',
            'link': 'https://dart.example/other', 'pubDate': '20260810',
            'provider': 'DART', 'source': 'DART', 'stockName': '삼성전자',
            'kind': 'disclosure', 'sourceStatus': 'dart-only',
        }

        result = domestic_news._dedupe_disclosures([kind, dart])

        self.assertEqual(len(result), 2)
        self.assertIn('kind-only', [item['sourceStatus'] for item in result])


if __name__ == '__main__':
    unittest.main()
