import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import news_aggregator


class NewsAggregatorTests(unittest.TestCase):
    def test_naver_only_fallback_without_optional_keys(self):
        items = news_aggregator.merge_news('AAPL', naver_items=[{
            'title': '애플 관련 국내 뉴스',
            'link': 'https://news.example.test/aapl',
            'pubDate': 'Fri, 08 Aug 2026 09:00:00 +0900',
        }])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['provider'], 'Naver')

    def test_combines_and_deduplicates_providers(self):
        def fake_get_json(url):
            if 'alphavantage' in url:
                return {'feed': [{
                    'title': 'Apple reports results',
                    'url': 'https://news.example.test/aapl',
                    'time_published': '20260808T010000',
                    'source': 'US Media',
                    'ticker_sentiment': [],
                }]}
            return [{
                'headline': 'Apple launches product',
                'url': 'https://finnhub.example.test/aapl-2',
                'datetime': 1786147200,
                'source': 'Finnhub Press',
            }]

        with mock.patch.object(news_aggregator, '_get_json', side_effect=fake_get_json):
            items = news_aggregator.merge_news(
                'AAPL',
                naver_items=[{'title': 'Apple reports results', 'link': 'https://news.example.test/aapl', 'pubDate': ''}],
                alpha_api_key='alpha',
                finnhub_api_key='finnhub',
            )
        self.assertEqual(len(items), 2)
        self.assertEqual({item['provider'] for item in items}, {'Alpha Vantage', 'Finnhub'})


if __name__ == '__main__':
    unittest.main()
