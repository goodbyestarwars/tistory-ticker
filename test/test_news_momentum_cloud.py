import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from datetime import date, timedelta

path = Path(__file__).resolve().parents[1] / 'scripts/cloud-vm/news_momentum.py'
spec = importlib.util.spec_from_file_location('news_momentum', path)
nm = importlib.util.module_from_spec(spec); spec.loader.exec_module(nm)
TODAY = date(2026, 11, 13)
def article(title, description='', day=0, url=None):
    return {'title':title, 'description':description, 'pubDate':(TODAY-timedelta(days=day)).isoformat(),
            'link':url or 'https://example.org/' + str(abs(hash(title)))}

class KeywordCloudTests(unittest.TestCase):
    def test_email_domain_and_signature_are_not_company_mentions(self):
        items = [article('삼성전자 반도체 매출 확대', '홍길동 기자 abc@naver.com'),
                 article('현대차 전기차 수출 증가', 'https://www.naver.com 관련 링크'),
                 article('은행 실적 개선', '홍길동 기자 NAVER 취재팀'),
                 article('조선 수주 확대', '사진=네이버 제공'),
                 article('실적 개선', '연락처 abc&#64;naver.com')]
        self.assertEqual(nm.relevant_news('035420','NAVER',items,TODAY), [])
    def test_title_and_clean_summary_mentions_and_aliases(self):
        items=[article('네이버 AI 클라우드 확대'), article('NAVER 커머스 매출 증가'),
               article('클라우드 계약 체결', '네이버는 기업용 서비스를 공급했다.')]
        self.assertEqual(len(nm.relevant_news('035420','NAVER',items,TODAY)),2)
    def test_summary_only_market_roundup_and_english_stopwords(self):
        self.assertEqual(nm.relevant_news('035420','NAVER',[article('삼성전자 반도체 수출 증가','NAVER도 상승했다')],TODAY),[])
        words=nm._headline_keywords('Naver to launch new AI cloud logistics robot service','035420','NAVER')
        self.assertIn('AI',words);self.assertIn('물류',words);self.assertNotIn('TO',words)
    def test_dedup_url_and_normalized_title(self):
        items=[article('NAVER AI 매출 증가',url='https://a/1'),
               article('NAVER AI 매출 증가!',url='https://b/2'),
               article('NAVER AI 투자 확대',url='https://a/1')]
        self.assertEqual(len(nm.relevant_news('035420','NAVER',items,TODAY)),1)
    def test_windows_frequency_and_company_stopwords(self):
        items=[article('NAVER AI AI 광고 매출 증가'),article('네이버 AI 광고 계약 체결',day=6),
               article('네이버 AI 클라우드 투자 확대',day=7),article('NAVER AI 클라우드 협력',day=29),
               article('NAVER AI 광고 매출 최고',day=30)]
        cloud=nm.build_keyword_cloud('035420','NAVER',items,TODAY)
        seven={w['text']:w for w in cloud['windows']['7']['keywords']}
        thirty={w['text']:w for w in cloud['windows']['30']['keywords']}
        self.assertEqual(seven['AI']['count'],2); self.assertEqual(thirty['AI']['count'],4)
        self.assertEqual(thirty['클라우드']['count'],2)
        self.assertNotIn('NAVER',thirty);self.assertNotIn('네이버',thirty)
        self.assertEqual(len(thirty['AI']['articles']),3) # day 29 link not retained
    def test_invalid_missing_and_future_date_excluded(self):
        items=[dict(article('NAVER AI 투자'),pubDate='bad'),dict(article('NAVER AI 투자2'),pubDate='20261399'),
               dict(article('NAVER AI 투자3'),pubDate=''),article('NAVER AI 투자4',day=-1)]
        self.assertEqual(nm.relevant_news('035420','NAVER',items,TODAY),[])
    def test_short_name_not_substring_or_summary_only(self):
        self.assertEqual(nm.relevant_news('000000','이수',[article('이수페타시스 수주'),article('AI 계약','이수 제품')],TODAY),[])
    def test_topics_use_same_relevance_gate(self):
        items=[article('삼성전자 실적 개선'),article('현대차 실적 개선','email: a@naver.com')]
        self.assertEqual(nm.extract_topics('035420','NAVER',items,TODAY),[])
    def test_no_synthetic_words_for_empty_or_single_article(self):
        for items in [[],[article('NAVER AI 광고 투자 확대')]]:
            self.assertEqual(nm.build_keyword_cloud('035420','NAVER',items,TODAY)['windows']['7']['keywords'],[])
    def test_schema_migration_snapshot_and_metadata_retention(self):
        conn=nm.get_conn(':memory:');nm.create_schema(conn);nm.create_schema(conn)
        nm.save_stock_coverage(conn,'035420','NAVER',TODAY.isoformat(),TODAY.isoformat(),TODAY.isoformat(),True,2,1)
        self.assertIn('035420',nm.load_coverage_dates(conn))
        self.assertNotIn('035420',nm.load_coverage_dates(conn,require_cloud=True))
        cloud=nm.build_keyword_cloud('035420','NAVER',[article('NAVER AI 광고 확대'),article('네이버 AI 광고 매출 증가')],TODAY)
        nm.save_keyword_cloud(conn,'035420',cloud,[])
        row=conn.execute('SELECT * FROM news_stock_coverage').fetchone()
        self.assertEqual(nm._load_keyword_cloud(row,TODAY)['windows']['7']['keywords'][0]['count'],2)
        late=nm._load_keyword_cloud(row,TODAY+timedelta(days=20))
        self.assertTrue(late['stale']);self.assertEqual(late['windows']['7']['keywords'][0]['articles'],[])
        self.assertTrue(nm._load_keyword_cloud(row,TODAY+timedelta(days=30))['expired'])
        nm.prune_old_details(conn,today=TODAY+timedelta(days=20))
        stored=json.loads(conn.execute('SELECT keyword_cloud_json FROM news_stock_coverage').fetchone()[0])
        self.assertEqual(stored['windows']['7']['keywords'][0]['articles'],[])
        empty=nm.build_keyword_cloud('035420','NAVER',[],TODAY)
        nm.save_keyword_cloud(conn,'035420',empty,[])
        self.assertEqual(nm.load_stock_momentum(conn,'035420')['keywordCloud']['windows']['7']['keywords'],[])
        conn.close()

if __name__=='__main__':unittest.main()
