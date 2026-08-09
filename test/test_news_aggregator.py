import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import news_aggregator


class NewsAggregatorTests(unittest.TestCase):
    def test_persistent_cache_skips_provider_calls_until_expired(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch.object(news_aggregator, 'NEWS_CACHE_DB_FILE', os.path.join(temp_dir, 'news.db')):
                fetcher = mock.Mock(return_value=[{
                    'title': 'Apple cached headline',
                    'link': 'https://news.example.test/cached',
                    'pubDate': 'Fri, 08 Aug 2026 09:00:00 +0000',
                }])
                with mock.patch.object(news_aggregator, '_get_xml', return_value=None):
                    first = news_aggregator.get_or_refresh_news('AAPL', naver_fetcher=fetcher, ttl_sec=3600)
                self.assertEqual(len(first), 1)
                self.assertEqual(fetcher.call_count, 1)

                second_fetcher = mock.Mock(side_effect=AssertionError('provider should not be called'))
                second = news_aggregator.get_or_refresh_news('AAPL', naver_fetcher=second_fetcher, ttl_sec=3600)
                self.assertEqual(second, first)
                second_fetcher.assert_not_called()

                with mock.patch.object(news_aggregator, '_get_xml', return_value=None):
                    refreshed = news_aggregator.get_or_refresh_news(
                        'AAPL',
                        naver_fetcher=mock.Mock(return_value=[{
                            'title': 'Apple refreshed headline',
                            'link': 'https://news.example.test/refreshed',
                            'pubDate': 'Fri, 08 Aug 2026 10:00:00 +0000',
                        }]),
                        ttl_sec=0,
                    )
                self.assertEqual(refreshed[0]['title'], 'Apple refreshed headline')
                cached = news_aggregator.load_cached_news('AAPL', ttl_sec=3600)
                self.assertEqual(len(cached), 2)
                self.assertEqual(cached[0]['title'], 'Apple refreshed headline')

    def test_refresh_merges_new_items_and_caps_cache_at_ten(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with mock.patch.object(news_aggregator, 'NEWS_CACHE_DB_FILE', os.path.join(temp_dir, 'news.db')):
                with mock.patch.object(news_aggregator, '_get_xml', return_value=None):
                    for index in range(12):
                        news_aggregator.get_or_refresh_news(
                            'AAPL',
                            naver_fetcher=mock.Mock(return_value=[{
                                'title': 'Apple headline %02d' % index,
                                'link': 'https://news.example.test/%02d' % index,
                                'pubDate': 'Fri, 08 Aug 2026 %02d:00:00 +0000' % (index % 24),
                            }]),
                            ttl_sec=0,
                        )
                cached = news_aggregator.load_cached_news('AAPL', ttl_sec=3600)
                self.assertEqual(len(cached), 10)
                self.assertIn('Apple headline 11', [item['title'] for item in cached])
                self.assertNotIn('Apple headline 00', [item['title'] for item in cached])

    def test_naver_only_fallback_without_optional_keys(self):
        with mock.patch.object(news_aggregator, '_get_xml', return_value=None):
            items = news_aggregator.merge_news('AAPL', naver_items=[{
                'title': '애플 관련 국내 뉴스',
                'link': 'https://news.example.test/aapl',
                'pubDate': 'Fri, 08 Aug 2026 09:00:00 +0900',
            }])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['provider'], 'Naver')

    def test_keyless_google_news_fills_two_foreign_slots(self):
        xml = news_aggregator.ET.fromstring('''
            <rss><channel>
              <item><title>Apple foreign headline one</title><link>https://foreign.example.test/one</link><pubDate>Fri, 08 Aug 2026 10:00:00 +0000</pubDate><source>Foreign One</source></item>
              <item><title>Apple foreign headline two</title><link>https://foreign.example.test/two</link><pubDate>Fri, 08 Aug 2026 09:00:00 +0000</pubDate><source>Foreign Two</source></item>
            </channel></rss>
        ''')
        with mock.patch.object(news_aggregator, '_get_xml', return_value=xml):
            items = news_aggregator.merge_news('AAPL', naver_items=[{
                'title': '애플 국내 뉴스',
                'link': 'https://news.example.test/aapl',
                'pubDate': 'Fri, 08 Aug 2026 08:00:00 +0000',
            }])
        self.assertEqual(len(items), 3)
        self.assertEqual(sum(item['provider'] == 'Google News (English)' for item in items), 2)
        self.assertEqual(sum(item['provider'] == 'Naver' for item in items), 1)

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
