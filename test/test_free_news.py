import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from email.utils import formatdate
import time
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('news', Path(__file__).resolve().parents[1] / 'scripts' / 'cloud-vm' / 'news_aggregator.py')
news = importlib.util.module_from_spec(spec)
spec.loader.exec_module(news)

class FreeNewsTests(unittest.TestCase):
    def setUp(self):
        news._official_news_cache.clear()
        news._rss_status.clear()

    def feed(self, stamp=None):
        date = formatdate(time.time()-60 if stamp is None else stamp, usegmt=True)
        return ET.fromstring('<rss><channel><item><title>Policy release</title><link>https://www.bok.or.kr/view?nttId=1</link><pubDate>'+date+'</pubDate><description>NO ARTICLE BODY</description></item></channel></rss>')

    def test_metadata_cache_and_failure_status(self):
        with patch.object(news, '_get_xml', return_value=self.feed()) as fetch:
            rows = news.get_official_news('domestic')
            self.assertEqual(len(rows), 1)  # Shared official URL appears only once.
            self.assertTrue(all(r['official'] and r['market']=='domestic' for r in rows))
            self.assertTrue(all('description' not in r for r in rows))
            news.get_official_news('domestic')
            self.assertEqual(fetch.call_count, 2)
        self.assertTrue(all(s['status']=='ok' and s['lastSuccessAt'] for s in news.rss_source_status('domestic')))
        news._official_news_cache['domestic'] = (0, rows)
        with patch.object(news, '_get_xml', side_effect=OSError('unavailable')):
            fallback = news.get_official_news('domestic')
        self.assertEqual(len(fallback), 1)
        self.assertTrue(all(s['status']=='error' and s['lastSuccessAt'] for s in news.rss_source_status('domestic')))

    def test_old_future_unknown_publication_excluded(self):
        for stamp in (time.time()-8*86400, time.time()+3600):
            news._official_news_cache.clear()
            with patch.object(news, '_get_xml', return_value=self.feed(stamp)):
                self.assertEqual(news.get_official_news('us'), [])
        with patch.object(news, '_get_xml', return_value=ET.fromstring('<rss><item><title>Unknown date</title><link>https://example.com/a</link></item></rss>')):
            news._official_news_cache.clear()
            self.assertEqual(news.get_official_news('us'), [])

    def test_query_identity_and_same_source_headline(self):
        a={'title':'GDP release', 'source':'Official', 'link':'https://example.com/view?id=1&utm_source=x'}
        b=dict(a, link='https://example.com/view?id=2', title='CPI release')
        c=dict(a, link='https://example.com/other')
        d=dict(a, source='Other publisher', link='https://other.example/a')
        self.assertNotEqual(news._dedupe_key(a), news._dedupe_key(b))
        self.assertEqual(news._dedupe_key(a), news._dedupe_key(dict(a,link='https://example.com/view?id=1')))
        self.assertEqual(len(news._dedupe_headlines([a,b,c,d])),3)

    def test_latest_publication_uses_time_not_weekday_text(self):
        rows = [dict(title='A',link='https://example.com/a',pubDate='Tue, 10 Nov 2026 16:00:00 +0900'),
                dict(title='B',link='https://example.com/b',pubDate='Fri, 13 Nov 2026 12:00:00 +0900')]
        news._record_rss_status('Federal Reserve',rows)
        status = news.rss_source_status('us')[-1]
        self.assertEqual(status['latestPublishedAt'],rows[1]['pubDate'])

if __name__ == '__main__':
    unittest.main()

