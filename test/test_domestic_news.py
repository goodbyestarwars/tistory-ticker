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


if __name__ == '__main__':
    unittest.main()
