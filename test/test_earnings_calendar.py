import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import earnings_calendar


class EarningsCalendarTests(unittest.TestCase):
    def setUp(self):
        earnings_calendar._cache.clear()
        earnings_calendar._financials_cache.clear()
        earnings_calendar._viewer_cache.clear()
        earnings_calendar._finnhub_cache.clear()
        earnings_calendar._persistent_events.clear()

    def test_fetches_all_dart_pages_and_exposes_report_details(self):
        pages = [
            {
                'status': '000',
                'total_page': '2',
                'list': [{
                    'corp_name': '첫번째회사',
                    'stock_code': '000001',
                    'report_nm': '영업(잠정)실적',
                    'rcept_dt': '20260811',
                    'rcept_no': '20260811000001',
                }],
            },
            {
                'status': '000',
                'total_page': '2',
                'list': [{
                    'corp_name': '두번째회사',
                    'stock_code': '000002',
                    'report_nm': '연결재무제표 기준 영업(잠정)실적',
                    'rcept_dt': '20260811',
                    'rcept_no': '20260811000002',
                }],
            },
        ]
        with mock.patch.dict(os.environ, {'DART_API_KEY': 'test-key'}):
            with mock.patch.object(earnings_calendar, '_fetch_page', side_effect=pages) as fetch:
                events = earnings_calendar.fetch_month(2026, 8)

        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(len(events), 2)
        self.assertIn('영업(잠정)실적', events[0]['title'])
        self.assertEqual(events[0]['report_name'], '영업(잠정)실적')
        self.assertEqual(events[0]['receipt_no'], '20260811000001')
        self.assertEqual(events[0]['symbol'], '000001')

    def test_enriches_domestic_earnings_with_reported_financial_result(self):
        page = {
            'status': '000',
            'total_page': '1',
            'list': [{
                'corp_code': '00126380',
                'corp_name': '테스트전자',
                'stock_code': '000001',
                'report_nm': '영업(잠정)실적(공정공시)',
                'rcept_dt': '20260811',
                'rcept_no': '20260811000001',
            }],
        }
        financial_rows = [
            {'fs_div': 'CFS', 'account_nm': '매출액', 'thstrm_amount': '13600000000000', 'ord': '1'},
            {'fs_div': 'CFS', 'account_nm': '영업이익', 'thstrm_amount': '1200000000000', 'ord': '2'},
            {'fs_div': 'CFS', 'account_nm': '당기순이익', 'thstrm_amount': '900000000000', 'ord': '3'},
        ]
        with mock.patch.dict(os.environ, {'DART_API_KEY': 'test-key'}):
            with mock.patch.object(earnings_calendar, '_fetch_page', return_value=page):
                with mock.patch.object(earnings_calendar, '_fetch_financials', return_value=financial_rows) as fetch:
                    events = earnings_calendar.fetch_month(2026, 8)

        self.assertEqual(fetch.call_count, 1)
        fetch.assert_called_once_with('test-key', '00126380', 2026, '11012')
        self.assertEqual(events[0]['status'], 'reported')
        self.assertEqual(events[0]['result'], '매출 13.6조 · 영업이익 1.2조 · 순이익 9000억')
        self.assertIn('실적공시 완료', events[0]['title'])
        self.assertIn('매출 13.6조', events[0]['title'])

    def test_parses_domestic_result_from_disclosure_viewer(self):
        html = '''
        <span>단위 : 억원, %</span>
        <table>
          <tr><td>매출액</td><td>당해실적</td><td>1,236</td><td>1,049</td></tr>
          <tr><td>영업이익</td><td>당해실적</td><td>120</td><td>100</td></tr>
          <tr><td>당기순이익(손실)</td><td>당해실적</td><td>-30</td><td>10</td></tr>
        </table>
        '''
        result = earnings_calendar._reported_dart_viewer_result(html)
        self.assertEqual(result['revenue_actual'], 123600000000)
        self.assertEqual(result['operating_profit_actual'], 12000000000)
        self.assertEqual(result['net_income_actual'], -3000000000)
        self.assertEqual(result['result'], '매출 1236억 · 영업이익 120억 · 순이익 -30억')

    def test_parses_domestic_result_when_viewer_uses_th_and_danggi_label(self):
        html = '''
        <div>단위 : 백만원</div>
        <table>
          <tr><th>항목</th><th>당기실적</th><th>전기실적</th></tr>
          <tr><td>매출액</td><td>1,236</td><td>1,049</td></tr>
          <tr><td>영업이익</td><td>120</td><td>100</td></tr>
        </table>
        '''
        result = earnings_calendar._reported_dart_viewer_result(html)
        self.assertEqual(result['revenue_actual'], 1236000000)
        self.assertEqual(result['operating_profit_actual'], 120000000)

    def test_falls_back_to_disclosure_viewer_when_formal_financials_are_empty(self):
        event = {
            'corp_name': '테스트전자',
            'corp_code': '00126380',
            'receipt_no': '20260811000001',
            'report_name': '영업(잠정)실적(공정공시)',
            'receipt_date': '20260811',
        }
        viewer_result = {'result': '매출 1236억 · 영업이익 120억', 'revenue_actual': 123600000000}
        with mock.patch.object(earnings_calendar, '_fetch_financials', return_value=[]):
            with mock.patch.object(earnings_calendar, '_fetch_dart_viewer_result', return_value=viewer_result):
                enriched = earnings_calendar._enrich_dart_event('test-key', event)
        self.assertEqual(enriched['result'], viewer_result['result'])
        self.assertEqual(enriched['revenue_actual'], 123600000000)

    def test_fetches_and_caches_us_month(self):
        rows = [
            {'date': '2026-08-15', 'symbol': 'AAPL', 'company': 'Apple Inc.', 'hour': 'amc'},
            {'date': '2026-08-15', 'symbol': 'AAPL', 'company': 'Apple Inc.', 'hour': 'amc'},
            {'date': '2026-09-01', 'symbol': 'MSFT', 'company': 'Microsoft', 'hour': 'bmo'},
            {'date': '2026-08-20', 'company': 'No ticker'},
        ]
        with mock.patch.dict(os.environ, {'FINNHUB_API_KEY': 'test-key'}):
            with mock.patch.object(earnings_calendar, '_fetch_finnhub', return_value=rows) as fetch:
                events = earnings_calendar.fetch_us_month(2026, 8)
                cached = earnings_calendar.fetch_us_month(2026, 8)

        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['title'], '$AAPL 실적발표 (장후) · Apple Inc.')
        self.assertEqual(events[0]['start'], '2026-08-16')
        self.assertEqual(events[0]['us_date'], '2026-08-15')
        self.assertEqual(events[0]['us_session'], '장후')
        self.assertEqual(events[0]['source'], 'finnhub')
        self.assertEqual(events[0]['company'], 'Apple Inc.')
        self.assertEqual(cached, events)

    def test_us_earnings_kst_date_uses_session_boundary(self):
        self.assertEqual(earnings_calendar._finnhub_kst_date('2026-08-15', 'bmo'), '2026-08-15')
        self.assertEqual(earnings_calendar._finnhub_kst_date('2026-08-15', 'amc'), '2026-08-16')
        self.assertEqual(earnings_calendar._finnhub_kst_date('2026-08-15', 'dmh'), '2026-08-16')

    def test_marks_reported_us_earnings_with_eps_and_revenue_results(self):
        rows = [{
            'date': '2026-08-15',
            'symbol': 'AAPL',
            'company': 'Apple Inc.',
            'hour': 'amc',
            'epsActual': 1.2,
            'epsEstimate': 1.0,
            'revenueActual': 91819000000,
            'revenueEstimate': 88496400810,
        }]
        with mock.patch.dict(os.environ, {'FINNHUB_API_KEY': 'test-key'}):
            with mock.patch.object(earnings_calendar, '_fetch_finnhub', return_value=rows):
                events = earnings_calendar.fetch_us_month(2026, 8)

        event = events[0]
        self.assertEqual(event['company'], 'Apple Inc.')
        self.assertEqual(event['status'], 'reported')
        self.assertEqual(event['eps_actual'], 1.2)
        self.assertEqual(event['revenue_actual'], 91819000000)
        self.assertIn('실적발표 완료', event['title'])
        self.assertIn('EPS 1.20', event['title'])
        self.assertIn('매출 $91.8B', event['title'])
        self.assertIn('상회', event['title'])

    def test_merges_domestic_and_us_events_in_date_order(self):
        domestic = [{'title': '$삼성전자 실적발표', 'start': '2026-08-20', 'source': 'dart'}]
        us = [{'title': '$AAPL 실적발표', 'start': '2026-08-15', 'source': 'finnhub'}]
        with mock.patch.object(earnings_calendar, 'safe_fetch_month', return_value=domestic):
            with mock.patch.object(earnings_calendar, 'safe_fetch_us_month', return_value=us):
                events = earnings_calendar.merge_month(2026, 8)

        self.assertEqual([event['start'] for event in events], ['2026-08-15', '2026-08-20'])


    def test_merges_domestic_before_us_on_same_date(self):
        domestic = [{'title': 'Domestic earnings', 'start': '2026-08-15', 'source': 'dart', 'market': 'domestic'}]
        us = [
            {'title': 'US earnings', 'start': '2026-08-15', 'source': 'finnhub', 'market': 'us'},
            {'title': 'US earnings later', 'start': '2026-08-20', 'source': 'finnhub', 'market': 'us'},
        ]
        with mock.patch.object(earnings_calendar, 'safe_fetch_month', return_value=domestic):
            with mock.patch.object(earnings_calendar, 'safe_fetch_us_month', return_value=us):
                events = earnings_calendar.merge_month(2026, 8)

        self.assertEqual([(event['market'], event['start']) for event in events], [
            ('domestic', '2026-08-15'), ('us', '2026-08-15'), ('us', '2026-08-20')
        ])

    def test_merges_full_year_for_annual_search(self):
        domestic = [{'title': 'Domestic earnings', 'start': '2026-01-15', 'source': 'dart'}]
        us = [{'title': 'US earnings', 'start': '2026-12-15', 'source': 'finnhub'}]
        with mock.patch.object(earnings_calendar, 'safe_fetch_month', return_value=domestic) as fetch_domestic:
            with mock.patch.object(earnings_calendar, 'safe_fetch_us_month', return_value=us) as fetch_us:
                events = earnings_calendar.merge_year(2026)

        self.assertEqual(fetch_domestic.call_count, 12)
        self.assertEqual(fetch_us.call_count, 12)
        self.assertEqual([event['start'] for event in events], ['2026-01-15', '2026-12-15'])

    def test_persists_earnings_and_updates_without_deleting_previous_records(self):
        scheduled = {
            'title': '$AAPL 실적발표',
            'start': '2026-08-15',
            'source': 'finnhub',
            'market': 'us',
            'symbol': 'AAPL',
            'status': 'scheduled',
        }
        reported = dict(scheduled, title='$AAPL 실적발표 완료 · EPS 1.20', status='reported', result='EPS 1.20')
        with mock.patch.object(earnings_calendar, 'safe_fetch_month', return_value=[]), \
                mock.patch.object(earnings_calendar, 'safe_fetch_us_month', side_effect=[[scheduled], [reported]]):
            first = earnings_calendar.merge_month(2026, 8)
            second = earnings_calendar.merge_month(2026, 8)

        self.assertEqual(first[0]['status'], 'scheduled')
        self.assertEqual(second[0]['status'], 'reported')
        self.assertEqual(len(earnings_calendar._persistent_events), 1)


if __name__ == '__main__':
    unittest.main()


class ReportPeriodTests(unittest.TestCase):
    """접수월 -> (사업연도, 보고서코드) 추정.

    잠정실적은 분기 종료 후 약 3개월 안에 공시된다. 2026-09-02 이전에는 경계가
    3/5/8/11이라 9월 접수분을 3분기(11014)로 보냈는데, 3분기는 9월 30일에야
    끝나므로 존재하지 않는 보고서를 조회하게 돼 결과 숫자가 안 붙었다.
    """

    def test_september_provisional_result_is_second_quarter(self):
        # 회귀 케이스: 2026-09-01 접수 "영업(잠정)실적(공정공시)"은 2분기다.
        self.assertEqual(
            earnings_calendar._report_period('영업(잠정)실적(공정공시)', '20260901'),
            (2026, '11012'))

    def test_december_provisional_result_is_third_quarter(self):
        # 당해 사업보고서는 이듬해 3월에나 나오므로 12월을 11011로 보내면 빈 조회가 된다.
        self.assertEqual(
            earnings_calendar._report_period('영업(잠정)실적', '20261210'),
            (2026, '11014'))

    def test_receipt_month_maps_to_quarter_end(self):
        cases = {
            '20260115': (2025, '11011'), '20260331': (2025, '11011'),
            '20260401': (2026, '11013'), '20260630': (2026, '11013'),
            '20260701': (2026, '11012'), '20260930': (2026, '11012'),
            '20261001': (2026, '11014'), '20261231': (2026, '11014'),
        }
        for receipt_date, expected in cases.items():
            with self.subTest(receipt_date=receipt_date):
                self.assertEqual(
                    earnings_calendar._report_period('영업(잠정)실적', receipt_date), expected)

    def test_formal_report_name_still_wins_over_receipt_month(self):
        # 보고서명에 분기가 적혀 있으면 접수월 추정보다 우선한다.
        self.assertEqual(
            earnings_calendar._report_period('반기보고서 (2026.06)', '20260901'),
            (2026, '11012'))
        self.assertEqual(
            earnings_calendar._report_period('3분기보고서', '20261115'), (2026, '11014'))


class AnnouncementOnlyTests(unittest.TestCase):
    """예고·안내성 공시는 숫자 조회 예산(DART_RESULT_LOOKUP_MAX)을 쓰지 않는다."""

    def test_detects_announcement_only_reports(self):
        self.assertTrue(earnings_calendar.is_announcement_only('결산실적공시예고(안내공시)'))
        self.assertTrue(earnings_calendar.is_announcement_only('실적공시예고'))

    def test_actual_result_disclosures_are_not_announcement_only(self):
        for name in ('영업(잠정)실적(공정공시)',
                     '연결재무제표기준영업(잠정)실적(공정공시)',
                     '반기보고서'):
            with self.subTest(name=name):
                self.assertFalse(earnings_calendar.is_announcement_only(name))

    def test_announcements_do_not_consume_the_lookup_budget(self):
        """예고 공시가 앞에 깔려 있어도 실제 실적 공시가 조회된다."""
        rows = [{
            'corp_name': '예고회사%d' % i,
            'corp_code': 'C%05d' % i,
            'stock_code': '00000%d' % i,
            'report_nm': '결산실적공시예고(안내공시)',
            'rcept_dt': '20260901',
            'rcept_no': '2026090100000%d' % i,
        } for i in range(earnings_calendar.DART_RESULT_LOOKUP_MAX)]
        rows.append({
            'corp_name': '실적회사',
            'corp_code': 'C99999',
            'stock_code': '000999',
            'report_nm': '영업(잠정)실적(공정공시)',
            'rcept_dt': '20260901',
            'rcept_no': '20260901999999',
        })

        looked_up = []

        def fake_enrich(api_key, event):
            looked_up.append(event['corp_name'])
            return event

        earnings_calendar._cache.clear()
        with mock.patch.dict(os.environ, {'DART_API_KEY': 'test-key'}), \
             mock.patch.object(earnings_calendar, '_fetch', return_value=rows), \
             mock.patch.object(earnings_calendar, '_enrich_dart_event', side_effect=fake_enrich):
            events = earnings_calendar.fetch_month(2026, 9)

        # 예고 13건이 앞에 있어도 실제 실적 공시가 조회 대상에 들어간다.
        self.assertIn('실적회사', looked_up)
        self.assertEqual(looked_up, ['실적회사'])
        # 예고 공시는 목록에서 지우지 않는다 - "곧 실적을 낸다"는 정보는 유효하다.
        self.assertEqual(len(events), earnings_calendar.DART_RESULT_LOOKUP_MAX + 1)
