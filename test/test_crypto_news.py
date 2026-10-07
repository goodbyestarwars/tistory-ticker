import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'cloud-vm'))
import news_aggregator as news

class CryptoNewsTest(unittest.TestCase):
    def setUp(self):
        news._crypto_news_cache = {'items': [], 'updatedAt': None, 'stale': True}
        news._crypto_news_checked_at = 0

    def row(self, source, link):
        return {'title': 'Bitcoin ETF flows '+source, 'link': link, 'source': source,
                'pubDate': 'Thu, 08 Oct 2026 00:00:00 GMT', '_published_ts': 100}

    def test_crypto_sources_cache_and_partial_failure(self):
        def feed(url, source):
            return [self.row(source, 'https://example.com/'+source)]
        with patch.object(news, '_publisher_rss', side_effect=feed) as rss, patch.object(news, 'translate_news_titles'):
            data=news.get_crypto_news()
            self.assertFalse(data['stale'])
            self.assertEqual({r['market'] for r in data['items']}, {'crypto'})
            self.assertEqual({r['source'] for r in data['items']}, {'CoinDesk','Cointelegraph'})
            news.get_crypto_news()
            self.assertEqual(rss.call_count,2)
            news._crypto_news_checked_at=0
            with patch.object(news, '_publisher_rss', side_effect=lambda url, source: feed(url,source) if source=='CoinDesk' else []):
                degraded=news.get_crypto_news()
            self.assertTrue(degraded['stale'])
            self.assertEqual(len(degraded['items']),2,'failed provider retains its previous articles')

    def test_busy_returns_cached_and_cold_failure_is_cached(self):
        news._crypto_news_cache['items']=[self.row('CoinDesk','https://example.com/a')]
        news._crypto_news_lock.acquire()
        try:
            self.assertTrue(news.get_crypto_news()['stale'])
        finally:
            news._crypto_news_lock.release()
        self.setUp()
        with patch.object(news, '_publisher_rss', return_value=[]) as rss:
            self.assertEqual(news.get_crypto_news()['items'],[])
            news.get_crypto_news()
            self.assertEqual(rss.call_count,2,'provider outage must not flood the VM')

if __name__=='__main__': unittest.main()
