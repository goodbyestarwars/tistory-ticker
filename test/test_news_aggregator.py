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


    def test_general_news_combines_finnhub_and_alpha(self):
        def fake_get_json(url):
            if 'finnhub.io/api/v1/news' in url:
                return [{
                    'headline': 'US market headline',
                    'url': 'https://news.example.test/us-market',
                    'datetime': 1786147200,
                    'source': 'US Media',
                }]
            return {'feed': [{
                'title': 'Macro economy headline',
                'url': 'https://news.example.test/macro',
                'time_published': '20260808T010000',
                'source': 'Macro Media',
            }]}

        with mock.patch.object(news_aggregator, '_general_news_cache', (0, [])), \
                mock.patch.object(news_aggregator, '_get_json', side_effect=fake_get_json), \
                mock.patch.object(news_aggregator, '_get_xml', return_value=None):
            items = news_aggregator.get_general_news(alpha_api_key='alpha', finnhub_api_key='finnhub', limit=10)

        self.assertEqual(len(items), 2)
        self.assertEqual({item['provider'] for item in items}, {'Alpha Vantage', 'Finnhub'})
        self.assertTrue(all(item['market'] == 'us' for item in items))

    def test_general_news_includes_major_publisher_rss(self):
        xml = news_aggregator.ET.fromstring('''
            <rss><channel>
              <item><title>CNBC market headline</title><link>https://cnbc.example.test/one</link><pubDate>Fri, 08 Aug 2026 10:00:00 +0000</pubDate></item>
            </channel></rss>
        ''')
        with mock.patch.object(news_aggregator, '_general_news_cache', (0, [])), \
                mock.patch.object(news_aggregator, '_get_xml', return_value=xml):
            items = news_aggregator.get_general_news(limit=10)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['source'], 'CNBC')
        self.assertEqual(items[0]['provider'], 'CNBC RSS')

    def test_google_news_can_prioritize_major_publishers(self):
        xml = news_aggregator.ET.fromstring('<rss><channel></channel></rss>')
        with mock.patch.object(news_aggregator, '_get_xml', return_value=xml) as get_xml:
            news_aggregator._google_news('AAPL', major_publishers=True)

        query = get_xml.call_args[0][0]
        self.assertIn('site%3Acnbc.com', query)
        self.assertIn('site%3Abloomberg.com', query)

    def test_sec_edgar_filings_are_normalized_as_us_disclosures(self):
        xml = news_aggregator.ET.fromstring('''
            <feed xmlns="http://www.w3.org/2005/Atom">
              <entry>
                <title>Example Corp - 8-K</title>
                <updated>2026-08-17T01:02:03Z</updated>
                <category term="8-K" />
                <link href="https://www.sec.gov/Archives/edgar/data/example/ filing.html" />
              </entry>
              <entry>
                <title>Example Corp - S-1</title>
                <updated>2026-08-17T01:01:03Z</updated>
                <category term="S-1" />
                <link href="https://www.sec.gov/Archives/edgar/data/example/other.html" />
              </entry>
            </feed>
        ''')
        with mock.patch.object(news_aggregator.ET, 'fromstring', return_value=xml), \
                mock.patch.object(news_aggregator.urllib.request, 'urlopen') as urlopen:
            response = mock.Mock()
            response.read.return_value = b'<feed />'
            response.__enter__ = mock.Mock(return_value=response)
            response.__exit__ = mock.Mock(return_value=False)
            urlopen.return_value = response
            news_aggregator._sec_filings_cache = (0, [])
            items = news_aggregator.get_sec_filings(limit=30, ttl_sec=0)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['provider'], 'SEC EDGAR')
        self.assertEqual(items[0]['kind'], 'disclosure')
        self.assertEqual(items[0]['market'], 'us')


if __name__ == '__main__':
    unittest.main()
