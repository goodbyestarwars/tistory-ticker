import sys
import unittest
from pathlib import Path
from datetime import datetime, timezone, timedelta
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'cloud-vm'))
import news_window as nw

class NewsWindowTests(unittest.TestCase):
    def test_window_excludes_old_future_unknown_and_keeps_boundary(self):
        now = datetime(2026, 10, 8, 0, tzinfo=timezone.utc)
        times = [now-timedelta(hours=24), now-timedelta(hours=24, seconds=1), now, now+timedelta(seconds=1)]
        rows = [{'title':str(i), 'pubDate':d.isoformat()} for i,d in enumerate(times)] + [{'title':'unknown','pubDate':''}]
        self.assertEqual([x['title'] for x in nw.recent_items(rows,'us',now)], ['0','2'])
        self.assertEqual(rows[0]['pubDate'], times[0].isoformat())
    def test_same_instant_in_korea_and_america(self):
        now=datetime(2026,10,8,0,tzinfo=timezone.utc)
        kr=nw.recent_items([{'pubDate':'2026-10-08T08:00:00+09:00'}],'domestic',now)
        us=nw.recent_items([{'pubDate':'2026-10-07T19:00:00-04:00'}],'us',now)
        self.assertEqual(nw.publication_time(kr[0]['pubDate']),nw.publication_time(us[0]['pubDate']))
        self.assertTrue(us[0]['pubDate'].startswith('2026-10-07'))
    def test_et_summer_winter_and_naive_market_time(self):
        self.assertEqual(nw.publication_time('2026-07-01 12:00:00','us').hour,16)
        self.assertEqual(nw.publication_time('2026-01-01 12:00:00','us').hour,17)
        self.assertEqual(nw.publication_time('2026-07-01 12:00:00','domestic').hour,3)
        self.assertEqual(nw.publication_time('Wed, 01 Jul 2026 12:00:00 EDT','us').hour,16)
    def test_elapsed_day_across_both_dst_transitions(self):
        for current in ['2026-03-09T05:00:00+00:00','2026-11-02T05:00:00+00:00']:
            now=datetime.fromisoformat(current)
            rows=[{'pubDate':(now-timedelta(hours=h)).isoformat()} for h in [23,24,25]]
            self.assertEqual(len(nw.recent_items(rows,'us',now)),2)
    def test_unknown_date_only_and_dst_ambiguous_times(self):
        for stamp in ['20261008','2026-10-08','2026-03-08 02:30:00','2026-11-01 01:30:00']:
            self.assertIsNone(nw.publication_time(stamp,'us'))

    def test_disclosures_and_original_archive_not_filtered(self):
        row={'pubDate':'2020-01-01','kind':'disclosure'}
        self.assertEqual(nw.recent_items([row],'domestic',keep_disclosures=True),[row])
        self.assertEqual(nw.recent_items([row],'domestic'),[])
class NewsDeliveryTests(unittest.TestCase):
    def setUp(self):
        import ast
        from types import SimpleNamespace
        from unittest.mock import Mock
        source=Path(__file__).resolve().parents[1]/'scripts'/'cloud-vm'/'main.py'
        names={'domestic_news_endpoint','foreign_news_endpoint','crypto_news_endpoint','_fetch_economic_news_snapshot','_build_flash_items'}
        tree=ast.parse(source.read_text(encoding='utf-8'))
        funcs=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in names]
        for node in funcs: node.decorator_list=[]
        now=datetime.now(timezone.utc)
        self.rows=[{'title':'CPI news','link':str(h),'pubDate':(now-timedelta(hours=h)).isoformat()} for h in [1,25]]
        self.ctx={'news_window':nw,'os':SimpleNamespace(environ={}), 'Request':object, 'Query':lambda value,**kw:value,
                  '_check_rate_limit':Mock(), '_note_domestic_news_real_hit':Mock(), 'envelope':lambda x:x,
                  '_GLOBAL_NEWS_LIMIT':20, '_GENERAL_NEWS_WARM_AHEAD_TTL_SEC':240,
                  '_DOMESTIC_DART_LIMIT':10,'_US_NEWS_LIMIT':70,'_DOMESTIC_NEWS_LIMIT':50,
                  '_FLASH_MACRO_RULES':[('물가',['cpi'],50)],
                  'domestic_news':SimpleNamespace(get_news=Mock(return_value={'items':self.rows}),get_disclosures=Mock(return_value=[])),
                  'news_aggregator':SimpleNamespace(get_general_news=Mock(return_value=self.rows),get_sec_filings=Mock(return_value=[]),get_crypto_news=Mock(return_value={'items':self.rows}))}
        exec(compile(ast.Module(body=funcs,type_ignores=[]),str(source),'exec'),self.ctx)
    def test_rest_all_markets_filter_cached_articles(self):
        for endpoint in ['domestic_news_endpoint','foreign_news_endpoint','crypto_news_endpoint']:
            data=self.ctx[endpoint](object())
            self.assertEqual(len(data['items']),1)
            self.assertEqual(data['newsWindowHours'],24)
    def test_websocket_and_breaking_news_share_window(self):
        for market in ['domestic','us']:
            data=self.ctx['_fetch_economic_news_snapshot'](market)
            self.assertEqual(len(data['items']),1)
            self.assertEqual(len(data['flash']),1)
            self.assertEqual(data['newsTimeZone'],nw.MARKET_ZONES[market])

if __name__=='__main__': unittest.main()
