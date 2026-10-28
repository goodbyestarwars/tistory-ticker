"""Calendar lifecycle and source boundaries; no live credentials/network required."""
import ast
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import zipfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/cloud-vm'))
import calendar_model as model
import calendar_sources as sources
import earnings_calendar as calendar
import sp500_constituents as sp
import calendar_attachment as attachment
from calendar_verified_events import events as notices


class UnifiedCalendarTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = patch.object(calendar, 'EARNINGS_STORE_FILE', str(Path(self.temp.name) / 'events.json'))
        self.store.start()
        self.addCleanup(self.store.stop)
        self.old_events = dict(calendar._persistent_events)
        calendar._persistent_events.clear()
        self.addCleanup(lambda: calendar._persistent_events.update(self.old_events))
        self.addCleanup(calendar._persistent_events.clear)
        calendar._source_health.clear()
        calendar._pending_months.clear()
        calendar._finnhub_cache.clear()
        calendar._dart_page_states.clear()

    def scheduled(self, **extra):
        return dict(notices()[2], **extra)

    def test_whole_sp500_includes_required_symbols(self):
        for ticker in ('STX', 'HOOD', 'NVDA', 'AAPL', 'MSFT'):
            self.assertTrue(calendar._is_sp500(ticker))
        self.assertGreaterEqual(len(sp.constituents()), 490)

    def test_normalizes_share_class_and_case(self):
        self.assertTrue(calendar._is_sp500(' brk-b '))
        self.assertEqual(model.symbol('brk-b'), 'BRK.B')

    def test_only_earnings_scope_filtered(self):
        self.assertFalse(calendar._in_scope({'source':'finnhub', 'market':'us', 'symbol':'ZZZZ'}))
        for source in ('dart', 'econ', 'google'):
            self.assertTrue(calendar._in_scope({'source':source, 'market':'us', 'symbol':'ZZZZ'}))

    def test_legacy_store_revalidation(self):
        calendar._persistent_events.update(a={'source':'finnhub','market':'us','symbol':'STX','start':'2026-10-28','title':'STX'},
                                           b={'source':'finnhub','market':'us','symbol':'ZZZZ','start':'2026-10-28','title':'other'})
        self.assertEqual([e['symbol'] for e in calendar.read_month(2026,10)], ['STX'])

    def test_refresh_failure_keeps_last_verified_members(self):
        with patch.object(sp, 'STORE', Path(self.temp.name) / 'sp.json'), patch.object(sp, '_retry_at', 0), \
             patch.object(sp.urllib.request, 'urlopen', side_effect=OSError('offline')):
            before = sp.constituents()
            sp.refresh(90000)
            self.assertEqual(sp.constituents(), before)
            self.assertEqual(sp.health()['state'], 'stale')

    def test_reject_incomplete_and_duplicates(self):
        with self.assertRaises(ValueError):
            sp.validate([{'Symbol':'AAPL'}])
        with self.assertRaises(ValueError):
            sp.validate([{'Symbol':'AAPL'}] * 503)

    def test_domestic_official_announcement_uses_event_not_publication_date(self):
        e = sources.parse_hynix('Q3 2026 Earnings Conference Call Invitation',
            'We present third quarter earnings of 2026 on October. 28th, 2026. The conference call is at 9:00 a.m. before 9:00 a.m. Seoul time.',
            'https://news.skhynix.com/en/q3-2026-earnings-conference-call-invitation/', '2026-10-21')
        self.assertEqual(e['eventDate'], '2026-10-28')
        self.assertEqual(e['conferenceCallAt'], '2026-10-28T09:00:00+09:00')
        self.assertIsNone(e['scheduledAt'])
        self.assertEqual(e['publishedAt'], '2026-10-21')

    def test_ir_disclosure_date_and_time(self):
        row = {'corp_name':'SK하이닉스','stock_code':'000660','rcept_no':'123','rcept_dt':'20261014'}
        e = sources.parse_ir_disclosure('<table><tr><td>개최일자</td><td>2026-10-28</td></tr><tr><td>시간</td><td>09:00</td></tr></table>2026년 3분기 경영실적 발표', row)
        self.assertEqual(e['start'], '2026-10-28')
        self.assertEqual(e['publishedAt'], '20261014')
        self.assertEqual(e['symbol'], '000660')

    def test_general_ir_not_earnings(self):
        row = {'corp_name':'테스트','rcept_no':'123'}
        self.assertIsNone(sources.parse_ir_disclosure('개최일자 2026-10-28 NDR 회사소개 및 사업현황 설명',row))

    def test_missing_date_does_not_use_receipt(self):
        self.assertIsNone(sources.parse_ir_disclosure('2026년 3분기 실적 발표',{'rcept_no':'123','rcept_dt':'20261014'}))

    def test_duplicate_sources_one_quarter_one_card(self):
        a = self.scheduled()
        b = dict(a, source='dart-ir', sourceUrl='https://dart.fss.or.kr/dsaf001/main.do?rcpNo=123')
        calendar._upsert_persistent_events([a,b])
        result = calendar.read_month(2026,10)
        self.assertEqual(len(result),1)
        self.assertEqual(len(result[0]['sources']),2)

    def test_completed_disclosure_links_without_moving_scheduled_date(self):
        a = self.scheduled()
        b = dict(a, source='dart', status='reported', start='2026-10-29', eventDate='2026-10-29',
                 dateBasis='disclosure_receipt', receipt_no='123', result='매출 확인', sourceUrl='https://dart.fss.or.kr/result')
        calendar._upsert_persistent_events([a,b])
        e = calendar.read_month(2026,10)[0]
        self.assertEqual(e['eventDate'],'2026-10-28')
        self.assertEqual(e['status'],'reported')
        self.assertEqual(e['result'],'매출 확인')
        self.assertEqual(e['resultUrl'],b['sourceUrl'])

    def test_date_change_across_month_has_one_identity_and_history(self):
        a = self.scheduled()
        b = dict(a, eventDate='2026-11-02', kstDate='2026-11-02', start='2026-11-02')
        calendar._upsert_persistent_events([a,b])
        self.assertEqual(calendar.read_month(2026,10),[])
        e = calendar.read_month(2026,11)[0]
        self.assertEqual(e['status'],'changed')
        self.assertEqual(e['history'][0]['eventDate'],'2026-10-28')

    def test_conflict_preserves_both_sources_without_selecting_new_date(self):
        a = self.scheduled()
        b = dict(a, source='dart-ir', sourceUrl='https://dart.fss.or.kr/123', eventDate='2026-10-29')
        e = model.reconcile(model.reconcile(None,a),b)
        self.assertEqual(e['verification'],'conflict')
        self.assertEqual(e['eventDate'],'2026-10-28')
        self.assertEqual({s['eventDate'] for s in e['conflicts']},{'2026-10-28','2026-10-29'})

    def test_explicit_cancellation_and_missing_feed_preserve_history(self):
        calendar._upsert_persistent_events([self.scheduled(),self.scheduled(status='cancelled')])
        calendar._upsert_persistent_events([])
        e = calendar.read_month(2026,10)[0]
        self.assertEqual(e['status'],'cancelled')
        self.assertTrue(e['history'])

    def test_scheduled_observation_cannot_unreport(self):
        a = model.reconcile(None,self.scheduled(status='reported',result='confirmed'))
        e = model.reconcile(a,self.scheduled())
        self.assertEqual(e['status'],'reported')
        self.assertEqual(e['result'],'confirmed')
        self.assertEqual(e['title'],a['title'])

    def test_event_types_stay_distinct(self):
        self.assertNotEqual(model.identity(self.scheduled()),model.identity(self.scheduled(eventType='ir')))

    def test_unknown_fiscal_period_never_inferred_from_receipt(self):
        e = model.normalize({'source':'dart','title':'영업(잠정)실적','start':'2026-10-28','receipt_date':'20261028'})
        self.assertIsNone(e['fiscalPeriod'])
        self.assertEqual(e['dateBasis'],'disclosure_receipt')

    def test_exact_us_time_dst_and_month_boundary(self):
        for at, expected in [('2026-10-31T17:00:00-04:00','2026-11-01'),('2026-11-02T17:00:00-05:00','2026-11-03')]:
            e = model.normalize({'scheduledAt':at,'market':'us','start':at,'source':'finnhub'})
            self.assertEqual(e['kstDate'],expected)
            self.assertEqual(e['eventDate'],at[:10])

    def test_naive_exact_time_rejected(self):
        with self.assertRaises(ValueError):
            model.normalize({'scheduledAt':'2026-10-28T09:00:00','start':'2026-10-28'})

    def test_unknown_us_session_has_no_invented_time(self):
        rows = [{'symbol':'STX','date':'2026-10-28','hour':'dmh','year':2027,'quarter':1}]
        with patch.dict(os.environ,FINNHUB_API_KEY='fixture'),patch.object(calendar,'_fetch_finnhub',return_value=rows):
            e = calendar.fetch_us_month(2026,10)[0]
        self.assertIsNone(e['scheduledAt'])
        self.assertIsNone(e['kstDate'])
        self.assertEqual(e['dateConversion'],'kst_date_unconfirmed')

    def test_attachments_optional_without_download_or_inferred_date(self):
        self.assertEqual(sources.attachment_policy({'eventDate':'2026-10-28'})['state'],'not_required')
        self.assertFalse(sources.attachment_policy({})['downloaded'])
        self.assertEqual(sources.attachment_policy({})['state'],'needs_review')

    def test_empty_vs_error_health_and_persistent_recovery(self):
        calendar._record_source('finnhub',2026,10,'ok',0)
        self.assertEqual(calendar.calendar_health(2026,10)['sources']['finnhub']['count'],0)
        calendar._upsert_persistent_events([self.scheduled()])
        with patch.object(calendar,'fetch_us_month',side_effect=OSError('offline')):
            self.assertEqual(calendar.safe_fetch_us_month(2026,10),[])
        self.assertEqual(calendar.calendar_health(2026,10)['sources']['finnhub']['state'],'error')
        self.assertEqual(len(calendar.read_month(2026,10)),1)
        self.assertTrue(calendar._load_persistent_events())

    def test_api_reads_do_not_fetch_external_sources(self):
        with patch.object(calendar,'_fetch_month_sources',side_effect=AssertionError('network')):
            calendar.read_month(2026,10)
        src = (Path(__file__).resolve().parents[1]/'scripts/cloud-vm/main.py').read_text(encoding='utf-8')
        tree = ast.parse(src)
        endpoint = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='earnings_calendar_endpoint')
        code = ast.unparse(endpoint)
        self.assertNotIn('merge_month',code)
        self.assertNotIn('merge_year',code)

    def test_queue_bounded_not_year_fanout(self):
        for month in range(1,13): calendar.read_month(2026,month)
        self.assertLessEqual(len(calendar._pending_months),6)

    def test_attachment_hwpx_offline_and_size_budget(self):
        path = Path(self.temp.name) / 'notice.hwpx'
        with zipfile.ZipFile(path, 'w') as f:
            f.writestr('Contents/section0.xml','<section><p>2026년 3분기 실적 발표</p></section>')
        self.assertIn('실적 발표', attachment.extract(path)['text'])
        oversized = Path(self.temp.name) / 'big.pdf'
        with oversized.open('wb') as f:
            f.truncate(attachment.MAX_BYTES+1)
        self.assertEqual(attachment.extract(oversized)['state'],'too_large')

    def test_incremental_dart_pagination_continues_instead_of_truncating(self):
        def page(api_key, start, end, number):
            return {'total_page':'12','list':[{'rcept_no':str(number),'report_nm':'2026년 3분기 실적','rcept_dt':'20261028'}]}
        with patch.object(calendar,'_fetch_page',side_effect=page):
            first = calendar._fetch('fixture','20261001','20261101')
            second = calendar._fetch('fixture','20261001','20261101')
        self.assertEqual(len(first),10)
        self.assertEqual(len(second),12)
        self.assertFalse(calendar._dart_page_states[('20261001','20261101')]['partial'])

    def test_invalid_us_payload_is_error_not_empty_month(self):
        response = io.BytesIO(b'{"error":"denied"}')
        with patch.object(calendar.urllib.request,'urlopen',return_value=response):
            with self.assertRaises(ValueError): calendar._fetch_finnhub('fixture','2026-10-01','2026-10-31')

    def test_verified_notice_is_scheduled_not_completed_from_elapsed_date(self):
        for event in notices():
            self.assertEqual(event['status'],'scheduled')
            self.assertTrue(event['sourceUrl'].startswith('https://'))
            self.assertIsNone(event['scheduledAt'])

    def test_normalized_quarter_does_not_mix_calendar_and_fiscal_year(self):
        self.assertEqual(model.period('Seagate 1Q2027'),'2027-Q1')
        self.assertEqual(model.period('분기보고서 (2026.09)'),'2026-Q3')

    def test_background_slice_isolates_provider_failure_and_persists_health(self):
        with patch.object(calendar,'_health_file',str(Path(self.temp.name)/'health.json')), \
             patch.object(calendar,'_official_attempt',0),patch.object(calendar,'_month_attempts',{}), \
             patch.object(sp,'refresh'),patch.object(calendar,'_fetch_month_sources',return_value=[]), \
             patch.object(sources,'fetch_hynix',return_value=[self.scheduled()]), \
             patch.object(sources,'read',return_value='changed markup'), \
             patch.object(sources,'fetch_us_notices',side_effect=OSError('unavailable')), \
             patch.object(calendar,'_collect_domestic_ir'):
            calendar.refresh_due()
        recorded = json.loads((Path(self.temp.name)/'health.json').read_text(encoding='utf-8'))
        self.assertTrue(any(v['state']=='partial' for k,v in recorded.items() if k.endswith('|corporate-ir')))
        self.assertTrue(any(v['state']=='ok' for k,v in recorded.items() if k.endswith('|corporate-hynix')))
        self.assertEqual(len(calendar.read_month(2026,10)),1)


if __name__ == '__main__':
    unittest.main()
