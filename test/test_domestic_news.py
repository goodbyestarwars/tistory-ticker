import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import domestic_news


class DomesticNewsTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
